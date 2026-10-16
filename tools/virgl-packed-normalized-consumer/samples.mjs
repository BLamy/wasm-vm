import {originalFormats,originalFormat,source as packedSource,originalValues} from '../virgl-command/standard-packed-normalized-fixtures.mjs';
import {packet,join,shader,word,imageView,sampler,surface,textureTransfer} from '../virgl-command/standard-byte-color-fixtures.mjs';
import {positions,clear,draw} from './fixtures.mjs';
export {originalFormats,originalFormat,packet,join,shader,word,imageView,sampler,surface,textureTransfer,positions,draw};
const lines=(decl,ops)=>decl.join('\n')+'\n'+ops.map((line,index)=>`${index}: ${line}\n`).join('');
// Exact endpoint colors make half-way filtering independent of hardware rounding.
function filteringEndpoints(format,source,level){
 const plane=source.planes[level],view=new DataView(plane.input.buffer),colors=[[0,0,1,0],[1,0,0,1],[1,1,0,0],[0,1,1,1]];
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  let packed=0;format.rgbaFields.forEach((field,lane)=>{packed|=(colors[y*2+x][lane]?(2**field.bits-1):0)<<field.offset;});
  const offset=(y*plane.width+x)*format.guestPixelBytes;
  if(format.guestPixelBytes===2)view.setUint16(offset,packed,true);else view.setUint32(offset,packed,true);
 }
 for(let y=0;y<plane.height;y++){const bytes=plane.width*format.guestPixelBytes;source.backing.set(plane.input.subarray(y*bytes,(y+1)*bytes),plane.offset+y*plane.stride);}
}
export function sampleCases({smoke=false,seed=0xd6412ac9}={}){
 const out=[];
 for(const format of originalFormats)for(const variant of smoke?['mip-fetch']:['base-fetch','mip-fetch','mip-lod','linear','vertex-lod','vertex-fetch','swizzle','constants']){
  const firstLevel=variant==='base-fetch'?0:1,lastLevel=firstLevel?3:0,
   stage=variant.startsWith('vertex')?'vertex':'fragment',opcode=variant.includes('fetch')?'TXF':variant==='linear'?'TEX':'TXL',
   linear=variant==='linear',lod=variant==='mip-lod'?1:0,slot=3,
   source=packedSource(format.originalFormat,17,9,3,(seed^format.originalFormat)>>>0),
   plane=source.planes[firstLevel+lod],coord=linear?[1/plane.width,1/plane.height,0,0]:[.5/plane.width,.5/plane.height,0,lod],
   swizzle=variant==='swizzle'?[2,4,0,5]:variant==='constants'?[4,5,3,1]:[0,1,2,3],
   decl=['DCL TEMP[0]',`DCL SAMP[${slot}]`,`DCL SVIEW[${slot}], 2D, FLOAT`,
    `IMM[0] FLT32 {${coord.join(',')}}`,`IMM[1] INT32 {0,0,0,${lod}}`],
   op=`${opcode} TEMP[0], ${opcode==='TXF'?'IMM[1]':'IMM[0]'}, SAMP[${slot}], 2D`,
   vertex=stage==='vertex'?lines(['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',...decl],['MOV OUT[0], IN[0]',op,'MOV OUT[1], TEMP[0]','END']):'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n',
   fragment=stage==='fragment'?lines(['FRAG','DCL OUT[0], COLOR',...decl],[op,'MOV OUT[0], TEMP[0]','END']):'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
  if(linear)filteringEndpoints(format,source,firstLevel);
  out.push({name:`packed-${format.originalFormat}/${variant}`,format:format.originalFormat,variant,source,stage,opcode,slot,firstLevel,lastLevel,lod,coord,swizzle,linear,width:5,height:3,outputLevel:0,outputLastLevel:2,targetWidth:5,targetHeight:3,outputFormat:31,positions,vertex,fragment,clearWords:[-.25,1.5,.375,.75].map(word),parameters:{s:2,t:2,r:2,min:Number(linear),mip:0,mag:Number(linear),minLod:-1000,maxLod:1000}});
 }
 return out;
}
export function setupSample(f){return join(textureTransfer(3,0,f.positions.length,1),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),shader(10,0,f.vertex),shader(11,1,f.fragment),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,31,0),packet(5,0,[1,0,20]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),clear(4,f.clearWords));}
export function viewsSample(f,handle=50){const stage=f.stage==='vertex'?0:1;return join(sampler(handle,f.parameters),imageView(handle+1,6,f.format,f.firstLevel,f.lastLevel,f.swizzle),packet(10,0,[stage,f.slot,handle+1]),packet(18,0,[stage,f.slot,handle]));}
export const readSample=f=>packet(43,0,[1,0,0,f.width*16+3,0,0,0,0,f.width,f.height,1,5,2]);
export function expectedSample(f){
 const p=f.source.planes[f.firstLevel+f.lod],values=originalValues(f.format,p.input);
 let selected=values.slice(0,4);
 if(f.linear){selected=[0,1,2,3].map(lane=>(values[lane]+values[4+lane]+values[p.width*4+lane]+values[(p.width+1)*4+lane])/4);}
 return f.swizzle.map(lane=>lane===4?0:lane===5?1:selected[lane]);
}
export function sampleMisses(native,expected,tolerance=0.000002){
 const values=new Float32Array(native.buffer,native.byteOffset,native.byteLength/4),rows=[];
 for(let at=0;at<values.length;at++)if(!Number.isFinite(values[at])||Math.abs(values[at]-expected[at%4])>tolerance){if(rows.length<16)rows.push({at,observed:values[at],expected:expected[at%4]});}return rows;
}
