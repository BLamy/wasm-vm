// Allocation-free GPU frame admission. Large native/RAM bytes are streamed; only
// the existing bounded SESSION_CLOCK section is copied for the authoritative codec.
import {SessionSha256} from './session-pkg/wasm_vm_session.js';
import {sessionInspectClockOrigin} from './pkg/wasm_vm_wasm.js';
import {checkpointHash,readCheckpointObject} from './session-checkpoints.js';
import {decodeCheckpointData,encodeCheckpointData} from './renderer/virgl-command/checkpoint-codec.mjs';
import {gpuHex,gpuSamePosition,GPU_FRAME_LIMIT} from './session-gpu-replay-format.js';
const decoder=new TextDecoder('utf-8',{fatal:true});
const CLOCK_LIMIT=4*1048576+256*32+64,hash=/^[0-9a-f]{64}$/;
const need=(ok,message)=>{if(!ok)throw Error('GPU frame inspection: '+message);};
const metadataKeys='version,runtime,position,rendererSha256,rendererEpoch,ramSha256,stateSha256,full';

class FrameStream {
  constructor(source,ref,active,metrics){this.iterator=source.stream(ref)[Symbol.asyncIterator]();this.ref=ref;this.active=active;this.metrics=metrics;this.at=0;this.part=null;this.offset=0;this.hash=new SessionSha256();this.nativeStart=Infinity;this.nativeEnd=Infinity;}
  async consume(length,output=null){
    need(Number.isSafeInteger(length)&&length>=0&&this.at+length<=Number(this.ref.length),'stream range');
    let copied=0;
    while(length){
      this.active();
      if(!this.part||this.offset===this.part.length){const next=await this.iterator.next();this.active();need(!next.done&&next.value instanceof Uint8Array&&next.value.length>0&&next.value.length<=1048576,'stream chunk');this.part=next.value;this.offset=0;this.metrics.storeChunkBytes=Math.max(this.metrics.storeChunkBytes,this.part.length);}
      const size=Math.min(length,this.part.length-this.offset),piece=this.part.subarray(this.offset,this.offset+size);
      const lo=Math.max(this.at,this.nativeStart),hi=Math.min(this.at+size,this.nativeEnd);
      if(hi>lo)this.hash.update(piece.subarray(lo-this.at,hi-this.at));
      if(output)output.set(piece,copied);this.at+=size;this.offset+=size;copied+=size;length-=size;
    }
  }
  async take(length){const bytes=new Uint8Array(length);await this.consume(length,bytes);return bytes;}
  async finish(){need(this.at===Number(this.ref.length)&&(!this.part||this.offset===this.part.length),'object trailing bytes');const end=await this.iterator.next();this.active();need(end.done,'object trailing stream');}
  async close(){this.part=null;this.hash.free();await this.iterator.return?.();}
}

export async function inspectGpuFrame(source,ref,{point,manifest,root,coreHash,full,active,metrics}){
  active();need(Number(ref.length)>=200&&Number(ref.length)<=GPU_FRAME_LIMIT,'frame bound');
  const stream=new FrameStream(source,ref,active,metrics);
  try{
    const header=await stream.take(32),view=new DataView(header.buffer),magic=decoder.decode(header.subarray(0,8));
    const h=view.getUint32(12,true),n=view.getBigUint64(16,true),pending=view.getUint32(24,true),output=view.getUint32(28,true);
    need(magic===(full?'WVGPUB01':'WVGPUD01')&&view.getUint32(8,true)===1&&h>0&&h<=16384&&n>=168n&&n<=512n*1048576n&&pending<=1048576&&output<=1048576
      &&32n+BigInt(h)+n+BigInt(pending+output)===BigInt(ref.length),'frame version/lengths');
    const encoded=await stream.take(h),meta=JSON.parse(decoder.decode(encoded));
    need(Object.keys(meta).join(',')===metadataKeys&&meta.version===1&&meta.full===full&&JSON.stringify(meta)===decoder.decode(encoded)
      &&meta.runtime===manifest.machine.vm_build&&meta.rendererSha256===point.gpu.sha256&&hash.test(meta.ramSha256)&&hash.test(meta.stateSha256)
      &&typeof meta.rendererEpoch==='string'&&/^[0-9a-f]{16}$/.test(meta.rendererEpoch)&&meta.rendererEpoch!=='0000000000000000'
      &&gpuSamePosition(meta.position,point.position),'frame metadata/identity');
    stream.nativeStart=stream.at;stream.nativeEnd=stream.at+Number(n)-32;
    const native=await stream.take(84),nv=new DataView(native.buffer),sealAt=stream.nativeStart+Number(n)-84;
    need(decoder.decode(native.subarray(0,8))==='WVMRESU1'&&nv.getUint32(8,true)===1&&gpuHex(native.subarray(12,44))===coreHash
      &&gpuHex(native.subarray(44,76))===manifest.machine.base_image&&String(nv.getBigUint64(76,true))===root.generation,'native build/base/generation');
    const tags=new Set();let origin;
    while(stream.at<sealAt){
      need(stream.at+8<=sealAt,'section header');const bytes=await stream.take(8),v=new DataView(bytes.buffer),tag=v.getUint32(0,true),length=v.getUint32(4,true);
      need(tag>=1&&tag<=22&&tag!==17&&!tags.has(tag)&&length<=sealAt-stream.at,'section tag/length');tags.add(tag);
      if(tag===18){need(length<=CLOCK_LIMIT,'native origin section bound');const clock=await stream.take(length);metrics.clockSectionBytes=Math.max(metrics.clockSectionBytes,clock.length);origin=JSON.parse(sessionInspectClockOrigin(clock));need(gpuSamePosition(origin.position,point.position),'native clock position');}
      else await stream.consume(length);
    }
    need(stream.at===sealAt&&tags.has(2)===full&&[1,3,4,5,8,9,18,19,20,21,22].every(tag=>tags.has(tag)),'required native sections');
    const seal=await stream.take(84),sv=new DataView(seal.buffer);
    need(decoder.decode(seal.subarray(0,8))==='WVGRESU1'&&sv.getUint32(8,true)===1&&sv.getBigUint64(12,true)===n-84n
      &&gpuHex(seal.subarray(20,52))===meta.rendererSha256&&stream.hash.finish()===gpuHex(seal.subarray(52)),'native renderer seal/digest');
    await stream.consume(pending+output);await stream.finish();active();
    return {meta,origin,core:coreHash,generation:root.generation};
  }finally{await stream.close();}
}

const portableBufferBytes=value=>value instanceof Uint8Array?value.byteLength:value&&typeof value==='object'?Object.values(value).reduce((total,child)=>total+portableBufferBytes(child),0):0;

// One renderer artifact at a time, with the existing 256-MiB artifact limit.
// This inspects portable bytes only: no GL/renderer/Machine owner is constructed.
export async function inspectGpuRenderer(source,ref,profile,expectedProfileHash,{active,metrics}){
  active();const bytes=await readCheckpointObject(source,ref,256*1048576);active();metrics.rendererArtifactBytes=Math.max(metrics.rendererArtifactBytes,bytes.length);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need(bytes.length>=48&&decoder.decode(bytes.subarray(0,8))==='WVGJRN01'&&v.getUint32(8,true)===1&&v.getUint32(12,true)===bytes.length-48
    &&checkpointHash(bytes.subarray(0,-32))===gpuHex(bytes.subarray(-32)),'renderer envelope/digest');
  const payload=decodeCheckpointData(bytes.subarray(16,-32));
  need(payload.schema==='production-gpu-journal-v1'&&checkpointHash(encodeCheckpointData(payload.profile))===expectedProfileHash
    &&checkpointHash(encodeCheckpointData(profile))===expectedProfileHash&&typeof payload.logical?.epoch==='string'
    &&/^[0-9a-f]{16}$/.test(payload.logical.epoch)&&payload.logical.epoch!=='0000000000000000'
    &&Array.isArray(payload.frames)&&payload.frames.length<=100000,'renderer profile/version/epoch');
  const decoded=portableBufferBytes(payload);metrics.rendererDecodedBufferBytes=Math.max(metrics.rendererDecodedBufferBytes??0,decoded);
  let scratch=0,owned=0;for(const frame of payload.frames){need(frame instanceof Uint8Array,'renderer frame bytes');owned+=frame.length;need(owned<=256*1048576,'renderer journal bound');scratch=Math.max(scratch,portableBufferBytes(decodeCheckpointData(frame)));}
  metrics.rendererFrameScratchBytes=Math.max(metrics.rendererFrameScratchBytes??0,scratch);
  metrics.rendererBufferUpperBoundBytes=Math.max(metrics.rendererBufferUpperBoundBytes??0,2*bytes.length+decoded+scratch);
  metrics.rendererDecodedFrameBytes=Math.max(metrics.rendererDecodedFrameBytes,owned);active();return {epoch:payload.logical.epoch,profile:expectedProfileHash};
}
