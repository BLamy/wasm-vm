import {integerImageFixtures,positions as originalPositions,sampledWords} from '../virgl-integer-image-shader/fixtures.mjs';
import {originalFormat,source as originalSource,metadata} from '../virgl-command/standard-integer-image-fixtures.mjs';
import {packet,join,shader,word,sampler,imageView,surface,textureTransfer} from '../virgl-command/standard-image-fixtures.mjs';
export {packet,join,shader,word,sampler,imageView,surface,textureTransfer,metadata,originalFormat};
export const consumerFormat=number=>originalFormat(number)??(number===31?{bits:32,signed:false,components:4,guestPixelBytes:16}:null);
export const draw=()=>packet(8,0,[0,6,4,0,1,0,0,0,0,0,0xffffffff,0]);
export function integerClear(words){
 const wire=packet(7,0,[4,...words,0,0,0]);new DataView(wire.buffer).setFloat64(24,1,true);return wire;
}
function make(f,{outputFormat=f.signed?200:196,swizzle=[0,1,2,3],outputLevel=0}={}){
 const source=originalSource(f.format,17,9,4,0x3792+f.format);
 for(const p of f.planes)source.planes[f.firstLevel+p.level].input.set(p.bytes);
 for(const p of source.planes)for(let y=0;y<p.height;y++){
  const row=p.width*originalFormat(f.format).guestPixelBytes;
  source.backing.set(p.input.subarray(y*row,(y+1)*row),p.offset+y*p.stride);
 }
 const coords=f.opcode==='TXB',array=coords?new Float32Array(originalPositions.length*2):originalPositions.slice();
 if(coords)for(let i=0;i<originalPositions.length/4;i++){
  const p=originalPositions.subarray(i*4,i*4+4);array.set(p,i*8);array.set([(p[0]+1)/2,(p[1]+1)/2,0,f.lod],i*8+4);
 }
 const output=originalFormat(outputFormat),clearWords=output.signed?
  [0xffffffff,1,(-(2**(output.bits-1)))>>>0,2**(output.bits-1)-1]:[2**output.bits-1,2**(output.bits-1),1,0];
 return{name:f.name+'/consumer/'+outputFormat+'/view'+swizzle.join('')+'/target-level'+outputLevel,
  compilerFixture:f,source,vertex:f.vertexText,fragment:f.fragmentText,positions:new Uint8Array(array.buffer),
  stride:coords?32:16,coordinates:coords,stage:f.stage,opcode:f.opcode,slot:f.slot,width:f.frameWidth,height:f.frameHeight,
  firstLevel:f.firstLevel,lastLevel:f.lastLevel,swizzle,outputFormat,outputLevel,
  targetWidth:outputLevel?17:f.frameWidth,targetHeight:outputLevel?17:f.frameHeight,outputLastLevel:outputLevel?2:0,clearWords,
  parameters:{s:2,t:2,r:2,min:0,mip:0,mag:0,minLod:-1000,maxLod:1000}};
}
export function consumerCases({smoke=false}={}){
 const originals=integerImageFixtures().filter(f=>!f.broadcast&&!f.sparse),cases=[];
 for(const [i,f]of originals.entries()){
  if(smoke&&!(f.stage==='fragment'&&f.opcode==='TXF'&&f.range==='truncated'&&f.components===4&&f.bits===32))continue;
  cases.push(make(f,{swizzle:f.name.endsWith('/base')&&f.opcode!=='TXQ'&&i%3===1?[2,4,0,5]:[0,1,2,3]}));
 }
 if(!smoke)for(let format=177;format<=200;format++){
  const f=originals.find(f=>f.format===format&&f.stage==='fragment'&&f.opcode==='TXF'&&f.range==='full');
  cases.push(make(f,{outputFormat:format}));
  cases.push(make(f,{outputFormat:format,outputLevel:1,swizzle:[2,4,0,5]}));
 }
 if(!smoke)for(const format of [196,200]){
  const original=originals.find(f=>f.format===format&&f.stage==='fragment'&&f.opcode==='TXF'&&f.range==='full');
  const f=make(original);f.name+='/physical-out5';f.fragment=f.fragment.replaceAll('OUT[0]','OUT[5]');cases.push(f);
 }
 if(!smoke)for(const vertexFormat of [196,200]){
  const original=originals.find(f=>f.format===196&&f.stage==='fragment'&&f.name.endsWith('/masked')),
   f=make(original);f.name+='/typed-vertex-'+vertexFormat+'/original-UBO';f.vertexFormat=vertexFormat;
  f.fragment=f.fragment.replace('DCL TEMP[0]','DCL TEMP[0]\nDCL CONST[0..0]').replace('MOV TEMP[0], IMM[1]','MOV TEMP[0], CONST[0]');
  f.constants=new Uint8Array(16);new Uint32Array(f.constants.buffer).set(original.initial);cases.push(f);
 }
 if(!smoke){
  const original=originals.find(f=>f.format===196&&f.stage==='fragment'&&f.name.endsWith('/SAT-finite-words'));
  const f=make(original,{swizzle:[2,4,0,5]});f.name+='/selected-FLOAT-compatibility';
  f.source.metadata={...f.source.metadata,format:31};f.fragment=f.fragment.replace(', 2D, UINT',', 2D, FLOAT');
  f.outputFormat=31;f.clearWords=[0xbe800000,0x3e800000,0x40200000,0x3f800000];cases.push(f);
 }
 return cases;
}
export function setup(f){
 const elements=[3,0,0,0,f.vertexFormat??31,...(f.coordinates?[16,0,0,31]:[])];
 return join(textureTransfer(3,0,f.positions.length,1),...(f.constants?[textureTransfer(200,0,f.constants.length,1),packet(27,0,[1,0,0,f.constants.length,200])]:[]),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),
  shader(1,0,f.vertex),shader(2,1,f.fragment),packet(1,5,elements),packet(2,5,[3]),packet(6,0,[f.stride,0,3]),
  surface(4,1,f.outputFormat,f.outputLevel),packet(5,0,[1,0,4]),
  packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),
  packet(31,0,[1,0]),packet(31,0,[2,1]),integerClear(f.clearWords));
}
export function views(f){
 const stage=f.stage==='vertex'?0:1;
 return join(sampler(8,f.parameters),imageView(5,6,f.source.metadata.format,f.firstLevel,f.lastLevel,f.swizzle),
  packet(10,0,[stage,f.slot,5]),packet(18,0,[stage,f.slot,8]));
}
export const outputRead=f=>packet(43,0,[1,f.outputLevel,0,f.width*consumerFormat(f.outputFormat).guestPixelBytes+3,0,
  0,0,0,f.width,f.height,1,5,2]);
export function expectedFrame(f,kind){
 const output=consumerFormat(f.outputFormat),words=new Uint32Array(f.width*f.height*4);
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
  let lanes=kind==='clear'?f.clearWords:sampledWords(f.compilerFixture,x,y);
  if(kind!=='clear'&&f.opcode!=='TXQ')lanes=f.swizzle.map(k=>k===4?0:k===5?(f.source.metadata.format===31?0x3f800000:1):lanes[k]);
  lanes=lanes.map((word,lane)=>lane<output.components?word>>>0:lane===3?1:0);
  words.set(lanes,(y*f.width+x)*4);
 }
 return new Uint8Array(words.buffer);
}
export function fullMisses(actual,expected){
 const a=new Uint32Array(actual.buffer,actual.byteOffset,actual.byteLength/4),b=new Uint32Array(expected.buffer,expected.byteOffset,expected.byteLength/4),rows=[];
 if(a.length!==b.length)return[{observed:a.length,expected:b.length}];
 for(let i=0;i<a.length;i++)if(a[i]!==b[i])rows.push({at:i,observed:a[i],expected:b[i]});
 return rows;
}
