// E9-T15: bounded, content-addressed incremental RAM keyframe descriptor. A checkpoint's
// `machine` reference is either a legacy WVSOFT01 full frame or this descriptor. Descriptors
// point only backwards to the immediately preceding checkpoint, so the chain has one full base.
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const MAGIC = 'WVKEYF01';
export const KEYFRAME_MAX_DEPTH = 8;
export const KEYFRAME_MAX_DESCRIPTOR_BYTES = 1 << 20;
export const KEYFRAME_MAX_RAM_BYTES = 1 << 30;
export const KEYFRAME_MAX_CHUNKS = 512;
const hash = /^[0-9a-f]{64}$/;
const decimal = /^(?:0|[1-9][0-9]*)$/;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).join(',') === expected.join(',');
const need = (condition, detail) => {if(!condition)throw Error(`Invalid keyframe descriptor: ${detail}`);};
const ref = (value, max) => keys(value,['sha256','length']) && hash.test(value.sha256)
  && typeof value.length === 'string' && decimal.test(value.length)
  && BigInt(value.length)>0n && BigInt(value.length)<=BigInt(max);

export function encodeKeyframeDescriptor(value) {
  need(keys(value,['version','depth','parent','frame','chunks','ramBytes','ramSha256','dirtyPages']), 'fields');
  need(value.version===1 && Number.isInteger(value.depth) && value.depth>=1
    && value.depth<=KEYFRAME_MAX_DEPTH,'version/depth');
  need(ref(value.parent,640*1048576) && ref(value.frame,640*1048576),'frame references');
  need(Array.isArray(value.chunks) && value.chunks.length<=KEYFRAME_MAX_CHUNKS
    && value.chunks.every(chunk=>ref(chunk,4*1048576)),'chunk references');
  need(typeof value.ramBytes==='string' && decimal.test(value.ramBytes)
    && BigInt(value.ramBytes)>0n && BigInt(value.ramBytes)<=BigInt(KEYFRAME_MAX_RAM_BYTES), 'RAM bound');
  need(typeof value.ramSha256==='string' && hash.test(value.ramSha256),'RAM digest');
  need(Number.isSafeInteger(value.dirtyPages) && value.dirtyPages>=0
    && value.dirtyPages<=Math.ceil(Number(value.ramBytes)/4096)
    && (value.dirtyPages===0)===(value.chunks.length===0)
    && value.chunks.length<=value.dirtyPages,'dirty-page count');
  const bytes=encoder.encode(MAGIC+JSON.stringify(value));
  need(bytes.length<=KEYFRAME_MAX_DESCRIPTOR_BYTES,'descriptor bound');
  return bytes;
}

export function isKeyframeDescriptorPrefix(bytes) {
  return bytes instanceof Uint8Array && bytes.length>=8
    && bytes[0]===87 && bytes[1]===86 && bytes[2]===75 && bytes[3]===69
    && bytes[4]===89 && bytes[5]===70 && bytes[6]===48 && bytes[7]===49;
}

export function decodeKeyframeDescriptor(bytes) {
  need(bytes instanceof Uint8Array && bytes.length>=10
    && bytes.length<=KEYFRAME_MAX_DESCRIPTOR_BYTES && isKeyframeDescriptorPrefix(bytes),'magic/bound');
  let value;
  try {value=JSON.parse(decoder.decode(bytes.subarray(8)));}
  catch {throw Error('Invalid keyframe descriptor: JSON');}
  const canonical=encodeKeyframeDescriptor(value);
  need(canonical.length===bytes.length && canonical.every((byte,index)=>byte===bytes[index]),'canonical encoding');
  return value;
}

export function inspectRamDeltaChunk(bytes, ramBytes, previousPage = -1) {
  need(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer
    && bytes.length>=24 && bytes.length<=4*1048576,'RAM chunk bound');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  need(decoder.decode(bytes.subarray(0,8))==='WVRAMD01'&&view.getUint32(8,true)===1,'RAM chunk version');
  need(view.getBigUint64(12,true)===BigInt(ramBytes),'RAM chunk size');
  const count=view.getUint32(20,true),pages=Math.ceil(Number(ramBytes)/4096);
  need(count>0&&count<=1023,'RAM chunk count');
  let at=24,last=previousPage,first=null;
  for(let i=0;i<count;i++){
    need(at+6<=bytes.length,'RAM page header');
    const page=view.getUint32(at,true),length=view.getUint16(at+4,true);
    need(page>last&&page<pages&&length===Math.min(4096,Number(ramBytes)-page*4096),'RAM page order/bound');
    if(first===null)first=page;
    at+=6+length;need(at<=bytes.length,'RAM page payload');last=page;
  }
  need(at===bytes.length,'RAM chunk trailing bytes');
  return {first,last,count};
}
