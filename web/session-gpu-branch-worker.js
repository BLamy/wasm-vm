// One offline recording machine and one physical renderer. The page owns publication.
import init,{WasmLinux} from './pkg/wasm_vm_wasm.js';
import {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';
import {SessionStore} from './session-store.js';
import {readCheckpointObject,checkpointHash} from './session-checkpoints.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from './renderer/virgl-command/production.mjs';
import {gpuNeed as need,gpuPosition as pos,gpuSamePosition as same,gpuHashBytes,gpuHex,validateGpuConfiguration,encodeGpuExactFrame} from './session-gpu-replay-format.js';
const encoder=new TextEncoder(),decoder=new TextDecoder(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let machine=null,renderer=null,store=null,configuration=null,pastConsole=null,latestFrame=null,frameVersion=0,sentFrame=0;
let prepared=false,active=false,stopped=false,serial=Promise.resolve();
function consoleBytes(chunks){
  const bytes=new Uint8Array(Math.min(65536,chunks.reduce((n,part)=>n+part.length,0)));let at=bytes.length;
  for(let i=chunks.length-1;i>=0&&at>0;i--){const part=chunks[i].subarray(Math.max(0,chunks[i].length-at));at-=part.length;bytes.set(part,at);}return bytes;
}
function takeBatch(){
  if(machine.exactSessionHostQueues().output.length)machine.takeOutput();const batch=machine.takeExactGpuBatch();
  for(const row of batch.events)if(row.channel===21)pastConsole=consoleBytes([pastConsole,row.bytes]);
  return batch;
}
function view(digest=false){
  const at=digest?machine.exactGpuSessionWitness():machine.inputPosition();
  const queues=machine.exactSessionHostQueues();
  const result={position:pos(at),console:decoder.decode(consoleBytes([pastConsole,queues.output])),gpu:renderer.inspect()};
  if(digest)result.digest=gpuHex(at.digest);
  // An exact paused view also repairs delivery after a failed page-side storage/paint step.
  if(digest||frameVersion!==sentFrame){result.frame=latestFrame?{...latestFrame,pixels:latestFrame.pixels.slice()}:null;result.frameChanged=true;sentFrame=frameVersion;}
  return result;
}
function send(value){
  const buffers=new Set(),visit=value=>{
    if(value instanceof Uint8Array||value instanceof Uint32Array){need(value.buffer instanceof ArrayBuffer,'owned worker result');buffers.add(value.buffer);}
    else if(Array.isArray(value))for(const item of value)visit(item);
    else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);
  };visit(value);postMessage(value,[...buffers]);
}
async function localBlocks(){
  for(const request of machine.exactDeviceRequests()){
    need(request.intent.kind==='block','this continuation needs an unavailable host device');
    const lease=machine.exactLeaseDeviceRequest(request.id);
    try{
      const ref={sha256:request.intent.content.sha256,length:String(request.intent.content.length)};
      let bytes;try{bytes=await readCheckpointObject(store,ref,1048576);}catch{throw Error('This disk chunk is not retained locally. The continuation stays offline.');}
      need(!stopped&&!renderer.inspect().lost,'GPU continuation is unavailable');machine.exactCompleteDeviceRequest(lease,0,0,bytes);
    }finally{lease.free();}
  }
}
async function prepare(request){
  need(!prepared&&!machine,'one continuation per worker');configuration=validateGpuConfiguration(request.configuration);
  need(configuration.branchOrigin&&same(request.capture,configuration.branchOrigin.sourcePosition),'branch origin');
  need(configuration.renderer.buildId===GPU_CHECKPOINT_BUILD_ID&&configuration.wasm.sha256===SOFTWARE_CHECKPOINT_WASM_SHA256,'GPU continuation build unavailable');
  need(request.wasm instanceof Uint8Array&&request.wasm.buffer instanceof ArrayBuffer
    &&String(request.wasm.length)===configuration.wasm.length&&checkpointHash(request.wasm)===configuration.wasm.sha256,'retained continuation Wasm identity');
  await init({module_or_path:request.wasm});store=await SessionStore.open(request.database);
  machine=WasmLinux.newExactGpuSession(request.kernel,configuration.imageManifest,configuration.bootargs,()=>{},false);
  let presenter;presenter=createWorkerScanoutPresenter(frame=>{
    if(frame.type==='clear'){latestFrame=null;frameVersion++;return;}
    if(frame.type==='invalidate')return;
    latestFrame={...frame,pixels:new Uint32Array(frame.pixels)};frameVersion++;
    if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));
  });
  const source=request.renderer;
  need(checkpointHash(source.bytes)===source.sha256,'source renderer hash');
  renderer=await attachProductionVirgl(machine,{presenter,checkpoint:{exactHistory:true,renderer:source.bytes,profile:configuration.profile,epoch:source.epoch,rendererSha256:source.sha256}});
  machine.beginExactBranch(request.capture.native,{pending:request.capture.pending,output:request.capture.output},gpuHashBytes(source.sha256));
  need(machine.exactBranchNetworkOffline(),'offline continuation policy missing');
  need(JSON.stringify(JSON.parse(machine.exactGpuSessionTopology()))===JSON.stringify(configuration.devices)
    &&JSON.stringify(machine.sessionSourcePolicy())===JSON.stringify(configuration.timeEntropyPolicy),'installed continuation profile');
  await renderer.activateCheckpoint();
  need(same(machine.inputPosition(),configuration.branchOrigin.sourcePosition)&&!renderer.inspect().lost,'activation moved or revoked the continuation');
  const saved=await renderer.saveCheckpoint();need(saved.epoch===machine.exactGpuSessionEpoch(),'continuation renderer epoch');
  const frame=machine.captureExactGpuKeyframe(gpuHashBytes(saved.sha256),true);
  const meta={version:1,runtime:checkpointHash(encoder.encode(JSON.stringify(configuration))),position:pos(frame),rendererSha256:saved.sha256,rendererEpoch:saved.epoch,
    ramSha256:gpuHex(frame.ramDigest),stateSha256:gpuHex(frame.digest),full:true};
  pastConsole=Uint8Array.from(configuration.branchOrigin.consolePrefix);prepared=true;
  return {prepared:{frame:encodeGpuExactFrame(meta,frame.native,frame.pending,frame.output),renderer:saved.bytes,disk:request.capture.disk},view:view(true)};
}
async function command(request){
  if(request.type==='prepare')return prepare(request);
  need(prepared&&!stopped,'continuation is unavailable');
  if(request.type==='activate'){
    need(!active,'continuation was already activated');machine.finishSoftwareRamEpoch(true);active=true;return {view:view(true)};
  }
  need(active,'publish the initial continuation before running it');
  if(request.type==='go-live')return machine.requestExactBranchGoLive();
  if(request.type==='view')return {view:view(true)};
  if(request.type==='input'){
    need(request.bytes instanceof Uint8Array&&request.bytes.buffer instanceof ArrayBuffer&&request.bytes.length<=65536,'owned input bound');
    machine.sendInput(request.bytes);return {batch:takeBatch(),view:view()};
  }
  if(request.type==='advance'){
    need(Number.isInteger(request.steps)&&request.steps>0&&request.steps<=1048576,'work bound');
    try{
      for(let left=request.steps;left>0;){
        need(!renderer.inspect().lost,'graphics context was lost');await localBlocks();
        const amount=Math.min(left,4096),result=machine.runChunk(amount);left-=amount;
        const pumped=renderer.pump();need(pumped===null||pumped.ok,'physical GPU continuation failed: '+pumped?.error?.message);
        if(result.done)break;if(left)await tick();
      }
      return {batch:takeBatch(),view:view()};
    }catch(error){stopped=true;throw error;}
  }
  if(request.type==='finish'){
    need(!renderer.inspect().lost,'graphics context was lost');const batch=takeBatch(),end=machine.exactGpuSessionWitness();
    return {batch,end,view:view(true)};
  }
  throw Error('Unknown continuation action');
}
onmessage=event=>{
  const request=event.data;
  serial=serial.catch(()=>{}).then(async()=>{
    try{send({type:'result',requestId:request.requestId,...await command(request)});}
    catch(error){postMessage({type:'error',requestId:request.requestId,message:String(error.message),stopped});}
  });
};
postMessage({type:'initialized'});
