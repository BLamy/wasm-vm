// The existing real MMIO GPU/query/readback guest exercises nonempty renderer
// journals, GPU result bodies and atomic observations through the bounded reader.
import init,{WasmLinux}from'./pkg/wasm_vm_wasm.js';
import{SessionStore}from'./session-store.js';
import{SessionGpuJournal}from'./session-gpu-journal.js';
import{checkpointHash}from'./session-checkpoints.js';
import{GPU_CHECKPOINT_BUILD_ID}from'./gpu-checkpoint-build.js';
import{attachProductionVirgl,createWorkerScanoutPresenter}from'./renderer/virgl-command/production.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder(),tick=()=>new Promise(r=>setTimeout(r,0));
const pos=p=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(k=>[k,p[k]]));
const hex=b=>[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
const need=(ok,detail)=>{if(!ok)throw Error('GPU reader physical control: '+detail);};
const fetchBytes=async name=>{const r=await fetch(new URL(name,import.meta.url));need(r.ok,name);return new Uint8Array(await r.arrayBuffer());};
export async function recordGpuReaderPhysical({database,id='gpu-reader-physical',notify=()=>{},retain,signal}){
 await init();const state={variant:'physical',id,status:'running',serial:'',receipts:0,envelopeBytes:0,channels:{},rawBatches:[],payloads:[],checkpoints:[]};let vm,gpu,store,writer,journal,batchIndex=0;
 const save=(name,bytes)=>retain('physical-'+name,bytes),active=()=>need(!signal?.aborted,'cancelled');
 try{
  const kernel=await fetchBytes('./assets/e9-gpu-reader-physical.bin'),fixture=JSON.parse(decoder.decode(await fetchBytes('./assets/e9-gpu-reader-physical.json')));need(checkpointHash(kernel)===fixture.sha256&&kernel.length===fixture.bytes,'sealed original guest');state.fixture=fixture;
  const zero=new Uint8Array(262144),imageManifest=JSON.stringify({version:1,image_len:zero.length,chunk_size:zero.length,layout:'split',chunks:[checkpointHash(zero)]}),wasm=await fetchBytes('./pkg/wasm_vm_wasm_bg.wasm'),stamp=await fetchBytes('./gpu-checkpoint-build.js');
  vm=WasmLinux.newExactGpuSession(kernel,imageManifest,'console=ttyS0',bytes=>{state.serial+=decoder.decode(bytes);need(state.serial.length<65536,'console bound');},false);vm.enableJit(2);
  let presenter;presenter=createWorkerScanoutPresenter(frame=>{if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));});
  gpu=await attachProductionVirgl(vm,{presenter});state.physical=gpu.inspect();need(state.physical.qualified&&!state.physical.lost&&!/SwiftShader|llvmpipe|software/i.test(state.physical.profile.identity),'physical qualified GPU');
  const configuration={version:1,runtime:'rv64-linux-gpu-exact-session-v1',exactGpuSession:1,providersComplete:true,ramMib:1024,bootargs:'console=ttyS0',clock:{mode:'icount',divider:64,timebase_hz:'10000000',interactive:null},kernel:{url:new URL('./assets/e9-gpu-reader-physical.bin',import.meta.url).href,sha256:fixture.sha256,length:String(kernel.length)},wasm:{url:new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:checkpointHash(wasm),length:String(wasm.length)},renderer:{url:new URL('./gpu-checkpoint-build.js',import.meta.url).href,sha256:checkpointHash(stamp),length:String(stamp.length),buildId:GPU_CHECKPOINT_BUILD_ID},profile:gpu.checkpointProfile(),devices:JSON.parse(vm.exactGpuSessionTopology()),imageManifest,timeEntropyPolicy:vm.sessionSourcePolicy(),deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
  state.configuration=configuration;store=await SessionStore.open(database);writer=await store.writer(id);journal=await SessionGpuJournal.create(store,writer,configuration,vm,gpu,{witnessPages:true});state.initial={...pos(journal.initialWitness),digest:hex(journal.initialWitness.digest)};
  const collect=async()=>{active();const batch=vm.takeExactGpuBatch();if(!batch.events.length){need(batch.payloads.length===0,'orphan GPU payload');return;}
   state.receipts+=batch.events.length;state.envelopeBytes+=batch.events.reduce((n,r)=>n+r.bytes.length,0);for(const row of batch.events)state.channels[row.channel]=(state.channels[row.channel]??0)+1;
   state.rawBatches.push(await save('batch-'+String(batchIndex++).padStart(5,'0')+'.json',encoder.encode(JSON.stringify(batch.events.map(row=>({...row,bytes:[...row.bytes]}))))));
   for(const body of batch.payloads){const ref=await save('body-'+hex(body.sha256)+'.bin',body.bytes);state.payloads.push({sha256:hex(body.sha256),length:body.length,artifact:ref});}
   journal.stage(batch);await journal.flush();};
  let captured=false,green=false;
  for(let calls=0;calls<10000&&!state.serial.includes('SESSION_DONE');calls++){
   active();const outcome=vm.runChunk(10000);need(!outcome.done,'guest stopped');await collect();
   for(const request of vm.exactDeviceRequests()){need(request.intent.kind==='block'&&request.intent.chunk===0,'original zero-block request');const lease=vm.exactLeaseDeviceRequest(request.id);try{vm.exactCompleteDeviceRequest(lease,0,0,zero);}finally{lease.free();}await collect();}
   if(gpu.inspect().pending){for(let n=0;gpu.inspect().pending&&n<5000;n++){need(gpu.pump().ok,'physical pump');await tick();}need(!gpu.inspect().pending,'stranded physical job');await collect();
    if(!captured){const point=await journal.captureKeyframe(vm,gpu,'gpu-native-mid');state.checkpoints.push({...pos(point),digest:hex(point.digest)});captured=true;}}
   if(!green&&state.serial.includes('SESSION_FRAME_AND_DISK_OK')&&!state.serial.includes('SESSION_EXPECTED_GPU_ERROR_1205')){await collect();const point=await journal.captureKeyframe(vm,gpu,'gpu-green');state.checkpoints.push({...pos(point),digest:hex(point.digest)});green=true;}
   need(!state.serial.includes('SESSION_FAIL'),state.serial);if(calls%8===0){await notify({variant:'physical',receipts:state.receipts,position:pos(vm.inputPosition())});await tick();}
  }
  need(['SESSION_QUERY_VISIBLE_1','SESSION_QUERY_EMPTY_0','SESSION_READBACK_GREEN_16384','SESSION_FRAME_AND_DISK_OK','SESSION_EXPECTED_GPU_ERROR_1205','SESSION_DONE'].every(marker=>state.serial.includes(marker)),'original guest markers');
  need(green,'captured before the deliberate final GPU error');await collect();const end=vm.exactGpuSessionWitness();await journal.completeExactPaged(end);state.final={...pos(end),digest:hex(end.digest),ramDigest:vm.softwareRamDigest()};state.logicalState=await save('final.state',vm.exactGpuSessionState());
  const opened=await store.openSession(id);state.saved={id,revision:opened.revision,manifestSha256:checkpointHash(opened.manifest),manifest:JSON.parse(decoder.decode(opened.manifest))};need(state.channels[22]>0&&state.channels[23]>0&&state.payloads.some(p=>p.length===16384),'real GPU results/observations/readback body');state.status='recorded';return state;
 }finally{gpu?.dispose();vm?.free();await writer?.release();await store?.close();}
}
