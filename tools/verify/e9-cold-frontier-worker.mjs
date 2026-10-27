// Private diagnostic continuation of a captured, authenticated GPU replay.
// This is deliberately separate from the production branch worker: it never
// publishes a session, writes a guest image, or enables historical networking.
import init,{WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {SessionStore} from '/session-store.js';
import {readCheckpointObject,checkpointHash} from '/session-checkpoints.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from '/renderer/virgl-command/production.mjs';
import {gpuNeed as need,gpuPosition as pos,gpuHashBytes,gpuHex,validateGpuConfiguration} from '/session-gpu-replay-format.js';

const decoder=new TextDecoder(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let machine,renderer,store,pastConsole=new Uint8Array(),latestFrame=null,firstCandidate=null;
let frameVersion=0,sentFrame=0,prepared=false,active=false,stopped=false;
let missingLocalBlock=null,guestHalt=null,serial=Promise.resolve();
const egress={fetch:0,sockets:0};
const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
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
  for(const row of batch.events)if(row.channel===21)pastConsole=tail([pastConsole,row.bytes]);
  return {events:batch.events.length,payloads:batch.payloads.length,hostOutputBytes:queues.output.length};
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
async function localBlocks(){
  for(let round=0;round<1024;round++){
    const requests=machine.exactDeviceRequests();if(!requests.length)return;
    for(const request of requests){
      need(request.intent.kind==='block','unexpected offline device request '+request.intent.kind);
      const ref={sha256:request.intent.content.sha256,length:String(request.intent.content.length)};
      let bytes;
      try{bytes=await readCheckpointObject(store,ref,1048576);}
      catch(error){missingLocalBlock={id:request.id,ref,error:String(error.message)};
        throw Error('unretained offline disk chunk '+ref.sha256+' length '+ref.length);}
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
  need(request.wasm instanceof Uint8Array&&request.wasm.buffer instanceof ArrayBuffer
    &&String(request.wasm.length)===configuration.wasm.length
    &&checkpointHash(request.wasm)===configuration.wasm.sha256,'retained Wasm identity');
  await init({module_or_path:request.wasm});store=await SessionStore.open(request.database);
  machine=WasmLinux.newExactGpuSession(request.kernel,configuration.imageManifest,
    configuration.bootargs,()=>{},false);
  let presenter;presenter=createWorkerScanoutPresenter(frame=>{
    if(frame.type==='clear'){latestFrame=null;frameVersion++;return;}
    if(frame.type==='invalidate')return;
    latestFrame={...frame,pixels:new Uint32Array(frame.pixels),position:pos(machine.inputPosition())};
    frameVersion++;
    if(!firstCandidate&&likelyDesktop(latestFrame))
      firstCandidate={...latestFrame,pixels:latestFrame.pixels.slice()};
    if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));
  });
  const source=request.renderer;
  need(checkpointHash(source.bytes)===hex(source.sha256),'captured physical renderer identity');
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
  need(saved.epoch===machine.exactGpuSessionEpoch(),'restored renderer epoch');
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
    ramDigest:gpuHex(initial.ramDigest),rendererSha256:hex(saved.sha256),
    rendererEpoch:saved.epoch,nativeSha256:checkpointHash(request.capture.native),
    pendingSha256:checkpointHash(request.capture.pending),
    outputSha256:checkpointHash(request.capture.output),
    diskSha256:checkpointHash(request.capture.disk)},view:view(true)};
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
    machine.sendInput(request.bytes);return {batch:drain(),view:view()};
  }
  if(request.type==='advance'){
    need(Number.isInteger(request.steps)&&request.steps>0&&request.steps<=1048576,'bounded guest run');
    try{
      for(let left=request.steps;left>0;){
        need(!renderer.inspect().lost,'physical GPU context lost');await localBlocks();
        await pumpGpu();
        const amount=Math.min(left,4096),result=machine.runChunk(amount);left-=amount;
        const pumped=renderer.pump();need(pumped===null||pumped.ok,'physical GPU continuation failed: '+pumped?.error?.message);
        if(result.done){guestHalt={position:pos(machine.inputPosition()),result};break;}
        if(left)await tick();
      }
      await localBlocks();await pumpGpu();
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
  serial=serial.catch(()=>{}).then(async()=>{
    try{send({type:'result',requestId:request.requestId,...await command(request)});}
    catch(error){postMessage({type:'error',requestId:request.requestId,
      message:String(error.message),stack:String(error.stack),stopped,missingLocalBlock});}
  });
};
postMessage({type:'initialized'});
