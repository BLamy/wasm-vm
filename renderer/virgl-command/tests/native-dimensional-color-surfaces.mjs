// Real original queues, immutable hardware input and complete independent images.
import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {cases,fixture,expected,metadata,keys,setup,draw,clear,CLEAR,surface,packet,join} from '../../../tools/virgl-dimensional-color-surfaces/fixtures.mjs';
import {attackCases,attack} from './dimensional-color-surface-attacks.mjs';
import {runMrt} from './dimensional-color-surface-mrt.mjs';
import {runRetention} from './dimensional-color-surface-retention.mjs';
import {runHistorical} from './dimensional-color-surface-historical.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
function allocation(m){const b=header(0x204,0,72);keys.forEach((k,i)=>put(b,24+i*4,m[k]));return b;}
function capture(native,row,control){
 const ids=new WeakMap(),calls=[],states=[];let next=1;
 const encode=v=>{if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(Array.isArray(v))return v.map(encode);if(v&&typeof v==='object'){if(!ids.has(v))ids.set(v,next++);return {object:ids.get(v),type:v.constructor.name};}return v===undefined?{undefined:true}:v;};
 const snapshot=()=>({framebuffer:encode(native.getParameter(native.DRAW_FRAMEBUFFER_BINDING)),viewport:[...native.getParameter(native.VIEWPORT)],program:encode(native.getParameter(native.CURRENT_PROGRAM)),attachments:Array.from({length:4},(_,slot)=>{
  const attachment=native.COLOR_ATTACHMENT0+slot,type=native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,attachment,native.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
  return {slot,type,...(type===native.TEXTURE?{texture:encode(native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,attachment,native.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),level:native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,attachment,native.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),face:native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,attachment,native.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE),layer:native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,attachment,native.FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER)}:{})};
 })});
 return {calls,states,encode,gl:new Proxy(native,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{
  const event={sequence:calls.length,name,arguments:args.map(encode)},delivered=args.slice();calls.push(event);
  if(control.armed&&args[0]===native.FRAMEBUFFER&&args[1]===native.COLOR_ATTACHMENT0&&args[2]!==null){
   if(name==='framebufferTextureLayer')delivered[4]=(args[4]+1)%row.fixture.levels[args[3]].layers;
   if(name==='framebufferTexture2D'&&args[2]>=native.TEXTURE_CUBE_MAP_POSITIVE_X&&args[2]<=native.TEXTURE_CUBE_MAP_NEGATIVE_Z)delivered[2]=native.TEXTURE_CUBE_MAP_POSITIVE_X+(args[2]-native.TEXTURE_CUBE_MAP_POSITIVE_X+1)%6;
   if(delivered.some((v,i)=>v!==args[i])){event.fault='physical-original-color-attachment';control.hits++;}
  }
  if(name==='drawArrays'||name==='drawArraysInstanced'||name==='clearBufferfv')states.push({sequence:event.sequence,state:snapshot()});
  const result=value.apply(target,delivered);event.delivered=delivered.map(encode);event.result=encode(result);if(name==='getBufferSubData'||name==='readPixels')event.after=args.map(encode);return result;
 };}})};
}
function memory(rig,id,index,c){
 const q=rig.q,cuts=[7,17,53,101,3918],entries=cuts.map((n,i)=>[q.base+0x210000n+BigInt(index*0x10000+i*0x2000),n]);
 for(const [at,n]of entries)q.write(at-8n,new Uint8Array(n+16).fill(0xa3));
 const write=bytes=>{c.equal(bytes.length,4096,'full original SG backing');let at=0;for(const [address,n]of entries){q.write(address,bytes.subarray(at,at+n));at+=n;}};
 const read=()=>{const out=new Uint8Array(4096);let at=0;for(const [address,n]of entries){out.set(q.read(address,n),at);at+=n;}return out;};
 const guards=()=>entries.map(([address,n])=>{const before=hex(q.read(address-8n,8)),after=hex(q.read(address+BigInt(n),8));c.equal(before,'a3'.repeat(8),'SG prefix untouched');c.equal(after,'a3'.repeat(8),'SG suffix untouched');return {address:address.toString(16),length:n,before,after};});
 return {entries,write,read,guards,attach:backing(id,entries)};
}
const request=(f,p,direction)=>{const stride=p.width*4+7,layerStride=stride*p.height+11,wire=transfer(1,6,direction,[0,0,0,p.width,p.height,p.layers],5n,stride,layerStride,0xffffffffffffffffn);put(wire,60,p.level);return {wire,stride,layerStride};};
function padded(p,bytes,stride,layerStride,fill){const out=new Uint8Array(4096).fill(fill);for(let z=0;z<p.layers;z++)for(let y=0;y<p.height;y++)out.set(bytes.subarray((z*p.height+y)*p.width*4,(z*p.height+y+1)*p.width*4),5+z*layerStride+y*stride);return out;}
async function runCase(Wasm,createBridge,native,compiler,c,spec,seed,report,{fault=false}={}){
 const f=fixture(spec,seed),row={name:f.name,seed,fixture:copy(f),sourcePlanes:[],outputs:[]},control={armed:false,hits:0},trace=capture(native,row,control),Selected=class{constructor(callback){return Wasm.standardDimensionalDepth(callback);}};
 const rig=makeRig(Selected,createBridge,trace.gl,compiler,c,seed,true,false,true);let source,vertices;report.rows.push(row);
 window.__colorSurfaceActive=()=>({row,native:copy(rig.q.vm.inspect()),host:copy(rig.host.bridge.inspect())});
 try{
  await rig.expect('original context',context(1));
  for(const [i,m]of [f.source,metadata(3,0,64,16,f.positions.length,1)].entries()){
   const wire=allocation(m);await rig.expect('original allocation '+m.id,wire);const ram=memory(rig,m.id,i,c);await rig.expect('original backing '+m.id,ram.attach);await rig.expect('original membership '+m.id,idCommand(0x202,1,m.id));if(m.id===6)source=ram;else vertices=ram;
  }
  for(const p of f.levels){const r=request(f,p,1),bytes=padded(p,p.bytes,r.stride,r.layerStride,0x8d);source.write(bytes);const at=rig.exchanges.length,record=await rig.expect('original full dimensional upload mip'+p.level,r.wire);c.equal(rig.exchanges[at].bytes,hex(p.bytes),'every original upload byte');row.sourcePlanes.push({level:p.level,width:p.width,height:p.height,layers:p.layers,input:hex(p.bytes),backing:hex(bytes),record,guards:source.guards()});}
  const bytes=new Uint8Array(4096).fill(0x9b);bytes.set(f.positions,5);vertices.write(bytes);await rig.expect('original point positions',transfer(1,3,1,[0,0,0,f.positions.length,1,1],5n));vertices.guards();
  row.setup=await rig.expect('original selected surface and draw state',submission(1,setup(f)));
  if(f.control==='original2D-depth'){
   const meta=metadata(8,2,16,1,f.width,f.height);await rig.expect('inherited original2D Z16 allocation',allocation(meta));await rig.expect('inherited original2D Z16 membership',idCommand(0x202,1,8));
   row.control={metadata:meta,record:await rig.expect('inherited original2D Z16 surface and mixed framebuffer',submission(1,join(surface(21,8,0,0,16),packet(5,0,[1,21,20]))))};
  }
  if(f.attack)await attack(rig,f,c,row,trace.calls);
  control.armed=fault;row.operation=await rig.expect('original CLEAR and DRAW_VBO',submission(1,new Uint8Array([...clear(CLEAR),...draw()]),0x20000000000001n));control.armed=false;
  row.attachmentStates=trace.states;row.faultHits=control.hits;
  if(fault)c.truth(control.hits>0,'actual dimensional attachment mutation executes');
  for(const p of expected(f)){
   const r=request(f,p,2),sentinel=new Uint8Array(4096).fill(0x4e);source.write(sentinel);const at=rig.exchanges.length,record=await rig.expect('original full image readback mip'+p.level,r.wire),actual=source.read(),wanted=padded(p,p.bytes,r.stride,r.layerStride,0x4e);
   row.outputs.push({level:p.level,width:p.width,height:p.height,layers:p.layers,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(p.bytes),backingActual:hex(actual),backingExpected:hex(wanted),guards:source.guards()});
   c.equal(rig.exchanges[at].bytes,hex(p.bytes),'entire original changed/untouched mip image');c.equal(hex(actual),hex(wanted),'complete original SG image and padding');
  }
  c.truth(trace.states.some(x=>['drawArrays','drawArraysInstanced'].includes(trace.calls[x.sequence].name)),'actual native point draw');
  for(const s of trace.states){const a=s.state.attachments[0];c.equal(a.type,native.TEXTURE,'native original color texture');c.equal(a.level,f.level,'native original selected mip');c.equal(f.target===4?a.face-native.TEXTURE_CUBE_MAP_POSITIVE_X:a.layer,f.layer,'native original layer/face');}
  c.equal(native.getError(),native.NO_ERROR,'zero hardware error');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
 finally{
  row.calls=trace.calls;row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.records=copy(rig.q.records);row.beforeDispose=copy(rig.host.bridge.inspect());row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(rig.trace.objects.size,0,'all native owners retired');c.equal(rig.trace.syncs.size,0,'all native syncs retired');window.__colorSurfaceActive=null;
  const raw=JSON.stringify(row),index=report.rows.length-1;if(window.__recordDimensionalColorSurfaceRun){report.rows[index]=await window.__recordDimensionalColorSurfaceRun(index,raw);}
 }
}
export async function runAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalColorSurfaceSubmitBridge,seeds=[54831,90107,171281],smoke=false,fault=false,attacks=false,mrt=false,boundaries=false,refresh=false,historical=false,sabotage='layer'}){
 if([mrt,boundaries,refresh,attacks,fault,historical].filter(Boolean).length>1)throw Error('Select one original test mode.');
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),c=checker();c.truth(native,'hardware WebGL2');const info=native.getExtension('WEBGL_debug_renderer_info'),gpu=info?native.getParameter(info.UNMASKED_RENDERER_WEBGL):'unknown';c.truth(!/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu),'hardware renderer');
 const compiler=await createVirglStandardDimensionalShadowTextureShaderBridge(),report={status:'running',gpu,rows:[],actualLinuxGuest:false,productionAuthority:false};window.__dimensionalColorSurfaceReport=report;
 const selected=fault?[{target:sabotage==='face'?4:7,bind:10,level:0,layer:0,name:'physical-original-attachment'}]:attacks?attackCases():cases({smoke});
 try{for(const seed of fault?seeds.slice(0,1):seeds){if(historical){await runHistorical(WasmVirglSubmitProof,native,compiler,c,seed,report);for(const target of [3,4,7])await runCase(WasmVirglSubmitProof,createVirglStandardDimensionalColorSurfaceSubmitBridge,native,compiler,c,{target,bind:10,level:1,layer:0,control:'original2D-depth',name:'inherited-original2D-depth/target'+target},seed,report);}else if(mrt)await runMrt(WasmVirglSubmitProof,createVirglStandardDimensionalColorSurfaceSubmitBridge,native,compiler,c,seed,report);else if(boundaries||refresh)await runRetention(WasmVirglSubmitProof,createVirglStandardDimensionalColorSurfaceSubmitBridge,native,compiler,c,seed,report,{boundaries});else for(const spec of selected)await runCase(WasmVirglSubmitProof,createVirglStandardDimensionalColorSurfaceSubmitBridge,native,compiler,c,spec,seed,report,{fault});}report.status='passed';report.summary={status:'passed',gpu,runs:report.rows.length,schedules:seeds,assertions:c.assertions};return report;}
 finally{report.assertions=c.assertions;report.attacks=c.attacks;}
}
export {capture,memory,allocation,padded};
