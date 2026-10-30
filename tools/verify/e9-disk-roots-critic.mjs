// Fresh E9-T04 critic: real loader admission and capture ownership, without mocked machines.
import assert from 'node:assert/strict';

export async function checkDiskRootCritic(page, fixture) {
  const result = await page.evaluate(async fixture => {
    const {startLinuxBoot} = await import('./loader.js');
    const binding = {database:'wasm-vm-sessions-v1-critic-missing',sha256:'a'.repeat(64),generation:'0'};
    const base = {manifestUrl:fixture.boot_manifest,mode:'chunked',imageManifestUrl:fixture.image_manifest,
      baseUrl:fixture.base_url,bootProfileUrl:null,bootSnapshot:false,ramMib:fixture.ram_mib,
      bootargs:fixture.bootargs,startPaused:true,guestClock:'icount',icountDivider:10};
    const reject = async options => {
      try { const controller = await startLinuxBoot(options); await controller.stop(); return 'accepted'; }
      catch(error) { return error.message; }
    };
    const invalidDescriptors = [];
    for(const value of ['',[],{}, {...binding,unexpected:true}, {...binding,sha256:0}, {...binding,generation:0}]) {
      invalidDescriptors.push(await reject({...base,sessionDiskRoot:value}));
    }
    const incompatible = [];
    for(const options of [{mode:'initramfs'},{persist:true},{bootSnapshot:undefined},
      {freshDesktop:true,bootSnapshot:true},{virgl:true,workerMode:true},{extraDiskUrl:'./unused-extra.img'}]) {
      incompatible.push(await reject({...base,...options,sessionDiskRoot:binding}));
    }
    const missingRoot = await reject({...base,sessionDiskRoot:binding});
    const controller = await startLinuxBoot(base);
    try {
      const before = controller.schedulerStats();
      controller.resume();
      let running;
      try { await controller.captureDiskDelta(); running='accepted'; } catch(error) { running=error.message; }
      controller.pause();
      const first = controller.captureDiskDelta();
      let concurrent;
      try { await controller.captureDiskDelta(); concurrent='accepted'; } catch(error) { concurrent=error.message; }
      const delta = await first;
      const after = controller.schedulerStats();
      const duringStop = controller.captureDiskDelta().then(()=>'accepted',error=>error.message);
      await controller.stop();
      const stoppedOwner = await duringStop;
      let stopped;
      try { await controller.captureDiskDelta(); stopped='accepted'; } catch(error) { stopped=error.message; }
      return {invalidDescriptors,incompatible,missingRoot,running,concurrent,stoppedOwner,stopped,
        deltaBytes:delta.length,deltaMagic:new TextDecoder().decode(delta.subarray(0,5)),
        deltaBlocks:new DataView(delta.buffer,delta.byteOffset,delta.byteLength).getUint32(57,true),
        beforeRetired:before.retiredInstructions,afterRetired:after.retiredInstructions};
    } finally {
      await controller.stop();await controller.releaseWriterLock();controller.closeStorage();
    }
  },fixture);
  assert.ok(result.invalidDescriptors.every(value=>value==='invalid historical disk root descriptor'));
  assert.ok(result.incompatible.every(value=>value==='historical disk roots require an ephemeral software chunked boot with bootSnapshot=false'));
  assert.match(result.missingRoot,/MissingObject/);
  for(const name of ['running','concurrent','stopped']) assert.match(result[name],/^session_disk_capture: pause a software chunked guest/);
  assert.equal(result.stoppedOwner,'session_disk_capture: owner stopped');
  assert.equal(result.deltaMagic,'WVOD1');assert.equal(result.deltaBytes,61);assert.equal(result.deltaBlocks,0);
  assert.equal(result.beforeRetired,0);assert.equal(result.afterRetired,0);
  return result;
}

// Drive the genuine native machine directly so capture, rather than the ordinary scheduler,
// owns an outstanding original fetch/write. The error fixture changes only HTTP response bytes.
export async function checkDiskRootIoCritic(parentPage, fixture) {
  // Expected backend errors are confined to this critic page; the actual demo's console gate
  // stays strict. Assert their exact bounded sequence rather than filtering general errors.
  const page=await parentPage.context().newPage(),consoleErrors=[],pageErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(parentPage.url(),{waitUntil:'domcontentloaded'});
  await page.route('**/__e9_bad_chunk/**',route=>route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.from([0])}));
  let result;
  try {
    result = await page.evaluate(async fixture=>{
      const {default:init,WasmLinux,overlayDbName}=await import('./pkg/wasm_vm_wasm.js');await init();
      const manifest=await (await fetch(fixture.boot_manifest)).json();
      const kernel=new Uint8Array(await (await fetch(manifest.artifacts.kernel.url)).arrayBuffer());
      const image=await (await fetch(fixture.image_manifest)).text();
      const seed='e904'.repeat(16),name=overlayDbName(image,seed);
      const clock=machine=>JSON.stringify(machine.guestClockState());
      const evidence={read:null,write:null,unsupported:null,bounded:null,output:''};
      const machine=await WasmLinux.newChunkedDiskPersistent(fixture.ram_mib,kernel,image,
        fixture.base_url,64,new Uint32Array(),fixture.bootargs,false,
        bytes=>{evidence.output+=new TextDecoder().decode(bytes);},seed,false);
      machine.setGuestClock('icount');machine.enableJit(32);
      let retired=0;
      try {
        const deadline=performance.now()+120000;
        for(let step=0;step<4000&&performance.now()<deadline;step++) {
          const slice=machine.runChunk(500000,16*1024*1024);retired+=Number(slice.retired)||0;
          if(slice.done)throw Error('direct guest stopped before disk barriers were reached');
          const pending=Array.from(machine.pendingChunks());
          if(pending.length&&!evidence.read) {
            const beforeClock=clock(machine),beforeFetch=machine.fetchStats();
            const delta=await machine.captureDiskDelta();
            evidence.read={pending,beforeClock,afterClock:clock(machine),beforeFetch,afterFetch:machine.fetchStats(),
              remaining:Array.from(machine.pendingChunks()),retired,deltaBytes:delta.length};
          }else if(pending.length)await machine.fetchPending();
          const pressure=machine.persistStats();
          if((pressure.writeWaiting||pressure.flushWaiting||pressure.pendingBytes>0)&&!evidence.write) {
            const beforeClock=clock(machine),beforeGeneration=machine.overlayGeneration();
            const delta=await machine.captureDiskDelta();
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
      try {await unsupported.captureDiskDelta();evidence.unsupported='accepted';}catch(error){evidence.unsupported=error.message;}finally{unsupported.free();}
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
        try{await broken.captureDiskDelta();error='accepted';}catch(value){error=value.message;}
        evidence.bounded={pending,beforeClock,afterClock:clock(broken),error,fetch:broken.fetchStats()};
      }finally{broken.free();}
      return evidence;
    },fixture);
  }finally{await page.unroute('**/__e9_bad_chunk/**');await page.close();}
  assert.ok(result.read.pending.length>0);assert.deepEqual(result.read.remaining,[]);
  assert.equal(result.read.beforeClock,result.read.afterClock);
  assert.ok(result.read.afterFetch.fetches>result.read.beforeFetch.fetches);
  assert.ok(result.write.pressure.writeWaiting||result.write.pressure.flushWaiting);
  assert.equal(result.write.after.pendingBytes,0);assert.equal(result.write.after.writeWaiting,false);assert.equal(result.write.after.flushWaiting,false);
  assert.equal(result.write.beforeClock,result.write.afterClock);assert.ok(result.write.blocks>0);
  assert.equal(BigInt(result.write.generation),BigInt(result.write.beforeGeneration)+1n);
  assert.equal(result.unsupported,'session_disk_unsupported');
  assert.equal(result.bounded.error,'session_disk_busy_or_budget');
  assert.equal(result.bounded.beforeClock,result.bounded.afterClock);assert.ok(result.bounded.fetch.error);
  const chunk=result.bounded.pending[0];
  assert.deepEqual(consoleErrors,new Array(16).fill(`lazy fetch failed — chunk ${chunk}: RetriesExhausted { chunk: ${chunk} }`));
  assert.deepEqual(pageErrors,[]);
  return {...result,expectedConsoleErrors:consoleErrors,pageErrors};
}
