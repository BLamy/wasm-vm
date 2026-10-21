// E9-T17: one immutable pair owns the native machine, COW disk and renderer checkpoint.
// The manifest's machine descriptor binds its exact position and disk root to that pair.
import init, {sessionCanonicalImage, sessionValidateManifest} from './session-pkg/wasm_vm_session.js';
import {SessionStore, SessionStoreError} from './session-store.js';
import {SessionDiskRoots} from './session-disk-roots.js';
import {checkpointChunks, checkpointHash, checkpointReference, readCheckpointObject,
  fetchCheckpointAsset} from './session-checkpoints.js';
import {decodeGpuCheckpointPair, gpuCheckpointDigestBytes, GPU_PAIR_MAX_BYTES} from './gpu-checkpoint.js';
import {encodeCheckpointData, decodeCheckpointData, checkpointHash as gpuCheckpointHash} from './renderer/virgl-command/checkpoint-codec.mjs';
await init();

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const magic=encoder.encode('WVGKEY01');
const need=(ok,detail)=>{if(!ok)throw new SessionStoreError('GpuCheckpoint',detail);};
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>equal(encodeCheckpointData(a),encodeCheckpointData(b));
const validHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const positionOf=count=>{
  const value=typeof count==='number'&&Number.isSafeInteger(count)?String(count):count;
  need(typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)
    &&BigInt(value)<=0xffffffffffffffffn,'exact retired count');
  return {transition:value,retired:value,phase:'before',ordinal:0,sequence:'0'};
};
const diskGeneration=disk=>{
  need(disk instanceof Uint8Array&&disk.length>=61&&decoder.decode(disk.subarray(0,5))==='WVOD1','disk delta');
  return String(new DataView(disk.buffer,disk.byteOffset,disk.byteLength).getBigUint64(49,true));
};
async function nativeWitness(pair){
  const native=pair.native,at=native.length-84;
  need(at>=0&&decoder.decode(native.subarray(at,at+8))==='WVGRESU1','native GPU seal');
  const view=new DataView(native.buffer,native.byteOffset+at,84);
  need(view.getUint32(8,true)===1&&view.getBigUint64(12,true)===BigInt(at)
    &&equal(native.subarray(at+20,at+52),gpuCheckpointDigestBytes(pair.witness)),
  'native and renderer/disk witness differ');
  need(await gpuCheckpointHash(native.subarray(0,-32))===hex(native.subarray(-32)),
    'native GPU seal digest');
}
function encodeDescriptor(value){
  const payload=encodeCheckpointData(value);
  need(payload.length<=4088,'descriptor bound');
  const bytes=new Uint8Array(magic.length+payload.length);bytes.set(magic);bytes.set(payload,magic.length);
  return bytes;
}
function decodeDescriptor(bytes){
  need(bytes.length>magic.length&&bytes.length<=4096&&equal(bytes.subarray(0,magic.length),magic),'descriptor framing');
  const value=decodeCheckpointData(bytes.subarray(magic.length));
  need(value?.schema==='gpu-session-keyframe-v1'
    &&same(Object.keys(value).sort(),['diskRoot','diskSha256','nativeSha256','pair','position','profileSha256','rendererSha256','schema'])
    &&validHash(value.diskRoot)&&validHash(value.diskSha256)&&validHash(value.nativeSha256)
    &&validHash(value.profileSha256)&&validHash(value.rendererSha256)
    &&validHash(value.pair?.sha256)&&typeof value.pair?.length==='string'
    &&/^[1-9][0-9]{0,9}$/.test(value.pair.length),'descriptor shape');
  return value;
}
async function rendererAsset(runtime){
  const url=new URL('./gpu-checkpoint-build.js',import.meta.url).href;
  const response=await fetch(url);
  need(response.ok,'renderer build asset unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());
  need(bytes.length>0&&bytes.length<1048576
    &&decoder.decode(bytes).includes(`GPU_CHECKPOINT_BUILD_ID="${runtime}"`),'renderer build identity');
  return {url,bytes,ref:checkpointReference(bytes)};
}
function configuration(input,pair,renderer){
  const config=JSON.parse(JSON.stringify(input));
  need(config?.version===1&&config.runtime===config.identity?.buildId
    &&config.identity?.ramMib===config.ramMib&&config.identity?.kernelSha256===config.kernel?.sha256
    &&validHash(config.runtime)&&validHash(config.wasm?.sha256)
    &&typeof config.imageManifest==='string'&&typeof config.baseUrl==='string'
    &&typeof config.bootargs==='string'&&Array.isArray(config.devices),'capture configuration');
  need(same(config.identity,pair.identity)&&same(config.profile,pair.profile),'pair identity/profile');
  need(config.clock?.mode===(config.identity.guestClock??'icount')
    &&config.clock.divider===pair.clockState.clockDiv
    &&config.clock.timebase_hz===String(pair.clockState.timebaseHz)
    &&config.clock.interactive===(config.identity.interactiveClock??null),'clock policy');
  need(checkpointHash(encoder.encode(config.imageManifest))===config.identity.imageManifestSha256,'image identity');
  const gpu=config.devices.filter(device=>device.kind==='virtio-gpu3d');
  need(gpu.length===1&&!config.devices.some(device=>device.kind==='virtio-gpu2d'),'qualified GPU topology');
  config.renderer={url:renderer.url,sha256:renderer.ref.sha256,length:renderer.ref.length};
  return config;
}

export class SessionGpuCheckpoints {
  #store;
  constructor(store){need(store instanceof SessionStore,'store');this.#store=store;}

  async captureController(id,checkpointId,controller){
    need(controller&&typeof controller.saveGpuCheckpoint==='function'
      &&typeof controller.gpuSessionConfiguration==='function'
      &&typeof controller.gpuSessionPosition==='function','accelerated controller');
    const wasPaused=await controller.isPaused();
    if(!wasPaused)await controller.pause();
    try{
      const config=await controller.gpuSessionConfiguration();
      const pair=await controller.saveGpuCheckpoint();
      const position=await controller.gpuSessionPosition();
      const writer=await this.#store.writer(id);
      try{return await this.save(writer,checkpointId,pair,config,position,async()=>{
        const currentPosition=await controller.gpuSessionPosition();
        const current=await controller.gpuSessionConfiguration();
        need(same(current.identity,config.identity)&&same(current.profile,config.profile),
          'captured GPU owner changed before publication');
        need(same(positionOf(currentPosition),positionOf(position)),
          'captured GPU position changed before publication');
      });}
      finally{await writer.release();}
    }finally{if(!wasPaused)await controller.resume();}
  }

  async save(writer,checkpointId,source,input,retiredInstructions,beforeCommit=null){
    need(source instanceof Uint8Array&&source.buffer instanceof ArrayBuffer
      &&source.length>=48&&source.length<=GPU_PAIR_MAX_BYTES,'pair bound');
    const bytes=new Uint8Array(source); // own the coherent tuple before the first await
    need(typeof checkpointId==='string'&&/^[A-Za-z0-9_.:/-]{1,64}$/.test(checkpointId),'checkpoint id');
    const position=positionOf(retiredInstructions);
    const renderer=await rendererAsset(input.runtime);
    const pair=await decodeGpuCheckpointPair(bytes,input.identity);
    await nativeWitness(pair);
    const config=configuration(input,pair,renderer),configBytes=encoder.encode(JSON.stringify(config));
    const vm=checkpointReference(configBytes),baseBytes=sessionCanonicalImage(config.imageManifest);
    const base=checkpointReference(baseBytes),pairRef={sha256:pair.sha256,length:String(bytes.length)};
    const profileSha256=checkpointHash(encodeCheckpointData(pair.profile));
    const previous=await this.#store.openSession(writer.id);
    const manifest=previous?JSON.parse(decoder.decode(previous.manifest)):{
      version:{major:1,minor:0},id:writer.id,
      machine:{vm_build:vm.sha256,wasm_build:config.wasm.sha256,base_image:base.sha256,
        kernel:config.kernel.sha256,initramfs:null,ram_bytes:String(config.ramMib*1048576),
        harts:1,devices:config.devices,gpu:{renderer_build:renderer.ref.sha256,profile:profileSha256}},
      policy:{mode:'checkpoints-only',profile:'rv64-linux-gpu-v1',
        event_version:{major:1,minor:0},checkpoint_version:{major:1,minor:0},boundary_version:1,
        clock:config.clock,required_inputs:[]},
      assets:[{role:'vm',content:vm},{role:'wasm',content:{sha256:config.wasm.sha256,length:config.wasm.length}},
        {role:'kernel',content:{sha256:config.kernel.sha256,length:config.kernel.length}},
        {role:'base',content:base},{role:'gpu-renderer',content:renderer.ref}],
      begin:position,end:position,events:[],checkpoints:[],extensions:[]};
    need(manifest.policy.mode==='checkpoints-only'&&manifest.policy.profile==='rv64-linux-gpu-v1'
      &&manifest.machine.vm_build===vm.sha256&&manifest.machine.wasm_build===config.wasm.sha256
      &&manifest.machine.base_image===base.sha256&&manifest.machine.kernel===config.kernel.sha256
      &&manifest.machine.ram_bytes===String(config.ramMib*1048576)
      &&manifest.machine.gpu?.renderer_build===renderer.ref.sha256
      &&manifest.machine.gpu?.profile===profileSha256
      &&same(manifest.machine.devices,config.devices)&&same(manifest.policy.clock,config.clock),
    'session identity changed');
    need(!manifest.checkpoints.some(point=>point.id===checkpointId)
      &&(!previous||BigInt(position.transition)>BigInt(manifest.end.transition)),'checkpoint order');
    const root=await new SessionDiskRoots(this.#store).capture(writer,pair.disk,config.imageManifest);
    need(root.base===base.sha256,'disk base identity');
    const descriptor=encodeDescriptor({schema:'gpu-session-keyframe-v1',position,pair:pairRef,
      diskRoot:root.content.sha256,nativeSha256:checkpointHash(pair.native),
      diskSha256:checkpointHash(pair.disk),rendererSha256:pair.rendererSha256,profileSha256});
    const machine=checkpointReference(descriptor);
    manifest.end=position;
    manifest.checkpoints.push({id:checkpointId,position,next_sequence:'1',
      machine,disk_root:root.content.sha256,gpu:pairRef});
    const canonical=sessionValidateManifest(encoder.encode(JSON.stringify(manifest)));
    for(const [ref,value]of [[vm,configBytes],[base,baseBytes],[renderer.ref,renderer.bytes],
      [machine,descriptor],[pairRef,bytes]])await writer.put(ref,checkpointChunks(value));
    if(!previous)for(const role of ['kernel','wasm']){
      const ref=manifest.assets.find(asset=>asset.role===role).content;
      const asset=await fetchCheckpointAsset(config[role].url,ref.sha256,64*1048576);
      need(String(asset.length)===ref.length,'asset length');
      await writer.put(ref,checkpointChunks(asset));
    }
    return writer.publish(canonical,beforeCommit);
  }

  async admit(id,checkpointId,runtime,wasmHash){
    const opened=await this.#store.openSession(id);need(opened,'session unavailable');
    const manifest=JSON.parse(decoder.decode(opened.manifest));
    need(manifest.policy.mode==='checkpoints-only'&&manifest.policy.profile==='rv64-linux-gpu-v1'
      &&manifest.machine.gpu!==null&&manifest.machine.initramfs===null,'accelerated profile');
    const checkpoint=manifest.checkpoints.find(point=>point.id===checkpointId);
    need(checkpoint?.gpu,'checkpoint unavailable');
    const vm=manifest.assets.find(asset=>asset.role==='vm');
    need(vm,'runtime unavailable');
    // A real Omarchy image manifest has one hash per disk chunk (about 3.5 MiB).
    const config=JSON.parse(decoder.decode(await readCheckpointObject(this.#store,vm.content,8*1048576)));
    need(config.version===1&&config.runtime===runtime&&config.identity?.buildId===runtime
      &&config.wasm?.sha256===wasmHash&&manifest.machine.wasm_build===wasmHash
      &&manifest.machine.vm_build===vm.content.sha256
      &&config.kernel?.sha256===manifest.machine.kernel
      &&config.renderer?.sha256===manifest.machine.gpu.renderer_build
      &&same(config.devices,manifest.machine.devices)
      &&same(config.clock,manifest.policy.clock),'runtime unavailable');
    const localRenderer=await rendererAsset(runtime);
    need(config.renderer?.url===localRenderer.url
      &&config.renderer.sha256===localRenderer.ref.sha256
      &&config.renderer.length===localRenderer.ref.length,
    'renderer host or build differs');
    const descriptor=decodeDescriptor(await readCheckpointObject(this.#store,checkpoint.machine,4096));
    need(same(descriptor.position,checkpoint.position)&&descriptor.diskRoot===checkpoint.disk_root
      &&same(descriptor.pair,checkpoint.gpu)&&descriptor.profileSha256===manifest.machine.gpu.profile,
    'keyframe component binding');
    const bytes=await readCheckpointObject(this.#store,checkpoint.gpu,GPU_PAIR_MAX_BYTES);
    const pair=await decodeGpuCheckpointPair(bytes,config.identity);
    await nativeWitness(pair);
    need(pair.sha256===checkpoint.gpu.sha256
      &&checkpointHash(pair.native)===descriptor.nativeSha256
      &&checkpointHash(pair.disk)===descriptor.diskSha256
      &&pair.rendererSha256===descriptor.rendererSha256
      &&checkpointHash(encodeCheckpointData(pair.profile))===descriptor.profileSha256
      &&same(pair.profile,config.profile),'pair component binding');
    const image=sessionCanonicalImage(config.imageManifest);
    need(checkpointHash(image)===manifest.machine.base_image
      &&checkpointHash(encoder.encode(config.imageManifest))===config.identity.imageManifestSha256,
    'image identity');
    const disk=await new SessionDiskRoots(this.#store).restore(checkpoint.disk_root,
      config.imageManifest,diskGeneration(pair.disk));
    need(equal(disk,pair.disk),'historical disk mismatch');
    const renderer=await readCheckpointObject(this.#store,
      manifest.assets.find(asset=>asset.role==='gpu-renderer').content,1048576);
    need(checkpointHash(renderer)===config.renderer.sha256
      &&decoder.decode(renderer).includes(`GPU_CHECKPOINT_BUILD_ID="${runtime}"`),'renderer identity');
    const kernelRef=manifest.assets.find(asset=>asset.role==='kernel').content;
    const kernel=await readCheckpointObject(this.#store,kernelRef,64*1048576);
    gpuCheckpointDigestBytes(pair.witness);
    return {configuration:config,checkpoint, pair,kernel};
  }
}
