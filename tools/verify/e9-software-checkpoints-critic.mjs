// Fresh E9-T05 critic. Uses actual built Wasm, strict IndexedDB publication and independent rehashing.
import assert from 'node:assert/strict';

export async function checkSoftwareCheckpointCritic(page, fixture) {
  const result = await page.evaluate(async fixture => {
    const {startLinuxBoot} = await import('./loader.js');
    const {default:init,WasmLinux} = await import('./pkg/wasm_vm_wasm.js');
    const {SessionStore} = await import('./session-store.js');
    const {SessionCheckpoints,decodeSoftwareCheckpoint,checkpointHash} = await import('./session-checkpoints.js');
    const {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256} = await import('./gpu-checkpoint-build.js');
    await init();
    const configOpts = {manifestUrl:fixture.boot_manifest,mode:'chunked',imageManifestUrl:fixture.image_manifest,
      baseUrl:fixture.base_url,bootProfileUrl:null,bootSnapshot:false,ramMib:fixture.ram_mib,
      bootargs:fixture.bootargs,startPaused:true,guestClock:'icount',icountDivider:10};
    const controller = await startLinuxBoot(configOpts);
    const database = 'wasm-vm-sessions-v1-checkpoint-critic-' + crypto.randomUUID();
    let store, lease, candidate;
    const checks = {native:[], publication:[]};
    const refuse = async fn => {try {await fn();return 'accepted';}catch(error){return error.message;}};
    try {
      const frame = await controller.captureSoftwareCheckpoint();
      const configuration = controller.softwareCheckpointConfiguration();
      const originalHash = checkpointHash(frame), parts = decodeSoftwareCheckpoint(frame);
      const manifest = await (await fetch(fixture.boot_manifest)).json();
      const kernel = new Uint8Array(await (await fetch(manifest.artifacts.kernel.url)).arrayBuffer());
      candidate = WasmLinux.newChunkedDiskSeeded(fixture.ram_mib,kernel,configuration.imageManifest,
        fixture.base_url,64,new Uint32Array(),fixture.bootargs,()=>{},false,parts.disk);
      candidate.restoreSoftwareCheckpoint(frame,parts.contextBytes);
      const baseline = checkpointHash(await candidate.captureSoftwareCheckpoint(parts.contextBytes));
      // Rebuild the envelope with WebCrypto hashes, bypassing the production framing encoder.
      const replaceNative = async native => {
        const values=[parts.contextBytes,native,parts.disk,parts.input,parts.output];
        const result=new Uint8Array(212+values.reduce((n,item)=>n+item.length,0));
        result.set(new TextEncoder().encode('WVSOFT01'));
        const header=new DataView(result.buffer);header.setUint32(8,1,true);let offset=212;
        for(let i=0;i<values.length;i++) {
          header.setBigUint64(12+i*40,BigInt(values[i].length),true);
          result.set(new Uint8Array(await crypto.subtle.digest('SHA-256',values[i])),20+i*40);
          result.set(values[i],offset);offset+=values[i].length;
        }
        return result;
      };
      const nativeView=new DataView(parts.native.buffer,parts.native.byteOffset,parts.native.length);
      for(let at=84;at<parts.native.length;) {
        const tag=nativeView.getUint32(at,true),size=nativeView.getUint32(at+4,true);
        if(!size)throw Error('critic expected nonempty native component');
        const native=new Uint8Array(parts.native.length-1);
        native.set(parts.native.subarray(0,at+8+size-1));
        native.set(parts.native.subarray(at+8+size),at+8+size-1);
        new DataView(native.buffer).setUint32(at+4,size-1,true);
        const error=await refuse(async()=>candidate.restoreSoftwareCheckpoint(await replaceNative(native),parts.contextBytes));
        checks.native.push({tag,error,unchanged:checkpointHash(await candidate.captureSoftwareCheckpoint(parts.contextBytes))===baseline});
        at+=8+size;
      }
      store=await SessionStore.open(database);lease=await store.writer('critic');
      const checkpoints=new SessionCheckpoints(store);
      await checkpoints.save(lease,'first',frame,configuration);
      await checkpoints.save(lease,'second',frame,configuration);
      const expectedAppend=['first','second'];
      const publicationResult=async(id,pending,beforeHash)=>{
        const error=await refuse(()=>pending);
        const opened=await store.openSession('critic');
        let coherent=false;
        if(error==='accepted') {
          coherent=checkpointHash((await checkpoints.admit('critic',id,GPU_CHECKPOINT_BUILD_ID,
            SOFTWARE_CHECKPOINT_WASM_SHA256)).frame)===originalHash;
          expectedAppend.push(id);
        }
        return {case:id,error,coherent,unchanged:checkpointHash(opened.manifest)===beforeHash};
      };
      // save() must pin all caller-owned state before its first durable await.
      const changed=frame.slice();
      let beforeHash=checkpointHash((await store.openSession('critic')).manifest);
      const mutation=checkpoints.save(lease,'mutated',changed,configuration);
      changed[parts.native.byteOffset-frame.byteOffset+100]^=0x40;
      checks.publication.push(await publicationResult('mutated',mutation,beforeHash));
      const detached=frame.slice();
      beforeHash=checkpointHash((await store.openSession('critic')).manifest);
      const detachment=checkpoints.save(lease,'detached',detached,configuration);
      structuredClone(detached.buffer,{transfer:[detached.buffer]});
      checks.publication.push(await publicationResult('detached',detachment,beforeHash));
      const mutableConfig=structuredClone(configuration);
      const pinned=checkpoints.save(lease,'pinned',frame,mutableConfig);
      mutableConfig.kernel.sha256='0'.repeat(64);mutableConfig.kernel.url='./not-a-kernel';
      mutableConfig.clock.divider=999;mutableConfig.devices.length=0;
      await pinned;
      const admitted=await checkpoints.admit('critic','pinned',GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256);
      checks.configurationPinned=JSON.stringify(admitted.configuration)===JSON.stringify(configuration)
        &&checkpointHash(admitted.frame)===originalHash;
      checks.successfulAppend=JSON.parse(new TextDecoder().decode((await store.openSession('critic')).manifest))
        .checkpoints.map(item=>item.id);
      expectedAppend.push('pinned');checks.expectedAppend=expectedAppend;
      // Two stale append candidates race one strict cursor: at most one may become visible.
      const racing=await Promise.allSettled(['race-a','race-b'].map(id=>checkpoints.save(lease,id,frame,configuration)));
      const final=await store.openSession('critic'), finalManifest=JSON.parse(new TextDecoder().decode(final.manifest));
      checks.race={results:racing.map(item=>item.status==='fulfilled'?'committed':item.reason.message),
        revision:final.revision,ids:finalManifest.checkpoints.map(item=>item.id)};
      checks.originalStillAdmitted=checkpointHash((await checkpoints.admit('critic','first',GPU_CHECKPOINT_BUILD_ID,
        SOFTWARE_CHECKPOINT_WASM_SHA256)).frame)===originalHash;
      const directRestore=await startLinuxBoot({sessionCheckpoint:{database,id:'critic',checkpoint:'first'}});
      try {
        checks.directLoaderRestore={paused:directRestore.isPaused(),restored:directRestore.restoredFromBootSnapshot(),
          retired:directRestore.schedulerStats().retiredInstructions,
          exact:checkpointHash(await directRestore.captureSoftwareCheckpoint())===originalHash};
      } finally {await directRestore.stop();await directRestore.releaseWriterLock();directRestore.closeStorage();}
      const topologyLease=await store.writer('wrong-topology');
      try {
        const wrongConfiguration=structuredClone(configuration);wrongConfiguration.devices[0].irq=1;
        await checkpoints.save(topologyLease,'wrong-topology',frame,wrongConfiguration);
        checks.loaderTopology=await refuse(async()=>{
          const unexpected=await startLinuxBoot({sessionCheckpoint:{database,id:'wrong-topology',checkpoint:'wrong-topology'}});
          await unexpected.stop();await unexpected.releaseWriterLock();unexpected.closeStorage();
        });
      } finally {await topologyLease.release();}
      checks.sourceUnchanged=checkpointHash(await controller.captureSoftwareCheckpoint())===originalHash;
      checks.sourceRetired=controller.schedulerStats().retiredInstructions;
      checks.profile={};
      candidate.setGuestClock('wall');
      checks.profile.wall=await refuse(()=>candidate.captureSoftwareCheckpoint(parts.contextBytes));
      candidate.setGuestClock('icount');
      checks.profile.restoreDescriptor=await refuse(()=>startLinuxBoot({
        sessionCheckpoint:{database,id:'critic',checkpoint:'first',unrecognized:true}}));
      const wallController=await startLinuxBoot({...configOpts,guestClock:'wall',icountDivider:undefined});
      try {checks.profile.loaderWall=await refuse(()=>wallController.captureSoftwareCheckpoint());}
      finally {await wallController.stop();await wallController.releaseWriterLock();wallController.closeStorage();}
      const microphone=WasmLinux.newChunkedDisk(fixture.ram_mib,kernel,configuration.imageManifest,
        fixture.base_url,64,new Uint32Array(),fixture.bootargs,()=>{},true);
      try {checks.profile.microphone=await refuse(()=>microphone.captureSoftwareCheckpoint(parts.contextBytes));}
      finally {microphone.free();}
    } finally {
      candidate?.free();await lease?.release();await store?.close();
      await controller.stop();await controller.releaseWriterLock();controller.closeStorage();
      await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(database);
        request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('critic database held'));});
    }
    return checks;
  }, fixture);
  assert.equal(result.native.length,16);
  assert.deepEqual(result.native.map(item=>item.tag).sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i+1));
  for(const item of result.native){assert.notEqual(item.error,'accepted',`tag ${item.tag}`);assert.equal(item.unchanged,true);}
  for(const item of result.publication) {
    assert.equal(item.error==='accepted'?item.coherent:item.unchanged,true,item.case);
  }
  assert.equal(result.configurationPinned,true);
  assert.deepEqual(result.successfulAppend,result.expectedAppend);
  assert.equal(result.race.results.filter(item=>item==='committed').length,1);
  assert.equal(result.race.revision,String(result.expectedAppend.length+1));
  assert.equal(result.race.ids.length,result.expectedAppend.length+1);
  assert.deepEqual(result.race.ids.slice(0,result.expectedAppend.length),result.expectedAppend);
  assert.equal(result.originalStillAdmitted,true);assert.equal(result.sourceUnchanged,true);assert.equal(result.sourceRetired,0);
  assert.deepEqual(result.directLoaderRestore,{paused:true,restored:true,retired:0,exact:true});
  assert.equal(result.loaderTopology,'session checkpoint device topology differs from the actual machine');
  assert.equal(result.profile.wall,'session_checkpoint_profile');
  assert.equal(result.profile.restoreDescriptor,'invalid software session restore profile');
  assert.match(result.profile.loaderWall,/isolated ICount software profile/);
  assert.equal(result.profile.microphone,'session_checkpoint_profile');
  return result;
}
