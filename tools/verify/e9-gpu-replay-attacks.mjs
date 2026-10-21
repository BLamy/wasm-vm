// Browser-only adversarial probes over the production GPU session APIs.
import init,{WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {openGpuTimelineReplay} from '/session-gpu-replay.js';
import {SessionStore} from '/session-store.js';
import {SessionGpuJournal} from '/session-gpu-journal.js';
import {checkpointHash} from '/session-checkpoints.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from '/renderer/virgl-command/production.mjs';
import {sessionValidateManifest} from '/session-pkg/wasm_vm_session.js';
const need=(value,message)=>{if(!value)throw Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const position=p=>Object.fromEntries(['transition','retired','sequence','ordinal','phase'].map(k=>[k,p[k]]));
const refusal=async(action,label)=>{try{await action();}catch(error){return {label,error:String(error.message)};}throw Error(label+' was admitted');};
async function databaseRows(name){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const rows={};
 for(const name of ['objects','sessions','metadata','chunks'])rows[name]=await new Promise((resolve,reject)=>{const tx=db.transaction(name),s=tx.objectStore(name),keys=s.getAllKeys(),values=s.getAll();tx.oncomplete=()=>resolve(keys.result.map((key,i)=>[key,values.result[i]]));tx.onabort=()=>reject(tx.error);});db.close();return rows;
}
async function storageDigest(name){
 const rows=await databaseRows(name),witness=[];
 for(const [name,entries]of Object.entries(rows))for(const [key,value]of entries){const bytes=value instanceof Blob?new Uint8Array(await value.arrayBuffer()):new TextEncoder().encode(JSON.stringify(value));witness.push([name,key,checkpointHash(bytes)]);}
 return checkpointHash(new TextEncoder().encode(JSON.stringify(witness)));
}
async function copyDatabase(source,destination,alter){
 const rows=await databaseRows(source),store=await SessionStore.open(destination);await store.close();
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(destination);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(rows),'readwrite',{durability:'strict'});for(const [name,entries]of Object.entries(rows))for(const [key,value]of entries)tx.objectStore(name).put(value,key);alter(tx,rows);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();return SessionStore.open(destination);
}
function instrumentWorkers(records,{variation=false,hold=false,quantum=4096}={}){
 const NativeWorker=globalThis.Worker;const workers=[];
 globalThis.Worker=class extends NativeWorker{
  constructor(url,options){
   const bootstrap=`import init,{WasmLinux,WasmGpuTransport} from ${JSON.stringify(new URL('/pkg/wasm_vm_wasm.js',location).href)};
   await init();let active=false,waits=0;const begin=WasmLinux.prototype.beginExactReplay;
   WasmLinux.prototype.beginExactReplay=function(...args){const result=begin.apply(this,args);active=true;postMessage({type:'gpu-test-started'});return result;};
   const scatterNames=['scatterOutput','scatterLayeredOutput'];for(const name of scatterNames){const original=WasmGpuTransport.prototype[name];WasmGpuTransport.prototype[name]=function(...args){const actual=args.at(-1),delivered=${variation}?new Uint8Array(actual.length).fill(0xee):actual;
   if(active)postMessage({type:'gpu-test-probe',kind:'scatter',method:name,args:args.slice(0,-1),actual:[...actual],delivered:[...delivered]});return original.apply(this,[...args.slice(0,-1),delivered]);};}
   for(const name of ['gatherInput','gatherLayeredInput']){const original=WasmGpuTransport.prototype[name];WasmGpuTransport.prototype[name]=function(...args){const result=original.apply(this,args);if(active)postMessage({type:'gpu-test-probe',kind:'gather',method:name,args,bytes:result===null?null:[...result]});return result;};}
   if(${hold}){const complete=WasmGpuTransport.prototype.complete;WasmGpuTransport.prototype.complete=function(...args){if(active){postMessage({type:'gpu-test-probe',kind:'held-completion',key:args.slice(0,2)});return;}return complete.apply(this,args);};}
   const context=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){const gl=context.apply(this,args);if(!gl||args[0]!=='webgl2')return gl;return new Proxy(gl,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{const actual=value.apply(target,args);let delivered=actual;
   if(active&&${variation}&&name==='getQueryParameter'&&args[1]===target.QUERY_RESULT)delivered=actual===0?1:0;
   if(active&&${variation}&&name==='clientWaitSync'&&waits++<11&&[target.ALREADY_SIGNALED,target.CONDITION_SATISFIED].includes(actual))delivered=target.TIMEOUT_EXPIRED;
   if(active&&(name==='getQueryParameter'||name==='clientWaitSync'))postMessage({type:'gpu-test-probe',kind:name,actual,delivered});return delivered;};}});};
   await import(${JSON.stringify(String(url))});`;
   const entry=URL.createObjectURL(new Blob([bootstrap],{type:'text/javascript'}));super(entry,options);URL.revokeObjectURL(entry);workers.push(this);
   this.addEventListener('message',event=>{if(event.data?.type?.startsWith('gpu-test-'))records.push(event.data);if(event.data?.type==='ready')this.retainedReady=event;});
  }
  postMessage(value,...args){return super.postMessage(value.type==='seek'?{...value,quantum}:value,...args);}
 };
 return {workers,restore(){globalThis.Worker=NativeWorker;}};
}
async function open(p,onPublish=()=>{}){return openGpuTimelineReplay({store:p.store,id:'gpu-smoke',configuration:p.config,onPublish});}
// Synthetic metadata probes derived from a retained real envelope. These test
// journal admission/publication budgets, not execution of the enlarged GPU work.
async function journalBounds(p,read){
 const store=await copyDatabase(p.store.databaseName,p.store.databaseName+'-journal-bounds',()=>{}),report={};
 const fresh=async id=>{const manifest=structuredClone(read.manifest);manifest.id=id;manifest.end={...manifest.begin};manifest.events=[];manifest.checkpoints=manifest.checkpoints.slice(0,1);manifest.extensions=manifest.extensions.slice(0,1);
  const writer=await store.writer(id);await writer.publish(sessionValidateManifest(new TextEncoder().encode(JSON.stringify(manifest))));return {writer,journal:new SessionGpuJournal(store,writer,manifest,p.config)};};
 try{
  const original=p.batches.flatMap(batch=>batch.events).find(row=>row.channel===22&&row.bytes[8]===2&&row.bytes[105]===0);need(original,'real scatter envelope missing');
  const {writer,journal}=await fresh('gpu-body-window');
  const batch=(number,fill)=>{const bytes=new Uint8Array(32*1048576).fill(fill),digest=checkpointHash(bytes),header=Uint8Array.from(original.bytes),view=new DataView(header.buffer);header.set(Uint8Array.from(digest.match(/../g),b=>parseInt(b,16)),106);view.setUint32(93,bytes.length,true);view.setUint32(97,bytes.length,true);view.setUint32(101,1,true);view.setUint32(138,bytes.length,true);
   return {events:[{...original,transition:String(number),retired:String(number),ordinal:1,sequence:String(number),bytes:header,outcome:[...original.outcome.slice(0,2),String(bytes.length),original.outcome[3]]}],payloads:[{bytes,sha256:Uint8Array.from(digest.match(/../g),b=>parseInt(b,16)),length:bytes.length}]};};
  try{for(const [number,fill]of [[1,1],[2,2]]){journal.stage(batch(number,fill));await journal.flush();}
   const before=await store.openSession(writer.id);report.body=await refusal(()=>journal.stage(batch(3,3)),'third distinct 32MiB body across flushes');
   const after=await store.openSession(writer.id);need(before.revision===after.revision&&same([...before.manifest],[...after.manifest])&&journal.pending===0,'rejected body changed committed prefix');
   journal.stage(batch(3,1));await journal.flush();report.body={...report.body,committedDistinctBytes:64*1048576,duplicateAccepted:true,position:journal.end};
  }finally{await writer.release();}
  const many=await fresh('gpu-event-window');
  try{for(let group=0;group<16;group++){const events=Array.from({length:256},(_,i)=>{const sequence=group*256+i+1;return {transition:'1',retired:'1',phase:'observe',ordinal:sequence,sequence:String(sequence),ticket:'0',channel:23,outcome:['0','7','40','0'],bytes:new Uint8Array(40)};});many.journal.stage({events,payloads:[]});await many.journal.flush();}
   const before=await store.openSession(many.writer.id);report.events=await refusal(()=>many.journal.stage({events:[{transition:'1',retired:'1',phase:'observe',ordinal:4097,sequence:'4097',ticket:'0',channel:23,outcome:['0','7','40','0'],bytes:new Uint8Array(40)}],payloads:[]}),'4097th receipt across flushes');
   const after=await store.openSession(many.writer.id);need(before.revision===after.revision&&same([...before.manifest],[...after.manifest])&&many.journal.pending===0,'rejected receipt changed committed prefix');report.events={...report.events,committed:4096};
  }finally{await many.writer.release();}
  const finishing=structuredClone(read.manifest);finishing.id='gpu-finish-overlap';finishing.extensions=finishing.extensions.slice(0,1);
  const finalWriter=await store.writer(finishing.id);await finalWriter.publish(sessionValidateManifest(new TextEncoder().encode(JSON.stringify(finishing))));
  try{let release,entered,first=true;const blocked=new Promise(resolve=>release=resolve),arrived=new Promise(resolve=>entered=resolve),writer={publish:async bytes=>{if(first){first=false;entered();await blocked;return finalWriter.publish(bytes,()=>{throw Error('intentional completion transaction abort');});}return finalWriter.publish(bytes);}};
   const journal=new SessionGpuJournal(store,writer,finishing,p.config),end=p.vm.exactGpuSessionWitness(),completion=refusal(()=>journal.completeExact(end,p.states),'completion transaction abort');await arrived;
   const before=await store.openSession(finishing.id);report.finishing={overlap:[]};
   for(const [label,action]of [['stage',()=>journal.stage({events:[],payloads:[]})],['flush',()=>journal.flush()],['second completion',()=>journal.completeExact(end,p.states)]])report.finishing.overlap.push(await refusal(action,label+' during completion'));
   release();report.finishing.failure=await completion;const after=await store.openSession(finishing.id);
   need(before.revision===after.revision&&same([...before.manifest],[...after.manifest])&&journal.pending===0,'failed completion changed the saved prefix');
   await journal.completeExact(end,p.states);const reopened=await SessionGpuJournal.readExact(store,finishing.id,{configuration:p.config});need(same(position(reopened.manifest.end),position(end))&&journal.pending===0,'completion retry did not publish original final boundary');report.finishing.retry='passed';
  }finally{await finalWriter.release();}
  return report;
 }finally{await store.close();}
}
export async function runGpuReplayAttacks(p){
 await init();const report={status:'running',seeks:[],refusals:[],cancellation:[],physical:[]};globalThis.__gpuReplayAttackReport=report;
 const originalStorage=await storageDigest(p.store.databaseName),originalState=hex(p.vm.exactGpuSessionWitness().digest);
 need(p.midWitness,'source must retain a post-readback witness before the final keyframe');
 for(const [index,variation]of [false,true].entries()){
  const probes=[],patch=instrumentWorkers(probes,{variation,quantum:variation?257:4096});let opened;
  try{opened=await open(p);const selected=await opened.controller.seekPosition(p.midWitness);need(selected.status==='ready'&&selected.rendered.digest===hex(p.midWitness.digest),'recorded GPU result/RAM/CPU witness changed');
   report.seeks.push({variation,position:selected.position,digest:selected.rendered.digest,checkpointId:selected.checkpointId});
   const changed=probes.filter(row=>row.kind==='scatter'&&!same(row.actual,row.delivered));
   if(variation){need(changed.length>=3,'real GPU readback bytes were not varied');need(probes.some(row=>row.kind==='getQueryParameter'&&row.actual!==row.delivered),'real query result was not varied');}
   if(p.layeredExpected){const expected=[...new Uint8Array([0x11,0x22,0x33,255,0x11,0x22,0x33,255,0x11,0x22,0x33,255,0x11,0x22,0x33,255,0x44,0x55,0x66,255,0x44,0x55,0x66,255,0x44,0x55,0x66,255,0x44,0x55,0x66,255])];
    need(probes.some(row=>row.method==='gatherLayeredInput'&&same(row.args.slice(6),['0000000000000005',8,13,2,37,2])&&same(row.bytes,expected)),'owned layered gather with padded rows/layers not exercised');
    need(probes.some(row=>row.method==='scatterLayeredOutput'&&same(row.args.slice(6),['0000000000000005',8,13,2,37,2])&&same(row.actual,expected)&&(!variation||!same(row.actual,row.delivered))),'owned layered scatter with recorded replay bytes not exercised');}
   report.physical.push({variation,probes});
   const end=await opened.controller.seekPosition(opened.manifest.end);need(end.rendered.digest===hex(p.vm.exactGpuSessionWitness().digest),'GPU error/fence suffix changed');
  }finally{opened?.controller.close();patch.restore();}
 }
 const published=[],probes=[],patch=instrumentWorkers(probes,{hold:true});let opened;
 try{opened=await open(p,s=>published.push(s.requestId));const first=opened.controller.seekPosition(p.midWitness);
  const deadline=performance.now()+60000;
  while(performance.now()<deadline&&!probes.some(x=>x.kind==='held-completion'))await tick();
  need(probes.some(x=>x.kind==='held-completion'),'seek never held an authentic native GPU callback: '+JSON.stringify(probes.map(({type,kind})=>({type,kind}))));
  const second=opened.controller.seekPosition(opened.manifest.begin),cancelled=await first,selected=await second;
  need(cancelled.status==='cancelled'&&selected.status==='ready'&&published.length===1&&published[0]===selected.requestId,'stale replay request published after seek');
  report.cancellation.push({cancelled,selected:{requestId:selected.requestId,position:selected.position},held:probes.filter(x=>x.kind==='held-completion')});
 }finally{opened?.controller.close();patch.restore();}
 // These are original capabilities minted by native submissions, never fabricated keys.
 const old=p.owners[0],event=old.event;
 report.refusals.push(await refusal(()=>old.cap.complete(event.epoch,event.sequence,'0000000000000000',0,true,0,0),'authentic retired GPU completion after seeks'));
 report.refusals.push(await refusal(()=>old.cap.gatherInput(event.epoch,event.sequence,'0000000000000001',2,'0000000000000003','0000000000000002','0000000000000000',64,64,1),'authentic retired GPU DMA after seeks'));
 const numeric=[event.epoch,event.sequence,'0000000000000001',2,'0000000000000001','0000000000000001','0000000000000000',64,64,1];
 for(const [name,args]of [['gatherInput',numeric],['scatterOutput',[...numeric,new Uint8Array(64)]],['gatherLayeredInput',[...numeric,64,1]],['scatterLayeredOutput',[...numeric,64,1,new Uint8Array(64)]]]){const rejected=await refusal(()=>p.vm[name](...args),'legacy '+name+' bypass');need(rejected.error.includes('owned GPU request transport required'),'legacy numeric call bypassed its exact-session guard');report.refusals.push(rejected);}
 need(hex(p.vm.exactGpuSessionWitness().digest)===originalState,'retired capability or numeric bypass changed original machine');
 for(const [label,edit]of [
  ['old clock',c=>{c.clock.divider=10;}],['paced clock',c=>{c.clock.mode='paced-icount';c.clock.interactive={};}],
  ['other Wasm',c=>{c.wasm.sha256='0'.repeat(64);}],['other renderer build',c=>{c.renderer.buildId='0'.repeat(64);}],
  ['other physical profile',c=>{c.profile.hostWords[0]^=1;}],
 ]){const config=structuredClone(p.config);edit(config);report.refusals.push(await refusal(()=>openGpuTimelineReplay({store:p.store,id:'gpu-smoke',configuration:config}),label));}
 const read=await SessionGpuJournal.readExact(p.store,'gpu-smoke',{configuration:p.config}),body=read.receipts.find(row=>row.body?.length==='16384')?.body;need(body,'retained real texture readback missing');
 const rows=await databaseRows(p.store.databaseName),object=rows.objects.find(([key])=>key===body.sha256)[1],chunk=object.parts[0].sha256;
 for(const corrupt of [false,true]){const name=p.store.databaseName+'-'+(corrupt?'corrupt':'missing'),bad=await copyDatabase(p.store.databaseName,name,(tx,rows)=>{
  if(corrupt){const old=rows.chunks.find(([key])=>key===chunk)[1];tx.objectStore('chunks').put(new Blob([new Uint8Array(old.size).fill(0xee)]),chunk);}
  else tx.objectStore('chunks').delete(chunk);
 });let badReplay;
 try{report.refusals.push(await refusal(async()=>{badReplay=await openGpuTimelineReplay({store:bad,id:'gpu-smoke',configuration:p.config});await badReplay.controller.seekPosition(p.midWitness);},corrupt?'corrupt GPU readback':'missing GPU readback'));}
 finally{badReplay?.controller.close();await bad.close();}}
 report.journalBounds=await journalBounds(p,read);
 need(await storageDigest(p.store.databaseName)===originalStorage,'attacks changed the original committed history');
 report.original={before:originalStorage,after:await storageDigest(p.store.databaseName),stateBefore:originalState,stateAfter:hex(p.vm.exactGpuSessionWitness().digest)};
 report.status='passed';return report;
}
export async function runGpuContextLoss(p){
 let serial='';const kernel=new Uint8Array(await(await fetch('/kernel.bin')).arrayBuffer()),vm=WasmLinux.newExactGpuSession(kernel,p.config.imageManifest,p.config.bootargs,b=>{serial+=new TextDecoder().decode(b);},false);vm.enableJit(2);
 const owners=[],attach=vm.attachVirgl.bind(vm);vm.attachVirgl=(...args)=>{const callback=args[3];args[3]=event=>{if(event.ownedTransport)owners.push({event,cap:event.ownedTransport});return callback(event);};return attach(...args);};
 const snapshots=[];const state=()=>({position:position(vm.inputPosition()),trace:vm.gpuCommandTrace(),ram:vm.softwareRamDigest()});
 let presenter;presenter=createWorkerScanoutPresenter(frame=>{if(frame.presentationToken)queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,'superseded'));});const gpu=await attachProductionVirgl(vm,{presenter,onEvent:event=>{if(event.type==='loss-injected')snapshots.push(state());}});vm.enableGpuCommandTrace();
 try{for(let i=0;i<1000&&!gpu.inspect().pending;i++){vm.runChunk(10000);for(const request of vm.exactDeviceRequests()){const lease=vm.exactLeaseDeviceRequest(request.id),bytes=new Uint8Array(await(await fetch('/zero.bin')).arrayBuffer());vm.exactCompleteDeviceRequest(lease,0,0,bytes);lease.free();}}
 need(gpu.inspect().pending&&owners.length,'context-loss test never admitted original work');const scheduled=state();
 gpu.loseContext('pending');for(let i=0;i<1000&&!gpu.inspect().lost;i++){gpu.pump();await tick();}need(gpu.inspect().lost,'physical WebGL context loss was not observed');
 const owner=owners.at(-1),event=owner.event,error=await refusal(()=>owner.cap.complete(event.epoch,event.sequence,'0000000000000000',0,true,0,0),'original callback after physical context loss');
 const stopped=vm.inputPosition();need(stopped.stopped===true,'context loss left exact recording runnable');const after=state(),before=snapshots.at(-1);globalThis.__gpuContextLoss={scheduled,before,after,snapshots};need(before&&same(before,after),'context loss mutated guest CPU coordinate, command ring or RAM');
 return {status:'passed',scheduled,before,after,error,serial,physical:gpu.inspect()};
 }finally{gpu.dispose();vm.free();}
}
