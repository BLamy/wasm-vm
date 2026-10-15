// A GPU warm boot owns one authenticated RAM/disk/renderer set before any guest executes.
import {checkpointBytes,checkpointHash,encodeCheckpointData,decodeCheckpointData,equalCheckpointBytes} from './renderer/virgl-command/checkpoint-codec.mjs';
const MAGIC=new TextEncoder().encode('WVGPAIR1');
export const GPU_PAIR_MAX_BYTES=512*1024*1024;
const DISK_MAX=256*1024*1024+1024*1024;
const need=(condition,message)=>{if(!condition)throw Error('gpu_checkpoint: '+message);};
const same=(a,b)=>equalCheckpointBytes(encodeCheckpointData(a),encodeCheckpointData(b));
const digestBytes=hex=>Uint8Array.from(hex.match(/../g),s=>parseInt(s,16));
export const gpuCheckpointDigestBytes=hex=>{need(typeof hex==='string'&&/^[0-9a-f]{64}$/.test(hex),'invalid digest');return digestBytes(hex);};
function ownedClockState(state,identity) {
  const clock=decodeCheckpointData(encodeCheckpointData(state));
  need(clock && same(Object.keys(clock).sort(),['clockDiv','mode','mtime','timebaseHz']),'invalid saved clock fields');
  const initial=identity.guestClock??'icount',interactive=identity.interactiveClock;
  const selected=interactive==='paced-on-keyboard'?'paced-icount':interactive==='wall-on-keyboard'?'wall':initial;
  need(['icount','paced-icount','wall'].includes(initial)&&(clock.mode===initial||(initial==='icount'&&clock.mode===selected)),'invalid saved clock mode');
  need(Number.isInteger(clock.clockDiv)&&clock.clockDiv>=1&&clock.clockDiv<=1024&&clock.timebaseHz===10000000,'invalid saved clock divider or timebase');
  need(identity.icountDivider==null||clock.clockDiv===Number(identity.icountDivider),'saved clock divider differs');
  need(typeof clock.mtime==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(clock.mtime)&&BigInt(clock.mtime)<=0xffffffffffffffffn,'invalid saved clock mtime');
  return clock;
}
function nativeLimit(identity) {
  need(identity && Number.isSafeInteger(identity.ramMib)&&identity.ramMib>=16&&identity.ramMib<=1024,'unsupported guest RAM');
  return identity.ramMib*1024*1024+64*1024*1024;
}
async function compressed(bytes) {
  const stream=new ReadableStream({start(controller){for(let at=0;at<bytes.length;at+=65536)controller.enqueue(bytes.subarray(at,at+65536));controller.close();}}).pipeThrough(new CompressionStream('gzip'));
  const reader=stream.getReader(),parts=[];let total=0;
  try {for(;;){const {value,done}=await reader.read();if(done)break;need(value.length<=GPU_PAIR_MAX_BYTES-total,'compressed component exceeds budget');parts.push(value);total+=value.length;}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const out=new Uint8Array(total);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}
async function inflated(bytes,length,limit) {
  need(Number.isSafeInteger(length)&&length>=1&&length<=limit,'invalid inflated length');
  const stream=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}).pipeThrough(new DecompressionStream('gzip'));
  const reader=stream.getReader(),out=new Uint8Array(length);let at=0;
  try {for(;;){const {value,done}=await reader.read();if(done)break;need(value.length<=length-at,'inflated component exceeds declared budget');out.set(value,at);at+=value.length;}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  need(at===length,'inflated component is truncated');return out;
}
export async function deriveGpuCheckpointWitness({identity,profile,epoch,clockState,rendererSha256,diskSha256}) {
  gpuCheckpointDigestBytes(rendererSha256);gpuCheckpointDigestBytes(diskSha256);
  const clock=ownedClockState(clockState,identity);
  return checkpointHash(encodeCheckpointData({schema:'production-gpu-native-pair-witness-v1',identity,profile,epoch,clockState:clock,rendererSha256,diskSha256}));
}
export async function encodeGpuCheckpointPair(input) {
  const identity=decodeCheckpointData(encodeCheckpointData(input.identity)),profile=decodeCheckpointData(encodeCheckpointData(input.profile));
  const clockState=ownedClockState(input.clockState,identity);
  const limits={native:nativeLimit(identity),renderer:GPU_PAIR_MAX_BYTES,disk:DISK_MAX},owned={};
  const epoch=input.epoch;need(typeof epoch==='string'&&/^[0-9a-f]{16}$/.test(epoch),'invalid saved epoch');
  for(const name of Object.keys(limits)){const bytes=checkpointBytes(input[name]);need(bytes.length>0&&bytes.length<=limits[name],name+' input budget');owned[name]=new Uint8Array(bytes);}
  const parts={};
  for(const name of Object.keys(owned)){const raw=owned[name],bytes=await compressed(raw);parts[name]={encoding:'gzip',length:raw.length,sha256:await checkpointHash(raw),compressedSha256:await checkpointHash(bytes),bytes};}
  const payload=encodeCheckpointData({schema:'production-gpu-pair-v1',identity,profile,epoch,clockState,parts});
  need(payload.length<=GPU_PAIR_MAX_BYTES-48,'pair exceeds budget');
  const bytes=new Uint8Array(payload.length+48);bytes.set(MAGIC);const view=new DataView(bytes.buffer);view.setUint32(8,1,true);view.setUint32(12,payload.length,true);bytes.set(payload,16);bytes.set(digestBytes(await checkpointHash(bytes.subarray(0,-32))),bytes.length-32);return bytes;
}
export async function decodeGpuCheckpointPair(source,expectedIdentity) {
  const original=checkpointBytes(source);need(original.length>=48&&original.length<=GPU_PAIR_MAX_BYTES,'invalid pair size');
  const bytes=new Uint8Array(original),identity=decodeCheckpointData(encodeCheckpointData(expectedIdentity)),view=new DataView(bytes.buffer);
  need(equalCheckpointBytes(bytes.subarray(0,8),MAGIC)&&view.getUint32(8,true)===1&&view.getUint32(12,true)===bytes.length-48,'invalid pair framing');
  need(equalCheckpointBytes(bytes.subarray(-32),digestBytes(await checkpointHash(bytes.subarray(0,-32)))),'pair digest differs');
  const data=decodeCheckpointData(bytes.subarray(16,-32));
  need(data.schema==='production-gpu-pair-v1'&&same(data.identity,identity),'build, image or boot identity differs');
  need(typeof data.epoch==='string'&&/^[0-9a-f]{16}$/.test(data.epoch),'invalid saved epoch');
  need(data.parts && same(Object.keys(data.parts).sort(),['disk','native','renderer']),'invalid component set');
  const clockState=ownedClockState(data.clockState,identity);
  const limits={native:nativeLimit(identity),renderer:GPU_PAIR_MAX_BYTES,disk:DISK_MAX},result={identity,profile:data.profile,epoch:data.epoch,clockState};
  // Validate all framing and compressed identities before inflating any component.
  for(const [name,limit]of Object.entries(limits)){
    const part=data.parts[name];need(part.encoding==='gzip'&&Number.isSafeInteger(part.length)&&part.length>0&&part.length<=limit,'invalid '+name+' length');
    gpuCheckpointDigestBytes(part.sha256);need(await checkpointHash(part.bytes)===part.compressedSha256,name+' compressed digest differs');
  }
  for(const [name,limit]of Object.entries(limits)){
    const part=data.parts[name],raw=await inflated(part.bytes,part.length,limit);need(await checkpointHash(raw)===part.sha256,name+' content digest differs');result[name]=raw;
  }
  result.rendererSha256=data.parts.renderer.sha256;result.witness=await deriveGpuCheckpointWitness({identity,profile:data.profile,epoch:data.epoch,clockState,rendererSha256:data.parts.renderer.sha256,diskSha256:data.parts.disk.sha256});result.sha256=await checkpointHash(bytes);return result;
}
