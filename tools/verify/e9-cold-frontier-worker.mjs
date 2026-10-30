// Private diagnostic continuation of a captured, authenticated GPU replay.
// This is deliberately separate from the production branch worker: it never
// publishes a session, writes a guest image, or enables historical networking.
import init,{WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {SessionStore} from '/session-store.js';
import {readCheckpointObject,checkpointHash} from '/session-checkpoints.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from '/renderer/virgl-command/production.mjs';
import {gpuNeed as need,gpuPosition as pos,gpuHashBytes,gpuHex,validateGpuConfiguration} from '/session-gpu-replay-format.js';
import {decodeCheckpointData,encodeCheckpointData} from '/renderer/virgl-command/checkpoint-codec.mjs';

const decoder=new TextDecoder(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let machine,renderer,store,pastConsole=new Uint8Array(),latestFrame=null,firstCandidate=null;
let frameVersion=0,sentFrame=0,prepared=false,active=false,stopped=false;
let missingLocalBlock=null,guestHalt=null,serial=Promise.resolve();
let retainedObjects,imageChunkLengths,chunkStart=null;
let nextBaseToken=0,localBaseReads=0;
let serialTracking=false;
const baseWaiters=new Map();
const egress={fetch:0,sockets:0};
function tail(parts){
  const bytes=new Uint8Array(Math.min(65536,parts.reduce((n,part)=>n+part.length,0)));let at=bytes.length;
  for(let index=parts.length-1;index>=0&&at>0;index--){
    const part=parts[index].subarray(Math.max(0,parts[index].length-at));at-=part.length;bytes.set(part,at);
  }
  return bytes;
}
function drain(){
  const queues=machine.exactSessionHostQueues();if(queues.output.length)machine.takeOutput();
  const batch=machine.takeExactGpuBatch();
  const serialRows=batch.events.filter(row=>row.channel===21);
  for(const row of serialRows)pastConsole=tail([pastConsole,row.bytes]);
  const summary={events:batch.events.length,payloads:batch.payloads.length,
    hostOutputBytes:queues.output.length};
  if(serialTracking){
    const length=serialRows.reduce((total,row)=>total+row.bytes.length,0);
    need(length<=8*1048576,'diagnostic serial batch exceeds transport bound');
    const bytes=new Uint8Array(length);let at=0;
    for(const row of serialRows){bytes.set(row.bytes,at);at+=row.bytes.length;}
    summary.serialBytes=bytes;
  }
  return summary;
}
function likelyDesktop(frame){
  const words=frame.pixels;if(!words||words.length<1024)return false;
  const colors=new Set(),stride=Math.max(1,Math.floor(words.length/8192));
  let visible=0,samples=0;
  for(let at=0;at<words.length;at+=stride){
    const word=words[at],blue=word&255,green=word>>>8&255,red=word>>>16&255;
    const alpha=frame.format===2?255:word>>>24;samples++;
    if(alpha>0&&Math.max(red,green,blue)>12){visible++;colors.add(word&0xffffff);}
  }
  return visible>samples/4&&colors.size>=8;
}
function view(digest=false){
  const at=digest?machine.exactGpuSessionWitness():machine.inputPosition();
  const queues=machine.exactSessionHostQueues();
  const value={position:pos(at),console:decoder.decode(tail([pastConsole,queues.output])),gpu:renderer.inspect(),
    offline:machine.exactBranchNetworkOffline(),egress:{...egress},guestHalt,
    localBaseReads,
    outstanding:machine.exactDeviceRequests().map(row=>({
      id:row.id,kind:row.intent.kind,content:row.intent.content??null}))};
  if(digest)value.digest=gpuHex(at.digest);
  if(digest||sentFrame!==frameVersion){
    value.frame=latestFrame?{...latestFrame,pixels:latestFrame.pixels.slice()}:null;
    value.frameChanged=true;sentFrame=frameVersion;
  }
  if(firstCandidate){value.firstCandidate={...firstCandidate,pixels:firstCandidate.pixels.slice()};
    firstCandidate=null;}
  return value;
}
function localBase(requestId,ref){
  return new Promise((resolve,reject)=>{
    const token=++nextBaseToken;
    const timer=setTimeout(()=>{baseWaiters.delete(token);
      reject(Error('offline base response deadline exceeded'));},30000);
    baseWaiters.set(token,{requestId,ref,resolve,reject,timer});
    postMessage({type:'need-base',requestId,token,ref});
  });
}
async function localBlocks(requestId){
  for(let round=0;round<1024;round++){
    const requests=machine.exactDeviceRequests();if(!requests.length)return;
    for(const request of requests){
      need(request.intent.kind==='block','unexpected offline device request '+request.intent.kind);
      const ref={sha256:request.intent.content.sha256,length:String(request.intent.content.length)};
      need(imageChunkLengths.get(ref.sha256)?.has(Number(ref.length)),
        'offline disk request digest/length is not in the pinned base image');
      let bytes;
      if(!retainedObjects.has(ref.sha256)){
        let missing=false;
        try{await store.objectReference(ref.sha256);}
        catch(error){need(error?.code==='MissingObject',
          'future base object failed for a reason other than absence: '+String(error));
          missing=true;}
        need(missing,'source-unretained object unexpectedly exists in the diagnostic store');
        try{bytes=await localBase(requestId,ref);}
        catch(error){missingLocalBlock={id:request.id,ref,code:'BaseSupplyFailure',
          sourceGraphMembership:false,baseImageMembership:true,
          localCacheError:String(error.message)};
          throw Error('unretained offline base-image chunk '+ref.sha256+' length '+ref.length+': '+error.message);}
        need(bytes instanceof Uint8Array&&bytes.buffer instanceof ArrayBuffer
          &&bytes.length===Number(ref.length)&&checkpointHash(bytes)===ref.sha256,
        'local offline base object differs from pinned image');
        localBaseReads++;
      }else bytes=await readCheckpointObject(store,ref,1048576);
      need(!stopped&&!renderer.inspect().lost,'diagnostic GPU continuation stopped');
      const lease=machine.exactLeaseDeviceRequest(request.id);
      try{machine.exactCompleteDeviceRequest(lease,0,0,bytes);}
      finally{lease.free();}
    }
  }
  throw Error('offline disk completion work bound');
}
async function pumpGpu(){
  for(let polls=0;renderer.inspect().pending&&polls<5000;polls++){
    const result=renderer.pump();need(result===null||result.ok,
      'physical GPU continuation failed: '+result?.error?.message);
    await tick();
  }
  need(!renderer.inspect().pending&&!renderer.inspect().lost,'physical GPU work did not settle');
}
async function prepare(request){
  need(!prepared&&!machine,'one diagnostic continuation per worker');
  const configuration=validateGpuConfiguration(request.configuration);
  need(configuration.branchOrigin&&request.capture&&request.renderer,'authenticated branch input');
  need(Array.isArray(request.retainedObjects)&&request.retainedObjects.length===3523,
    'authenticated source object inventory');
  retainedObjects=new Set(request.retainedObjects);
  need(retainedObjects.size===request.retainedObjects.length,
    'duplicate source object reference');
  const image=JSON.parse(configuration.imageManifest);
  need(image.version===1&&Number.isSafeInteger(image.image_len)&&image.image_len>0
    &&Number.isSafeInteger(image.chunk_size)&&image.chunk_size>0
    &&Array.isArray(image.chunks)
    &&image.chunks.length===Math.ceil(image.image_len/image.chunk_size),
    'pinned base image chunk inventory');
  imageChunkLengths=new Map();
  for(const [index,digest]of image.chunks.entries()){
    need(typeof digest==='string'&&/^[0-9a-f]{64}$/.test(digest),'pinned base chunk hash');
    const length=Math.min(image.chunk_size,image.image_len-index*image.chunk_size);
    if(!imageChunkLengths.has(digest))imageChunkLengths.set(digest,new Set());
    imageChunkLengths.get(digest).add(length);
  }
  need(request.wasm instanceof Uint8Array&&request.wasm.buffer instanceof ArrayBuffer
    &&String(request.wasm.length)===configuration.wasm.length
    &&checkpointHash(request.wasm)===configuration.wasm.sha256,'retained Wasm identity');
  await init({module_or_path:request.wasm});store=await SessionStore.open(request.database);
  machine=WasmLinux.newExactGpuSession(request.kernel,configuration.imageManifest,
    configuration.bootargs,()=>{},false);
  let presenter;presenter=createWorkerScanoutPresenter(frame=>{
    if(frame.type==='clear'){latestFrame=null;frameVersion++;return;}
    if(frame.type==='invalidate')return;
    latestFrame={...frame,pixels:new Uint32Array(frame.pixels),
      observedAt:pos(machine.inputPosition()),
      bracketStart:chunkStart??pos(machine.inputPosition())};
    frameVersion++;
    if(!firstCandidate&&likelyDesktop(latestFrame))
      firstCandidate={...latestFrame,pixels:latestFrame.pixels.slice()};
    if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));
  });
  const source=request.renderer;
  need(checkpointHash(source.bytes)===source.sha256,'captured physical renderer identity');
  renderer=await attachProductionVirgl(machine,{presenter,checkpoint:{exactHistory:true,
    renderer:source.bytes,profile:configuration.profile,epoch:source.epoch,
    rendererSha256:source.sha256}});
  machine.beginExactBranch(request.capture.native,
    {pending:request.capture.pending,output:request.capture.output},gpuHashBytes(source.sha256));
  need(machine.exactBranchNetworkOffline(),'historical networking was not refused');
  need(JSON.stringify(JSON.parse(machine.exactGpuSessionTopology()))===JSON.stringify(configuration.devices)
    &&JSON.stringify(machine.sessionSourcePolicy())===JSON.stringify(configuration.timeEntropyPolicy),
    'restored original device/time policy');
  await renderer.activateCheckpoint();
  need(JSON.stringify(pos(machine.inputPosition()))===JSON.stringify(configuration.branchOrigin.sourcePosition),
    'activation changed source position');
  const saved=await renderer.saveCheckpoint();
  need(saved.epoch===machine.exactGpuSessionEpoch()&&saved.epoch!==source.epoch
    &&checkpointHash(saved.bytes)===saved.sha256,'restored renderer epoch and identity');
  const original=decodeCheckpointData(source.bytes.subarray(16,-32));
  const rebased=decodeCheckpointData(saved.bytes.subarray(16,-32));
  const data=value=>encodeCheckpointData(value);
  const originalLogical=structuredClone(rebased.logical);
  need(original.logical.scanout&&originalLogical.scanout,'physical scanout exists');
  originalLogical.epoch=original.logical.epoch;
  originalLogical.scanout.epoch=original.logical.scanout.epoch;
  const logicalKeys=Object.keys(original.logical);
  const changedLogicalFields=logicalKeys.filter(key=>
    checkpointHash(data(original.logical[key]))!==checkpointHash(data(rebased.logical[key])));
  const profileSha256=checkpointHash(data(original.profile));
  const contentsSha256=checkpointHash(data(original.contents));
  const sourceFrames=original.frames.length;
  const lastFrame=rebased.frames.length===sourceFrames+1
    ?decodeCheckpointData(rebased.frames.at(-1)):null;
  need(JSON.stringify(logicalKeys)===JSON.stringify(Object.keys(rebased.logical))
    &&profileSha256===checkpointHash(data(rebased.profile))
    &&contentsSha256===checkpointHash(data(rebased.contents))
    &&rebased.logical.epoch===saved.epoch
    &&rebased.logical.scanout.epoch===saved.epoch
    &&changedLogicalFields.every(key=>['epoch','scanout'].includes(key))
    &&checkpointHash(data(original.logical))===checkpointHash(data(originalLogical))
    &&original.logical.queries.length===0&&rebased.logical.queries.length===0
    &&checkpointHash(data(original.frames))===
      checkpointHash(data(rebased.frames.slice(0,sourceFrames)))
    &&lastFrame?.op==='rebase'&&lastFrame.expected===original.logical.epoch
    &&lastFrame.next===rebased.logical.epoch,
    'physical renderer changed beyond the owner epoch rebase');
  const physical={sourceSha256:source.sha256,rebasedSha256:saved.sha256,
    sourceEpoch:original.logical.epoch,rebasedEpoch:rebased.logical.epoch,
    profileSha256,contentsSha256,changedLogicalFields,
    sourceFrames,rebasedFrames:rebased.frames.length,rebase:lastFrame};
  const initial=machine.captureExactGpuKeyframe(gpuHashBytes(saved.sha256),true);
  need(JSON.stringify(pos(initial))===JSON.stringify(configuration.branchOrigin.sourcePosition),
    'captured branch origin changed');
  need(gpuHex(initial.digest)===configuration.branchOrigin.sourceDigestSha256,
    'restored branch digest differs from captured replay');
  pastConsole=Uint8Array.from(configuration.branchOrigin.consolePrefix);
  globalThis.fetch=(...values)=>{egress.fetch++;
    throw Error('offline diagnostic attempted fetch '+String(values[0]));};
  globalThis.WebSocket=class{constructor(url){egress.sockets++;
    throw Error('offline diagnostic attempted socket '+String(url));}};
  prepared=true;return {origin:{position:pos(initial),digest:gpuHex(initial.digest),
    ramDigest:gpuHex(initial.ramDigest),sourceRendererSha256:source.sha256,
    sourceRendererEpoch:source.epoch,rendererSha256:saved.sha256,
    rendererEpoch:saved.epoch,nativeSha256:checkpointHash(request.capture.native),
    pendingSha256:checkpointHash(request.capture.pending),
    outputSha256:checkpointHash(request.capture.output),
    diskSha256:checkpointHash(request.capture.disk),physical},view:view(true)};
}
async function command(request){
  if(request.type==='prepare')return prepare(request);
  need(prepared,'diagnostic continuation has no source');
  if(request.type==='inspect')return {view:view(true),missingLocalBlock,stopped};
  need(!stopped,'diagnostic continuation has stopped');
  if(request.type==='activate'){
    need(!active,'diagnostic continuation already activated');
    machine.finishSoftwareRamEpoch(true);active=true;return {view:view(true)};
  }
  need(active,'diagnostic continuation not activated');
  if(request.type==='input'){
    need(request.bytes instanceof Uint8Array&&request.bytes.buffer instanceof ArrayBuffer
      &&request.bytes.length<=65536,'owned inspection input');
    const before=pos(machine.inputPosition()),baseline=drain();
    need(baseline.events===0&&baseline.payloads===0
      &&baseline.hostOutputBytes===0
      &&JSON.stringify(pos(machine.inputPosition()))===JSON.stringify(before),
    'undrained output before diagnostic serial input');
    serialTracking=true;
    machine.sendInput(request.bytes);return {baseline,batch:drain(),view:view()};
  }
  if(request.type==='advance'){
    need(Number.isInteger(request.steps)&&request.steps>0&&request.steps<=1048576,'bounded guest run');
    try{
      for(let left=request.steps;left>0;){
        need(!renderer.inspect().lost,'physical GPU context lost');await localBlocks(request.requestId);
        await pumpGpu();
        const amount=Math.min(left,4096);chunkStart=pos(machine.inputPosition());
        const result=machine.runChunk(amount);left-=amount;
        const pumped=renderer.pump();need(pumped===null||pumped.ok,'physical GPU continuation failed: '+pumped?.error?.message);
        chunkStart=null;
        if(result.done){guestHalt={position:pos(machine.inputPosition()),result};break;}
        if(left)await tick();
      }
      await localBlocks(request.requestId);await pumpGpu();
      return {batch:drain(),view:view()};
    }catch(error){stopped=true;throw error;}
  }
  throw Error('unknown diagnostic command '+request.type);
}
function send(value){
  const buffers=new Set(),visit=item=>{
    if(item instanceof Uint8Array||item instanceof Uint32Array){
      need(item.buffer instanceof ArrayBuffer,'owned diagnostic result');buffers.add(item.buffer);
    }else if(Array.isArray(item))for(const part of item)visit(part);
    else if(item&&typeof item==='object')for(const part of Object.values(item))visit(part);
  };
  visit(value);postMessage(value,[...buffers]);
}
onmessage=event=>{
  const request=event.data;
  if(request?.type==='base-reply'||request?.type==='base-error'){
    const pending=baseWaiters.get(request.token);
    if(!pending||pending.requestId!==request.requestId){
      postMessage({type:'error',requestId:request.requestId,
        message:'unmatched offline base response'});return;}
    baseWaiters.delete(request.token);clearTimeout(pending.timer);
    if(request.type==='base-error')pending.reject(Error(String(request.message)));
    else if(request.ref?.sha256!==pending.ref.sha256
      ||String(request.ref?.length)!==pending.ref.length)
      pending.reject(Error('offline base response identity changed'));
    else pending.resolve(request.bytes);
    return;
  }
  serial=serial.catch(()=>{}).then(async()=>{
    try{send({type:'result',requestId:request.requestId,...await command(request)});}
    catch(error){postMessage({type:'error',requestId:request.requestId,
      message:String(error.message),stack:String(error.stack),stopped,missingLocalBlock});}
  });
};
postMessage({type:'initialized'});
