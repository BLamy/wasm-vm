// Built-browser acceptance of the pinned full Linux software session through the shared replay
// driver. Recording fetches one authenticated base chunk; replay has no live providers.
import {WasmLinux} from './pkg/wasm_vm_wasm.js';
import {encodeNetworkEvent} from './session-network.js';
import {checkpointHash} from './session-checkpoints.js';
import {SessionStore} from './session-store.js';
import {SessionInputJournal} from './session-inputs.js';
import {sessionCanonicalImage} from './session-pkg/wasm_vm_session.js';

const need=(value,message)=>{if(!value)throw Error('exact replay: '+message);};
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i';
export const REPLAY_PROBE_DATABASE='wasm-vm-sessions-v1-exact-replay-proof';
export const REPLAY_PROBE_ID='alpine-exact';

export async function runSessionReplayProbe({onProgress}={}){
 const artifacts=await (await fetch(new URL('./artifacts.json',import.meta.url))).json();
 const kernelUrl=new URL(artifacts.artifacts.kernel.url,import.meta.url);
 const [kernelResponse,manifestResponse]=await Promise.all([
  fetch(kernelUrl),
  fetch(new URL('./session-alpine-image.json',import.meta.url))
 ]);
 need(kernelResponse.ok&&manifestResponse.ok,'pinned assets unavailable');
 const kernel=new Uint8Array(await kernelResponse.arrayBuffer());
 const manifest=await manifestResponse.text();
 const fixture=await (await fetch(new URL('./session-software-fixture.json',import.meta.url))).json();
 const make=replay=>WasmLinux.newExactSession(kernel,manifest,bootargs,()=>{},replay);
 const original=make(false);let rows=[], witnesses=[];
 let initial, final, output;
 try{
  initial=original.exactSessionWitness(true);witnesses.push(initial);
  original.sendInput(new Uint8Array([120]));
  rows.push(...original.takeExactSessionDeliveries());
  const first=original.runChunk(64);need(!first.done,'original ended at first boundary');
  rows.push(...original.takeExactSessionDeliveries());witnesses.push(original.exactSessionWitness(false));
  const second=original.runChunk(999936);need(!second.done,'original ended before declared end');
  rows.push(...original.takeExactSessionDeliveries());witnesses.push(original.exactSessionWitness(false));
  let blockCompletions=0,networkCompletions=0;const progress=[];
  for(let pass=0;pass<300&&blockCompletions===0;pass++){
   if(pass%25===0){onProgress?.(`Recording Alpine Linux · ${pass} million guest instructions`);await new Promise(resolve=>setTimeout(resolve,0));}
   const state=original.runChunk(1000000);need(!state.done,'guest ended before base-block request: '+state.state);
   rows.push(...original.takeExactSessionDeliveries());
   if(pass%50===0)progress.push({pass,position:original.inputPosition().transition,retired:state.retired,deviceRequests:original.exactDeviceRequests().length,networkRequests:original.exactNetworkRequests().length});
   for(const request of original.exactNetworkRequests()){
    const lease=original.exactLeaseNetworkRequest(request.id);
    try{original.exactCompleteNetworkEvent(lease,encodeNetworkEvent(1,{id:request.id,result:1,payload:request.frame}));}
    finally{lease.free();}
    networkCompletions++;
   }
   rows.push(...original.takeExactSessionDeliveries());
   const request=original.exactDeviceRequests().find(r=>r.intent.kind==='block');
   if(request){
    const url=new URL(`chunks/${request.intent.content.sha256}.bin`,fixture.base_url).href;
    const response=await fetch(url);need(response.ok,'pinned base chunk fetch');
    const bytes=new Uint8Array(await response.arrayBuffer());
    need(bytes.length===request.intent.content.length,'pinned base chunk length');
    const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
    need(digest===request.intent.content.sha256,'pinned base chunk hash');
    const lease=original.exactLeaseDeviceRequest(request.id);
    try{original.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}
    blockCompletions++;rows.push(...original.takeExactSessionDeliveries());
   }
  }
  need(blockCompletions===1,'real Linux base-block completion reached '+JSON.stringify(progress));
  const after=original.runChunk(100000);need(!after.done,'guest ended after base-block DMA');
  rows.push(...original.takeExactSessionDeliveries());
  final=original.exactSessionWitness(true);witnesses.push(final);
  need(rows.some(r=>r.kind==='host'&&r.channel===1)&&rows.some(r=>r.kind==='host'&&r.channel===2),'real UART offer/feed receipts');
  need(rows.every((r,i)=>i===0||BigInt(r.sequence)>BigInt(rows[i-1].sequence)),'ordered receipts');
  let store,writer;
  try{
   const wasmUrl=new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href;
   const wasmBytes=new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
   const imageManifest=manifest;
   const base=checkpointHash(sessionCanonicalImage(imageManifest));
   const disk=new Uint8Array(61),view=new DataView(disk.buffer);
   disk.set(new TextEncoder().encode('WVOD1'));view.setUint32(5,4096,true);view.setBigUint64(9,BigInt(fixture.raw_image_bytes),true);
   disk.set(Uint8Array.from(base.match(/../g),h=>parseInt(h,16)),17);
   const configuration={version:1,exactSession:1,providersComplete:true,runtime:'rv64-linux-exact-session-v1',ramMib:256,bootargs,
    clock:{mode:'icount',divider:10,timebase_hz:'10000000',interactive:null},
    kernel:{url:kernelUrl.href,sha256:checkpointHash(kernel),length:String(kernel.length)},
    wasm:{url:wasmUrl,sha256:checkpointHash(wasmBytes),length:String(wasmBytes.length)},
    devices:JSON.parse(original.softwareCheckpointTopology()),imageManifest,baseUrl:fixture.base_url,
    timeEntropyPolicy:original.sessionSourcePolicy(),
    deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},
    networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
   store=await SessionStore.open(REPLAY_PROBE_DATABASE);
   if(await store.openSession(REPLAY_PROBE_ID))await store.deleteSession(REPLAY_PROBE_ID);
   writer=await store.writer(REPLAY_PROBE_ID);
   const journal=await SessionInputJournal.createExact(store,writer,configuration,initial.resume,disk,witnesses);
   journal.stage(rows);await journal.flush();await journal.completeExact(final,witnesses);
   await writer.release();writer=null;await store.close();store=null;
   store=await SessionStore.open(REPLAY_PROBE_DATABASE);
   const opened=await SessionInputJournal.readExact(store,REPLAY_PROBE_ID,{configuration});
   need(opened.admitted&&opened.receipts.length===rows.length&&opened.manifest.policy.mode==='exact-replay','durable event tape reopened and admitted to exact runtime');
   let wrongRuntime=false;try{await SessionInputJournal.readExact(store,REPLAY_PROBE_ID,{configuration:{...configuration,clock:{...configuration.clock,divider:11}}});}
   catch(error){wrongRuntime=/exact replay runtime or provider identity/.test(String(error));}
   need(wrongRuntime,'changed runtime refused before replay');
   const canonical=events=>JSON.stringify(events.map(r=>[r.transition,r.retired,r.sequence,r.ordinal,r.channel,r.ticket,r.outcome,[...r.bytes]]));
   need(canonical(opened.receipts)===canonical(rows),'durable exact event bytes and order');
   rows=opened.receipts;witnesses=opened.witnesses;initial.resume=opened.initialResume;
   await store.close();store=null;
  }finally{if(writer)await writer.release();if(store)await store.close();}
  output={begin:{transition:initial.transition,sequence:initial.sequence},end:{transition:final.transition,sequence:final.sequence},
   digest:hex(final.digest),events:rows.length,eventKinds:rows.map(r=>r.kind),
   blockCompletions,networkCompletions,durable:{database:REPLAY_PROBE_DATABASE,id:REPLAY_PROBE_ID},replays:[]};
  onProgress?.('Replaying the saved session on the interpreter and JIT');
  const liveFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('exact replay attempted live fetch');};
  try{for(const [label,jit,quantum] of [['interpreter',false,7],['jit',true,4096]]){
   const replay=make(true);
   try{
    if(jit)replay.enableJit(1);else replay.setFastInterpreter(false);
    replay.beginExactReplay(initial.resume,rows,witnesses,final);
    let result;
    try{result=replay.runExactReplayToEnd(quantum);}catch(error){
     const observed=replay.exactSessionWitness(true);let first=-1;
     for(let i=0;i<Math.min(final.resume.length,observed.resume.length);i++)if(final.resume[i]!==observed.resume[i]){first=i;break;}
     let at=84,tag='header';const view=new DataView(final.resume.buffer,final.resume.byteOffset,final.resume.byteLength);
     while(at+8<=final.resume.length){const n=view.getUint32(at,true),len=view.getUint32(at+4,true);if(first<at+8+len){tag=String(n);break;}at+=8+len;}
     throw Error(`${error}; first byte=${first}, section=${tag}, expected=${final.resume[first]}, observed=${observed.resume[first]}, lengths=${final.resume.length}/${observed.resume.length}`);
    }
    const observed=replay.exactSessionWitness(false);
    need(result.status==='Completed'&&result.transition===final.transition,'declared replay end '+label);
    need(hex(observed.digest)===hex(final.digest),'complete native CPU/RAM/device/disk frame '+label);
    const stats=replay.jitStats();
    output.replays.push({label,quantum,digest:hex(observed.digest),position:result.transition,
      events:result.eventCursor,hasExecutor:stats?.hasExecutor??false,
      compiledBlocks:stats?.compiledBlocks??0,executedBlocks:stats?.executedBlocks??0,
      retiredViaJit:stats?.retiredViaJit??0});
    let exhausted=false;try{replay.runExactReplayToEnd(1)}catch(e){exhausted=/Exhausted|stopped/.test(String(e));}
    need(exhausted,'replay cannot continue past end '+label);
    let liveBlocked=false;try{replay.sendInput(new Uint8Array([121]));}catch(e){liveBlocked=/forbidden|replay/.test(String(e));}
    need(liveBlocked,'replay live ingress blocked '+label);
    let deviceIngressBlocked=false,networkIngressBlocked=false;
    try{replay.exactLeaseDeviceRequest('1');}catch(e){deviceIngressBlocked=/ReplayIngress/.test(String(e));}
    try{replay.exactLeaseNetworkRequest('');}catch(e){networkIngressBlocked=/ReplayIngress/.test(String(e));}
    need(deviceIngressBlocked&&networkIngressBlocked,'unbranched device and network providers blocked after replay '+label);
    need(hex(replay.exactSessionWitness(false).digest)===hex(observed.digest),'replay end state unchanged after refused provider ingress '+label);
    output.replays[output.replays.length-1].adapterIngressBlocked=true;
   }finally{replay.free();}
  }}finally{globalThis.fetch=liveFetch;}
  need(same(output.replays.map(r=>r.digest),[output.digest,output.digest]),'cross-tier state');
  output.attacks=[];
  const mutated=rows.map(row=>({...row,bytes:row.bytes.slice()}));
  need(mutated[0].bytes.length>0,'first event payload available');mutated[0].bytes[0]^=1;
  const corrupted=make(true);try{
   corrupted.beginExactReplay(initial.resume,mutated,witnesses,final);
   let message;try{corrupted.runExactReplayToEnd(4096);}catch(error){message=String(error);}
   need(message&&/EventPayload/.test(message)&&message.includes(`transition: ${rows[1].transition}`)
    &&message.includes(`ordinal: ${rows[1].ordinal}`)&&/event_index: 1\b/.test(message),'first changed input reports exact first event divergence; observed '+message);
   output.attacks.push({kind:'changed-input',position:rows[1].transition,ordinal:rows[1].ordinal,message});
  }finally{corrupted.free();}
  const observationIndex=rows.findIndex(row=>row.kind==='observation');
  need(observationIndex>=0,'recorded observation available');
  const wrongTicket=rows.map(row=>({...row,bytes:row.bytes.slice()}));
  wrongTicket[observationIndex].ticket=String(BigInt(wrongTicket[observationIndex].ticket)+1n);
  const observed=make(true);try{
   observed.beginExactReplay(initial.resume,wrongTicket,witnesses,final);
   let message;try{observed.runExactReplayToEnd(4096);}catch(error){message=String(error);}
   const position=rows[observationIndex];
   need(message&&/EventPayload/.test(message)
    &&message.includes(`transition: ${position.transition}`)
    &&message.includes(`retired: ${position.retired}`)
    &&message.includes('phase: Observe')
    &&message.includes(`ordinal: ${position.ordinal}`)
    &&message.includes(`sequence: ${position.sequence}`)
    &&message.includes(`event_index: ${observationIndex}`),
    'changed observation ticket reports exact first receipt coordinate; observed '+message);
   output.attacks.push({kind:'changed-observation-ticket',position:position.transition,ordinal:position.ordinal,message});
  }finally{observed.free();}
  const wrongKind=rows.map(row=>({...row,bytes:row.bytes.slice()}));
  const changedObservation=wrongKind[observationIndex];
  if(changedObservation.sourceKind===6){
   changedObservation.sourceKind=1;
   changedObservation.requested=8;
   if(changedObservation.status===0){
    const bytes=new Uint8Array(8);bytes.set(changedObservation.bytes.slice(0,8));
    changedObservation.bytes=bytes;
   }
  }else changedObservation.sourceKind=changedObservation.sourceKind===1?5:1;
  const changedSource=make(true);try{
   changedSource.beginExactReplay(initial.resume,wrongKind,witnesses,final);
   let message;try{changedSource.runExactReplayToEnd(4096);}catch(error){message=String(error);}
   const position=rows[observationIndex];
   need(message&&/EventPayload/.test(message)
    &&message.includes(`transition: ${position.transition}`)
    &&message.includes(`retired: ${position.retired}`)
    &&message.includes('phase: Observe')
    &&message.includes(`ordinal: ${position.ordinal}`)
    &&message.includes(`sequence: ${position.sequence}`)
    &&message.includes(`event_index: ${observationIndex}`),
    'changed observation kind reports its guest coordinate; observed '+message);
   output.attacks.push({kind:'changed-observation-kind',position:position.transition,ordinal:position.ordinal,message});
  }finally{changedSource.free();}
  const dmaIndex=rows.findIndex(row=>row.channel===19);
  need(dmaIndex>=0,'real DMA delivery available');
  const withoutDma=rows.map(row=>({...row,bytes:row.bytes.slice()}));withoutDma[dmaIndex].bytes=withoutDma[dmaIndex].bytes.subarray(0,10);
  const missing=make(true);try{
   missing.beginExactReplay(initial.resume,withoutDma,witnesses,final);
   let message;try{missing.runExactReplayToEnd(4096);}catch(error){message=String(error);}
   need(message&&/Adapter/.test(message)&&message.includes(`transition: ${rows[dmaIndex].transition}`),'missing DMA reports exact delivery position; observed '+message);
   output.attacks.push({kind:'omitted-dma',position:rows[dmaIndex].transition,message});
  }finally{missing.free();}
  output.status='passed';return output;
 }finally{original.free();}
}
