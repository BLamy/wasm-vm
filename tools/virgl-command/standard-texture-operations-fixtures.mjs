/** Literal original shaders, packets and complete retained source planes. */
import {textureOperationFixtures} from '../virgl-standard-texture/hardware-fixtures.mjs';
import {packet,join,meta,shader,clear,sampler,word,imageView,surface,textureTransfer,hex,unhex,originalFormat,expectedNativeRead as colorNativeRead} from './standard-byte-color-fixtures.mjs';
export {packet,join,meta,shader,clear,sampler,word,imageView,surface,textureTransfer,hex,unhex,originalFormat};
export const expectedNativeRead=(format,input)=>format===67?input.slice():colorNativeRead(format,input);
export const nativeFormat=kind=>kind==='snorm'?77:kind==='srgb'?104:67;
const numbered=text=>text.replace(/^\d+: /gm,'').trim().split('\n');
function scaleResult(text,f){
 const lines=numbered(text),start=lines.findIndex(l=>/^(MOV|TEX|TX[LFDBQ]|U2F|END)\b/.test(l));
 const declarations=lines.slice(0,start),operations=lines.slice(start);
 const output=f.stage==='vertex'?1:0,at=operations.indexOf(`MOV OUT[${output}], TEMP[0]`),imm=declarations.filter(l=>/^IMM\[/.test(l)).length;
 if(f.opcode==='TXQ'){
  declarations.push(`IMM[${imm}] FLT32 {0.03125,0.03125,0.015625,0.015625}`);
  operations.splice(at,0,`MUL TEMP[0], TEMP[0], IMM[${imm}]`);
 }else if(f.kind==='snorm'){
  declarations.push(`IMM[${imm}] FLT32 {0.5,0.5,0.5,0.5}`);
  operations.splice(at,0,`MAD TEMP[0], TEMP[0], IMM[${imm}], IMM[${imm}]`);
 }
 return declarations.join('\n')+'\n'+operations.map((l,i)=>i+': '+l+'\n').join('');
}
export function operationCases({smoke=false,fault=null}={}){
 let fixtures=textureOperationFixtures().filter(f=>!f.name.includes('/saturated'));
 const decode=(f,b,k)=>f.kind==='snorm'?Math.max(-1,(b>=128?b-256:b)/127):f.kind==='srgb'&&k<3?(b/255<=.04045?(b/255)/12.92:((b/255+.055)/1.055)**2.4):b/255;
 for(const base of fixtures.filter(f=>f.opcode==='TXL'&&!f.name.includes('/fractional'))){
  const f={...base,name:base.name.replace('/TXL/','/TEX/'),opcode:'TEX',lod:0};
  f.vertexText=base.vertexText.replace(': TXL ',': TEX ');f.fragmentText=base.fragmentText.replace(': TXL ',': TEX ');
  f.expected=()=>{const p=base.planes[0],texel=(x,y)=>Array.from(p.bytes.subarray((Math.max(0,Math.min(p.height-1,y))*p.width+Math.max(0,Math.min(p.width-1,x)))*4,(Math.max(0,Math.min(p.height-1,y))*p.width+Math.max(0,Math.min(p.width-1,x)))*4+4),(b,k)=>decode(f,b,k));
   if(!f.linear)return texel(Math.floor(f.coord[0]*p.width),Math.floor(f.coord[1]*p.height));
   const px=f.coord[0]*p.width-.5,py=f.coord[1]*p.height-.5,x=Math.floor(px),y=Math.floor(py),a=px-x,b=py-y,A=texel(x,y),B=texel(x+1,y),C=texel(x,y+1),D=texel(x+1,y+1);return A.map((n,k)=>(n*(1-a)+B[k]*a)*(1-b)+(C[k]*(1-a)+D[k]*a)*b);
  };fixtures.push(f);
 }
 if(smoke)fixtures=fixtures.filter(f=>f.slot===3&&f.kind==='unorm'&&!f.linear&&!f.name.includes('/fractional')&&!f.name.includes('/negated-source'));
 if(fault){const op=fault==='query-levels'?'TXQ':'TXL';fixtures=textureOperationFixtures().filter(f=>f.name===`fragment/${op}/slot3/full/unorm/nearest`);}
 const result=[];
 for(const original of fixtures)for(const swizzle of fault?[[2,4,0,5]]:smoke?[[2,4,0,5],[4,5,4,5]]:[[0,1,2,3],[2,4,0,5],[4,5,4,5]]){
  const f={...original,name:original.name+'/view'+swizzle.join(''),swizzle:[...swizzle],width:original.frameWidth,height:original.frameHeight,textureWidth:original.width,textureHeight:original.height};
  f.vertex=f.stage==='vertex'?scaleResult(f.vertexText,f):f.vertexText;
  f.fragment=f.stage==='fragment'?scaleResult(f.fragmentText,f):f.fragmentText;
  f.positions=new Uint8Array(original.positions.buffer.slice(0));f.coordinates=new Uint8Array(original.coordinates.buffer.slice(0));
  const lastLevel=f.lastLevel,format=nativeFormat(f.kind),metadata={...meta(6,2,format,f.kind==='snorm'?8:10,f.resourceWidth,f.resourceHeight),lastLevel},planes=[];
  for(let level=0;level<=lastLevel;level++){
   const width=Math.max(1,Math.floor(metadata.width/2**level)),height=Math.max(1,Math.floor(metadata.height/2**level)),selected=original.planes[level-f.firstLevel];
   const input=selected?selected.bytes.slice():Uint8Array.from({length:width*height*4},(_,i)=>(i*17+level*59+13)%256);planes.push({level,width,height,input});
  }
  let length=7;for(const p of planes){p.offset=length;p.stride=p.width*4+3;length+=(p.height-1)*p.stride+p.width*4+5;}
  const backing=new Uint8Array(length).fill(0x17);for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);
  f.source={metadata,planes,backing};f.parameters={s:2,t:2,r:2,min:Number(f.linear),mip:0,mag:Number(f.linear),minLod:-1000,maxLod:1000};
  f.expectedPixels=()=>{const pixels=new Uint8Array(f.width*f.height*4);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
   const raw=original.expected(x,y),view=f.opcode==='TXQ'?raw:swizzle.map(k=>k===4?0:k===5?1:raw[k]);
   const value=f.opcode==='TXQ'?view.map((n,k)=>n*[.03125,.03125,.015625,.015625][k]):f.kind==='snorm'?view.map(n=>n*.5+.5):view;
   pixels.set(value.map(n=>Math.max(0,Math.min(255,Math.round(n*255)))),(y*f.width+x)*4);
  }return pixels;};result.push(f);
 }
 for(const base of (fault?[]:result).filter(f=>f.opcode==='TXQ'&&f.slot===3&&f.queryMask==='xyw'&&!f.name.includes('/mask'))){
  const f={...base,name:base.name+'/dead-query'};let text=f.stage==='vertex'?f.vertex:f.fragment;
  const lines=numbered(text),first=lines.findIndex(l=>/^(MOV|TEX|TX[LFDBQ]|U2F|END)\b/.test(l)),decl=lines.slice(0,first),ops=lines.slice(first),imm=decl.filter(l=>/^IMM\[/.test(l)).length;
  decl.push(`IMM[${imm}] FLT32 {0.125,0.375,0.625,0.875}`);const at=ops.indexOf(`MOV OUT[${f.stage==='vertex'?1:0}], TEMP[0]`);ops[at]=`MOV OUT[${f.stage==='vertex'?1:0}], IMM[${imm}]`;
  text=decl.join('\n')+'\n'+ops.map((l,i)=>i+': '+l+'\n').join('');if(f.stage==='vertex')f.vertex=text;else f.fragment=text;
  f.expectedPixels=()=>Uint8Array.from({length:f.width*f.height*4},(_,i)=>[32,96,159,223][i%4]);f.deadQuery=true;result.push(f);
 }
 if(!fault)for(const base of result.filter(f=>f.opcode==='TXQ'&&f.stage==='fragment'&&f.slot===3&&f.range==='full'&&f.queryMask==='xyw'&&!f.deadQuery&&!f.name.includes('/negated-source'))){
  const f={...base,name:base.name+'/two-retained-queries',queryLevelCounts:{3:4,15:3},views:[{slot:3,first:0,last:3,swizzle:base.swizzle},{slot:15,first:1,last:3,swizzle:[5,4,5,4]}]},lines=numbered(base.fragment),start=lines.findIndex(l=>/^(MOV|TXQ|UADD|U2F|MUL|END)\b/.test(l)),decl=lines.slice(0,start).map(l=>l==='DCL TEMP[0]'?'DCL TEMP[0..1]':l),ops=lines.slice(start);
  decl.push('DCL SAMP[15]','DCL SVIEW[15], 2D, FLOAT');const at=ops.findIndex(l=>l.startsWith('U2F TEMP[0]'));ops.splice(at,0,'MOV TEMP[1], IMM[1]','TXQ TEMP[1].w, IMM[0], SAMP[15], 2D','UADD TEMP[0].w, TEMP[0].wwww, TEMP[1].wwww');f.fragment=decl.join('\n')+'\n'+ops.map((l,i)=>i+': '+l+'\n').join('');
  f.expectedPixels=()=>{const raw=base.expectedPixels();for(let i=3;i<raw.length;i+=4)raw[i]=Math.round(7/64*255);return raw;};result.push(f);
 }
 if(!fault){
  const base=result.find(f=>f.stage==='fragment'&&f.opcode==='TXQ'&&f.queryMask==='w'&&f.slot===3&&f.kind==='unorm'&&f.range==='full'),f={...base,name:base.name+'/last-local-level14',lastLevel:14,levels:15},metadata={...base.source.metadata,width:16384,height:1,lastLevel:14},planes=[];
  let offset=7;for(let level=0;level<=14;level++){const width=Math.max(1,16384>>>level),height=1,input=Uint8Array.from({length:width*4},(_,i)=>(i*31+level*17+7)%256),stride=width*4+3;planes.push({level,width,height,input,offset,stride});offset+=input.length+5;}
  const backing=new Uint8Array(offset).fill(23);for(const p of planes)backing.set(p.input,p.offset);f.source={metadata,planes,backing};
  const initial=base.fragment.match(/^IMM\[1\] (?:FLT32|UINT32|INT32) \{([^}]+)\}/m)[1].split(',').map(Number);f.expectedPixels=()=>{const output=initial.map((n,k)=>Math.round((k===3?15:n)*[.03125,.03125,.015625,.015625][k]*255));return Uint8Array.from({length:256},(_,i)=>output[i%4]);};result.push(f);
 }
 return result;
}
export function setupPackets(f,{upload=true}={}){
 const src=f.source;
 return join(...(upload?[textureTransfer(3,0,f.positions.length,1),textureTransfer(7,0,f.coordinates.length,1),...src.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride))]:[]),
 shader(1,0,f.vertex),shader(2,1,f.fragment),packet(1,5,[3,0,0,0,31,0,0,1,31]),packet(2,5,[3]),packet(6,0,[16,0,3,16,0,7]),surface(4,1,67,0),packet(5,0,[1,0,4]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export function viewPackets(f){const stage=f.stage==='vertex'?0:1,views=f.views??[{slot:f.slot,first:f.firstLevel,last:f.lastLevel,swizzle:f.swizzle}];return join(sampler(8,f.parameters),...views.map((v,i)=>join(imageView(5+i,6,f.source.metadata.format,v.first,v.last,v.swizzle),packet(10,0,[stage,v.slot,5+i]),packet(18,0,[stage,v.slot,8]))));}
export const operationDraw=()=>packet(8,0,[0,6,4,0,1,0,0,0,0,0,0xffffffff,0]);
