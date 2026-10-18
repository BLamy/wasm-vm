import {WasmMachine} from './pkg/wasm_vm_wasm.js';
import {checkpointHash,readCheckpointObject} from './session-checkpoints.js';
import {SessionStore} from './session-store.js';
import {SessionInputJournal} from './session-inputs.js';
import {sessionCanonicalImage,sessionEventReferences,sessionManifestReferences} from './session-pkg/wasm_vm_session.js';
import {deviceEventParts,splitDeviceCompletion} from './session-devices.js';
export const DEVICE_PROBE_DATABASE='wasm-vm-sessions-v1-device-completion-proof';
const need=(ok,why)=>{if(!ok)throw Error('device completion: '+why);};
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const canonical=rows=>JSON.stringify(rows.map(r=>[r.transition,r.phase,r.ordinal,r.sequence,r.retired,r.channel,r.outcome,[...r.bytes]]));
const own=r=>({...r,bytes:r.bytes.slice(),outcome:[...r.outcome]});
const payload=chunk=>Uint8Array.from({length:512},(_,i)=>(i*13+chunk*79+17)%251);
const source=new TextEncoder(),decode=new TextDecoder();
export async function runDeviceCompletionsProbe(){
 const [elf,meta,wasm]=await Promise.all(['assets/e9-device-completions.elf','assets/e9-device-completions.json','pkg/wasm_vm_wasm_bg.wasm'].map(async path=>{const r=await fetch(new URL(path,import.meta.url));need(r.ok,'asset '+path);return path.endsWith('.json')?r.json():new Uint8Array(await r.arrayBuffer());}));
 need(checkpointHash(elf.subarray(120))===meta.sha256,'guest program');
 const chunks=[payload(0),payload(1)],imageManifest=JSON.stringify({version:1,image_len:1024,chunk_size:512,layout:'split',chunks:chunks.map(checkpointHash)});
 const base=checkpointHash(sessionCanonicalImage(imageManifest));
 const policy={version:1,base:{identity:base,sectors:'2',chunk_bytes:512,chunks:chunks.map(bytes=>({sha256:checkpointHash(bytes),length:bytes.length}))},agent:true,capture:true};
 const fresh=replay=>{const machine=new WasmMachine(16);machine.loadElf(elf);machine.startEventClock(1,1);machine.installDeviceSession(JSON.stringify(policy),replay);machine.setTrace(true);return machine;};
 const run=(machine,target,quantum)=>{while(BigInt(machine.eventPosition().transition)<BigInt(target))machine.runEventUntil(String(target),quantum);};
 const report={status:'running',scope:'Real guest block, named agent and capture queues; owned callback order, pending checkpoints and durable prefix. Complete Linux replay remains T14.',refusals:[],replays:[],program:meta};
 let machine,store,writer;
 const refuse=(name,fn)=>{let message;try{fn();}catch(e){message=String(e);}need(message,name+' refused');report.refusals.push({name,message});};
 try{
  machine=fresh(false);const initial=machine.saveEventCheckpoint();
  store=await SessionStore.open(DEVICE_PROBE_DATABASE);if(await store.openSession('device-prefix'))await store.deleteSession('device-prefix');writer=await store.writer('device-prefix');
  const disk=new Uint8Array(61),dv=new DataView(disk.buffer);disk.set(source.encode('WVOD1'));dv.setUint32(5,4096,true);dv.setBigUint64(9,1024n,true);disk.set(Uint8Array.from(base.match(/../g),h=>parseInt(h,16)),17);
  const topology=[['clint','clint',0x2000000,65536,0],['plic','plic',0xc000000,0x4000000,0],['blk0','virtio-blk',0x10001000,4096,1],['snd','virtio-snd',0x10007000,4096,7],['agent','virtio-console',0x10008000,4096,8]].map(([id,kind,address,mmio_length,irq])=>({id,kind,mmio_base:String(address),mmio_length,irq,state_version:1}));
  const config={version:1,inputPrefixWitness:1,providersComplete:false,runtime:'rv64-device-adapters-prefix-v1',ramMib:16,clock:{mode:'icount',divider:1,timebase_hz:'10000000',interactive:null},
   kernel:{url:new URL('assets/e9-device-completions.elf',import.meta.url).href,sha256:checkpointHash(elf),length:String(elf.length)},wasm:{url:new URL('pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:checkpointHash(wasm),length:String(wasm.length)},
   devices:topology,imageManifest,deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'}};
  const journal=await SessionInputJournal.createWitness(store,writer,config,initial,disk,new Uint8Array(),new Uint8Array());
  run(machine,4096,37);const requests=machine.deviceRequests();need(requests.length===4,'all posted guest requests');
  const pending=machine.saveEventCheckpoint(),stale=machine.leaseDeviceRequest(requests.find(r=>r.intent.kind==='block'&&r.intent.chunk===0).id),receipts=[];
  const order=[requests.find(r=>r.intent.kind==='block'&&r.intent.chunk===1),requests.find(r=>r.intent.kind==='agent'),requests.find(r=>r.intent.kind==='capture'),requests.find(r=>r.intent.kind==='block'&&r.intent.chunk===0)];
  for(const[i,request]of order.entries()){
   await new Promise(resolve=>setTimeout(resolve,[3,17,1,11][i]));run(machine,4096+i*173,29);
   const lease=machine.leaseDeviceRequest(request.id),bytes=request.intent.kind==='block'?chunks[request.intent.chunk].slice():request.intent.kind==='agent'?source.encode('file-agent-owned-result'):new Uint8Array([0x34,0x12,0xcd,0xab]);
   if(i===0){const corrupt=bytes.slice();corrupt[17]^=1;const before=machine.saveEventCheckpoint();refuse('wrong immutable payload',()=>machine.completeDeviceRequest(lease,0,0,corrupt));need(equal(before,machine.saveEventCheckpoint()),'rejected completion leaves frame unchanged');}
   machine.completeDeviceRequest(lease,0,request.intent.kind==='capture'?2:0,bytes);bytes.fill(255);lease.free();
   const rows=machine.takeDeviceDeliveries().map(own);need(rows.length===1,'exactly one accepted completion');receipts.push(rows[0]);journal.stage(rows);await journal.flush();
  }
  run(machine,9096,101);const frame=machine.saveEventCheckpoint(),guest=machine.readDeviceMemory(meta.reportAddress,meta.reportBytes),view=new DataView(guest.buffer);
  need(view.getBigUint64(0,true)===2n&&view.getBigUint64(8,true)===1n&&view.getBigUint64(16,true)===1n,'guest observed used indices');
  need([24,32,40].every(at=>view.getBigUint64(at,true)===1n),'guest observed interrupt effects');
  need(equal(guest.subarray(64,576),chunks[0])&&equal(guest.subarray(576,1088),chunks[1]),'guest observed base DMA');
  need(decode.decode(guest.subarray(1088,1111))==='file-agent-owned-result'&&equal(guest.subarray(1120,1124),new Uint8Array([0x34,0x12,0xcd,0xab])),'guest observed agent and audio DMA');
  report.initial=initial;report.pending=pending;report.final=frame;report.guest=guest;report.trace=machine.takeTrace();report.receipts=receipts;
  await writer.release();writer=null;await store.close();store=await SessionStore.open(DEVICE_PROBE_DATABASE);
  const reopened=await SessionInputJournal.read(store,'device-prefix');need(reopened.receipts.length===4,'durable accepted sequence');
  need(canonical(reopened.receipts)===canonical(receipts),'durable envelope round trip');
  const references=new Map();const opened=await store.openSession('device-prefix');
  for(const index of reopened.manifest.events){references.set(index.content.sha256,index.content);const bytes=await readCheckpointObject(store,index.content,4194304);for(const ref of JSON.parse(decode.decode(sessionEventReferences(opened.manifest,bytes))))references.set(ref.sha256,ref);}
  const owned=JSON.parse(decode.decode(sessionManifestReferences(opened.manifest)));
  for(const ref of owned.blobs)references.set(ref.sha256,ref);
  for(const hash of owned.roots){const ref=await store.objectReference(hash);references.set(hash,ref);}
  const objects=[];for(const ref of references.values())objects.push({ref,bytes:await readCheckpointObject(store,ref,300*1048576)});

  report.persisted={database:DEVICE_PROBE_DATABASE,id:'device-prefix',manifest:opened.manifest,objects};
  for(const quantum of [1,7,4096]){
   const replay=fresh(true);try{
    replay.restoreEventCheckpoint(pending);refuse('replay live callback ingress '+quantum,()=>replay.leaseDeviceRequest(order[0].id));
    for(const receipt of reopened.receipts){run(replay,receipt.transition,quantum);replay.replayDeviceCompletion(receipt.transition,receipt.retired,receipt.sequence,receipt.ordinal,receipt.bytes);need(canonical(replay.takeDeviceDeliveries())===canonical([receipt]),'replay completion receipt');}
    run(replay,9096,quantum);const replayFrame=replay.saveEventCheckpoint();need(equal(replayFrame,frame),'complete replay frame, quantum '+quantum);report.replays.push({quantum,frame:replayFrame,trace:replay.takeTrace()});
   }finally{replay.free();}
  }
  machine.restoreEventCheckpoint(pending);const before=machine.saveEventCheckpoint();refuse('stale callback after restore',()=>machine.completeDeviceRequest(stale,0,0,chunks[0]));need(equal(before,machine.saveEventCheckpoint()),'stale reply changes nothing');stale.free();
  report.baseReferences=receipts.filter(r=>splitDeviceCompletion(r.bytes).tag===1).map(r=>deviceEventParts(r).payload.content);report.status='passed';return report;
 }finally{if(writer)await writer.release();if(store)await store.close();machine?.free();}
}
