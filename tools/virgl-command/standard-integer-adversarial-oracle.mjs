// Fresh critic: literal ABI, little-endian integer expansion, original packet/TGSI
// interpreter. This file imports no runtime descriptor, worker oracle or compiler.
const fail=(condition,label)=>{if(!condition)throw Error('integer critic: '+label);};
const f=Math.fround,v=new DataView(new ArrayBuffer(4));
const bits=n=>{v.setFloat32(0,n,true);return v.getUint32(0,true);};
const numeric=n=>{v.setUint32(0,n,true);return v.getFloat32(0,true);};
const rawHex=s=>Uint8Array.from(s.match(/../g)??[],n=>parseInt(n,16));
export function criticIntegerFormat(value){
 const definitions=[[28,4,5126,false,false],[177,1,5121,false,true],[181,1,5120,true,true],[185,2,5123,false,true],[189,2,5122,true,true],[193,4,5125,false,true],[197,4,5124,true,true]];
 const row=definitions.find(([base])=>value>=base&&value<=base+3);fail(row,'literal source enum '+value);
 const [base,bytes,type,signed,integer]=row;
 return {bytes,components:value-base+1,type,signed,integer,shaderType:integer?signed?35669:36296:35666};
}
export function criticIntegerScalar(raw,at,format){
 const d=criticIntegerFormat(format);fail(at>=0&&at+d.bytes*d.components<=raw.length,'source extent');
 const words=[0,0,0,d.integer?1:0x3f800000],values=[0,0,0,1];
 for(let k=0;k<d.components;k++){
  let magnitude=0n;for(let j=0;j<d.bytes;j++)magnitude|=BigInt(raw[at+k*d.bytes+j])<<BigInt(8*j);
  if(d.integer){const width=BigInt(d.bytes*8),integer=d.signed?BigInt.asIntN(Number(width),magnitude):magnitude;
   words[k]=Number(BigInt.asUintN(32,integer));values[k]=Number(integer);
  }else {words[k]=Number(magnitude);values[k]=numeric(words[k]);}
 }
 return {words,values};
}
export function criticIntegerPackets(history){
 const contexts=new Map();
 for(const event of history){
  const s=contexts.get(event.ctx)??{objects:new Map(),buffers:[],shaders:new Map(),raster:{size:1,bits:0},uploads:[]};contexts.set(event.ctx,s);
  const raw=rawHex(event.hex),dv=new DataView(raw.buffer);
  for(let at=0;at<raw.length;){
   fail(at+4<=raw.length,'packet header');const h=dv.getUint32(at,true),n=h>>>16,op=h&255,kind=h>>>8&255;
   fail(at+(n+1)*4<=raw.length,'packet length');const w=Array.from({length:n},(_,i)=>dv.getUint32(at+4+i*4,true));
   if(op===1&&kind===5){fail((n-1)%4===0,'element words');s.objects.set(w[0],Array.from({length:(n-1)/4},(_,i)=>({sourceOffset:w[1+4*i],divisor:w[2+4*i],slot:w[3+4*i],format:w[4+4*i]})));}
   else if(op===2&&kind===5)s.elements=s.objects.get(w[0]);
   else if(op===6)s.buffers=Array.from({length:n/3},(_,i)=>({stride:w[3*i],offset:w[3*i+1],id:w[3*i+2]}));
   else if(op===11)s.index=n===1?null:{id:w[0],bytes:w[1],offset:w[2]};
   else if(op===8)s.draw={start:w[0],count:w[1],mode:w[2],indexed:w[3]===1,instances:Math.max(1,w[4]),restart:w[7]===1,marker:w[8]};
   else if(op===1&&kind===4)s.objects.set(w[0],{stage:w[1],text:new TextDecoder().decode(raw.subarray(at+24,at+24+w[2]-1))});
   else if(op===31)s.shaders.set(w[1],s.objects.get(w[0]).text);
   else if(op===1&&kind===2)s.objects.set(w[0],{bits:w[1],size:numeric(w[2])});
   else if(op===2&&kind===2)s.raster=s.objects.get(w[0]);
   else if(op===4)s.viewport=w.slice(1).map(numeric);
   else if(op===43)s.uploads.push({id:w[0],offset:w[5],width:w[8],direction:w[12]});
   at+=4*(n+1);
  }
 }
 const s=contexts.get(history.at(-1).ctx);fail(s?.draw&&s.elements&&s.shaders.size===2,'selected original draw');return s;
}
function execute(text,inputs,systems){
 const registers=new Map();inputs.forEach((a,i)=>registers.set('IN['+i+']',a.words.slice()));
 for(const line of text.split('\n')){
  let m=line.match(/^IMM\[(\d+)\] (FLT32|UINT32) \{([^}]+)\}$/);if(m)registers.set('IMM['+m[1]+']',m[3].split(',').map(n=>m[2]==='FLT32'?bits(Number(n)):Number(n)>>>0));
  m=line.match(/^DCL SV\[(\d+)\], (VERTEXID|INSTANCEID)$/);if(m)registers.set('SV['+m[1]+']',Array(4).fill(systems[m[2]]>>>0));
 }
 const operand=s=>{const m=s.match(/^(IN|OUT|TEMP|IMM|SV)\[(\d+)\](?:\.([xyzw]+))?$/);fail(m,'operand '+s);const key=m[1]+'['+m[2]+']';if(!registers.has(key))registers.set(key,[0,0,0,0]);return {key,lanes:[...(m[3]??'xyzw')].map(c=>'xyzw'.indexOf(c)),data:registers.get(key)};};
 for(const line of text.split('\n')){
  const m=line.match(/^\d+: (\w+)(?: (.*))?$/);if(!m)continue;const op=m[1];if(op==='END')break;
  const args=m[2].split(',').map(x=>x.trim()),dst=operand(args.shift()),src=args.map(operand),out=dst.data.slice();
  for(const k of dst.lanes){const read=i=>src[i].data[src[i].lanes.length===1?src[i].lanes[0]:src[i].lanes[k]],num=i=>numeric(read(i));let w;
   if(op==='MOV')w=read(0);
   else if(op==='USHR')w=read(0) >>> (read(1)&31);
   else if(op==='AND')w=(read(0)&read(1))>>>0;
   else if(op==='XOR')w=(read(0)^read(1))>>>0;
   else if(op==='UADD'||op==='IADD')w=Number(BigInt.asUintN(32,BigInt(read(0))+BigInt(read(1))));
   else if(op==='I2F')w=bits(Number(BigInt.asIntN(32,BigInt(read(0)))));
   else if(op==='U2F')w=bits(read(0));
   else if(op==='MUL')w=bits(num(0)*num(1));
   else if(op==='MAD')w=bits(f(num(0)*num(1))+num(2));
   else if(op==='SEQ')w=bits(num(0)===num(1)?1:0);
   else throw Error('integer critic: original opcode '+op);
   out[k]=w;
  }
  registers.set(dst.key,out);
 }
 return registers;
}
export function criticIntegerModel(history,buffers,range){
 const s=criticIntegerPackets(history),d=s.draw;fail(d.mode===0,'point proof domain');
 const raw=d.indexed?buffers.get(s.index.id):null;
 const little=(at,n)=>{let value=0;for(let j=0;j<n;j++)value+=raw[at+j]*2**(j*8);return value;};
 const ids=Array.from({length:d.count},(_,i)=>d.indexed?little(s.index.offset+i*s.index.bytes,s.index.bytes):d.start+i),valid=ids.filter(n=>!d.restart||n!==d.marker);
 const min=valid.length?Math.min(...valid):null,max=valid.length?Math.max(...valid):null,sentinel=d.indexed?2**(8*s.index.bytes)-1:null;
 const normalize=d.indexed&&ids.some(n=>d.restart&&n===d.marker?n!==sentinel:n===sentinel),nativeSize=normalize?4:d.indexed?s.index.bytes:0,nativeOffset=normalize?0:d.indexed?s.index.offset:0;
 const normalized=new Uint8Array(normalize?d.count*4:0);if(normalize)ids.forEach((n,i)=>{const word=d.restart&&n===d.marker?0xffffffff:n;for(let j=0;j<4;j++)normalized[i*4+j]=word>>>8*j&255;});
 const declared=new Set([...s.shaders.get(0).matchAll(/^DCL IN\[(\d+)\]$/gm)].map(m=>Number(m[1])));
 const fetches=s.elements.map((e,attributeIndex)=>{
  if(!declared.has(attributeIndex))return null;const b=s.buffers[e.slot],a=criticIntegerFormat(e.format),constant=b.stride===0,offset=b.offset+e.sourceOffset;
  fail(offset%a.bytes===0&&b.stride%a.bytes===0&&b.stride<=255,'effective pointer alignment');
  const first=min===null?null:constant||e.divisor?0:min,last=max===null?null:constant?0:e.divisor?Math.floor((d.instances-1)/e.divisor):max,end=last===null?null:offset+last*b.stride+a.bytes*a.components;
  fail(end===null||end<=buffers.get(b.id).length,'last fetched byte');const generic=constant?criticIntegerScalar(buffers.get(b.id),offset,e.format):null;
  return {attributeIndex,resourceId:b.id,stride:b.stride,offset,components:a.components,sourceFormat:e.format,elementBytes:a.bytes*a.components,nativeType:a.type,normalized:false,constant,integer:a.integer,signed:a.signed,shaderType:a.shaderType,divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),firstElement:first,lastElement:last,firstByte:first===null?null:offset+first*b.stride,requiredEnd:end,...(generic?{genericValues:generic.values,genericWords:generic.words,componentWords:generic.words.slice(0,a.components)}:{})};
 }).filter(Boolean);
 const points=[],pointSize=Math.min(range[1],Math.max(range[0],s.raster.size));
 for(let instance=0;instance<d.instances;instance++)for(const id of valid){
  const inputs=s.elements.map(e=>{const b=s.buffers[e.slot],index=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id;return criticIntegerScalar(buffers.get(b.id),b.offset+e.sourceOffset+index*b.stride,e.format);});
  const registers=execute(s.shaders.get(0),inputs,{VERTEXID:id,INSTANCEID:instance}),p=registers.get('OUT[0]').map(numeric);if(p[3]===0)continue;
  const color=execute(s.shaders.get(1),[{words:registers.get('OUT[1]')}],{}).get('OUT[0]').map(numeric);fail(color.every(Number.isFinite),'integer source never permits arithmetic NaN waiver');
  points.push({id,instance,x:p[0]/p[3]*Math.abs(s.viewport[0])+s.viewport[3],y:p[1]/p[3]*s.viewport[1]+s.viewport[4],size:pointSize,color:color.map(n=>Math.round(Math.max(0,Math.min(1,n))*255))});
 }
 let signedMask=0,unsignedMask=0;for(const a of fetches)if(a.integer){if(a.signed)signedMask|=1<<a.attributeIndex;else unsignedMask|=1<<a.attributeIndex;}
 return {state:s,draw:d,ids,min,max,valid:valid.length,restarts:ids.length-valid.length,normalize,nativeSize,nativeOffset,normalized,fetches,points,effective:d.instances,index:s.index,pointUniform:[s.raster.size,0],signedMask,unsignedMask,wordMode:/^\d+: USHR /m.test(s.shaders.get(0)),pixel(x,y){let color=[0,0,0,0];for(const p of points)if(x+.5>p.x-p.size/2&&x+.5<p.x+p.size/2&&y+.5>p.y-p.size/2&&y+.5<p.y+p.size/2)color=p.color;return color;}};
}
export function criticIntegerCompare(raw,m,width,height){
 const misses=[];let maxError=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const expected=m.pixel(x,y),observed=Array.from(raw.subarray(4*(y*width+x),4*(y*width+x+1))),error=Math.max(...observed.map((n,i)=>Math.abs(n-expected[i])));maxError=Math.max(maxError,error);
  if(error>(m.wordMode?0:1)&&misses.length<8)misses.push({x,y,expected,observed,error});
 }
 return {held:misses.length===0,pixels:width*height,maxError,misses,nanPixels:0,portableNaNPayload:false};
}
