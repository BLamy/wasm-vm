// Untimed full original software workload. A caller must retain raw sidecars,
// independent filesystem/wire oracles and a fresh critic before task acceptance.
import init,{WasmLinux}from'/pkg/wasm_vm_wasm.js';
import{SessionStore}from'/session-store.js';
import{SessionInputJournal}from'/session-inputs.js';
import{checkpointHash,checkpointReference,checkpointChunks}from'/session-checkpoints.js';
import{sessionCanonicalImage}from'/session-pkg/wasm_vm_session.js';
import{createFencedRpc,formatRpcCommand,stripConsole}from'/guest-rpc.js';
import{createLinuxTerminal}from'/terminal.js';
import{frozenWorkloadSchedule,scheduledTransition,verifyFrozenWorkloadOffers,verifyUartActivityLedger}from'./e9-workload-schedule.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const need=(ok,why)=>{if(!ok)throw Error(why);};
const position=p=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,p[key]]));
const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
const samePosition=(a,b)=>['transition','retired','sequence','phase','ordinal'].every(key=>a[key]===b[key]);
export async function qualifySoftwareWorkload(contract){
 await init();const plan=frozenWorkloadSchedule(contract),fixture=contract.fixtures.find(row=>row.id==='software-alpine-v1');
 const [kernel,imageManifest,wasm]=await Promise.all([fetch('/kernel.bin').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),fetch('/image.json').then(r=>r.text()),fetch('/pkg/wasm_vm_wasm_bg.wasm').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b))]);
 need(checkpointHash(kernel)===fixture.artifacts.kernel.sha256,'original software kernel');
 const image=JSON.parse(imageManifest),base=checkpointHash(sessionCanonicalImage(imageManifest)),bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i';
 const state={scope:'Full original software workload qualification only; no desktop or performance claim',status:'running',console:'',database:'wasm-vm-sessions-v1-t22c-software',ledger:[],blocks:[],checkpoints:[],bodyResults:[],channels:{},receipts:0};
 globalThis.softwareWorkload=state;
 const terminal=createLinuxTerminal(document.querySelector('#terminal'));terminal.term.resize(80,24);const terminalPending=[],offers=[],rows=[],witnesses=[];terminal.attachSink(bytes=>terminalPending.push(bytes.slice()));
 let machine=WasmLinux.newExactSession(kernel,imageManifest,bootargs,bytes=>{const text=decoder.decode(bytes,{stream:true});state.console+=text;terminal.write(bytes.slice());if(parser){const result=parser.feed(text);if(result)rpcResult=result;}},false);
 let terminalDisposed=false;
 let parser,rpcResult,store,writer,journal,opened=false,stagedBytes=0,nextCapture=50000000n,lastProgress=0,reading=false;
 const begun=performance.now();let initial,end,expectedNative,rawReplay;
 const retain=async(name,bytes)=>{const response=await fetch('/__retain__/'+name,{method:'POST',body:bytes});need(response.ok,'raw sidecar '+name);return response.json();};
 const collect=async()=>{
  const batch=machine.takeExactSessionDeliveries();if(!batch.length)return;
  rows.push(...batch);state.receipts+=batch.length;
  for(const row of batch){state.channels[row.channel]=(state.channels[row.channel]??0)+1;
   if(row.channel===1){const producer=offers.shift();need(producer&&row.transition===producer.transition&&checkpointHash(row.bytes)===producer.sha256,'unclassified/mismatched actual UART offer');state.ledger.push({...position(row),channel:1,kind:producer.kind,bytes:row.bytes.length,sha256:producer.sha256});}
  }
  const count=batch.reduce((n,row)=>n+row.bytes.length,0);if(journal.pending+batch.length>256||stagedBytes+count>4194304){await journal.flush();stagedBytes=0;}journal.stage(batch);stagedBytes+=count;
  if(journal.pending>=128||stagedBytes>=2097152){await journal.flush();stagedBytes=0;}
 };
 const offer=async(kind,bytes)=>{const owned=typeof bytes==='string'?encoder.encode(bytes):bytes.slice();offers.push({kind,transition:machine.inputPosition().transition,sha256:checkpointHash(owned)});machine.sendInput(owned);await collect();};
 const drainTerminal=async()=>{for(const bytes of terminalPending.splice(0))await offer('terminal-reply',bytes);};
 const pump=async()=>{if(!opened){need(machine.exactNetworkRequests().length===0,'unexpected pre-shell TX');return;}for(let i=0;i<1024;i++){const outcome=machine.pumpOwnedLocalHttp();await collect();if(!outcome.more||outcome.blocked)return;}throw Error('HTTP work bound');};
 const witness=async(label,full=false)=>{await collect();const value=machine.exactSessionWitness(full);const prior=witnesses.at(-1);if(!prior||!samePosition(prior,value))witnesses.push({...position(value),digest:value.digest});else need(hex(prior.digest)===hex(value.digest),'same-position witness changed');const result={...position(value),digest:hex(value.digest)};if(full)result.raw=await retain(label+'.resume',value.resume);return{value,result};};
 const noteBodies=async()=>{
  if(!opened||reading)return;const text=stripConsole(state.console);
  for(let index=state.bodyResults.length+1;index<=10;index++){
   const expected=new Uint8Array(1024).fill(17+index),hash=checkpointHash(expected);
   if(!text.includes(hash+'  /root/e9-session/http'))break;
   reading=true;try{const mark=await witness('http-'+index);state.bodyResults.push({index,bytes:1024,sha256:hash,position:mark.result});}finally{reading=false;}
  }
 };
 const step=async(target=null)=>{
  need(performance.now()-begun<1800000,'software qualification wall bound');await drainTerminal();
  for(const request of machine.exactDeviceRequests()){
   need(request.intent.kind==='block','unexpected live device');const {sha256,length}=request.intent.content,response=await fetch('/__chunk__/'+sha256+'.bin');need(response.ok,'immutable software chunk');const bytes=new Uint8Array(await response.arrayBuffer());need(bytes.length===Number(length)&&checkpointHash(bytes)===sha256,'base chunk identity');await writer.put(checkpointReference(bytes),checkpointChunks(bytes));const lease=machine.exactLeaseDeviceRequest(request.id);try{machine.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}state.blocks.push({sha256,bytes:bytes.length,position:position(machine.inputPosition())});await collect();
  }
  await pump();const at=BigInt(machine.inputPosition().transition);need(at<3000000000n,'software transition bound');
  let limit=nextCapture;if(target!==null&&BigInt(target)<limit)limit=BigInt(target);need(at<=limit,'cooperative execution overran frozen boundary');
  if(at<limit){const distance=limit-at,budget=Number(distance<1048576n?distance:1048576n),result=machine.runChunk(budget);need(!result.done,'software guest stopped '+JSON.stringify(result));await collect();await pump();}
  const now=BigInt(machine.inputPosition().transition);need(now<=limit,'instruction budget exceeded exact transition limit');await noteBodies();
  if(now===nextCapture){await journal.flush();stagedBytes=0;const capture=await journal.captureKeyframe(store,machine,state.configuration,'software-'+state.checkpoints.length,{full:state.checkpoints.at(-1)?.stats.depth===8});const marked=await witness('keyframe');state.checkpoints.push({position:marked.result,stats:capture});nextCapture=now+50000000n;}
  if(performance.now()-lastProgress>10000){lastProgress=performance.now();const p={profile:'software',position:position(machine.inputPosition()),receipts:state.receipts,blocks:state.blocks.length,bodies:state.bodyResults.length,scheduled:state.scheduledOffers??0,tail:stripConsole(state.console).slice(-600)};document.querySelector('pre').textContent=JSON.stringify(p,null,2);const control=await globalThis.workloadProgress(p);need(control?.continue!==false,'operator requested software development stop');}
  await tick();
 };
 const until=async predicate=>{while(!predicate())await step();};
 const command=async(text,id,kind)=>{parser=createFencedRpc(id);rpcResult=null;await offer(kind,formatRpcCommand(text,id));await until(()=>!!rpcResult);need(rpcResult.exit===0,'guest RPC '+id+': '+JSON.stringify(rpcResult));return rpcResult;};
 try{
  machine.enableJit(2);store=await SessionStore.open(state.database);writer=await store.writer('full-software-workload');initial=machine.exactSessionWitness(true);witnesses.push({...position(initial),digest:initial.digest});state.initial={...position(initial),digest:hex(initial.digest),raw:await retain('initial.resume',initial.resume)};
  const disk=new Uint8Array(61),view=new DataView(disk.buffer);disk.set(encoder.encode('WVOD1'));view.setUint32(5,4096,true);view.setBigUint64(9,BigInt(image.image_len),true);disk.set(Uint8Array.from(base.match(/../g),value=>parseInt(value,16)),17);
  state.configuration={version:1,exactSession:1,providersComplete:true,runtime:'rv64-linux-exact-session-v1',ramMib:256,bootargs,clock:{mode:'icount',divider:10,timebase_hz:'10000000',interactive:null},kernel:{url:new URL('/kernel.bin',location).href,sha256:checkpointHash(kernel),length:String(kernel.length)},wasm:{url:new URL('/pkg/wasm_vm_wasm_bg.wasm',location).href,sha256:checkpointHash(wasm),length:String(wasm.length)},devices:JSON.parse(machine.softwareCheckpointTopology()),imageManifest,baseUrl:new URL('/__chunk__/',location).href,timeEntropyPolicy:machine.sessionSourcePolicy(),deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
  journal=await SessionInputJournal.createLiveExact(store,writer,state.configuration,initial.resume,disk,initial);delete initial.resume;
  await until(()=>stripConsole(state.console).includes("can't access tty; job control turned off"));machine.openOwnedLocalHttp();opened=true;await pump();
  state.networkSetup=await command('mkdir -p /root/e9-session; busybox ip link set eth0 up; busybox ip addr add 10.0.2.15/24 dev eth0; busybox ip addr show eth0','cnetsetup','network-setup');need(state.networkSetup.stdout.includes('10.0.2.15/24'),'actual software interface');
  parser=createFencedRpc('csetup');rpcResult=null;await offer('setup',formatRpcCommand(contract.workload.setup,'csetup'));await until(()=>/(?:^|\n)E9_BEFORE\n/.test(stripConsole(state.console)));state.before=(await witness('before',true)).result;
  await offer('advance',contract.workload.serial_advance);await until(()=>!!rpcResult);need(rpcResult.exit===0&&/(?:^|\n)E9_AFTER\n/.test(rpcResult.stdout),'frozen setup failed');state.setup=rpcResult;need(rpcResult.stdout.includes(contract.workload.after_sha256+'  '+contract.workload.guest_path),'setup after hash');state.auxiliarySetupSync=await command('sync','csetupflush','file-witness');await tick();await drainTerminal();
  const origin=await witness('origin',true);state.origin=origin.result;state.workloadOrigin=origin.result.transition;state.schedule=plan.map(frame=>({index:frame.index,offset:frame.offset,target:scheduledTransition(state.workloadOrigin,frame.offset),rewriteIndex:frame.rewriteIndex,bytes:frame.bytes.length,sha256:checkpointHash(frame.bytes)}));
  for(const frame of plan){const target=scheduledTransition(state.workloadOrigin,frame.offset);while(BigInt(machine.inputPosition().transition)<BigInt(target))await step(target);need(machine.inputPosition().transition===target,'exact input target');await offer('scheduled',frame.bytes);state.scheduledOffers=frame.index;}
  await until(()=>state.bodyResults.length===10&&/(?:^|\n)E9_INPUT_100\n/.test(stripConsole(state.console)));
  const text=stripConsole(state.console);for(let index=1;index<=100;index++){const mark='E9_INPUT_'+String(index).padStart(3,'0');need(text.split('\n').filter(line=>line===mark).length===1,'exact executed frame '+index);}
  state.files=await command('sync; od -An -v -tx1 /root/e9-session/state; od -An -v -tx1 /root/e9-session/entropy; od -An -v -tx1 /root/e9-session/http; sha256sum /root/e9-session/state /root/e9-session/entropy /root/e9-session/http','cfilebytes','file-witness');
  need(state.files.stdout.trim().split('\n')[0].replace(/\s/g,'')===contract.workload.after_hex,'literal final state');
  let closing=machine.cancelOwnedLocalHttp();await collect();for(let n=0;!closing.closed&&n<1024;n++){need(closing.more&&!closing.blocked,'service close stalled');closing=machine.pumpOwnedLocalHttp();await collect();}need(closing.closed,'closed original server');state.server=machine.ownedLocalHttpState();need(state.server.server.requests.every(n=>n===1)&&state.server.server.responsesQueued.every(n=>n===1)&&state.server.server.bodyBytesQueued.every(n=>n===1024),'ten independent real service counts');
  await drainTerminal();await collect();await journal.flush();stagedBytes=0;const final=await witness('final',true);end=final.value;expectedNative=end.resume;delete end.resume;state.final=final.result;need(offers.length===0,'unresolved UART producer');
  state.scheduleCheck=verifyFrozenWorkloadOffers(contract,state.workloadOrigin,rows);state.ledgerCheck=verifyUartActivityLedger(contract,state.workloadOrigin,rows,state.ledger,checkpointHash);await journal.completeExact(end,witnesses);const id=writer.id;await writer.release();writer=null;store.close();store=null;
  state.jit=machine.jitStats();state.originalServer=JSON.stringify(state.server);const factories=WasmLinux.ownedLocalHttpFactoryEntries();terminal.detachSink();terminal.term.dispose();terminalDisposed=true;machine.free();machine=null;
  store=await SessionStore.open(state.database);const read=await SessionInputJournal.readExact(store,id,{configuration:state.configuration});need(read.receipts.length===rows.length,'reopened full event count');const receiptIdentity=row=>JSON.stringify({...position(row),channel:row.channel,ticket:row.ticket,outcome:row.outcome,bytes:hex(row.bytes)});for(let i=0;i<rows.length;i++)need(receiptIdentity(rows[i])===receiptIdentity(read.receipts[i]),'reopened exact receipt '+i);
  const replay=WasmLinux.newExactSession(kernel,imageManifest,bootargs,()=>{},true);const nativeFetch=globalThis.fetch,nativeSocket=globalThis.WebSocket;state.replayEgress={fetch:0,sockets:0};
  try{
   globalThis.fetch=(...args)=>{state.replayEgress.fetch++;throw Error('live fetch during full software replay');};globalThis.WebSocket=class extends nativeSocket{constructor(...args){state.replayEgress.sockets++;throw Error('live socket during software replay');}};
   replay.enableJit(2);replay.beginExactReplay(read.initialResume,read.receipts,read.witnesses,end,read.initialQueues);let result;
   for(let calls=0;calls<100000;calls++){result=replay.runExactReplayChunkTo({...position(end),transitionOnly:false},1048576);if(result.reached)break;if(performance.now()-lastProgress>10000){lastProgress=performance.now();const p={profile:'software-replay',position:position(replay.inputPosition()),events:read.receipts.length};const control=await globalThis.workloadProgress(p);need(control?.continue!==false,'operator requested software replay stop');}await tick();}
   need(result?.reached,'complete initial-to-end replay bound');const observed=replay.exactSessionWitness(true);need(hex(observed.digest)===hex(end.digest)&&observed.resume.length===expectedNative.length&&observed.resume.every((byte,i)=>byte===expectedNative[i]),'full native/software replay mismatch');rawReplay=observed.resume;state.replay={position:position(observed),digest:hex(observed.digest),nativeBytes:observed.resume.length,allWitnesses:read.witnesses.length,events:read.receipts.length,exactNativeBytes:true};need(WasmLinux.ownedLocalHttpFactoryEntries()===factories,'replay provider construction');
  }finally{globalThis.fetch=nativeFetch;globalThis.WebSocket=nativeSocket;replay.free();}
  state.replay.raw=await retain('replay.resume',rawReplay);need(state.replayEgress.fetch===0&&state.replayEgress.sockets===0,'zero replay egress');state.sourceObservations=rows.filter(row=>[17,18].includes(row.channel)).map(row=>({...position(row),channel:row.channel,outcome:row.outcome,bytes:[...row.bytes]}));need(state.sourceObservations.some(row=>row.channel===17&&row.bytes.length===8)&&state.sourceObservations.some(row=>row.channel===18&&row.outcome[1]==='6'),'actual RTC/entropy observations');state.sessionId=id;state.status='software-full-workload-replay-passed';
 }catch(error){state.status='failed';state.error=String(error.stack??error);state.failurePosition=machine?position(machine.inputPosition()):null;await retain('terminal-status.json',encoder.encode(JSON.stringify({status:state.status,error:state.error,position:state.failurePosition,receipts:state.receipts,blocks:state.blocks.length,scheduled:state.scheduledOffers??0})));try{if(machine)state.failure=(await witness('failure',true)).result;}catch(failure){state.captureError=String(failure);}}
 finally{
  if(!terminalDisposed){terminal.detachSink();terminal.term.dispose();terminalDisposed=true;}machine?.free();await writer?.release();store?.close();
  state.receiptFile=await retain('receipts.json',encoder.encode(JSON.stringify(rows.map(row=>({...row,bytes:[...row.bytes]})))));state.witnessFile=await retain('witnesses.json',encoder.encode(JSON.stringify(witnesses.map(value=>({...position(value),digest:[...value.digest]})))));state.ledgerFile=await retain('ledger.json',encoder.encode(JSON.stringify(state.ledger)));
 }
 return state;
}
