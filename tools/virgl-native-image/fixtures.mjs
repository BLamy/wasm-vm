// Public source words and inverse predictions; no renderer/runtime imports.
import * as byte from '../virgl-command/standard-byte-color-fixtures.mjs';
import * as floating from '../virgl-command/standard-float-image-fixtures.mjs';
import * as packedFloat from '../virgl-command/standard-packed-float-image-fixtures.mjs';
import * as shared from '../virgl-command/standard-shared-exponent-fixtures.mjs';
import * as integer from '../virgl-command/standard-integer-image-fixtures.mjs';
import * as normalized from '../virgl-command/standard-packed-normalized-fixtures.mjs';
import * as unsigned from '../virgl-command/standard-packed-unsigned-fixtures.mjs';
import * as depth from '../virgl-command/standard-floating-depth-fixtures.mjs';
import * as packedDepth from '../virgl-packed-depth/fixtures.mjs';
import * as unormDepth from '../virgl-unorm-depth/fixtures.mjs';
const hex=bytes=>[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
function refill(src) {
  for(const p of src.planes)for(let y=0;y<p.height;y++) {
    const row=p.input.length/p.height;src.backing.set(p.input.subarray(y*row,(y+1)*row),p.offset+y*p.stride);
  }
}
function normalFloats(src,f,seed) {
  const size=f.precision/8,pool=size===2?[0x3c00,0x3800,0x3a00,0x3400,0xbc00,0xc000]:
    [0x3f800000,0x3f000000,0x3f400000,0x3e800000,0xbf800000,0xc0000000];
  for(const p of src.planes){const v=new DataView(p.input.buffer);for(let i=0;i<p.input.length/size;i++){
    const word=pool[(i*3+p.level+seed)%pool.length];size===2?v.setUint16(i*size,word,true):v.setUint32(i*size,word,true);
  }}refill(src);
}
export function specimen(layout,seed,width=9,height=5,lastLevel=3) {
  const f=layout.format;let src,canonical;
  if(byte.originalFormat(f)) {
    src=byte.source(width,height,f,seed,lastLevel);
    // Both -128 and -127 denote -1 in SNORM. Use its unique -127 input here
    // so native public-byte transport has an exact inverse on every GL format.
    if(layout.kind==='snorm'){for(const p of src.planes)for(let i=0;i<p.input.length;i++)if(p.input[i]===128)p.input[i]=129;refill(src);}
    canonical=input=>byte.expectedGuestRead(f,input);
  } else if(floating.originalFormat(f)) {
    src=floating.source(f,width,height,lastLevel,seed);normalFloats(src,floating.originalFormat(f),seed);canonical=input=>input.slice();
  } else if(f===124) {
    src=packedFloat.source(f,width,height,lastLevel,seed);
    for(const p of src.planes){const v=new DataView(p.input.buffer);for(let i=0;i<p.input.length/4;i++){
      const r=0x3c0+(i*7+p.level)%64,g=0x380+(seed+i*3)%64,b=0x1e0+(i*5+p.level)%32;
      v.setUint32(i*4,(r|g<<11|b<<22)>>>0,true);
    }}refill(src);canonical=input=>input.slice();
  } else if(f===125) {
    src=shared.source(f,width,height,lastLevel,seed);canonical=shared.canonicalWords;
  } else if(integer.originalFormat(f)) {
    src=integer.source(f,width,height,lastLevel,seed);canonical=input=>input.slice();
  } else if(normalized.originalFormat(f)) {
    src=normalized.source(f,width,height,lastLevel,seed);canonical=input=>normalized.canonical(f,input);
  } else if(unsigned.originalFormat(f)) {
    src=unsigned.source(f,width,height,lastLevel,seed);canonical=input=>input.slice();
  } else if(depth.originalFormat(f)) {
    src=depth.source(f,width,height,lastLevel,seed);const pool=[0x3e800000,0x3f000000,0x3f400000,0x3f800000,0];
    for(const p of src.planes){const v=new DataView(p.input.buffer);for(let i=0;i<p.width*p.height;i++)
      v.setUint32(i*layout.publicPixelBytes,pool[(i+p.level+seed)%pool.length],true);
    }refill(src);canonical=input=>depth.canonical(f,input);
  } else if(packedDepth.originalFormat(f)) {
    src=packedDepth.source(f,width,height,lastLevel,seed);canonical=input=>packedDepth.canonical(f,input);
  } else if(f===16) {
    src=unormDepth.source(f,seed,width,height,lastLevel);canonical=input=>input.slice();
  } else {
    if(![2,67,233].includes(f))throw Error('unknown original format '+f);
    const planes=[];let offset=5,w=width,h=height;
    for(let level=0;level<=lastLevel;level++,w=Math.max(1,Math.floor(w/2)),h=Math.max(1,Math.floor(h/2))){
      const input=Uint8Array.from({length:w*h*4},(_,i)=>(i*71+level*31+seed)&255),stride=w*4+7;
      planes.push({level,width:w,height:h,input,stride,offset});offset+=(h-1)*stride+w*4+11;
    }
    src={metadata:{id:6,target:2,format:f,bind:10,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0},planes,backing:new Uint8Array(offset+9).fill(0xa7)};
    refill(src);canonical=input=>{const result=input.slice(),v=new DataView(result.buffer);for(let i=0;i<result.length;i+=4){
      if(f===2)result[i+3]=255;else if(f===233)v.setUint32(i,(v.getUint32(i,true)|0xc0000000)>>>0,true);
    }return result;};
  }
  src.metadata.bind=layout.kind==='depth'?9:['snorm','shared'].includes(layout.kind)?8:10;
  src.seed=seed;src.expected=src.planes.map(p=>canonical(p.input));
  return src;
}
export function costs(layout,metadata) {
  let pixels=0,w=metadata.width,h=metadata.height;
  for(let level=0;level<=metadata.lastLevel;level++){pixels+=w*h;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}
  return {pixels,publicBytes:pixels*layout.publicPixelBytes,gpuBytes:pixels*layout.gpuPixelBytes};
}
export function originalRecord(src,layout) {
  return {metadata:src.metadata,seed:src.seed,layout,costs:costs(layout,src.metadata),backing:hex(src.backing),
    planes:src.planes.map((p,i)=>({...p,input:hex(p.input),expected:hex(src.expected[i])}))};
}
