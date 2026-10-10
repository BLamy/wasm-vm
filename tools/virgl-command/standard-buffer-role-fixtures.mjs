/** Original creation hints and overlapping guest bytes; no renderer/compiler oracle. */
import {specimen as uniformSpec,quad,word} from './standard-uniform-binding-fixtures.mjs';
import {packet,join,meta,transfer,shader,clear} from '../../renderer/virgl-command/tests/standard-instanced-draws.mjs';
import {bind} from './standard-uniform-binding-fixtures.mjs';
export const hints=Object.freeze([0,16,32,48,64,80,96,112]);
export function specimen({hint=0,indexSize=2,shift=0,indexed=true,alignment=16,seed=0x7139bdec,constant=false}={}){
 const s=uniformSpec({slots:[0],count:4,vector:3,shift,alignment,seed,indexed,constant});
 const bank=s.banks[0],raw=bank.data;raw.set(new Uint8Array(quad.buffer),bank.offset);
 const indexOffset=bank.offset+48,v=new DataView(raw.buffer);
 for(let i=0;i<3;i++){if(indexSize===1)v.setUint8(indexOffset+i,i);else if(indexSize===2)v.setUint16(indexOffset+i*2,i,true);else v.setUint32(indexOffset+i*4,i,true);}
 bank.words=new Uint32Array(raw.slice(bank.offset,bank.offset+bank.length).buffer);bank.bind=hint;
 s.data=new Map([[bank.id,raw],...(constant?[[4,new Uint8Array(16)]]:[])]);s.expected=[...bank.words.slice(12,16)].map(n=>((n+n)>>>shift)&255);
 Object.assign(s,{hint,indexSize,indexOffset,positionOffset:bank.offset,indices:[0,1,2],assembly:false});return s;
}
export function setup(r,s,{create=true}={}){
 const bank=s.banks[0];if(create)for(const[id,raw]of s.data)r.add(meta(id,0,64,id===bank.id?s.hint:0,raw.length),raw);
 return join(...[...s.data].map(([id,raw])=>transfer(id,raw.length)),shader(1,0,s.vertex),shader(2,1,s.fragment),
  packet(1,5,[3,0,0,0,31,...(s.constant?[0,0,1,31]:[])]),packet(2,5,[3]),packet(6,0,[16,s.positionOffset,bank.id,...(s.constant?[0,0,4]:[])]),packet(11,0,[bank.id,s.indexSize,s.indexOffset]),
  packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[r.width/2,r.height/2,.5,r.width/2,r.height/2,.5].map(word)]),
  bind(0,0,bank.offset,bank.length,bank.id),bind(1,0,bank.offset,bank.length,bank.id),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export const draw=s=>packet(8,0,[0,3,4,s.indexed?1:0,1,0,0,0,0,0,0xffffffff,0]);
