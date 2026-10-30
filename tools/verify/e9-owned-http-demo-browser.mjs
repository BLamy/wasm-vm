#!/usr/bin/env node
// One built-page load, existing 127-test suite, and the visible real HTTP OFF/ON/replay probe.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),web=path.join(root,'web/dist');
assert(process.argv.length===4&&process.argv[2]==='--output');
const out=path.resolve(process.argv[3]);await fs.mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T22b',scope:'built demo and actual full-Alpine owned HTTP OFF/ON and replay, not the T22c/d desktop/performance campaign',status:'running',
 head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
 started:new Date().toISOString(),errors:[],missing:[],external:[],assets:[]};
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const fixture=JSON.parse(await fs.readFile(path.join(web,'session-software-fixture.json'),'utf8'));
const image=JSON.parse(await fs.readFile(path.join(web,'session-alpine-image.json'),'utf8'));
const firstChunk=new Map();image.chunks.forEach((id,index)=>{if(!firstChunk.has(id))firstChunk.set(id,index);});
const disk=await fs.open(path.join(root,'releases/rootfs/alpine-rootfs.ext4'),'r');
assert.equal((await disk.stat()).size,fixture.raw_image_bytes);
report.immutableRequests=[];report.immutableChunks=[];
let browser,context,page,origin;
const server=createServer(async(req,res)=>{try{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/favicon.ico'){res.writeHead(204).end();return;}
 const base=name.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+name);assert(file.startsWith(base+path.sep));
 const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
}catch(error){report.missing.push({url:req.url,error:String(error)});res.writeHead(404).end();}});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});report.browser=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',error=>report.errors.push(error.stack));
 page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin){
  if(request.url().startsWith(new URL('chunks/',fixture.base_url).href))report.immutableRequests.push(request.url());else report.external.push(request.url());
 }});
 await page.route(new URL('chunks/',fixture.base_url).href+'*.bin',async route=>{
  const url=new URL(route.request().url()),id=path.basename(url.pathname,'.bin');assert(/^[a-f0-9]{64}$/.test(id));
  const index=firstChunk.get(id);assert(index!==undefined,'unknown immutable chunk');const bytes=Buffer.alloc(image.chunk_size);
  assert.equal((await disk.read(bytes,0,bytes.length,index*image.chunk_size)).bytesRead,bytes.length);assert.equal(sha(bytes),id);
  report.immutableChunks.push({index,bytes:bytes.length,sha256:id});
  await route.fulfill({status:200,headers:{'Content-Type':'application/octet-stream','Access-Control-Allow-Origin':origin,'Cross-Origin-Resource-Policy':'cross-origin'},body:bytes});
 });page.on('websocket',socket=>report.external.push(socket.url()));
 await page.goto(origin+'/app.html?noAutoBoot&testHooks=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 for(const name of ['app.html','main.js','roadmap.js','owned-http-probe.js','gpu-checkpoint-build.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm']){
  const response=await context.request.get(origin+'/'+name);assert.equal(response.status(),200);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,name))));report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }
 await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
 report.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.suite,{passed:127,failed:0});
 await page.locator('#owned-http-panel summary').click();await page.locator('#owned-http-run').click();
 await page.waitForFunction(()=>!!window.__ownedHttpReport,null,{timeout:900000});report.probe=await page.evaluate(()=>window.__ownedHttpReport);
 assert.equal(report.probe.status,'passed',JSON.stringify(report.probe));assert.equal(report.probe.modes.length,2);assert.equal(report.probe.replays[0].exactNativeBytes,true);assert.equal(report.probe.originalServerUnchanged,true);for(const mode of report.probe.modes){assert.equal(mode.bodies.length,10);assert.deepEqual(mode.server.server.requests,Array(10).fill(1));}
 assert.equal(await page.locator('#owned-http-pip').getAttribute('class'),'cap-pip live');
 const row=page.locator('.cap').filter({hasText:'Owned live HTTP with zero-egress replay'});assert.equal(await row.locator('.cap-pip').getAttribute('class'),'cap-pip live');
 await page.locator('#owned-http-panel').screenshot({path:path.join(out,'owned-http.png')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{
 if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await disk.close();
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
