// A real native UART/block recording in the production GPU machine. This small
// freestanding guest proves durable journal storage and a parked full-frame replay;
// full Linux desktop and performance qualification remain separate.
import init,{WasmLinux}from'./pkg/wasm_vm_wasm.js';
import{SessionStore}from'./session-store.js';
import{SessionGpuJournal}from'./session-gpu-journal.js';
import{openGpuTimelineReplay}from'./session-gpu-replay.js';
import{checkpointHash}from'./session-checkpoints.js';
import{GPU_CHECKPOINT_BUILD_ID}from'./gpu-checkpoint-build.js';
import{attachProductionVirgl,createWorkerScanoutPresenter}from'./renderer/virgl-command/production.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const need=(ok,why)=>{if(!ok)throw Error('GPU journal stream: '+why);};
const pos=p=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,p[key]]));
const hex=b=>[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
async function responseBytes(url){const r=await fetch(url);need(r.ok,'asset '+url);return new Uint8Array(await r.arrayBuffer());}
export async function runGpuJournalStream({database='wasm-vm-sessions-v1-gpu-stream-probe',idPrefix='gpu-stream-'+crypto.randomUUID(),notify=()=>{},retain=async()=>null,signal,variants=['count','bytes'],fullAtBlockMid=false}={}){
 await init();const imageManifest=await fetch(new URL('./assets/e9-gpu-journal-stream-image.json',import.meta.url)).then(r=>{need(r.ok,'image');return r.text();});
 const image=JSON.parse(imageManifest),wasm=await responseBytes(new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url)),rendererBytes=await responseBytes(new URL('./gpu-checkpoint-build.js',import.meta.url));
 need(image.image_len===67108864&&image.chunk_size===262144&&image.chunks.length===256,'fixed storage fixture image');
 const result={scope:'Real freestanding UART/block GPU-journal storage and parked full-frame replay; Linux/Mesa desktop and performance qualification remain separate',status:'running',database,cases:[]};
 for(const variant of variants){
  const state={variant,id:idPrefix+'-'+variant,status:'running',serial:'',receipts:0,envelopeBytes:0,channels:{},blocks:0,rawBatches:[],maxPendingRows:0,maxPendingBytes:0,maxTransferredBatchRows:0,maxTransferredBatchBytes:0,maxIntervalRows:0,maxIntervalBytes:0,checkpoints:[]};result.cases.push(state);
  let vm,gpu,store,writer,journal,stagedBytes=0,batchId=0,initial,final,states=[];
  const active=()=>need(!signal?.aborted,'cancelled');
  const save=async(name,bytes)=>retain(variant+'-'+name,bytes);
  const collect=async()=>{
   const batch=vm.takeExactGpuBatch();if(!batch.events.length){need(batch.payloads.length===0,'unowned physical payload');return;}
   need(batch.payloads.length===0,'this fixture has no physical readback bodies');
   const bytes=batch.events.reduce((n,row)=>n+row.bytes.length,0);
   state.maxTransferredBatchRows=Math.max(state.maxTransferredBatchRows,batch.events.length);state.maxTransferredBatchBytes=Math.max(state.maxTransferredBatchBytes,bytes);
   state.receipts+=batch.events.length;state.envelopeBytes+=bytes;
   for(const row of batch.events)state.channels[row.channel]=(state.channels[row.channel]??0)+1;
   // Retain the owned candidate before stage, including a rejected final batch.
   const raw=encoder.encode(JSON.stringify(batch.events.map(row=>({...row,bytes:[...row.bytes]}))));
   const ref=await save('batch-'+String(batchId++).padStart(5,'0')+'.json',raw);if(ref)state.rawBatches.push(ref);
   if(journal.pending+batch.events.length>256||stagedBytes+bytes>4194304){await journal.flush();stagedBytes=0;}
   journal.stage(batch);stagedBytes+=bytes;const window=journal.intervalWindow;if(window){state.maxIntervalRows=Math.max(state.maxIntervalRows,window.rows);state.maxIntervalBytes=Math.max(state.maxIntervalBytes,window.bytes);}state.maxPendingRows=Math.max(state.maxPendingRows,journal.pending);state.maxPendingBytes=Math.max(state.maxPendingBytes,stagedBytes);
   if(journal.pending>=128||stagedBytes>=2097152){await journal.flush();stagedBytes=0;}
  };
  const capture=async(id,options={})=>{
   await collect();await journal.flush();stagedBytes=0;const before=journal.intervalWindow;
   const point=await journal.captureKeyframe(vm,gpu,id,options),after=journal.intervalWindow;
   if(after)need(after.rows===0&&after.bytes===0,'durable checkpoint resets interval admission');
   states.push(point);state.checkpoints.push({...pos(point),digest:hex(point.digest),ramDigest:hex(point.ramDigest),full:point.full,frameBytes:point.frameBytes,dirtyPages:point.dirtyPages,windowBefore:before,windowAfter:after});return point;
  };
  try{
   active();const kernelUrl=new URL('./assets/e9-gpu-journal-stream-'+variant+'.bin',import.meta.url),metadata=await fetch(new URL('./assets/e9-gpu-journal-stream-'+variant+'.json',import.meta.url)).then(r=>{need(r.ok,'fixture metadata');return r.json();}),kernel=await responseBytes(kernelUrl);
   need(checkpointHash(kernel)===metadata.sha256&&kernel.length===metadata.bytes&&checkpointHash(encoder.encode(imageManifest))===metadata.imageSha256,'sealed guest/image');
   need(metadata.inputs===(variant==='count'?4100:1)&&metadata.blocks===(variant==='count'?0:256),'sealed guest amounts');state.fixture=metadata;
   vm=WasmLinux.newExactGpuSession(kernel,imageManifest,'console=ttyS0',bytes=>{state.serial+=decoder.decode(bytes);need(state.serial.length<65536,'console bound');},false);vm.enableJit(2);
   let presenter;presenter=createWorkerScanoutPresenter(frame=>{if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));});
   gpu=await attachProductionVirgl(vm,{presenter});const physical=gpu.inspect();need(physical.qualified&&!physical.lost&&!/SwiftShader|llvmpipe|software/i.test(physical.profile.identity),'physical GPU profile');state.physical=physical;
   const config={version:1,runtime:'rv64-linux-gpu-exact-session-v1',exactGpuSession:1,providersComplete:true,ramMib:1024,bootargs:'console=ttyS0',clock:{mode:'icount',divider:64,timebase_hz:'10000000',interactive:null},kernel:{url:kernelUrl.href,sha256:metadata.sha256,length:String(kernel.length)},wasm:{url:new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:checkpointHash(wasm),length:String(wasm.length)},renderer:{url:new URL('./gpu-checkpoint-build.js',import.meta.url).href,sha256:checkpointHash(rendererBytes),length:String(rendererBytes.length),buildId:GPU_CHECKPOINT_BUILD_ID},profile:gpu.checkpointProfile(),devices:JSON.parse(vm.exactGpuSessionTopology()),imageManifest,timeEntropyPolicy:vm.sessionSourcePolicy(),deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
   state.configuration=config;store=await SessionStore.open(database);writer=await store.writer(state.id);journal=await SessionGpuJournal.create(store,writer,config,vm,gpu,{witnessPages:fullAtBlockMid});initial=journal.initialWitness;states=[initial];state.initial={...pos(initial),digest:hex(initial.digest)};
   // All offers enter the real native owned queue. Taking batches does not run
   // guest code or replace the native receipt/cursor with a generated fixture.
   for(let n=0;n<metadata.inputs;n++){active();vm.sendInput(Uint8Array.of(97));if(n%128===127){await collect();await tick();}if(n+1===2048)await capture('input-mid');}await collect();
   for(let calls=0;calls<10000&&!state.serial.includes('STREAM_DONE');calls++){
    active();for(const request of vm.exactDeviceRequests()){
     need(request.intent.kind==='block','fixture device request');const index=request.intent.chunk;need(Number.isInteger(index)&&index>=0&&index<256,'fixture chunk index');
     const bytes=new Uint8Array(262144).fill(index);need(Number(request.intent.content.length)===262144&&request.intent.content.sha256===image.chunks[index]&&checkpointHash(bytes)===image.chunks[index],'immutable fixture chunk');
     const lease=vm.exactLeaseDeviceRequest(request.id);try{vm.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}state.blocks++;await collect();if(state.blocks===128){
      if(fullAtBlockMid){
       const native=vm.exactGpuSessionState(),view=new DataView(native.buffer,native.byteOffset,native.byteLength);let at=84,parked=null;
       while(at+8<=native.length){const tag=view.getUint32(at,true),length=view.getUint32(at+4,true);need(at+8+length<=native.length,'native section bounds');
        if(tag===20){const body=at+8,hub=view.getUint32(body,true),pending=body+8+hub;need(pending+6<=body+length,'block pending bounds');parked=view.getUint32(pending+2,true);break;}at+=8+length;}
       need(parked!==null&&parked>0,'owned read remains parked after completion');
       need(!vm.exactDeviceRequests().some(row=>row.id===request.id),'completed request was not retired');
       state.parkedAtFull={position:pos(vm.inputPosition()),parked,completedChunk:index,pendingRequestRetired:true};
      }
      const mid=await capture('block-mid',{full:fullAtBlockMid});if(fullAtBlockMid)need(mid.full&&JSON.stringify(pos(mid))===JSON.stringify(state.parkedAtFull.position),'full keyframe moved parked position');
     }
    }
    const outcome=vm.runChunk(8192);need(!outcome.done,'guest stopped');await collect();need(!state.serial.includes('STREAM_FAIL'),state.serial);
    if(fullAtBlockMid&&state.blocks===128&&!state.afterParkedService){
      const witness=vm.exactGpuSessionWitness();
      need(BigInt(witness.transition)>BigInt(state.parkedAtFull.position.transition),'parked chain did not reach next guest service');
      state.afterParkedService={...pos(witness),digest:hex(witness.digest)};
    }
    if(gpu.inspect().pending){const pumped=gpu.pump();need(pumped?.ok,'physical GPU work');await collect();}
    if(calls%16===0){await notify({variant,receipts:state.receipts,blocks:state.blocks,position:pos(vm.inputPosition())});await tick();}
   }
   need(state.serial.includes('STREAM_UART_OK\n')&&state.serial.includes('STREAM_BLOCKS_OK\nSTREAM_DONE\n'),'guest completion markers');need(state.blocks===metadata.blocks&&state.channels[1]===metadata.inputs,'complete actual inputs/block requests');
   await collect();await journal.flush();stagedBytes=0;
   await capture('stream-end');
   final=vm.exactGpuSessionWitness();if(fullAtBlockMid)await journal.completeExactPaged(final);else await journal.completeExact(final,states);state.final={...pos(final),digest:hex(final.digest),ramDigest:vm.softwareRamDigest()};state.hostQueues=Object.fromEntries(Object.entries(vm.exactSessionHostQueues()).map(([key,bytes])=>[key,{bytes:bytes.length,sha256:checkpointHash(bytes)}]));need(state.hostQueues.pending.bytes===0&&state.hostQueues.output.bytes===0,'drained guest/console queues');
   const logical=vm.exactGpuSessionState();state.logicalState=await save('final.state',logical);state.status='recorded';
  }catch(error){state.status='failed';state.error=String(error.stack??error);state.failurePosition=vm?pos(vm.inputPosition()):null;try{if(vm)state.failureState=await save('failure.state',vm.exactGpuSessionState());}catch(captureError){state.captureError=String(captureError);}}
  finally{
   try{if(journal?.pending)await journal.flush();}catch(error){state.flushError=String(error);}
   try{if(store&&writer){const saved=await store.openSession(writer.id);if(saved){state.saved={id:saved.id,revision:saved.revision,manifestBytes:saved.manifest.length,manifestSha256:checkpointHash(saved.manifest),manifest:JSON.parse(decoder.decode(saved.manifest))};if(state.status==='recorded')need(state.saved.manifest.events.reduce((sum,chunk)=>sum+chunk.count,0)===state.receipts&&state.saved.manifest.end.sequence===state.final.sequence,'complete reopened durable receipt coverage');}else need(state.status!=='recorded','completed saved history missing');}}catch(error){state.openError=String(error);state.status='failed';state.error??=state.openError;}
   for(const[name,close]of [['renderer',()=>gpu?.dispose()],['machine',()=>vm?.free()],['writer',()=>writer?.release()],['store',()=>store?.close()]]){
    try{await close();}catch(error){state.status='failed';state.error??=String(error);(state.cleanupErrors??=[]).push({name,error:String(error)});}
   }
  }
  await notify({variant,status:state.status,receipts:state.receipts,blocks:state.blocks,error:state.error});
 }
 if(fullAtBlockMid){
  const state=result.cases.find(row=>row.variant==='bytes');
  if(state?.status==='recorded'){
   let replayStore,replay;
   try{
    replayStore=await SessionStore.open(database);
    replay=await openGpuTimelineReplay({store:replayStore,id:state.id,configuration:state.configuration,
      onProgress:message=>notify({variant:'bytes',stage:'parked-full-replay',message})});
    const after=await replay.controller.seekFromCheckpoint('block-mid',state.afterParkedService);
    need(after.status==='ready'&&after.checkpointId==='block-mid'
      &&after.rendered.digest===state.afterParkedService.digest,'parked full checkpoint failed next-service replay');
    const finalReplay=await replay.controller.seekFromCheckpoint('block-mid',state.saved.manifest.end);
    need(finalReplay.status==='ready'&&finalReplay.checkpointId==='block-mid'
      &&finalReplay.rendered.digest===state.final.digest
      &&finalReplay.rendered.gpu.qualified&&!finalReplay.rendered.gpu.lost
      &&replay.events.length===state.receipts,'parked full checkpoint failed complete physical replay');
    state.replayParked={status:'passed',checkpointId:finalReplay.checkpointId,afterService:after.rendered.digest,
      endDigest:finalReplay.rendered.digest,position:finalReplay.position,events:replay.events.length,
      physical:finalReplay.rendered.gpu.profile.identity};
   }catch(error){state.status='failed';state.error=String(error.stack??error);}
   finally{replay?.controller.close();await replayStore?.close();}
  }
 }
 result.status=result.cases.every(row=>row.status==='recorded')?'recorded':'failed';return result;
}
