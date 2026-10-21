// One private, offline GPU replay candidate per worker. Retiring the worker retires
// every callback/GL handle; no message is ever retargeted to a replacement VM.
import init,{WasmLinux} from './pkg/wasm_vm_wasm.js';
import {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';
import {SessionStore} from './session-store.js';
import {SessionGpuJournal} from './session-gpu-journal.js';
import {SessionCheckpoints,readCheckpointObject} from './session-checkpoints.js';
import {inspectRamDeltaChunk} from './session-keyframes.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from './renderer/virgl-command/production.mjs';
import {gpuNeed as need,gpuPosition as pos,gpuSamePosition as same,gpuCompare as compare,gpuHashBytes,gpuHex,decodeGpuExactFrame,GPU_FRAME_LIMIT} from './session-gpu-replay-format.js';
const decoder=new TextDecoder(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let machine=null,renderer=null,store=null,started=false,latestFrame=null;
const message=value=>postMessage(value);
const dispose=async()=>{renderer?.dispose();renderer=null;machine?.free();machine=null;await store?.close();store=null;};
function bindFrame(frame,checkpoint,read){
  need(frame.meta.runtime===read.manifest.machine.vm_build&&same(frame.meta.position,checkpoint.position)
    &&frame.meta.rendererSha256===checkpoint.gpu.sha256,'GPU keyframe binding');
  const committed=read.witnesses.find(value=>same(value,checkpoint.position));
  need(committed&&gpuHex(committed.digest)===frame.meta.stateSha256,'GPU keyframe state is not committed');
}
async function seek(request){
  await init();store=await SessionStore.open(request.database);
  const opened=await store.openSession(request.sessionId);need(opened,'saved GPU session missing');
  const manifest=JSON.parse(decoder.decode(opened.manifest)),vm=manifest.assets.find(value=>value.role==='vm');need(vm,'GPU runtime missing');
  const config=JSON.parse(decoder.decode(await readCheckpointObject(store,vm.content,8*1048576)));
  need(config.wasm?.sha256===SOFTWARE_CHECKPOINT_WASM_SHA256&&config.renderer?.buildId===GPU_CHECKPOINT_BUILD_ID,'GPU build unavailable');
  const read=await SessionGpuJournal.readExact(store,request.sessionId,{configuration:config});
  const index=read.manifest.checkpoints.findIndex(point=>point.id===request.checkpointId);need(index>=0,'GPU checkpoint missing');
  const checkpoint=read.manifest.checkpoints[index],end=read.manifest.checkpoints[index+1]?.position??read.manifest.end;
  const manager=new SessionCheckpoints(store),chain=await manager.resolveDelta(request.sessionId,checkpoint.id);
  const base=decodeGpuExactFrame(await readCheckpointObject(store,chain.base,GPU_FRAME_LIMIT));bindFrame(base,chain.baseCheckpoint,read);need(base.meta.full,'GPU full RAM ancestor missing');
  let frame=base;
  if(chain.deltas.length){const last=chain.deltas.at(-1);frame=decodeGpuExactFrame(await readCheckpointObject(store,last.descriptor.frame,GPU_FRAME_LIMIT));bindFrame(frame,checkpoint,read);need(!frame.meta.full&&frame.meta.ramSha256===last.descriptor.ramSha256,'GPU delta RAM binding');}
  const rendererBytes=await readCheckpointObject(store,checkpoint.gpu,256*1048576),kernel=await readCheckpointObject(store,read.manifest.assets.find(value=>value.role==='kernel').content,64*1048576);
  const events=read.receipts.filter(value=>BigInt(value.sequence)>BigInt(checkpoint.position.sequence)&&compare(value,end)<=0),objects=new Map();let ownedBytes=0;
  for(const event of events)if(event.body&&!objects.has(event.body.sha256)){
    ownedBytes+=Number(event.body.length);need(ownedBytes<=64*1048576&&objects.size<256,'GPU checkpoint interval body budget');
    const bytes=await readCheckpointObject(store,event.body,32*1048576);objects.set(event.body.sha256,{sha256:gpuHashBytes(event.body.sha256),length:bytes.length,bytes});}
  const witnesses=read.witnesses.filter(value=>compare(value,checkpoint.position)>=0&&compare(value,end)<=0);
  need(witnesses.length&&same(witnesses[0],checkpoint.position)&&same(witnesses.at(-1),end),'GPU interval witness endpoints');
  // Everything above is authenticated before a replacement VM or renderer is allocated.
  machine=WasmLinux.newExactGpuSession(kernel,config.imageManifest,config.bootargs,()=>{},true);
  if(chain.deltas.length){
    machine.seedExactGpuRam(base.native,gpuHashBytes(base.meta.rendererSha256));
    for(const {checkpoint:point,descriptor} of chain.deltas){let last=-1,pages=0;
      for(const ref of descriptor.chunks){const bytes=await readCheckpointObject(store,ref,4194304),shape=inspectRamDeltaChunk(bytes,'1073741824',last);last=shape.last;pages+=shape.count;need(machine.applySoftwareRamDeltaChunk(bytes)===shape.count,'GPU RAM page application');}
      need(pages===descriptor.dirtyPages&&machine.softwareRamDigest()===descriptor.ramSha256,'GPU reconstructed RAM mismatch');
      const part=decodeGpuExactFrame(await readCheckpointObject(store,descriptor.frame,GPU_FRAME_LIMIT));bindFrame(part,point,read);need(!part.meta.full&&part.meta.ramSha256===descriptor.ramSha256,'GPU delta identity');}
  }
  let presenter;presenter=createWorkerScanoutPresenter(frame=>{
    if(frame.type==='clear'){latestFrame=null;return;}
    if(frame.type==='invalidate')return;
    // These are real physical GPU readbacks. Intermediate candidates remain off-screen;
    // only the main owner may later paint a completed selection.
    latestFrame={...frame,pixels:new Uint32Array(frame.pixels)};
    if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));
  });
  renderer=await attachProductionVirgl(machine,{presenter,checkpoint:{exactHistory:true,renderer:rendererBytes,profile:config.profile,epoch:frame.meta.rendererEpoch,rendererSha256:frame.meta.rendererSha256}});
  machine.beginExactReplay(frame.native,events,witnesses,end,{pending:frame.pending,output:frame.output},
    {version:1,rendererDigest:gpuHashBytes(frame.meta.rendererSha256),ramDigest:frame.meta.full?null:gpuHashBytes(frame.meta.ramSha256),payloads:[...objects.values()]});
  await renderer.activateCheckpoint();
  let outcome,unchanged=0,lastPosition=null;
  for(let calls=0;calls<100000;calls++){
    need(!renderer.inspect().lost,'GPU context loss stopped replay');
    outcome=machine.runExactReplayChunkTo(request.target,request.quantum);
    const pumped=renderer.pump();need(pumped===null||pumped.ok,'physical GPU replay failed: '+pumped?.error?.message);
    if(outcome.reached)break;
    const position=JSON.stringify(pos(outcome));unchanged=position===lastPosition?unchanged+1:0;lastPosition=position;
    need(unchanged<5000,'GPU physical work did not settle within the bounded retry window');
    if(calls%8===0)message({type:'progress',requestId:request.requestId,position:pos(outcome)});
    await tick();
  }
  need(outcome?.reached,'GPU replay work bound');
  // Settle already-admitted physical work without advancing any guest coordinate.
  for(let polls=0;renderer.inspect().pending&&polls<5000;polls++){
    const result=renderer.pump();need(result?.ok,'physical GPU presentation failed');
    if(result.status==='physical-pending')break;await tick();}
  const result=machine.exactGpuSessionWitness();need(same(result,outcome),'GPU selected state moved');
  const queues=machine.exactSessionHostQueues(),chunks=read.receipts.filter(row=>row.kind==='host'&&row.channel===21&&BigInt(row.sequence)<=BigInt(outcome.sequence)).map(row=>row.bytes);chunks.push(queues.output);
  let text=new Uint8Array(Math.min(65536,chunks.reduce((n,part)=>n+part.length,0))),at=text.length;
  for(let i=chunks.length-1;i>=0&&at>0;i--){const part=chunks[i].subarray(Math.max(0,chunks[i].length-at));at-=part.length;text.set(part,at);}
  const frameData=latestFrame?{...latestFrame,pixels:latestFrame.pixels}:null;
  message({type:'ready',requestId:request.requestId,position:pos(outcome),digest:gpuHex(result.digest),console:decoder.decode(text),frame:frameData,gpu:renderer.inspect()});
}
onmessage=event=>{
  if(started||event.data?.type!=='seek')return;started=true;
  void seek(event.data).catch(async error=>{await dispose();message({type:'error',requestId:event.data.requestId,message:String(error.message),stack:error.stack});});
};
// Dependencies initialize Wasm with top-level await. The page must not send its
// request until this handler exists: an early message can otherwise be lost.
message({type:'initialized'});
