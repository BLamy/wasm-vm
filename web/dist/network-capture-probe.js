import {WasmMachine} from './pkg/wasm_vm_wasm.js';
import {checkpointHash,readCheckpointObject} from './session-checkpoints.js';
import {SessionStore} from './session-store.js';
import {SessionInputJournal} from './session-inputs.js';
import {sessionCanonicalImage,sessionEventReferences,sessionManifestReferences} from './session-pkg/wasm_vm_session.js';
import {encodeNetworkEvent,networkEventParts,openNetworkProvider,NetworkReplay} from './session-network.js';
export const NETWORK_PROBE_DATABASE='wasm-vm-sessions-v1-network-proof';
const need=(ok,why)=>{if(!ok)throw Error('network check: '+why);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const source=new TextEncoder(),decode=new TextDecoder();
const own=r=>({...r,bytes:r.bytes.slice(),outcome:[...r.outcome]});
export async function runNetworkCaptureProbe(){
 const [elf,meta,wasm]=await Promise.all(['assets/e9-network-capture.elf','assets/e9-network-capture.json','pkg/wasm_vm_wasm_bg.wasm'].map(async path=>{const r=await fetch(new URL(path,import.meta.url));need(r.ok,'asset '+path);return path.endsWith('.json')?r.json():new Uint8Array(await r.arrayBuffer());}));
 need(checkpointHash(elf.subarray(120))===meta.sha256,'pinned guest');
 const baseBytes=new Uint8Array(512),imageManifest=JSON.stringify({version:1,image_len:512,chunk_size:512,layout:'split',chunks:[checkpointHash(baseBytes)]}),base=checkpointHash(sessionCanonicalImage(imageManifest));
 const policy={version:1,base:{identity:base,sectors:'1',chunk_bytes:512,chunks:[{sha256:checkpointHash(baseBytes),length:512}]},agent:false,capture:false};
 const fresh=replay=>{const m=new WasmMachine(16);m.loadElf(elf);m.startEventClock(1,1);m.installDeviceSession(JSON.stringify(policy),replay);m.installNetworkSession(replay);m.setTrace(true);return m;};
 const run=(m,target,q)=>{while(BigInt(m.eventPosition().transition)<BigInt(target))m.runEventUntil(String(target),q);};
 const report={status:'running',scope:meta.scope,replays:[],refusals:[],program:meta,transport:{recordFactories:0,replayFactories:0,requests:0}};
 const refuse=(name,fn)=>{let message;try{fn();}catch(e){message=String(e);}need(message,name+' refused');report.refusals.push({name,message});};
 let machine,writer,store;
 try{
  machine=fresh(false);const initial=machine.saveEventCheckpoint(),receipts=[];
  store=await SessionStore.open(NETWORK_PROBE_DATABASE);if(await store.openSession('network-prefix'))await store.deleteSession('network-prefix');writer=await store.writer('network-prefix');
  const disk=new Uint8Array(61),dv=new DataView(disk.buffer);disk.set(source.encode('WVOD1'));dv.setUint32(5,4096,true);dv.setBigUint64(9,512n,true);disk.set(Uint8Array.from(base.match(/../g),h=>parseInt(h,16)),17);
  const devices=[['clint','clint',0x2000000,65536,0],['plic','plic',0xc000000,0x4000000,0],['blk0','virtio-blk',0x10001000,4096,1],['net','virtio-net',0x10002000,4096,2]].map(([id,kind,address,mmio_length,irq])=>({id,kind,mmio_base:String(address),mmio_length,irq,state_version:1}));
  const config={version:1,inputPrefixWitness:1,providersComplete:false,runtime:'rv64-network-prefix-v1',ramMib:16,clock:{mode:'icount',divider:1,timebase_hz:'10000000',interactive:null},devices,imageManifest,
   kernel:{url:new URL('assets/e9-network-capture.elf',import.meta.url).href,sha256:checkpointHash(elf),length:String(elf.length)},wasm:{url:new URL('pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:checkpointHash(wasm),length:String(wasm.length)},
   networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
  const journal=await SessionInputJournal.createWitness(store,writer,config,initial,disk,new Uint8Array(),new Uint8Array());
  const capture=async(tag,args={},id='')=>{const lease=machine.leaseNetworkRequest(id);try{machine.completeNetworkEvent(lease,encodeNetworkEvent(tag,args));}finally{lease.free();}
   const rows=machine.takeNetworkDeliveries().map(own);need(rows.length===1,'one accepted delivery');receipts.push(rows[0]);journal.stage(rows);await journal.flush();};
  // This bridge maps the pinned experimental-Ethernet HTTP GET to one fixed same-origin URL.
  // It never resolves or executes an arbitrary URL supplied by the guest.
  const {provider,lease}=openNetworkProvider(machine,()=>{report.transport.recordFactories++;return{request:()=>{report.transport.requests++;return fetch(new URL('network-probe-response.json',import.meta.url),{method:'GET',cache:'no-store',redirect:'error',credentials:'omit'});}};});lease.free();
  await capture(3,{id:'1'});
  run(machine,1024,37);const requests=machine.networkRequests();need(requests.length===1,'one guest TX intent');const request=requests[0];
  need([...request.frame].map(b=>b.toString(16).padStart(2,'0')).join('')===meta.frameHex,'actual guest Ethernet/HTTP request');
  const pending=machine.saveEventCheckpoint(),stale=machine.leaseNetworkRequest(request.id);
  const changed=request.frame.slice();changed[20]^=1;const before=machine.saveEventCheckpoint();refuse('changed guest send intent',()=>machine.completeNetworkEvent(stale,encodeNetworkEvent(1,{id:request.id,payload:changed})));need(equal(before,machine.saveEventCheckpoint()),'intent rejection is atomic');
  const responsePromise=provider.request();await capture(1,{id:request.id,payload:request.frame},request.id);await capture(4,{result:1});
  const response=await responsePromise;need(response.ok,'recording HTTP outcome');const body=new Uint8Array(await response.arrayBuffer());need(body.length<=4096,'bounded bridge response');
  const http=source.encode('HTTP/1.1 '+response.status+' '+response.statusText+'\r\nContent-Type: application/json\r\nContent-Length: '+body.length+'\r\nConnection: close\r\n\r\n');
  const rx=new Uint8Array(14+http.length+body.length);rx.set(request.frame.subarray(6,12));rx.set(request.frame.subarray(0,6),6);rx.set(request.frame.subarray(12,14),12);rx.set(http,14);rx.set(body,14+http.length);
  run(machine,1121,29);await capture(2,{payload:rx});run(machine,1137,29);await capture(3,{id:'2'});
  run(machine,9216,101);const frame=machine.saveEventCheckpoint(),guest=machine.readDeviceMemory(meta.reportAddress,meta.reportBytes),view=new DataView(guest.buffer);
  need(view.getBigUint64(0,true)===1n&&view.getBigUint64(8,true)===1n&&view.getBigUint64(16,true)===1n,'guest used indices and IRQ');
  need(equal(guest.subarray(32+12,32+12+rx.length),rx),'guest instruction-observed network DMA');
  report.initial=initial;report.pending=pending;report.final=frame;report.guest=guest;report.trace=machine.takeTrace();report.receipts=receipts;report.httpResponse=new Uint8Array([...http,...body]);report.receiveFrame=rx;
  await writer.release();writer=null;await store.close();store=await SessionStore.open(NETWORK_PROBE_DATABASE);
  const reopened=await SessionInputJournal.read(store,'network-prefix');need(reopened.receipts.length===5,'durable network tape');
  const references=new Map(),opened=await store.openSession('network-prefix');
  for(const index of reopened.manifest.events){references.set(index.content.sha256,index.content);const bytes=await readCheckpointObject(store,index.content,4194304);for(const ref of JSON.parse(decode.decode(sessionEventReferences(opened.manifest,bytes))))references.set(ref.sha256,ref);}
  const owned=JSON.parse(decode.decode(sessionManifestReferences(opened.manifest)));for(const ref of owned.blobs)references.set(ref.sha256,ref);for(const hash of owned.roots){const ref=await store.objectReference(hash);references.set(hash,ref);}
  const objects=[];for(const ref of references.values())objects.push({ref,bytes:await readCheckpointObject(store,ref,300*1048576)});
  report.persisted={database:NETWORK_PROBE_DATABASE,id:'network-prefix',manifest:opened.manifest,objects};
  for(const q of[1,7,4096])for(const fromPending of[false,true]){
   const r=fresh(true);try{r.restoreEventCheckpoint(fromPending?pending:initial);
    refuse('live provider q'+q+' pending'+fromPending,()=>openNetworkProvider(r,()=>{report.transport.replayFactories++;return fetch('/must-never-open');}));
    const driver=new NetworkReplay(r,reopened.receipts.slice(fromPending?1:0),'9216','5');driver.run(q);need(driver.state==='completed','driver stops at declared end');
    refuse('completed replay cannot continue '+q+'/'+fromPending,()=>driver.run(q));
    const replayFrame=r.saveEventCheckpoint();need(equal(replayFrame,frame),'all CPU/RAM/device/disk/cursor bytes q'+q);
    report.replays.push({quantum:q,fromPending,frame:replayFrame,trace:r.takeTrace(),position:r.eventPosition()});
   }finally{r.free();}
  }
  for(const attack of['missing send','changed intent','extra event']){
   const r=fresh(true);try{r.restoreEventCheckpoint(pending);const tape=reopened.receipts.slice(1).map(own);
    if(attack==='missing send')tape.shift();else if(attack==='changed intent')tape[0].bytes[22+20]^=1;else tape.push(own(tape.at(-1)));
    const driver=new NetworkReplay(r,tape,'9216','5');refuse(attack,()=>driver.run(31));need(driver.state==='diverged','explicit divergence');report.refusals.at(-1).position=driver.failure.position;
   }finally{r.free();}
  }
  machine.restoreEventCheckpoint(pending);const unchanged=machine.saveEventCheckpoint();refuse('stale callback',()=>machine.completeNetworkEvent(stale,encodeNetworkEvent(1,{id:request.id,payload:request.frame})));need(equal(unchanged,machine.saveEventCheckpoint()),'stale completion is atomic');stale.free();
  // Dropping a required CAS payload is detected by normal durable reads, without a provider.
  const payload=receipts.map(networkEventParts).find(p=>p.object).object;
  report.requiredPayload=payload[0];need(report.transport.recordFactories===1&&report.transport.requests===1&&report.transport.replayFactories===0,'transport suppression');
  report.status='passed';return report;
 }finally{if(writer)await writer.release();if(store)await store.close();machine?.free();}
}
