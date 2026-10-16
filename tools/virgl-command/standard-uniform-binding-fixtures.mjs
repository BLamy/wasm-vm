/** Literal original words, packets and pre-compiler predictions for native UBO bindings. */
import {packet,join,meta,transfer,shader,clear} from '../../renderer/virgl-command/tests/standard-instanced-draws.mjs';
export const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
export const quad=new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]);
const program=(stage,dcl,ops)=>(stage?'FRAG\n':'VERT\n')+dcl+'\n'+[...ops,'END'].map((op,i)=>i+': '+op+'\n').join('');
export const bind=(stage,slot,offset,length,id)=>packet(27,0,[stage,slot,offset,length,id]);
export const draw=(s={})=>packet(8,0,[0,3,4,s.indexed?1:0,1,0,0,0,0,0,0xffffffff,0]);
const rawWords=(count,seed)=>{
 const out=new Uint32Array(count*4);let state=seed>>>0;
 for(let i=0;i<out.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;out[i]=state>>>0;}
 const edges=[0x80000000,0xffffffff,0x7fc01234,0x00000001,0x007fffff,0x3f800001,0xbf800001,0xdeadbeef];
 for(let k=0;k<Math.min(8,out.length);k++)out[k]=edges[k];return out;
};
export function specimen({slots=[1],count,vector,offset=0,shift=0,stage='both',indexed=false,constant=false,seed=0x6e624eb7,alignment=16,unused=false,zeroInlineMask=0,formats=false}={}){
 const banks=slots.map(slot=>{const vectors=count??(slot?1024:512),prefix=2*alignment,words=rawWords(vectors,(seed+slot*101)>>>0),data=new Uint8Array(prefix+vectors*16+2*alignment);data.fill(0xa7);data.set(new Uint8Array(words.buffer),prefix);return{slot,id:200+slot,count:vectors,words,data,offset:prefix,length:vectors*16,bind:slot%3===0?16:slot%3===1?64:80};});
 const s={slots,banks,shift,indexed,constant,seed,alignment,unused,zeroInlineMask,formats,width:16,height:16,data:new Map([[3,new Uint8Array(quad.buffer)]])};
 s.formatStride=formats&&!constant?40:0;
 if(constant||formats){const extra=new Uint8Array(s.formatStride?120:40),v=new DataView(extra.buffer);if(formats){[-1,2,3,4].forEach((n,i)=>v.setInt32(i*4,n,true));[0xffffffff,7,9,11].forEach((n,i)=>v.setUint32(16+i*4,n,true));const pack=lanes=>lanes.reduce((n,k,i)=>n|(k&((1<<(i===3?2:10))-1))<<(i*10),0)>>>0;v.setUint32(32,pack([1,-1,255,1]),true);v.setUint32(36,pack([-512,-256,511,-2]),true);if(s.formatStride){extra.copyWithin(40,0,40);extra.copyWithin(80,0,40);}}s.data.set(4,extra);}
 if(indexed)s.data.set(6,new Uint8Array(new Uint16Array([0,1,2]).buffer));
 for(const bank of banks)s.data.set(bank.id,bank.data);
 const active=which=>!unused&&(stage==='both'||stage===which),address=bank=>vector??(bank.count-1),ref=bank=>offset?'CONST['+bank.slot+'][ADDR[0].x '+(offset>0?'+':'')+offset+']':'CONST['+bank.slot+']['+address(bank)+']';
 const declarations=banks.map(bank=>'DCL CONST['+bank.slot+'][0..'+(bank.count-1)+']').join('\n'),addr=offset?'\nDCL ADDR[0]':'',base=Array(4).fill((address(banks[0])-offset)+'.0').join(','),addrOps=offset?['ARL ADDR[0].x, IMM[2].xxxx']:[];
 const sum=which=>active(which)?banks.map(bank=>'UADD TEMP[0], TEMP[0], '+ref(bank)):[];
 s.vertex=program(0,'DCL IN[0]\n'+(formats?[1,2,3,4].map(index=>'DCL IN['+index+']\n').join(''):constant?'DCL IN[1]\n':'')+'DCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0]\n'+declarations+addr+'\nIMM[0] UINT32 {0,0,0,0}'+(offset?'\nIMM[1] FLT32 {'+base+'}':''),
  ['MOV OUT[0], IN[0]','MOV TEMP[0], IMM[0]',...(offset?['ARL ADDR[0].x, IMM[1].xxxx']:[]),...sum('vertex'),...(formats?[1,2,3,4].map(index=>'UADD TEMP[0], TEMP[0], IN['+index+']'):constant?['UADD TEMP[0], TEMP[0], IN[1]']:[]),'MOV OUT[1], TEMP[0]']);
 s.fragment=program(1,'DCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0]\n'+declarations+addr+
  '\nIMM[0] UINT32 {'+Array(4).fill(shift).join(',')+'}\nIMM[1] UINT32 {255,255,255,255}\nIMM[2] FLT32 {'+base+'}\nIMM[3] FLT32 {'+Array(4).fill('0.0039215686274509804').join(',')+'}',
  ['MOV TEMP[0], IN[0]',...addrOps,...sum('fragment'),'USHR TEMP[0], TEMP[0], IMM[0]','AND TEMP[0], TEMP[0], IMM[1]','U2F TEMP[0], TEMP[0]','MUL OUT[0], TEMP[0], IMM[3]']);
 const sumWords=Array(4).fill(0);for(const bank of banks)for(let lane=0;lane<4;lane++){const v=bank.words[address(bank)*4+lane];sumWords[lane]=(sumWords[lane]+v*(Number(active('vertex'))+Number(active('fragment'))))>>>0;}
 if(formats){const additions=[[-1,2,3,4],[0xffffffff,7,9,11],[1,-1,255,1].map(word),[-1,Math.fround(-256/511),1,-1].map(word)];for(const row of additions)for(let i=0;i<4;i++)sumWords[i]=(sumWords[i]+row[i])>>>0;}
 s.expected=sumWords.map(value=>(value>>>shift)&255);s.vector=address(banks[0]);s.relativeOffset=offset;
 if(unused){s.vertex=program(0,'DCL IN[0]\nDCL OUT[0], POSITION\n'+declarations,['MOV OUT[0], IN[0]']);s.fragment=program(1,'DCL OUT[0], COLOR\n'+declarations+'\nIMM[0] FLT32 {0.2,0.4,0.6,0.8}',['MOV OUT[0], IMM[0]']);s.expected=[51,102,153,204];}
 return s;
}
export function setup(r,s,{create=true,bindBanks=true}={}){
 const w=r.width/2,h=r.height/2;
 if(create){for(const[id,raw]of s.data){const bank=s.banks.find(b=>b.id===id);r.add(meta(id,0,64,id===6?32:bank?.bind??16,raw.length),raw);}}
 const inline=[];for(const bank of s.banks)if(bank.slot===0)for(const stage of [0,1])if(s.zeroInlineMask&(1<<stage))inline.push(packet(12,0,[stage,0,...bank.words]));
 return join(...[...s.data].map(([id,raw])=>transfer(id,raw.length)),shader(1,0,s.vertex),shader(2,1,s.fragment),
  packet(1,5,[3,0,0,0,31,...(s.formats?[0,0,1,200,16,0,1,196,32,0,1,172,36,0,1,173]:s.constant?[0,0,1,31]:[])]),packet(2,5,[3]),packet(6,0,[16,0,3,...(s.constant||s.formats?[s.formatStride,0,4]:[])]),...(s.indexed?[packet(11,0,[6,2,0])]:[]),
  packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[w,h,.5,w,h,.5].map(word)]),
  ...(bindBanks?s.banks.flatMap(bank=>[0,1].filter(stage=>!(bank.slot===0&&(s.zeroInlineMask&(1<<stage)))).map(stage=>bind(stage,bank.slot,bank.offset,bank.length,bank.id))):[]),...inline,
  packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
