// E9-T05: authenticate the entire machine/disk/input tuple before publishing or private restore.
import init, {SessionSha256, sessionValidateCheckpointContext, sessionCanonicalImage,
  sessionValidateManifest} from './session-pkg/wasm_vm_session.js';
import {SessionStore, SessionStoreError} from './session-store.js';
import {SessionDiskRoots} from './session-disk-roots.js';
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
export function decodeSoftwareCheckpoint(bytes) {
  need(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer
    && bytes.length>=212 && bytes.length<=CHECKPOINT_MAX_BYTES,'frame bound');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need(decoder.decode(bytes.subarray(0,8))==='WVSOFT01'&&view.getUint32(8,true)===1,'frame version');
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
  result.generation=String(disk.getBigUint64(49,true));
  result.base=hex(result.disk.subarray(17,49));
  return result;
}
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
