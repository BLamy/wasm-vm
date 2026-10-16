// Original byte-addressed buffer metadata through native queues, DMA and real GPU roles.
import { createVirglStandardShadowTextureShaderBridge } from '../../virgl-shader/standard.mjs';
import { checker, makeRig, context, resource, idCommand, backing, submission, transfer,
  orderedDma, uncertainGpuFailure } from './submit-acceptance.mjs';
import { Selected, modelOwners, acceptedOwners } from './desktop-submit-acceptance.mjs';
import { specimen, setup, draw } from '../../../tools/virgl-command/standard-uniform-binding-fixtures.mjs';
import { packet, join } from './standard-instanced-draws.mjs';
const HINTS=[0,16,32,48,64,80,96,112], OK=0x1100, BAD=0x1205, OOM=0x1201;
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>x instanceof Uint8Array?[...x]:x));
const hex=bytes=>[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
const set32=(bytes,at,v)=>new DataView(bytes.buffer).setUint32(at,v,true);
const metadata=(id,target,format,bind,width,height)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
function active(rig) {
  window.__desktopActive=()=>({records:rig.q.records,events:rig.events,
    native:copy(rig.q.vm.inspect()),submit:copy(rig.q.vm.submitState()),host:copy(rig.host.bridge.inspect()),
    response:[...rig.q.read(rig.q.response+BigInt(((rig.q.next-1)%128)*64),64)]});
}
async function roles(Wasm,factory,gl,shaderBridge,c,seed,hint) {
  const rig=makeRig(Wasm,factory,gl,shaderBridge,c,seed),{q}=rig,model=new Map(),states=[];
  active(rig);
  const alignment=gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
  const s=specimen({seed,alignment:Math.max(32,alignment),count:1024,shift:(seed%4)*8}),bank=s.banks[0];bank.bind=hint;
  c.truth(bank.offset>=64,'aligned prefix fits independent vertex and index input');
  bank.data.set(s.data.get(3),0);
  new DataView(bank.data.buffer).setUint16(48,0,true);
  new DataView(bank.data.buffer).setUint16(50,1,true);
  new DataView(bank.data.buffer).setUint16(52,2,true);
  const rawWords=new DataView(bank.data.buffer),expected=Array.from({length:4},(_,lane)=>
    (((rawWords.getUint32(bank.offset+s.vector*16+lane*4,true)*2)>>>0)>>>s.shift)&255);
  const check=label=>{const point=modelOwners(rig,model,c,label);states.push({label,...point});return point;};
  await rig.expect('buffer context',context(1));
  let cursor=q.base+0x210000n;const memory=new Map();
  const add=async(id,target,format,bind,width,height,data)=>{
    const m=metadata(id,target,format,bind,width,height);
    await rig.expect('buffer create '+id,resource(id,target,format,bind,width,height));model.set(id,m);check('created '+id);
    const split=Math.min(17,data.length-1),entries=[[cursor,split],[cursor+0x10000n,data.length-split]];
    cursor+=0x20000n;memory.set(id,entries);
    for(const [address,length]of entries){q.write(address-8n,new Uint8Array(length+16).fill(0xa3));}
    await rig.expect('buffer backing '+id,backing(id,entries));
    await rig.expect('buffer membership '+id,idCommand(0x202,1,id));check('attached '+id);
  };
  await add(1,2,67,10,16,16,new Uint8Array(1024));
  for(const [id,data]of s.data)await add(id,0,64,id===bank.id?hint:16,data.length,1,data);
  const write=(id,data)=>{let offset=0;for(const [address,length]of memory.get(id)){q.write(address,data.subarray(offset,offset+length));offset+=length;}c.equal(offset,data.length,'complete dirty guest SG write');};
  // Attachment captured A3. These original words become authoritative only via live DMA.
  for(const [id,data]of s.data)write(id,data);
  const commands=join(setup({width:16,height:16},s,{create:false}),
    packet(6,0,[16,0,bank.id]),packet(11,0,[bank.id,2,48]),draw({indexed:true}));
  const request=submission(1,commands,0xffffffffffffffffn),entry=q.enqueue('buffer shared roles '+hint,request);
  q.kick();q.run();c.equal(q.usedIndex(),entry.number,'shared-role admission has no early completion');
  const accepted=copy(rig.events.at(-1));c.equal(accepted.type,'beginJob','native accepted actual shared-role job');
  const owner=accepted.resources.find(v=>v.identity.id===bank.id);
  c.equal(owner.metadata.bind,hint,'accepted original hint');
  const before=check('accepted job');await rig.drain();q.collect(entry);
  c.equal(rig.trace.snapshot().gpuDraws,1,'one actual indexed GPU draw');
  const after=check('GPU draw completed');
  c.same(after.native.resources,before.native.resources,'draw preserves native owners and backing identity');
  c.same(after.host.resources,before.host.resources,'draw preserves host owners and backing identity');
  const input=rig.exchanges.find(v=>v.kind==='input'&&v.bytes===hex(bank.data));
  c.truth(input,'live DMA gathers original full shared-role bank after attach');
  await rig.expect('buffer actual full-plane readback',transfer(1,1,2,[0,0,0,16,16,1],0n,64,1024,7n));
  const pixels=new Uint8Array(1024);let offset=0;
  for(const [address,length]of memory.get(1)){pixels.set(q.read(address,length),offset);offset+=length;}
  for(let i=0;i<256;i++)c.same([...pixels.subarray(i*4,i*4+4)],expected,'shared-role full-plane pixel '+i);
  for(const entries of memory.values())for(const [address,length]of entries){
    c.same([...q.read(address-8n,8)],Array(8).fill(0xa3),'SG prefix guard');
    c.same([...q.read(address+BigInt(length),8)],Array(8).fill(0xa3),'SG suffix guard');
  }
  const plane={pixels:256,expected,bytes:hex(pixels)};
  const pending=q.enqueue('buffer reset cancellation',submission(1,new Uint8Array(),9n));
  q.kick();q.run();c.equal(q.usedIndex(),pending.number,'pending native reset job');
  const epoch=q.vm.inspect().epoch;q.reset();
  c.equal(q.vm.inspect().resources.length,0,'reset clears native buffer owners');
  c.equal(rig.host.bridge.inspect().resources.length,0,'reset clears host buffer owners');
  c.truth(q.vm.inspect().epoch!==epoch,'reset advances ownership epoch');
  c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,0,'reset releases full GPU byte accounting');
  await rig.expect('buffer selected profile after reset',resource(bank.id,0,64,hint,16,1));
  await rig.expect('buffer release after reset',idCommand(0x102,0,bank.id));
  const row={seed,hint,alignment,expected,vertex:s.vertex,fragment:s.fragment,originalData:[...s.data].map(([id,bytes])=>({id,bytes:hex(bytes)})),
    commands:hex(commands),accepted,states,plane,records:q.records,events:rig.events,exchanges:rig.exchanges,
    completions:rig.completions,commandTrace:q.vm.commandTrace(),trace:rig.trace.events,snapshot:rig.trace.snapshot()};
  window.__desktopActive=null;rig.dispose();return row;
}
async function refusals(Wasm,factory,gl,shaderBridge,c) {
  const rig=makeRig(Wasm,factory,gl,shaderBridge,c);active(rig);const rows=[];
  const refuse=async(label,raw,code)=>{
    const native=copy(rig.q.vm.inspect()),host=copy(rig.host.bridge.inspect()),calls=rig.events.length,objects=rig.trace.objects.size;
    const record=await rig.expect(label,raw,code);
    c.same(rig.q.vm.inspect(),native,label+' full native rollback');c.same(rig.host.bridge.inspect(),host,label+' full host rollback');
    c.equal(rig.events.length,calls,label+' no callback');c.equal(rig.trace.objects.size,objects,label+' no GL allocation');
    rows.push({label,record,native,host,objects});
  };
  for(const hint of HINTS)for(const extra of [1,2,4,8,128,256,524288]) {
    if(hint===0&&extra===524288)continue;
    await refuse('unsupported original mask '+(hint|extra),resource(99,0,64,hint|extra,16,1),BAD);
  }
  for(const [at,v]of [[28,2],[32,67],[40,0],[44,2],[48,0],[48,2],[52,2],[56,1],[60,1],[64,1]]) {
    const raw=resource(99,0,64,112,16,1);set32(raw,at,v);await refuse('buffer dimension/flag '+at+'='+v,raw,BAD);
  }
  await refuse('per-resource byte budget',resource(99,0,64,64,4*1024*1024+1,1),OOM);
  for(let i=0;i<8;i++)await rig.expect('aggregate budget owner '+i,resource(100+i,0,64,HINTS[i],4*1024*1024,1));
  c.equal(rig.q.vm.inspect().gpuBytes,32*1024*1024,'native original32MiB budget');
  c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,32*1024*1024,'hardware original32MiB budget');
  await refuse('aggregate buffer byte budget',resource(108,0,64,64,1,1),OOM);
  const result={rows,records:rig.q.records,events:rig.events,commandTrace:rig.q.vm.commandTrace()};window.__desktopActive=null;rig.dispose();return result;
}
export async function runNativeBufferAcceptance({WasmVirglSubmitProof,createVirglStandardDesktopSubmitBridge,createVirglSubmitBridge,seeds=[0x37a1,0x82cd,0xe419]}) {
  const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
  c.truth(gl,'hardware WebGL2 context');const nativeCalls=[],objects=new WeakMap();let nextObject=1;
  const describe=v=>{
    if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;
    if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
    if(!objects.has(v))objects.set(v,nextObject++);return {object:objects.get(v),type:v.constructor?.name??'object'};
  };
  const recordedGl=new Proxy(gl,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return(...args)=>{
    const before=args.map(describe),result=fn.apply(target,args);nativeCalls.push({sequence:nativeCalls.length,name:key,before,after:args.map(describe),result:describe(result)});return result;
  };}});
  const info=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);c.truth(gpu.includes('Metal'),'hardware Metal renderer');
  const shaderBridge=await createVirglStandardShadowTextureShaderBridge(),Wasm=Selected(WasmVirglSubmitProof),factory=createVirglStandardDesktopSubmitBridge;
  const result={nativeCalls,gpu,guestExecution:false,productionNegotiation:false,runs:[]};window.__desktopProof=result;
  for(const seed of seeds)for(const hint of HINTS)result.runs.push(await roles(Wasm,factory,recordedGl,shaderBridge,c,seed,hint));
  result.refusals=await refusals(Wasm,factory,recordedGl,shaderBridge,c);
  result.owners=await acceptedOwners(Wasm,factory,WasmVirglSubmitProof,createVirglSubmitBridge,recordedGl,shaderBridge,c);
  result.orderedDma=await orderedDma(Wasm,factory,recordedGl,shaderBridge,c);
  result.failure=await uncertainGpuFailure(Wasm,factory,recordedGl,shaderBridge,c);
  c.equal(gl.getError(),gl.NO_ERROR,'no final hardware error');result.assertions=c.assertions;result.attacks=c.attacks;result.status='passed';
  result.summary={status:result.status,gpu,assertions:c.assertions,hints:HINTS,schedules:seeds,
    draws:result.runs.length,fullPlanePixels:result.runs.length*256,nativeCalls:nativeCalls.length};return result;
}
