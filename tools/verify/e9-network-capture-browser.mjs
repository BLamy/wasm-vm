#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),arg=f=>{const i=process.argv.indexOf(f);return i<0?null:process.argv[i+1];};
assert.ok(arg('--output'));const output=path.resolve(arg('--output')),development=process.argv.includes('--development'),remote=arg('--url');if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const web=path.join(root,development?'web':'web/dist'),sha=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(output,{recursive:false});
const report={task:'E9-T13',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started:new Date().toISOString(),errors:[],checks:{},transportWitness:{scope:'Guest provider HTTP endpoint only; asset fetches and explicit harness artifact exports are separate',counterRequests:0,bridgeRequests:0,browserProviderRequests:0,forbiddenReplayProviderRequests:0,originalListenerClosed:false,changedServerContentServed:0}};
let server,counter,browser,context,page;
const save=(n,b)=>fs.writeFile(path.join(output,n),typeof b==='string'||b instanceof Uint8Array?b:JSON.stringify(b,null,2)+'\n');
const artifact=async(n,b)=>{await save(n,b);return{file:n,bytes:b.length,sha256:sha(b)};};
try{
 if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
 if(!remote){
  counter=createServer((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.url,'/network-probe-response.json');report.transportWitness.counterRequests++;
   const body=Buffer.from(JSON.stringify({count:report.transportWitness.counterRequests,source:'original-counter'})+'\n');
   res.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length,Connection:'close'});res.end(body,()=>counter.close(()=>{report.transportWitness.originalListenerClosed=true;}));
  });await new Promise(r=>counter.listen(0,'127.0.0.1',r));const counterPort=counter.address().port;
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml'};
  server=createServer(async(req,res)=>{try{
   let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p==='/favicon.ico'){res.writeHead(204).end();return;}
   if(p==='/network-probe-response.json'){
    report.transportWitness.bridgeRequests++;
    if(report.transportWitness.bridgeRequests>1){report.transportWitness.changedServerContentServed++;res.writeHead(200,{'Content-Type':'application/json'}).end('{"count":900,"source":"changed-dns-and-server"}\n');return;}
    const request=httpRequest({hostname:'127.0.0.1',port:counterPort,path:p,method:'GET',agent:false},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});request.on('error',()=>res.writeHead(502).end());request.end();return;
   }
   if(development&&p==='/app.html')p='/index.html';const file=path.resolve(web,'.'+p);assert.ok(file.startsWith(web+path.sep));const bytes=await fs.readFile(file);
   res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  }catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 }
 report.url=new URL('app.html?noAutoBoot&testHooks=1',remote||'http://127.0.0.1:'+server.address().port+'/').href;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();await page.coverage.startJSCoverage({resetOnNavigation:false});
 page.on('console',m=>{if(m.type()==='error'&&!(/favicon\.ico$/.test(m.location().url)&&/\b404\b/.test(m.text())))report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(p==='/network-probe-response.json')report.transportWitness.browserProviderRequests++;if(p==='/must-never-open')report.transportWitness.forbiddenReplayProviderRequests++;});
 await page.route('**/__network-proof/**',async route=>{const name=new URL(route.request().url()).pathname.slice('/__network-proof/'.length);assert.match(name,/^[a-zA-Z0-9._/-]+$/);assert.ok(!name.includes('..'));const bytes=route.request().postDataBuffer();const file=path.join(output,name);await fs.mkdir(path.dirname(file),{recursive:true});const result=await artifact(name,bytes);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});});
 await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 report.assets=[];
 for(const name of['app.html','main.js','network-capture-probe.js','session-network.js','session-inputs.js','roadmap.js','assets/e9-network-capture.bin','assets/e9-network-capture.elf','assets/e9-network-capture.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){
  const response=await context.request.get(new URL(name,new URL('./',report.url)).href);assert.equal(response.status(),200,name);const bytes=await response.body();assert.equal(sha(bytes),sha(await fs.readFile(path.join(web,development&&name==='app.html'?'index.html':name))),name);report.assets.push({name,bytes:bytes.length,sha256:sha(bytes)});
 }
 if(!process.argv.includes('--probe-only')){console.log('Built browser ISA suite');await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};assert.deepEqual(report.checks.suite,{passed:127,failed:0});}else assert.ok(development);
 console.log('Real guest network, durable payloads and six offline replays');
 const panel=page.locator('#network-capture-panel');await panel.locator('summary').focus();await page.keyboard.press('Enter');await page.locator('#network-capture-run').click();await page.waitForFunction(()=>!!globalThis.__networkCaptureReport,null,{timeout:180000});
 const data=await page.evaluate(async()=>{
  const data=globalThis.__networkCaptureReport;if(data.status!=='passed')return data;
  const upload=async(name,bytes)=>{const r=await fetch('./__network-proof/'+name,{method:'POST',body:bytes});if(!r.ok)throw Error('proof export');return r.json();};
  const result={...data,replays:[],receipts:[],persisted:{...data.persisted,objects:[]}};
  for(const[key,name]of[['initial','initial.resume'],['pending','pending.resume'],['final','final.resume'],['guest','guest.bin'],['trace','original.trace'],['httpResponse','http-response.bin'],['receiveFrame','receive-frame.bin']])result[key]=await upload(name,data[key]);
  for(const replay of data.replays){const name='replay-'+replay.quantum+'-pending-'+replay.fromPending;result.replays.push({...replay,frame:await upload(name+'.resume',replay.frame),trace:await upload(name+'.trace',replay.trace)});}
  for(const[i,r]of data.receipts.entries())result.receipts.push({...r,bytes:await upload('network-event-'+i+'.bin',r.bytes)});
  result.persisted.manifest=await upload('manifest.json',data.persisted.manifest);
  for(const object of data.persisted.objects)result.persisted.objects.push({ref:object.ref,bytes:await upload('objects/'+object.ref.sha256,object.bytes)});
  return result;
 });await save('probe.json',data);assert.equal(data.status,'passed',data.failure);assert.equal(data.receipts.length,5);assert.equal(data.replays.length,6);assert.equal(data.transport.replayFactories,0);
 for(const object of data.persisted.objects){assert.equal(object.bytes.sha256,object.ref.sha256);assert.equal(String(object.bytes.bytes),object.ref.length);}
 report.checks.probe={receipts:5,replays:6,refusals:data.refusals.length,transport:data.transport};
 assert.match(await page.locator('#network-capture-pip').getAttribute('class'),/\blive\b/);assert.match(await page.locator('.cap',{hasText:'Offline network recording'}).locator('.cap-pip').getAttribute('class'),/\blive\b/);
 await panel.screenshot({path:path.join(output,'desktop.png')});await page.setViewportSize({width:390,height:844});report.checks.mobile=await panel.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(report.checks.mobile.scroll<=report.checks.mobile.width+1);await panel.screenshot({path:path.join(output,'mobile.png')});await page.setViewportSize({width:1440,height:1000});
 console.log('Actual browser translated execution and exact checkpoint batch edges');
 report.checks.jit=await page.evaluate(async()=>{
  const {WasmMachine}=await import('./pkg/wasm_vm_wasm.js'),{checkpointHash}=await import('./session-checkpoints.js'),{encodeNetworkEvent}=await import('./session-network.js');
  const elf=new Uint8Array(await(await fetch('./assets/e9-network-capture.elf')).arrayBuffer()),v=new DataView(elf.buffer);
  [0x001a0a13,0x003a8a93,0x005b0b13,0x007b8b93,0x00bc0c13,0xfedff06f].forEach((w,i)=>v.setUint32(120+(390+i)*4,w,true));
  const fresh=replay=>{const m=new WasmMachine(16);m.loadElf(elf);m.startEventClock(1,1);m.installNetworkSession(replay);m.enableJit(1);return m;};
  const run=(m,target,q)=>{while(BigInt(m.eventPosition().transition)<BigInt(target))m.runEventUntil(String(target),q);};
  const m=fresh(false);let pending;try{run(m,4096,31);const request=m.networkRequests()[0],lease=m.leaseNetworkRequest(request.id);try{m.completeNetworkEvent(lease,encodeNetworkEvent(1,{id:request.id,payload:request.frame}));}finally{lease.free();}m.takeNetworkDeliveries();pending=m.saveEventCheckpoint();}finally{m.free();}
  const rows=[];
  for(const target of[5000,5001,5002]){let expected;for(const quantum of[31,1,8,4096]){const r=fresh(true);try{r.restoreEventCheckpoint(pending);const before=r.jitStats().executedBlocks;run(r,target,quantum);const compiled=r.jitStats().executedBlocks-before;if(quantum>=8&&compiled<=0)throw Error('translated code did not execute');r.finishNetworkReplay('1');const frame=r.saveEventCheckpoint(),hash=checkpointHash(frame);if(expected&&expected!==hash)throw Error('JIT checkpoint drift');expected=hash;
   const gzip=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
   const file='jit/target'+target+'-q'+quantum+'.resume.gz',response=await fetch('./__network-proof/'+file,{method:'POST',body:gzip});if(!response.ok)throw Error('JIT proof export');
   rows.push({target,quantum,compiled,sha256:hash,frame:await response.json(),position:r.eventPosition()});
  }finally{r.free();}}}return rows;
 });assert.equal(report.checks.jit.length,12);
 report.checks.abi=await page.evaluate(async()=>{
  const{WasmMachine}=await import('./pkg/wasm_vm_wasm.js'),{encodeNetworkEvent}=await import('./session-network.js'),{checkpointHash}=await import('./session-checkpoints.js');
  const elf=new Uint8Array(await(await fetch('./assets/e9-network-capture.elf')).arrayBuffer());
  const fresh=replay=>{const m=new WasmMachine(1);m.loadElf(elf);m.startEventClock(1,1);m.installNetworkSession(replay);return m;};
  const m=fresh(false),r=fresh(true),other=fresh(false),results=[];
  const refusal=(name,machine,call)=>{const before=checkpointHash(machine.saveEventCheckpoint());let message;try{call();}catch(e){message=String(e);}if(!message)throw Error('ABI accepted '+name);if(checkpointHash(machine.saveEventCheckpoint())!==before)throw Error('ABI partial mutation '+name);results.push({name,message});};
  try{
   for(const id of['-1','00','1.0','18446744073709551616','abc'])refusal('noncanonical id '+id,m,()=>m.leaseNetworkRequest(id));
   for(const value of[0,1,'false',null])refusal('strict replay boolean '+String(value),m,()=>m.installNetworkSession(value));
   const lease=m.leaseNetworkRequest(''),foreign=other.leaseNetworkRequest('');try{
    const event=encodeNetworkEvent(4,{result:1});
    refusal('foreign callback incarnation',m,()=>m.completeNetworkEvent(foreign,event));
    for(const bytes of[new Uint8Array(),event.subarray(0,9),new Uint8Array(65600)])refusal('malformed envelope length '+bytes.length,m,()=>m.completeNetworkEvent(lease,bytes));
    if(globalThis.SharedArrayBuffer)refusal('shared network envelope',m,()=>m.completeNetworkEvent(lease,new Uint8Array(new SharedArrayBuffer(10))));
    m.restoreEventCheckpoint(m.saveEventCheckpoint());refusal('restored callback incarnation',m,()=>m.completeNetworkEvent(lease,event));
   }finally{lease.free();foreign.free();}
   refusal('replay callback ingress',r,()=>r.leaseNetworkRequest(''));
   for(const ordinal of[-1,0,1.5,'1',NaN,Infinity])refusal('ordinal '+String(ordinal),r,()=>r.replayNetworkEvent('0','0','1',ordinal,encodeNetworkEvent(4)));
   for(const counters of[['00','0','1'],['0','00','1'],['0','0','01'],['18446744073709551616','0','1']])refusal('exact position '+counters.join('/'),r,()=>r.replayNetworkEvent(...counters,1,encodeNetworkEvent(4)));
   refusal('wrong replay position',r,()=>r.replayNetworkEvent('1','0','1',1,encodeNetworkEvent(4)));
   r.replayNetworkEvent('0','0','1',1,encodeNetworkEvent(4));r.takeNetworkDeliveries();refusal('wrong replay end cursor',r,()=>r.finishNetworkReplay('0'));r.finishNetworkReplay('1');
  }finally{m.free();r.free();other.free();}return results;
 });
 const reloaded=await context.newPage();try{await reloaded.goto(report.url,{waitUntil:'domcontentloaded'});await reloaded.waitForFunction(()=>window.__ready===true,null,{timeout:60000});report.checks.reload=await reloaded.evaluate(async()=>{const{SessionStore}=await import('./session-store.js'),{SessionInputJournal}=await import('./session-inputs.js'),{NETWORK_PROBE_DATABASE}=await import('./network-capture-probe.js');const store=await SessionStore.open(NETWORK_PROBE_DATABASE);try{return{receipts:(await SessionInputJournal.read(store,'network-prefix')).receipts.length};}finally{await store.close();}});assert.equal(report.checks.reload.receipts,5);}finally{await reloaded.close();}
 report.checks.missingPayload=await page.evaluate(async()=>{
  const{NETWORK_PROBE_DATABASE}=await import('./network-capture-probe.js'),{SessionStore}=await import('./session-store.js'),{SessionInputJournal}=await import('./session-inputs.js');
  const hash=globalThis.__networkCaptureReport.requiredPayload.sha256;
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(NETWORK_PROBE_DATABASE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['objects'],'readwrite',{durability:'strict'});tx.objectStore('objects').delete(hash);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  const store=await SessionStore.open(NETWORK_PROBE_DATABASE);try{let message;try{await SessionInputJournal.read(store,'network-prefix');}catch(e){message=String(e);}if(!message)throw Error('missing network payload was accepted');return{hash,message};}finally{await store.close();}
 });
 if(!process.argv.includes('--probe-only'))for(const[id,key]of[['device-completions','__deviceCompletionsReport'],['time-entropy','__timeEntropyReport'],['input-recording','__inputRecordingReport']]){
  console.log('Shared journal regression '+id);await page.locator('#'+id+'-panel summary').click();await page.locator('#'+id+'-run').click();await page.waitForFunction(k=>!!globalThis[k],key,{timeout:180000});const r=await page.evaluate(k=>({status:globalThis[k].status,failure:globalThis[k].failure}),key);assert.equal(r.status,'passed',r.failure);report.checks[id]=r;
 }
 assert.equal(report.transportWitness.browserProviderRequests,1);assert.equal(report.transportWitness.forbiddenReplayProviderRequests,0);
 if(!remote){assert.equal(report.transportWitness.counterRequests,1);assert.equal(report.transportWitness.bridgeRequests,1);assert.equal(report.transportWitness.originalListenerClosed,true);assert.equal(report.transportWitness.changedServerContentServed,0);}
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(page&&!page.isClosed())await save('javascript-coverage.json',await page.coverage.stopJSCoverage().catch(()=>[]));if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context?.close();await browser?.close();
 for(const s of[server,counter])if(s?.listening){s.closeAllConnections();await new Promise(r=>s.close(r));}
 report.finished=new Date().toISOString();report.files=[];const walk=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await walk(p);else if(p!==path.join(output,'report.json')){const b=await fs.readFile(p);report.files.push({path:path.relative(output,p),bytes:b.length,sha256:sha(b)});}}};await walk(output);await save('report.json',report);console.log(JSON.stringify({status:report.status,errors:report.errors,failure:report.failure}));
}
