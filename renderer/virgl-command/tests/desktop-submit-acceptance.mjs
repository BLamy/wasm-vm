// Selected composition, real Wasm queues, independently modeled owners and pixels.
import { createVirglStandardShadowTextureShaderBridge } from '../../virgl-shader/standard.mjs';
import { runDesktopSubmitCritic } from './desktop-submit-critic.mjs';
import { checker, makeRig, context, resource, idCommand, header, submission,
  originalReplay, orderedDma, uncertainGpuFailure, protocolAttacks } from './submit-acceptance.mjs';
const OK=0x1100, OOM=0x1201, BAD=0x1205;
const copy=value=>JSON.parse(JSON.stringify(value,(_,v)=>v instanceof Uint8Array?[...v]:v));
const set32=(bytes,offset,value)=>new DataView(bytes.buffer).setUint32(offset,value,true);
const META=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
function originalPacket(e) {
  if(e.type==='resource_unref')return idCommand(0x102,0,e.resourceId);
  const raw=header(0x204,0,72);
  [e.resourceId,e.target,e.format,e.bind,e.width,e.height,e.depth,e.arraySize,e.lastLevel,e.nrSamples,e.flags,0]
    .forEach((v,i)=>set32(raw,24+4*i,v));return raw;
}
function Selected(Wasm) {
  return class { constructor(callback,enabled) { return enabled?Wasm.standardDesktop(callback):new Wasm(callback,false); } };
}
function modelOwners(rig,model,c,label) {
  const native=rig.q.vm.inspect(),host=rig.host.bridge.inspect();
  c.same(native.resources.map(v=>v.identity.id).sort((a,b)=>a-b),[...model.keys()].sort((a,b)=>a-b),label+' native IDs');
  c.same(host.resources.map(v=>v.transport.id).sort((a,b)=>a-b),[...model.keys()].sort((a,b)=>a-b),label+' host IDs');
  let bytes=0,gpuBytes=0;
  for(const [id,m] of model) {
    const n=native.resources.find(v=>v.identity.id===id),h=host.resources.find(v=>v.transport.id===id);
    c.same(n.metadata,m,label+' original metadata');c.same(h.transport,n.identity,label+' canonical generation');
    const logical=m.target===0?m.width:m.width*m.height*4;
    bytes+=logical;gpuBytes+=m.target===0&&m.bind===524288?0:logical;
  }
  c.equal(native.logicalBytes,bytes,label+' independently modeled native logical bytes');
  c.equal(native.gpuBytes,gpuBytes,label+' independently modeled native GPU bytes');
  c.equal(host.store.budgets.gpuBytes,gpuBytes,label+' independently modeled host GPU bytes');
  return {native:copy(native),host:copy(host),modeledBytes:bytes,modeledGpuBytes:gpuBytes,machineDigest:rig.q.vm.machineDigest()};
}
async function lifetimes(Wasm,factory,gl,shaderBridge,inputs,c) {
  const rows=[];window.__desktopProof.lifetimes=rows;
  for(const input of inputs) {
    const rig=makeRig(Wasm,factory,gl,shaderBridge,c),model=new Map(),steps=[];let refusal=null,peak=0;
    const row={name:input.name,steps};rows.push(row);
    window.__desktopActive=()=>({records:rig.q.records,events:rig.events,native:copy(rig.q.vm.inspect()),host:copy(rig.host.bridge.inspect()),response:[...rig.q.read(rig.q.response+BigInt(((rig.q.next-1)%128)*64),64)]});
    for(const call of input.calls) {
      const e=call.enter,raw=originalPacket(e),expected=e.format===17?BAD:OK;
      const before=modelOwners(rig,model,c,input.name+' before '+e.seq),allocations=rig.trace.objects.size;
      const record=await rig.expect('original desktop '+input.name+' event '+e.seq,raw,expected);
      if(expected===BAD) {
        c.same(rig.q.vm.inspect(),before.native,'format17 native refusal before publication');
        c.same(rig.host.bridge.inspect(),before.host,'format17 leaves full host owners unchanged');
        c.equal(rig.trace.objects.size,allocations,'format17 no native allocation');refusal=e.seq;
      } else if(e.type==='resource_create') {
        c.truth(!model.has(e.resourceId),'original successful create is unique');
        model.set(e.resourceId,Object.fromEntries(META.map(k=>[k,k==='id'?e.resourceId:e[k]])));
      } else { c.truth(model.delete(e.resourceId),'original successful unref is live'); }
      peak=Math.max(peak,model.size);
      steps.push({originalEnter:e,originalReturn:call.returned,expected,record,before,
        after:modelOwners(rig,model,c,input.name+' after '+e.seq)});
      if(refusal!==null)break;
    }
    c.equal(steps.length,input.name==='compositor'?56:input.name==='kmscube'?8:34,'original call count');
    c.equal(refusal,input.name==='glmark2-es2'?3025:null,'only qualified lifetimes admit');
    Object.assign(row,{peak,refusal,events:rig.events,commandTrace:rig.q.vm.commandTrace()});
    window.__desktopActive=null;rig.dispose();
  }
  return rows;
}
async function acceptedOwners(Wasm,factory,Legacy,oldFactory,gl,shaderBridge,c) {
  const rig=makeRig(Wasm,factory,gl,shaderBridge,c),{q}=rig,model=new Map();
  window.__desktopActive=()=>({records:q.records,events:rig.events,native:copy(q.vm.inspect()),submit:copy(q.vm.submitState()),host:copy(rig.host.bridge.inspect()),response:[...q.read(q.response+BigInt(((q.next-1)%128)*64),64)]});
  await rig.expect('desktop64 context',context(2));
  for(let id=100;id<164;id++) {
    await rig.expect('desktop64 resource '+id,resource(id,0,64,16,8,1));
    model.set(id,{id,target:0,format:64,bind:16,width:8,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
    await rig.expect('desktop64 member '+id,idCommand(0x202,2,id));
  }
  const full=modelOwners(rig,model,c,'selected64'),beforeAlloc=rig.trace.objects.size;
  await rig.expect('desktop65 refused before sink',resource(164,0,64,16,8,1),OOM);
  c.same(q.vm.inspect(),full.native,'native65 full-state unchanged');c.same(rig.host.bridge.inspect(),full.host,'host65 full-state unchanged');
  c.equal(rig.trace.objects.size,beforeAlloc,'65 no GL allocation');
  const request=submission(2,new Uint8Array(),0xffffffffffffffffn),entry=q.enqueue('accepted64 empty ordered job',request);
  q.kick();q.run();const event=rig.events.at(-1);
  c.equal(event.type,'beginJob','actual callback marshals a job');c.equal(event.resources.length,64,'actual callback marshals64 owners');
  c.same(event.resources.map(v=>v.identity.id),(Array.from({length:64},(_,i)=>i+100)),'canonical64 identities');
  c.equal(q.usedIndex(),entry.number,'job admission has no guest completion');
  const accepted=copy(event);await rig.drain();q.collect(entry);
  const state=copy(rig.host.bridge.inspect());
  for(const [name,change] of [
    ['metadata',e=>e.resources[0].metadata.width++],
    ['generation',e=>e.resources[0].identity.generation='ffffffffffffffff'],
    ['foreign',e=>{e.resources[0].identity.id=999;e.resources[0].metadata.id=999;}],
    ['backing',e=>e.resources[0].backing={generation:'0000000000000001',byteLength:8}],
    ['count65',e=>e.resources.push(copy({...e.resources[0],identity:{id:999,generation:'ffffffffffffffff'},metadata:{...e.resources[0].metadata,id:999}}))],
  ]) {
    const malformed=copy(accepted);malformed.commands=new Uint8Array();malformed.sequence='000000000000ffff';change(malformed);
    c.bad(rig.host.bridge.apply(malformed),'selected accepted owner '+name);
    c.same(rig.host.bridge.inspect(),state,'bad accepted envelope preserves complete owners '+name);
  }
  q.reset();c.equal(q.vm.inspect().resources.length,0,'selected reset empties native owners');
  await rig.expect('selected survives reset depth',resource(201,2,20,9,2,2));
  c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,16,'reset retains selected packed-depth backend');
  const result={accepted,full,records:q.records,events:rig.events,completions:rig.completions,commandTrace:q.vm.commandTrace()};window.__desktopActive=null;rig.dispose();
  const old=makeRig(Legacy,oldFactory,gl,shaderBridge,c);
  for(let id=1;id<=17;id++)await old.expect('historical count '+id,resource(300+id,0,64,16,8,1),id<=16?OK:OOM);
  await old.expect('historical packed depth still refuses',resource(400,2,20,9,2,2),BAD);
  await old.expect('historical16 context',context(2));
  for(let id=301;id<=316;id++)await old.expect('historical16 member '+id,idCommand(0x202,2,id));
  await old.expect('historical16 accepted snapshot',submission(2,new Uint8Array(),16n));
  const oldAccepted=old.events.find(e=>e.type==='beginJob');
  c.equal(oldAccepted.resources.length,16,'historical job marshals exactly16 native owners');
  const oldBefore=copy(old.host.bridge.inspect()),excess=structuredClone(oldAccepted);
  excess.sequence='000000000000ffff';excess.resources.push({...structuredClone(excess.resources[0]),identity:{id:999,generation:'ffffffffffffffff'},metadata:{...excess.resources[0].metadata,id:999}});
  c.bad(old.host.bridge.apply(excess),'historical job refuses17 before renderer','invalid-parameter');
  c.same(old.host.bridge.inspect(),oldBefore,'historical17 full state unchanged');

  result.historical={records:old.q.records,events:old.events,state:copy(old.host.bridge.inspect())};old.dispose();
  const transport={gatherInput(){throw Error('unexpected DMA');},scatterOutput(){throw Error('unexpected output');},complete(){throw Error('unexpected complete');}};
  const limited=c.ok(factory({gl,shaderBridge,transport,resourceLimits:{resources:1}}),'selected tightened count');
  const eventFor=(id,generation)=>({type:'createResource',epoch:'0000000000000001',resource:{id,generation},metadata:{id,target:2,format:20,bind:9,width:2,height:2,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}});
  c.ok(limited.bridge.apply(eventFor(1,'0000000000000001')),'tightened selected depth');
  const limitedBefore=copy(limited.bridge.inspect());c.bad(limited.bridge.apply(eventFor(2,'0000000000000002')),'tightened selected refusal','out-of-memory');
  c.same(limited.bridge.inspect(),limitedBefore,'tightened selected refusal unchanged');c.ok(limited.bridge.dispose(),'tightened dispose');
  return result;
}
function fullPlane(original,c) {
  // Literal nearest-filtered 2x2 texture, full clip-space quad and32x32 viewport.
  // Expected colors are independent of generated shaders, captured output and GPU data.
  const output=original.exchanges.find(e=>e.kind==='output'&&e.bytes.length===8192);
  c.truth(output,'original GPU full-plane readback');
  const bytes=Uint8Array.from(output.bytes.match(/../g).map(v=>parseInt(v,16)));
  const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]];
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)c.same([...bytes.subarray((y*32+x)*4,(y*32+x+1)*4)],colors[(y>=16?2:0)+(x>=16?1:0)],`literal full-plane(${x},${y})`);
  return {pixels:1024,bytes:4096,colors,orientation:'lower-left row zero'};
}
export async function runDesktopAcceptance({WasmVirglSubmitProof,createVirglStandardDesktopSubmitBridge,createVirglControlBridge,createVirglSubmitBridge,fixtures,inputs}) {
  const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
  c.truth(gl,'hardware WebGL2 context');const nativeCalls=[],objects=new WeakMap();let nextObject=1;
  const describe=value=>{
    if(value===null||typeof value!=='object')return value===undefined?{undefined:true}:value;
    if(ArrayBuffer.isView(value))return {type:value.constructor.name,bytes:[...new Uint8Array(value.buffer,value.byteOffset,value.byteLength)].map(v=>v.toString(16).padStart(2,'0')).join('')};
    if(!objects.has(value))objects.set(value,nextObject++);return {object:objects.get(value),type:value.constructor?.name??'object'};
  };
  const recordedGl=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
    const before=args.map(describe),result=value.apply(target,args);nativeCalls.push({sequence:nativeCalls.length,name:key,before,after:args.map(describe),result:describe(result)});return result;
  };}});
  const info=gl.getExtension('WEBGL_debug_renderer_info');
  c.truth(gl.getParameter(info.UNMASKED_RENDERER_WEBGL).includes('Metal'),'hardware Metal renderer');
  const shaderBridge=await createVirglStandardShadowTextureShaderBridge(),Wasm=Selected(WasmVirglSubmitProof),factory=createVirglStandardDesktopSubmitBridge;
  const result={nativeCalls,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(info.UNMASKED_RENDERER_WEBGL)};
  window.__desktopProof=result;
  result.lifetimes=await lifetimes(Wasm,factory,recordedGl,shaderBridge,inputs,c);
  result.owners=await acceptedOwners(Wasm,factory,WasmVirglSubmitProof,createVirglSubmitBridge,recordedGl,shaderBridge,c);
  const synchronous=c.ok(createVirglControlBridge({gl:recordedGl,shaderBridge}),'historical synchronous constructor');
  c.ok(synchronous.bridge.apply({type:'createContext',epoch:'0000000000000001',context:{id:77,generation:'0000000000000001'},debugName:new Uint8Array()}),'historical synchronous context');
  c.ok(synchronous.bridge.apply({type:'destroyContext',epoch:'0000000000000001',context:{id:77,generation:'0000000000000001'}}),'historical synchronous destroy');
  c.ok(synchronous.bridge.dispose(),'historical synchronous dispose');
  result.schedules=[];
  for(const seed of [0x37a1,0x82cd,0xe419]) {
    const original=await originalReplay(Wasm,factory,recordedGl,shaderBridge,fixtures,c,seed,false);
    result.schedules.push({seed,original,fullPlane:fullPlane(original,c)});
  }
  result.orderedDma=await orderedDma(Wasm,factory,recordedGl,shaderBridge,c);
  result.failure=await uncertainGpuFailure(Wasm,factory,recordedGl,shaderBridge,c);
  result.protocol=await protocolAttacks(Wasm,factory,recordedGl,shaderBridge,c);
  result.critic=await runDesktopSubmitCritic({WasmVirglSubmitProof,createVirglStandardDesktopSubmitBridge,createVirglSubmitBridge,schedule:0x5af3});
  c.equal(gl.getError(),gl.NO_ERROR,'no final native GL error');
  result.assertions=c.assertions;result.attacks=c.attacks;result.status='passed';
  result.summary={status:result.status,gpu:result.gpu,assertions:result.assertions,
    lifetimes:result.lifetimes.map(({name,peak,refusal,steps})=>({name,peak,refusal,controls:steps.length})),
    acceptedOwners:result.owners.accepted.resources.length,schedules:result.schedules.map(({seed,original,fullPlane})=>({seed,draws:original.gpuDraws,fullPlanePixels:fullPlane.pixels})),nativeCalls:nativeCalls.length};
  return result;
}
