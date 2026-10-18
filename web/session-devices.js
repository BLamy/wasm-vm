// The delivery envelope owns ordering/intent; immutable bytes are separate CAS objects.
import {checkpointHash,checkpointReference} from './session-checkpoints.js';
const need=(ok,why)=>{if(!ok)throw Error('device completion: '+why);};
const text=new TextDecoder('utf-8',{fatal:true});
const exact=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;
export function splitDeviceCompletion(input){
 need(input instanceof Uint8Array&&input.buffer instanceof ArrayBuffer&&input.length<=1048448,'owned envelope bound');
 const bytes=input.slice(),v=new DataView(bytes.buffer);let at=8;
 const u8=()=>{need(at+1<=bytes.length,'truncated');return bytes[at++];};
 const u32=()=>{need(at+4<=bytes.length,'truncated');const n=v.getUint32(at,true);at+=4;return n;};
 const u64=()=>{need(at+8<=bytes.length,'truncated');const n=String(v.getBigUint64(at,true));at+=8;return n;};
 need(text.decode(bytes.subarray(0,8))==='WVDEVC01','version');const id=u64();need(id!=='0','request identity');
 const tag=u8();let intent,kind,device;
 if(tag===1){const chunk=u32();need(at+32<=bytes.length,'base reference');const sha256=[...bytes.subarray(at,at+32)].map(b=>b.toString(16).padStart(2,'0')).join('');at+=32;const length=u32();intent={chunk,content:{sha256,length:String(length)}};kind='block';device='virtio-blk';}
 else if(tag===2){intent={generation:u64(),maximum:u32()};need(intent.maximum>0&&intent.maximum<=1048320,'agent intent');kind='file-transfer';device='org.wasmvm.agent';}
 else if(tag===3){intent={samples:u32(),rate:u32(),channels:u8()};need(intent.samples>0&&intent.samples<=524160&&intent.rate===48000&&[1,2].includes(intent.channels)&&intent.samples%intent.channels===0,'capture intent');kind='audio';device='virtio-snd-capture';}
 else need(false,'unsupported adapter');
 const status=u8(),frames=u32(),length=u32();need(status<=2&&length<=1048320&&at+length===bytes.length,'result bounds');
 const payload=bytes.slice(at),header=bytes.slice(0,at);
 if(status!==0)need(length===0&&frames===0,'failed/cancelled payload');
 else if(tag===1)need(frames===0&&intent.content.length===String(length)&&checkpointHash(payload)===intent.content.sha256,'immutable base bytes');
 else if(tag===2)need(frames===0&&length<=intent.maximum,'agent result');
 else need(frames<=intent.samples/intent.channels&&length===frames*intent.channels*2,'capture result');
 return {id,tag,intent,status,frames,kind,device,header,payload};
}
export function joinDeviceCompletion(header,payload){
 need(header instanceof Uint8Array&&payload instanceof Uint8Array&&header.length<=128&&payload.length<=1048320,'envelope parts');
 const bytes=new Uint8Array(header.length+payload.length);bytes.set(header);bytes.set(payload,header.length);splitDeviceCompletion(bytes);return bytes;
}
export function deviceEventParts(receipt){
 need(receipt.channel===19&&receipt.phase==='before'&&['transition','retired','sequence'].every(key=>exact(receipt[key]))
  &&Number.isInteger(receipt.ordinal)&&receipt.ordinal>0&&Array.isArray(receipt.outcome)&&receipt.outcome.length===4&&receipt.outcome.every(exact),'exact delivery');
 const value=splitDeviceCompletion(receipt.bytes);
 need(receipt.outcome[0]===String(value.status)&&receipt.outcome[1]===value.id&&BigInt(receipt.outcome[2])<=BigInt(value.payload.length)&&BigInt(receipt.outcome[3])>0n,'accepted completion receipt');
 if(value.tag!==2)need(receipt.outcome[2]===String(value.payload.length),'exact block/capture accepted bytes');
 const intent={version:1,channel:19,outcome:[...receipt.outcome],header:[...value.header]};
 const content=value.payload.length?checkpointReference(value.payload):null;
 return {kind:value.kind,device:value.device,intent,status:['applied','failed','cancelled'][value.status],payload:content?{storage:'blob',content}:{storage:'inline',bytes:[]},object:content?[content,value.payload]:null};
}
