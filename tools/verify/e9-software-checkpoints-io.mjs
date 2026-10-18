import assert from 'node:assert/strict';
export async function checkSoftwareCheckpointIo(parentPage, fixture) {
  const ownership=await parentPage.evaluate(async fixture=>{
    const {startLinuxBoot}=await import('./loader.js');
    const controller=await startLinuxBoot({manifestUrl:fixture.boot_manifest,mode:'chunked',imageManifestUrl:fixture.image_manifest,
      baseUrl:fixture.base_url,bootProfileUrl:null,bootSnapshot:false,ramMib:fixture.ram_mib,
      bootargs:fixture.bootargs,startPaused:true,guestClock:'icount',icountDivider:10});
    const result={};
    try {
      const before=controller.schedulerStats(),clock=controller.guestClockState();
      const pending=controller.captureSoftwareCheckpoint();
      result.display=controller.setDisplay(900,700);result.keyboard=controller.sendKeyboardEvent(1,30,1);
      try{controller.snapshotAdvanceGen();result.generation='accepted';}catch(error){result.generation=error.message;}
      try{controller.resume();result.resume='accepted';}catch(error){result.resume=error.message;}
      try{await controller.captureSoftwareCheckpoint();result.concurrent='accepted';}catch(error){result.concurrent=error.message;}
      const frame=await pending;
      result.before=before.retiredInstructions;result.after=controller.schedulerStats().retiredInstructions;
      result.clockSame=JSON.stringify(clock)===JSON.stringify(controller.guestClockState());result.bytes=frame.length;
      const revoked=controller.captureSoftwareCheckpoint().then(()=>'accepted',error=>error.message);
      await controller.stop();result.revoked=await revoked;
      try{await controller.captureSoftwareCheckpoint();result.stopped='accepted';}catch(error){result.stopped=error.message;}
    }finally{await controller.stop();await controller.releaseWriterLock();controller.closeStorage();}
    return result;
  },fixture);
  assert.equal(ownership.display,false);assert.equal(ownership.keyboard,false);
  assert.match(ownership.generation,/capture owns the machine/);assert.match(ownership.resume,/capture owns the machine/);
  assert.match(ownership.concurrent,/pause the software guest/);assert.equal(ownership.before,0);assert.equal(ownership.after,0);
  assert.equal(ownership.clockSame,true);assert.ok(ownership.bytes>212);
  assert.equal(ownership.revoked,'session checkpoint owner stopped');assert.match(ownership.stopped,/pause the software guest/);
  // Expected backend errors are confined to this critic page; the actual demo's console gate
  // stays strict. Assert their exact bounded sequence rather than filtering general errors.
  const page=await parentPage.context().newPage(),consoleErrors=[],pageErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(parentPage.url(),{waitUntil:'domcontentloaded'});
  let healthy=false;
  await page.exposeFunction('__e9RecoverCheckpointBackend',()=>{healthy=true;});
  await page.route('**/__e9_bad_chunk/**',async route=>{
    if(!healthy){await route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.from([0])});return;}
    const relative=new URL(route.request().url()).pathname.split('/__e9_bad_chunk/')[1];
    assert.match(relative,/^chunks\/[a-f0-9]{64}\.bin$/);
    const response=await page.context().request.get(new URL(relative,fixture.base_url).href);assert.equal(response.status(),200);
    await route.fulfill({response});
  });
  let result;
  try {
    result = await page.evaluate(async fixture=>{
      const {default:init,WasmLinux,overlayDbName}=await import('./pkg/wasm_vm_wasm.js');await init();
      const manifest=await (await fetch(fixture.boot_manifest)).json();
      const kernel=new Uint8Array(await (await fetch(manifest.artifacts.kernel.url)).arrayBuffer());
      const image=await (await fetch(fixture.image_manifest)).text();
      const {decodeSoftwareCheckpoint,checkpointHash,checkpointZeroPosition}=await import('./session-checkpoints.js');
      const {GPU_CHECKPOINT_BUILD_ID}=await import('./gpu-checkpoint-build.js');
      const context=new TextEncoder().encode(JSON.stringify({version:{major:1,minor:0},runtime:GPU_CHECKPOINT_BUILD_ID,
        kernel:checkpointHash(kernel),ram_bytes:String(fixture.ram_mib*1048576),
        clock:{mode:'icount',divider:10,timebase_hz:'10000000',interactive:null},position:checkpointZeroPosition(),
        held:{keyboard:[30],tablet:[],mouse:[]}}));
      const capture=async machine=>{const frame=await machine.captureSoftwareCheckpoint(context);
        const parts=decodeSoftwareCheckpoint(frame);return {frame,parts,delta:parts.disk};};
      const seed='e904'.repeat(16),name=overlayDbName(image,seed);
      const clock=machine=>JSON.stringify(machine.guestClockState());
      const evidence={read:null,write:null,unsupported:null,bounded:null,output:''};
      const machine=await WasmLinux.newChunkedDiskPersistent(fixture.ram_mib,kernel,image,
        fixture.base_url,64,new Uint32Array(),fixture.bootargs,false,
        bytes=>{evidence.output+=new TextDecoder().decode(bytes);},seed,false);
      machine.setGuestClock('icount');machine.enableJit(32);machine.sendKeyboardEvent(1,30,1);machine.syncKeyboard();
      let retired=0;
      try {
        const deadline=performance.now()+120000;
        for(let step=0;step<4000&&performance.now()<deadline;step++) {
          const slice=machine.runChunk(500000,16*1024*1024);retired+=Number(slice.retired)||0;
          if(slice.done)throw Error('direct guest stopped before disk barriers were reached');
          const pending=Array.from(machine.pendingChunks());
          if(pending.length&&!evidence.read) {
            const beforeClock=clock(machine),beforeFetch=machine.fetchStats();
            const {delta,frame,parts}=await capture(machine);
            evidence.read={pending,beforeClock,afterClock:clock(machine),beforeFetch,afterFetch:machine.fetchStats(),
              remaining:Array.from(machine.pendingChunks()),retired,deltaBytes:delta.length,
              checkpointBytes:frame.length,context:parts.context,native:checkpointHash(parts.native)};
            const candidate=WasmLinux.newChunkedDiskSeeded(fixture.ram_mib,kernel,image,
              fixture.base_url,64,new Uint32Array(),fixture.bootargs,()=>{},false,delta);
            try {
              candidate.restoreSoftwareCheckpoint(frame,context);
              const restored=await capture(candidate);
              evidence.read.exactRestored=checkpointHash(restored.frame)===checkpointHash(frame);
              evidence.read.corruption=[];
              for(const part of ['contextBytes','native','disk','input','output']) {
                const rejected=frame.slice();
                const at=parts[part].byteOffset-frame.byteOffset;
                // Empty queues still have a digest in the header; corrupt that digest.
                rejected[parts[part].length?at:12+(['contextBytes','native','disk','input','output'].indexOf(part))*40+8]^=1;
                let error;try{candidate.restoreSoftwareCheckpoint(rejected,context);error='accepted';}catch(value){error=value.message;}
                const after=await capture(candidate);
                evidence.read.corruption.push({part,error,unchanged:checkpointHash(after.frame)===checkpointHash(restored.frame)});
              }
              let wrongDisk=delta.slice();
              if(wrongDisk.length>61)wrongDisk[69]^=1;
              else {wrongDisk=new Uint8Array(61+4104);wrongDisk.set(delta);
                new DataView(wrongDisk.buffer).setUint32(57,1,true);wrongDisk[69]=0x71;}
              const sibling=WasmLinux.newChunkedDiskSeeded(fixture.ram_mib,kernel,image,
                fixture.base_url,64,new Uint32Array(),fixture.bootargs,()=>{},false,wrongDisk);
              try{try{sibling.restoreSoftwareCheckpoint(frame,context);evidence.read.sibling='accepted';}catch(value){evidence.read.sibling=value.message;}}
              finally{sibling.free();}
            } finally {candidate.free();}
          }else if(pending.length)await machine.fetchPending();
          const pressure=machine.persistStats();
          if((pressure.writeWaiting||pressure.flushWaiting||pressure.pendingBytes>0)&&!evidence.write) {
            const beforeClock=clock(machine),beforeGeneration=machine.overlayGeneration();
            const {delta,frame,parts}=await capture(machine);
            evidence.write={pressure,after:machine.persistStats(),beforeClock,afterClock:clock(machine),beforeGeneration,
              generation:String(new DataView(delta.buffer,delta.byteOffset).getBigUint64(49,true)),
              blocks:new DataView(delta.buffer,delta.byteOffset).getUint32(57,true),retired,deltaBytes:delta.length};
          }else if(pressure.pendingBytes>0)await machine.persistPending();
          if(evidence.read&&evidence.write)break;
          if(step%16===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(!evidence.read||!evidence.write)throw Error('direct guest never reached both original disk barriers');
      }finally{machine.closeStorage();machine.free();}
      await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('critic database still held'));});
      const unsupported=new WasmLinux(64,kernel,new Uint8Array(),'console=ttyS0 earlycon=sbi',()=>{},false);
      try {await unsupported.captureSoftwareCheckpoint(context);evidence.unsupported='accepted';}catch(error){evidence.unsupported=error.message;}finally{unsupported.free();}
      const broken=WasmLinux.newChunkedDisk(fixture.ram_mib,kernel,image,
        new URL('./__e9_bad_chunk/',location.href).href,64,new Uint32Array(),fixture.bootargs,()=>{},false);
      broken.setGuestClock('icount');broken.enableJit(32);
      try {
        const deadline=performance.now()+120000;let pending=[];
        for(let step=0;step<4000&&performance.now()<deadline;step++) {
          const slice=broken.runChunk(500000);if(slice.done)throw Error('broken-base guest stopped before original read');
          pending=Array.from(broken.pendingChunks());if(pending.length)break;
          if(step%16===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(!pending.length)throw Error('broken-base guest never requested a chunk');
        const beforeClock=clock(broken);let error;
        try{await broken.captureSoftwareCheckpoint(context);error='accepted';}catch(value){error=value.message;}
        evidence.bounded={pending,beforeClock,afterClock:clock(broken),error,fetch:broken.fetchStats()};
        await window.__e9RecoverCheckpointBackend();
        const recovered=await capture(broken);
        evidence.bounded.recovered={bytes:recovered.frame.length,clock:clock(broken),remaining:Array.from(broken.pendingChunks()),run:broken.runChunk(50000)};
      }finally{broken.free();}
      return evidence;
    },fixture);
  }finally{await page.unroute('**/__e9_bad_chunk/**');await page.close();}
  assert.equal(result.read.exactRestored,true);
  assert.ok(result.read.corruption.every(item=>item.error!=='accepted'&&item.unchanged));
  assert.equal(result.read.sibling,'session_checkpoint_disk_mismatch');
  assert.ok(result.read.pending.length>0);assert.deepEqual(result.read.remaining,[]);
  assert.equal(result.read.beforeClock,result.read.afterClock);
  assert.ok(result.read.afterFetch.fetches>result.read.beforeFetch.fetches);
  assert.ok(result.write.pressure.writeWaiting||result.write.pressure.flushWaiting);
  assert.equal(result.write.after.pendingBytes,0);assert.equal(result.write.after.writeWaiting,false);assert.equal(result.write.after.flushWaiting,false);
  assert.equal(result.write.beforeClock,result.write.afterClock);assert.ok(result.write.blocks>0);
  assert.equal(BigInt(result.write.generation),BigInt(result.write.beforeGeneration)+1n);
  assert.equal(result.unsupported,'session_checkpoint_profile');
  assert.equal(result.bounded.error,'session_checkpoint_busy_or_budget');
  assert.equal(result.bounded.beforeClock,result.bounded.afterClock);assert.ok(result.bounded.fetch.error);
  assert.equal(result.bounded.recovered.clock,result.bounded.beforeClock);assert.deepEqual(result.bounded.recovered.remaining,[]);
  assert.ok(result.bounded.recovered.run.retired>0);
  const chunk=result.bounded.pending[0];
  assert.deepEqual(consoleErrors,new Array(16).fill(`lazy fetch failed — chunk ${chunk}: RetriesExhausted { chunk: ${chunk} }`));
  assert.deepEqual(pageErrors,[]);
  return {...result,ownership,expectedConsoleErrors:consoleErrors,pageErrors};
}
