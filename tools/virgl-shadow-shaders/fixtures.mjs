// Original shader, sampler and view bytes; never derived from emitted ESSL.
export {selectorKeys,zeroSelectors} from '../virgl-instance-base/fixtures.mjs';
import {zeroSelectors} from '../virgl-instance-base/fixtures.mjs';
export const passVertex='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
export const passFragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
export function shadowText(stage,{opcode='TEX',slot=0,declaration='2D',type='FLOAT',target='SHADOW2D',mask='',source='IN[1]',unused=false,query=null}={}){
 const d=[stage==='vertex'?'VERT':'FRAG'];
 if(stage==='vertex')d.push('DCL IN[0]','DCL IN[1]','DCL IN[2]','DCL IN[3]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]');
 else d.push('DCL IN[1], GENERIC[0], CONSTANT','DCL IN[2], GENERIC[1], CONSTANT','DCL IN[3], GENERIC[2], CONSTANT','DCL OUT[0], COLOR');
 d.push('DCL TEMP[0..1]',`DCL SAMP[${slot}]`,`DCL SVIEW[${slot}], ${declaration}, ${type}`,
  'IMM[0] UINT32 {305419896,2147483649,3735928559,4294967295}','IMM[1] INT32 {0,0,0,0}');
 const out=stage==='vertex'?'OUT[1]':'OUT[0]',ops=[];
 if(stage==='vertex')ops.push('MOV OUT[0], IN[0]');
 ops.push('MOV TEMP[0], IMM[0]');
 const sample=`${opcode} TEMP[0]${mask?'.'+mask:''}, ${opcode==='TXQ'?'IMM[1]':source}${opcode.startsWith('TXD')?', IN[2], IN[3]':''}, SAMP[${slot}], ${target}`;
 const size=`TXQ TEMP[1].xyw, IMM[1], SAMP[${slot}], ${query==='before-shadow'||query==='after-shadow'?'SHADOW2D':'2D'}`;
 if(query?.startsWith('before'))ops.push(size);
 if(!unused)ops.push(sample);
 if(query?.startsWith('after'))ops.push(size);
 ops.push(`MOV ${out}, TEMP[0]`);
 if(query)ops.push(`MOV ${out}.yzw, TEMP[1].xxyw`);
 ops.push('END');return d.join('\n')+'\n'+ops.map((s,i)=>i+': '+s+'\n').join('');
}
export function pairTexts(stage,options={}){
 if(stage==='vertex')return {vertexText:shadowText(stage,options),fragmentText:passFragment};
 const vertexText='VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: MOV OUT[2], IN[2]\n3: MOV OUT[3], IN[3]\n4: END\n';
 return {vertexText,fragmentText:shadowText(stage,options)};
}
export function shadowFixtures(){
 const rows=[],add=f=>{
  const pair=pairTexts(f.stage,f),selectors={...zeroSelectors(),unsignedColorMask:1};
  if(f.biasProbe)pair.fragmentText=pair.fragmentText.replace('GENERIC[0], CONSTANT','GENERIC[0], PERSPECTIVE');
  if(f.packed){selectors.packedSignedMask=2;selectors.packedNormalizedMask=2;}
  if(f.ids){
   const transform=text=>{
    const at=text.indexOf('0:'),decl=text.slice(0,at).replace('DCL OUT[0], POSITION','DCL IN[4]\nDCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION');
    const lines=text.slice(at).trim().split('\n').map(s=>s.replace(/^\d+: /,'')).filter(s=>s!=='END').map(s=>s==='MOV OUT[0], IN[0]'?'ADD OUT[0], IN[0], IN[4]':s);
    if(f.stage==='vertex'){lines.pop();lines.push('XOR TEMP[0], TEMP[0], SV[0]','XOR TEMP[0].x, TEMP[0], SV[1].xxxx','MOV OUT[1], TEMP[0]');}
    else{lines.push('MOV TEMP[2], SV[0]','XOR TEMP[2].x, TEMP[2], SV[1].xxxx','MOV OUT[4], TEMP[2]');}
    lines.push('END');return decl+(f.stage==='fragment'?'DCL OUT[4], GENERIC[3]\nDCL TEMP[2]\n':'')+lines.map((s,i)=>i+': '+s+'\n').join('');
   };
   pair.vertexText=transform(pair.vertexText);
   if(f.stage==='fragment')pair.fragmentText=pair.fragmentText.replace('DCL OUT[0], COLOR','DCL IN[4], GENERIC[3], CONSTANT\nDCL OUT[0], COLOR').replace(/(\d+): END\n/,(_,n)=>n+': XOR OUT[0], TEMP[0], IN[4]\n'+(+n+1)+': END\n');
  }
  rows.push({...f,...pair,selectors});
 };
 for(const stage of ['vertex','fragment'])for(const opcode of ['TEX','TXL','TXD','TXP',...(stage==='fragment'?['TXB']:[])])
  for(const slot of [0,7,15])for(const filter of ['nearest','linear'])for(const swizzle of [[0,1,2,3],[3,4,5,0]])for(let compareFunction=0;compareFunction<8;compareFunction++)
   add({name:`${stage}/${opcode}/slot${slot}/${filter}/swizzle${swizzle.join('')}/fn${compareFunction}`,stage,opcode,slot,filter,swizzle,compareFunction});
 for(const stage of ['vertex','fragment'])for(const query of ['before','after','before-shadow','after-shadow'])
  add({name:`${stage}/query/${query}`,stage,opcode:'TEX',slot:7,filter:'nearest',swizzle:[0,1,2,5],compareFunction:2,query});
 for(const stage of ['vertex','fragment'])for(const mask of ['x','y','z','w','xz','yw'])
  add({name:`${stage}/write-mask/${mask}`,stage,opcode:'TEX',mask,slot:15,filter:'linear',swizzle:[3,4,5,0],compareFunction:3});
 for(const stage of ['vertex','fragment'])for(const source of ['IN[1].wzyx','-|IN[1].xyzw|','|IN[1].xyzw|'])
  add({name:`${stage}/source/${source}`,stage,opcode:'TEX',source,slot:0,filter:'nearest',swizzle:[0,5,4,2],compareFunction:4});
 for(const filter of ['nearest','linear'])add({name:'fragment/bias-2/'+filter,stage:'fragment',opcode:'TXB',slot:7,filter,swizzle:[0,1,2,3],compareFunction:2,biasProbe:true});
 for(const stage of ['vertex','fragment']){
  add({name:stage+'/raw-ids-and-shadow',stage,opcode:'TEX',slot:7,filter:'nearest',swizzle:[0,4,5,3],compareFunction:3,ids:true,base:0xfffffffe});
  add({name:stage+'/packed-SNORM-and-shadow',stage,opcode:'TEX',slot:15,filter:'linear',swizzle:[3,0,4,5],compareFunction:4,packed:true});
 }
 return rows;
}
export function originalSamplerWords(f){
 return [(9<<16)|(7<<8)|1,77,2|(2<<3)|(2<<6)|(Number(f.filter==='linear')<<9)|(Number(f.filter==='linear')<<13)|(1<<15)|(f.compareFunction<<16),0,0,0x40000000,0,0,0,0];
}
export function originalViewWords(f){return [(6<<16)|(6<<8)|1,88,44,18|(2<<24),0,2<<8,f.swizzle.reduce((word,lane,i)=>word|(lane<<(3*i)),0)];}
export function inputBytes(f){
 if(f.biasProbe){
  const positions=new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),coordinates=new Float32Array([.125,.25,.5,2,.625,.25,.5,2,.125,.75,.5,2,.125,.75,.5,2,.625,.25,.5,2,.625,.75,.5,2]);
  return {width:4,height:4,positions:new Uint8Array(positions.buffer),coordinates:new Uint8Array(coordinates.buffer),dx:new Uint8Array(96),dy:new Uint8Array(96),levels:[4,2,1].map((width,level)=>{const height=Math.max(1,2>>level);return{level,width,height,bytes:new Uint8Array(new Float32Array(width*height).fill([.5,.25,.75][level]).buffer)};})};
 }
 const width=3,height=3,positions=[],coordinates=[],dx=[],dy=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  positions.push(2*(x+.5)/width-1,2*(y+.5)/(f.ids?9:height)-1,0,1);
  const q=f.opcode==='TXP'?2:1,ref=[.25,.5,.75][x];
  coordinates.push(.25*q,.75*q,ref*q,f.opcode==='TXP'?q:f.opcode==='TXL'?y:0);
  dx.push((2**y)/4,0,0,0);dy.push(0,0,0,0);
 }
 const constant=!['TXL','TXD'].includes(f.opcode);
 const levels=[4,2,1].map((width,level)=>{const height=Math.max(1,2>>level),value=constant?.5:[.25,.5,.75][level];return {level,width,height,bytes:new Uint8Array(new Float32Array(width*height).fill(value).buffer)};});
 const packed=new Uint32Array(9);for(let i=0;i<9;i++)packed[i]=(256|(256<<10)|([512,511,0][i%3]<<20)|(1<<30))>>>0;
 return {width,height:f.ids?9:height,positions:new Uint8Array(new Float32Array(positions).buffer),coordinates:f.packed?new Uint8Array(packed.buffer):new Uint8Array(new Float32Array(coordinates).buffer),dx:new Uint8Array(new Float32Array(dx).buffer),dy:new Uint8Array(new Float32Array(dy).buffer),...(f.ids?{offsets:new Uint8Array(new Float32Array([0,0,0,0,0,2/3,0,0,0,4/3,0,0]).buffer)}:{}),levels};
}
export function expectedWords(f,x,y){
 const instance=f.ids?Math.floor(y/3):0;y%=3;
 let source=[.25,.75,[.25,.5,.75][x],f.opcode==='TXL'?y:0];
 if(f.opcode==='TXP')source=source.map((v,i)=>i<3?v*2:2);
 if(f.source==='IN[1].wzyx')source=source.reverse();
 if(f.source?.startsWith('-|'))source=source.map(v=>-Math.abs(v));
 if(f.source?.startsWith('|'))source=source.map(Math.abs);
 const ref=f.packed?[-1,1,0][x]:f.biasProbe?.5:f.opcode==='TXP'?source[2]/source[3]:source[2],depth=f.biasProbe?.25:['TXL','TXD'].includes(f.opcode)?[.25,.5,.75][y]:.5;
 const comparisons=[false,ref<depth,ref===depth,ref<=depth,ref>depth,ref!==depth,ref>=depth,true],value=Number(comparisons[f.compareFunction]);
 const words=f.swizzle.map(lane=>new Uint32Array(new Float32Array([lane===4?0:lane===5?1:value]).buffer)[0]);
 const out=[0x12345678,0x80000001,0xdeadbeef,0xffffffff];
 for(let lane=0;lane<4;lane++)if(!f.mask||f.mask.includes('xyzw'[lane]))out[lane]=words[lane];
 if(f.query){out[1]=4;out[2]=2;out[3]=3;}
 if(f.ids)for(let lane=0;lane<4;lane++)out[lane]=(out[lane]^((f.base+instance)>>>0)^(lane===0?y*3+x:0))>>>0;
 return out;
}
