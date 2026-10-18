// Owned Ethernet envelopes. Neither the replay driver nor the machine holds a live provider.
import {checkpointReference} from './session-checkpoints.js';
const need=(ok,why)=>{if(!ok)throw Error('network replay: '+why);};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const exact=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=0xffffffffffffffffn;
export function splitNetworkEvent(input){
 need(input instanceof Uint8Array&&input.buffer instanceof ArrayBuffer&&input.length<=65599,'owned envelope bound');
 const bytes=input.slice(),v=new DataView(bytes.buffer);let at=8;
 const u8=()=>{need(at<bytes.length,'truncated');return bytes[at++];};
 const u32=()=>{need(at+4<=bytes.length,'truncated');const n=v.getUint32(at,true);at+=4;return n;};
 const u64=()=>{need(at+8<=bytes.length,'truncated');const n=String(v.getBigUint64(at,true));at+=8;return n;};
 need(decoder.decode(bytes.subarray(0,8))==='WVNETE01','version');const tag=u8();let id='0',result=0,length=0;
 if(tag===1){result=u8();need(result<=2,'send result');id=u64();need(id!=='0','send identity');length=u32();}
 else if(tag===2)length=u32();
 else if(tag===3){id=String(u8());need(['1','2','3'].includes(id),'link outcome');result=u32();need(id!=='1'||result===0,'open error');}
 else if(tag===4){result=u8();need(result<=1,'pending flag');}
 else need(false,'event kind');
 need(length<=65535&&at+length===bytes.length,'payload bound');
 return{tag,id,result,header:bytes.slice(0,at),payload:bytes.slice(at),status:tag===1?['applied','failed','cancelled'][result]:tag===3&&id==='3'?'failed':'applied'};
}
export function joinNetworkEvent(header,payload){
 need(header instanceof Uint8Array&&header.buffer instanceof ArrayBuffer&&header.length<=22&&payload instanceof Uint8Array&&payload.buffer instanceof ArrayBuffer&&payload.length<=65535,'parts');
 const bytes=new Uint8Array(header.length+payload.length);bytes.set(header);bytes.set(payload,header.length);splitNetworkEvent(bytes);return bytes;
}
export function encodeNetworkEvent(tag,{id='0',result=0,payload=new Uint8Array()}={}){
 need([1,2,3,4].includes(tag)&&exact(id)&&payload instanceof Uint8Array&&payload.buffer instanceof ArrayBuffer&&payload.length<=65535,'event arguments');
 need(Number.isInteger(result)&&result>=0&&result<=0xffffffff,'outcome');
 const header=new Uint8Array(tag===1?22:tag===2?13:tag===3?14:10),v=new DataView(header.buffer);header.set(encoder.encode('WVNETE01'));header[8]=tag;
 if(tag===1){need(result<=2,'send outcome');header[9]=result;v.setBigUint64(10,BigInt(id),true);v.setUint32(18,payload.length,true);}
 else if(tag===2)v.setUint32(9,payload.length,true);
 else if(tag===3){need(['1','2','3'].includes(id),'link status');header[9]=Number(id);v.setUint32(10,result,true);}
 else{need(result<=1,'pending');header[9]=result;}
 return joinNetworkEvent(header,payload);
}
export function networkEventParts(receipt){
 need(receipt.channel===20&&receipt.phase==='before'&&['transition','retired','sequence'].every(k=>exact(receipt[k]))&&Number.isInteger(receipt.ordinal)&&receipt.ordinal>0&&receipt.ordinal<=0xffffffff
  &&Array.isArray(receipt.outcome)&&receipt.outcome.length===4&&receipt.outcome.every(exact),'exact position');
 const v=splitNetworkEvent(receipt.bytes),second=v.tag===1||v.tag===3?v.id:'0',third=v.tag===2?String(v.payload.length):String(v.result);
 need(receipt.outcome[0]===String(v.tag)&&receipt.outcome[1]===second&&receipt.outcome[2]===third&&BigInt(receipt.outcome[3])>0n,'accepted outcome');
 const content=v.payload.length?checkpointReference(v.payload):null;
 return{kind:'network',device:'virtio-net',status:v.status,intent:{version:1,channel:20,outcome:[...receipt.outcome],header:[...v.header]},
 payload:content?{storage:'blob',content}:{storage:'inline',bytes:[]},object:content?[content,v.payload]:null};
}
// Gate the factory before it can create sockets, workers or HTTP actions.
export function openNetworkProvider(machine,factory){
 need(machine.networkSessionReplay()===false,'live provider refused in replay');
 const lease=machine.leaseNetworkRequest('');
 try{return{provider:factory(),lease};}catch(error){lease.free();throw error;}
}
export class NetworkReplay{
 #machine;#receipts;#cursor;#end;#state='ready';#failure=null;
 constructor(machine,receipts,end,cursor){
  need(machine.networkSessionReplay()===true,'replay machine required');need(Array.isArray(receipts)&&receipts.length<=4096&&exact(end)&&exact(cursor),'replay bounds');
  this.#receipts=receipts.map(r=>{networkEventParts(r);return{...r,outcome:[...r.outcome],bytes:r.bytes.slice()};});
  this.#machine=machine;this.#cursor=String(cursor);this.#end=String(end);
 }
 get state(){return this.#state;} get failure(){return this.#failure;}
 run(budget){
  need(this.#state==='ready','driver is stopped');
  try{
   need(Number.isSafeInteger(budget)&&budget>0,'execution budget');
   const run=target=>{need(BigInt(target)>=BigInt(this.#machine.eventPosition().transition)&&BigInt(target)<=BigInt(this.#end),'event outside declared interval');while(BigInt(this.#machine.eventPosition().transition)<BigInt(target))this.#machine.runEventUntil(String(target),budget);};
   for(const r of this.#receipts){run(r.transition);this.#machine.replayNetworkEvent(r.transition,r.retired,r.sequence,r.ordinal,r.bytes);
    const accepted=this.#machine.takeNetworkDeliveries();need(accepted.length===1,'one network receipt');networkEventParts(accepted[0]);
    need(JSON.stringify([accepted[0].transition,accepted[0].retired,accepted[0].sequence,accepted[0].ordinal,accepted[0].channel,accepted[0].outcome,[...accepted[0].bytes]])===JSON.stringify([r.transition,r.retired,r.sequence,r.ordinal,r.channel,r.outcome,[...r.bytes]]),'accepted receipt matches tape');}
   run(this.#end);this.#machine.finishNetworkReplay(this.#cursor);this.#state='completed';return this.#machine.eventPosition();
  }catch(error){this.#failure={position:{...this.#machine.eventPosition()},message:String(error)};this.#state='diverged';throw error;}
 }
}
