// Independent production matrix: literal original queues, original DMA and raw sampled words.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join,shader,word,sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';

const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const metadata=(id,target,format,bind,width,height,depth=1,arraySize=1,lastLevel=0)=>({id,target,format,bind,width,height,depth,arraySize,lastLevel,nrSamples:0,flags:0});
const keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
const allocation=m=>{const b=header(0x204,0,72);keys.forEach((k,i)=>put(b,24+4*i,m[k]));return b;};
const surface=(handle,id,format,level,layer)=>packet(1,8,[handle,id,format,level,(layer|layer<<16)>>>0]);
const draw=()=>packet(8,0,[0,1,0,0,1,0,0,0,0,0,0xffffffff,0]);
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const formats=[
  {id:64,name:'R8_UNORM',bytes:1,kind:'unorm',components:1},
  {id:65,name:'RG8_UNORM',bytes:2,kind:'unorm',components:2},
  {id:94,name:'RGBA16_FLOAT',bytes:8,kind:'half',components:4},
  {id:31,name:'RGBA32_FLOAT',bytes:16,kind:'float',components:4},
  {id:196,name:'RGBA32_UINT',bytes:16,kind:'uint',components:4},
  {id:200,name:'RGBA32_SINT',bytes:16,kind:'sint',components:4},
  {id:5,name:'B5G5R5A1_UNORM',bytes:2,kind:'packed16',components:4},
  {id:124,name:'R11G11B10_FLOAT',bytes:4,kind:'packedFloat',components:3},
  {id:74,name:'R8_SNORM',bytes:1,kind:'snorm',components:1,sampleOnly:true},
  {id:104,name:'RGBA8_SRGB',bytes:4,kind:'srgb',components:4},
  {id:125,name:'RGB9E5_FLOAT',bytes:4,kind:'shared',components:3,sampleOnly:true},
  {id:225,name:'B10G10R10A2_UINT',bytes:4,kind:'packedUint',components:4},
  {id:2,name:'B8G8R8X8_UNORM',bytes:4,kind:'bgra',components:3},
  {id:66,name:'RGB8_UNORM',bytes:3,kind:'unorm',components:3},
];
// Predictions come solely from these fixed guest input schemas, never host output.
function channels(f,level,z,y,x,mode='input') {
  if(mode==='clear')return ['uint','packedUint'].includes(f.kind)?[5,6,7,1]:f.kind==='sint'?[-5,-6,-7,1]:[1,0,1,0];
  if(mode==='paint')return ['uint','packedUint'].includes(f.kind)?[1,2,3,1]:f.kind==='sint'?[-1,-2,-3,1]:[0,1,0,1];
  const code=level*19+z*7+y*3+x;
  if(f.kind==='uint'||f.kind==='packedUint')return [17+code,29+code,43+code,1];
  if(f.kind==='sint')return [-17-code,-29-code,-43-code,1];
  if(f.kind==='snorm')return [code&1?-1:1,0,0,1];
  if(['half','float'].includes(f.kind))return [0.25*(1+(code%4)),0.25*(1+((code+1)%4)),0.25*(1+((code+2)%4)),1];
  if(f.kind==='packedFloat')return [code&1?0.5:1,code&2?0.5:1,code&4?0.5:1,1];
  if(f.kind==='shared')return [0.125*(1+code%3),0.5,0.75,1];
  return [code&1?1:0,code&2?1:0,code&4?1:0,code&8?1:0];
}
function sampled(f,c) {return [0,1,2,3].map(k=>k<f.components?c[k]:k===3?1:0);}
function encode(f,c) {
  const b=new Uint8Array(f.bytes),v=new DataView(b.buffer);
  if(['uint','sint','float'].includes(f.kind))for(let i=0;i<f.components;i++)v[f.kind==='float'?'setFloat32':f.kind==='sint'?'setInt32':'setUint32'](i*4,c[i],true);
  else if(f.kind==='half')for(let i=0;i<4;i++)v.setUint16(i*2,({0:0,.25:0x3400,.5:0x3800,.75:0x3a00,1:0x3c00})[c[i]],true);
  else if(f.kind==='packed16')v.setUint16(0,(c[2]?31:0)|((c[1]?31:0)<<5)|((c[0]?31:0)<<10)|((c[3]?1:0)<<15),true);
  else if(f.kind==='packedUint')v.setUint32(0,(c[2]|c[1]<<10|c[0]<<20|c[3]<<30)>>>0,true);
  else if(f.kind==='packedFloat')v.setUint32(0,((c[0]===0?0:c[0]===1?15:14)<<6)|((c[1]===0?0:c[1]===1?15:14)<<17)|((c[2]===0?0:c[2]===1?15:14)<<27),true);
  else if(f.kind==='shared')v.setUint32(0,(Math.round(c[0]*512)|Math.round(c[1]*512)<<9|Math.round(c[2]*512)<<18|15<<27)>>>0,true);
  else if(f.kind==='bgra')b.set([c[2]*255,c[1]*255,c[0]*255,255]);
  else if(f.kind==='snorm')b[0]=c[0]<0?129:127;
  else for(let i=0;i<f.components;i++)b[i]=c[i]*255;
  return b;
}
function plane(f,target,level) {
  const width=4>>level,height=4>>level,layers=target===3?4>>level:target===4?6:3,bytes=new Uint8Array(width*height*layers*f.bytes);
  for(let z=0;z<layers;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes.set(encode(f,channels(f,level,z,y,x)),((z*height+y)*width+x)*f.bytes);
  return {level,width,height,layers,bytes};
}
function memory(rig,index,c) {
  const cuts=[7,17,53,101,3918],entries=cuts.map((n,i)=>[rig.q.base+0x210000n+BigInt(index*0x10000+i*0x2000),n]);
  entries.forEach(([a,n])=>rig.q.write(a-8n,new Uint8Array(n+16).fill(0xa3)));
  return {entries,write(b){c.equal(b.length,4096,'complete SG input');let at=0;for(const[a,n]of entries){rig.q.write(a,b.subarray(at,at+n));at+=n;}},
    read(){const b=new Uint8Array(4096);let at=0;for(const[a,n]of entries){b.set(rig.q.read(a,n),at);at+=n;}return b;},
    guards(){for(const[a,n]of entries){c.equal(hex(rig.q.read(a-8n,8)),'a3'.repeat(8),'SG prefix guard');c.equal(hex(rig.q.read(a+BigInt(n),8)),'a3'.repeat(8),'SG suffix guard');}}};
}
const request=(id,p,f,direction)=>{const stride=p.width*f.bytes+7,layerStride=stride*p.height+11,b=transfer(1,id,direction,[0,0,0,p.width,p.height,p.layers],5n,stride,layerStride,0x20000000000001n);put(b,60,p.level);return {b,stride,layerStride};};
function padded(p,f,r,fill,bytes=p.bytes){const b=new Uint8Array(4096).fill(fill);for(let z=0;z<p.layers;z++)for(let y=0;y<p.height;y++)b.set(bytes.subarray((z*p.height+y)*p.width*f.bytes,(z*p.height+y+1)*p.width*f.bytes),5+z*r.layerStride+y*r.stride);return b;}
function traceGL(native,row){
  const ids=new WeakMap();let next=1;const enc=v=>ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))}:Array.isArray(v)?v.map(enc):v&&typeof v==='object'?(ids.has(v)?ids.get(v):(ids.set(v,next),next++)):v;
  return new Proxy(native,{get(target,name){const fn=Reflect.get(target,name,target);if(typeof fn!=='function')return fn;return(...args)=>{
    const entry={sequence:row.native.length,name,args:args.map(enc)};row.native.push(entry);const result=fn.apply(target,args);entry.result=enc(result);
    if(name==='getBufferSubData')entry.output=args.map(enc);return result;
  };}});
}
async function one(Wasm,qualification,native,compiler,f,target,schedule){
  const c=checker(),row={name:f.name+'/target'+target,schedule,predictions:{roundTrip:'every original public byte preserved; all SG padding/guards unchanged',privateRange:'mip1 and array layers1..2 yield literal raw sampled words',surface:'only selected mip1/layer and point may change, then private view refresh sees paint'},native:[],inputs:[],outputs:[]};
  const Selected=class{constructor(callback){return Wasm.qualified(callback,qualification.hostWords,qualification.formatRoles,qualification.renderer);}};
  const bridge=opts=>createVirglProductionBridge({...opts,presenter:createWorkerScanoutPresenter(()=>{})});
  const rig=makeRig(Selected,bridge,traceGL(native,row),compiler,c,schedule,true,false,true),ram=new Map();
  const levels=[plane(f,target,0),plane(f,target,1)],selectedLayer=target===4?4:target===7?2:1;
  const m=metadata(6,target,f.id,f.sampleOnly?8:10,4,4,target===3?4:1,target===4?6:target===7?3:1,1);
  row.source=m;
  window.__productionCriticActive=()=>({row,guest:copy(rig.q.vm.inspect()),host:copy(rig.host.bridge.inspect())});
  try {
    await rig.expect('original context',context(1));
    for(const [index,meta]of [m,metadata(1,2,196,2,1,1),metadata(3,0,64,16,16,1)].entries()){
      await rig.expect('original create '+meta.id,allocation(meta));const mem=memory(rig,index,c);ram.set(meta.id,mem);await rig.expect('original backing '+meta.id,backing(meta.id,mem.entries));await rig.expect('original membership '+meta.id,idCommand(0x202,1,meta.id));
    }
    for(const p of levels){const r=request(6,p,f,1);ram.get(6).write(padded(p,f,r,0x8d));const at=rig.exchanges.length;row.inputs.push({level:p.level,bytes:hex(p.bytes),record:await rig.expect('original dimensional205 mip'+p.level,r.b)});c.equal(rig.exchanges[at].bytes,hex(p.bytes),'entire original upload selection');ram.get(6).guards();}
    const roundTrip=async(label,wanted=levels)=>{for(const p of wanted){const r=request(6,p,f,2);ram.get(6).write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length;const record=await rig.expect(label+'206 mip'+p.level,r.b),actual=ram.get(6).read(),expected=padded(p,f,r,0x4e);row.outputs.push({label,level:p.level,dense:rig.exchanges[at].bytes,expectedDense:hex(p.bytes),actual:hex(actual),expected:hex(expected),record});c.equal(rig.exchanges[at].bytes,hex(p.bytes),label+' complete public roundtrip');c.equal(hex(actual),hex(expected),label+' complete SG/padding');ram.get(6).guards();}};
    await roundTrip('before-');
    const position=new Uint8Array(4096).fill(0x91);position.set(new Uint8Array(new Float32Array([0,0,0,1]).buffer),5);ram.get(3).write(position);await rig.expect('original point position',transfer(1,3,1,[0,0,0,16,1,1],5n));
    const dimension=({3:'3D',4:'CUBE',7:'2D_ARRAY'})[target],type=f.kind==='sint'?'SINT':['uint','packedUint'].includes(f.kind)?'UINT':'FLOAT';
    const coordinate=target===4?[0,0,1,0]:[.25,.75,target===3?.75:1,0];
    const fragment=`FRAG\nDCL OUT[0], COLOR\nDCL SAMP[7]\nDCL SVIEW[7], ${dimension}, ${type}\nIMM[0] FLT32 {${coordinate.join(',')}}\n0: TXL OUT[0], IMM[0], SAMP[7], ${dimension}\n1: END\n`;
    row.tgsi={vertex,fragment};
    const layers=target===4?5<<16:target===7?1|2<<16:0,view=packet(1,6,[50,6,(f.id|target<<24)>>>0,layers,1|1<<8,0x688]);
    const viewport=(w,h)=>packet(4,0,[0,...[w/2,h/2,.5,w/2,h/2,.5].map(word)]);
    await rig.expect('original private view/shaders/state',submission(1,join(view,sampler(51,{s:2,t:2,r:2}),packet(10,0,[1,7,50]),packet(18,0,[1,7,51]),shader(10,0,vertex),shader(11,1,fragment),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,196,0,0),packet(5,0,[1,0,20]),viewport(1,1),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]))));
    const sample=async(label,value)=>{
      await rig.expect(label+' original DRAW_VBO',submission(1,draw(),0x20000000000003n));
      const p={level:0,width:1,height:1,layers:1},r=request(1,p,{bytes:16},2);ram.get(1).write(new Uint8Array(4096).fill(0x5f));const at=rig.exchanges.length;const record=await rig.expect(label+' original output206',r.b),data=new Uint8Array(16),v=new DataView(data.buffer);
      sampled(f,value).forEach((n,i)=>v.setUint32(i*4,type==='FLOAT'?word(n):n>>>0,true));
      row.outputs.push({label,expected:hex(data),actual:rig.exchanges[at].bytes,record});c.equal(rig.exchanges[at].bytes,hex(data),label+' exact literal sampled raw words');ram.get(1).guards();
    };
    const sampleX=target===4?1:0;
    await sample('private-mip-layer',channels(f,1,selectedLayer,1,sampleX));
    if(!f.sampleOnly){
      const paintType=type==='FLOAT'?'FLT32':type==='UINT'?'UINT32':'INT32',paint=channels(f,1,selectedLayer,1,sampleX,'paint'),clearValue=channels(f,1,selectedLayer,1,sampleX,'clear');
      const paintFragment=`FRAG\nDCL OUT[0], COLOR\nIMM[0] ${paintType} {${paint.join(',')}}\n0: MOV OUT[0], IMM[0]\n1: END\n`;
      const point=new Uint8Array(4096).fill(0x93);point.set(new Uint8Array(new Float32Array([sampleX-.5,.5,0,1]).buffer),5);ram.get(3).write(point);await rig.expect('original selected-layer point',transfer(1,3,1,[0,0,0,16,1,1],5n));
      const clearWords=clearValue.map(n=>type==='FLOAT'?word(n):n>>>0);
      await rig.expect('original selected-layer surface clear/draw',submission(1,join(shader(13,1,paintFragment),surface(21,6,f.id,1,selectedLayer),packet(5,0,[1,0,21]),viewport(2,2),packet(31,0,[13,1]),packet(7,0,[4,...clearWords,0,0,0]),draw()),0x20000000000005n));
      const wanted=levels.map(p=>({...p,bytes:p.bytes.slice()})),p=wanted[1];for(let y=0;y<2;y++)for(let x=0;x<2;x++)p.bytes.set(encode(f,clearValue),((selectedLayer*2+y)*2+x)*f.bytes);p.bytes.set(encode(f,paint),((selectedLayer*2+1)*2+sampleX)*f.bytes);
      await roundTrip('after-layer-',wanted);
      point.set(new Uint8Array(new Float32Array([0,0,0,1]).buffer),5);ram.get(3).write(point);await rig.expect('original restored output point',transfer(1,3,1,[0,0,0,16,1,1],5n));
      await rig.expect('original retained private view refresh',submission(1,join(packet(5,0,[1,0,20]),viewport(1,1),packet(31,0,[11,1]))));await sample('private-refresh',paint);
    }
    c.equal(native.getError(),native.NO_ERROR,'zero actual WebGL errors');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{
    row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());
    const disposed=rig.host.bridge.dispose();rig.q.vm.free();row.disposed=copy(disposed);row.cleaned=rig.trace.snapshot();row.assertions=c.assertions;
    if(row.cleaned.liveObjects!==0||row.cleaned.liveSyncs!==0){row.status='failed';row.cleanupFailure='Native GPU owners leaked';}
    window.__productionCriticActive=null;
  }
  return row;
}
export async function runProductionCritic({WasmVirglSubmitProof,formatIds=null,targets=[3,4,7],schedules=[0]}){
  const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});if(!native)throw Error('Hardware WebGL2 unavailable');
  const qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',qualification:copy(qualification),rows:[],actualLinuxGuest:false,productionConstructor:true};window.__productionCriticReport=report;
  for(const schedule of schedules)for(const f of formats.filter(f=>!formatIds||formatIds.includes(f.id)))for(const target of targets){
    const row=await one(WasmVirglSubmitProof,qualification,native,compiler,f,target,schedule);const index=report.rows.length;
    if(window.__recordProductionCriticRun)report.rows.push({...await window.__recordProductionCriticRun(index,JSON.stringify(row)),name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});else report.rows.push(row);
  }
  report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed').map(r=>({name:r.name,failure:r.failure})),hardware:qualification.identity};return report;
}
