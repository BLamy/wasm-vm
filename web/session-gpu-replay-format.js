// Exact GPU sessions have an explicit pure-ICount runtime; old paced pairs keep their policy.
import {sessionGpuResultInfo} from './pkg/wasm_vm_wasm.js';
import {checkpointHash,checkpointReference} from './session-checkpoints.js';
import {ownInputReceipt,inputEventParts} from './session-inputs.js';
import {validateBranchOrigin} from './session-branch-format.js';
export const GPU_EXACT_RUNTIME='rv64-linux-gpu-exact-session-v1';
export const GPU_EXACT_INPUTS=['uart','keyboard','pointer','display','agent','clipboard','file-transfer','lifecycle','mtime','rtc','entropy','timers','block-read','block-write','dma','network','network-time','audio-playback','gpu-results','storage-control','checkpoint-control'];
export const GPU_FRAME_LIMIT=640*1048576;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export const gpuNeed=(value,detail)=>{if(!value)throw Error('GPU exact session: '+detail);};
const need=gpuNeed,hash=/^[0-9a-f]{64}$/;
export const gpuHex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
export const gpuHashBytes=text=>{need(hash.test(text),'digest');return Uint8Array.from(text.match(/../g),value=>parseInt(value,16));};
export const gpuPosition=value=>({transition:value.transition,phase:value.phase,ordinal:value.ordinal,sequence:value.sequence,retired:value.retired});
export const gpuSamePosition=(a,b)=>['transition','phase','ordinal','sequence','retired'].every(key=>a[key]===b[key]);
export const gpuCompare=(a,b)=>{for(const [x,y] of [[BigInt(a.transition),BigInt(b.transition)],[a.phase==='before'?0:1,b.phase==='before'?0:1],[a.ordinal,b.ordinal],[BigInt(a.sequence),BigInt(b.sequence)]])if(x!==y)return x<y?-1:1;return 0;};
const exact=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).join(',')===expected.join(',');
export function ownGpuReceipt(receipt,previous){
  if(receipt?.channel<=21)return ownInputReceipt(receipt,previous);
  need(receipt&&(receipt.channel===22||receipt.channel===23),'GPU channel');
  need(['transition','retired','sequence','ticket'].every(key=>exact(receipt[key]))
    &&receipt.phase===(receipt.channel===23?'observe':'before')&&Number.isInteger(receipt.ordinal)&&receipt.ordinal>0&&receipt.ordinal<=0xffffffff,'GPU event coordinates');
  need(BigInt(receipt.sequence)===BigInt(previous.sequence)+1n&&gpuCompare(receipt,previous)>0
    &&BigInt(receipt.retired)>=BigInt(previous.retired)&&BigInt(receipt.retired)<=BigInt(receipt.transition)
    &&(receipt.transition!==previous.transition||receipt.retired===previous.retired)
    &&(receipt.transition===previous.transition&&receipt.phase===previous.phase?receipt.ordinal===previous.ordinal+1:receipt.ordinal===1),'GPU event order');
  need(Array.isArray(receipt.outcome)&&receipt.outcome.length===4&&receipt.outcome.every(exact),'GPU receipt result');
  need(receipt.bytes instanceof Uint8Array&&receipt.bytes.buffer instanceof ArrayBuffer&&receipt.bytes.length<=256,'owned GPU envelope');
  const row={...gpuPosition(receipt),channel:receipt.channel,outcome:[...receipt.outcome],bytes:receipt.bytes.slice(),ticket:receipt.ticket};
  gpuEventParts(row);return row;
}
export function gpuEventParts(row){
  if(row.channel<=21)return inputEventParts(row);
  let body=null,failed=false;
  if(row.channel===22){
    const info=sessionGpuResultInfo(row.bytes);
    need(row.outcome[0]===String(info.kind)&&row.outcome[2]===String(info.length)&&row.outcome[3]===info.exchange&&BigInt(row.outcome[1])>0n,'GPU result receipt intent');
    if(info.kind===2)body={sha256:gpuHex(info.sha256),length:String(info.length)};
    failed=info.failed;
  }else{
    need(row.channel===23&&row.outcome.join(',')==='0,7,40,0'&&row.bytes.length===40,'GPU control observation');
    const code=new DataView(row.bytes.buffer,row.bytes.byteOffset,row.bytes.byteLength).getBigUint64(32,true);
    need(code<=6n,'GPU control outcome');failed=code!==0n;
  }
  return {kind:'gpu',device:'slot7',status:failed?'failed':'applied',
    intent:[...encoder.encode(JSON.stringify({version:1,channel:row.channel,outcome:row.outcome,ticket:row.ticket,header:[...row.bytes]}))],
    payload:body?{storage:'blob',content:body}:{storage:'inline',bytes:[]},body};
}
export function validateGpuConfiguration(input){
  const config=JSON.parse(JSON.stringify(input));
  need(config.version===1&&config.runtime===GPU_EXACT_RUNTIME&&config.exactGpuSession===1&&config.providersComplete===true
    &&config.ramMib===1024&&config.clock?.mode==='icount'&&config.clock.divider===64
    &&config.clock.timebase_hz==='10000000'&&config.clock.interactive===null,'unsupported GPU runtime/clock profile');
  need(config.timeEntropyPolicy?.version===1&&config.timeEntropyPolicy.divider===64&&config.timeEntropyPolicy.timebase_hz==='10000000'
    &&config.timeEntropyPolicy.rtc==='external-nanoseconds-v1'&&config.timeEntropyPolicy.entropy==='exact-fill-bytes-v1'
    &&config.deviceCompletionPolicy?.version===1&&config.deviceCompletionPolicy.block==='immutable-base-cow-v1'
    &&config.deviceCompletionPolicy.agent==='owned-agent-receive-v1'&&config.deviceCompletionPolicy.capture==='owned-s16-capture-v1'
    &&config.networkPolicy?.version===1&&config.networkPolicy.transport==='owned-ethernet-v1'&&config.networkPolicy.replay==='zero-egress','incomplete GPU provider inventory');
  need(typeof config.imageManifest==='string'&&typeof config.bootargs==='string'&&Array.isArray(config.devices)
    &&config.devices.filter(value=>value.kind==='virtio-gpu3d').length===1&&!config.devices.some(value=>value.kind==='virtio-gpu2d'),'qualified GPU topology');
  need(config.profile&&config.profile.hostWords?.length===14&&Array.isArray(config.profile.formatRoles)&&typeof config.profile.renderer==='string','qualified physical profile');
  for(const role of ['kernel','wasm','renderer'])need(hash.test(config[role]?.sha256)&&typeof config[role]?.url==='string'&&exact(config[role]?.length)&&BigInt(config[role].length)>0n,'GPU asset identity');
  need(hash.test(config.renderer.buildId),'renderer build identity');
  if(config.branchOrigin!==undefined)config.branchOrigin=validateBranchOrigin(config.branchOrigin);
  return config;
}
const metadataKeys=['version','runtime','position','rendererSha256','rendererEpoch','ramSha256','stateSha256','full'];
function metadata(value){
  need(keys(value,metadataKeys)&&value.version===1&&hash.test(value.runtime)&&hash.test(value.rendererSha256)&&hash.test(value.ramSha256)&&hash.test(value.stateSha256)
    &&typeof value.rendererEpoch==='string'&&/^[0-9a-f]{16}$/.test(value.rendererEpoch)&&value.rendererEpoch!=='0000000000000000'&&typeof value.full==='boolean','GPU frame identity');
  need(keys(value.position,['transition','phase','ordinal','sequence','retired'])&&value.position.phase==='before'
    &&['transition','sequence','retired'].every(key=>exact(value.position[key]))&&Number.isInteger(value.position.ordinal)&&value.position.ordinal>=0&&value.position.ordinal<=0xffffffff,'GPU frame position');
  return encoder.encode(JSON.stringify(value));
}
function nativeIdentity(native,meta){
  need(native.length>=168&&native.length<=512*1048576&&decoder.decode(native.subarray(0,8))==='WVMRESU1','GPU native boundary');
  const view=new DataView(native.buffer,native.byteOffset,native.byteLength),seal=native.length-84;
  need(view.getUint32(8,true)===1&&decoder.decode(native.subarray(seal,seal+8))==='WVGRESU1'&&view.getUint32(seal+8,true)===1
    &&view.getBigUint64(seal+12,true)===BigInt(seal)&&gpuHex(native.subarray(seal+20,seal+52))===meta.rendererSha256
    &&checkpointHash(native.subarray(0,-32))===gpuHex(native.subarray(-32)),'GPU native/renderer seal');
  let at=84,ram=0,clock=0,frontier=0;
  while(at<seal){need(at+8<=seal,'native section header');const tag=view.getUint32(at,true),length=view.getUint32(at+4,true);at+=8;need(at+length<=seal,'native section length');
    if(tag===2)ram++;
    if(tag===18){clock++;need(length>=44&&view.getBigUint64(at+12,true)===BigInt(meta.position.transition)&&view.getBigUint64(at+20,true)===BigInt(meta.position.retired)
      &&view.getBigUint64(at+28,true)===BigInt(meta.position.ordinal)&&view.getBigUint64(at+36,true)===BigInt(meta.position.sequence),'GPU native event coordinate');}
    if(tag===22)frontier++;at+=length;
  }
  // Core validates every architectural field before any restore. These checks bind
  // framing and the position before the object reaches the publication transaction.
  need(at===seal&&ram===(meta.full?1:0)&&clock===1&&frontier===1,'GPU full/delta/native frontier shape');
}
export function encodeGpuExactFrame(meta,native,pending,output){
  const header=metadata(meta);need(header.length<=16384&&native instanceof Uint8Array&&pending instanceof Uint8Array&&output instanceof Uint8Array
    &&pending.length<=1048576&&output.length<=1048576,'GPU frame bounds');nativeIdentity(native,meta);
  const bytes=new Uint8Array(32+header.length+native.length+pending.length+output.length),view=new DataView(bytes.buffer);
  bytes.set(encoder.encode(meta.full?'WVGPUB01':'WVGPUD01'));view.setUint32(8,1,true);view.setUint32(12,header.length,true);view.setBigUint64(16,BigInt(native.length),true);
  view.setUint32(24,pending.length,true);view.setUint32(28,output.length,true);let at=32;for(const part of [header,native,pending,output]){bytes.set(part,at);at+=part.length;}return bytes;
}
export function decodeGpuExactFrame(bytes){
  need(bytes instanceof Uint8Array&&bytes.buffer instanceof ArrayBuffer&&bytes.length>=200&&bytes.length<=GPU_FRAME_LIMIT,'GPU frame bound');
  const magic=decoder.decode(bytes.subarray(0,8)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need(['WVGPUB01','WVGPUD01'].includes(magic)&&view.getUint32(8,true)===1,'GPU frame version');
  const headerLength=view.getUint32(12,true),nativeLength=view.getBigUint64(16,true),pendingLength=view.getUint32(24,true),outputLength=view.getUint32(28,true);
  need(headerLength<=16384&&nativeLength<=512n*1048576n&&pendingLength<=1048576&&outputLength<=1048576
    &&32n+BigInt(headerLength)+nativeLength+BigInt(pendingLength+outputLength)===BigInt(bytes.length),'GPU frame lengths');
  const headerBytes=bytes.subarray(32,32+headerLength),meta=JSON.parse(decoder.decode(headerBytes)),canonical=metadata(meta);
  need(canonical.length===headerBytes.length&&canonical.every((byte,index)=>byte===headerBytes[index])&&meta.full===(magic==='WVGPUB01'),'GPU frame canonical metadata');
  let at=32+headerLength;const native=bytes.subarray(at,at+Number(nativeLength));at+=native.length;
  const pending=bytes.subarray(at,at+pendingLength);at+=pending.length;const output=bytes.subarray(at);
  nativeIdentity(native,meta);return {meta,native,pending,output};
}
export const gpuFrameReference=checkpointReference;
