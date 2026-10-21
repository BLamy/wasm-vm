// A real Linux/ext2 parent with a past checkpoint and a different future /state file.
import init,{WasmLinux} from './pkg/wasm_vm_wasm.js';
import {SOFTWARE_CHECKPOINT_WASM_SHA256} from './gpu-checkpoint-build.js';
import {SessionInputJournal} from './session-inputs.js';
import {checkpointHash,checkpointReference,checkpointChunks} from './session-checkpoints.js';
import {sessionCanonicalImage} from './session-pkg/wasm_vm_session.js';
const encoder=new TextEncoder(),decoder=new TextDecoder(),need=(ok,message)=>{if(!ok)throw Error(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi init=/init';
export async function recordFileTimelineSample({store,id,signal,onProgress=()=>{}}){
  await init();
  const artifacts=await(await fetch(new URL('./artifacts.json',import.meta.url))).json();
  const kernelUrl=new URL(artifacts.artifacts.kernel.url,import.meta.url),baseUrl=new URL('./assets/session-branch-linux/',import.meta.url);
  const [kernelResponse,imageResponse,wasmResponse]=await Promise.all([
    fetch(kernelUrl),fetch(new URL('image.json',baseUrl)),fetch(new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url))]);
  need([kernelResponse,imageResponse,wasmResponse].every(response=>response.ok),'File example assets are unavailable');
  const kernel=new Uint8Array(await kernelResponse.arrayBuffer()),imageManifest=await imageResponse.text(),image=JSON.parse(imageManifest),wasm=new Uint8Array(await wasmResponse.arrayBuffer());
  need(checkpointHash(kernel)===artifacts.artifacts.kernel.sha256&&String(kernel.length)===String(artifacts.artifacts.kernel.size)
    &&checkpointHash(wasm)===SOFTWARE_CHECKPOINT_WASM_SHA256,'File example asset identity mismatch');
  let consoleText='';
  const machine=WasmLinux.newExactSession(kernel,imageManifest,bootargs,bytes=>{consoleText+=decoder.decode(bytes);},false);let writer,created=false,completed=false;
  try{
    machine.enableJit(2);
    const initial=machine.exactSessionWitness(true),base=checkpointHash(sessionCanonicalImage(imageManifest));
    const disk=new Uint8Array(61),header=new DataView(disk.buffer);disk.set(encoder.encode('WVOD1'));header.setUint32(5,4096,true);
    header.setBigUint64(9,BigInt(image.image_len),true);disk.set(Uint8Array.from(base.match(/../g),value=>parseInt(value,16)),17);
    const configuration={version:1,exactSession:1,providersComplete:true,runtime:'rv64-linux-exact-session-v1',ramMib:256,bootargs,
      clock:{mode:'icount',divider:10,timebase_hz:'10000000',interactive:null},
      kernel:{url:kernelUrl.href,sha256:checkpointHash(kernel),length:String(kernel.length)},
      wasm:{url:new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:checkpointHash(wasm),length:String(wasm.length)},
      devices:JSON.parse(machine.softwareCheckpointTopology()),imageManifest,baseUrl:baseUrl.href,timeEntropyPolicy:machine.sessionSourcePolicy(),
      deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},
      networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
    writer=await store.writer(id);need(!await store.openSession(id),'File example ID already exists');created=true;
    const journal=await SessionInputJournal.createLiveExact(store,writer,configuration,initial.resume,disk,initial),chunks=new Map();
    const check=()=>need(!signal?.aborted,'File example recording cancelled');
    // Retain every unique immutable base chunk up front, including those a child may first read.
    for(const sha256 of new Set(image.chunks)){
      check();const response=await fetch(new URL(sha256+'.bin',baseUrl));need(response.ok,'File example disk chunk missing');
      const bytes=new Uint8Array(await response.arrayBuffer()),ref=checkpointReference(bytes);need(ref.sha256===sha256&&bytes.length===image.chunk_size,'File example disk chunk identity');
      chunks.set(sha256,bytes);await writer.put(ref,checkpointChunks(bytes));
    }
    let steps=0,receipts=0;
    const collect=async()=>{
      const rows=machine.takeExactSessionDeliveries();receipts+=rows.length;need(receipts<=4096,'File example event bound');
      for(let at=0;at<rows.length;at+=64){if(journal.pending>=128)await journal.flush();journal.stage(rows.slice(at,at+64));}
    };
    const runUntil=async marker=>{
      while(!consoleText.includes(marker)){
        check();need(steps<3000000000,'File example boot exceeded its work bound: '+consoleText.slice(-300));
        for(const request of machine.exactDeviceRequests()){
          need(request.intent.kind==='block','File example reached an unsupported host device');
          const bytes=chunks.get(request.intent.content.sha256);need(bytes&&bytes.length===request.intent.content.length,'File example block identity');
          const lease=machine.exactLeaseDeviceRequest(request.id);try{machine.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}
          await collect();
        }
        const result=machine.runChunk(1048576);steps+=1048576;need(!result.done,'File example guest stopped');
        await collect();onProgress(`Recording Linux file example · ${machine.inputPosition().transition} transitions · ${consoleText.trim().split('\n').at(-1)??''}`);await tick();
      }
    };
    await runUntil('BRANCH_READY');await journal.flush();check();
    onProgress('Saving the past file state…');await journal.captureKeyframe(store,machine,configuration,'before-file-change');
    const past=machine.inputPosition();machine.sendInput(encoder.encode('P\n'));await collect();
    await runUntil('BRANCH_FILE_P');await journal.flush();
    // Finish only after the complete file hash has crossed the serial boundary.
    while(!/[0-9a-f]{64}  \/state/.test(consoleText)){
      const result=machine.runChunk(1048576);steps+=1048576;check();need(!result.done&&steps<3000000000,'File hash work bound');
      await collect();await tick();
    }
    await journal.flush();const end=machine.exactSessionWitness(false);await journal.completeExact(end,[initial,end],check);completed=true;
    return {id,past,end:{transition:end.transition,retired:end.retired,sequence:end.sequence,phase:end.phase,ordinal:end.ordinal},console:consoleText};
  }finally{machine.free();await writer?.release();if(created&&!completed)await store.deleteSession(id);}
}
