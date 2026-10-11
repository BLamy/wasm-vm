import * as held from '../virgl-floating-depth-consumer/fixtures.mjs';
import {domainCases as un16Domain, missWords, backingMisses, depthLanes} from '../virgl-unorm-depth/fixtures.mjs';
export const {packet,join,shader,word,imageView,sampler,surface,textureTransfer,positions,vertex,draw,depthClear,dsa,setupSample,viewsSample,readOutput,setupDepth,floatWords,uniformPlane,metadata}=held;
export {missWords,backingMisses,depthLanes};
const maximum=0xffffff;
export const originalFormat=format=>[20,21].includes(format)?{originalFormat:format,guestPixelBytes:4}:format===16?{originalFormat:16,guestPixelBytes:2}:held.originalFormat(format);
export function depthAt(format,input,i){const dv=new DataView(input.buffer,input.byteOffset,input.byteLength);return format===16?dv.getUint16(i*2,true)/65535:[20,21].includes(format)?(format===20?dv.getUint32(i*4,true)>>>8:dv.getUint32(i*4,true)&maximum)/maximum:dv.getFloat32(i*originalFormat(format).guestPixelBytes,true);}
export function setDepth(format,input,i,z){const dv=new DataView(input.buffer,input.byteOffset,input.byteLength);if(format===16)dv.setUint16(i*2,Math.round(z*65535),true);else if([20,21].includes(format)){const old=dv.getUint32(i*4,true),n=Math.round(z*maximum);dv.setUint32(i*4,format===20?(n<<8)|(old&255):(old&0xff000000)|n,true);}else dv.setFloat32(i*originalFormat(format).guestPixelBytes,z,true);}
export function canonical(format,input){if(![20,21].includes(format))return format===16?input.slice():held.canonical(format,input);const out=input.slice();if(format===21)for(let i=3;i<out.length;i+=4)out[i]=0;return out;}
// Original words, independent of runtime format descriptors or converters.
export function stratified(i){const edges=[0,1,2,127,128,129,0x7ffffe,0x7fffff,0x800000,0x800001,0xffff7e,0xffff7f,0xffff80,0xfffffd,0xfffffe,maximum];return i<edges.length?edges[i]:((i*257+((i&3)-1))&maximum);}
export function source(format,seed,width=17,height=9,lastLevel=3){
 if(![16,20,21].includes(format))return held.source(format,seed,width,height,lastLevel);
 const bpp=originalFormat(format).guestPixelBytes,planes=[],backing=new Uint8Array(Math.max(16000,(width*bpp+7)*height+16000)).fill(0xa7);
 for(let level=0,w=width,h=height;level<=lastLevel;level++,w=Math.max(1,w>>1),h=Math.max(1,h>>1)){
  const input=new Uint8Array(w*h*bpp),dv=new DataView(input.buffer),stride=w*bpp+5,offset=3+level*1000;
  for(let i=0;i<w*h;i++){const n=stratified(i+level*997+(seed&255)),other=(i+level*17+seed)&255;if(format===16)dv.setUint16(i*2,n&65535,true);else dv.setUint32(i*4,format===20?(n<<8)|other:(other<<24)|n,true);}
  for(let y=0;y<h;y++)backing.set(input.subarray(y*w*bpp,(y+1)*w*bpp),offset+y*stride);planes.push({level,width:w,height:h,input,stride,offset});
 }
 return {metadata:metadata(6,format,width,height,lastLevel,9),backing,planes};
}
export function sampleCases(options={}){return held.sampleCases(options).map(f=>{const format=f.format===18?20:21;return {...f,format,name:f.name.replace('depth-'+f.format,'depth-'+format),source:source(format,options.seed??0xd9433211,17,9,4)};});}
export function domainCases({seed=0xd9433211}={}){return [20,21].map(format=>{
 const base=un16Domain({seed})[0],src=source(format,seed,256,256,0),p=src.planes[0],dv=new DataView(p.input.buffer);
 for(let i=0;i<65536;i++)dv.setUint32(i*4,format===20?(stratified(i)<<8)|(i&255):((i&255)<<24)|stratified(i),true);
 for(let y=0;y<256;y++)src.backing.set(p.input.subarray(y*1024,(y+1)*1024),p.offset+y*p.stride);
 return {...base,format,name:'depth-'+format+'/stratified-original-UN24-S8-X8',source:src};
});}
export function sampleValue(f){if(f.opcode==='TXQ'){const p=f.source.planes[f.firstLevel+Math.floor(f.lod)];return [p.width,p.height,0,f.lastLevel-f.firstLevel+1];}const lod=['TEX','TXB'].includes(f.opcode)?0:f.lod,p=f.source.planes[f.firstLevel+Math.floor(lod)],x=f.opcode==='TXF'?0:Math.min(p.width-1,Math.floor(f.coord[0]*p.width)),y=f.opcode==='TXF'?0:Math.min(p.height-1,Math.floor(f.coord[1]*p.height)),lanes=[Math.fround(p.nativeDepth??depthAt(f.format,p.input,y*p.width+x)),0,0,1];return f.swizzle.map(k=>k===4?0:k===5?1:lanes[k]);}
export function samplePlane(f){if(!f.domain)return uniformPlane(f.width,f.height,floatWords(sampleValue(f)));const out=new Uint32Array(f.width*f.height*4),p=f.source.planes[0];for(let i=0;i<f.width*f.height;i++)out.set([word(depthAt(f.format,p.input,i)),0,0,word(1)],i*4);return new Uint8Array(out.buffer);}
export function nativeMisses(format,input,native,clearDepth=null){
 const bpp=originalFormat(format).guestPixelBytes,count=input.length/bpp,wanted=new Uint32Array(count*4),depthBytes=count*16,miss=[];
 for(let i=0;i<count;i++)wanted.set([word(depthAt(format,input,i)),0,0,1],i*4);
 if(clearDepth===null)miss.push(...missWords(native.subarray(0,depthBytes),new Uint8Array(wanted.buffer),[0]));
 else {const v=new DataView(native.buffer,native.byteOffset,native.byteLength),scale=format===16?65535:maximum,lo=Math.floor(clearDepth*scale)/scale,hi=Math.ceil(clearDepth*scale)/scale;
  for(let i=0;i<count;i++){const z=v.getFloat32(i*16,true);if(v.getUint32(i*16,true)<Math.max(0,word(lo)-1)||v.getUint32(i*16,true)>Math.min(0x3f800000,word(hi)+1)||v.getUint32(i*16+4,true)!==0||v.getUint32(i*16+8,true)!==0||v.getUint32(i*16+12,true)!==1)if(miss.length<8)miss.push({pixel:i,observed:z,interval:[lo,hi]});}
 }
 if(native.length!==count*20)miss.push({bytes:native.length,expected:count*20});
 for(let i=0;i<count;i++)for(let j=0;j<4;j++){const expected=j===0?(format===20?input[i*4]:format===126?input[i*8+4]:0):0;if(native[depthBytes+i*4+j]!==expected&&miss.length<8)miss.push({stencilByte:i*4+j,observed:native[depthBytes+i*4+j],expected});}
 return miss;
}
export function depthCases(options={}){return held.depthCases(options).flatMap((f,index)=>[...(options.smoke?[1]:[0,.5,1])].map(incoming=>{
 const format=f.format===18?20:21,src=source(format,options.seed??0xd9433211,9,7,2),points=[0,.25,.75,1];
 for(const p of src.planes){for(let i=0;i<p.width*p.height;i++)setDepth(format,p.input,i,points[i%4]);for(let y=0;y<p.height;y++)src.backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);}
 const inputPositions=positions.slice(),dv=new DataView(inputPositions.buffer);for(let i=0;i<6;i++)dv.setFloat32(i*16+8,incoming*2-1,true);
 return {...f,format,name:f.name.replace('surface-'+f.format,'surface-'+format)+'/incoming'+incoming,source:src,incoming,inputPositions};
}));}
export function depthExpected(f){const p=f.source.planes[f.level],input=p.input.slice(),color=uniformPlane(f.width,f.height,f.clearWords),cv=new Uint32Array(color.buffer);for(let i=0;i<f.width*f.height;i++){const z=depthAt(f.format,input,i),incoming=f.incoming,pass=!f.enabled||[false,incoming<z,incoming===z,incoming<=z,incoming>z,incoming!==z,incoming>=z,true][f.func];if(pass)cv.set(f.words,i*4);if(pass&&f.enabled&&f.write)setDepth(f.format,input,i,incoming);}return {input,color};}
