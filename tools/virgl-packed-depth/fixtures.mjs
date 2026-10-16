// Original UP8/UN24 and UN24/X8 inputs and independent inverse. No product imports.
import {metadata,hex,packet,transfer,copyTransfer,inlineTransfer} from '../virgl-command/standard-floating-depth-fixtures.mjs';
export {metadata,hex,packet,transfer,copyTransfer,inlineTransfer};
export const originalFormats=Object.freeze([
 {originalFormat:20,originalName:'S8_UINT_Z24_UNORM',channels:['UP8','UN24'],swizzles:['Y','X','_','_'],guestPixelBytes:4,plannedNativePixelBytes:4,ownedPixelBytes:4,plannedNativeInternal:'DEPTH24_STENCIL8',plannedUploadFormat:'DEPTH_STENCIL',plannedUploadType:'UNSIGNED_INT_24_8',stencil:true},
 {originalFormat:21,originalName:'Z24X8_UNORM',channels:['UN24','X8'],swizzles:['X','_','_','_'],guestPixelBytes:4,plannedNativePixelBytes:4,ownedPixelBytes:4,plannedNativeInternal:'DEPTH_COMPONENT24',plannedUploadFormat:'DEPTH_COMPONENT',plannedUploadType:'UNSIGNED_INT',stencil:false},
]);
export const originalFormat=id=>originalFormats.find(f=>f.originalFormat===id);
export const depth=(format,word)=>format===20?word>>>8:word&0xffffff;
export const edges=[0x5555a7,0,1,2,127,128,255,256,257,65535,65536,65537,0x3fffff,0x400000,0x400001,0x7ffffe,0x7fffff,0x800000,0x800001,0xfffffd,0xfffffe,0xffffff];
const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
export function source(format,width,height,lastLevel,seed,{bind=9,exceptional=false,domainStart=null}={}) {
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;},planes=[];let offset=5,w=width,h=height;
 for(let level=0;level<=lastLevel;level++) {
  const input=new Uint8Array(w*h*4),v=new DataView(input.buffer),stride=w*4+7;
  for(let i=0;i<w*h;i++) {
   const bits=next(),n=domainStart!==null?domainStart+i:exceptional?(i*541+level*739+seed)&0xffffff:i<edges.length?edges[(i+level)%edges.length]:bits&0xffffff;
   v.setUint32(i*4,format===20?((n<<8)|((i*73+level*29+seed)&255))>>>0:(n|(((bits>>>24)^0xa7)<<24))>>>0,true);
  }
  planes.push({level,width:w,height:h,stride,offset,input});offset+=(h-1)*stride+w*4+11;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));
 }
 const backing=new Uint8Array(offset+9).fill(0xa7);
 for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);
 return{metadata:metadata(6,format,width,height,lastLevel,bind),seed,exceptional,domainStart,planes,backing};
}
export function canonical(format,input) {
 const output=input.slice();if(format===21){const d=new DataView(output.buffer);for(let i=0;i<output.length;i+=4)d.setUint32(i,d.getUint32(i,true)&0xffffff,true);}return output;
}
export function nativeMisses(format,input,native,{depthOnly=false}={}) {
 const n=input.length/4,v=new DataView(input.buffer,input.byteOffset,input.byteLength),d=new DataView(native.buffer,native.byteOffset,native.byteLength),miss=[];
 if(native.length!==n*20)return[{bytes:native.length,expected:n*20}];
 for(let i=0;i<n;i++) {
  const original=v.getUint32(i*4,true),expected=word(depth(format,original)/0xffffff),actual=d.getUint32(i*16,true);
  if(Math.abs(expected-actual)>1&&miss.length<8)miss.push({pixel:i,field:'depth',expected,actual,ulp:Math.abs(expected-actual)});
  for(let lane=1;lane<4;lane++)if(d.getUint32(i*16+lane*4,true)!==(lane===3?1:0)&&miss.length<8)miss.push({pixel:i,lane,actual:d.getUint32(i*16+lane*4,true)});
  for(let lane=0;lane<4;lane++){const expected=lane===0&&format===20&&!depthOnly?original&255:0,actual=native[n*16+i*4+lane];if(actual!==expected&&miss.length<8)miss.push({pixel:i,field:'stencil',lane,expected,actual});}
 }
 return miss;
}
export function publicMisses(format,input,observed) {
 const expected=canonical(format,input),miss=[];if(expected.length!==observed.length)return[{bytes:observed.length,expected:expected.length}];
 for(let i=0;i<expected.length;i++)if(expected[i]!==observed[i]&&miss.length<8)miss.push({byte:i,expected:expected[i],observed:observed[i]});return miss;
}
export function clearWords(format,width,height,[z,s]) {
 const output=new Uint8Array(width*height*4),d=new DataView(output.buffer),n=Math.round(z*0xffffff);
 for(let i=0;i<width*height;i++)d.setUint32(i*4,format===20?((n<<8)|(s&255))>>>0:n,true);return output;
}
export function patchPlane(format,plane,patch) {
 const output=canonical(format,plane.input),raw=canonical(format,patch.input);for(let y=0;y<patch.height;y++)output.set(raw.subarray(y*patch.width*4,(y+1)*patch.width*4),((patch.y+y)*plane.width+patch.x)*4);return output;
}
