import fs from 'node:fs/promises';import path from 'node:path';import {createServer} from 'node:http';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),options={};for(let i=2;i<process.argv.length;i+=2){if(!['--output','--web-root'].includes(process.argv[i])||!process.argv[i+1]||options[process.argv[i]])throw Error('arguments');options[process.argv[i]]=process.argv[i+1];}if(!options['--output'])throw Error('--output required');const fixture='production-gpu-session-branch',out=path.resolve(options['--output']),web=path.resolve(root,options['--web-root']??'web/dist');await fs.mkdir(out);
const app=await fs.access(path.join(web,'app.html')).then(()=>'app.html',()=>'index.html');
const sha=b=>createHash('sha256').update(b).digest('hex'),kernel=await fs.readFile(path.join(root,'guest/prebuilt/'+fixture+'.bin')),block=Buffer.alloc(262144),blockHash=sha(block),image=JSON.stringify({version:1,image_len:block.length,chunk_size:block.length,layout:'split',chunks:[blockHash]});
const report={task:'E9-T20',scope:'Real original-MMIO two-wave GPU/disk/network branch proof; Linux file and desktop proof are separate',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),out,web,errors:[],requests:[],status:'running',started:new Date().toISOString()};let browser,context,page,replayPhase=false;report.replayRequests=[];report.replayExternalRequests=[];report.replaySockets=[];report.counter={opens:0,frames:[],replayCalls:0};
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(replayPhase)report.replayRequests.push(name);let bytes,mime='application/octet-stream';
if(req.method==='POST'){
 const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts);
 if(name==='/__counter__/open'){report.counter.opens++;if(replayPhase)report.counter.replayCalls++;res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({open:report.counter.opens}));return;}
 if(name==='/__counter__/send'){if(replayPhase)report.counter.replayCalls++;if(body.length!==64||body.subarray(14,32).toString()!=='E9_BRANCH_COUNTER_')throw Error('not a guest counter frame');const letter=String.fromCharCode(body[32]),index=report.counter.frames.length;await fs.writeFile(path.join(out,'counter-'+index+'.bin'),body);report.counter.frames.push({letter,sha256:sha(body)});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({count:index+1,sha256:sha(body)}));return;}
 if(!/^\/__proof__\/(past|P|A|B)\.resume$/.test(name))throw Error('proof path');await fs.writeFile(path.join(out,path.basename(name)),body);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({bytes:body.length,sha256:sha(body)}));return;
}
if(name==='/favicon.ico'){res.writeHead(204).end();return;}
if(name==='/'){bytes=Buffer.from('<!doctype html><canvas id="display" width="64" height="64"></canvas><pre id="serial"></pre>');mime='text/html';}
else if(name==='/app.html'){bytes=await fs.readFile(path.join(web,app));mime='text/html';}
else if(name==='/kernel.bin')bytes=kernel;else if(name==='/image.json'){bytes=Buffer.from(image);mime='application/json';}
else if(name==='/zero.bin')bytes=block;else if(name==='/__verify__/branch-attacks.mjs'){bytes=await fs.readFile(path.join(root,'tools/verify/e9-branch-gpu-attacks.mjs'));mime='text/javascript';}else if(name==='/__verify__/branch-context-loss-worker.mjs'){bytes=await fs.readFile(path.join(root,'tools/verify/e9-branch-context-loss-worker.mjs'));mime='text/javascript';}else{const file=path.resolve(web,'.'+decodeURIComponent(name));if(!file.startsWith(web+path.sep))throw Error('path');bytes=await fs.readFile(file);mime=({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'})[path.extname(file)]??mime;}
res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
}catch(error){report.requests.push({url:req.url,error:String(error)});res.writeHead(404).end(String(error));}});
report.fixture=JSON.parse(await fs.readFile(path.join(root,'guest/prebuilt/'+fixture+'.json'),'utf8'));if(report.fixture.sha256!==sha(kernel)||report.fixture.bytes!==kernel.length)throw Error('guest fixture identity');
await fs.copyFile(new URL(import.meta.url),path.join(out,'executed-browser-check.mjs'));
await fs.copyFile(path.join(root,'tools/verify/e9-branch-gpu-attacks.mjs'),path.join(out,'executed-browser-attacks.mjs'));
await fs.copyFile(path.join(root,'tools/verify/e9-branch-context-loss-worker.mjs'),path.join(out,'executed-context-loss-observer.mjs'));
try{
await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});report.browser=browser.version();context=await browser.newContext();await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();await page.exposeFunction('__retain',async(name,bytes)=>{if(!/^(chunks\/[0-9a-f]{64}\.bin|storage\.json)$/.test(name))throw Error('artifact name');const dest=path.join(out,'saved',name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,Uint8Array.from(bytes));});page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());else if(!m.text().startsWith('Replaying'))console.log(m.text());});page.on('pageerror',e=>report.errors.push(e.stack));page.on('request',request=>{if(replayPhase&&/^https?:/.test(request.url())&&new URL(request.url()).origin!=='http://127.0.0.1:'+server.address().port)report.replayExternalRequests.push(request.url());});page.on('websocket',socket=>{if(replayPhase)report.replaySockets.push(socket.url());});await page.goto('http://127.0.0.1:'+server.address().port+'/');
console.log('construct');report.start=await page.evaluate(async(layeredExpected)=>{
const {default:init,WasmLinux}=await import('/pkg/wasm_vm_wasm.js');await init();const {SessionStore}=await import('/session-store.js'),{SessionGpuJournal}=await import('/session-gpu-journal.js'),{attachProductionVirgl,createWorkerScanoutPresenter}=await import('/renderer/virgl-command/production.mjs'),{PresentationController}=await import('/src/sink/presentation.js'),{checkpointHash}=await import('/session-checkpoints.js'),build=await import('/gpu-checkpoint-build.js');
const kernel=new Uint8Array(await(await fetch('/kernel.bin')).arrayBuffer()),manifest=await(await fetch('/image.json')).text(),wasm=new Uint8Array(await(await fetch('/pkg/wasm_vm_wasm_bg.wasm')).arrayBuffer()),rendererBytes=new Uint8Array(await(await fetch('/gpu-checkpoint-build.js')).arrayBuffer());
let serial='';const vm=WasmLinux.newExactGpuSession(kernel,manifest,'console=ttyS0',bytes=>{serial+=new TextDecoder().decode(bytes);document.querySelector('#serial').textContent=serial;},false);vm.enableJit(2);
const presentation=new PresentationController(document.querySelector('#display'),{scheduleFrames:false});let presenter;presenter=createWorkerScanoutPresenter(frame=>{if(frame.type==='clear'){presentation.clear();return;}if(frame.type==='invalidate'){presentation.invalidate();return;}const before=presentation.snapshot().drawnPresents;const accepted=presentation.present(frame),after=presentation.snapshot();queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,accepted&&after.drawnPresents>before?'drawn':'failed'));});
const owners=[];const attach=vm.attachVirgl.bind(vm);vm.attachVirgl=(...args)=>{const cb=args[3];args[3]=event=>{if(event.ownedTransport)owners.push({cap:event.ownedTransport,event});return cb(event);};return attach(...args);};
const gpu=await attachProductionVirgl(vm,{presenter});vm.enableGpuCommandTrace();const config={version:1,runtime:'rv64-linux-gpu-exact-session-v1',exactGpuSession:1,providersComplete:true,ramMib:1024,bootargs:'console=ttyS0',clock:{mode:'icount',divider:64,timebase_hz:'10000000',interactive:null},kernel:{url:new URL('/kernel.bin',location).href,sha256:checkpointHash(kernel),length:String(kernel.length)},wasm:{url:new URL('/pkg/wasm_vm_wasm_bg.wasm',location).href,sha256:checkpointHash(wasm),length:String(wasm.length)},renderer:{url:new URL('/gpu-checkpoint-build.js',location).href,sha256:checkpointHash(rendererBytes),length:String(rendererBytes.length),buildId:build.GPU_CHECKPOINT_BUILD_ID},profile:gpu.checkpointProfile(),devices:JSON.parse(vm.exactGpuSessionTopology()),imageManifest:manifest,timeEntropyPolicy:vm.sessionSourcePolicy(),deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
const store=await SessionStore.open('wasm-vm-sessions-v1-e9-gpu-c-smoke'),writer=await store.writer('gpu-smoke'),captureFault={rejectNext:false,rejected:0},journal=await SessionGpuJournal.create(store,{id:writer.id,put:(...args)=>writer.put(...args),publish:(bytes,authorize)=>writer.publish(bytes,()=>{authorize?.();if(captureFault.rejectNext){captureFault.rejectNext=false;captureFault.rejected++;throw Error('intentional critic keyframe publication abort');}})},config,vm,gpu);window.p={layeredExpected,captureFault,batches:[],vm,gpu,presentation,presenter,owners,store,writer,journal,config,get serial(){return serial;},states:[vm.exactGpuSessionWitness()]};return{config,position:vm.inputPosition(),gpu:gpu.inspect()};},false);
if(!report.start.gpu.profile.identity||/SwiftShader|llvmpipe|software/i.test(report.start.gpu.profile.identity))throw Error('physical GPU unavailable');
console.log('Recording the two GPU waves and witnessed guest sends');
report.run=await page.evaluate(async()=>{
 const p=window.p,{encodeNetworkEvent}=await import('/session-network.js'),{gpuHex}=await import('/session-gpu-replay-format.js');
 p.bodies=[];p.events=[];
 const collect=async()=>{
  const batch=p.vm.takeExactGpuBatch();if(!batch.events.length)return;
  p.events.push(...batch.events.map(row=>({...row,bytes:[...row.bytes]})));
  p.bodies.push(...batch.payloads.map(body=>({sha256:gpuHex(body.sha256),length:body.length})));
  p.journal.stage(batch);await p.journal.flush();
 };
 const connect=p.vm.exactLeaseNetworkRequest('');
 try{const response=await fetch('/__counter__/open',{method:'POST'});if(!response.ok)throw Error('counter open');p.vm.exactCompleteNetworkEvent(connect,encodeNetworkEvent(3,{id:'1'}));}finally{connect.free();}
 await collect();
 const external=async()=>{
  for(const request of p.vm.exactDeviceRequests()){
   if(request.intent.kind!=='block')throw Error('unavailable device');const bytes=new Uint8Array(await(await fetch('/zero.bin')).arrayBuffer()),lease=p.vm.exactLeaseDeviceRequest(request.id);
   try{p.vm.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}
  }
  for(const request of p.vm.exactNetworkRequests()){
   const lease=p.vm.exactLeaseNetworkRequest(request.id);
   try{const response=await fetch('/__counter__/send',{method:'POST',body:request.frame});if(!response.ok)throw Error('counter send');p.vm.exactCompleteNetworkEvent(lease,encodeNetworkEvent(1,{id:request.id,payload:request.frame}));}finally{lease.free();}
  }
  await collect();
 };
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));let calls=0;
 const runUntil=async marker=>{
  while(!p.serial.includes(marker)){
   if(++calls>2000)throw Error('guest work bound: '+p.serial);await external();const result=p.vm.runChunk(10000);if(result.done)throw Error('guest stopped');await collect();
   for(let poll=0;p.gpu.inspect().pending&&poll<5000;poll++){const result=p.gpu.pump();if(!result.ok)throw Error('physical GPU failure');await tick();}
   if(p.gpu.inspect().pending)throw Error('physical GPU deadline');await external();
   if(p.serial.includes('SESSION_FAIL'))throw Error(p.serial);
  }
 };
 await runUntil('BRANCH_READY');await collect();const frame=await p.journal.captureKeyframe(p.vm,p.gpu,'before-gpu-change');p.states.push(frame);p.past=p.vm.inputPosition();
 p.vm.sendInput(new TextEncoder().encode('P\n'));await collect();await runUntil('BRANCH_GPU_DONE_P');await external();
 const end=p.vm.exactGpuSessionWitness();p.states.push(end);await p.journal.completeExact(end,p.states);await p.writer.release();
 const result={past:p.past,end:{...end,digest:[...end.digest]},serial:p.serial,bodies:p.bodies,events:p.events,trace:JSON.parse(p.vm.gpuCommandTrace()),pixel:[...document.querySelector('#display').getContext('2d').getImageData(32,32,1,1).data],physical:p.gpu.inspect()};
 p.gpu.dispose();p.vm.free();return result;
});
if(JSON.stringify(report.run.pixel)!=='[255,0,0,255]')throw Error('parent physical red frame');
if(report.counter.opens!==1||report.counter.frames.map(frame=>frame.letter).join(',')!=='S,P')throw Error('original independent counter');
console.log('Opening the actual timeline and past GPU checkpoint');replayPhase=true;
await page.evaluate(async()=>{
 const p=window.p,{mountSessionTimeline}=await import('/session-timeline.js'),{checkpointHash}=await import('/session-checkpoints.js');
 const dom=new DOMParser().parseFromString(await(await fetch('/app.html')).text(),'text/html'),panel=document.importNode(dom.querySelector('#session-timeline'),true);document.body.append(panel);
 const timeline=await mountSessionTimeline(panel,{store:p.store});window.branchProof={timeline,store:p.store,parent:'gpu-smoke',checkpointHash,children:{}};
 await timeline.open();const result=await timeline.request(()=>timeline.owner.controller.seekPosition(p.past));if(result.status!=='ready')throw Error(timeline.snapshot.status);
});
const c=key=>page.locator('#session-timeline [data-timeline="'+key+'"]');
const retain=async label=>page.evaluate(async label=>{
 const t=branchProof.timeline,selected=await t.owner.controller.captureSelectedBranch(),opened=await branchProof.store.openSession(t.owner.id);
 const response=await fetch('/__proof__/'+label+'.resume',{method:'POST',body:selected.capture.native});if(!response.ok)throw Error('raw capture retention');
 return {id:t.owner.id,active:t.active,position:selected.position,console:t.c.console.textContent,pixel:[...t.owner.controller.selected.rendered.canvas.getContext('2d').getImageData(32,32,1,1).data],manifestSha256:branchProof.checkpointHash(opened.manifest),capture:await response.json()};
},label);
report.past=await retain('past');
await page.evaluate(async()=>{const t=branchProof.timeline,result=await t.request(()=>t.owner.controller.seekPosition(t.owner.manifest.end));if(result.status!=='ready')throw Error(t.snapshot.status);});report.parent=await retain('P');
await page.evaluate(async()=>{const t=branchProof.timeline;await t.request(()=>t.owner.controller.seekPosition(p.past));});
report.children=[];let denyWasm=false,wasmAttempts=0;
await page.route('**/pkg/wasm_vm_wasm_bg.wasm',async route=>{if(denyWasm){wasmAttempts++;await route.abort();}else await route.continue();});
for(const letter of ['A','B']){
 console.log('GPU continuation '+letter);denyWasm=true;
 await c('branch-create').click();await page.waitForFunction(()=>branchProof.timeline.active?.continuation||branchProof.timeline.root.dataset.state==='error'&&!branchProof.timeline.branchCreation,null,{timeout:180000});
 const created=await page.evaluate(()=>({active:branchProof.timeline.active,status:branchProof.timeline.snapshot.status}));if(!created.active?.continuation)throw Error(JSON.stringify(created));
 denyWasm=false;if(wasmAttempts)throw Error('new continuation fetched its Wasm URL');
 await c('branch-input').fill(letter);await c('branch-send').click();await c('branch-run').click();
 await page.waitForFunction(letter=>branchProof.timeline.c.console.textContent.includes('BRANCH_GPU_DONE_'+letter)||branchProof.timeline.root.dataset.state==='error',letter,{timeout:180000});
 if(!(await c('console').textContent()).includes('BRANCH_GPU_DONE_'+letter))throw Error(await c('status').textContent());
 await c('branch-pause').click();await page.waitForFunction(()=>!branchProof.timeline.branchRunning&&!branchProof.timeline.branchRun);
 await c('branch-live').click();await page.waitForFunction(()=>/Historical connections stay offline/.test(branchProof.timeline.snapshot.status));
 const saved=await page.evaluate(()=>({id:branchProof.timeline.branch.id,active:branchProof.timeline.active,refusal:branchProof.timeline.snapshot.status}));
 await c('branch-save').click();await page.waitForFunction(id=>branchProof.timeline.owner?.id===id&&!branchProof.timeline.operation&&!branchProof.timeline.branchBusy,saved.id,{timeout:180000});
 await page.evaluate(async()=>{const t=branchProof.timeline,result=await t.request(()=>t.owner.controller.seekPosition(t.owner.manifest.end));if(result.status!=='ready')throw Error(t.snapshot.status);});
 const reopened=await retain(letter);if(saved.active.digest!==reopened.active.digest)throw Error('child exact digest differs after reopen');
 const expected=letter==='A'?[0,0,255,255]:[0,255,0,255];if(JSON.stringify(reopened.pixel)!==JSON.stringify(expected))throw Error('child physical color differs');
 report.children.push({letter,saved,reopened});
 await page.evaluate(async({letter,id,parentSha})=>{
  branchProof.children[letter]=id;const t=branchProof.timeline;if(branchProof.checkpointHash((await branchProof.store.openSession(branchProof.parent)).manifest)!==parentSha)throw Error('parent history changed');
  await t.refresh(branchProof.parent);await t.open();const result=await t.request(()=>t.owner.controller.seekPosition(p.past));if(result.status!=='ready')throw Error(t.snapshot.status);
 },{letter,id:saved.id,parentSha:report.parent.manifestSha256});
}
console.log('Injecting bounded GPU journal, paint and cancellation faults');
report.attacks=await page.evaluate(async()=>{const {gpuBranchAttacks}=await import('/__verify__/branch-attacks.mjs');return gpuBranchAttacks(branchProof);});
console.log('Reloading GPU relatives and deleting shared ancestors');
const family={parent:report.parent.id,children:Object.fromEntries(report.children.map(child=>[child.letter,child.saved.id]))};
await page.evaluate(async()=>{branchProof.timeline.close();await branchProof.store.close();});await page.reload();
report.reloaded=await page.evaluate(async({parent,children})=>{
 const {SessionStore}=await import('/session-store.js'),{openTimelineReplay}=await import('/session-timeline-runtime.js'),{checkpointHash}=await import('/session-checkpoints.js');
 const store=await SessionStore.open('wasm-vm-sessions-v1-e9-gpu-c-smoke'),results=[];
 const reopen=async(id,afterDeletion=false)=>{const replay=await openTimelineReplay({store,id});try{
  const selected=await replay.controller.seekPosition(replay.manifest.end);if(selected.status!=='ready')throw Error('GPU reload failed');
  const view=replay.controller.selected.rendered;results.push({id,afterDeletion,digest:view.digest,pixel:[...view.canvas.getContext('2d').getImageData(32,32,1,1).data],manifestSha256:checkpointHash((await store.openSession(id)).manifest)});
 }finally{replay.controller.close();}};
 try{for(const id of [children.B,children.A,parent])await reopen(id);await store.deleteSession(parent);await store.deleteSession(children.A);await reopen(children.B,true);return results;}finally{await store.close();}
},family);
for(const row of report.reloaded){const expected=row.id===report.parent.id?report.parent:report.children.find(child=>child.saved.id===row.id).reopened;
 if(row.digest!==expected.active.digest||row.manifestSha256!==expected.manifestSha256||JSON.stringify(row.pixel)!==JSON.stringify(expected.pixel))throw Error('GPU state changed across reload or ancestor deletion');}
if(report.counter.opens!==1||report.counter.frames.map(frame=>frame.letter).join(',')!=='S,P'||report.counter.replayCalls)throw Error('duplicate external side effect');
if(report.errors.length||report.requests.length||report.replayExternalRequests.length||report.replaySockets.length)throw Error('browser console/HTTP/replay egress errors');
if(report.replayRequests.some(name=>['/kernel.bin','/zero.bin','/image.json'].includes(name)))throw Error('replay fetched guest assets from the original source URL');
report.retainedWasm={urlUnavailableDuringCreation:true,attempts:wasmAttempts};report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;report.ui=await page?.evaluate(()=>window.branchProof?{snapshot:branchProof.timeline.snapshot,console:branchProof.timeline.c.console.textContent}:null).catch(()=>null);console.log(error.stack);process.exitCode=1;}
finally{await page?.screenshot({path:path.join(out,'screen.png'),fullPage:true});await context?.tracing.stop({path:path.join(out,'browser-trace.zip')});await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,out,failure:report.failure}));}
