import * as held from '../virgl-floating-depth-consumer/fixtures.mjs';
export const {packet,join,shader,word,imageView,sampler,surface,textureTransfer,positions,vertex,draw,depthClear,dsa,setupSample,viewsSample,readOutput,setupDepth,floatWords,uniformPlane,metadata}=held;
const descriptor=Object.freeze({originalFormat:16,originalName:'Z16_UNORM',guestPixelBytes:2});
export const originalFormat=format=>format===16?descriptor:held.originalFormat(format);
export const canonical=(format,input)=>format===16?input.slice():held.canonical(format,input);
export function source(format,seed,width=17,height=9,lastLevel=3){
 if(format!==16)return held.source(format,seed,width,height,lastLevel);
 const planes=[],backing=new Uint8Array(Math.max(16000,(width*2+7)*height+16000)).fill(0xa7);
 for(let level=0,w=width,h=height;level<=lastLevel;level++,w=Math.max(1,w>>1),h=Math.max(1,h>>1)){
  const input=new Uint8Array(w*h*2),dv=new DataView(input.buffer),stride=w*2+5,offset=3+level*1000;
  for(let i=0;i<w*h;i++)dv.setUint16(i*2,i===0?0:i===1?65535:(i*109+level*739+(seed>>>0))&65535,true);
  for(let y=0;y<h;y++)backing.set(input.subarray(y*w*2,(y+1)*w*2),offset+y*stride);
  planes.push({level,width:w,height:h,input,stride,offset});
 }
 return {metadata:metadata(6,16,width,height,lastLevel,9),backing,planes};
}
export function sampleCases(options={}){
 return held.sampleCases(options).filter(f=>f.format===18).map(f=>({...f,format:16,name:f.name.replace('depth-18','depth-16'),source:source(16,options.seed??0xd9413211,17,9,4)}));
}
export function domainCases({seed=0xd9413211}={}){
 const f=sampleCases({smoke:true,seed}).find(f=>f.stage==='fragment'),src=source(16,seed,256,256,0),p=src.planes[0],dv=new DataView(p.input.buffer);
 for(let i=0;i<65536;i++)dv.setUint16(i*2,i,true);
 for(let y=0;y<256;y++)src.backing.set(p.input.subarray(y*512,(y+1)*512),p.offset+y*p.stride);
 return [{...f,name:'depth-16/full-original-UN16-domain',domain:true,opcode:'TEX',slot:0,source:src,firstLevel:0,lastLevel:0,lod:0,coord:null,
  swizzle:[0,1,2,3],parameters:{s:2,t:2,r:2,min:0,mip:2,mag:0,minLod:-1000,maxLod:1000},
  width:256,height:256,targetWidth:256,targetHeight:256,outputLevel:0,outputLastLevel:0,
  vertex:'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0]\nIMM[0] FLT32 {0.5,0.5,0,0}\n0: MOV OUT[0], IN[0]\n1: MUL TEMP[0], IN[0], IMM[0]\n2: ADD TEMP[0], TEMP[0], IMM[0]\n3: MOV OUT[1], TEMP[0]\n4: END\n',
  fragment:'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\n0: TEX TEMP[0], IN[0], SAMP[0], 2D\n1: MOV OUT[0], TEMP[0]\n2: END\n'}];
}
export function samplePlane(f){
 if(!f.domain)return uniformPlane(f.width,f.height,floatWords(sampleValue(f)));
 const words=new Uint32Array(65536*4),dv=new DataView(f.source.planes[0].input.buffer);
 for(let i=0;i<65536;i++)words.set([word(dv.getUint16(i*2,true)/65535),0,0,word(1)],i*4);
 return new Uint8Array(words.buffer);
}
export const depthLanes=f=>f.kind==='sample'&&f.opcode!=='TXQ'?f.swizzle.flatMap((k,i)=>k===0?[i]:[]):[];
export function sampleValue(f){
 if(f.opcode==='TXQ'){const p=f.source.planes[f.firstLevel+Math.floor(f.lod)];return [p.width,p.height,0,f.lastLevel-f.firstLevel+1];}
 const lod=['TEX','TXB'].includes(f.opcode)?0:f.lod,p=f.source.planes[f.firstLevel+Math.floor(lod)],
  x=f.opcode==='TXF'?0:Math.min(p.width-1,Math.floor(f.coord[0]*p.width)),y=f.opcode==='TXF'?0:Math.min(p.height-1,Math.floor(f.coord[1]*p.height)),
  z=Math.fround(new DataView(p.input.buffer).getUint16((y*p.width+x)*2,true)/65535),lanes=[z,0,0,1];
 return f.swizzle.map(k=>k===4?0:k===5?1:lanes[k]);
}
export function missWords(observed,expected,tolerant=[]){
 const a=new DataView(observed.buffer,observed.byteOffset,observed.byteLength),b=new DataView(expected.buffer,expected.byteOffset,expected.byteLength),misses=[];
 if(a.byteLength!==b.byteLength)return [{bytes:a.byteLength,expected:b.byteLength}];
 for(let i=0;i<a.byteLength/4;i++){
  const x=a.getUint32(i*4,true),y=b.getUint32(i*4,true);
  if(x!==y&&!(tolerant.includes(i%4)&&x<=0x3f800000&&y<=0x3f800000&&Math.abs(x-y)<=1)&&misses.length<8)misses.push({word:i,observed:x,expected:y});
 }
 return misses;
}
export function backingMisses(observed,expected,f){
 if(observed.length!==expected.length)return [{bytes:observed.length,expected:expected.length}];
 const tolerant=depthLanes(f),allowed=new Map(),misses=[];
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)for(const lane of tolerant)allowed.set(5+y*(f.width*16+3)+x*16+lane*4,true);
 for(let i=0;i<expected.length;i++){
  if(allowed.has(i)){const a=new DataView(observed.buffer,observed.byteOffset+i,4).getUint32(0,true),b=new DataView(expected.buffer,expected.byteOffset+i,4).getUint32(0,true);
   if(a!==b&&(a>0x3f800000||Math.abs(a-b)>1)&&misses.length<8)misses.push({wordOffset:i,observed:a,expected:b});i+=3;
  }else if(observed[i]!==expected[i]&&misses.length<8)misses.push({byte:i,observed:observed[i],expected:expected[i]});
 }
 return misses;
}
export function nativeMisses(format,input,native){
 if(format!==16)return held.nativeMisses(format,input,native);
 const count=input.length/2,wanted=new Uint32Array(count*4),dv=new DataView(input.buffer,input.byteOffset,input.byteLength);
 for(let i=0;i<count;i++)wanted.set([word(dv.getUint16(i*2,true)/65535),0,0,1],i*4);
 const depthBytes=count*16,misses=missWords(native.subarray(0,depthBytes),new Uint8Array(wanted.buffer),[0]);
 if(native.length!==count*20)misses.push({bytes:native.length,expected:count*20});
 for(let i=depthBytes;i<native.length;i++)if(native[i]!==0&&misses.length<8)misses.push({stencilByte:i-depthBytes,observed:native[i],expected:0});
 return misses;
}
export function depthCases(options={}){
 return held.depthCases(options).filter(f=>f.format===18).map(f=>{
  const src=source(16,options.seed??0xd9413211,9,7,2);
  for(const p of src.planes){const dv=new DataView(p.input.buffer);for(let i=0;i<p.width*p.height;i++)dv.setUint16(i*2,[16384,32768,49151][i%3],true);
   for(let y=0;y<p.height;y++)src.backing.set(p.input.subarray(y*p.width*2,(y+1)*p.width*2),p.offset+y*p.stride);}
  return {...f,format:16,name:f.name.replace('surface-18','surface-16'),source:src};
 });
}
export function depthExpected(f){
 const p=f.source.planes[f.level],input=p.input.slice(),dv=new DataView(input.buffer),color=uniformPlane(f.width,f.height,f.clearWords),cv=new Uint32Array(color.buffer);
 for(let i=0;i<f.width*f.height;i++){
  const z=dv.getUint16(i*2,true),incoming=32768,pass=!f.enabled||[false,incoming<z,incoming===z,incoming<=z,incoming>z,incoming!==z,incoming>=z,true][f.func];
  if(pass)cv.set(f.words,i*4);if(pass&&f.enabled&&f.write)dv.setUint16(i*2,incoming,true);
 }
 return {input,color};
}
