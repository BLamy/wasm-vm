// Independent original Mesa F32 / UP8 / X24 fields. No runtime imports.
export const originalFormats = Object.freeze([
  { originalFormat:18, originalName:'Z32_FLOAT', channels:['F32'], swizzles:['X','_','_','_'], guestPixelBytes:4, plannedNativePixelBytes:4, ownedPixelBytes:4, plannedNativeInternal:'DEPTH_COMPONENT32F', plannedUploadFormat:'DEPTH_COMPONENT', plannedUploadType:'FLOAT', stencil:false },
  { originalFormat:126, originalName:'Z32_FLOAT_S8X24_UINT', channels:['F32','UP8','X24'], swizzles:['X','Y','_','_'], guestPixelBytes:8, plannedNativePixelBytes:8, ownedPixelBytes:16, plannedNativeInternal:'DEPTH32F_STENCIL8', plannedUploadFormat:'DEPTH_STENCIL', plannedUploadType:'FLOAT_32_UNSIGNED_INT_24_8_REV', stencil:true },
]);
export const originalFormat = id => originalFormats.find(row => row.originalFormat === id);
export const metadata = (id,format,width,height,lastLevel=0,bind=9) => ({id,target:2,format,bind,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0});
export const hex = bytes => [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
export function packet(opcode,words) {
  const bytes=new Uint8Array((words.length+1)*4),view=new DataView(bytes.buffer);
  view.setUint32(0,opcode|words.length<<16,true);words.forEach((word,index)=>view.setUint32(4+index*4,word>>>0,true));return bytes;
}
export const transfer=(id,plane,direction=1)=>packet(43,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,plane.offset,direction]);
export const copyTransfer=(id,plane,staging,direction=3)=>packet(45,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,staging,plane.offset,direction]);
export function inlineTransfer(id,plane) {
  const rowBytes=plane.input.length/plane.height,span=(plane.height-1)*plane.stride+rowBytes,bytes=new Uint8Array(Math.ceil(span/4)*4).fill(0x6d);
  for(let y=0;y<plane.height;y++)bytes.set(plane.input.subarray(y*rowBytes,(y+1)*rowBytes),y*plane.stride);
  const view=new DataView(bytes.buffer);return packet(9,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,...Array.from({length:bytes.length/4},(_,i)=>view.getUint32(i*4,true))]);
}
const random=seed=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const finiteWords=[0x3eaaab55,0x3f000001,0x3effffff,0x3f7fffff,0x35800000,0x3c012345,0x3f000000,0x3e800000,0x00000000,0x3f800000,0xbf800000,0x40000000,0x00800000,0x00900001];
export const exceptionalWords=[0x80000000,0x00000001,0x007fffff,0x80000001,0x7f800000,0xff800000,0x7fc01234,0x7f812345,0xffc56789];
export function source(format,width,height,lastLevel,seed,{bind=9,exceptional=false}={}) {
  const f=originalFormat(format),next=random(seed),planes=[];let offset=5,w=width,h=height;
  for(let level=0;level<=lastLevel;level++) {
    const input=new Uint8Array(w*h*f.guestPixelBytes),v=new DataView(input.buffer),stride=w*f.guestPixelBytes+7;
    for(let i=0;i<w*h;i++) {
      const bits=exceptional?exceptionalWords[(i+level)%exceptionalWords.length]:finiteWords[(i+level+(i===0?0:next()))%finiteWords.length];
      v.setUint32(i*f.guestPixelBytes,bits,true);
      if(f.stencil)v.setUint32(i*8+4,(next()&0xffffff00)|((i*73+level*29+seed)&255),true);
    }
    planes.push({level,width:w,height:h,stride,offset,input});offset+=(h-1)*stride+w*f.guestPixelBytes+11;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));
  }
  const backing=new Uint8Array(offset+9).fill(0xa7);
  for(const p of planes)for(let y=0;y<p.height;y++){const row=p.width*f.guestPixelBytes;backing.set(p.input.subarray(y*row,(y+1)*row),p.offset+y*p.stride);}
  return {metadata:metadata(6,format,width,height,lastLevel,bind),seed,exceptional,planes,backing};
}
export function acceptedDepth(bits) {
  const exponent=(bits>>>23)&255,mantissa=bits&0x7fffff;
  if(exponent===255)return null; // Undefined conversion: retain raw custody only.
  if((bits&0x7fffffff)===0)return [0,0x80000000];
  if(bits>>>31)return [0,0x80000000];
  if(exponent===0&&mantissa)return [bits,0,0x80000000];
  return [bits>0x3f800000?0x3f800000:bits];
}
export function canonical(format,input) {
  const f=originalFormat(format),out=input.slice(),v=new DataView(out.buffer);
  for(let i=0;i<input.length/f.guestPixelBytes;i++) {
    const accepted=acceptedDepth(v.getUint32(i*f.guestPixelBytes,true));
    if(accepted)v.setUint32(i*f.guestPixelBytes,accepted[0],true);
    if(f.stencil)v.setUint32(i*8+4,v.getUint32(i*8+4,true)&255,true);
  }
  return out;
}
export function nativeMisses(format,input,native) {
  const f=originalFormat(format),v=new DataView(input.buffer,input.byteOffset,input.byteLength),d=new DataView(native.buffer,native.byteOffset,native.byteLength),n=input.length/f.guestPixelBytes,miss=[];
  if(native.length!==n*20)return [{bytes:native.length,expected:n*20}];
  for(let i=0;i<n;i++) {
    const accepted=acceptedDepth(v.getUint32(i*f.guestPixelBytes,true)),observed=d.getUint32(i*16,true);
    if(accepted&&!accepted.includes(observed)&&miss.length<8)miss.push({pixel:i,field:'depth',expected:accepted,observed});
    for(let lane=1;lane<4;lane++)if(d.getUint32(i*16+lane*4,true)!==(lane===3?1:0)&&miss.length<8)miss.push({pixel:i,lane,expected:lane===3?1:0,observed:d.getUint32(i*16+lane*4,true)});
    for(let lane=0;lane<4;lane++){const expected=lane===0&&f.stencil?v.getUint8(i*8+4):0,at=n*16+i*4+lane;if(native[at]!==expected&&miss.length<8)miss.push({pixel:i,field:'stencil',lane,expected,observed:native[at]});}
  }
  return miss;
}
export function publicMisses(format,input,observed) {
  const f=originalFormat(format),a=new DataView(input.buffer,input.byteOffset,input.byteLength),b=new DataView(observed.buffer,observed.byteOffset,observed.byteLength),miss=[];
  if(observed.length!==input.length)return [{bytes:observed.length,expected:input.length}];
  for(let i=0;i<input.length/f.guestPixelBytes;i++) {
    const accepted=acceptedDepth(a.getUint32(i*f.guestPixelBytes,true)),word=b.getUint32(i*f.guestPixelBytes,true);
    if(accepted&&!accepted.includes(word)&&miss.length<8)miss.push({pixel:i,field:'depth',expected:accepted,observed:word});
    if(f.stencil)for(let byte=4;byte<8;byte++){const expected=byte===4?a.getUint8(i*8+4):0;if(b.getUint8(i*8+byte)!==expected&&miss.length<8)miss.push({pixel:i,byte,expected,observed:b.getUint8(i*8+byte)});}
  }
  return miss;
}
export function clearWords(format,width,height,[depth,stencil]) {
  const f=originalFormat(format),out=new Uint8Array(width*height*f.guestPixelBytes),v=new DataView(out.buffer);
  for(let i=0;i<width*height;i++){v.setFloat32(i*f.guestPixelBytes,depth,true);if(f.stencil)v.setUint32(i*8+4,stencil&255,true);}return out;
}
export function patchPlane(format,plane,patch) {
  const f=originalFormat(format),result=canonical(format,plane.input),raw=canonical(format,patch.input),rowBytes=patch.width*f.guestPixelBytes;
  for(let y=0;y<patch.height;y++)result.set(raw.subarray(y*rowBytes,(y+1)*rowBytes),((patch.y+y)*plane.width+patch.x)*f.guestPixelBytes);return result;
}
