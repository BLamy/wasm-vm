#!/usr/bin/env node
import assert from 'node:assert/strict';
import {prepareSourceCapture,finishSourceCapture,closeSourceCapture,inspectSourcePrefix,realCryptoFailure} from './e9-time-entropy-persistence.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),arg=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
assert.ok(arg('--output'));const output=path.resolve(arg('--output')),development=process.argv.includes('--development'),remote=arg('--url');if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const web=path.join(root,development?'web':'web/dist'),sha=b=>createHash('sha256').update(b).digest('hex');
const report={task:'E9-T11',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),checks:{},errors:[],lifecycle:[]};
await fs.mkdir(output,{recursive:false});let server,context,page;const coverage=[];
const save=(name,value)=>fs.writeFile(path.join(output,name),typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
const instrument=async p=>{await p.coverage.startJSCoverage({resetOnNavigation:false});p.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});p.on('pageerror',e=>report.errors.push(e.message));};
async function artifacts(data,label){
 await fs.mkdir(path.join(output,label));const write=async(name,values)=>{const bytes=typeof values==='string'?values:Uint8Array.from(values);await save(label+'/'+name,bytes);return{file:label+'/'+name,bytes:bytes.length,sha256:sha(bytes)};};
 for(const[key,name]of [['initialFrame','initial.resume'],['pausedFrame','paused.resume'],['finalFrame','record.resume'],['tape','record.observations'],['guestBytes','record.uart.bin'],['trace','record.trace']])data[key]=await write(name,data[key]);
 for(const r of data.replays){r.frame=await write(`replay-q${r.quantum}.resume`,r.frame);r.guestBytes=await write(`replay-q${r.quantum}.uart.bin`,r.guestBytes);r.trace=await write(`replay-q${r.quantum}.trace`,r.trace);}
 for(let i=0;i<data.refusals.length;i++)if(data.refusals[i].tape)data.refusals[i].tape=await write(`refusal-${i}.observations`,data.refusals[i].tape);
 for(const r of data.unavailable)r.tape=await write(`unavailable-${r.hostMode}.observations`,r.tape);
 await save(label+'/probe.json',data);return data;
}
try{
 if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
 if(!remote){const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
  server=createServer(async(request,response)=>{try{let p=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(p==='/favicon.ico'){response.writeHead(204).end();return;}if(development&&p==='/app.html')p='/index.html';const file=path.resolve(web,'.'+p);if(!file.startsWith(web+path.sep))throw Error('path');const bytes=await fs.readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);}catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));}
 report.url=new URL('app.html?noAutoBoot&testHooks=1',remote||`http://127.0.0.1:${server.address().port}/`).href;
 context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0]??await context.newPage();await instrument(page);await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 const cdp=await context.newCDPSession(page);await page.exposeFunction('__freezeSourceProof',async()=>{const started=Date.now();await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await new Promise(resolve=>setTimeout(resolve,220));await cdp.send('Page.setWebLifecycleState',{state:'active'});report.lifecycle.push({state:'frozen/active',milliseconds:Date.now()-started});});await page.evaluate(()=>{globalThis.__timeEntropyPausedHook=()=>globalThis.__freezeSourceProof();});
 if(remote){report.assets=[];for(const name of ['app.html','main.js','time-entropy-probe.js','session-inputs.js','session-library.js','session-store.js','session-checkpoints.js','loader.js','linux-worker-protocol.js','roadmap.js','gpu-checkpoint-build.js','tasks.json','assets/e9-time-entropy.bin','assets/e9-time-entropy.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){const r=await context.request.get(new URL(name,remote).href);assert.equal(r.status(),200,name);const b=await r.body();assert.equal(sha(b),sha(await fs.readFile(path.join(web,name))),name);report.assets.push({name,bytes:b.length,sha256:sha(b)});}}
 console.log('Built page suite and actual frozen/resumed RTC/RNG guest');await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.checks.suite,{passed:127,failed:0});
 await page.locator('#time-entropy-panel summary').click();await page.locator('#time-entropy-run').click();await page.waitForFunction(()=>!!globalThis.__timeEntropyReport,null,{timeout:120000});
 const data=await page.evaluate(()=>{const plain=value=>value instanceof Uint8Array?[...value]:Array.isArray(value)?value.map(plain):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;return plain(globalThis.__timeEntropyReport);});assert.equal(data.status,'passed',data.failure);assert.equal(data.replays.length,3);assert.equal(data.refusals.length,7);assert.equal(data.unavailable.length,2);assert.equal(report.lifecycle.length,1);
 report.checks.probe=await artifacts(data,'probe');assert.match(await page.locator('#time-entropy-pip').getAttribute('class'),/\blive\b/);assert.match(await page.locator('.cap',{hasText:'Guest time and entropy recording'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 await page.locator('#time-entropy-panel').screenshot({path:path.join(output,'time-entropy-desktop.png')});await page.setViewportSize({width:390,height:844});report.checks.mobile=await page.locator('#time-entropy-panel').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(report.checks.mobile.scroll<=report.checks.mobile.width+1);await page.locator('#time-entropy-panel').screenshot({path:path.join(output,'time-entropy-mobile.png')});
 await page.setViewportSize({width:1440,height:1000});
 console.log('Rechecking prior event-clock and input adapters against the new Wasm');
 await page.locator('#event-clock-panel summary').click();await page.locator('#event-clock-run').click();await page.waitForFunction(()=>!!globalThis.__eventClockReport,null,{timeout:120000});
 const clock=await page.evaluate(()=>{const r=__eventClockReport;return{...r,frames:r.frames?.map(f=>({...f,bytes:[...f.bytes]}))};});assert.equal(clock.status,'passed',clock.failure);
 await fs.mkdir(path.join(output,'event-clock-regression'));for(const f of clock.frames)await save('event-clock-regression/'+f.name+'.resume',Uint8Array.from(f.bytes));for(const t of clock.traces)await save('event-clock-regression/'+t.name+'.trace',t.text);
 await save('event-clock-regression/probe.json',{...clock,frames:clock.frames.map(f=>({name:f.name,bytes:f.bytes.length,sha256:sha(Uint8Array.from(f.bytes))}))});report.checks.eventClock={cases:clock.cases.length,refusals:clock.refusals.length};assert.deepEqual(report.checks.eventClock,{cases:16,refusals:10});
 await page.locator('#input-recording-panel summary').click();await page.locator('#input-recording-run').click();await page.waitForFunction(()=>!!globalThis.__inputRecordingReport,null,{timeout:120000});
 const input=await page.evaluate(()=>{const r=__inputRecordingReport;return{...r,initial:{native:[...r.initial.native],disk:[...r.initial.disk]},guestBytes:[...r.guestBytes],receipts:r.receipts.map(x=>({...x,bytes:[...x.bytes]}))};});assert.equal(input.status,'passed',input.failure);assert.equal(input.receipts.length,24);assert.equal(input.refusals.length,15);assert.equal(input.gatedMutations.length,24);await save('input-regression.json',input);report.checks.input={receipts:input.receipts.length,refusals:input.refusals.length,gatedMutations:input.gatedMutations.length};
 console.log('Recording actual Web Crypto failure and zero-provider replay');report.checks.cryptoFailure=await realCryptoFailure(page,output);
 report.checks.persisted=[];
 for(const worker of [false,true]){
  console.log('Durable time/entropy recording through '+(worker?'whole-machine worker':'direct loader'));
  const boot=await prepareSourceCapture(page,worker);
  try{
   const panel=page.locator('#session-library');if(!await page.locator('[data-session="time-entropy"]').isVisible())await panel.locator('summary').click();
   await page.locator('[data-session="time-entropy"]').check();await page.locator('[data-session="input-start"]').click();
   await page.waitForFunction(()=>!__sessionLibrary.busy,null,{timeout:60000});
   assert.ok(await page.evaluate(()=>__sessionLibrary.inputRecording?.id),await page.locator('[data-session="status"]').innerText());
   const result=await finishSourceCapture(page);assert.equal(result.done,'poweroff');assert.deepEqual(result.errors,[]);assert.ok(result.output.length>=113);const guestOutput=result.output.slice(0,113);const diagnostic=new TextDecoder().decode(Uint8Array.from(result.output.slice(113)));assert.ok(diagnostic===''||/^\r\nstate sha256=[0-9a-f]{64}\r\n$/.test(diagnostic));await save((worker?'worker':'direct')+'-whole-uart.bin',Uint8Array.from(result.output));
   const label=worker?'worker-prefix':'direct-prefix',prefix=await inspectSourcePrefix(page,result.id,output,label);
   assert.deepEqual(prefix.receipts.filter(r=>r.channel===18).map(r=>r.bytes),[guestOutput.slice(64,80),guestOutput.slice(80,113)]);
   assert.equal(prefix.receipts.at(-1).channel,16);assert.deepEqual(prefix.receipts.at(-1).bytes,[2]);if(result.position)assert.equal(prefix.manifest.end.sequence,result.position.sequence);assert.equal(prefix.manifest.end.transition,String(result.kernel.length/4+1));assert.equal(prefix.manifest.end.retired,String(result.kernel.length/4));
   const reloadedPage=await context.newPage();await instrument(reloadedPage);try{
    await reloadedPage.goto(report.url,{waitUntil:'domcontentloaded'});await reloadedPage.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
    const reopened=await inspectSourcePrefix(reloadedPage,result.id,output,label+'-reopened');assert.deepEqual(reopened,prefix);
   }finally{coverage.push(...await reloadedPage.coverage.stopJSCoverage().catch(()=>[]));await reloadedPage.close();}
   await save(label+'/guest.uart.bin',Uint8Array.from(guestOutput));await save(label+'/kernel.bin',Uint8Array.from(result.kernel));
   const summary={...boot,...result,output:{bytes:result.output.length,sha256:sha(Uint8Array.from(result.output))},kernel:{bytes:result.kernel.length,sha256:sha(Uint8Array.from(result.kernel))},receipts:prefix.receipts.length,end:prefix.manifest.end};
   report.checks.persisted.push(summary);await save(label+'/capture.json',summary);
  }finally{await closeSourceCapture(page);}
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(page&&!page.isClosed())coverage.push(...await page.coverage.stopJSCoverage().catch(()=>[]));await save('javascript-coverage.json',coverage);
 if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context?.close();if(server)await new Promise(resolve=>server.close(resolve));report.finished=new Date().toISOString();await save('report.json',report);console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure,lifecycle:report.lifecycle}));
}
