// Synthetic bounded packets exercise the actual renderer; only the named captured
// fragment is an original guest shader. No captured command bytes are rewritten.
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglDrawRenderer } from '../state.mjs';
import { runShaderPairs, require, equal, ok, digest, checkPixels, tile, FLAT_KEY, SMOOTH_KEY, MIXED_VERTEX, MIXED_FRAGMENT } from '../../virgl-shader/tests/pairs.mjs';

const packet=(op,type,words)=>{const b=new Uint8Array(4+4*words.length),v=new DataView(b.buffer);v.setUint32(0,op+type*256+words.length*65536,true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;};
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;};
const bits=(f)=>{const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,f,true);return v.getUint32(0,true);};
function shaderPacket(handle,stage,text) {
  const words=[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)];
  const b=packet(1,4,words);b.set(new TextEncoder().encode(text),24);return b;
}
const bind=(handle,stage)=>packet(31,0,[handle,stage]);
const link=(vs,fs)=>packet(52,0,[vs,fs,0,0,0,0]);
const CLEAR=packet(7,0,[4,0,0,bits(1),bits(1),0,0,0]);
const DRAW=packet(8,0,[0,3,4,1,1,0,0,0,0,0,2,0]);
function bad(result,label) {equal(result.ok,false,`${label} rejection`);require(typeof result.error?.code==='string',`${label} structured error`);if(result.appliedCommands!==undefined)equal(result.appliedCommands,0,`${label} no applied command`);return result;}
function subOf(state,id){const ctx=state.contexts.find(x=>x.id===id);return ctx.subContexts.find(x=>x.id===ctx.currentSubContext);}
function instrumentation(gl,report) {
  const ids=new WeakMap(),objects=[],live=new Map(),events=[];let serial=0;
  const control={mode:null,armed:false,smooth:null,requested:null,executed:null,label:''};
  const identity=(o)=>o ? ids.get(o)??null : null;
  const creations={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createVertexArray:'VertexArray',createFramebuffer:'Framebuffer',createRenderbuffer:'Renderbuffer',createSampler:'Sampler'};
  const proxy=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
    if(control.mode===key&&creations[key]){events.push({call:key,fault:'null',label:control.label});return null;}
    if(control.mode==='compile-status'&&key==='getShaderParameter'&&args[1]===gl.COMPILE_STATUS)return false;
    if(control.mode==='link-status'&&key==='getProgramParameter'&&args[1]===gl.LINK_STATUS)return false;
    if(control.mode==='reflection'&&key==='getFragDataLocation')return 1;
    if(key==='useProgram') {
      control.requested=args[0];let actual=args[0];
      if(control.armed&&args[0]&&args[0]!==control.smooth)actual=control.smooth;
      control.executed=actual;return value.call(target,actual);
    }
    const result=value.apply(target,args);
    if(creations[key]&&result){const id=`${creations[key]}:${++serial}`;ids.set(result,id);objects.push({id,type:creations[key],object:result});live.set(id,creations[key]);events.push({call:key,id,label:control.label});}
    if(/^delete/.test(key)&&args[0]){const id=identity(args[0]);live.delete(id);events.push({call:key,id,label:control.label});}
    if(key==='shaderSource')events.push({call:key,id:identity(args[0]),source:args[1],label:control.label});
    if(key==='compileShader')events.push({call:key,id:identity(args[0]),status:target.getShaderParameter(args[0],gl.COMPILE_STATUS),log:target.getShaderInfoLog(args[0]),label:control.label});
    if(key==='linkProgram')events.push({call:key,id:identity(args[0]),status:target.getProgramParameter(args[0],gl.LINK_STATUS),log:target.getProgramInfoLog(args[0]),label:control.label});
    if(key==='drawElements')events.push({call:key,programId:identity(target.getParameter(gl.CURRENT_PROGRAM)),mode:args[0],count:args[1],type:args[2],offset:args[3],label:control.label});
    return result;
  };}});
  report.glEvents=events;
  return {gl:proxy,control,identity,events,counts:()=>Object.fromEntries(Object.values(creations).map(type=>[type,[...live.values()].filter(x=>x===type).length])),
    finish(){equal(live.size,0,'all instrumented GL delete calls');for(const object of objects)equal(gl[`is${object.type}`](object.object),false,`actual ${object.id} collected`);report.glObjects={created:objects.length,live:live.size};}};
}
function makeRig(gl,bridge,sources,report,limits={}) {
  const watch=instrumentation(gl,report),allocations=new Map();
  const backend=ok(createWebGL2TransferBackend(watch.gl),'hardware backend').backend;
  const tracked={maxTextureSize:backend.maxTextureSize,allocate(meta){const s=backend.allocate(meta);allocations.set(meta.id,s);return s;},destroy(s){backend.destroy(s);},upload(...a){backend.upload(...a);},readback(...a){return backend.readback(...a);},dispose(){backend.dispose();}};
  const {store,bindings}=ok(createResourceStore({backend:tracked}),'resource store');
  report.translations=[];report.pairTranslations=[];report.submissions=[];
  const capability={translate(request){const result=bridge.translate(request);report.translations.push({request,result});return result;}};
  Object.defineProperty(capability,'translatePair',{get(){if(watch.control.mode==='missing-pair')return undefined;return(request)=>{
    const original=bridge.translatePair(request);let result=original;
    if(['bad-interface','bad-fragment','bad-qualifier','bad-type','bad-mask'].includes(watch.control.mode)&&original.ok){result=structuredClone(original);
      if(watch.control.mode==='bad-interface')result.interfaceKey=SMOOTH_KEY;
      if(watch.control.mode==='bad-fragment')result.fragment.glsl+='\n';
      const generic=result.vertex.metadata.outputs.find(x=>x.semantic==='GENERIC');
      if(watch.control.mode==='bad-qualifier')generic.interpolation='smooth';
      if(watch.control.mode==='bad-type')generic.type='ivec4';
      if(watch.control.mode==='bad-mask')generic.componentMask=3;
    }
    report.pairTranslations.push({request,result,original,control:watch.control.mode});return result;
  };}});
  const renderer=ok(createVirglDrawRenderer({gl:watch.gl,resources:store,bindings,shaderBridge:capability,limits}),'actual draw renderer').renderer;
  const rig={gl,watch,store,renderer,allocations,sources,report};
  rig.execute=(ctx,bytes,label)=>{watch.control.label=label;const result=renderer.executeSubmission(ctx,bytes);report.submissions.push({label,contextId:ctx,bytes:[...bytes],result});return result;};
  rig.run=(ctx,bytes,label)=>ok(rig.execute(ctx,bytes,label),label);
  rig.snapshot=()=>ok(renderer.inspect(),'renderer snapshot');
  rig.dispose=()=>{watch.control.mode=null;watch.control.armed=false;ok(renderer.dispose(),'renderer dispose');ok(renderer.dispose(),'idempotent renderer dispose');report.finalBudgets=rig.snapshot().budgets;for(const value of Object.values(report.finalBudgets))equal(value,0,'renderer final budget');ok(store.dispose(),'store dispose');equal(gl.getError(),gl.NO_ERROR,'final hardware error');watch.finish();};
  return rig;
}
function createResources(rig,mixed=false) {
  const vertices=new Uint8Array(new Float32Array(mixed?[-1,-1,0,0,0,0, 1,-1,1,0,.25,0, -1,1,0,1,1,0]:[-1,-1,0,0, 1,-1,1,0, -1,1,0,1]).buffer);
  const indices=new Uint8Array(new Uint16Array([0,1,2,1,2,0]).buffer);
  rig.vertexBytes=vertices.byteLength;
  for(const [id,target,format,bind,width,height,data] of [[101,0,64,16,vertices.byteLength,1,vertices],[102,0,64,32,12,1,indices],[103,2,67,10,32,32,new Uint8Array(4096)]]) {
    ok(rig.store.createResource({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'rig resource');ok(rig.store.attachBacking(id,[data]),'rig backing');
  }
}
function createContext(rig,id) {
  ok(rig.store.createContext(id),'resource context');ok(rig.renderer.createContext(id),'renderer context');
  for(const resourceId of [101,102,103])ok(rig.store.attachContext(id,resourceId),'context resource');
  for(const [resourceHandle,width] of [[101,rig.vertexBytes],[102,12]]) {
    const ticket=ok(rig.store.prepareTransfer(id,{opcode:43,fields:{resourceHandle,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width,height:1,depth:1},dataOffset:0,direction:1}}),'vertex/index upload').ticket;
    ok(rig.store.executeTransfer(ticket),'actual vertex/index upload');
  }
}
function setupSub(rig,id,mixed=false) {
  const {sources}=rig;
  rig.run(id,join(shaderPacket(1,0,sources.vertex.text),shaderPacket(2,1,sources.flat.text),shaderPacket(3,1,sources.smooth.text),
    packet(1,8,[10,103,67,0,0]),packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29,8,0,0,29,...(mixed?[16,0,0,29]:[])]),packet(2,5,[11]),
    packet(6,0,[mixed?24:16,0,101]),packet(11,0,[102,2,0]),packet(4,0,[0,bits(16),bits(16),bits(.5),bits(16),bits(16),bits(.5)]),bind(1,0)),'bounded triangle setup');
}
function readPixels(rig) {
  const gl=rig.gl,prior=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),fb=gl.createFramebuffer();
  try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rig.allocations.get(103).texture,0);
    equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'independent read FBO');const bytes=new Uint8Array(4096);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'independent readPixels');return bytes;
  }finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,prior);gl.deleteFramebuffer(fb);}
}
function budgetCheck(rig,flatBytes) {
  const snapshot=rig.snapshot();let expected=0;
  for(const ctx of snapshot.contexts)for(const sub of ctx.subContexts){
    for(const obj of sub.objects)if(obj.translation)expected+=obj.fields.text.length+obj.translation.glsl.length;
    for(const program of sub.programs){equal(program.variantBytes,program.interfaceKey.includes('/flat')?flatBytes:0,'owned variant GLSL budget');expected+=program.variantBytes;
      equal(program.key,`${sub.generation}:${program.vertexGeneration}:${program.fragmentGeneration}:${program.interfaceKey}|${program.samplingKey}`,'owner+generation+interface+view program key');}
  }
  equal(snapshot.budgets.shaderBytes,expected,'independent selector+variant byte accounting');return snapshot;
}
async function phase(rig,ctx,name,mode,order,report,flatBytes,sabotage=false) {
  rig.watch.control.armed=sabotage;
  rig.run(ctx,bind(mode==='smooth'?3:2,1),`${name} select fragment`);
  rig.run(ctx,packet(11,0,[102,2,order[0]===0?0:6]),`${name} indices`);
  const before=budgetCheck(rig,flatBytes),sub=subOf(before,ctx),program=sub.programs.find(p=>p.vertexGeneration===sub.bindings.vertexShader.generation&&p.fragmentGeneration===sub.bindings.fragmentShader.generation);
  require(program,'selected program diagnostic');equal(program.interfaceKey,mode==='mixed'?'generic-interpolation-v1:g0/15/flat;g1/15/smooth':mode==='flat'?FLAT_KEY:SMOOTH_KEY,'selected effective interface');
  rig.run(ctx,CLEAR,`${name} clear`);const executed=rig.run(ctx,DRAW,`${name} draw`);
  const record={name,mode,order,indices:order,width:32,height:32,contextId:ctx,subContextId:sub.id,program,programId:rig.watch.identity(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM)),
    requestedProgramId:rig.watch.identity(rig.watch.control.requested),draw:executed.draws[0],budgets:before.budgets};report.draws.push(record);
  if(mode==='smooth'){rig.watch.control.smooth=rig.gl.getParameter(rig.gl.CURRENT_PROGRAM);rig.smoothDiagnostic=program;}
  if(sabotage){record.sabotage={mode:'flat-reuse',requested:{programId:record.requestedProgramId,...program},executed:{programId:record.programId,...rig.smoothDiagnostic}};report.sabotage=record.sabotage;
    require(record.requestedProgramId!==record.programId,'sabotage executes a different real program');
    equal(rig.gl.getProgramParameter(rig.watch.control.requested,rig.gl.LINK_STATUS),true,'requested flat program linked');equal(rig.gl.getProgramParameter(rig.watch.control.smooth,rig.gl.LINK_STATUS),true,'reused smooth program linked');}
  const bytes=readPixels(rig);tile(bytes,name);await checkPixels(bytes,record,mode,order);rig.watch.control.armed=false;return record;
}
function snapshotLinkFailure(rig,ctx,mode,report) {
  const before=rig.snapshot(),liveBefore=rig.watch.counts(),eventsBefore=rig.watch.events.length;rig.watch.control.mode=mode;
  const result=bad(rig.execute(ctx,bind(2,1),`controlled ${mode}`),mode);rig.watch.control.mode=null;
  const after=rig.snapshot();equal({contexts:after.contexts,budgets:nativeBudgets(after.budgets)},{contexts:before.contexts,budgets:nativeBudgets(before.budgets)},`${mode} unchanged publication and native budgets`);equal(after.work.failedSubmissions,before.work.failedSubmissions+1,`${mode} truthful failed submission counter`);equal(rig.watch.counts(),liveBefore,`${mode} no native object leaks`);
  if(mode.startsWith('bad-')||mode==='missing-pair')require(!rig.watch.events.slice(eventsBefore).some(e=>/^create/.test(e.call)),`${mode} no GL allocation`);
  report.failure={mode,result,before,after,liveBefore,liveAfter:rig.watch.counts(),events:rig.watch.events.slice(eventsBefore)};
}
const nativeBudgets = budgets => {const {cacheBytes,...native}=budgets;return native;};
export async function runRendererPairs(gl,{bridge,sources,anchors},report,sabotage) {
  report.draws=[];report.lifecycle=[];report.faults=[];report.quota=[];
  const flatBytes=anchors.find(a=>a.name==='flat').result.vertex.glsl.length;
  const primary={name:'primary'};report.primary=primary;const rig=makeRig(gl,bridge,sources,primary);
  try {
    createResources(rig);createContext(rig,1);setupSub(rig,1);
    const a=await phase(rig,1,'renderer smooth012','smooth',[0,1,2],report,flatBytes);
    const b=await phase(rig,1,'renderer flat012','flat',[0,1,2],report,flatBytes,sabotage==='flat-reuse');
    const stable=rig.snapshot(),allocationCount=rig.watch.events.filter(e=>e.call.startsWith('create')).length,pairCalls=primary.pairTranslations.length;
    const c=await phase(rig,1,'renderer smooth012 reused','smooth',[0,1,2],report,flatBytes);
    const d=await phase(rig,1,'renderer flat120 reused','flat',[1,2,0],report,flatBytes);
    const e=await phase(rig,1,'renderer smooth120 reused','smooth',[1,2,0],report,flatBytes);
    const f=await phase(rig,1,'renderer flat012 reused','flat',[0,1,2],report,flatBytes);
    equal([c.programId,e.programId],[a.programId,a.programId],'same smooth native program reused');equal([d.programId,f.programId],[b.programId,b.programId],'same flat native program reused');
    equal(primary.pairTranslations.length,pairCalls,'warm links avoid pair conversion');equal(rig.watch.events.filter(e=>e.call.startsWith('create')).length,allocationCount,'warm links avoid allocations');
    const warm=rig.snapshot();equal(nativeBudgets(warm.budgets),nativeBudgets(stable.budgets),'warm native cache residency unchanged');for(const cache of Object.values(warm.caches))require(cache.bytes<=cache.limits.bytes&&cache.entries<=cache.limits.entries,'warm complete-key state cache remains bounded');
    const before=rig.snapshot(),oldVS=subOf(before,1).bindings.vertexShader;
    rig.run(1,packet(3,4,[1]),'destroy bound vertex selector');const retained=rig.snapshot();equal(retained.budgets,before.budgets,'bound destroyed vertex remains live');
    rig.run(1,shaderPacket(1,0,sources.vertex.text),'reuse public vertex handle');rig.run(1,bind(1,0),'bind new vertex generation');
    const replacement=budgetCheck(rig,flatBytes);require(subOf(replacement,1).bindings.vertexShader.generation!==oldVS.generation,'vertex numeric handle generation replaced');
    require(!subOf(replacement,1).programs.some(p=>p.vertexGeneration===oldVS.generation),'old vertex programs collected');
    report.lifecycle.push({name:'bound-vertex-handle-reuse',before,retained,after:replacement});await phase(rig,1,'replaced vertex flat','flat',[0,1,2],report,flatBytes);
    const oldFS=subOf(rig.snapshot(),1).bindings.fragmentShader;
    rig.run(1,packet(3,4,[2]),'destroy bound flat selector');rig.run(1,shaderPacket(2,1,sources.smooth.text),'replace flat handle by smooth text');rig.run(1,bind(2,1),'bind replacement smooth fragment');
    const fsReplaced=budgetCheck(rig,flatBytes);require(!subOf(fsReplaced,1).programs.some(p=>p.fragmentGeneration===oldFS.generation),'old flat selector variant collected');
    equal(subOf(fsReplaced,1).programs[0].variantBytes,0,'replacement smooth has no flat variant');report.lifecycle.push({name:'fragment-generation-interface-reuse',after:fsReplaced});
    rig.run(1,bind(3,1),'release replacement selector');rig.run(1,packet(3,4,[2]),'delete replacement smooth');rig.run(1,shaderPacket(2,1,sources.flat.text),'restore original flat selector');
    createContext(rig,2);setupSub(rig,2);await phase(rig,2,'context2 flat','flat',[0,1,2],report,flatBytes);await phase(rig,1,'context1 smooth isolated','smooth',[0,1,2],report,flatBytes);
    rig.run(2,packet(29,0,[7]),'create isolated subcontext');setupSub(rig,2);await phase(rig,2,'subcontext7 flat','flat',[0,1,2],report,flatBytes);
    const subGeneration=subOf(rig.snapshot(),2).generation;rig.run(2,packet(30,0,[7]),'destroy subcontext7');rig.run(2,packet(29,0,[7]),'reuse subcontext7');setupSub(rig,2);
    require(subOf(rig.snapshot(),2).generation!==subGeneration,'subcontext generation replaced');await phase(rig,2,'replacement subcontext7 smooth','smooth',[1,2,0],report,flatBytes);
    const contextGeneration=rig.snapshot().contexts.find(x=>x.id===2).generation;ok(rig.renderer.destroyContext(2),'destroy context2');ok(rig.store.destroyContext(2),'destroy resource context2');
    createContext(rig,2);setupSub(rig,2);require(rig.snapshot().contexts.find(x=>x.id===2).generation!==contextGeneration,'context generation replaced');await phase(rig,2,'replacement context2 flat','flat',[1,2,0],report,flatBytes);
    await phase(rig,1,'surviving context1 flat','flat',[0,1,2],report,flatBytes);report.lifecycle.push({name:'context-subcontext-isolation-reuse',snapshot:budgetCheck(rig,flatBytes)});
  } finally {rig.dispose();report.finalBudgets=primary.finalBudgets;}
  const mixedRecord={name:'mixed-renderer'};report.mixed=mixedRecord;
  const mixed=makeRig(gl,bridge,{vertex:{text:MIXED_VERTEX},flat:{text:MIXED_FRAGMENT},smooth:sources.smooth},mixedRecord);
  try{createResources(mixed,true);createContext(mixed,1);setupSub(mixed,1,true);
    const bytes=anchors.find(a=>a.name==='mixed').result.vertex.glsl.length;
    const first=await phase(mixed,1,'renderer mixed012','mixed',[0,1,2],report,bytes);
    const second=await phase(mixed,1,'renderer mixed120 reused','mixed',[1,2,0],report,bytes);
    equal(second.programId,first.programId,'mixed interface program reused');equal(mixedRecord.pairTranslations.length,1,'mixed interface translated once');
  }finally{mixed.dispose();}
  for(const mode of ['createShader','compile-status','createProgram','link-status','createBuffer','reflection','missing-pair','bad-interface','bad-fragment','bad-qualifier','bad-type','bad-mask']) {
    const record={name:mode};report.faults.push(record);const r=makeRig(gl,bridge,sources,record);
    try{createResources(r);createContext(r,1);setupSub(r,1);await phase(r,1,`${mode} baseline smooth`,'smooth',[0,1,2],report,flatBytes);snapshotLinkFailure(r,1,mode,record);await phase(r,1,`${mode} flat recovery`,'flat',[0,1,2],report,flatBytes);}finally{r.dispose();}
  }
  const baseBytes=[['vertex',sources.vertex.text],['fragment',sources.flat.text],['fragment',sources.smooth.text]].reduce((n,[stage,text])=>n+text.length+ok(bridge.translate({stage,text}),'quota base').glsl.length,0);
  for(const delta of [-1,0]){
    const record={name:`variant-quota${delta}`,baseBytes,flatBytes,limit:baseBytes+flatBytes+delta};report.quota.push(record);const r=makeRig(gl,bridge,sources,record,{shaderBytes:record.limit});
    try{createResources(r);createContext(r,1);setupSub(r,1);await phase(r,1,`${record.name} smooth`,'smooth',[0,1,2],report,flatBytes);
      if(delta<0){snapshotLinkFailure(r,1,'quota',record);equal(record.failure.result.error.code,'limit-exceeded','variant quota rejection');require(!record.failure.events.some(e=>e.call.startsWith('create')),'quota checked before allocation');}
      else await phase(r,1,'exact variant quota flat','flat',[0,1,2],report,flatBytes);
    }finally{r.dispose();}
  }
  // Genuine stage/interface errors use real translated selectors, before allocation.
  const negatives={name:'stage-semantic-errors'};report.negatives=negatives;const n=makeRig(gl,bridge,sources,negatives);
  try{createResources(n);createContext(n,1);setupSub(n,1);await phase(n,1,'negative baseline smooth','smooth',[0,1,2],report,flatBytes);
    const texts=[['missing',sources.missingVertex.text],['components',sources.partialVertex.text]];negatives.errors=[];
    for(const [name,text]of texts){n.run(1,shaderPacket(20,0,text),`${name} producer`);const before=n.snapshot(),count=n.watch.events.length;const result=bad(n.execute(1,link(20,2),`${name} flat link`),name);const after=n.snapshot();equal({contexts:after.contexts,budgets:after.budgets},{contexts:before.contexts,budgets:before.budgets},`${name} unchanged state`);equal(after.work.failedSubmissions,before.work.failedSubmissions+1,`${name} truthful rejection counter`);require(!n.watch.events.slice(count).some(e=>e.call.startsWith('create')),`${name} reject before GL allocation`);negatives.errors.push({name,inputSha256:await digest(text),result});n.run(1,packet(3,4,[20]),'delete negative producer');}
    negatives.errors.push({name:'wrong-stage',result:bad(n.execute(1,bind(2,0),'wrong stage binding'),'wrong stage')});
    await phase(n,1,'negative flat recovery','flat',[0,1,2],report,flatBytes);
  }finally{n.dispose();}
  report.status='passed';
}
export async function runAcceptance({sabotage=null}={}) {
  require(sabotage===null||sabotage==='flat-reuse','known sabotage');
  const report={status:'running',guestExecution:false,productionVirgl:false,sabotage,shaderPairs:{},rendererPairs:{}};window.__virglPairsReport=report;
  try {
    const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;
    const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(gl instanceof WebGL2RenderingContext,'hardware WebGL2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'GPU identity');report.renderer={vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)};
    require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'hardware GPU');
    const shader=await runShaderPairs(gl,report.shaderPairs);await runRendererPairs(gl,shader,report.rendererPairs,sabotage);
    report.status='passed';document.querySelector('#status').textContent='12/19 original shaders · derived flat interfaces · actual renderer cache and lifecycle';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
