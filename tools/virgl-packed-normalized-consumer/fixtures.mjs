import {originalFormats as normalizedFormats,originalFormat as normalizedFormat} from '../virgl-command/standard-packed-normalized-fixtures.mjs';
export {normalizedFormats,normalizedFormat};
import {originalFormat,metadata} from '../virgl-command/standard-integer-image-fixtures.mjs';
import {packet,join,shader,word,surface,textureTransfer} from '../virgl-command/standard-image-fixtures.mjs';
export {originalFormat,metadata,packet,join,shader,word,surface,textureTransfer};
export const ids=[1,2,4,5],registers=[5,13,7,1];
export const positions=new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]).buffer);
export const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
export const floatWord=word;
export const floatValue=bits=>new DataView(new Uint32Array([bits]).buffer).getFloat32(0,true);
export function outputFormat(format){
 const normalized=normalizedFormat(format);if(normalized)return{normalized,integer:false,components:4,pixelBytes:normalized.guestPixelBytes,bits:normalized.guestPixelBytes*8};
 const integer=originalFormat(format);if(integer)return{integer:true,components:integer.components,pixelBytes:integer.guestPixelBytes,bits:integer.bits};
 if(format>=28&&format<=31)return{integer:false,components:format-27,pixelBytes:(format-27)*4,bits:32};
 if(format>=91&&format<=94)return{integer:false,components:format-90,pixelBytes:(format-90)*2,bits:16};
 if(format===124)return{integer:false,components:3,pixelBytes:4,bits:32,packed:true};
 if(format===67)return{integer:false,components:4,pixelBytes:4,bits:8};throw Error('unknown original MRT format');
}
export function halfFloatWord(raw){
 if(!(raw&0x7fffffff))return(raw>>>16)&0x8000;
 const exponent=(raw>>>23&255)-112,fraction=raw&0x7fffff;
 if(exponent<=0||exponent>=31||(fraction&0x1fff))throw Error('original MRT half fixture must be exactly representable');
 return(raw>>>16&0x8000)|(exponent<<10)|(fraction>>>13);
}
export function packedFloatWord(values){
 return values.slice(0,3).reduce((word,raw,lane)=>{
  const mantissa=lane===2?5:6,exponent=(raw>>>23&255)-112,fraction=raw&0x7fffff;
  if(exponent<=0||exponent>=31||(fraction&((1<<(23-mantissa))-1)))throw Error('original MRT packed fixture must be exactly representable');
  return(word|((exponent<<mantissa|fraction>>>(23-mantissa))<<(lane===0?0:lane===1?11:22)))>>>0;
 },0);
}
export function rawValues(format,slot=0){
 const integer=originalFormat(format);
 if(normalizedFormat(format))return[-.25,.72,.9375,.75].map(word);
 if(!integer)return [-.25,2.5,.25,.75].map(word);
 const high=2**(integer.bits-1),max=2**integer.bits-1;
 return integer.signed?[(-high)>>>0,(high-1)>>>0,(-17)>>>0,1]:[max>>>0,high>>>0,17,slot+1];
}
export function clear(buffers,words){const wire=packet(7,0,[buffers,...words,0,0,0]);new DataView(wire.buffer).setFloat64(24,1,true);return wire;}
export const draw=()=>packet(8,0,[0,6,4,0,1,0,0,0,0,0,0xffffffff,0]);
export function blend(handle,{mask=15,enabled=false,source=1,destination=1,alphaSource=1,alphaDestination=1,rgbFunction=0,alphaFunction=0}={}){
 const bits=Number(enabled)|(enabled?rgbFunction:0)<<1|(enabled?alphaFunction:0)<<14|(enabled?source:0)<<4|(enabled?destination:0)<<9|
  (enabled?alphaSource:0)<<17|(enabled?alphaDestination:0)<<22|mask<<27;
 return join(packet(1,1,[handle,0,0,bits,0,0,0,0,0,0,0]),packet(2,1,[handle]));
}
export function raster(handle,scissor){return join(packet(1,2,[handle,2|(1<<29)|(Number(scissor)<<14),word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[handle]));}
export const scissor=(width,height)=>packet(15,0,[0,1|1<<16,(width-1)|(height-1)<<16]);
export function fragment(f){
 const slots=f.emitted??f.formats.map((format,slot)=>format?slot:null).filter(slot=>slot!==null);
 let text='FRAG\n';
 if(f.broadcast)text+='DCL OUT[5], COLOR\nPROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\n';
 else for(const slot of slots)text+=`DCL OUT[${registers[slot]}], COLOR[${slot}]\n`;
 const values=f.broadcast?[f.words[0]]:slots.map(slot=>f.words[slot]);
 values.forEach((words,index)=>text+=`IMM[${index}] UINT32 {${words.join(',')}}\n`);
 const instructions=f.broadcast?['MOV OUT[5], IMM[0]']:slots.map((slot,index)=>`MOV OUT[${registers[slot]}], IMM[${index}]`);
 if(f.discard)instructions.push('KILL');instructions.push('END');
 text+=instructions.map((line,index)=>`${index}: ${line}\n`).join('');return text;
}
export function make(name,formats,options={}){
 const f={name,formats:[...formats],width:4,height:4,outputLevel:0,outputLastLevel:0,targetWidth:4,targetHeight:4,
  clearWords:[.27,.25,.625,.75].map(word),mask:15,blendEnabled:false,...options};
 if(f.outputLevel){f.targetWidth=17;f.targetHeight=9;f.width=8;f.height=4;f.outputLastLevel=2;}
 f.words??=f.formats.map((format,slot)=>rawValues(format,slot));
 if(f.broadcast)f.words=Array.from({length:4},()=>f.broadcastWords??f.words.find((_,slot)=>f.formats[slot]));
 f.vertex=vertex;f.fragment=fragment(f);return f;
}
export function cases({smoke=false}={}){
 const list=[make('packed-upper-clamp',[135,31,196,8],{blendEnabled:true,source:7,destination:8,clearWords:[.27,.25,0,.75].map(word),words:[[-.25,.72,1.5,.75].map(word),rawValues(31),rawValues(196),[-.25,.72,1.5,.75].map(word)]}),make('packed-four-native-families',[7,6,5,8]),make('packed-opaque-and-HDR',[122,31,200,308]),make('packed-mixed-clamped-HDR',[135,31,196,8],{blendEnabled:true,source:7,destination:8})];
 if(smoke)return list;
 for(const f of normalizedFormats)for(let slot=0;slot<4;slot++)for(const outputLevel of [0,1]){
  const formats=[31,196,200,31];formats[slot]=f.originalFormat;
  list.push(make(`packed-${f.originalFormat}-slot${slot}-level${outputLevel}`,formats,{outputLevel}));
 }
 for(const f of normalizedFormats){
  list.push(make('packed-broadcast-'+f.originalFormat,[f.originalFormat,31,200,196],{broadcast:true,broadcastWords:[.25,1.75,-.125,.75].map(word),outputLevel:1}));
  const formats=Array(4).fill(null);formats[3]=f.originalFormat;
  list.push(make('packed-sparse-'+f.originalFormat,formats,{mask:5,scissored:true,outputLevel:1}));
 }
 for(const format of [7,6,5,8,122,135,308,407,409])for(const source of [1,7,23])
  list.push(make('packed-blend-'+format+'-'+source,[format,31,196,200],{blendEnabled:true,source,destination:source===23?7:8,mask:5,scissored:true}));
 for(const format of [7,6,5,8])for(let equation=0;equation<=4;equation++)
  list.push(make('packed-equation-'+format+'-'+equation,[format,31,196,200],{blendEnabled:true,source:7,destination:8,rgbFunction:equation,alphaFunction:equation,clearWords:[.25,.25,.625,.75].map(word)}));
 return list;
}
export function framebuffer(f,formats=f.formats){
 const last=formats.findLastIndex(Boolean);
 return packet(5,0,[last+1,0,...formats.slice(0,last+1).map((format,slot)=>format?20+slot:0)]);
}
export function setup(f){
 const outputs=f.formats.flatMap((format,slot)=>format?[surface(20+slot,ids[slot],format,f.outputLevel)]:[]);
 const selected=f.formats.reduce((mask,format,slot)=>format?mask|(4<<slot):mask,0);
 return join(textureTransfer(3,0,positions.length,1),shader(10,0,f.vertex),shader(11,1,f.fragment),
  packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),...outputs,framebuffer(f),
  packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),
  packet(31,0,[10,0]),packet(31,0,[11,1]),clear(selected,f.clearWords));
}
export function state(f,handle=30){
 return join(blend(handle,{...f,enabled:f.blendEnabled}),raster(handle+1,Boolean(f.scissored)),...(f.scissored?[scissor(f.width,f.height)]:[]),
  packet(14,0,[.25,.5,.75,.25].map(word)));
}
export const read=(f,slot)=>packet(43,0,[ids[slot],f.outputLevel,0,f.width*outputFormat(f.formats[slot]).pixelBytes+3,
  0,0,0,0,f.width,f.height,1,5,2]);
const missing=(format,lane)=>lane===3?(originalFormat(format)?1:word(1)):0;
function nativeWord(format,value,lane,kind){
 const normalized=normalizedFormat(format),integer=originalFormat(format),output=outputFormat(format);
 if(normalized){const field=normalized.rgbaFields[lane],mask=2**field.bits-1;return field.implicit?mask||1:Math.round(Math.max(0,Math.min(1,floatValue(value)))*mask);}
 if(lane>=output.components)return missing(format,lane);
 if(integer){
  if(lane>=integer.components)return missing(format,lane);
  const number=integer.signed?value|0:value>>>0;
  if(kind==='clear')return Math.max(integer.signed?-(2**(integer.bits-1)):0,Math.min(integer.signed?2**(integer.bits-1)-1:2**integer.bits-1,number))>>>0;
  return number>>>0;
 }
 if(format!==67)return value>>>0;
 return Math.round(Math.max(0,Math.min(1,floatValue(value)))*255);
}
export function initial(f){
 return f.formats.map(format=>format?new Uint32Array(f.width*f.height*4).map((_,index)=>nativeWord(format,0,index%4,'initial')):null);
}
export function update(f,planes,kind,{buffers=61}={}){
 for(let slot=0;slot<4;slot++){
  const format=f.formats[slot],plane=planes[slot];if(!format||kind==='clear'&&!(buffers&(4<<slot)))continue;
  if(kind==='draw'&&(f.discard||f.emitted&&!f.emitted.includes(slot)))continue;
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)for(let lane=0;lane<4;lane++){
   if(kind==='draw'&&(!(f.mask&(1<<lane))||f.scissored&&(x<1||x>=f.width-1||y<1||y>=f.height-1)))continue;
   if(outputFormat(format).components<4&&lane===3||lane===3&&normalizedFormat(format)?.implicitAlpha)continue;
   const at=(y*f.width+x)*4+lane;
   let raw=(kind==='clear'?f.clearWords:f.words[slot])[lane];
   if(kind==='draw'&&f.blendEnabled&&!originalFormat(format)){
    const src=floatValue(raw),normalized=normalizedFormat(format),dst=normalized?plane[at]/(2**normalized.rgbaFields[lane].bits-1):format===67?plane[at]/255:floatValue(plane[at]),
      factors={1:1,7:[.25,.5,.75,.25][lane],8:.25,23:1-[.25,.5,.75,.25][lane],24:.75},
      source=lane===3?f.alphaSource??1:f.source??1,destination=lane===3?f.alphaDestination??1:f.destination??1;
    const value=format===67||normalized?Math.max(0,Math.min(1,src)):src,equation=lane===3?f.alphaFunction??0:f.rgbFunction??0,a=value*factors[source],b=dst*factors[destination];
    raw=word(equation===0?a+b:equation===1?a-b:equation===2?b-a:equation===3?Math.min(value,dst):Math.max(value,dst));
   }
   plane[at]=nativeWord(format,raw,lane,kind);
  }
 }
 return planes;
}
export function miss(actual,expected,format){
 const packed=normalizedFormat(format);
 if(packed){
  const view=new DataView(actual.buffer,actual.byteOffset,actual.byteLength),rows=[];
  if(actual.byteLength!==expected.length)return[{bytes:actual.byteLength,expected:expected.length}];
  for(let i=0;i<expected.length;i++){
   const lane=i%4,field=packed.rgbaFields[lane],mask=2**field.bits-1;
   const observed=packed.guestPixelBytes===4?(view.getUint32(Math.floor(i/4)*4,true)>>>packed.nativeOffsets[lane])&mask:field.bits?Math.round(actual[i]*mask/255):actual[i]/255;
   if(observed!==expected[i]&&rows.length<16)rows.push({at:i,observed,expected:expected[i]});
  }return rows;
 }

 const native=format===67?new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength):new Uint32Array(actual.buffer,actual.byteOffset,actual.byteLength/4),rows=[];
 if(native.length!==expected.length)return[{observed:native.length,expected:expected.length}];
 for(let i=0;i<native.length;i++)if(native[i]!==expected[i])rows.push({at:i,observed:native[i],expected:expected[i]});return rows;
}
