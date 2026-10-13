// Actual selected Wasm control/submission queues, physical GPU work and original DMA.
import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker,makeRig,context,idCommand,transfer,submission} from './submit-acceptance.mjs';
import {runHistorical} from './dimensional-depth-surface-historical.mjs';
import {runLifecycle} from './dimensional-depth-surface-lifecycle.mjs';
import {attackCases,runAttack} from './dimensional-depth-surface-attacks.mjs';
import {memory,allocation} from './native-dimensional-color-surfaces.mjs';
import {cases,fixture,expected,metadata,bytesPerPixel,stencilOffset,setup,draw,clear,word,packet,join} from '../../../tools/virgl-dimensional-depth-surfaces/fixtures.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
export function capture(native,row,control){
 const ids=new WeakMap(),calls=[],states=[];let next=1;
 const encode=v=>{if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(Array.isArray(v))return v.map(encode);if(v&&typeof v==='object'){if(!ids.has(v))ids.set(v,next++);return {object:ids.get(v),type:v.constructor.name};}return v===undefined?{undefined:true}:v;};
 const attachment=a=>{const type=native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,a,native.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);return {attachment:a,type,...(type===native.TEXTURE?{texture:encode(native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,a,native.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),level:native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,a,native.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),face:native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,a,native.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE),layer:native.getFramebufferAttachmentParameter(native.FRAMEBUFFER,a,native.FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER)}:{})};};
 const snapshot=()=>({framebuffer:encode(native.getParameter(native.DRAW_FRAMEBUFFER_BINDING)),viewport:[...native.getParameter(native.VIEWPORT)],program:encode(native.getParameter(native.CURRENT_PROGRAM)),depthTest:native.isEnabled(native.DEPTH_TEST),depthFunction:native.getParameter(native.DEPTH_FUNC),depthMask:native.getParameter(native.DEPTH_WRITEMASK),stencilTest:native.isEnabled(native.STENCIL_TEST),depth:attachment(native.DEPTH_ATTACHMENT),stencil:attachment(native.STENCIL_ATTACHMENT),color:attachment(native.COLOR_ATTACHMENT0)});
 return {calls,states,encode,gl:new Proxy(native,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{
  const event={sequence:calls.length,name,arguments:args.map(encode)},delivered=args.slice();calls.push(event);
  if(control.armed&&args[0]===native.FRAMEBUFFER&&[native.DEPTH_ATTACHMENT,native.DEPTH_STENCIL_ATTACHMENT].includes(args[1])){
   if(name==='framebufferTextureLayer'&&args[2])delivered[4]=(args[4]+1)%row.fixture.levels[args[3]].layers;
   if(name==='framebufferTexture2D'&&args[3]&&args[2]>=native.TEXTURE_CUBE_MAP_POSITIVE_X&&args[2]<=native.TEXTURE_CUBE_MAP_NEGATIVE_Z)delivered[2]=native.TEXTURE_CUBE_MAP_POSITIVE_X+(args[2]-native.TEXTURE_CUBE_MAP_POSITIVE_X+1)%6;
   if(delivered.some((v,i)=>v!==args[i])){event.fault='physical-original-depth-attachment';control.hits++;}
  }
  if(['drawArrays','drawArraysInstanced','clear','clearBufferfv'].includes(name))states.push({sequence:event.sequence,state:snapshot()});
  const result=value.apply(target,delivered);event.delivered=delivered.map(encode);event.result=encode(result);if(name==='getBufferSubData'||name==='readPixels')event.after=args.map(encode);return result;
 };}})};
}
export function request(id,p,size,direction){const stride=p.width*size+7,layerStride=stride*p.height+11,wire=transfer(1,id,direction,[0,0,0,p.width,p.height,p.layers],5n,stride,layerStride,0xffffffffffffffffn);put(wire,60,p.level);return {wire,stride,layerStride};}
export function padded(p,bytes,size,stride,layerStride,fill){const out=new Uint8Array(4096).fill(fill);for(let z=0;z<p.layers;z++)for(let y=0;y<p.height;y++)out.set(bytes.subarray((z*p.height+y)*p.width*size,(z*p.height+y+1)*p.width*size),5+z*layerStride+y*stride);return out;}
export async function runCase(Wasm,createBridge,native,compiler,c,spec,seed,report,{fault=false}={}){
 const f=fixture(spec,seed),row={name:f.name,seed,fixture:copy(f),sourcePlanes:[],outputs:[],operations:[]},control={armed:false,hits:0},trace=capture(native,row,control),Selected=class{constructor(callback){return Wasm.standardDimensionalDepth(callback);}};
 const rig=makeRig(Selected,createBridge,trace.gl,compiler,c,seed,true,false,true),ram=new Map();report.rows.push(row);
 window.__depthSurfaceActive=()=>({row,native:copy(rig.q.vm.inspect()),host:copy(rig.host.bridge.inspect())});
 try{
  await rig.expect('original context',context(1));
  for(const [i,m]of [f.source,f.color,metadata(3,0,64,16,f.positions.length,1)].entries()){
   await rig.expect('original allocation '+m.id,allocation(m));const mem=memory(rig,m.id,i,c);ram.set(m.id,mem);await rig.expect('original backing '+m.id,mem.attach);await rig.expect('original membership '+m.id,idCommand(0x202,1,m.id));
  }
  const cost=f.levels.reduce((n,p)=>n+p.bytes.length,0)*(f.format===126?2:1)+f.width*f.height*f.color.arraySize*4+f.positions.length;
  c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,cost,'complete depth native chain, color and vertex charges');row.cost=cost;
  for(const p of f.levels){const r=request(6,p,bytesPerPixel(f.format),1),body=padded(p,p.bytes,bytesPerPixel(f.format),r.stride,r.layerStride,0x8d);ram.get(6).write(body);const at=rig.exchanges.length,record=await rig.expect('original full depth upload mip'+p.level,r.wire);c.equal(rig.exchanges[at].bytes,hex(p.bytes),'every original depth upload byte');row.sourcePlanes.push({level:p.level,width:p.width,height:p.height,layers:p.layers,input:hex(p.bytes),backing:hex(body),record,guards:ram.get(6).guards()});}
  const colorPlane={level:0,width:f.width,height:f.height,layers:f.color.arraySize},colorInput=new Uint8Array(f.width*f.height*f.color.arraySize*4);for(let i=0;i<colorInput.length/4;i++)colorInput.set([11,29,47,83],i*4);
  const uploadColor=request(1,colorPlane,4,1);ram.get(1).write(padded(colorPlane,colorInput,4,uploadColor.stride,uploadColor.layerStride,0x91));row.colorUpload=await rig.expect('original color control upload',uploadColor.wire);
  const uploadVertices=async(bytes,label)=>{const body=new Uint8Array(4096).fill(0x9b);body.set(bytes,5);ram.get(3).write(body);const record=await rig.expect(label,transfer(1,3,1,[0,0,0,bytes.length,1,1],5n));ram.get(3).guards();return record;};
  await uploadVertices(f.positions,'original near point positions');row.setup=await rig.expect('original selected depth surface and state',submission(1,setup(f)));
  if(f.attack)await runAttack(rig,f,c,row,trace.calls);
  row.operationNativeStart=trace.calls.length;control.armed=fault;
  const depthStencil=stencilOffset(f.format)!==null;
  row.operations.push(await rig.expect('original depth stencil CLEAR and near DRAW_VBO',submission(1,join(clear(depthStencil?7:5,f.stencil,1,[1,0,1,0].map(word)),draw(f.points.length)),0x20000000000001n)));
  await uploadVertices(f.farPositions,'original rejected far point positions');
  row.operations.push(await rig.expect('original far depth rejection and stencil operation',submission(1,join(packet(31,0,[42,1]),draw(f.points.length)),0x20000000000003n)));
  row.operationNativeEnd=trace.calls.length;control.armed=false;row.faultHits=control.hits;if(fault)c.truth(control.hits>0,'physical dimensional depth attachment fault executes');
  const wanted=expected(f);
  for(const p of wanted.planes){
   const size=bytesPerPixel(f.format),r=request(6,p,size,2);ram.get(6).write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('original complete depth image206 mip'+p.level,r.wire),actual=ram.get(6).read(),body=padded(p,p.bytes,size,r.stride,r.layerStride,0x4e);
   row.outputs.push({kind:'depth',format:f.format,level:p.level,width:p.width,height:p.height,layers:p.layers,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(p.bytes),backingActual:hex(actual),backingExpected:hex(body),guards:ram.get(6).guards()});
   c.equal(row.outputs.at(-1).denseActual,hex(p.bytes),'entire original depth stencil image and untouched mip planes');c.equal(hex(actual),hex(body),'every depth SG image and untouched padding byte');
  }
  const r=request(1,colorPlane,4,2);ram.get(1).write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('original complete color rejection image206',r.wire),actual=ram.get(1).read(),body=padded(colorPlane,wanted.color,4,r.stride,r.layerStride,0x4e);
  row.outputs.push({kind:'color',format:67,...colorPlane,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(wanted.color),backingActual:hex(actual),backingExpected:hex(body),guards:ram.get(1).guards()});
  c.equal(row.outputs.at(-1).denseActual,hex(wanted.color),'complete color image proves near pass and far reject');c.equal(hex(actual),hex(body),'every color SG and padding byte');
  const states=trace.states.filter(s=>s.sequence>=row.operationNativeStart&&s.sequence<row.operationNativeEnd&&['drawArrays','drawArraysInstanced','clear'].includes(trace.calls[s.sequence].name));c.truth(states.some(s=>trace.calls[s.sequence].name.startsWith('draw')),'actual native depth-tested draw');
  for(const s of states){const a=s.state.depth;c.equal(a.type,native.TEXTURE,'original native depth texture');c.equal(a.level,f.level,'original native depth mip');c.equal(f.target===4?a.face-native.TEXTURE_CUBE_MAP_POSITIVE_X:a.layer,f.layer,'original native depth layer or cube face');c.equal(s.state.stencil.type,depthStencil?native.TEXTURE:native.NONE,'correct original depth stencil aspect');}
  if(f.lifecycle)await runLifecycle({rig,native,trace,c,f,row,ram,model:wanted.planes,uploadVertices,retention:f.lifecycle==='retention'});
  c.equal(native.getError(),native.NO_ERROR,'zero native depth surface error');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
 finally{
  row.calls=trace.calls;row.attachmentStates=trace.states;row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.records=copy(rig.q.records);row.completions=copy(rig.completions);row.beforeDispose=copy(rig.host.bridge.inspect());row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(rig.trace.objects.size,0,'all actual depth surface native owners retired');c.equal(rig.trace.syncs.size,0,'all actual depth surface syncs retired');window.__depthSurfaceActive=null;
  const index=report.rows.length-1;if(window.__recordDimensionalDepthSurfaceRun)report.rows[index]=await window.__recordDimensionalDepthSurfaceRun(index,JSON.stringify(row));
 }
}
export async function runAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalDepthSurfaceSubmitBridge,seeds=[54831,90107,171281],smoke=false,fault=false,attacks=false,mrt=false,boundaries=false,refresh=false,historical=false,sabotage='layer'}){
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),c=checker();c.truth(native,'hardware WebGL2');const info=native.getExtension('WEBGL_debug_renderer_info'),gpu=info?native.getParameter(info.UNMASKED_RENDERER_WEBGL):'unknown';c.truth(!/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu),'hardware renderer');
 const compiler=await createVirglStandardDimensionalShadowTextureShaderBridge(),report={status:'running',gpu,rows:[],actualLinuxGuest:false,productionAuthority:false};window.__dimensionalDepthSurfaceReport=report;
 const selected=fault?[{target:sabotage==='face'?4:7,format:126,bind:9,level:0,layer:0,name:'physical-original-depth-attachment'}]:boundaries||refresh?[4,7].flatMap(target=>[16,18,20,21,126].map(format=>({target,format,bind:9,level:1,layer:target===4?5:4,lifecycle:boundaries?'retention':'refresh',name:(boundaries?'retained-reset':'private-refresh')+'/target'+target+'/format'+format}))):attacks?attackCases():mrt?[...cases({smoke:true}).filter(f=>f.bind===9&&f.level===1).map(f=>({...f,colorTarget:f.target,colorLayer:f.target===4?5:4,name:'mixed-dimensional-color/'+f.name})),...[16,18,20,21,126].map(format=>({target:2,format,bind:9,level:1,layer:0,name:'original2D-depth-control/'+format}))]:cases({smoke});
 if([attacks,mrt,boundaries,refresh,historical,fault].filter(Boolean).length>1)throw Error('Select exactly one original proof mode.');
 try{for(const seed of fault?seeds.slice(0,1):seeds){if(historical)await runHistorical(WasmVirglSubmitProof,native,compiler,c,seed,report);else{for(const spec of selected)await runCase(WasmVirglSubmitProof,createVirglStandardDimensionalDepthSurfaceSubmitBridge,native,compiler,c,spec,seed,report,{fault});if(boundaries)for(const target of [4,7])await runCase(WasmVirglSubmitProof,createVirglStandardDimensionalDepthSurfaceSubmitBridge,native,compiler,c,{target,format:126,bind:9,level:1,layer:target===4?5:4,lifecycle:'retention',waitFailed:true,name:'physical-wait-failure/target'+target},seed,report);}}report.status='passed';report.summary={status:'passed',gpu,runs:report.rows.length,schedules:seeds,assertions:c.assertions};return report;}
 finally{report.assertions=c.assertions;report.attacks=c.attacks;}
}
