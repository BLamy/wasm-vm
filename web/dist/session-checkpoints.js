// E9-T05: authenticate the entire machine/disk/input tuple before publishing or private restore.
import init, {SessionSha256, sessionValidateCheckpointContext, sessionCanonicalImage,
  sessionValidateManifest} from './session-pkg/wasm_vm_session.js';
import {SessionStore, SessionStoreError} from './session-store.js';
import {SessionDiskRoots} from './session-disk-roots.js';
import {encodeKeyframeDescriptor, decodeKeyframeDescriptor, isKeyframeDescriptorPrefix,
  inspectRamDeltaChunk, KEYFRAME_MAX_DEPTH, KEYFRAME_MAX_DESCRIPTOR_BYTES} from './session-keyframes.js';
await init();
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const need = (condition, detail) => {if (!condition) throw new SessionStoreError('Checkpoint', detail);};
export const CHECKPOINT_MAX_BYTES = 640 * 1024 * 1024;
const limits = [16384, 300*1024*1024, 61+65536*4104, 1048576, 1048576];
const names = ['contextBytes','native','disk','input','output'];
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
export function checkpointHash(bytes) {
  const hash = new SessionSha256();
  try {hash.update(bytes); return hash.finish();} finally {hash.free();}
}
export const checkpointReference = bytes => ({sha256:checkpointHash(bytes),length:String(bytes.length)});
export const checkpointZeroPosition = () => ({transition:'0',phase:'before',ordinal:0,sequence:'0',retired:'0'});
export function *checkpointChunks(bytes) {
  for(let at=0;at<bytes.length;at+=4*1024*1024)yield bytes.subarray(at,at+4*1024*1024);
}
function decodeCheckpoint(bytes, magic, fullRam, sessionClock) {
  need(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer
    && bytes.length>=212 && bytes.length<=CHECKPOINT_MAX_BYTES,'frame bound');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need(decoder.decode(bytes.subarray(0,8))===magic&&view.getUint32(8,true)===1,'frame version');
  const result={};let offset=212;
  for(const [index,name] of names.entries()) {
    const at=12+index*40,length=view.getBigUint64(at,true);
    need(length<=BigInt(limits[index])&&BigInt(offset)+length<=BigInt(bytes.length),'component bound');
    const part=bytes.subarray(offset,offset+Number(length));offset+=part.length;
    need(checkpointHash(part)===hex(bytes.subarray(at+8,at+40)),'component digest: '+name);
    result[name]=part;
  }
  need(offset===bytes.length,'trailing bytes');
  const canonical=sessionValidateCheckpointContext(result.contextBytes);
  need(canonical.length===result.contextBytes.length&&canonical.every((b,i)=>b===result.contextBytes[i]),'context encoding');
  result.context=JSON.parse(decoder.decode(canonical));
  need(result.native.length>=84&&result.disk.length>=61,'machine/disk headers');
  const native=new DataView(result.native.buffer,result.native.byteOffset,result.native.byteLength);
  const disk=new DataView(result.disk.buffer,result.disk.byteOffset,result.disk.byteLength);
  need(hex(result.native.subarray(44,76))===hex(result.disk.subarray(17,49))
    &&native.getBigUint64(76,true)===disk.getBigUint64(49,true),'machine/disk binding');
  need(decoder.decode(result.native.subarray(0,8))==='WVMRESU1'&&native.getUint32(8,true)===1,'native version');
  let nativeAt=84,ramSections=0,sessionClocks=0;
  while(nativeAt<result.native.length){
    need(nativeAt+8<=result.native.length,'native section header');
    const tag=native.getUint32(nativeAt,true),length=native.getUint32(nativeAt+4,true);
    nativeAt+=8;need(nativeAt+length<=result.native.length,'native section bound');
    if(tag===2)ramSections++;
    if(tag===18){
      sessionClocks++;
      need(length>=44&&result.context.position.phase==='before'
        &&native.getBigUint64(nativeAt+12,true)===BigInt(result.context.position.transition)
        &&native.getBigUint64(nativeAt+20,true)===BigInt(result.context.position.retired)
        &&native.getBigUint64(nativeAt+28,true)===BigInt(result.context.position.ordinal)
        &&native.getBigUint64(nativeAt+36,true)===BigInt(result.context.position.sequence),
      'native event position');
    }
    nativeAt+=length;
  }
  need(ramSections===(fullRam?1:0)&&sessionClocks===(sessionClock?1:0),'native RAM/clock shape');
  result.generation=String(disk.getBigUint64(49,true));
  result.base=hex(result.disk.subarray(17,49));
  return result;
}
export const decodeSoftwareCheckpoint = bytes => decodeCheckpoint(bytes,'WVSOFT01',true,false);
export const decodeSoftwareKeyframeBase = bytes => decodeCheckpoint(bytes,'WVKEYB01',true,true);
export const decodeSoftwareDeltaCheckpoint = bytes => decodeCheckpoint(bytes,'WVDELT01',false,true);
export async function readCheckpointObject(store, ref, limit=CHECKPOINT_MAX_BYTES) {
  need(typeof ref?.length==='string'&&/^[1-9][0-9]{0,9}$/.test(ref.length)
    &&BigInt(ref.length)<=BigInt(limit),'object bound');
  const bytes=new Uint8Array(Number(ref.length));let offset=0;
  for await(const part of store.stream(ref)){bytes.set(part,offset);offset+=part.length;}
  need(offset===bytes.length,'object length');return bytes;
}
async function fetchObject(url, expected, limit) {
  need(typeof url==='string','asset URL');
  const response=await fetch(url);need(response.ok,'asset unavailable');
  const declared=response.headers.get('content-length');
  need(declared===null||Number(declared)<=limit,'asset bound');
  const reader=response.body.getReader(),parts=[];let total=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;
    need(total<=limit,'asset bound');parts.push(value);}}
  finally {await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(total);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  need(checkpointHash(bytes)===expected,'asset digest');return bytes;
}

export class SessionCheckpoints {
  #store;
  constructor(store){need(store instanceof SessionStore,'store');this.#store=store;}

  async save(writer, checkpointId, frame, configuration) {
    // Own the tuple before any await: its disk leaves and machine object must describe the
    // same instant even if the producer mutates, detaches, or reuses its original buffer.
    need(frame instanceof Uint8Array && frame.buffer instanceof ArrayBuffer
      && frame.length>=212 && frame.length<=CHECKPOINT_MAX_BYTES,'frame bound');
    frame=new Uint8Array(frame);
    const machineRef=checkpointReference(frame), parts=decodeSoftwareCheckpoint(frame);
    const configBytes=encoder.encode(JSON.stringify(configuration)),vmRef=checkpointReference(configBytes);
    const config=JSON.parse(decoder.decode(configBytes));
    need(config.version===1&&config.runtime===parts.context.runtime&&config.kernel.sha256===parts.context.kernel
      &&String(config.ramMib*1048576)===parts.context.ram_bytes
      &&JSON.stringify(config.clock)===JSON.stringify(parts.context.clock),'configuration mismatch');
    const image=sessionCanonicalImage(config.imageManifest),baseRef=checkpointReference(image);
    need(baseRef.sha256===parts.base,'base manifest mismatch');
    const previous=await this.#store.openSession(writer.id);
    const manifest=previous?JSON.parse(decoder.decode(previous.manifest)):{
      version:{major:1,minor:0},id:writer.id,
      machine:{vm_build:vmRef.sha256,wasm_build:config.wasm.sha256,base_image:baseRef.sha256,
        kernel:config.kernel.sha256,initramfs:null,ram_bytes:parts.context.ram_bytes,harts:1,devices:config.devices,gpu:null},
      policy:{mode:'checkpoints-only',profile:'rv64-linux-software-v1',event_version:{major:1,minor:0},
        checkpoint_version:{major:1,minor:0},boundary_version:1,clock:config.clock,required_inputs:[]},
      assets:[{role:'vm',content:vmRef},{role:'wasm',content:{sha256:config.wasm.sha256,length:config.wasm.length}},
        {role:'kernel',content:{sha256:config.kernel.sha256,length:config.kernel.length}},{role:'base',content:baseRef}],
      begin:parts.context.position,end:parts.context.position,events:[],checkpoints:[],extensions:[]};
    need(manifest.machine.vm_build===vmRef.sha256,'session configuration changed');
    const disk=new SessionDiskRoots(this.#store);
    const root=await disk.capture(writer,parts.disk,config.imageManifest);
    manifest.end=parts.context.position;
    manifest.checkpoints.push({id:checkpointId,position:parts.context.position,
      next_sequence:String(BigInt(parts.context.position.sequence)+1n),machine:machineRef,disk_root:root.content.sha256,gpu:null});
    // Refuse malformed metadata before fetching or publishing. No commit cursor changes until all
    // components, disk descendants and retained assets have reached their immutable object rows.
    const canonical=sessionValidateManifest(encoder.encode(JSON.stringify(manifest)));
    for(const [ref,bytes] of [[vmRef,configBytes],[baseRef,image]])await writer.put(ref,checkpointChunks(bytes));
    for(const role of ['kernel','wasm']) {
      const ref=manifest.assets.find(asset=>asset.role===role).content;
      const bytes=await fetchObject(config[role].url,ref.sha256,64*1024*1024);
      need(String(bytes.length)===ref.length,'asset length');await writer.put(ref,checkpointChunks(bytes));
    }
    await writer.put(machineRef,checkpointChunks(frame));
    return writer.publish(canonical);
  }

  async saveDelta(writer, checkpointId, frame, configuration, chunks, ramSha256, dirtyPages) {
    need(frame instanceof Uint8Array && frame.buffer instanceof ArrayBuffer
      && frame.length>=212 && frame.length<=CHECKPOINT_MAX_BYTES,'delta frame bound');
    frame=new Uint8Array(frame);
    const parts=decodeSoftwareDeltaCheckpoint(frame),frameRef=checkpointReference(frame);
    const config=JSON.parse(JSON.stringify(configuration));
    const configHash=checkpointHash(encoder.encode(JSON.stringify(config)));
    need(config.version===1&&(config.exactSession===1?configHash:config.runtime)===parts.context.runtime
      &&config.kernel.sha256===parts.context.kernel
      &&String(config.ramMib*1048576)===parts.context.ram_bytes
      &&JSON.stringify(config.clock)===JSON.stringify(parts.context.clock),'configuration mismatch');
    need(typeof ramSha256==='string'&&/^[0-9a-f]{64}$/.test(ramSha256)
      &&Number.isSafeInteger(dirtyPages)&&dirtyPages>=0,'RAM digest/count');
    const opened=await this.#store.openSession(writer.id);
    need(opened,'full base checkpoint required');
    const manifest=JSON.parse(decoder.decode(opened.manifest));
    need(['checkpoints-only','exact-replay'].includes(manifest.policy.mode),'software session mode');
    const parent=manifest.checkpoints.at(-1)?.machine;
    need(parent,'full base checkpoint required');
    let prefix;
    for await(const block of this.#store.stream(parent)){prefix=block.subarray(0,8);break;}
    let depth=0;
    if(isKeyframeDescriptorPrefix(prefix)){
      const previous=decodeKeyframeDescriptor(await readCheckpointObject(this.#store,parent,KEYFRAME_MAX_DESCRIPTOR_BYTES));
      depth=previous.depth;
    } else need(['WVKEYB01','WVEXACT1'].includes(decoder.decode(prefix)),'full base checkpoint required');
    need(depth<KEYFRAME_MAX_DEPTH,'full base checkpoint required');
    need(manifest.machine.vm_build===configHash
      &&manifest.machine.wasm_build===config.wasm.sha256
      &&manifest.machine.ram_bytes===parts.context.ram_bytes,'session configuration changed');
    const image=sessionCanonicalImage(config.imageManifest);
    need(checkpointHash(image)===parts.base&&parts.base===manifest.machine.base_image,'base mismatch');
    const root=await new SessionDiskRoots(this.#store).capture(writer,parts.disk,config.imageManifest);
    await writer.put(frameRef,checkpointChunks(frame));
    const chunkRefs=[];let priorPage=-1,actualPages=0,payloadBytes=frame.length,maxChunkBytes=0;
    for await(const original of chunks){
      need(original instanceof Uint8Array && original.buffer instanceof ArrayBuffer,'RAM chunk type');
      const chunk=new Uint8Array(original);
      const shape=inspectRamDeltaChunk(chunk,parts.context.ram_bytes,priorPage);
      priorPage=shape.last;actualPages+=shape.count;
      need(chunkRefs.length<512&&actualPages<=dirtyPages,'RAM chunk count');
      const ref=checkpointReference(chunk);
      await writer.put(ref,checkpointChunks(chunk));
      chunkRefs.push(ref);payloadBytes+=chunk.length;maxChunkBytes=Math.max(maxChunkBytes,chunk.length);
    }
    need(actualPages===dirtyPages,'RAM dirty-page mismatch');
    const descriptor=encodeKeyframeDescriptor({version:1,depth:depth+1,parent,frame:frameRef,
      chunks:chunkRefs,ramBytes:parts.context.ram_bytes,ramSha256,dirtyPages});
    const machine=checkpointReference(descriptor);
    await writer.put(machine,checkpointChunks(descriptor));
    manifest.end=parts.context.position;
    manifest.checkpoints.push({id:checkpointId,position:parts.context.position,
      next_sequence:String(BigInt(parts.context.position.sequence)+1n),machine,
      disk_root:root.content.sha256,gpu:null});
    const canonical=sessionValidateManifest(encoder.encode(JSON.stringify(manifest)));
    const publication=await writer.publish(canonical);
    return {publication,stats:{depth:depth+1,dirtyPages,frameBytes:frame.length,
      deltaBytes:payloadBytes+descriptor.length,maxChunkBytes,chunkCount:chunkRefs.length}};
  }

  // A fresh full base terminates the preceding chain. Exact sessions retain the T14 initial
  // WVEXACT1 object and its immutable base root; subsequent device/COW state lives in `native`.
  async saveKeyframeBase(writer, checkpointId, frame, configuration) {
    need(frame instanceof Uint8Array && frame.buffer instanceof ArrayBuffer
      && frame.length>=212 && frame.length<=CHECKPOINT_MAX_BYTES,'base frame bound');
    frame=new Uint8Array(frame);
    const parts=decodeSoftwareKeyframeBase(frame),config=JSON.parse(JSON.stringify(configuration));
    const opened=await this.#store.openSession(writer.id);
    need(opened,'initial exact checkpoint required');
    const manifest=JSON.parse(decoder.decode(opened.manifest));
    const configHash=checkpointHash(encoder.encode(JSON.stringify(config)));
    need(manifest.policy.mode==='exact-replay'&&config.exactSession===1
      &&manifest.machine.vm_build===configHash&&parts.context.runtime===configHash
      &&manifest.machine.kernel===config.kernel.sha256&&parts.context.kernel===config.kernel.sha256
      &&manifest.machine.ram_bytes===parts.context.ram_bytes
      &&parts.context.ram_bytes===String(config.ramMib*1048576)
      &&JSON.stringify(parts.context.clock)===JSON.stringify(manifest.policy.clock)
      &&parts.base===manifest.machine.base_image,'exact keyframe identity');
    const image=sessionCanonicalImage(config.imageManifest);
    need(checkpointHash(image)===parts.base,'base image');
    const root=await new SessionDiskRoots(this.#store).capture(writer,parts.disk,config.imageManifest);
    const machine=checkpointReference(frame);
    await writer.put(machine,checkpointChunks(frame));
    manifest.end=parts.context.position;
    manifest.checkpoints.push({id:checkpointId,position:parts.context.position,
      next_sequence:String(BigInt(parts.context.position.sequence)+1n),machine,
      disk_root:root.content.sha256,gpu:null});
    const canonical=sessionValidateManifest(encoder.encode(JSON.stringify(manifest)));
    const publication=await writer.publish(canonical);
    return {publication,stats:{depth:0,fullBytes:frame.length}};
  }

  async resolveDelta(id, checkpointId) {
    const opened=await this.#store.openSession(id);need(opened,'session unavailable');
    const manifest=JSON.parse(decoder.decode(opened.manifest));
    const target=manifest.checkpoints.findIndex(item=>item.id===checkpointId);
    need(target>=0,'checkpoint unavailable');
    const chain=[];let index=target,expectedDepth=null;
    while(index>=0){
      const machine=manifest.checkpoints[index].machine;
      let prefix;
      for await(const block of this.#store.stream(machine)){prefix=block.subarray(0,8);break;}
      if(!isKeyframeDescriptorPrefix(prefix)){
        need(['WVKEYB01','WVEXACT1'].includes(decoder.decode(prefix)),'full base missing');
        need(expectedDepth===null||expectedDepth===0,'keyframe depth');
        return {manifest,base:machine,baseCheckpoint:manifest.checkpoints[index],deltas:chain.reverse()};
      }
      need(index>0&&chain.length<KEYFRAME_MAX_DEPTH,'keyframe chain bound');
      const descriptor=decodeKeyframeDescriptor(await readCheckpointObject(this.#store,machine,KEYFRAME_MAX_DESCRIPTOR_BYTES));
      const parent=manifest.checkpoints[index-1].machine;
      need(descriptor.parent.sha256===parent.sha256&&descriptor.parent.length===parent.length
        &&(expectedDepth===null||descriptor.depth===expectedDepth),'keyframe parent/depth');
      expectedDepth=descriptor.depth-1;
      chain.push({checkpoint:manifest.checkpoints[index],descriptor});index--;
    }
    throw new SessionStoreError('Checkpoint','full base missing');
  }

  // `candidate` is a fresh, private exact-session VM. openSession authenticates the entire
  // ancestor graph before this method mutates even its RAM; a failure discards the candidate.
  async restoreExactDeltaToCandidate(id,checkpointId,candidate) {
    const heap=()=>performance.memory?.usedJSHeapSize??null;
    const start=performance.now(),heapBefore=heap();
    const chain=await this.resolveDelta(id,checkpointId);
    need(chain.manifest.policy.mode==='exact-replay'&&chain.deltas.length>0,'exact delta checkpoint');
    candidate.prepareSoftwareKeyframeCandidate();
    const base=await readCheckpointObject(this.#store,chain.base);
    const baseMagic=decoder.decode(base.subarray(0,8));
    if(baseMagic==='WVEXACT1')candidate.seedSoftwareRamFromExactStart(base);
    else{need(baseMagic==='WVKEYB01','full keyframe ancestor');candidate.seedSoftwareRamFromCheckpoint(base);}
    let appliedPages=0,maxChunkBytes=0,totalDeltaBytes=0;
    for(const {checkpoint,descriptor} of chain.deltas){
      for(const ref of descriptor.chunks){
        const chunk=await readCheckpointObject(this.#store,ref,4*1048576);
        appliedPages+=candidate.applySoftwareRamDeltaChunk(chunk);
        maxChunkBytes=Math.max(maxChunkBytes,chunk.length);totalDeltaBytes+=chunk.length;
      }
      need(candidate.softwareRamDigest()===descriptor.ramSha256,'reconstructed RAM digest');
      const frame=await readCheckpointObject(this.#store,descriptor.frame);
      const parts=decodeSoftwareDeltaCheckpoint(frame);
      need(JSON.stringify(parts.context.position)===JSON.stringify(checkpoint.position)
        &&parts.context.ram_bytes===chain.manifest.machine.ram_bytes,'delta position/identity');
      const digest=Uint8Array.from(descriptor.ramSha256.match(/../g),byte=>parseInt(byte,16));
      candidate.restoreSoftwareDeltaKeyframe(frame,parts.contextBytes,digest);
    }
    return {depth:chain.deltas.length,appliedPages,maxChunkBytes,totalDeltaBytes,
      fullBytes:base.length,restoreMs:performance.now()-start,
      heapBytes:{before:heapBefore,after:heap()},
      maxStagedBytes:2*base.length+3*maxChunkBytes+4*1048576};
  }

  async admit(id, checkpointId, runtime, wasmHash) {
    const opened=await this.#store.openSession(id);need(opened,'session unavailable');
    const manifest=JSON.parse(decoder.decode(opened.manifest));
    need(manifest.policy.mode==='checkpoints-only'&&manifest.policy.profile==='rv64-linux-software-v1'
      &&manifest.machine.gpu===null&&manifest.machine.initramfs===null,'software checkpoint profile');
    const checkpoint=manifest.checkpoints.find(item=>item.id===checkpointId);need(checkpoint,'checkpoint unavailable');
    const vm=manifest.assets.find(asset=>asset.role==='vm');need(vm,'runtime unavailable');
    const config=JSON.parse(decoder.decode(await readCheckpointObject(this.#store,vm.content,1048576)));
    need(config.version===1&&config.runtime===runtime&&config.wasm.sha256===wasmHash
      &&manifest.machine.wasm_build===wasmHash,'runtime unavailable');
    const frame=await readCheckpointObject(this.#store,checkpoint.machine),parts=decodeSoftwareCheckpoint(frame);
    need(parts.context.runtime===runtime&&parts.context.kernel===manifest.machine.kernel
      &&config.kernel.sha256===manifest.machine.kernel&&String(config.ramMib*1048576)===manifest.machine.ram_bytes
      &&parts.context.ram_bytes===manifest.machine.ram_bytes
      &&JSON.stringify(config.devices)===JSON.stringify(manifest.machine.devices)
      &&JSON.stringify(config.clock)===JSON.stringify(manifest.policy.clock)
      &&JSON.stringify(parts.context.clock)===JSON.stringify(manifest.policy.clock)
      &&JSON.stringify(parts.context.position)===JSON.stringify(checkpoint.position),'checkpoint identity mismatch');
    const image=sessionCanonicalImage(config.imageManifest);need(checkpointHash(image)===manifest.machine.base_image,'base mismatch');
    const disk=await new SessionDiskRoots(this.#store).restore(checkpoint.disk_root,config.imageManifest,parts.generation);
    need(disk.length===parts.disk.length&&disk.every((b,i)=>b===parts.disk[i]),'historical disk mismatch');
    const kernelRef=manifest.assets.find(asset=>asset.role==='kernel').content;
    const kernel=await readCheckpointObject(this.#store,kernelRef,64*1024*1024);
    return {configuration:config,frame,contextBytes:parts.contextBytes,context:parts.context,disk,kernel};
  }
}

export {fetchObject as fetchCheckpointAsset};
