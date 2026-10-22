// A bounded real Linux boot excerpt proving capture is OFF. This is not a benchmark.
import {WasmLinux} from './pkg/wasm_vm_wasm.js';
import {checkpointHash} from './session-checkpoints.js';
const need=(ok,why)=>{if(!ok)throw Error('unrecorded control: '+why);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const disabled=['sessionClock','sourceCapture','inputCapture','durableRecording','legacyResumeIdentity','legacySnapshotNamespace','audioOutputAttached','audioCaptureAttached','recorderDirtyTracking','pendingRamEpoch','gpuResultCapture'];
export async function runUnrecordedControlProbe({onProgress=()=>{}}={}){
  const descriptor=await(await fetch(new URL('./artifacts-alpine.json',import.meta.url))).json();
  const fixture=await(await fetch(new URL('./session-software-fixture.json',import.meta.url))).json();
  const [kernelResponse,imageResponse]=await Promise.all([fetch(new URL(descriptor.artifacts.kernel.url,import.meta.url)),fetch(new URL('./session-alpine-image.json',import.meta.url))]);
  need(kernelResponse.ok&&imageResponse.ok,'pinned assets unavailable');
  const kernel=new Uint8Array(await kernelResponse.arrayBuffer()),image=await imageResponse.text();
  need(checkpointHash(kernel)===descriptor.artifacts.kernel.sha256,'kernel identity');
  const machine=WasmLinux.newUnrecordedSession(kernel,image,fixture.bootargs,()=>{});
  try{
    machine.enableJit(2);
    const read=()=>{const state=machine.unrecordedControlState();need(disabled.every(key=>state[key]===false)&&state.pendingEvents===0,'capture component became active');return state;};
    const initial=read();need(initial.ramBytes==='268435456'&&initial.divider==='10'&&initial.transition==='0','software profile');
    const refusals=[];
    for(const [name,invoke] of [['recording',()=>machine.startInputCapture(false)],['exact witness',()=>machine.exactSessionWitness(false)],['restore candidate',()=>machine.prepareSoftwareKeyframeCandidate()],['page import',()=>machine.applySoftwareRamDeltaChunk(new Uint8Array())],['clock policy',()=>machine.setGuestClock('wall')],['clock divider',()=>machine.setICountDivider(64)],['clock rebase',()=>machine.rebaseGuestClock()],['desktop save',()=>machine.saveDesktopSnapshot()],['desktop import',()=>machine.restoreDesktopSnapshot(new Uint8Array(),640,480)],['GPU trace',()=>machine.enableGpuCommandTrace()]]){
      const before=JSON.stringify(read()),ram=machine.softwareRamDigest();let error;
      try{invoke();}catch(failure){error=String(failure.message);}
      need(error&&JSON.stringify(read())===before&&machine.softwareRamDigest()===ram,name+' did not refuse before mutation');refusals.push({name,error});
    }
    machine.sendInput(new TextEncoder().encode('control\n'));
    const target=1000000n;
    while(BigInt(read().transition)<target){
      const amount=Number(target-BigInt(read().transition)<65536n?target-BigInt(read().transition):65536n);
      const result=machine.runChunk(amount);need(!result.done,'guest stopped');
      need(machine.exactDeviceRequests().length===0&&machine.exactNetworkRequests().length===0,'boot excerpt reached external work');
      onProgress('Running without recording · '+read().transition+' completed transitions');await tick();
    }
    const final=read();need(final.transition===String(target)&&BigInt(final.retired)>0n,'actual work coordinate');
    need(final.uart.offeredFrames==='1'&&final.uart.offeredBytes==='8'&&final.uart.appliedBytes==='8'&&final.uart.pendingBytes===0&&final.uart.lastFeedTransition==='0','actual UART delivery accounting');
    const jit=machine.jitStats();need(jit.hasExecutor&&jit.compiledBlocks>0&&jit.executedBlocks>0&&jit.retiredViaJit>0,'compiled JIT work was not exercised');
    return{status:'passed',scope:'one million real Linux boot transitions with capture disabled; no full-workload or performance claim',initial,final,refusals,jit,ramSha256:machine.softwareRamDigest()};
  }finally{machine.free();}
}
