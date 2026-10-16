// Original public bit patterns and complete strided transfer inputs. No native
// storage implementation or emitted shader participates in the prediction.
export const originalFormats = Object.freeze([
  ...[91,92,93,94].map((format,index)=>Object.freeze({format,precision:16,components:index+1})),
  ...[28,29,30,31].map((format,index)=>Object.freeze({format,precision:32,components:index+1})),
]);
export const originalFormat = format => originalFormats.find(row=>row.format===format);
export const hex = bytes => [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
export function packet(opcode,words){
 const bytes=new Uint8Array((words.length+1)*4),view=new DataView(bytes.buffer);
 view.setUint32(0,opcode|words.length<<16,true);
 words.forEach((word,index)=>view.setUint32(4+index*4,word,true));return bytes;
}
export const metadata=(id,format,width,height,lastLevel=0)=>({id,target:2,format,bind:10,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0});
export const transfer=(id,plane,direction=1)=>packet(43,[id,plane.level,0,plane.stride,0,0,0,0,plane.width,plane.height,1,plane.offset,direction]);
export const copyTransfer=(id,plane,staging,direction=3)=>packet(45,[id,plane.level,0,plane.stride,0,0,0,0,plane.width,plane.height,1,staging,plane.offset,direction]);
export const halfWords=Object.freeze([0,0x8000,1,0x8001,0x3ff,0x83ff,0x400,0x8400,0x3c00,0xbc00,0x3555,0xb555,0x3c01,0x3c02,0x7bff,0xfbff,0x0401,0x17fe,0x6c19,0xe415]);
export const floatWords=Object.freeze([0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x3f800000,0xbf800000,0x3eaaaaab,0xbeaaaaab,0x3f800001,0x3f800002,0x7f7fffff,0xff7fffff,0x00800001,0x177ffe01,0x4d431219,0xe4121543]);
export const exceptionalWords=precision=>precision===16?[0x7c00,0xfc00,0x7e00,0xfe00,0x7d03]:[0x7f800000,0xff800000,0x7fc00000,0xffc00000,0x7f901234];
export function source(format,width,height,lastLevel,seed,{exceptional=false}={}){
 const p=originalFormat(format),size=p.precision/8,words=exceptional?exceptionalWords(p.precision):p.precision===16?halfWords:floatWords;
 const planes=[];let offset=5,w=width,h=height;
 for(let level=0;level<=lastLevel;level++){
  const input=new Uint8Array(w*h*p.components*size),view=new DataView(input.buffer),stride=w*p.components*size+7;
  for(let i=0;i<w*h*p.components;i++){
   const word=words[(i*7+level*3+(seed>>>0))%words.length];
   size===2?view.setUint16(i*size,word,true):view.setUint32(i*size,word,true);
  }
  planes.push({level,width:w,height:h,stride,offset,input});offset+=(h-1)*stride+w*p.components*size+11;
  w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));
 }
 const backing=new Uint8Array(offset+9).fill(0xa7);
 for(const plane of planes)for(let row=0;row<plane.height;row++){
  const count=plane.width*p.components*size;backing.set(plane.input.subarray(row*count,(row+1)*count),plane.offset+row*plane.stride);
 }
 return{metadata:metadata(6,format,width,height,lastLevel),seed,exceptional,planes,backing};
}
function halfNumber(word){
 const sign=word&0x8000?-1:1,exponent=word>>>10&31,fraction=word&1023;
 return exponent===31?fraction?NaN:sign*Infinity:sign*(exponent?(1+fraction/1024)*2**(exponent-15):fraction*2**-24);
}
export function wordValue(precision,word){
 if(precision===16)return halfNumber(word);
 const raw=new Uint8Array(4),view=new DataView(raw.buffer);view.setUint32(0,word,true);return view.getFloat32(0,true);
}
export function originalValues(format,input){
 const p=originalFormat(format),size=p.precision/8,view=new DataView(input.buffer,input.byteOffset,input.byteLength),result=[];
 for(let i=0;i<input.length/(size*p.components);i++)for(let lane=0;lane<4;lane++){
  const at=(i*p.components+lane)*size;
  result.push(lane<p.components?wordValue(p.precision,size===2?view.getUint16(at,true):view.getUint32(at,true)):lane===3?1:0);
 }
 return result;
}
// ES 3.0.6 2.1 permits denormal flushing and leaves nonfinite command values
// unspecified. Ordinary finite values retain their exact public representation;
// nonfinite originals are recorded for safety/custody, without fabricated pixels.
export function finiteMisses(format,input,native){
 const expected=originalValues(format,input),actual=new Float32Array(native.buffer,native.byteOffset,native.byteLength/4),miss=[];
 const minimum=originalFormat(format).precision===16?2**-14:2**-126;
 if(actual.length!==expected.length)return[{length:actual.length,expected:expected.length}];
 for(let i=0;i<actual.length;i++){
  const value=expected[i],observed=actual[i];if(!Number.isFinite(value))continue;
  const held=value===observed||value!==0&&Math.abs(value)<minimum&&observed===0;
  if(!held)miss.push({at:i,expected:value,observed});
 }
 return miss;
}
