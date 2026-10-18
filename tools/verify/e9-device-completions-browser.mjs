#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),arg=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
assert.ok(arg('--output'));const output=path.resolve(arg('--output')),development=process.argv.includes('--development'),remote=arg('--url');if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const web=path.join(root,development?'web':'web/dist'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={task:'E9-T12',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),errors:[],checks:{},profile:'ephemeral derived browser caches; authoritative Playwright trace, guest traces, complete frames and owned durable objects exported below'};
await fs.mkdir(output,{recursive:false});let server,browser,context,page;
const save=(name,value)=>fs.writeFile(path.join(output,name),typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
const artifact=async(name,value)=>{const bytes=typeof value==='string'?Buffer.from(value):Uint8Array.from(value);await save(name,bytes);return{file:name,bytes:bytes.length,sha256:sha(bytes)};};
try{
 if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
 if(!remote){const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
  server=createServer(async(request,response)=>{try{let p=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(p==='/favicon.ico'){response.writeHead(204).end();return;}if(development&&p==='/app.html')p='/index.html';const file=path.resolve(web,'.'+p);if(!file.startsWith(web+path.sep))throw Error('path');const bytes=await fs.readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);}catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));}
 report.url=new URL('app.html?noAutoBoot&testHooks=1',remote||`http://127.0.0.1:${server.address().port}/`).href;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();await page.coverage.startJSCoverage({resetOnNavigation:false});
 page.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 report.assets=[];for(const name of ['app.html','main.js','device-completions-probe.js','session-devices.js','session-inputs.js','roadmap.js','gpu-checkpoint-build.js','assets/e9-device-completions.bin','assets/e9-device-completions.elf','assets/e9-device-completions.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){
  const target=development&&name==='app.html'?'index.html':name,response=await context.request.get(new URL(name,new URL('./',report.url)).href);assert.equal(response.status(),200,name);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,target))),name);report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }
 console.log('Built page suite and real block/agent/capture guest');if(!process.argv.includes('--probe-only')){await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.checks.suite,{passed:127,failed:0});}else assert.ok(development,'probe-only is an implementation precheck');
 const panel=page.locator('#device-completions-panel');await panel.locator('summary').focus();await page.keyboard.press('Enter');await page.locator('#device-completions-run').click();await page.waitForFunction(()=>!!globalThis.__deviceCompletionsReport,null,{timeout:180000});
 const data=await page.evaluate(()=>{const plain=value=>value instanceof Uint8Array?[...value]:Array.isArray(value)?value.map(plain):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;return plain(globalThis.__deviceCompletionsReport);});await save('probe-raw-result.json',data.status==='failed'?data:{status:data.status});assert.equal(data.status,'passed',data.failure);
 for(const[key,name]of [['initial','initial.resume'],['pending','pending.resume'],['final','final.resume'],['guest','guest.bin'],['trace','original.trace']])data[key]=await artifact(name,data[key]);
 for(const replay of data.replays){replay.frame=await artifact(`replay-${replay.quantum}.resume`,replay.frame);replay.trace=await artifact(`replay-${replay.quantum}.trace`,replay.trace);}
 for(const[index,receipt]of data.receipts.entries())receipt.bytes=await artifact(`completion-${index}.bin`,receipt.bytes);
 data.persisted.manifest=await artifact('manifest.json',data.persisted.manifest);await fs.mkdir(path.join(output,'objects'));
 for(const object of data.persisted.objects){const bytes=Uint8Array.from(object.bytes);assert.equal(sha(bytes),object.ref.sha256);assert.equal(String(bytes.length),object.ref.length);object.bytes=await artifact('objects/'+object.ref.sha256,bytes);}
 await save('probe.json',data);report.checks.probe={receipts:data.receipts.length,replays:data.replays.length,refusals:data.refusals.length,baseReferences:data.baseReferences};assert.equal(data.receipts.length,4);assert.equal(data.replays.length,3);assert.equal(data.refusals.length,5);
 assert.match(await page.locator('#device-completions-pip').getAttribute('class'),/\blive\b/);assert.match(await page.locator('.cap',{hasText:'Owned device completion recording'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 await panel.screenshot({path:path.join(output,'desktop.png')});await page.setViewportSize({width:390,height:844});report.checks.mobile=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(report.checks.mobile.scroll<=report.checks.mobile.width+1);await panel.screenshot({path:path.join(output,'mobile.png')});await page.setViewportSize({width:1440,height:1000});
 console.log('Regression probes for shared event/input journal');
 if(!process.argv.includes('--probe-only'))for(const[id,key]of [['time-entropy','__timeEntropyReport'],['input-recording','__inputRecordingReport']]){
  await page.locator('#'+id+'-panel summary').click();await page.locator('#'+id+'-run').click();await page.waitForFunction(key=>!!globalThis[key],key,{timeout:180000});const result=await page.evaluate(key=>({status:globalThis[key].status,failure:globalThis[key].failure}),key);assert.equal(result.status,'passed',result.failure);report.checks[id]=result;
 }
 const reopened=await context.newPage();try{await reopened.goto(report.url,{waitUntil:'domcontentloaded'});await reopened.waitForFunction(()=>window.__ready===true,null,{timeout:60000});report.checks.reload=await reopened.evaluate(async()=>{const{SessionStore}=await import('./session-store.js'),{SessionInputJournal}=await import('./session-inputs.js'),{DEVICE_PROBE_DATABASE}=await import('./device-completions-probe.js');const store=await SessionStore.open(DEVICE_PROBE_DATABASE);try{const value=await SessionInputJournal.read(store,'device-prefix');return{receipts:value.receipts.length,end:value.manifest.end};}finally{await store.close();}});assert.equal(report.checks.reload.receipts,4);}finally{await reopened.close();}
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(page&&!page.isClosed())await save('javascript-coverage.json',await page.coverage.stopJSCoverage().catch(()=>[]));if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context?.close();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
 report.finished=new Date().toISOString();report.files=[];const walk=async(dir)=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.isDirectory())await walk(name);else if(name!==path.join(output,'report.json')){const bytes=await fs.readFile(name);report.files.push({path:path.relative(output,name),bytes:bytes.length,sha256:sha(bytes)});}}};await walk(output);await save('report.json',report);console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure}));
}
