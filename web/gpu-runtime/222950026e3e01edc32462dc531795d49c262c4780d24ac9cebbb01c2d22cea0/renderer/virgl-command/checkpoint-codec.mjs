/** Portable data only: native objects, accessors and shared views cannot enter a checkpoint. */
export const CHECKPOINT_MAX_BYTES = 512 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 64;
const utf8 = new TextEncoder(), text = new TextDecoder('utf-8', {fatal:true});
function need(value, message) { if (!value) throw Error('GPU checkpoint: '+message); }
export function checkpointBytes(value) {
  const prototype = Object.getPrototypeOf(Uint8Array.prototype);
  need(Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag).get.call(value) === 'Uint8Array', 'expected byte data');
  const buffer = Object.getOwnPropertyDescriptor(prototype, 'buffer').get.call(value);
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(buffer);
  return new Uint8Array(buffer,
    Object.getOwnPropertyDescriptor(prototype, 'byteOffset').get.call(value),
    Object.getOwnPropertyDescriptor(prototype, 'byteLength').get.call(value));
}
export async function checkpointHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', checkpointBytes(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function equalCheckpointBytes(a, b) {
  a=checkpointBytes(a); b=checkpointBytes(b);
  return a.length===b.length && a.every((value,index)=>value===b[index]);
}
export function encodeCheckpointData(value) {
  const chunks=[]; let length=0, nodes=0;
  const add = bytes => { need(bytes.length <= CHECKPOINT_MAX_BYTES-length, 'data budget exceeded'); chunks.push(bytes); length+=bytes.length; };
  const tag = value => add(Uint8Array.of(value));
  const count = value => { need(Number.isSafeInteger(value) && value>=0 && value<=0xffffffff, 'invalid length'); const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,value,true);add(b); };
  const visit = (value, depth) => {
    need(++nodes<=MAX_NODES && depth<=MAX_DEPTH, 'data shape exceeds bounds');
    if (value===null) { tag(0); return; }
    if (typeof value==='boolean') { tag(value?2:1); return; }
    if (typeof value==='number') { tag(3);const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,value,true);add(b);return; }
    if (typeof value==='string') { tag(4);const b=utf8.encode(value);count(b.length);add(b);return; }
    need(value && typeof value==='object', 'non-data value');
    if (ArrayBuffer.isView(value)) { tag(5);const b=checkpointBytes(value);count(b.length);add(new Uint8Array(b));return; }
    if (Array.isArray(value)) {
      need(value.length<=MAX_NODES && Reflect.ownKeys(value).length===value.length+1, 'invalid array');tag(6);count(value.length);
      for(let i=0;i<value.length;i++) { const descriptor=Object.getOwnPropertyDescriptor(value,String(i));need(descriptor && Object.hasOwn(descriptor,'value'),'array accessor or hole');visit(descriptor.value,depth+1); }
      return;
    }
    need(Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null, 'native object');
    const keys=Reflect.ownKeys(value);need(keys.length<=1024 && keys.every(key=>typeof key==='string'),'invalid record keys');keys.sort();tag(7);count(keys.length);
    for(const key of keys) { const descriptor=Object.getOwnPropertyDescriptor(value,key);need(Object.hasOwn(descriptor,'value'),'record accessor');visit(key,depth+1);visit(descriptor.value,depth+1); }
  };
  visit(value,0);const output=new Uint8Array(length);let at=0;
  for(const chunk of chunks) { output.set(chunk,at);at+=chunk.length; }
  return output;
}
export function decodeCheckpointData(source) {
  const bytes=checkpointBytes(source);need(bytes.length<=CHECKPOINT_MAX_BYTES,'data budget exceeded');let at=0,nodes=0;
  const take = n => { need(Number.isSafeInteger(n) && n>=0 && n<=bytes.length-at,'truncated data');const b=bytes.subarray(at,at+n);at+=n;return b; };
  const count = () => { const b=take(4);return new DataView(b.buffer,b.byteOffset,4).getUint32(0,true); };
  const visit = depth => {
    need(++nodes<=MAX_NODES && depth<=MAX_DEPTH,'data shape exceeds bounds');
    const tag=take(1)[0];
    if(tag===0)return null;if(tag===1)return false;if(tag===2)return true;
    if(tag===3) { const b=take(8);return new DataView(b.buffer,b.byteOffset,8).getFloat64(0,true); }
    if(tag===4)return text.decode(take(count()));
    if(tag===5)return new Uint8Array(take(count()));
    if(tag===6) { const n=count();need(n<=MAX_NODES && n<=bytes.length-at,'invalid array length');const out=[];for(let i=0;i<n;i++)out.push(visit(depth+1));return out; }
    need(tag===7,'unknown data tag');const n=count();need(n<=1024 && n<=(bytes.length-at)/2,'invalid record length');const out=Object.create(null);let prior=null;
    for(let i=0;i<n;i++) { const key=visit(depth+1);need(typeof key==='string' && (prior===null || key>prior),'duplicate or unordered record key');prior=key;Object.defineProperty(out,key,{value:visit(depth+1),enumerable:true,writable:true,configurable:true}); }
    return out;
  };
  const value=visit(0);need(at===bytes.length,'trailing data');return value;
}
