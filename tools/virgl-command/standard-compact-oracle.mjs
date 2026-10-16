// Literal VirGL uploads and original TGSI operations only. This oracle never
// imports a renderer format descriptor, scalar unpacker or generated ESSL.
import {literalState,fromHex} from './standard-draw-oracle.mjs';
const f=Math.fround,word=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
export function literalFormat(format){
 for(const [base,bytes,type,kind]of [[28,4,5126,'float'],[48,2,5123,'unorm'],[56,2,5122,'snorm'],[64,1,5121,'unorm'],[74,1,5120,'snorm'],[91,2,5131,'half']])
  if(format>=base&&format<base+4)return {components:format-base+1,bytes,type,kind,normalized:['snorm','unorm'].includes(kind)};
 throw Error('original format outside compact oracle');
}
function halfWord(bits){
 const sign=(bits&32768)<<16,e=bits>>>10&31,m=bits&1023;
 if(e===31)return (sign|0x7f800000|m<<13)>>>0;
 if(e)return (sign|(e+112)<<23|m<<13)>>>0;
 if(!m)return sign>>>0;
 const p=31-Math.clz32(m);
 return (sign|(p+103)<<23|(m-2**p)<<(23-p))>>>0;
}
export function literalValues(raw,offset,format){
 const spec=literalFormat(format),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),values=[0,0,0,1],words=[];
 for(let k=0;k<spec.components;k++){
  const at=offset+k*spec.bytes;let n,bits;
  if(spec.kind==='float'){n=v.getFloat32(at,true);bits=v.getUint32(at,true);}
  else if(spec.kind==='half'){bits=halfWord(v.getUint16(at,true));n=new Float32Array(new Uint32Array([bits]).buffer)[0];}
  else {const signed=spec.kind==='snorm',value=spec.bytes===1?(signed?v.getInt8(at):v.getUint8(at)):(signed?v.getInt16(at,true):v.getUint16(at,true));
   n=f(signed?Math.max(-1,value/(spec.bytes===1?127:32767)):value/(spec.bytes===1?255:65535));bits=word(n);}
  values[k]=n;words.push(bits);
 }
 return {values,words};
}
export function compactModel(history,buffers,range){
 const s=literalState(history),raw=fromHex(history.filter(h=>h.ctx===history.at(-1).ctx).map(h=>h.hex).join('')),v=new DataView(raw.buffer);
 const objects=new Map();let raster={bits:0,size:1},viewport,restart={enabled:false,value:0};
 for(let at=0;at<raw.length;){const header=v.getUint32(at,true),op=header&255,kind=header>>>8&255,n=header>>>16,w=Array.from({length:n},(_,i)=>v.getUint32(at+4+4*i,true));
  if(op===1&&kind===2)objects.set(w[0],{bits:w[1],size:v.getFloat32(at+12,true)});
  if(op===2&&kind===2)raster=w[0]?objects.get(w[0]):{bits:0,size:1};
  if(op===4)viewport=Array.from({length:6},(_,i)=>v.getFloat32(at+8+4*i,true));
  if(op===8)restart={enabled:w[7]===1,value:w[8]};at+=4*(n+1);
 }
 const d=s.draw;if(d.mode!==0)throw Error('original compact fixture must draw points');
 const data=id=>{const raw=buffers.get(id);return new DataView(raw.buffer,raw.byteOffset,raw.byteLength);};
 s.ids=Array.from({length:d.count},(_,i)=>{if(!d.indexed)return d.start+i;const at=s.index.offset+i*s.index.size,q=data(s.index.id);return s.index.size===1?q.getUint8(at):s.index.size===2?q.getUint16(at,true):q.getUint32(at,true);});
 const marker=id=>restart.enabled&&id===restart.value,valid=s.ids.filter(id=>!marker(id));
 s.min=valid.length?Math.min(...valid):null;s.max=valid.length?Math.max(...valid):null;s.valid=valid.length;s.restarts=s.ids.length-valid.length;
 const sentinel=d.indexed?{1:255,2:65535,4:4294967295}[s.index.size]:null;
 s.normalize=s.ids.some(id=>marker(id)?id!==sentinel:id===sentinel);s.nativeSize=s.normalize?4:d.indexed?s.index.size:0;s.nativeOffset=s.normalize?0:d.indexed?s.index.offset:0;
 s.normalized=new Uint8Array(s.normalize?d.count*4:0);if(s.normalize){const q=new DataView(s.normalized.buffer);s.ids.forEach((id,i)=>q.setUint32(4*i,marker(id)?4294967295:id,true));}
 s.fetches=[0,1].map(index=>{const e=s.activeElements[index],b=s.buffers[e.buffer],spec=literalFormat(e.format),offset=b.offset+e.sourceOffset,constant=b.stride===0,first=valid.length===0?null:constant||e.divisor?0:s.min,last=valid.length===0?null:constant?0:e.divisor?Math.floor((s.effective-1)/e.divisor):s.max;
  const generic=constant?literalValues(buffers.get(b.id),offset,e.format):null;
  return {attributeIndex:index,resourceId:b.id,stride:b.stride,offset,components:spec.components,sourceFormat:e.format,elementBytes:spec.components*spec.bytes,nativeType:spec.type,normalized:spec.normalized,constant,
   divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),firstElement:first,lastElement:last,firstByte:first===null?null:offset+first*b.stride,requiredEnd:last===null?null:offset+last*b.stride+spec.components*spec.bytes,
   ...(generic?{genericValues:generic.values,componentWords:generic.words}:{})};});
 const input=(index,instance,id)=>{const e=s.activeElements[index],b=s.buffers[e.buffer],i=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id;return literalValues(buffers.get(b.id),b.offset+e.sourceOffset+i*b.stride,e.format);};
 const vertex=s.shaders.get(0),fragment=s.shaders.get(1);
 for(const text of ['DCL IN[0]','DCL IN[1]','DCL SV[0], INSTANCEID','DCL SV[1], VERTEXID','SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww'])if(!vertex.includes(text))throw Error('original compact vertex body drift');
 if(fragment!=='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n')throw Error('original compact fragment body drift');
 const lane=vertex.match(/MOV TEMP\[2\]\.x, IN\[1\]\.([xyzw]){4}/)?.[1],wordMode=lane!==undefined,selected='xyzw'.indexOf(lane),size=Math.min(range[1],Math.max(range[0],raster.size)),points=[];
 for(let instance=0;instance<s.effective;instance++)for(const id of valid){const a=input(0,instance,id).values,b=input(1,instance,id),w=f((a[2]===id?1:0)*a[3]);if(w!==1)continue;
  const clipX=f(f(a[0]*s.imm[0])+f(f(instance*s.imm[1])+s.imm[2])),clipY=a[1]*(viewport[1]<0?-1:1);
  let color,nan=false;if(wordMode){const bits=b.words[selected]??word(b.values[selected]);color=Array.from({length:4},(_,i)=>bits>>>8*i&255);nan=Number.isNaN(b.values[selected]);}
  else {if(!vertex.includes('MAD OUT[1], IN[1], IMM[1], IMM[3]'))throw Error('original compact color body drift');color=b.values.map((n,i)=>Math.round(Math.max(0,Math.min(1,f(f(n*(i===3?1:.5))+(i===3?0:.5))))*255));}
  points.push({id,instance,x:clipX*Math.abs(viewport[0])+viewport[3],y:clipY*Math.abs(viewport[1])+viewport[4],size,color,nan});
 }
 s.points=points;s.pointUniform=[raster.size,0];s.wordMode=wordMode;
 s.pixel=(x,y)=>{let result={color:[0,0,0,0],nan:false};for(const p of points)if(Math.abs(x+.5-p.x)<p.size/2&&Math.abs(y+.5-p.y)<p.size/2)result={color:p.color,nan:p.nan};return result;};return s;
}
export function compareCompactPixels(raw,model,width,height){
 const misses=[];let maxError=0,nanPixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const observed=[...raw.subarray((y*width+x)*4,(y*width+x+1)*4)],expected=model.pixel(x,y);let error;
  if(expected.nan){const bits=(observed[0]|observed[1]<<8|observed[2]<<16|observed[3]<<24)>>>0;error=(bits&0x7f800000)===0x7f800000&&(bits&0x7fffff)!==0?0:255;nanPixels++;}
  else error=Math.max(...observed.map((n,i)=>Math.abs(n-expected.color[i])));
  maxError=Math.max(maxError,error);if(error>(model.wordMode?0:1)&&misses.length<4)misses.push({x,y,expected,observed,error});
 }
 return {pixels:width*height,nanPixels,maxError,misses,held:misses.length===0,portableNaNPayload:false};
}
