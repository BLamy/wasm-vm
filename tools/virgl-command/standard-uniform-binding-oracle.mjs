/** Independent, test-only interpreter of the literal original packet specimens. */
import assert from 'node:assert/strict';
const bits=new DataView(new ArrayBuffer(4));
export const floatWord=value=>{bits.setFloat32(0,value,true);return bits.getUint32(0,true);};
const floating=value=>{bits.setUint32(0,value,true);return bits.getFloat32(0,true);};
const words=bytes=>Array.from({length:bytes.length/4},(_,i)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(i*4,true));
export function originalPackets(hex){
 const bytes=Uint8Array.from(hex.match(/../g)??[],value=>parseInt(value,16)),view=new DataView(bytes.buffer),packets=[];
 for(let at=0;at<bytes.length;){const h=view.getUint32(at,true),count=h>>>16,end=at+4+count*4;assert.ok(end<=bytes.length);packets.push({op:h&255,kind:(h>>>8)&255,fields:words(bytes.subarray(at+4,end)),bytes:bytes.subarray(at,end)});at=end;}
 return packets;
}
function newState(){return{objects:new Map(),shaders:[null,null],banks:[new Map(),new Map()],inline:[[],[]],elements:[],buffers:[],index:null};}
export function originalDraw(frame,uploads){
 const publicResources=new Map(),contexts=new Map();let last;
 for(const[ordinal,submission]of frame.history.entries()){
  for(const row of frame.created.filter(row=>row.beforeSubmission===ordinal))publicResources.set(row.metadata.id,row.generation);
  if(!contexts.has(submission.ctx))contexts.set(submission.ctx,{current:0,subs:new Map([[0,newState()]])});const ctx=contexts.get(submission.ctx);
  for(const packet of originalPackets(submission.hex)){
   const f=packet.fields;let state=ctx.subs.get(ctx.current);
   if(packet.op===29){ctx.subs.set(f[0],newState());continue;}
   if(packet.op===28){ctx.current=f[0];assert.ok(ctx.subs.has(f[0]));continue;}
   if(packet.op===30){ctx.subs.delete(f[0]);continue;}
   if(packet.op===1&&packet.kind===4){const text=new TextDecoder().decode(packet.bytes.subarray(24)).split('\0')[0];state.objects.set(f[0],{kind:4,stage:f[1],text});}
   if(packet.op===1&&packet.kind===5){const elements=[];for(let i=1;i<f.length;i+=4)elements.push({offset:f[i],divisor:f[i+1],buffer:f[i+2],format:f[i+3]});state.objects.set(f[0],{kind:5,elements});}
   if(packet.op===2&&packet.kind===5)state.elements=state.objects.get(f[0]).elements;
   if(packet.op===31)state.shaders[f[1]]=state.objects.get(f[0]).text;
   if(packet.op===6){state.buffers=[];for(let i=0;i<f.length;i+=3)state.buffers.push({stride:f[i],offset:f[i+1],id:f[i+2],generation:publicResources.get(f[i+2])});}
   if(packet.op===11)state.index={id:f[0],generation:publicResources.get(f[0]),size:f[1],offset:f[2]};
   if(packet.op===27&&f[0]<2&&f[1]<13){if(f[4])state.banks[f[0]].set(f[1],{id:f[4],generation:publicResources.get(f[4]),offset:f[2],length:f[3]});else state.banks[f[0]].delete(f[1]);}
   if(packet.op===12&&f[0]<2){state.banks[f[0]].delete(f[1]);if(f[1]===0)state.inline[f[0]]=f.slice(2);}
   if(packet.op===8){
    const snapshot={shaders:[...state.shaders],banks:state.banks.map(row=>new Map(row)),inline:state.inline.map(row=>[...row]),elements:state.elements.map(row=>({...row})),buffers:state.buffers.map(row=>({...row})),index:state.index?{...state.index}:null,fields:f};
    last=interpret(snapshot,uploads);
   }
  }
 }
 assert.ok(last,'literal original draw');return last;
}
function valuesAt(bytes,at,format){
 assert.ok(bytes&&at>=0);const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if([31,196,200].includes(format)){assert.ok(at+16<=bytes.length);return Array.from({length:4},(_,k)=>v.getUint32(at+k*4,true));}
 assert.ok([172,173].includes(format)&&at+4<=bytes.length);const raw=v.getUint32(at,true),out=[];
 for(let k=0;k<4;k++){const width=k===3?2:10,bits=(raw>>>(k*10))&((1<<width)-1),n=bits&(1<<(width-1))?bits-(1<<width):bits;out.push(floatWord(format===172?n:Math.max(-1,n/((1<<(width-1))-1))));}return out;
}
function execute(text,inputs,constant){
 const registers=new Map(),immediates=new Map(),out=new Map();let address=0;
 for(const match of text.matchAll(/^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}/gm))immediates.set(+match[1],match[3].split(',').map(value=>match[2]==='FLT32'?floatWord(Number(value)):Number(value)>>>0));
 const source=operand=>{
  const c=operand.match(/^CONST\[(\d+)\]\[(.+)\]$/);if(c){const relative=c[2].match(/^ADDR\[0\]\.x(?: ([+-]\d+))?$/);return constant(+c[1],relative?address+Number(relative[1]??0):Number(c[2]));}
  const m=operand.match(/^(IN|IMM|TEMP|OUT)\[(\d+)\](?:\.([xyzw]{4}))?$/);assert.ok(m,'literal TGSI source '+operand);const vector=m[1]==='IN'?inputs[+m[2]]:m[1]==='IMM'?immediates.get(+m[2]):m[1]==='OUT'?out.get(+m[2]):registers.get(+m[2]);assert.ok(vector);return m[3]?[...m[3]].map(k=>vector['xyzw'.indexOf(k)]):[...vector];
 };
 for(const row of text.split('\n')){
  const instruction=row.match(/^\d+: (\w+)(?: (.+))?$/);if(!instruction)continue;const op=instruction[1];if(op==='END')break;
  const[destination,...args]=instruction[2].split(',').map(value=>value.trim()),a=source(args[0]),b=args[1]?source(args[1]):null;
  if(op==='ARL'){assert.equal(destination,'ADDR[0].x');address=Math.floor(floating(a[0]));continue;}
  const result=a.map((x,k)=>{
   switch(op){case'MOV':return x;case'UADD':return(x+b[k])>>>0;case'USHR':return x>>>(b[k]&31);case'AND':return(x&b[k])>>>0;case'U2F':return floatWord(x);case'MUL':return floatWord(floating(x)*floating(b[k]));default:throw Error('unmodeled original instruction '+op);}
  });
  const d=destination.match(/^(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?$/);assert.ok(d);const target=d[1]==='OUT'?out:registers,previous=target.get(+d[2])??[0,0,0,0];for(const lane of d[3]??'xyzw')previous['xyzw'.indexOf(lane)]=result['xyzw'.indexOf(lane)];target.set(+d[2],previous);
 }
 return out;
}
function interpret(state,uploads){
 const declared=state.shaders.map(text=>[...text.matchAll(/^DCL CONST\[(\d+)\]\[0\.\.(\d+)\]/gm)].map(m=>({slot:+m[1],count:+m[2]+1})));
 const zeroMask=state.banks.reduce((mask,banks,stage)=>mask|(banks.has(0)&&declared[stage].some(row=>row.slot===0)?1<<stage:0),0);
 const constant=stage=>(slot,vector)=>{
  const declaration=declared[stage].find(row=>row.slot===slot);assert.ok(declaration&&Number.isInteger(vector)&&vector>=0&&vector<declaration.count);
  const bank=state.banks[stage].get(slot);if(!bank){assert.equal(slot,0);const data=state.inline[stage];assert.ok(vector*4+4<=data.length);return data.slice(vector*4,vector*4+4);}
  const raw=uploads.get(bank.generation);assert.ok(raw);assert.ok((vector+1)*16<=bank.length);return words(raw.subarray(bank.offset+vector*16,bank.offset+(vector+1)*16));
 };
 const indices=state.fields[3]?Array.from({length:state.fields[1]},(_,k)=>{const b=uploads.get(state.index.generation),v=new DataView(b.buffer,b.byteOffset,b.length),at=state.index.offset+(state.fields[0]+k)*state.index.size;return state.index.size===2?v.getUint16(at,true):state.index.size===1?v.getUint8(at):v.getUint32(at,true);}):Array.from({length:state.fields[1]},(_,k)=>state.fields[0]+k);
 assert.deepEqual(indices,[0,1,2]);assert.equal(state.fields[2],4);assert.equal(state.fields[4],1);
 const outputs=indices.map(index=>{
  const inputs=state.elements.map(element=>{const buffer=state.buffers[element.buffer];assert.ok(buffer);const at=buffer.offset+element.offset+(buffer.stride?index*buffer.stride:0);return valuesAt(uploads.get(buffer.generation),at,element.format);});
  return execute(state.shaders[0],inputs,constant(0));
 });
 assert.deepEqual(outputs.map(row=>row.get(0).map(floating)),[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],'original triangle covers every target pixel');
 const fragment=execute(state.shaders[1],[outputs[0].get(1)],constant(1));
 for(const row of outputs.slice(1))assert.deepEqual(row.get(1),outputs[0].get(1),'flat varying is constant over original triangle');
 const expected=fragment.get(0).map(value=>Math.round(Math.max(0,Math.min(1,floating(value)))*255));
 return{...state,declared,zeroMask,expected,indices};
}
