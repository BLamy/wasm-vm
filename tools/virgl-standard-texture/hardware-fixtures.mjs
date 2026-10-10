// Literal original TGSI, independent image planes and query expectations.
const selectors=()=>({signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0});
const position='DCL IN[0]\nDCL OUT[0], POSITION\n';
const vertexPass='VERT\n'+position+'DCL IN[1]\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
const fragmentPass='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const shrink=(n,level)=>Math.max(1,Math.floor(n/2**level));
const srgb=b=>{const n=b/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;};
function planes(kind,width,height,levels,seed){
 const result=[];
 for(let level=0;level<levels;level++){
  const w=shrink(width,level),h=shrink(height,level),bytes=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let lane=0;lane<4;lane++){
   const signed=[128,129,149,176,199,224,255,0,24,48,64,95,126,127];
   bytes[(y*w+x)*4+lane]=kind==='snorm'?signed[(x+3*y+2*level+lane*3+seed)%signed.length]:(x*29+y*43+level*59+lane*71+seed*11)%256;
  }
  result.push({level,width:w,height:h,bytes});
 }
 return result;
}
function texel(f,level,x,y){
 const p=f.planes[level],at=(y*p.width+x)*4;
 return Array.from(p.bytes.subarray(at,at+4),(b,lane)=>f.kind==='snorm'?Math.max(-1,(b>=128?b-256:b)/127):f.kind==='srgb'&&lane<3?srgb(b):b/255);
}
function sample(f,level,u,v){
 const p=f.planes[level];
 if(f.linear){const px=u*p.width-.5,py=v*p.height-.5,x0=Math.floor(px),y0=Math.floor(py),dx=px-x0,dy=py-y0;
  const clamp=(n,max)=>Math.max(0,Math.min(max-1,n)),a=texel(f,level,clamp(x0,p.width),clamp(y0,p.height)),b=texel(f,level,clamp(x0+1,p.width),clamp(y0,p.height)),c=texel(f,level,clamp(x0,p.width),clamp(y0+1,p.height)),d=texel(f,level,clamp(x0+1,p.width),clamp(y0+1,p.height));
  return a.map((n,i)=>(n*(1-dx)+b[i]*dx)*(1-dy)+(c[i]*(1-dx)+d[i]*dx)*dy);
 }
 return texel(f,level,Math.min(p.width-1,Math.max(0,Math.floor(u*p.width))),Math.min(p.height-1,Math.max(0,Math.floor(v*p.height))));
}
export function textureOperationFixtures(){
 const output=[];
 for(const stage of ['fragment','vertex'])for(const opcode of ['TXL','TXF','TXD','TXB','TXQ']){
  if(opcode==='TXB'&&stage==='vertex')continue;
  for(const slot of [0,3,15])for(const range of ['full','restricted'])for(const kind of opcode==='TXQ'?['unorm']:['unorm','snorm','srgb'])for(const linear of opcode==='TXQ'||opcode==='TXF'?[false]:[false,true]){
   const firstLevel=range==='full'?0:1,lastLevel=3,resourceWidth=17,resourceHeight=9,width=shrink(resourceWidth,firstLevel),height=shrink(resourceHeight,firstLevel),levels=lastLevel-firstLevel+1,seed=slot+3*(kind==='srgb'?2:kind==='snorm'?1:0);
   const f={name:`${stage}/${opcode}/slot${slot}/${range}/${kind}/${linear?'linear':'nearest'}`,stage,opcode,slot,range,kind,linear,resourceWidth,resourceHeight,firstLevel,lastLevel,width,height,levels,frameWidth:8,frameHeight:8,selectors:selectors(),planes:planes(kind,width,height,levels,seed),queryMask:'xyw'};
   const lod=opcode==='TXB'?1:opcode==='TXD'?2:1;f.lod=lod;f.coord=[.375,.625,0,lod];f.dx=[4/width,0,0,0];f.dy=[0,4/height,0,0];f.fetch=[Math.min(1,shrink(width,lod)-1),Math.min(1,shrink(height,lod)-1),0,lod];
   const declarations=(stage==='vertex'?'VERT\n'+position+'DCL OUT[1], GENERIC[0]\n':'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n')+`DCL TEMP[0]\nDCL SAMP[${slot}]\nDCL SVIEW[${slot}], 2D, FLOAT\n`;
   const words=opcode==='TXF'?`IMM[0] INT32 {${f.fetch.join(',')}}\n`:opcode==='TXQ'?`IMM[0] INT32 {${lod},0,0,0}\nIMM[1] UINT32 {11,22,33,44}\n`:`IMM[0] FLT32 {${f.coord.join(',')}}\n`;
   const extras=opcode==='TXD'?`IMM[1] FLT32 {${f.dx.map(n=>Math.fround(n).toString()).join(',')}}\nIMM[2] FLT32 {${f.dy.map(n=>Math.fround(n).toString()).join(',')}}\n`:'';
   const lines=[];
   if(opcode==='TXQ')lines.push('MOV TEMP[0], IMM[1]');
   lines.push(`${opcode} TEMP[0]${opcode==='TXQ'?'.'+f.queryMask:''}, ${opcode==='TXB'?'IN[0]':'IMM[0]'}, ${opcode==='TXD'?'IMM[1], IMM[2], ':''}SAMP[${slot}], 2D`);
   if(opcode==='TXQ')lines.push('U2F TEMP[0], TEMP[0]');
   if(stage==='vertex')lines.push('MOV OUT[0], IN[0]');
   lines.push(`MOV OUT[${stage==='vertex'?1:0}], TEMP[0]`,'END');
   const text=declarations+words+extras+lines.map((line,i)=>i+': '+line+'\n').join('');
   f.vertexText=stage==='vertex'?text:vertexPass;f.fragmentText=stage==='fragment'?text:fragmentPass;
   f.positions=new Float32Array([-1,-1,0,1, 1,-1,0,1, -1,1,0,1, -1,1,0,1, 1,-1,0,1, 1,1,0,1]);
   f.coordinates=new Float32Array([0,0,0,lod, 1,0,0,lod, 0,1,0,lod, 0,1,0,lod, 1,0,0,lod, 1,1,0,lod]);
   f.expected=(x,y)=>{
    if(opcode==='TXQ')return [shrink(width,lod),shrink(height,lod),33,levels];
    if(opcode==='TXF')return texel(f,lod,f.fetch[0],f.fetch[1]);
    const local=opcode==='TXB'?Math.min(levels-1,Math.max(0,Math.floor(Math.log2(Math.max(width/f.frameWidth,height/f.frameHeight))+lod+.5))):Math.min(levels-1,lod);
    return sample(f,local,opcode==='TXB'?(x+.5)/f.frameWidth:f.coord[0],opcode==='TXB'?(y+.5)/f.frameHeight:f.coord[1]);
   };
   output.push(f);
  }
 }
 // Query-only masks exercise optimized-out native samplers and untouched integer lanes.
 for(const base of output.filter(f=>f.opcode==='TXQ'&&f.slot===3))for(const mask of ['x','w']){
  const f={...base,name:base.name+'/mask'+mask,queryMask:mask};f.vertexText=f.vertexText.replace('TEMP[0].xyw,','TEMP[0].'+mask+',');f.fragmentText=f.fragmentText.replace('TEMP[0].xyw,','TEMP[0].'+mask+',');f.expected=()=>mask==='w'?[11,22,33,f.levels]:[shrink(f.width,f.lod),22,33,44];output.push(f);
 }
 for(const base of output.filter(f=>f.opcode==='TXL'&&f.slot===3&&f.range==='full'&&f.kind==='snorm'&&!f.linear)){
  const f={...base,name:base.name+'/saturated'};f.vertexText=f.vertexText.replace(': TXL ',': TXL_SAT ');f.fragmentText=f.fragmentText.replace(': TXL ',': TXL_SAT ');f.expected=(x,y)=>base.expected(x,y).map(n=>Math.max(0,Math.min(1,n)));output.push(f);
 }
 for(const base of output.filter(f=>f.opcode==='TXL'&&f.slot===3&&f.range==='full'&&f.kind==='unorm'&&!f.linear))for(const lod of [.25,1.75]){
  const f={...base,name:base.name+'/fractional'+lod,lod,coord:[...base.coord.slice(0,3),lod]};
  const before='IMM[0] FLT32 {'+base.coord.join(',')+'}',after='IMM[0] FLT32 {'+f.coord.join(',')+'}';
  f.vertexText=f.vertexText.replace(before,after);f.fragmentText=f.fragmentText.replace(before,after);
  f.expected=()=>sample(f,Math.floor(lod+.5),f.coord[0],f.coord[1]);output.push(f);
 }
 for(const base of output.filter(f=>['TXF','TXQ'].includes(f.opcode)&&f.slot===3&&f.range==='full'&&f.kind==='unorm'&&f.queryMask==='xyw'&&!f.name.includes('/mask'))){
  const f={...base,name:base.name+'/negated-source'},values=f.opcode==='TXF'?f.fetch:[f.lod,0,0,0];
  const before='IMM[0] INT32 {'+values.join(',')+'}',after='IMM[0] INT32 {'+values.map(n=>-n).join(',')+'}';
  f.vertexText=f.vertexText.replace(before,after).replace(', IMM[0], SAMP',', -IMM[0], SAMP');
  f.fragmentText=f.fragmentText.replace(before,after).replace(', IMM[0], SAMP',', -IMM[0], SAMP');output.push(f);
 }
 return output;
}
