// Predictions derive only from original public unsigned floating bit fields.
export const originalFormats=Object.freeze([Object.freeze({format:124,pixelBytes:4,nativePixelBytes:4,components:3})]);
export const originalFormat=format=>originalFormats.find(row=>row.format===format);
export const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
export function packet(opcode,words){const bytes=new Uint8Array((words.length+1)*4),view=new DataView(bytes.buffer);view.setUint32(0,opcode|words.length<<16,true);words.forEach((word,index)=>view.setUint32(4+index*4,word>>>0,true));return bytes;}
export const metadata=(id,format,width,height,lastLevel=0)=>({id,target:2,format,bind:10,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0});
export const transfer=(id,plane,direction=1)=>packet(43,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,plane.offset,direction]);
export const copyTransfer=(id,plane,staging,direction=3)=>packet(45,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,staging,plane.offset,direction]);
export function source(format,width,height,lastLevel,seed,{exceptional=false}={}){
 if(format!==124)throw Error('original packed floating preparation admits only 124');
 const planes=[];let offset=5,w=width,h=height;
 for(let level=0;level<=lastLevel;level++){
  const input=new Uint8Array(w*h*4),view=new DataView(input.buffer),stride=w*4+7;
  for(let i=0;i<w*h;i++){
   const n=(i*7+level*13+(seed>>>0))>>>0;
   const red=exceptional?[0x7c0,0x7c1,0x7e0,0x7ff,0][n%5]:i<5?[0,1,63,64,0x7bf][i]:n%1984;
   const green=exceptional?[0x7c1,0x7e0,0x7ff,0,0x7c0][n%5]:i<5?[0,1,63,64,0x7bf][(i+2)%5]:(n*3+71)%1984;
   const blue=exceptional?[0x3ff,0,0x3e0,0x3e1,0x3f0][n%5]:i<5?[0,1,31,32,0x3df][(i+1)%5]:(n*5+37)%992;
   view.setUint32(i*4,(red|green<<11|blue<<22)>>>0,true);
  }
  planes.push({level,width:w,height:h,stride,offset,input});offset+=(h-1)*stride+w*4+11;
  w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));
 }
 const backing=new Uint8Array(offset+9).fill(0xa7);
 for(const plane of planes)for(let row=0;row<plane.height;row++){const count=plane.width*4;backing.set(plane.input.subarray(row*count,(row+1)*count),plane.offset+row*plane.stride);}
 return{metadata:metadata(6,format,width,height,lastLevel),seed,exceptional,planes,backing};
}
function value(word,mantissa){const exponent=word>>>mantissa,fraction=word&((1<<mantissa)-1);return exponent===31?fraction?NaN:Infinity:exponent?(1+fraction/2**mantissa)*2**(exponent-15):fraction*2**(-14-mantissa);}
export function originalValues(format,input){
 if(format!==124)throw Error('unqualified original packed format');const view=new DataView(input.buffer,input.byteOffset,input.byteLength),result=[];
 for(let i=0;i<input.length/4;i++){const word=view.getUint32(i*4,true);result.push(value(word&2047,6),value(word>>>11&2047,6),value(word>>>22,5),1);}
 return result;
}
// ES 3.0 allows denormal flushing. Undefined nonfinite payloads get custody and
// safety checks, with no portable pixel certificate.
export function finiteMisses(format,input,native){
 const expected=originalValues(format,input),actual=new Float32Array(native.buffer,native.byteOffset,native.byteLength/4),miss=[];
 if(actual.length!==expected.length)return[{length:actual.length,expected:expected.length}];
 for(let i=0;i<actual.length;i++){
  const value=expected[i],observed=actual[i];if(!Number.isFinite(value))continue;
  if(!(value===observed||value!==0&&Math.abs(value)<2**-14&&observed===0))miss.push({at:i,expected:value,observed});
 }
 return miss;
}
