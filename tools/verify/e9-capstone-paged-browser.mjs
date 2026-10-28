#!/usr/bin/env node
// Bounded original-MMIO GPU fixture: paged witnesses + incremental-start replay.
// This is not the frozen Omarchy/Linux/Mesa desktop qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {retainSessionStore} from './e9-retain-session-store.mjs';
import {sealReplayStaticAssets} from './e9-replay-static-assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),web=path.join(root,'web/dist');
const at=process.argv.indexOf('--output');assert(at>=0&&process.argv[at+1]);const out=path.resolve(process.argv[at+1]);await fs.mkdir(out,{recursive:false});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const kernel=await fs.readFile(path.join(root,'guest/prebuilt/production-gpu-session.bin')),
 fixture=JSON.parse(await fs.readFile(path.join(root,'guest/prebuilt/production-gpu-session.json'))),zero=Buffer.alloc(262144);
assert.equal(kernel.length,fixture.bytes);assert.equal(sha(kernel),fixture.sha256);
const image=Buffer.from(JSON.stringify({version:1,image_len:zero.length,chunk_size:zero.length,layout:'split',chunks:[sha(zero)]}));
const sealed=await sealReplayStaticAssets(web),allowed=new Map(sealed.map(row=>[row.name,row]));
const report={task:'E9-T24',scope:'Bounded real MMIO GPU paged/delta proof; not full Omarchy or performance qualification',
 head:git('rev-parse','HEAD'),dirty:git('status','--porcelain'),development:process.argv.includes('--development'),status:'running',
 started:new Date().toISOString(),fixture,sealed,served:[],raw:[],errors:[],external:[],blocked:[],sockets:[],workerFactories:[]};
if(!report.development)assert.equal(report.dirty,'','freeze source before final proof');
let replay=false,browser,context,page;const served=new Set(),workers=new Set();let origin;
const server=createServer(async(req,res)=>{try{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let bytes,type='text/javascript';
 if(name==='/favicon.ico'){res.writeHead(204).end();return;}
 if(name==='/'){bytes=Buffer.from('<!doctype html><title>Bounded paged GPU proof</title><h1>Bounded GPU fixture</h1><p>Not the Omarchy desktop qualification.</p><canvas id="display" width="64" height="64"></canvas><pre id="serial"></pre>');type='text/html';}
 else if(name==='/kernel.bin'){bytes=kernel;type='application/octet-stream';}
 else if(name==='/image.json'){bytes=image;type='application/json';}
 else{const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));bytes=await fs.readFile(file);if(name.endsWith('.wasm'))type='application/wasm';}
 if(replay){const expected=allowed.get(name);assert(expected&&req.method==='GET','unsealed replay request');assert.equal(sha(bytes),expected.sha256);assert.equal(bytes.length,expected.bytes);}
 if(!served.has(name)){served.add(name);report.served.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
 }catch(error){report.errors.push(String(error));res.writeHead(404).end();}});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
 context=await browser.newContext({serviceWorkers:'block'});await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();
 await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());
  if(u.origin!==origin)report.external.push(r.url());
  if(replay&&(u.origin!==origin||r.method()!=='GET'||u.search||!allowed.has(u.pathname))){report.blocked.push(r.url());return route.abort();}
  return route.continue();});
 await context.routeWebSocket('**/*',socket=>{report.sockets.push(socket.url());socket.close();});
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('worker',worker=>{if(new URL(worker.url()).pathname==='/session-gpu-replay-worker.js'){workers.add(worker);worker.on('close',()=>workers.delete(worker));}});
 await page.exposeFunction('__retainPagedState',async(name,encoded)=>{
  assert(/^(?:source|replay)-[0-9]+\.state$/.test(name)&&encoded.length<=48*1048576);const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded);
  const row={file:name,bytes:bytes.length,sha256:sha(bytes)};await fs.writeFile(path.join(out,name),bytes);report.raw.push(row);return row;
 });
 await page.goto(origin+'/');report.browser=await browser.version();
 report.recording=await page.evaluate(async()=>{
  const {default:init,WasmLinux}=await import('/pkg/wasm_vm_wasm.js');await init();
  const {SessionStore}=await import('/session-store.js'),{SessionGpuJournal}=await import('/session-gpu-journal.js');await import('/session-gpu-replay.js');
  const {checkpointHash}=await import('/session-checkpoints.js'),build=await import('/gpu-checkpoint-build.js');
  const {attachProductionVirgl,createWorkerScanoutPresenter}=await import('/renderer/virgl-command/production.mjs');
  const {PresentationController}=await import('/src/sink/presentation.js');
  const need=(v,m)=>{if(!v)throw Error(m);},hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
  const position=p=>Object.fromEntries(['transition','retired','sequence','ordinal','phase'].map(k=>[k,p[k]]));
  const retain=async(name,bytes)=>{let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return __retainPagedState(name,btoa(binary));};
  const kernel=new Uint8Array(await(await fetch('/kernel.bin')).arrayBuffer()),image=await(await fetch('/image.json')).text(),wasm=new Uint8Array(await(await fetch('/pkg/wasm_vm_wasm_bg.wasm')).arrayBuffer()),stamp=new Uint8Array(await(await fetch('/gpu-checkpoint-build.js')).arrayBuffer());
  let serial='';const vm=WasmLinux.newExactGpuSession(kernel,image,'console=ttyS0',b=>{serial+=new TextDecoder().decode(b);document.querySelector('#serial').textContent=serial;},false);vm.enableJit(2);vm.enableGpuCommandTrace();
  const presentation=new PresentationController(document.querySelector('#display'),{scheduleFrames:false});let presenter;
  presenter=createWorkerScanoutPresenter(frame=>{if(frame.invalidate){presentation.invalidate();return;}const before=presentation.snapshot().drawnPresents,accepted=presentation.present(frame);queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,accepted&&presentation.snapshot().drawnPresents>before?'drawn':'failed'));});
  const gpu=await attachProductionVirgl(vm,{presenter}),store=await SessionStore.open('wasm-vm-sessions-v1-capstone-paged'),writer=await store.writer('bounded-paged-gpu');
  need(gpu.inspect().profile.identity&&!/SwiftShader|llvmpipe|software/i.test(gpu.inspect().profile.identity),'physical GPU required');
  const configuration={version:1,runtime:'rv64-linux-gpu-exact-session-v1',exactGpuSession:1,providersComplete:true,ramMib:1024,bootargs:'console=ttyS0',clock:{mode:'icount',divider:64,timebase_hz:'10000000',interactive:null},
   kernel:{url:new URL('/kernel.bin',location).href,sha256:checkpointHash(kernel),length:String(kernel.length)},wasm:{url:new URL('/pkg/wasm_vm_wasm_bg.wasm',location).href,sha256:checkpointHash(wasm),length:String(wasm.length)},
   renderer:{url:new URL('/gpu-checkpoint-build.js',location).href,sha256:checkpointHash(stamp),length:String(stamp.length),buildId:build.GPU_CHECKPOINT_BUILD_ID},profile:gpu.checkpointProfile(),devices:JSON.parse(vm.exactGpuSessionTopology()),imageManifest:image,
   timeEntropyPolicy:vm.sessionSourcePolicy(),deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
  const journal=await SessionGpuJournal.create(store,writer,configuration,vm,gpu,{witnessPages:true}),states=[];
  const snapshot=async frame=>{states.push({...position(frame),id:journal.checkpoints.at(-1).id,digest:hex(frame.digest),ramDigest:frame.ramDigest?hex(frame.ramDigest):vm.softwareRamDigest(),state:await retain('source-'+states.length+'.state',vm.exactGpuSessionState())});};
  await snapshot(vm.exactGpuSessionWitness());let next=10000n,captures=0;const began=performance.now();
  const collect=async()=>{const batch=vm.takeExactGpuBatch();if(batch.events.length){journal.stage(batch);await journal.flush();}};
  try{
   while(!serial.includes('SESSION_DONE')){
    need(performance.now()-began<120000&&BigInt(vm.inputPosition().transition)<5000000n,'bounded GPU fixture limit');
    const result=vm.runChunk(10000);await collect();need(!result.done||serial.includes('SESSION_DONE'),'fixture stopped before proof');
    for(const r of vm.exactDeviceRequests()){need(r.intent.kind==='block','unexpected external provider');const lease=vm.exactLeaseDeviceRequest(r.id);try{vm.exactCompleteDeviceRequest(lease,0,0,new Uint8Array(262144));}finally{lease.free();}}
    gpu.pump();await new Promise(resolve=>setTimeout(resolve,0));await collect();
    if(captures<3&&BigInt(vm.inputPosition().transition)>=next&&gpu.checkpointReady().ok){const frame=await journal.captureKeyframe(vm,gpu,'point-'+captures);await snapshot(frame);captures++;next=BigInt(frame.transition)+10000n;}
   }
   await collect();need(['SESSION_QUERY_VISIBLE_1','SESSION_QUERY_EMPTY_0','SESSION_READBACK_GREEN_16384','SESSION_FRAME_AND_DISK_OK','SESSION_EXPECTED_GPU_ERROR_1205'].every(m=>serial.includes(m)),'original fixture markers');
   need(states.length>=3,'two adjacent checkpoint windows');const end=vm.exactGpuSessionWitness(),final={...position(end),digest:hex(end.digest),ramDigest:vm.softwareRamDigest(),state:await retain('source-'+states.length+'.state',vm.exactGpuSessionState())};await journal.completeExactPaged(end);await writer.release();
   const pixel=[...document.querySelector('#display').getContext('2d').getImageData(32,32,1,1).data];need(JSON.stringify(pixel)==='[0,255,0,255]','actual green frame');
   window.pagedProof={store,configuration,states,final,position,retain};
   return {database:store.databaseName,id:'bounded-paged-gpu',configuration,states,end:final,serial,pixel,physical:gpu.inspect(),presentation:presentation.snapshot(),trace:JSON.parse(vm.gpuCommandTrace())};
  }finally{gpu.dispose();vm.free();presentation.dispose();if(!window.pagedProof){await writer.release();await store.close();}}
 });
 replay=true;
 report.replay=await page.evaluate(async()=>{
  const {openGpuTimelineReplay}=await import('/session-gpu-replay.js'),{readCheckpointObject}=await import('/session-checkpoints.js');
  const p=pagedProof,opened=await openGpuTimelineReplay({store:p.store,id:'bounded-paged-gpu',configuration:p.configuration}),windows=[];
  const points=opened.manifest.checkpoints,last=points.slice(-3);let incrementalStart=false;
  try{for(let index=0;index<2;index++){
   const from=last[index],to=last[index+1],prefix=await readCheckpointObject(p.store,from.machine),incremental=new TextDecoder().decode(prefix.subarray(0,8))==='WVKEYF01';incrementalStart||=incremental;
   const result=await opened.controller.seekFromCheckpoint(from.id,to.position),expected=p.states.find(s=>s.id===to.id);
   if(result.status!=='ready'||result.rendered.digest!==expected.digest||!result.rendered.replay?.paged)throw Error('paged exact witness mismatch');
   const inspected=await opened.controller.inspectSelected(),state=await p.retain('replay-'+index+'.state',inspected.state);
   if(state.sha256!==expected.state.sha256)throw Error('paged native state bytes differ');
   windows.push({from:from.id,to:to.id,incrementalStart:incremental,position:result.position,digest:result.rendered.digest,expected:expected.digest,state,replay:result.rendered.replay});
  }
  if(!incrementalStart)throw Error('incremental-start window missing');
  let tail=null;if(JSON.stringify(p.position(last[2].position))!==JSON.stringify(p.position(opened.manifest.end))){const selected=await opened.controller.seekFromCheckpoint(last[2].id,opened.manifest.end);if(selected.status!=='ready'||selected.rendered.digest!==p.final.digest)throw Error('paged terminal witness mismatch');const inspected=await opened.controller.inspectSelected(),state=await p.retain('replay-2.state',inspected.state);if(state.sha256!==p.final.state.sha256)throw Error('paged terminal native bytes differ');tail={from:last[2].id,position:selected.position,digest:selected.rendered.digest,state,replay:selected.rendered.replay};}
  const selected=opened.controller.selected,pixel=[...selected.rendered.canvas.getContext('2d').getImageData(32,32,1,1).data];
  if(JSON.stringify(pixel)!=='[0,255,0,255]')throw Error('paged final physical frame differs');
  window.pagedController=opened.controller;return {windows,tail,pixel,incrementalStart,position:selected.position,digest:selected.rendered.digest};
  }catch(error){opened.controller.close();throw error;}
 });
 for(const worker of workers){const count=await worker.evaluate(async()=>{const {WasmLinux}=await import('/pkg/wasm_vm_wasm.js');return WasmLinux.ownedLocalHttpFactoryEntries();});report.workerFactories.push(count);assert.equal(count,'0');}
 assert.equal(report.workerFactories.length,1);assert.equal(report.replay.digest,report.recording.end.digest);
 await page.screenshot({path:path.join(out,'paged-gpu.png')});await page.evaluate(()=>pagedController.close());replay=false;
 report.retained=await retainSessionStore(page,report.recording.database,path.join(out,'saved'));await page.evaluate(()=>pagedProof.store.close());
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.blocked,[]);assert.deepEqual(report.sockets,[]);
 assert.equal(git('rev-parse','HEAD'),report.head);assert.equal(git('status','--porcelain'),report.dirty);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
 try{await context?.tracing.stop({path:path.join(out,'browser-trace.zip')});}catch(error){report.traceError=String(error);report.status='failed';process.exitCode=1;}
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,out,failure:report.failure}));
