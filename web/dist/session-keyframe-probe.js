// E9-T15: real exact-session keyframes, durable RAM ancestors and private reconstruction.
import init,{WasmLinux,WasmMachine} from './pkg/wasm_vm_wasm.js';
import {sessionCanonicalImage} from './session-pkg/wasm_vm_session.js';
import {eventClockElf} from './event-clock-probe.js';
import {SessionStore} from './session-store.js';
import {SessionInputJournal} from './session-inputs.js';
import {SessionCheckpoints,checkpointHash} from './session-checkpoints.js';

export const KEYFRAME_PROBE_DATABASE='wasm-vm-sessions-v1-keyframe-proof';
export const KEYFRAME_PROBE_ID='e9-t15-keyframe';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const need=(condition,message)=>{if(!condition)throw Error(message);};
const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>['transition','retired','sequence','ordinal','phase'].every(key=>a[key]===b[key]);
const witness=(label,value)=>({label,position:{transition:value.transition,phase:value.phase,
 ordinal:value.ordinal,sequence:value.sequence,retired:value.retired},digest:hex(value.digest)});

export async function runSessionKeyframeProbe({onProgress=()=>{},onSeekFixture=null}={}){
 await init();
 const artifactsResponse=await fetch(new URL('./artifacts.json',import.meta.url));
 need(artifactsResponse.ok,'pinned assets unavailable');
 const artifacts=await artifactsResponse.json();
 const kernelUrl=new URL(artifacts.artifacts.kernel.url,import.meta.url);
 const [kernelResponse,manifestResponse,fixtureResponse]=await Promise.all([
  fetch(kernelUrl),fetch(new URL('./session-alpine-image.json',import.meta.url)),
  fetch(new URL('./session-software-fixture.json',import.meta.url))]);
 need(kernelResponse.ok&&manifestResponse.ok&&fixtureResponse.ok,'pinned assets unavailable');
 const kernel=new Uint8Array(await kernelResponse.arrayBuffer()),manifest=await manifestResponse.text();
 need(String(kernel.length)===String(artifacts.artifacts.kernel.size)
  &&checkpointHash(kernel)===artifacts.artifacts.kernel.sha256,'pinned kernel mismatch');
 const fixture=await fixtureResponse.json(),imageManifest=manifest;
 const bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i';
 const make=replay=>WasmLinux.newExactSession(kernel,manifest,bootargs,()=>{},replay);
 const source=make(false);let store,writer;
 const result={status:'running',fullBytes:0,deltas:[],attacks:[],shared:false,witnesses:[]};
 try{
  const initial=source.exactSessionWitness(true);
  result.witnesses.push(witness('initial',initial));
  const wasmUrl=new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url);
  const wasmBytes=new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  const base=checkpointHash(sessionCanonicalImage(imageManifest));
  const disk=new Uint8Array(61),dv=new DataView(disk.buffer);
  disk.set(encoder.encode('WVOD1'));dv.setUint32(5,4096,true);
  dv.setBigUint64(9,BigInt(fixture.raw_image_bytes),true);
  disk.set(Uint8Array.from(base.match(/../g),byte=>parseInt(byte,16)),17);
  const configuration={version:1,exactSession:1,providersComplete:true,runtime:'rv64-linux-exact-session-v1',ramMib:256,bootargs,
   clock:{mode:'icount',divider:10,timebase_hz:'10000000',interactive:null},
   kernel:{url:kernelUrl.href,sha256:checkpointHash(kernel),length:String(kernel.length)},
   wasm:{url:wasmUrl.href,sha256:checkpointHash(wasmBytes),length:String(wasmBytes.length)},
   devices:JSON.parse(source.softwareCheckpointTopology()),imageManifest,baseUrl:fixture.base_url,
   timeEntropyPolicy:source.sessionSourcePolicy(),
   deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},
   networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
  store=await SessionStore.open(KEYFRAME_PROBE_DATABASE);
  if(await store.openSession(KEYFRAME_PROBE_ID))await store.deleteSession(KEYFRAME_PROBE_ID);
  if(await store.openSession(KEYFRAME_PROBE_ID+'-sibling'))await store.deleteSession(KEYFRAME_PROBE_ID+'-sibling');
  writer=await store.writer(KEYFRAME_PROBE_ID);
  onProgress('Publishing the initial exact-session checkpoint');
  const journal=await SessionInputJournal.createLiveExact(store,writer,configuration,initial.resume,disk,initial);
  let unfinished='';try{await SessionInputJournal.readExact(store,KEYFRAME_PROBE_ID,{configuration});}
  catch(error){unfinished=String(error);}
  need(/exact state witnesses unavailable/.test(unfinished),'unfinished live recording must not replay');
  result.attacks.push({name:'unfinished-replay',message:unfinished});
  result.fullBytes=initial.resume.length;
  const initialStoredBytes=(await store.statistics()).payloadBytes;
  source.sendInput(new Uint8Array([120]));journal.stage(source.takeExactSessionDeliveries());
  const first=source.runChunk(64);need(!first.done,'guest ended before first keyframe');
  journal.stage(source.takeExactSessionDeliveries());await journal.flush();
  onProgress('Capturing first dirty-page delta');
  result.deltas.push(await journal.captureKeyframe(store,source,configuration,'delta-1'));
  result.witnesses.push(witness('delta-1',source.exactSessionWitness(false)));
  const second=source.runChunk(1000000);need(!second.done,'guest ended before second keyframe');
  journal.stage(source.takeExactSessionDeliveries());await journal.flush();
  onProgress('Capturing second dirty-page delta');
  result.deltas.push(await journal.captureKeyframe(store,source,configuration,'delta-2'));
  const atDelta2=source.exactSessionWitness(false);
  result.witnesses.push(witness('delta-2',atDelta2));
  result.depths=[1,2];
  for(let depth=3;depth<=8;depth++){
   const stats=await journal.captureKeyframe(store,source,configuration,`delta-${depth}`);
   need(stats.depth===depth&&stats.dirtyPages===0,'bounded empty-delta chain');
   result.depths.push(stats.depth);
  }
  let limit='';try{await journal.captureKeyframe(store,source,configuration,'delta-9');}
  catch(error){limit=String(error);}
  need(/full base checkpoint required/.test(limit),'ninth delta must require a full base');
  result.attacks.push({name:'chain-limit',message:limit});
  const beforeRebase=source.inputPosition().transition;
  const advance=source.runChunk(100);need(!advance.done,'guest ended before full rebase');
  journal.stage(source.takeExactSessionDeliveries());await journal.flush();
  need(BigInt(source.inputPosition().transition)>BigInt(beforeRebase),'full rebase advances the session end');
  result.rebase=await journal.captureKeyframe(store,source,configuration,'base-2',{full:true});
  need(result.rebase.depth===0,'new full base resets chain');
  const atRebase=source.exactSessionWitness(false);
  const afterRebase=source.runChunk(1000000);
  need(!afterRebase.done,'guest ended before post-rebase delta');
  journal.stage(source.takeExactSessionDeliveries());await journal.flush();
  onProgress('Capturing a RAM delta after the new full base');
  result.postRebase=await journal.captureKeyframe(store,source,configuration,'delta-after-rebase');
  need(result.postRebase.depth===1&&result.postRebase.dirtyPages>0,
   'post-rebase guest writes must produce a depth-one delta');
  result.historyGrowthBytes=(await store.statistics()).payloadBytes-initialStoredBytes;
  need(result.historyGrowthBytes<=256*1048576,'software history growth budget');
  need([...result.deltas,result.rebase,result.postRebase].every(value=>value.pauseMs<=5000&&value.maxStagedBytes<=64*1048576),
   'software checkpoint pause/staging budget');
  const final=source.exactSessionWitness(true);
  result.witnesses.push(witness('rebase',atRebase));
  result.witnesses.push(witness('post-rebase-delta',final));
  need(!same(final,initial)&&hex(final.digest)!==hex(initial.digest),'recording reached a new state');
  const changed={...initial,digest:initial.digest.slice()};changed.digest[0]^=1;
  let changedInitial='';try{await journal.completeExact(final,[changed,final]);}
  catch(error){changedInitial=String(error);}
  need(/exact immutable initial witness commitment/.test(changedInitial),
   'live completion must preserve initial state digest');
  result.attacks.push({name:'changed-initial',message:changedInitial});
  await journal.completeExact(final,[initial,final]);
  await writer.release();writer=null;
  const read=await SessionInputJournal.readExact(store,KEYFRAME_PROBE_ID,{configuration});
  need(read.manifest.checkpoints.length===11,'published checkpoint count');
  const replay=make(true);
  try{
   replay.beginExactReplay(read.initialResume,read.receipts,read.witnesses,final);
   const outcome=replay.runExactReplayToEnd(4096);
   need(outcome.status==='Completed'&&outcome.transition===final.transition
    &&hex(replay.exactSessionWitness(false).digest)===hex(final.digest),
    'live recording replays to the same final state');
   result.liveReplay={status:outcome.status,transition:outcome.transition,eventCursor:outcome.eventCursor,
    digest:hex(final.digest)};
  }finally{replay.free();}
  const restored=make(true);
  try{
   const stats=await new SessionCheckpoints(store).restoreExactDeltaToCandidate(KEYFRAME_PROBE_ID,'delta-2',restored);
   need(hex(restored.exactSessionWitness(false).digest)===hex(atDelta2.digest),'reconstructed exact native frame');
   need(stats.restoreMs<=5000&&stats.maxStagedBytes<=64*1048576,'software restore budget');
   result.restore=stats;
  }finally{restored.free();}
  const afterRebaseCandidate=make(true);
  try{
   const stats=await new SessionCheckpoints(store).restoreExactDeltaToCandidate(
    KEYFRAME_PROBE_ID,'delta-after-rebase',afterRebaseCandidate);
   const independent=afterRebaseCandidate.exactSessionWitness(true);
   need(hex(independent.digest)===hex(final.digest)
    &&independent.resume.length===final.resume.length
    &&independent.resume.every((byte,index)=>byte===final.resume[index]),
   'post-rebase delta must reconstruct the independent complete snapshot');
   need(stats.depth===1&&stats.appliedPages===result.postRebase.dirtyPages
    &&stats.restoreMs<=5000&&stats.maxStagedBytes<=64*1048576,
   'post-rebase restore budget and page count');
   result.postRebaseRestore={...stats,fullSnapshotBytes:independent.resume.length,
    fullSnapshotSha256:checkpointHash(independent.resume)};
  }finally{afterRebaseCandidate.free();}
  if(onSeekFixture)await onSeekFixture({store,id:KEYFRAME_PROBE_ID,configuration,make,read,
   initial,final,atDelta2,atRebase});
  const sibling=structuredClone(read.manifest);sibling.id=KEYFRAME_PROBE_ID+'-sibling';
  const siblingWriter=await store.writer(sibling.id);
  try{await siblingWriter.publish(encoder.encode(JSON.stringify(sibling)));}
  finally{await siblingWriter.release();}
  const original=await store.openSession(KEYFRAME_PROBE_ID);
  const descriptor=JSON.parse(decoder.decode(await (async()=>{
   const bytes=[];for await(const part of store.stream(original&&read.manifest.checkpoints[1].machine))bytes.push(...part);
   return Uint8Array.from(bytes);})()).slice(8));
  const ancestor=descriptor.chunks[0];
  need(ancestor,'first delta must contain guest RAM writes');
  const db=await new Promise((resolve,reject)=>{const open=indexedDB.open(KEYFRAME_PROBE_DATABASE);
   open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  const edit=(table,key,value)=>new Promise((resolve,reject)=>{const tx=db.transaction(table,'readwrite',{durability:'strict'});
   if(value===undefined)tx.objectStore(table).delete(key);else tx.objectStore(table).put(value,key);
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const get=(table,key)=>new Promise((resolve,reject)=>{const request=db.transaction(table).objectStore(table).get(key);
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const object=await get('objects',ancestor.sha256),part=object.parts[0],savedChunk=await get('chunks',part.sha256);
  await edit('chunks',part.sha256,undefined);
  const candidate=make(true);let missing='';
  try{const before=hex(candidate.exactSessionWitness(false).digest);
   try{await new SessionCheckpoints(store).restoreExactDeltaToCandidate(KEYFRAME_PROBE_ID,'delta-2',candidate);}
   catch(error){missing=String(error);}
   need(/MissingObject|Corrupt|Storage/.test(missing)&&hex(candidate.exactSessionWitness(false).digest)===before,
    'missing ancestor must refuse without candidate mutation');
  }finally{candidate.free();await edit('chunks',part.sha256,savedChunk);db.close();}
  result.attacks.push({name:'missing-ancestor',message:missing});
  const tamperDb=await new Promise((resolve,reject)=>{const open=indexedDB.open(KEYFRAME_PROBE_DATABASE);
   open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  const tamper=(value)=>new Promise((resolve,reject)=>{const tx=tamperDb.transaction('chunks','readwrite',{durability:'strict'});
   tx.objectStore('chunks').put(value,part.sha256);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const corruptBytes=new Uint8Array(await savedChunk.arrayBuffer());corruptBytes[0]^=1;
  await tamper(new Blob([corruptBytes]));
  const corruptCandidate=make(true);let corrupted='';
  try{const before=hex(corruptCandidate.exactSessionWitness(false).digest);
   try{await new SessionCheckpoints(store).restoreExactDeltaToCandidate(KEYFRAME_PROBE_ID,'delta-2',corruptCandidate);}
   catch(error){corrupted=String(error);}
   need(/Corrupt/.test(corrupted)&&hex(corruptCandidate.exactSessionWitness(false).digest)===before,
    'corrupt ancestor must refuse before candidate mutation');
  }finally{corruptCandidate.free();await tamper(savedChunk);tamperDb.close();}
  result.attacks.push({name:'corrupt-ancestor',message:corrupted});
  await store.deleteSession(KEYFRAME_PROBE_ID);
  const shared=await store.openSession(sibling.id);
  need(shared&&await store.objectReference(ancestor.sha256),'sibling must retain shared delta chunk');
  result.shared=true;
  const loop=eventClockElf(false),view=new DataView(loop.buffer);
  view.setUint32(0x1000,0x00004e17,true); // auipc x28,4: the data page at BASE+0x4000
  view.setUint32(0x1004,0x00108093,true); // addi x1,x1,1
  view.setUint32(0x1008,0x001e3023,true); // sd x1,0(x28)
  view.setUint32(0x100c,0xff9ff06f,true); // jal x0,-8
  const plain=new WasmMachine(1),jit=new WasmMachine(1);
  try{
   for(const machine of [plain,jit])machine.loadElf(loop);
   jit.enableJit(1);
   for(const machine of [plain,jit])machine.run(2000);
   need(plain.stateDigest()===jit.stateDigest(),'interpreter/JIT store state');
   const stats=jit.jitStats(),marks=jit.jitDirectStoreMarks();
   need(stats.compiledBlocks>0&&stats.executedBlocks>0&&stats.retiredViaJit>0&&marks>0,
    `direct JIT stores reached RAM dirty tracker: compiled=${stats.compiledBlocks} executed=${stats.executedBlocks} marks=${marks}`);
   result.jitStore={compiledBlocks:stats.compiledBlocks,executedBlocks:stats.executedBlocks,
    retiredViaJit:stats.retiredViaJit,directMarks:marks};
  }finally{plain.free();jit.free();}
  result.status='passed';
  return result;
 }finally{if(writer)await writer.release();if(store)await store.close();source.free();}
}
