#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args={};for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--development'){args.development=true;continue;}assert(process.argv[i]==='--output'&&process.argv[i+1]&&!args.output);args.output=process.argv[++i];}
assert(args.output);const out=path.resolve(args.output),web=path.join(root,'web/dist');await fs.mkdir(out,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...parts)=>execFileSync('git',parts,{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T22g',head:git('rev-parse','HEAD'),dirty:git('status','--porcelain','--untracked-files=all'),
 development:!!args.development,status:'running',started:new Date().toISOString(),errors:[],httpErrors:[],served:[]};
if(!args.development)assert.equal(report.dirty,'','exact-head demo proof requires a clean checkout');
await fs.copyFile(fileURLToPath(import.meta.url),path.join(out,'executed-demo.mjs'));
let browser,context,page;const seen=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{try{
 const name=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(name==='/favicon.ico'){res.writeHead(204).end();return;}
 const source=name.startsWith('/releases/')?path.join(root,'web'):web;
 const file=path.resolve(source,'.'+name);assert(file.startsWith(source+path.sep));const bytes=await fs.readFile(file),digest=sha(bytes);
 assert(!seen.has(name)||seen.get(name).sha256===digest,'served asset changed');
 if(!seen.has(name)){const ref={path:name,source:path.relative(root,source),bytes:bytes.length,sha256:digest};seen.set(name,ref);report.served.push(ref);}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
  'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
}catch(error){res.writeHead(404).end(String(error));}});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 report.browser=browser.version();context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,sources:true});page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.stack));
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
 await page.goto(origin+'/app.html?noAutoBoot=1&testHooks=1');
 await page.waitForFunction(()=>globalThis.__ready===true&&!document.querySelector('#suite-run')?.disabled,null,{timeout:60000});
 await page.locator('#suite-run').click();
 await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent.trim()==='127'&&!document.querySelector('#suite-run')?.disabled,null,{timeout:180000});
 report.suite=await page.evaluate(()=>({passed:Number(document.querySelector('#metric-pass').textContent),failed:Number(document.querySelector('#metric-fail').textContent)}));
 assert.deepEqual(report.suite,{passed:127,failed:0});
 await page.locator('#streamed-replay-panel summary').click();
 await page.locator('#streamed-replay-run').click();
 await page.waitForFunction(()=>!!globalThis.__streamedReplayReport,null,{timeout:120000});
 report.probe=await page.evaluate(()=>globalThis.__streamedReplayReport);
 assert.equal(report.probe.status,'passed',report.probe.failure);assert.equal(report.probe.attacks.length,6);
 report.panelPip=await page.locator('#streamed-replay-pip').getAttribute('class');
 report.roadmapPip=await page.locator('.cap').filter({hasText:'Bounded native replay handoff'}).locator('.cap-pip').getAttribute('class');
 assert(report.panelPip.split(/\s+/).includes('live')&&report.roadmapPip.split(/\s+/).includes('live'));
 await page.locator('#streamed-replay-panel').screenshot({path:path.join(out,'desktop.png')});
 await page.setViewportSize({width:390,height:844});
 report.mobile=await page.locator('#streamed-replay-panel').evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth}));
 assert(report.mobile.scroll<=report.mobile.width+1);
 await page.locator('#streamed-replay-panel').screenshot({path:path.join(out,'mobile.png')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);
 for(const ref of report.served)assert.equal(sha(await fs.readFile(path.join(root,ref.source,ref.path))),ref.sha256,'asset changed after serve');
 if(!args.development)assert.equal(git('status','--porcelain','--untracked-files=all'),'','checkout changed during proof');
 report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;
 await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
}finally{
 await context?.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});await browser?.close();
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
}
