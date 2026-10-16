// Original format numbers and words, independent of the compiler/emitter.
const zero=()=>({signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:0});
export const selectorKeys=Object.keys(zero());
export const passVertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const varyingVertex='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
export const integerFormats=Array.from({length:24},(_,i)=>({format:177+i,bits:[8,16,32][Math.floor(i/8)],signed:Math.floor(i%8/4)===1,components:i%4+1}));
export const positions=new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]);
export const shrink=(n,level)=>Math.max(1,Math.floor(n/2**level));
function plane(format,width,height,level,seed,finite){
 const {bits,signed,components}=format,bytes=new Uint8Array(width*height*components*bits/8),view=new DataView(bytes.buffer);
 const words=finite?[0x3e800000,0x40200000,0xbe800000,0x3f800000]:signed?[0,1,-1,-(2**(bits-1)),2**(bits-1)-1,-(2**(bits-1))+1,-2,17,63]:[0,1,2**bits-1,2**bits-2,2**(bits-1),2**(bits-1)+1,17,63];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let lane=0;lane<components;lane++){
  const value=words[finite?lane:(x+3*y+11*level+2*lane+seed)%words.length],at=((y*width+x)*components+lane)*bits/8;
  view['setUint'+bits](at,value>>>0,true);
 }
 return {level,width,height,bytes};
}
export function texel(f,level,x,y){
 const p=f.planes[level],v=new DataView(p.bytes.buffer,p.bytes.byteOffset,p.bytes.byteLength),r=[0,0,0,1];
 for(let lane=0;lane<f.components;lane++)r[lane]=v[(f.signed?'getInt':'getUint')+f.bits](((y*p.width+x)*f.components+lane)*f.bits/8,true)>>>0;
 return r;
}
export function sampledWords(f,x,y){
 let r;
 if(f.opcode==='TXQ')r=f.queryMask==='w'?[11,22,33,f.levels]:[shrink(f.width,f.lod),shrink(f.height,f.lod),33,f.levels];
 else{
  const implicit=f.stage==='vertex'?0:Math.floor(Math.log2(Math.max(f.width/f.frameWidth,f.height/f.frameHeight))+.5);
  const level=f.opcode==='TEX'?0:f.opcode==='TXB'?Math.min(f.levels-1,Math.max(0,implicit+f.lod)):f.opcode==='TXD'?2:f.lod;
  const p=f.planes[level],u=f.opcode==='TXB'?(x+.5)/f.frameWidth:f.coord[0],v=f.opcode==='TXB'?(y+.5)/f.frameHeight:f.coord[1];
  r=texel(f,level,f.opcode==='TXF'?f.fetch[0]:Math.min(p.width-1,Math.max(0,Math.floor(u*p.width))),f.opcode==='TXF'?f.fetch[1]:Math.min(p.height-1,Math.max(0,Math.floor(v*p.height))));
  if(f.saturate)r=[0x3e800000,0x3f800000,0,0x3f800000];
  if(f.writeMask!=='xyzw')r=r.map((n,i)=>f.writeMask.includes('xyzw'[i])?n:f.initial[i]);
 }
 if(f.modifier==='negabs-swizzle')r=[r[2],r[1],r[0],r[3]].map(n=>((n&0x7fffffff)^0x80000000)>>>0);
 return r;
}
function fixture(format,stage,opcode,range,extra={}){
 const firstLevel=range==='full'?0:1,lastLevel=range==='full'?4:3,width=shrink(17,firstLevel),height=shrink(9,firstLevel),levels=lastLevel-firstLevel+1;
 const f={...format,stage,opcode,range,firstLevel,lastLevel,width,height,levels,slot:[0,3,15][format.format%3],frameWidth:8,frameHeight:8,lod:1,coord:[.375,.625,0,1],queryMask:'xyw',writeMask:'xyzw',initial:[11,22,33,44],...extra};
 f.fetch=[Math.min(1,shrink(width,f.lod)-1),Math.min(1,shrink(height,f.lod)-1),0,f.lod];
 f.planes=Array.from({length:levels},(_,l)=>plane(format,shrink(width,l),shrink(height,l),l,format.format+firstLevel,f.finite));
 f.selectors=zero();f.selectors[format.signed?'signedColorMask':'unsignedColorMask']=1;
 if(extra.colors)Object.assign(f.selectors,extra.colors);
 f.targets=Array.from({length:4},(_,i)=>f.selectors.signedColorMask&(1<<i)?'sint':f.selectors.unsignedColorMask&(1<<i)?'uint':i===0?'float':null);
 if(f.broadcast)f.targets=f.targets.map(t=>t??'float');
 if(f.sparse)f.targets=['float','sint',null,'uint'];
 const type=format.signed?'SINT':'UINT',register=f.broadcast?5:0;
 let prefix=stage==='vertex'?'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n':
   'FRAG\n'+(opcode==='TXB'?'DCL IN[0], GENERIC[0], PERSPECTIVE\n':'')+(f.sparse?'DCL OUT[5], COLOR[0]\nDCL OUT[2], COLOR[1]\nDCL OUT[7], COLOR[3]\n':`DCL OUT[${register}], COLOR\n`);
 if(f.broadcast)prefix+='PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\n';
 prefix+=`DCL TEMP[0]\nDCL SAMP[${f.slot}]\nDCL SVIEW[${f.slot}], 2D, ${type}\n`;
 let literals=opcode==='TXF'?`IMM[0] INT32 {${f.fetch.join(',')}}\n`:opcode==='TXQ'?`IMM[0] INT32 {${f.lod},0,0,0}\n`:`IMM[0] FLT32 {${f.coord.join(',')}}\n`;
 literals+=`IMM[1] UINT32 {${f.initial.join(',')}}\n`;
 if(opcode==='TXD')literals+=`IMM[2] FLT32 {${Math.fround(4/width)},0,0,0}\nIMM[3] FLT32 {0,${Math.fround(4/height)},0,0}\n`;
 const lines=['MOV TEMP[0], IMM[1]',`${opcode}${f.saturate?'_SAT':''}${f.precise?'_PRECISE':''} TEMP[0]${opcode==='TXQ'?'.'+f.queryMask:f.writeMask!=='xyzw'?'.'+f.writeMask:''}, ${opcode==='TXB'?'IN[0]':'IMM[0]'}, ${opcode==='TXD'?'IMM[2], IMM[3], ':''}SAMP[${f.slot}], 2D`];
 if(f.modifier==='negabs-swizzle')lines.push('MOV TEMP[0], -|TEMP[0].zyxw|');
 if(stage==='vertex')lines.push('MOV OUT[0], IN[0]');
 for(const index of stage==='vertex'?[1]:f.sparse?[5,2,7]:[register])lines.push(`MOV OUT[${index}], TEMP[0]`);
 lines.push('END');const text=prefix+literals+lines.map((s,i)=>`${i}: ${s}\n`).join('');
 f.vertexText=stage==='vertex'?text:opcode==='TXB'?varyingVertex:passVertex;
 f.fragmentText=stage==='fragment'?text:'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
 f.name=`${format.format}/${stage}/${opcode}/${range}/${extra.label??'base'}`;
 return f;
}
export function integerImageFixtures(){
 const result=[];
 for(const format of integerFormats)for(const stage of ['vertex','fragment'])for(const opcode of ['TEX','TXL','TXF','TXD','TXQ',...(stage==='fragment'?['TXB']:[])])for(const range of ['full','truncated'])result.push(fixture(format,stage,opcode,range));
 for(const signed of [false,true]){
  const format=integerFormats.find(f=>f.bits===32&&f.components===4&&f.signed===signed);
  for(const extra of [{label:'masked',writeMask:'xw',initial:[0xffffffff,0x80000000,0x7fc01234,0x3e800000]},
    {label:'word-modifier',modifier:'negabs-swizzle'}, {label:'SAT-finite-words',saturate:true,finite:true},
    {label:'PRECISE',precise:true}, {label:'query-w',queryMask:'w'},
    {label:'mixed-broadcast',finite:true,broadcast:true,colors:{signedColorMask:1,unsignedColorMask:10}},
    {label:'sparse-colors',finite:true,sparse:true,colors:{signedColorMask:2,unsignedColorMask:8}}])
   result.push(fixture(format,'fragment',extra.queryMask?'TXQ':'TXL','full',extra));
 }
 return result;
}
