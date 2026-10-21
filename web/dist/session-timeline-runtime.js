// E9-T19: a UI adapter over the accepted exact-session recorder and private seek owner.
import init,{WasmLinux} from './pkg/wasm_vm_wasm.js';
import {SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';
import {SessionInputJournal} from './session-inputs.js';
import {SessionSeekController} from './session-seek.js';
import {readCheckpointObject,checkpointHash} from './session-checkpoints.js';
import {sessionCanonicalImage} from './session-pkg/wasm_vm_session.js';

const decoder=new TextDecoder(),encoder=new TextEncoder();
const need=(v,message)=>{if(!v)throw Error(message);};
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const pos=p=>({transition:p.transition,retired:p.retired,sequence:p.sequence,ordinal:p.ordinal,phase:p.phase});
const bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i';
const consoleLimit=65536;
export function renderReplayConsole(read,candidate,at){
  const witness=candidate.exactSessionWitness(false),queues=candidate.exactSessionHostQueues();
  need(['transition','retired','sequence','ordinal','phase'].every(k=>witness[k]===at[k]),'Replay view position mismatch');
  const chunks=read.receipts.filter(r=>r.kind==='host'&&r.channel===21&&BigInt(r.sequence)<=BigInt(at.sequence)).map(r=>r.bytes);
  chunks.push(queues.output);let bytes=new Uint8Array(Math.min(consoleLimit,chunks.reduce((n,b)=>n+b.length,0))),offset=bytes.length;
  for(let i=chunks.length-1;i>=0&&offset>0;i--){const part=chunks[i].subarray(Math.max(0,chunks[i].length-offset));offset-=part.length;bytes.set(part,offset);}
  return {position:pos(at),digest:hex(witness.digest),console:decoder.decode(bytes)};
}
export async function openTimelineReplay({store,id,onPublish,onProgress,beforeFrame=async()=>{}}){
  await init();
  const opened=await store.openSession(id);need(opened,'Saved session is unavailable');
  const manifest=JSON.parse(decoder.decode(opened.manifest));
  need(manifest.policy.mode==='exact-replay'&&manifest.policy.profile==='rv64-linux-software-v1'&&manifest.machine.gpu===null,
    manifest.machine.gpu?'This accelerated session supports checkpoints. GPU replay is awaiting verification.':'Finish and save an exact recording before replaying it.');
  const vm=manifest.assets.find(a=>a.role==='vm');need(vm,'Saved guest configuration is missing');
  const configuration=JSON.parse(decoder.decode(await readCheckpointObject(store,vm.content,1048576)));
  need(configuration.version===1&&configuration.runtime==='rv64-linux-exact-session-v1'&&configuration.ramMib===256
    &&configuration.wasm?.sha256===SOFTWARE_CHECKPOINT_WASM_SHA256,'This recording uses an incompatible guest build.');
  const read=await SessionInputJournal.readExact(store,id,{configuration});
  const kernelRef=manifest.assets.find(a=>a.role==='kernel')?.content;need(kernelRef,'Saved kernel is missing');
  const kernel=await readCheckpointObject(store,kernelRef,64*1048576);
  const makeReplay=()=>WasmLinux.newExactSession(kernel,configuration.imageManifest,configuration.bootargs,()=>{},true);
  const controller=new SessionSeekController({read,store,id,makeReplay,quantum:4096,
    render:async(candidate,at)=>{const frame=renderReplayConsole(read,candidate,at);await beforeFrame(frame);return frame;},onPublish,onProgress});
  return {controller,manifest,events:read.receipts,configuration};
}

// A bounded, real Linux boot excerpt gives a new library a useful recording.
// This is a separate guest; it does not turn the current live guest into a recording.
export async function recordTimelineSample({store,id,onProgress=()=>{},signal}){
  await init();
  const asset=await (await fetch(new URL('./artifacts.json',import.meta.url))).json();
  const kernelUrl=new URL(asset.artifacts.kernel.url,import.meta.url);
  const [kernelResponse,imageResponse,fixtureResponse,wasmResponse]=await Promise.all([
    fetch(kernelUrl),fetch(new URL('./session-alpine-image.json',import.meta.url)),
    fetch(new URL('./session-software-fixture.json',import.meta.url)),fetch(new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url))]);
  need([kernelResponse,imageResponse,fixtureResponse,wasmResponse].every(r=>r.ok),'The sample guest assets could not be loaded.');
  const kernel=new Uint8Array(await kernelResponse.arrayBuffer()),imageManifest=await imageResponse.text(),fixture=await fixtureResponse.json(),wasm=new Uint8Array(await wasmResponse.arrayBuffer());
  need(checkpointHash(kernel)===asset.artifacts.kernel.sha256&&String(kernel.length)===String(asset.artifacts.kernel.size)
    &&checkpointHash(wasm)===SOFTWARE_CHECKPOINT_WASM_SHA256,'Sample guest asset identity mismatch');
  const source=WasmLinux.newExactSession(kernel,imageManifest,bootargs,()=>{},false);let writer,created=false,completed=false;
  try{
    const initial=source.exactSessionWitness(true),base=checkpointHash(sessionCanonicalImage(imageManifest));
    const disk=new Uint8Array(61),view=new DataView(disk.buffer);disk.set(encoder.encode('WVOD1'));view.setUint32(5,4096,true);view.setBigUint64(9,BigInt(fixture.raw_image_bytes),true);disk.set(Uint8Array.from(base.match(/../g),b=>parseInt(b,16)),17);
    const configuration={version:1,exactSession:1,providersComplete:true,runtime:'rv64-linux-exact-session-v1',ramMib:256,bootargs,
      clock:{mode:'icount',divider:10,timebase_hz:'10000000',interactive:null},
      kernel:{url:kernelUrl.href,sha256:checkpointHash(kernel),length:String(kernel.length)},
      wasm:{url:new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:checkpointHash(wasm),length:String(wasm.length)},
      devices:JSON.parse(source.softwareCheckpointTopology()),imageManifest,baseUrl:fixture.base_url,timeEntropyPolicy:source.sessionSourcePolicy(),
      deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
    writer=await store.writer(id);need(!await store.openSession(id),'A sample with this ID already exists');created=true;
    onProgress('Saving the initial Linux state…');
    const journal=await SessionInputJournal.createLiveExact(store,writer,configuration,initial.resume,disk,initial);
    source.sendInput(new Uint8Array([120]));
    const checkpoints=[64,1000000,3000000];let executed=0;
    for(const target of checkpoints){
      do{
        const amount=Math.min(32768,target-executed),state=source.runChunk(amount);need(!state.done,'The sample guest stopped unexpectedly.');executed+=amount;
        journal.stage(source.takeExactSessionDeliveries());
        // The excerpt stays before external disk I/O; refuse instead of inventing data.
        need(source.exactDeviceRequests().length===0&&source.exactNetworkRequests().length===0,'Sample reached an external request; stop and retry with the pinned guest.');
        if(journal.pending>128)await journal.flush();
        onProgress(`Recording Linux boot · ${source.inputPosition().transition} transitions`);await tick();
      }while(executed<target&&!signal?.aborted);
      await journal.flush();
      onProgress('Saving a replay point…');
      await journal.captureKeyframe(store,source,configuration,`point-${source.inputPosition().transition}`);
      if(signal?.aborted)break;
    }
    const final=source.exactSessionWitness(false);await journal.completeExact(final,[initial,final]);completed=true;
    return {id,end:pos(final),digest:hex(final.digest)};
  }finally{source.free();await writer?.release();if(created&&!completed)await store.deleteSession(id);}
}
