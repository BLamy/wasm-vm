// Live demonstration of the fixed owned HTTP provider. Full Alpine OFF/ON and
// exact replay are functional checks; this reports no performance qualification.
import init, {WasmLinux} from './pkg/wasm_vm_wasm.js';
import {checkpointHash} from './session-checkpoints.js';
import {encodeNetworkEvent} from './session-network.js';
import {createFencedRpc, formatRpcCommand, stripConsole} from './guest-rpc.js';
const enc=new TextEncoder(), dec=new TextDecoder();
const need=(ok,message)=>{if(!ok)throw Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const coordinate=value=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,value[key]]));
const hex=bytes=>[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export async function runOwnedHttpProbe({onProgress=()=>{},retain,baseUrl}={}) {
 await init();
 const artifacts=await (await fetch(new URL('./artifacts.json',import.meta.url))).json();
 const pinnedKernel='af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce';
 const [kernel,image,software]=await Promise.all([
  fetch(new URL(artifacts.artifacts.kernel.url,import.meta.url)).then(r=>{need(r.ok,'kernel fetch');return r.arrayBuffer();}).then(b=>new Uint8Array(b)),
  fetch(new URL('./session-alpine-image.json',import.meta.url)).then(r=>r.text()),fetch(new URL('./session-software-fixture.json',import.meta.url)).then(r=>r.json()),
 ]);
 need(checkpointHash(kernel)===pinnedKernel,'original full kernel');
 const state={scope:'T22b real full Alpine HTTP OFF/ON provider and zero-live replay; no full workload/desktop/performance claim',status:'running',modes:[],replays:[],refusals:[]};
 state.initialDatabases=await indexedDB.databases();
 let record,initial,final,replayFrame,receipts=[],witnesses=[],original;
 const save=retain??(async(name,bytes)=>({file:name,bytes:bytes.length,sha256:checkpointHash(bytes)}));
 try {
  for(const mode of ['off','on']) {
   const off=mode==='off', row={mode,console:'',bodies:[],inputs:[],blocks:0,status:'running'};state.modes.push(row);
   let parser,rpc,lastProgress=0;const started=performance.now();
   const output=bytes=>{const text=dec.decode(bytes,{stream:true});need(row.console.length+text.length<=1048576,'console bound');row.console+=text;if(parser){const value=parser.feed(text);if(value)rpc=value;}};
   const machine=off?WasmLinux.newUnrecordedSession(kernel,image,software.bootargs,output):WasmLinux.newExactSession(kernel,image,software.bootargs,output,false);
   const position=()=>off?machine.unrecordedControlState():machine.inputPosition();
   const collect=()=>{if(!off){const rows=machine.takeExactSessionDeliveries();need(receipts.length+rows.length<=4096,'recorded event bound');receipts.push(...rows);}};
   let providerOpened=false;
   const pump=()=>{if(!providerOpened){need(machine.exactNetworkRequests().length===0,'unexpected pre-initialization Ethernet');return;}for(let i=0;i<1024;i++){const result=machine.pumpOwnedLocalHttp();collect();need(!result.blocked,'HTTP bridge staging requires guest RX progress');if(!result.more)return;}throw Error('HTTP work budget never settled');};
   const step=async()=>{
    need(performance.now()-started<900000&&BigInt(position().transition)<3000000000n,'full guest deterministic/time bound');
    for(const request of machine.exactDeviceRequests()){
     need(request.intent.kind==='block','unexpected external device');const {sha256,length}=request.intent.content;
     const response=await fetch(new URL('chunks/'+sha256+'.bin',new URL(baseUrl??software.base_url,import.meta.url)));need(response.ok,'base fetch');const bytes=new Uint8Array(await response.arrayBuffer());
     need(checkpointHash(bytes)===sha256&&bytes.length===Number(length),'immutable base identity');
     const lease=machine.exactLeaseDeviceRequest(request.id);try{machine.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}
     row.blocks++;collect();
    }
    pump();const result=machine.runChunk(1048576);need(!result.done,'guest stopped '+JSON.stringify(result));collect();pump();
    if(performance.now()-lastProgress>15000){lastProgress=performance.now();await onProgress({mode,position:position(),server:providerOpened?machine.ownedLocalHttpState():null,tail:stripConsole(row.console).slice(-300),receipts:receipts.length});}
    await tick();
   };
   const until=async predicate=>{while(!predicate())await step();};
   const send=text=>{const at=position();row.inputs.push({...coordinate(at),bytes:enc.encode(text).length,sha256:checkpointHash(enc.encode(text))});machine.sendInput(enc.encode(text));collect();};
   const command=async(text,id)=>{parser=createFencedRpc(id);rpc=null;send(formatRpcCommand(text,id));await until(()=>!!rpc);need(rpc.exit===0,'guest command '+id+': '+JSON.stringify(rpc));return rpc;};
   try{
    machine.enableJit(2);
    row.initial=position();
    if(!off){initial=machine.exactSessionWitness(true);state.initial={...coordinate(initial),digest:hex(initial.digest),raw:await save('initial.resume',initial.resume)};witnesses=[initial];}
    await until(()=>stripConsole(row.console).includes("can't access tty; job control turned off"));
    const retainedLegacyLease=machine.exactLeaseNetworkRequest('');
    const entries=BigInt(WasmLinux.ownedLocalHttpFactoryEntries());machine.openOwnedLocalHttp();providerOpened=true;need(BigInt(WasmLinux.ownedLocalHttpFactoryEntries())===entries+1n,'one actual provider factory');
    let duplicate;try{machine.openOwnedLocalHttp();}catch(error){duplicate=String(error);}
    need(duplicate&&BigInt(WasmLinux.ownedLocalHttpFactoryEntries())===entries+1n,'duplicate open must not enter factory');state.refusals.push({mode,kind:'duplicate-open',message:duplicate});
    pump();
    // Capabilities obtained before open cannot bypass the fixed provider afterwards.
    const guardState=()=>JSON.stringify({position:position(),provider:machine.ownedLocalHttpState(),ram:machine.softwareRamDigest()});
    try{for(const [kind,invoke] of [
     ['legacy-requests',()=>machine.exactNetworkRequests()],
     ['legacy-lease',()=>machine.exactLeaseNetworkRequest('')],
     ['legacy-receive',()=>machine.exactCompleteNetworkEvent(retainedLegacyLease,encodeNetworkEvent(2,{payload:new Uint8Array([1,2,3])}))],
     ['legacy-link',()=>machine.exactCompleteNetworkEvent(retainedLegacyLease,encodeNetworkEvent(3,{id:'2'}))],
     ['legacy-pending',()=>machine.exactCompleteNetworkEvent(retainedLegacyLease,encodeNetworkEvent(4,{result:1}))],
     ['legacy-send',()=>machine.exactCompleteNetworkEvent(retainedLegacyLease,encodeNetworkEvent(1,{id:'1',payload:new Uint8Array()}))],
    ]){
     const before=guardState();let message;try{invoke();}catch(error){message=String(error);}
     need(message?.includes('network callbacks owned by local HTTP provider')&&guardState()===before,'legacy callback bypass: '+kind);
     state.refusals.push({mode,kind,message});
    }}finally{retainedLegacyLease.free();}
    row.setup=await command('mkdir -p /root/e9-session; busybox ip link set eth0 up; busybox ip addr add 10.0.2.15/24 dev eth0; busybox ip addr show eth0',mode+'netsetup');
    need(row.setup.stdout.includes('10.0.2.15/24'),'real guest interface');
    for(let index=1;index<=10;index++){
     const result=await command(`busybox wget -qO /root/e9-session/http http://10.0.2.2:9191/e9/${index} && wc -c < /root/e9-session/http && sha256sum /root/e9-session/http && od -An -v -tx1 /root/e9-session/http`,mode+'http'+index);
     const lines=result.stdout.trim().split('\n');need(lines[0].trim()==='1024','actual guest length');
     const bytes=Uint8Array.from(lines.slice(2).join('').replace(/\s/g,'').match(/../g)??[],value=>parseInt(value,16));
     need(bytes.length===1024&&bytes.every(byte=>byte===17+index),'literal guest body '+index);
     const digest=checkpointHash(bytes);need(lines[1]===digest+'  /root/e9-session/http','actual guest hash');
     row.bodies.push({index,length:bytes.length,hex:hex(bytes),sha256:digest,position:position()});
     collect();pump();
     if(!off){const witness=machine.exactSessionWitness(false);witnesses.push(witness);}
    }
    let closing=machine.cancelOwnedLocalHttp();collect();for(let i=0;!closing.closed&&i<1024;i++){need(closing.more&&!closing.blocked,'close blocked');closing=machine.pumpOwnedLocalHttp();collect();}need(closing.closed,'close must settle');
    row.server=machine.ownedLocalHttpState();
    need(row.server.server.requests.every(count=>count===1)&&row.server.server.responsesQueued.every(count=>count===1)&&row.server.server.bodyBytesQueued.every(count=>count===1024),'independent actual HTTP service counters');
    need(row.server.closed&&row.server.server.closed&&!row.server.server.failure,'real server is unavailable after close');
    row.final=position();row.ram=machine.softwareRamDigest();row.jit=machine.jitStats();need(row.jit.executedBlocks>0,'real guest JIT');
    if(off){need(['sessionClock','sourceCapture','inputCapture','durableRecording','recorderDirtyTracking','pendingRamEpoch','gpuResultCapture'].every(key=>row.final[key]===false)&&row.final.pendingEvents===0,'OFF acquired event history');machine.free();}
    else {collect();final=machine.exactSessionWitness(true);witnesses.push(final);state.final={...coordinate(final),digest:hex(final.digest),raw:await save('final.resume',final.resume)};record=machine;original=JSON.stringify(row.server);}
    row.status='all-ten-real-bodies';
   }catch(error){try{row.failure=position();row.server=machine.ownedLocalHttpState();}catch{}if(off)machine.free();else record=machine;throw error;}
  }
  state.receipts=receipts.length;state.channels={};for(const row of receipts)state.channels[row.channel]=(state.channels[row.channel]??0)+1;
  state.receiptFile=await save('receipts.json',enc.encode(JSON.stringify(receipts.map(row=>({...row,bytes:[...row.bytes]})))));
  state.witnessFile=await save('witnesses.json',enc.encode(JSON.stringify(witnesses.map(row=>({...coordinate(row),digest:[...row.digest]})))));
  const factoryEntries=WasmLinux.ownedLocalHttpFactoryEntries();
  await onProgress({phase:'replay-start'});
  try{
   const replay=WasmLinux.newExactSession(kernel,image,software.bootargs,()=>{},true);
   try{
    const before=hex(replay.exactSessionWitness(false).digest);let refusal;try{replay.openOwnedLocalHttp();}catch(error){refusal=String(error);}
    need(refusal?.includes('ReplayIngress')&&WasmLinux.ownedLocalHttpFactoryEntries()===factoryEntries&&hex(replay.exactSessionWitness(false).digest)===before,'replay factory refused before mutation/construction');state.refusals.push({kind:'replay-factory',message:refusal});
    replay.enableJit(2);replay.beginExactReplay(initial.resume,receipts,witnesses,final);
    let result;
    for(let i=0;i<10000;i++){
     result=replay.runExactReplayChunkTo({...coordinate(final),transitionOnly:false},1048576);
     if(result.reached)break;await tick();
    }
    need(result.reached,'full replay did not reach declared end');const observed=replay.exactSessionWitness(true);
    need(hex(observed.digest)===hex(final.digest)&&observed.resume.length===final.resume.length&&observed.resume.every((byte,index)=>byte===final.resume[index]),'whole CPU/RAM/devices/disk/clock/queues/cursor mismatch');
    replayFrame=observed.resume;
    state.replays.push({position:coordinate(observed),digest:hex(observed.digest),rawBytes:observed.resume.length,exactNativeBytes:true,witnesses:witnesses.length,events:result.eventCursor});
   }finally{replay.free();}
  }finally{await onProgress({phase:'replay-end'});}
  state.replays[0].raw=await save('replay.resume',replayFrame);
  need(WasmLinux.ownedLocalHttpFactoryEntries()===factoryEntries&&JSON.stringify(record.ownedLocalHttpState())===original,'replay touched original/server/provider/host egress');
  state.factoryEntriesAfterReplay=factoryEntries;state.originalServerUnchanged=true;
  state.databases=await indexedDB.databases();const databaseKeys=rows=>JSON.stringify(rows.map(row=>[row.name,row.version]).sort());need(databaseKeys(state.databases)===databaseKeys(state.initialDatabases),'provider proof created unexpected persistence');state.status='passed';
 }catch(error){state.status='failed';state.error=error.stack??String(error);}
 finally{record?.free();}
 return state;
}
