// Original depth/view fields and analytic comparison predictions; no renderer imports.
import {comparisonFixtures,pairTexts} from '../virgl-dimensional-shadow-shaders/fixtures.mjs';
import {packet,join,shader,word,sampler,surface} from '../virgl-command/standard-image-fixtures.mjs';
export {packet,join,shader,word,sampler,surface};
export const profile='virgl-webgl2-standard-dimensional-shadow-texture-gles3-v1';
export const formats=[16,18,20,21,126],keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
export const targetNumber=target=>target==='CUBE'?4:target==='2D'?2:7;
export const pixelBytes=format=>format===16?2:format===126?8:4;
export const metadata=(id,target,format,bind,width,height,depth=1,arraySize=1,lastLevel=0)=>({id,target,format,bind,width,height,depth,arraySize,lastLevel,nrSamples:0,flags:0});
const op=f=>f.opcode.replace(/_SAT|_PRECISE/g,''),directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],neighbors=[-2,-.49,.49,.51,1.49,1.51,3.49,3.51,4.49,8];
export const comparison=f=>!f.ordinary;
export function cases({smoke=false}={}){
 const core=comparisonFixtures().filter(f=>smoke?f.opcode==='TEX'&&f.slot===7&&!f.explicit&&!f.label:
  f.slot===7||f.mask||f.source||f.opcode.includes('_')||f.query||f.layerProbe);
 const rows=core.flatMap(f=>formats.map(format=>({...f,format,firstLevel:smoke?1:f.baseLevel??0,lastLevel:2,baseLevel:undefined,swizzle:f.mask?[3,4,5,0]:[0,1,2,3],compareFunction:3,name:`original/${f.name}/format${format}`})));
 if(smoke)return rows;
 for(const stage of ['vertex','fragment'])for(const target of ['CUBE','2D_ARRAY'])for(const format of formats){
  for(const compareFunction of [0,1,2,3,4,5,6,7])for(const endpoint of ['lower','upper'])rows.push({name:`endpoint/${stage}/${target}/${format}/fn${compareFunction}/${endpoint}`,stage,target,format,opcode:'TEX',slot:15,compareFunction,endpoint,firstLevel:1,lastLevel:2,swizzle:[3,0,4,5]});
  for(const linear of [true])for(const opcode of ['TEX','TXD'])rows.push({name:`linear/${stage}/${target}/${format}/${opcode}`,stage,target,format,opcode,slot:0,compareFunction:3,linear,firstLevel:0,lastLevel:2,swizzle:[0,5,4,3]});
  if(target==='2D_ARRAY')rows.push({name:`private/${stage}/${format}/layers1-3`,stage,target,format,opcode:'TXD',slot:7,compareFunction:3,firstLevel:1,lastLevel:2,firstLayer:1,lastLayer:3,layerProbe:true,swizzle:[0,1,2,3]});
  rows.push({name:`sampler-only/${stage}/${target}/${format}`,stage,target,format,opcode:'TEX',slot:7,compareFunction:3,firstLevel:0,lastLevel:2,bind:8,swizzle:[0,1,2,3]});
 }
 return rows;
}
export function localExtent(f,level){const original=f.firstLevel+level;return {width:Math.max(1,Math.floor(f.width/2**original)),height:Math.max(1,Math.floor(f.height/2**original)),layers:f.target==='CUBE'?6:f.lastLayer-f.firstLayer+1};}
function field(f,level,layer,x,y){
 if(f.gpuOverride?.[level+':'+layer])return f.gpuOverride[level+':'+layer][0];
 if(f.endpoint)return f.endpoint==='lower'?0:1;
 const term=f.linear?0:y*4+x;
 return .0625+(level*128+layer*16+term+(f.seed&31))/1024;
}
function quantized(f,value){return f.format===16?Math.fround(Math.round(value*65535)/65535):[20,21].includes(f.format)?Math.fround(Math.round(value*16777215)/16777215):Math.fround(value);}
function writeDepth(f,dv,at,value,stencil,ignored){
 if(f.format===16)dv.setUint16(at,Math.round(value*65535),true);
 else if(f.format===20)dv.setUint32(at,((Math.round(value*16777215)<<8)|stencil)>>>0,true);
 else if(f.format===21)dv.setUint32(at,(Math.round(value*16777215)|(ignored&0xff000000))>>>0,true);
 else{dv.setFloat32(at,value,true);if(f.format===126)dv.setUint32(at+4,(ignored&0xffffff00)|stencil,true);}
}
function location(f,c,level){
 const e=localExtent(f,level);let layer,u=c[0],v=c[1];
 if(f.target==='CUBE'){
  const major=Math.max(...c.slice(0,3).map(Math.abs)),axis=c.slice(0,3).findIndex(v=>Math.abs(v)===major);layer=axis*2+Number(c[axis]<0);
  const [a,b]=axis===0?[c[0]>0?-c[2]:c[2],-c[1]]:axis===1?[c[0],c[1]>0?c[2]:-c[2]]:[c[2]>0?c[0]:-c[0],-c[1]];
  u=(a/major+1)/2;v=(b/major+1)/2;
 }else layer=f.target==='2D'?0:Math.max(0,Math.min(e.layers-1,Math.floor(c[2]+.5)))+f.firstLayer;
 return {layer,x:Math.max(0,Math.min(e.width-1,Math.floor(u*e.width))),y:Math.max(0,Math.min(e.height-1,Math.floor(v*e.height)))};
}
function coordinates(f,x,y){
 if(op(f)==='TXQ')return [y,0,0,0];
 const level=op(f)==='TXD'?y:0,e=localExtent(f,level),layer=f.target==='CUBE'?x%6:Math.max(0,Math.min(e.layers-1,f.layerProbe?Math.floor(neighbors[x]+.5):Math.floor(x*e.layers/f.grid.width)));
 let c=f.target==='CUBE'?[...directions[layer].map(v=>v*(f.scale??1)),0]:[.625,.375,f.layerProbe?neighbors[x]:layer,0];
 const point=location(f,c,level),depth=quantized(f,field(f,f.firstLevel+level,point.layer,point.x,point.y));
 const offset=[-1/8192,0,1/8192][(x+y)%3];
 c[3]=f.endpoint?(f.endpoint==='lower'?[-.25,0,.25]:[.75,1,1.25])[(x+y)%3]:depth+(offset===0&&[16,20,21].includes(f.format)?1/8192:offset);
 if(f.target==='2D'){c[2]=c[3];c[3]=0;}
 if(f.source?.endsWith('wzyx'))c=c.toReversed();
 if(f.source?.startsWith('|'))c=c.map(v=>-Math.abs(v));
 return c.map(Math.fround);
}
function modified(f,c){if(f.source?.endsWith('wzyx'))c=c.toReversed();if(f.source?.startsWith('|'))c=c.map(Math.abs);if(f.source?.startsWith('-|'))c=c.map(v=>-Math.abs(v));return c;}
export function fixture(spec){
 const f={width:4,height:4,arraySize:5,firstLevel:0,lastLevel:2,firstLayer:0,slot:7,seed:0,swizzle:[0,1,2,3],compareFunction:3,...spec};
 f.lastLayer=spec.lastLayer??(f.target==='CUBE'?5:f.arraySize-1);f.sourceExpression=f.source;f.source=metadata(6,targetNumber(f.target),f.format,f.bind??9,f.width,f.height,1,f.target==='CUBE'?6:f.arraySize,2);
 f.levels=Array.from({length:3},(_,level)=>{
  const width=Math.max(1,f.width>>level),height=Math.max(1,f.height>>level),layers=f.source.arraySize,bytes=new Uint8Array(width*height*layers*pixelBytes(f.format)),dv=new DataView(bytes.buffer);
  for(let z=0;z<layers;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++)writeDepth(f,dv,((z*height+y)*width+x)*pixelBytes(f.format),field(f,level,z,x,y),(f.seed+level*29+z*73+x+y)&255,Math.imul(f.seed+z+x+y+1,0x45d9f3b)>>>0);
  return {level,width,height,layers,bytes};
 });
 f.grid={width:f.biasProbe?4:f.layerProbe?neighbors.length:6,height:f.biasProbe?4:f.lastLevel-f.firstLevel+1};
 const positions=[],coords=[],dx=[],dy=[],base=localExtent(f,0);
 if(f.biasProbe){for(const[x,y]of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]]){
  positions.push(2*x-1,2*y-1,0,1);const face=f.face??0,c=directions[face].map((v,axis)=>v||(axis===(face<2?2:0)?2*x-1:0));coords.push(...c,.25);dx.push(f.bias??2,0,0,0);dy.push(0,0,0,0);
 }}else for(let y=0;y<f.grid.height;y++)for(let x=0;x<f.grid.width;x++){
  positions.push(2*(x+.5)/f.grid.width-1,2*(y+.5)/f.grid.height-1,0,1);coords.push(...coordinates({...f,source:f.sourceExpression},x,y));
  if(f.target==='CUBE')dx.push(...(x%6<2?[0,0,(f.scale??1)*2**(y+1)/base.width]:[(f.scale??1)*2**(y+1)/base.width,0,0]),0);
  else dx.push(2**y/base.width,0,f.derivativeZ??99,0);dy.push(0,0,0,0);
 }
 const Constructor=op(f)==='TXQ'?Uint32Array:Float32Array;
 f.inputs=[new Uint8Array(new Float32Array(positions).buffer),new Uint8Array(new Constructor(coords).buffer),new Uint8Array(new Float32Array(dx).buffer),new Uint8Array(new Float32Array(dy).buffer)];
 Object.assign(f,pairTexts(f.stage,{...f,source:f.sourceExpression}));
 const append=(text,lines)=>{const at=text.indexOf('0:'),ops=text.slice(at).trim().split('\n').map(s=>s.replace(/^\d+: /,''));ops.pop();return text.slice(0,at)+[...ops,...lines,'END'].map((s,i)=>i+': '+s+'\n').join('');};
 if(f.sameImage){
  const key=f.stage==='vertex'?'vertexText':'fragmentText',out=f.stage==='vertex'?'OUT[1]':'OUT[0]';
  let text=f[key].replace('DCL TEMP[0..1]',`DCL SAMP[0]\nDCL SVIEW[0], ${f.target}, FLOAT\nDCL TEMP[0..1]`)
   .replace('IMM[1] INT32 {0,0,0,0}','IMM[1] INT32 {0,0,0,0}\nIMM[2] FLT32 {1,0,0,0}');
  f[key]=append(text,[`TEX TEMP[1], IN[1], SAMP[0], ${f.target}`,`MOV ${out}.y, TEMP[1].xxxx`,`MOV ${out}.z, IMM[1].xxxx`,`MOV ${out}.w, IMM[2].xxxx`]);
  f.extraViews=[{fixture:{...f},handle:53,stateHandle:52,slot:0,stage:f.stage,mode:0,swizzle:[0,0,4,5]}];
  f.expectedSamplers={[(f.stage==='vertex'?'vs':'fs')+'samp0']:{target:f.source.target,last:2,comparison:false,compareFunction:f.compareFunction,swizzle:[0,0,4,5]}};
 }
 if(f.crossStage){
  f.vertexText=append(f.vertexText.replace('DCL IN[3]',`DCL IN[3]\nDCL TEMP[0]\nDCL SAMP[7]\nDCL SVIEW[7], ${f.target}, FLOAT`)
   .replace('DCL OUT[3], GENERIC[2]','DCL OUT[3], GENERIC[2]\nDCL OUT[4], GENERIC[3]'),[`TEX OUT[4], IN[1], SAMP[7], SHADOW${f.target}`]);
  f.fragmentText=append(f.fragmentText.replace('DCL OUT[0], COLOR','DCL IN[4], GENERIC[3], CONSTANT\nDCL OUT[0], COLOR'),['XOR OUT[0], TEMP[0], IN[4]']);
  f.extraViews=[{fixture:{...f},handle:53,stateHandle:52,slot:7,stage:'vertex',compareFunction:4,swizzle:[5,0,4,1]}];
  f.expectedSamplers={vssamp7:{target:f.source.target,last:2,comparison:true,compareFunction:4,swizzle:[5,0,4,1]}};
 }
 if(f.pruned){
  const key=f.stage==='vertex'?'vertexText':'fragmentText',out=f.stage==='vertex'?'OUT[1]':'OUT[0]';
  // Omit the lookup itself: driver reflection may retain a declaration when
  // only its result becomes dead, so dead-result optimization is not authority.
  const text=f[key].replace(/^\d+: TEX TEMP\[0\][^\n]*\n/m,'').replace(`MOV ${out}, TEMP[0]`,`MOV ${out}, IMM[0]`),at=text.indexOf('0:');
  f[key]=text.slice(0,at)+text.slice(at).trim().split('\n').map((s,i)=>i+': '+s.replace(/^\d+: /,'')+'\n').join('');
 }
 return f;
}
const compare=(reference,depth,fn)=>Number([false,reference<depth,reference===depth,reference<=depth,reference>depth,reference!==depth,reference>=depth,true][fn]);
export function expected(f){
 const words=new Uint32Array(f.grid.width*f.grid.height*4),original={...f,source:f.sourceExpression};
 for(let y=0;y<f.grid.height;y++)for(let x=0;x<f.grid.width;x++){
  const opcode=op(f),level=opcode==='TXQ'||opcode==='TXD'?y:f.biasProbe?(f.bias===0?0:f.lastLevel-f.firstLevel):0,e=localExtent(f,level);let lanes;
  if(opcode==='TXQ')lanes=[e.width,e.height,f.target==='CUBE'?0:e.layers,f.lastLevel-f.firstLevel+1];
  else{
   const attributes=new DataView(f.inputs[1].buffer,f.inputs[1].byteOffset,f.inputs[1].byteLength),offset=(y*f.grid.width+x)*16;
   const c=f.biasProbe?[...directions[f.face??0],.25]:modified(original,Array.from({length:4},(_,lane)=>attributes.getFloat32(offset+lane*4,true)));
   const p=f.biasProbe?{layer:f.face??0,x:0,y:0}:location(f,c,level),depth=quantized(f,field(f,f.firstLevel+level,p.layer,p.x,p.y));
   const reference=c[f.target==='2D'?2:3],ref=[16,20,21].includes(f.format)?Math.max(0,Math.min(1,reference)):reference,sample=f.ordinary?[depth,0,0,1]:Array(4).fill(compare(ref,depth,f.compareFunction));
   lanes=f.swizzle.map(k=>word(k===4?0:k===5?1:sample[k]));
   if(f.sameImage)lanes=[lanes[0],word(depth),0,word(1)];
   if(f.crossStage){const v=compare(ref,depth,4),other=[word(1),word(v),0,word(v)];lanes=lanes.map((value,lane)=>(value^other[lane])>>>0);}
  }
  const output=[0x12345678,0x80000001,0xdeadbeef,0xffffffff];for(let lane=0;lane<4;lane++)if(!f.mask||f.mask.includes('xyzw'[lane]))output[lane]=lanes[lane];
  if(f.query){const q=localExtent(f,0);output[1]=q.height;output[2]=f.target==='CUBE'?0:q.layers;output[3]=f.lastLevel-f.firstLevel+1;}
  if(f.pruned)output.splice(0,4,0x12345678,0x80000001,0xdeadbeef,0xffffffff);
  words.set(output,(y*f.grid.width+x)*4);
 }
 return new Uint8Array(words.buffer);
}
export function view(f,{handle=51,resource=6,target=targetNumber(f.target),format=f.format,first=f.firstLevel,last=f.lastLevel,firstLayer=f.firstLayer,lastLayer=f.lastLayer,swizzle=f.swizzle,stage=f.stage,slot=f.slot,stateHandle=50,mode=Number(comparison(f)),compareFunction=f.compareFunction}={}){
 return join(sampler(stateHandle,{s:2,t:2,r:2,min:Number(Boolean(f.linear)),mag:Number(Boolean(f.linear)),mip:0,compare:mode,compareFunction,minLod:0,maxLod:1000}),
  packet(1,6,[handle,resource,format|target<<24,firstLayer|lastLayer<<16,first|last<<8,swizzle.reduce((n,k,i)=>n|k<<i*3,0)]),packet(10,0,[stage==='vertex'?0:1,slot,handle]),packet(18,0,[stage==='vertex'?0:1,slot,stateHandle]));
}
export function setup(f){return join(shader(10,0,f.vertexText),shader(11,1,f.fragmentText),packet(1,5,[12,...f.inputs.flatMap((_,i)=>[0,0,i,i===1&&op(f)==='TXQ'?196:31])]),packet(2,5,[12]),packet(6,0,f.inputs.flatMap((_,i)=>[16,0,[3,4,5,7][i]])),surface(20,1,196,0),packet(5,0,[1,0,20]),packet(4,0,[0,...[f.grid.width/2,f.grid.height/2,.5,f.grid.width/2,f.grid.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]));}
export const draw=f=>packet(8,0,[0,f.inputs[0].length/16,f.biasProbe?4:0,0,1,0,0,0,0,0,0xffffffff,0]);
