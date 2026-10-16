// Original packet and packed fields. Never import renderer packing code.
export const originalFormats=Object.freeze([Object.freeze({format:125,pixelBytes:4,nativePixelBytes:4,components:3})]);
export const originalFormat=format=>originalFormats.find(row=>row.format===format);
export const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
export function packet(opcode,words){const bytes=new Uint8Array((words.length+1)*4),view=new DataView(bytes.buffer);view.setUint32(0,opcode|words.length<<16,true);words.forEach((word,index)=>view.setUint32(4+index*4,word>>>0,true));return bytes;}
export const metadata=(id,format,width,height,lastLevel=0)=>({id,target:2,format,bind:8,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0});
export const transfer=(id,plane,direction=1)=>packet(43,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,plane.offset,direction]);
export const copyTransfer=(id,plane,staging,direction=3)=>packet(45,[id,plane.level,0,plane.stride,0,plane.x??0,plane.y??0,0,plane.width,plane.height,1,staging,plane.offset,direction]);
const word=(r,g,b,e)=>(r|g<<9|b<<18|e<<27)>>>0;
const random=seed=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
export function source(format,width,height,lastLevel,seed,{fields=false}={}){
 if(format!==125)throw Error('original shared exponent preparation admits only125');
 const planes=[];let offset=5,w=width,h=height;const next=random(seed);
 for(let level=0;level<=lastLevel;level++){
  const input=new Uint8Array(w*h*4),view=new DataView(input.buffer),stride=w*4+7;
  for(let i=0;i<w*h;i++){
   let value;
   if(fields&&level===0&&i<49152){const e=Math.floor(i/1536),lane=Math.floor(i/512)%3,m=i%512,lanes=[256,271,333];lanes[lane]=m;value=word(...lanes,e);}
   else if(i<9){const fixtures=[word(0,0,0,0),word(0,0,0,31),word(1,0,0,0),word(0,1,0,0),word(0,0,1,0),word(511,511,511,31),word(17,33,7,9),word(511,255,1,16),word(127,63,15,24)];value=fixtures[(i+level)%fixtures.length];}
   else value=next();
   view.setUint32(i*4,value,true);
  }
  planes.push({level,width:w,height:h,stride,offset,input});offset+=(h-1)*stride+w*4+11;
  w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));
 }
 const backing=new Uint8Array(offset+9).fill(0xa7);
 for(const plane of planes)for(let row=0;row<plane.height;row++){const count=plane.width*4;backing.set(plane.input.subarray(row*count,(row+1)*count),plane.offset+row*plane.stride);}
 return{metadata:metadata(6,format,width,height,lastLevel),seed,fields,planes,backing};
}
export function originalValues(format,input){
 if(format!==125||input.byteLength%4)throw Error('unqualified original shared exponent format');const view=new DataView(input.buffer,input.byteOffset,input.byteLength),result=[];
 for(let i=0;i<input.length/4;i++){const word=view.getUint32(i*4,true),scale=2**((word>>>27)-24);result.push((word&511)*scale,(word>>>9&511)*scale,(word>>>18&511)*scale,1);}
 return result;
}
export function canonicalWords(input){
 const source=new DataView(input.buffer,input.byteOffset,input.byteLength),result=new Uint8Array(input.byteLength),target=new DataView(result.buffer);
 for(let i=0;i<input.byteLength;i+=4){const original=source.getUint32(i,true),fields=[original&511,original>>>9&511,original>>>18&511],exponent=original>>>27,maximum=Math.max(...fields),canonical=maximum?Math.max(0,exponent+Math.floor(Math.log2(maximum))-8):0,shift=exponent-canonical,scaled=fields.map(m=>m*2**shift);if(scaled.some(m=>!Number.isInteger(m)||m>511))throw Error('independent original canonical field overflow');target.setUint32(i,word(...scaled,canonical),true);}
 return result;
}
export function finiteMisses(format,input,native){
 const expected=originalValues(format,input),actual=new Float32Array(native.buffer,native.byteOffset,native.byteLength/4),miss=[];
 if(actual.length!==expected.length)return[{length:actual.length,expected:expected.length}];
 for(let i=0;i<actual.length;i++)if(expected[i]!==actual[i])miss.push({at:i,expected:expected[i],observed:actual[i]});
 return miss;
}
