// Real physical GPU functional/ownership proof in the capture-OFF profile.
import init,{WasmLinux,WasmGpuTransport} from '/pkg/wasm_vm_wasm.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from '/renderer/virgl-command/production.mjs';
import {PresentationController} from '/src/sink/presentation.js';
const need=(ok,why)=>{if(!ok)throw Error(why);},tick=()=>new Promise(resolve=>setTimeout(resolve,0));
export async function proveUnrecordedGpu(layered=false){
 await init();const kernel=new Uint8Array(await(await fetch('/kernel.bin')).arrayBuffer()),image=await(await fetch('/image.json')).text();
 const state={layered,actualNumericRefusals:[],scope:'actual production hardware GPU in unrecorded1GiB ICount64; bounded guest, not full desktop/performance qualification',status:'running',console:'',owners:[],blocks:0,pumps:0,phase:'construct',initialDatabases:await indexedDB.databases()};
 const vm=WasmLinux.newUnrecordedGpuSession(kernel,image,'console=ttyS0',bytes=>{state.console+=new TextDecoder().decode(bytes);need(state.console.length<=1048576,'serial bound');document.querySelector('pre').textContent=state.console;});
 const originalOwners=[],dmaCalls=[];
 const methods=['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput'],originalMethods={};
 const challenged=new Set();
 for(const name of methods){originalMethods[name]=WasmGpuTransport.prototype[name];WasmGpuTransport.prototype[name]=function(...args){
  if(!challenged.has(name)){
   const before={work:vm.unrecordedControlState(),ram:vm.softwareRamDigest()};let error;
   try{vm[name](...args);}catch(failure){error=String(failure.message);}
   const after={work:vm.unrecordedControlState(),ram:vm.softwareRamDigest()};
   need(error?.includes('owned GPU request transport required')&&JSON.stringify(before)===JSON.stringify(after),'numeric API accepted or mutated an authentic in-flight DMA exchange: '+name);
   challenged.add(name);state.actualNumericRefusals.push({name,error,args:args.map(value=>value instanceof Uint8Array?{length:value.length}:value),before,after});
  }
  const result=originalMethods[name].apply(this,args);dmaCalls.push({name,args:args.map(value=>value instanceof Uint8Array?{length:value.length}:value),returnedBytes:result?.length??null});return result;
 };}
 const presentation=new PresentationController(document.querySelector('canvas'),{scheduleFrames:false});let presenter,gpu;
 presenter=createWorkerScanoutPresenter(frame=>{if(frame.type==='clear'){presentation.clear();return;}if(frame.type==='invalidate'){presentation.invalidate();return;}const n=presentation.snapshot().drawnPresents,accepted=presentation.present(frame);queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,accepted&&presentation.snapshot().drawnPresents>n?'drawn':'failed'));});
 const attach=vm.attachVirgl.bind(vm);vm.attachVirgl=(...args)=>{const cb=args[3];args[3]=event=>{if(event.ownedTransport){state.owners.push({type:event.type,epoch:event.epoch,sequence:event.sequence});originalOwners.push({event,cap:event.ownedTransport});}return cb(event);};return attach(...args);};
 const inspect=()=>{const x=vm.unrecordedControlState();need(x.ramBytes==='1073741824'&&x.divider==='64'&&x.gpu===true&&x.pendingEvents===0&&['sessionClock','sourceCapture','inputCapture','durableRecording','legacyResumeIdentity','legacySnapshotNamespace','audioOutputAttached','audioCaptureAttached','recorderDirtyTracking','pendingRamEpoch','gpuResultCapture'].every(k=>x[k]===false),'OFF GPU capture/profile mismatch');return x;};
 try{
  gpu=await attachProductionVirgl(vm,{presenter});state.gpuInitial=gpu.inspect();state.initial=inspect();
  const snapshot=machine=>({work:machine.unrecordedControlState(),ram:machine.softwareRamDigest()});
  const refusal=(machine,name,call)=>{const before=snapshot(machine);let error;try{call();}catch(failure){error=String(failure.message);}
   const after=snapshot(machine);need(error&&JSON.stringify(before)===JSON.stringify(after),'mutation/nonrefusal: '+name);return{name,error,before,after};};
  const key=['0000000000000002','0000000000000001'],numeric=[...key,'0000000000000001',2,'0000000000000003','0000000000000002','0000000000000000',64,64,1];
  const numericCalls=machine=>[['gatherInput',numeric],['scatterOutput',[...numeric,new Uint8Array(64)]],['gatherLayeredInput',[...numeric,64,1]],['scatterLayeredOutput',[...numeric,64,1,new Uint8Array(64)]],['complete',[...key,'0000000000000000',0,true,0,0]]].map(([name,args])=>refusal(machine,'numeric '+name,()=>machine[name](...args)));
  state.initialNumericRefusals=numericCalls(vm);
  const softwareKernel=new Uint8Array(await(await fetch('/software-kernel.bin')).arrayBuffer()),softwareImage=await(await fetch('/session-alpine-image.json')).text();
  const software=WasmLinux.newUnrecordedSession(softwareKernel,softwareImage,'root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i',()=>{});
  try{const profile=gpu.checkpointProfile();state.softwareConfusion=[refusal(software,'software OFF physical attach',()=>software.attachVirgl(Uint32Array.from(profile.hostWords),Uint32Array.from(profile.formatRoles),profile.renderer,()=>{})),...numericCalls(software)];}finally{software.free();}
  state.refusals=[];
  for(const[name,call]of [['GPU command trace',()=>vm.enableGpuCommandTrace()],['GPU disk capture',()=>vm.captureGpuDiskDelta()],['accelerated export',()=>vm.saveAcceleratedSnapshot(new Uint8Array(32))],['accelerated import',()=>vm.loadAcceleratedSnapshotBlob(new Uint8Array(),new Uint8Array(32))]])state.refusals.push(refusal(vm,name,call));
  need(state.gpuInitial.profile.identity&&!/software|SwiftShader|llvmpipe/i.test(state.gpuInitial.profile.identity),'hardware GPU unavailable');vm.enableJit(2);
  let attacked=false;state.phase='guest-work';
  for(let step=0;step<10000;step++){
   const result=vm.runChunk(10000);need(!result.done,'GPU guest stopped '+JSON.stringify(result));inspect();
   for(const request of vm.exactDeviceRequests()){
    need(request.intent.kind==='block','unexpected device');const bytes=new Uint8Array(await(await fetch('/zero.bin')).arrayBuffer()),lease=vm.exactLeaseDeviceRequest(request.id);
    try{vm.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}state.blocks++;
   }
   if(gpu.inspect().pending){
    if(!attacked){
     state.pendingNumericRefusals=numericCalls(vm);
     const before={work:inspect(),ram:vm.softwareRamDigest(),pending:gpu.inspect().pending};let error;
     try{vm.drainGpuCheckpointBoundary();}catch(failure){error=String(failure.message);}
     const after={work:inspect(),ram:vm.softwareRamDigest(),pending:gpu.inspect().pending};
     state.checkpointDrainAttack={before,after,error:error??null};
     need(error&&JSON.stringify(before)===JSON.stringify(after),'OFF checkpoint drain must refuse before mutation or waiting');attacked=true;
    }
    for(let count=0;gpu.inspect().pending&&count<5000;count++){const pump=gpu.pump();state.pumps++;need(pump.ok,'physical GPU pump failure '+JSON.stringify(pump));await tick();}
    need(!gpu.inspect().pending,'physical GPU job stranded');inspect();
   }
   need(!state.console.includes('SESSION_FAIL'),'guest GPU assertion failed');
   if(state.console.includes('SESSION_DONE')){
    for(const marker of [...(layered?['SESSION_LAYERED_GUARD_BYTES_OK']:[]),'SESSION_QUERY_VISIBLE_1','SESSION_QUERY_EMPTY_0','SESSION_READBACK_GREEN_16384','SESSION_FRAME_AND_DISK_OK','SESSION_EXPECTED_GPU_ERROR_1205'])need(state.console.includes(marker),'missing real GPU result '+marker);
    need(attacked&&state.owners.length>0,'original-request GPU callbacks absent');state.final=inspect();state.gpuFinal=gpu.inspect();
    if(layered)need(dmaCalls.some(call=>call.name==='gatherLayeredInput')&&dmaCalls.some(call=>call.name==='scatterLayeredOutput'),'layered input/output not executed');
    need(state.actualNumericRefusals.some(call=>call.name.startsWith('gather'))&&state.actualNumericRefusals.some(call=>call.name.startsWith('scatter')),'authentic numeric DMA attacks absent');
    need(dmaCalls.some(call=>call.name.startsWith('gather'))&&dmaCalls.some(call=>call.name.startsWith('scatter')),'actual typed DMA input and output absent');state.typedDma=dmaCalls;
    const old=originalOwners[0],event=old.event,numericOld=[event.epoch,event.sequence,'0000000000000001',2,'0000000000000003','0000000000000002','0000000000000000',64,64,1];
    state.retiredOwnerRefusals=[refusal(vm,'retired original completion',()=>old.cap.complete(event.epoch,event.sequence,'0000000000000000',0,true,0,0)),refusal(vm,'retired original gather',()=>old.cap.gatherInput(...numericOld)),refusal(vm,'retired original scatter',()=>old.cap.scatterOutput(...numericOld,new Uint8Array(64)))];
    const profile=gpu.checkpointProfile();state.refusals.push(refusal(vm,'GPU reattach/rearm after execution',()=>vm.attachVirgl(Uint32Array.from(profile.hostWords),Uint32Array.from(profile.formatRoles),profile.renderer,()=>{})));state.jit=vm.jitStats();state.ramSha256=vm.softwareRamDigest();
    state.presentation=presentation.snapshot();state.pixel=[...document.querySelector('canvas').getContext('2d').getImageData(32,32,1,1).data];need(state.pixel[1]===255&&state.pixel[3]===255,'actual green physical canvas');
    state.finalDatabases=await indexedDB.databases();need(state.initialDatabases.length===0&&state.finalDatabases.length===0,'OFF GPU created history storage');state.status='passed';break;
   }
   if(step%8===0)await tick();
  }
  need(state.status==='passed','GPU work bound');
 }catch(error){state.status='failed';state.error=error.stack??String(error);state.failurePosition=inspect();state.gpuFailure=gpu?.inspect();}
 finally{gpu?.dispose();vm.free();for(const name of methods)WasmGpuTransport.prototype[name]=originalMethods[name];}
 return state;
}
