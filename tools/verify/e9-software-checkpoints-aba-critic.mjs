// Independent disk-buffer ABA attack against the coherent publication boundary.
import assert from 'node:assert/strict';

export function assertSoftwareCheckpointAba(results) {
  assert.equal(results.length,2);
  for(const item of results) {
    assert.equal(item.changed,true);
    if(item.publication.accepted) {
      assert.equal(item.finalFrameHash,item.frameHash);
      assert.equal(item.frameDiskHash,item.rootDiskHash,'successful publication must retain one coherent frame/root tuple');
      assert.equal(item.admission,'accepted');
    } else {
      assert.equal(item.previousManifestHash,item.newManifestHash,'failed capture must preserve the committed manifest');
      assert.equal(item.previousRevision,item.newRevision);
    }
  }
}

export async function observeSoftwareCheckpointAba(page, fixture) {
  return page.evaluate(async fixture => {
    const {startLinuxBoot} = await import('./loader.js');
    const {default:init,WasmLinux} = await import('./pkg/wasm_vm_wasm.js');
    const {SessionStore} = await import('./session-store.js');
    const {SessionDiskRoots} = await import('./session-disk-roots.js');
    const {SessionCheckpoints,decodeSoftwareCheckpoint,checkpointHash} = await import('./session-checkpoints.js');
    const {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256} = await import('./gpu-checkpoint-build.js');
    await init();
    const controller = await startLinuxBoot({manifestUrl:fixture.boot_manifest,mode:'chunked',imageManifestUrl:fixture.image_manifest,
      baseUrl:fixture.base_url,bootProfileUrl:null,bootSnapshot:false,ramMib:fixture.ram_mib,
      bootargs:fixture.bootargs,startPaused:true,guestClock:'icount',icountDivider:10});
    const database='wasm-vm-sessions-v1-aba-critic-'+crypto.randomUUID();
    let store;const results=[];
    try {
      const source=await controller.captureSoftwareCheckpoint(),configuration=controller.softwareCheckpointConfiguration();
      const parts=decodeSoftwareCheckpoint(source);
      const boot=await (await fetch(fixture.boot_manifest)).json();
      const kernel=new Uint8Array(await (await fetch(boot.artifacts.kernel.url)).arrayBuffer());
      store=await SessionStore.open(database);
      for(let schedule=0;schedule<2;schedule++) {
        // A real native constructor/capture produces the one-block frame under attack.
        const delta=new Uint8Array(61+4104);delta.set(parts.disk);
        const diskView=new DataView(delta.buffer);diskView.setUint32(57,1,true);
        diskView.setBigUint64(61,131071n,true);delta.fill(0x43+schedule,69);
        const machine=WasmLinux.newChunkedDiskSeeded(fixture.ram_mib,kernel,configuration.imageManifest,
          fixture.base_url,64,new Uint32Array(),fixture.bootargs,()=>{},false,delta);
        const lease=await store.writer('aba-'+schedule);
        const checkpoints=new SessionCheckpoints(store);
        const originalOpen=store.openSession.bind(store);
        try {
          const frame=await machine.captureSoftwareCheckpoint(parts.contextBytes),captured=decodeSoftwareCheckpoint(frame);
          const frameHash=checkpointHash(frame),offset=captured.disk.byteOffset-frame.byteOffset+69;
          await checkpoints.save(lease,'before',frame,configuration);
          const before=await originalOpen(lease.id),beforeManifest=JSON.parse(new TextDecoder().decode(before.manifest));
          let changed=false,restored=false;
          store.openSession=async(...args)=>{
            const opened=await originalOpen(...args);
            if(!changed){frame[offset]^=0x20+schedule;changed=true;}
            return opened;
          };
          const producer={id:lease.id,
            put(ref,chunks){
              if(ref.sha256===frameHash&&!restored){frame[offset]^=0x20+schedule;restored=true;}
              return lease.put(ref,chunks);
            },publish:(...args)=>lease.publish(...args)};
          let publication;
          try{publication={accepted:true,value:await checkpoints.save(producer,'aba',frame,configuration)};}
          catch(error){publication={accepted:false,error:error.message};}
          store.openSession=originalOpen;
          const after=await originalOpen(lease.id),afterManifest=JSON.parse(new TextDecoder().decode(after.manifest));
          let admission;
          try{await checkpoints.admit(lease.id,'aba',GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256);admission='accepted';}
          catch(error){admission=error.message;}
          const root=afterManifest.checkpoints.find(item=>item.id==='aba');
          const rootDisk=root?await new SessionDiskRoots(store).restore(root.disk_root,configuration.imageManifest,captured.generation):null;
          results.push({schedule,changed,restored,frameHash,finalFrameHash:checkpointHash(frame),publication,admission,
            previousRevision:before.revision,newRevision:after.revision,
            previousManifestHash:checkpointHash(before.manifest),newManifestHash:checkpointHash(after.manifest),
            previousRoot:beforeManifest.checkpoints[0].disk_root,publishedRoot:root?.disk_root,
            frameDiskHash:checkpointHash(captured.disk),rootDiskHash:rootDisk?checkpointHash(rootDisk):null,
            frameLeafByte:captured.disk[69],rootLeafByte:rootDisk?.[69]});
        } finally {store.openSession=originalOpen;await lease.release();machine.free();}
      }
    } finally {
      await store?.close();await controller.stop();await controller.releaseWriterLock();controller.closeStorage();
      await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(database);request.onsuccess=resolve;
        request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('ABA database held'));});
    }
    return results;
  },fixture);
}
