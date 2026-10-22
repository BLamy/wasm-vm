#!/usr/bin/env node
// One built-page load, existing 127-test suite, and the visible capture-OFF probe.
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
const report={task:'E9-T22a',scope:'built demo and bounded visible OFF probe; not full software/GPU/benchmark acceptance',status:'running',
 head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
 started:new Date().toISOString(),errors:[],missing:[],external:[],assets:[]};
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
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
 page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)report.external.push(request.url());});page.on('websocket',socket=>report.external.push(socket.url()));
 await page.goto(origin+'/app.html?noAutoBoot&testHooks=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 for(const name of ['app.html','main.js','roadmap.js','unrecorded-control-probe.js','gpu-checkpoint-build.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm']){
  const response=await context.request.get(origin+'/'+name);assert.equal(response.status(),200);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,name))));report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }
 await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
 report.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.suite,{passed:127,failed:0});
 await page.locator('#unrecorded-control-panel summary').click();await page.locator('#unrecorded-control-run').click();
 await page.waitForFunction(()=>!!window.__unrecordedControlReport,null,{timeout:180000});report.probe=await page.evaluate(()=>window.__unrecordedControlReport);
 assert.equal(report.probe.status,'passed',JSON.stringify(report.probe));assert.equal(report.probe.final.transition,'1000000');
 assert.equal(await page.locator('#unrecorded-control-pip').getAttribute('class'),'cap-pip live');
 const row=page.locator('.cap').filter({hasText:'Live execution with recording disabled'});assert.equal(await row.locator('.cap-pip').getAttribute('class'),'cap-pip live');
 await page.locator('#unrecorded-control-panel').screenshot({path:path.join(out,'off-control.png')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.external,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{
 if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
