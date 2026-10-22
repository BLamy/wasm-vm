// Full pinned Alpine OFF-mode functional proof, never a performance sample.
import init,{WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {checkpointHash} from '/session-checkpoints.js';
import {formatRpcCommand,createFencedRpc,stripConsole} from '/guest-rpc.js';
const enc=new TextEncoder(),dec=new TextDecoder(),need=(ok,why)=>{if(!ok)throw Error(why);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
export async function qualifySoftware(contract){
 await init();const fixture=contract.fixtures.find(f=>f.id==='software-alpine-v1');
 const [kernel,image,software]=await Promise.all([fetch('/'+fixture.artifacts.kernel.url).then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),fetch('/session-alpine-image.json').then(r=>r.text()),fetch('/session-software-fixture.json').then(r=>r.json())]);
 need(checkpointHash(kernel)===fixture.artifacts.kernel.sha256,'original kernel identity');
 const state={status:'running',scope:'full Alpine OFF-mode file/setup functionality only; no replay/GPU/network/performance claim',console:'',inputs:[],blocks:[],phases:[],initialDatabases:await indexedDB.databases()};
 let parser,rpc,lastProgress=0;const start=performance.now();
 const machine=WasmLinux.newUnrecordedSession(kernel,image,software.bootargs,bytes=>{const text=dec.decode(bytes,{stream:true});need(state.console.length+text.length<=1048576,'total console bound');state.console+=text;if(parser){const result=parser.feed(text);if(result)rpc=result;}});
 const inspect=()=>{const result=machine.unrecordedControlState();need(['sessionClock','sourceCapture','inputCapture','durableRecording','legacyResumeIdentity','legacySnapshotNamespace','audioOutputAttached','audioCaptureAttached','recorderDirtyTracking','pendingRamEpoch','gpuResultCapture'].every(k=>result[k]===false)&&result.pendingEvents===0,'capture became active');return result;};
 const step=async()=>{
  need(performance.now()-start<900000&&BigInt(inspect().transition)<3000000000n,'full OFF boot/command bound');
  for(const request of machine.exactDeviceRequests()){
   need(request.intent.kind==='block','unexpected device');const{sha256,length}=request.intent.content;
   const response=await fetch('/__base__/'+sha256+'.bin');need(response.ok,'base fetch');const bytes=new Uint8Array(await response.arrayBuffer());need(checkpointHash(bytes)===sha256&&bytes.length===Number(length),'base identity');
   const lease=machine.exactLeaseDeviceRequest(request.id);try{machine.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}
   state.blocks.push({id:request.id,sha256,length:bytes.length,at:inspect().transition});
  }
  need(machine.exactNetworkRequests().length===0,'this offline proof reached live networking');
  const result=machine.runChunk(1048576);need(!result.done,'guest stopped '+JSON.stringify(result));
  const current=inspect();if(performance.now()-lastProgress>15000){lastProgress=performance.now();await qualificationProgress({position:current,tail:stripConsole(state.console).slice(-350),blocks:state.blocks.length});}
  await tick();
 };
 const until=async predicate=>{while(!predicate())await step();};
 const send=text=>{const bytes=enc.encode(text),before=inspect();machine.sendInput(bytes);const after=inspect();
  need(BigInt(after.uart.offeredFrames)===BigInt(before.uart.offeredFrames)+1n&&BigInt(after.uart.offeredBytes)===BigInt(before.uart.offeredBytes)+BigInt(bytes.length)&&after.uart.lastOfferTransition===before.transition,'actual input offer coordinate');
  state.inputs.push({transition:before.transition,retired:before.retired,bytes:bytes.length,sha256:checkpointHash(bytes)});};
 try{
  machine.enableJit(2);state.initial=inspect();
  await until(()=>stripConsole(state.console).includes("can't access tty; job control turned off"));state.phases.push({name:'shell',...inspect()});
  parser=createFencedRpc('t22offsetup');send(formatRpcCommand(contract.workload.setup,'t22offsetup'));
  await until(()=>/(?:^|\n)E9_BEFORE\n/.test(stripConsole(state.console)));state.phases.push({name:'before-file',...inspect()});send(contract.workload.serial_advance);
  await until(()=>!!rpc);need(rpc.exit===0&&rpc.stdout.includes(contract.workload.after_sha256+'  '+contract.workload.guest_path),'frozen setup failed');state.setup=rpc;
  parser=createFencedRpc('t22offbytes');rpc=null;send(formatRpcCommand('od -An -v -tx1 /root/e9-session/state; od -An -v -tx1 /root/e9-session/entropy; sha256sum /root/e9-session/state /root/e9-session/entropy','t22offbytes'));
  await until(()=>!!rpc);need(rpc.exit===0&&rpc.stdout.trim().split('\n')[0].replace(/\s/g,'')===contract.workload.after_hex,'literal after bytes');state.files=rpc;
  state.final=inspect();need(state.final.uart.offeredFrames==='3'&&state.final.uart.appliedBytes===state.final.uart.offeredBytes&&state.final.uart.pendingBytes===0,'all offered commands must actually cross the FIFO');state.finalRamSha256=machine.softwareRamDigest();state.jit=machine.jitStats();need(state.jit.executedBlocks>0,'actual JIT did not execute');
  const attempts=[];
  for(const[name,invoke]of[['capture',()=>machine.exactSessionWitness(true)],['start-recording',()=>machine.startInputCapture(false)],['restore-candidate',()=>machine.prepareSoftwareKeyframeCandidate()],['page-import',()=>machine.applySoftwareRamDeltaChunk(new Uint8Array())]]){
   const before=JSON.stringify(inspect());let error;try{invoke();}catch(e){error=String(e.message);}need(error&&before===JSON.stringify(inspect())&&machine.softwareRamDigest()===state.finalRamSha256,'history misuse changed OFF guest');attempts.push({name,error});
  }
  state.refusals=attempts;state.finalDatabases=await indexedDB.databases();need(state.initialDatabases.length===0&&state.finalDatabases.length===0,'OFF created durable storage');state.status='unrecorded-alpine-setup-only';
 }catch(error){state.status='failed';state.error=error.stack??String(error);state.failurePosition=inspect();}
 finally{machine.free();}
 document.querySelector('pre').textContent=state.status+'\n'+state.console;return state;
}
