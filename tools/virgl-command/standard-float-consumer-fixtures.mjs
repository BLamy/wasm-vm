// Complete literal original packets and TGSI programs. Predictions decode
// public input bits and view parameters, without emitted ESSL or runtime tables.
import{originalFormats,wordValue,source as rawSource,metadata}from'./standard-float-image-fixtures.mjs';
import{packet,join,meta,shader,clear,sampler,word,imageView,surface,textureTransfer,hex}from'./standard-byte-color-fixtures.mjs';
export{packet,join,meta,shader,clear,sampler,word,imageView,surface,textureTransfer,hex};
const lines=(decl,ops)=>decl.join('\n')+'\n'+ops.map((line,index)=>`${index}: ${line}\n`).join('');
export function floatCases({smoke=false}={}){
 const result=[];
 for(const p of originalFormats)for(const stage of ['vertex','fragment'])for(const opcode of smoke?['TXL']:['TEX','TXL','TXF','TXD','TXB','TXQ']){
  if(stage==='vertex'&&opcode==='TXB')continue;
  for(const linear of smoke?[false]:[false,true])for(const swizzle of smoke?[[0,1,2,3]]:[[0,1,2,3],[2,4,0,5]]){
   const src=rawSource(p.format,17,9,3,17),values=p.precision===16?[0xbc00,0x3c00,0x4000,0xc200,0x3800,0x4400,0xb800,0x3000]:[0xbf800000,0x3f80040c,0x40000000,0xc0400123,0x3f000000,0x40800000,0xbeabdcef,0x3e000000];
   for(const plane of src.planes){const data=new DataView(plane.input.buffer);for(let index=0;index<plane.input.length/(p.precision/8);index++){const bits=values[(index*3+plane.level*5)%values.length];p.precision===16?data.setUint16(index*2,bits,true):data.setUint32(index*4,bits,true);}for(let row=0;row<plane.height;row++){const size=plane.width*p.components*p.precision/8;src.backing.set(plane.input.subarray(row*size,(row+1)*size),plane.offset+row*plane.stride);}}
   const firstLevel=1,lastLevel=3,slot=3,lod=1,coord=[.3125,.46875,0,lod],out=stage==='vertex'?1:0,decl=['DCL TEMP[0..2]',`DCL SAMP[${slot}]`,`DCL SVIEW[${slot}], 2D, FLOAT`,'IMM[0] FLT32 {0.3125,0.46875,0,1}','IMM[1] INT32 {1,1,0,1}','IMM[2] FLT32 {0.25,0,0,0}','IMM[3] FLT32 {0,0.25,0,0}'];
   let ops;
   if(opcode==='TXD')ops=['TXD TEMP[0], IMM[0], IMM[2], IMM[3], SAMP[3], 2D'];
   else if(opcode==='TXQ')ops=['MOV TEMP[0], IMM[2]','TXQ TEMP[0].xyw, IMM[1], SAMP[3], 2D','U2F TEMP[0], TEMP[0]'];
   else ops=[`${opcode} TEMP[0], ${opcode==='TXF'?'IMM[1]':'IMM[0]'}, SAMP[3], 2D`];
   const vertex=stage==='vertex'?lines(['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',...decl],['MOV OUT[0], IN[0]',...ops,`MOV OUT[${out}], TEMP[0]`,'END']):'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
   const fragment=stage==='fragment'?lines(['FRAG','DCL OUT[0], COLOR',...decl],[...ops,`MOV OUT[${out}], TEMP[0]`,'END']):'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
   const positions=new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1]).buffer),f={name:`${p.format}/${stage}/${opcode}/${linear? 'linear':'nearest'}/view${swizzle.join('')}`,width:7,height:5,outputFormat:31,precision:p.precision,components:p.components,stage,opcode,slot,source:src,firstLevel,lastLevel,linear,lod,coord,swizzle,positions,vertex,fragment,selectors:{signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0},parameters:{s:2,t:2,r:2,min:Number(linear),mip:0,mag:Number(linear),minLod:-1000,maxLod:1000}};result.push(f);
  }
 }
 for(const f of [...result].filter(f=>f.opcode==='TXL'&&!f.linear&&f.swizzle[0]===0)){const src=rawSource(f.source.metadata.format,17,9,4,17);for(const plane of src.planes){plane.input.set(plane.level<=3?f.source.planes[plane.level].input:f.source.planes[0].input.subarray(0,plane.input.length));const rowBytes=plane.width*f.components*f.precision/8;for(let row=0;row<plane.height;row++)src.backing.set(plane.input.subarray(row*rowBytes,(row+1)*rowBytes),plane.offset+row*plane.stride);}result.push({...f,name:f.name+'/full-source',source:src,lastLevel:4});}
 return result;
}
export function setup(f){return join(textureTransfer(3,0,f.positions.length,1),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),shader(1,0,f.vertex),shader(2,1,f.fragment),packet(1,5,[3,0,0,0,31]),packet(2,5,[3]),packet(6,0,[16,0,3]),surface(4,1,f.outputFormat,f.outputLevel??0),packet(5,0,[1,0,4]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear(f.clearColor??[-.5,.25,2,1]));}
export function views(f){const stage=f.stage==='vertex'?0:1;return join(sampler(8,f.parameters),imageView(5,6,f.source.metadata.format,f.firstLevel,f.lastLevel,f.swizzle),packet(10,0,[stage,f.slot,5]),packet(18,0,[stage,f.slot,8]));}
export const draw=()=>packet(8,0,[0,6,4,0,1,0,0,0,0,0,0xffffffff,0]);
export function texel(f,level,x,y){const plane=f.source.planes[f.firstLevel+level],data=new DataView(plane.input.buffer),size=f.precision/8;return Array.from({length:4},(_,lane)=>lane<f.components?wordValue(f.precision,size===2?data.getUint16(((y*plane.width+x)*f.components+lane)*size,true):data.getUint32(((y*plane.width+x)*f.components+lane)*size,true)):lane===3?1:0);}

export function outputCases(){const cases=floatCases(),result=[];for(const p of originalFormats)for(const mip of [false,true]){const template=cases.find(f=>f.source.metadata.format===(p.precision===16?94:31)&&f.stage==='fragment'&&f.opcode==='TXL'&&f.linear&&f.swizzle[0]===0),f={...template,name:`output-${p.format}/${mip?'mip':'base'}`,outputFormat:p.format,outputLevel:mip?1:0,outputLastLevel:mip?3:0,targetWidth:mip?15:7,targetHeight:mip?11:5,clearColor:[-1.25,2.5,-.125,-2],parameters:{...template.parameters,mip:1},vertex:template.vertex,fragment:template.fragment.replace('{0.3125,0.46875,0,1}',p.precision===16?'{0.375,0.25,0,1.5}':'{0.3125,0.46875,0,1.5}')};result.push(f);}return result;}
export function blendState(handle,enabled=true,mask=15){const flags=Number(enabled)|(Number(enabled)<<4)|(Number(enabled)<<9)|(Number(enabled)<<17)|(Number(enabled)<<22)|(mask<<27);return join(packet(1,1,[handle,0,0,flags,0,0,0,0,0,0,0]),packet(2,1,[handle]));}
export const outputRead=f=>packet(43,0,[1,f.outputLevel??0,0,f.width*originalFormats.find(p=>p.format===f.outputFormat).components*originalFormats.find(p=>p.format===f.outputFormat).precision/8+3,0,0,0,0,f.width,f.height,1,5,2]);
