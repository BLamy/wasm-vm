import {rig,finish,blob,submit,nativeRead,checks} from './standard-multiple-color-rig.mjs';
import {createVirglStandardMultipleColorAsyncRenderer,createVirglStandardIntegerImageAsyncRenderer} from '../state.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {make,ids,positions,metadata,setup,state,draw,framebuffer,packet,join,surface,clear,shader,textureTransfer} from '../../../tools/virgl-multiple-color/fixtures.mjs';
import {imageView,sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
export async function runBoundaries({seed=0x91230ae1}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),
  bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),
  report={status:'running',guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,mode:'boundaries',runs:[],frames:[],blobs:[],predictions:c.rows};
 window.__standardMultipleColorEvidence=report;
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 async function begin(kind,options={},formats=[196,196,196,196]){
  const f=make(kind,formats),r=rig(gl,bridge,c,f,{delay:jitter,step:1,...options}),row={...f,kind,frames:[],actions:[],boundary:true};
  r.blobs=report.blobs;report.runs.push(row);row.positions=await blob(report,positions);
  const targets=f.formats.map((format,slot)=>{r.add(metadata(ids[slot],format,4,4,0,10),new Uint8Array(r.outputBackingBytes).fill(0x2e));const target=r.allocations.at(-1);target.slot=slot;return target;});
  r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
  c.ok((await submit(r,1,setup(f),kind+'/setup')).result,'original boundary setup');return{r,row,f,targets};
 }
 async function capture(r,row,f,record,targets,{retired=false,clearWords=null}={}){
  c.ok(record.result,'original boundary native completion');c.same(record.result.gpuComplete,true,'boundary has actual GPU completion');
  const frame={run:report.runs.indexOf(row),kind:'draw',boundary:true,retired,label:record.label,historyIndex:r.history.indexOf(record),completion:{...r.lastCompletion},targets:[]};
  report.frames.push(frame);row.frames.push(report.frames.length-1);
  for(const target of targets){
   const raw=nativeRead(r,target.storage.texture,target.metadata.format,4,4,0),words=new Uint32Array(raw.buffer,raw.byteOffset,raw.byteLength/4),expected=Array.from({length:64},(_,index)=>(clearWords??f.words[target.slot])[index%4]);
   const differences=[];for(let at=0;at<words.length;at++)if(words[at]!==expected[at])differences.push({at,observed:words[at],expected:expected[at]});
   frame.targets.push({slot:target.slot,metadata:target.metadata,generation:target.generation,texture:r.trace.id(target.storage.texture),level:0,native:await blob(report,raw),expected,planes:[]});
   c.same(differences.slice(0,16),[],'complete original nonzero boundary words');
  }
  c.same(gl.getError(),gl.NO_ERROR,'native multiple-color boundary capture');return frame;
 }
 {
  const {r,row,f,targets}=await begin('typed-indexed-reversed-viewport');
  try{
   const indices=new Uint8Array([0,1,2,3,4,5]);row.indices=await blob(report,indices);
   r.add({id:7,target:0,format:64,bind:0,width:6,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},indices);
   const wire=join(textureTransfer(7,0,6,1),packet(1,5,[88,0,0,0,196]),packet(2,5,[88]),packet(11,0,[7,1,0]),
    packet(4,0,[0,...[2,-2,.5,2,2,.5].map(value=>new Uint32Array(new Float32Array([value]).buffer)[0])]),
    packet(8,0,[0,6,4,1,1,0,0,0,0,0,0xffffffff,0]));
   await capture(r,row,f,await submit(r,1,wire,'boundary/typed-indexed-negative-Y'),targets);
   c.same(r.draws.at(-1).name,'drawElements','actual original indexed multiple-color call');
   c.same(r.draws.at(-1).attributes[0].integer,true,'original UINT words use native integer vertex fetch');
  }finally{await finish(r,report,row);}
 }
 {
  const {r,row,f,targets}=await begin('historical-integer-blend-bypass',{rendererFactory:createVirglStandardIntegerImageAsyncRenderer},[196]);
  try{
   f.blendEnabled=true;c.ok((await submit(r,1,state(f),'boundary/historical-integer-enabled-blend')).result,'historical blend state');
   await capture(r,row,f,await submit(r,1,draw(),'boundary/historical-integer-bypass'),targets);
   c.same(r.draws.at(-1).native.blend,false,'closed historical integer-only native blend bypass');
  }finally{await finish(r,report,row);}
 }
 {
  const {r,row,f,targets}=await begin('shape-cache-context-generation');
  try{
   await capture(r,row,f,await submit(r,1,draw(),'boundary/original-four'),targets);
   c.ok((await submit(r,2,setup(f),'boundary/context2-setup')).result,'second native context setup');
   await capture(r,row,f,await submit(r,2,draw(),'boundary/context2-four'),targets);
   c.ok(r.renderer.restoreContext(1),'restore first original context');
   r.add(metadata(8,200,4,4,0,10),new Uint8Array(r.outputBackingBytes).fill(0x2e));const other={...r.allocations.at(-1),slot:3};
   const before=r.renderer.inspect().work.programLinks;
   c.ok((await submit(r,1,join(surface(44,8,200,0),packet(5,0,[4,0,20,21,22,44])),'boundary/opposite-nonzero-sign')).result,'original nonzero type change');
   await capture(r,row,f,await submit(r,1,draw(),'boundary/changed-four'),[...targets.slice(0,3),other]);
   c.same(r.renderer.inspect().work.programLinks>before,true,'nonzero target type joins native cache identity');
   const changed=r.renderer.inspect().work.programLinks;
   c.ok((await submit(r,1,framebuffer(f),'boundary/return-four')).result,'restore four original surfaces');
   await capture(r,row,f,await submit(r,1,draw(),'boundary/returned-four'),targets);
   c.same(r.renderer.inspect().work.programLinks,changed,'A/B/A reuses original complete native format variant');
   for(const slots of [[0],[1],[0,2],[1,2,3],[0,1,2,3]]){
    const formats=f.formats.map((format,slot)=>slots.includes(slot)?format:null);
    c.ok((await submit(r,1,framebuffer(f,formats),'boundary/shape-'+slots.join(''))).result,'original sparse shape state');
    const record=await submit(r,1,draw(),'boundary/shape-draw-'+slots.join(''));await capture(r,row,f,record,targets.filter(t=>slots.includes(t.slot)));
    const native=r.draws.at(-1).native.colors;
    c.same(native.map(t=>Boolean(t.attachment)),Array.from({length:4},(_,slot)=>slots.includes(slot)),'all stale native attachments detach');
    c.same(native.map(t=>t.drawBuffer),Array.from({length:4},(_,slot)=>slots.includes(slot)?gl.COLOR_ATTACHMENT0+slot:gl.NONE),'original sparse draw buffers');
   }
   c.ok(r.renderer.resetCaches(),'reset multiple-color caches');c.ok(r.renderer.restoreContext(2),'restore second context after cache eviction');
   await capture(r,row,f,await submit(r,2,draw(),'boundary/context2-restored'),targets);
   c.ok(r.store.unref(5),'retire bound nonzero original resource name');
   const replacement=r.add(metadata(5,200,9,3,0,10),new Uint8Array(r.outputBackingBytes).fill(0x71));
   c.same(replacement.generation>targets[3].generation,true,'nonzero ID reuse has a distinct retained generation');
   row.actions.push({kind:'nonzero-id-reuse',oldGeneration:targets[3].generation,newGeneration:replacement.generation});
   await capture(r,row,f,await submit(r,1,draw(),'boundary/retained-context1'),targets);
   await capture(r,row,f,await submit(r,2,draw(),'boundary/retained-context2'),targets);
   const unchanged=c.ok(r.store.readBacking(5,0,r.outputBackingBytes),'replacement original backing').bytes;
   c.same(unchanged.every(value=>value===0x71),true,'old native draws preserve every replacement backing byte');row.replacementBacking=await blob(report,unchanged);
  }finally{await finish(r,report,row);}
 }
 for(const mode of ['complete','cancel','renderer-dispose','resource-dispose']){
  const {r,row,f,targets}=await begin('queued-'+mode);let point=null;
  try{
   const wire=join(draw(),packet(5,0,[0,0]),...targets.map(t=>packet(3,8,[20+t.slot])));
   const record=await submit(r,1,wire,'queued-multiple-'+mode,async(step,job)=>{
    const state=r.renderer.inspect();if(state.jobs.status!=='finishing'||point)return;
    point={renderer:state,before:r.store.inspect(),images:r.imageAccess.inspect()};
    for(const target of targets){c.ok(r.store.unref(target.metadata.id),'retire queued original color name');
     const fresh=r.add(metadata(target.metadata.id,200,9,3,0,10),new Uint8Array(r.outputBackingBytes).fill(0x71));
     c.same(fresh.generation>target.generation,true,'queued old color generation remains distinct');}
    point.after=r.store.inspect();row.actions.push({kind:'four-original-generations-held-by-physical-fence',...point});
    c.same(point.before.budgets.imageHolds,4,'all four old color surfaces held by pending native completion');
    if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel original multiple-color final fence');
    if(mode.endsWith('dispose')){if(mode==='resource-dispose')c.ok(r.store.dispose(),'dispose original owner with held colors');
     c.ok(r.renderer.dispose(),'dispose original multiple-color renderer');return{disposed:true,appliedCommands:state.jobs.appliedCommands};}
   });
   row.actions.push(record);c.same(Boolean(point),true,'queued multiple colors reach finishing');
   if(mode==='complete')c.ok(record.result,'queued original complete');else c.same(record.result.error.code,mode==='cancel'?'cancelled':'disposed','owned queued terminal state');
  }finally{await finish(r,report,row);}
  if(mode==='complete'||mode==='cancel'){
   const native=row.draws.at(-1),frame={run:report.runs.indexOf(row),kind:'draw',boundary:true,retired:true,label:native.label,
    historyIndex:row.history.findIndex(h=>h.label===native.label),targets:[]};
   for(const target of targets){const retired=row.retiredPlanes.find(p=>p.texture===r.trace.id(target.storage.texture));
    c.same(Boolean(retired),true,'each old color plane captured after actual completion before retirement');
    frame.targets.push({slot:target.slot,metadata:target.metadata,generation:target.generation,texture:r.trace.id(target.storage.texture),level:0,native:retired.native,planes:[]});frame.completion=retired.completion;}
   report.frames.push(frame);row.frames.push(report.frames.length-1);
  }
 }
 {
  const {r,row,f,targets}=await begin('feedback-clear-native-failure');
  try{
   const text='FRAG\nDCL OUT[5], COLOR\nDCL SAMP[0]\nDCL SVIEW[0], 2D, UINT\nIMM[0] INT32 {0,0,0,0}\n0: TXF OUT[5], IMM[0], SAMP[0], 2D\n1: END\n';
   const before=r.draws.length,refusal=await submit(r,1,join(shader(80,1,text),imageView(81,5,196,0,0),
    sampler(82,{s:2,t:2,r:2,min:0,mip:0,mag:0,minLod:-1000,maxLod:1000}),packet(10,0,[1,0,81]),packet(18,0,[1,0,82]),packet(31,0,[80,1]),draw()),'boundary/nonzero-feedback');
   c.same(refusal.result.error.code,'framebuffer-feedback','original sampler feedback checks nonzero attached target');c.same(r.draws.length,before,'nonzero feedback issues no native guest draw');row.actions.push(refusal);
   c.ok((await submit(r,1,packet(31,0,[11,1]),'boundary/restore-original-fragment')).result,'restore original fragment');
   await capture(r,row,f,await submit(r,1,draw(),'boundary/feedback-recovery'),targets);
   for(const [reason,wire]of [['missing-color',join(packet(5,0,[1,0,20]),clear(32,[0,0,0,0]))],['missing-depth',clear(1,[0,0,0,0])]]){
    const result=await submit(r,1,wire,'boundary/'+reason);c.same(result.result.error.code,'incomplete-framebuffer','selected clear refuses '+reason);row.actions.push(result);
   }
   c.ok((await submit(r,1,framebuffer(f),'boundary/restore-all-colors')).result,'restore all native attachments');
   r.add(metadata(9,31,4,4,0,10),new Uint8Array(r.outputBackingBytes).fill(0x2e));
   const invalid=await submit(r,1,join(surface(86,9,31,0),packet(5,0,[4,0,20,21,22,86]),clear(32,[0x7fc01234,0,0,0])),'boundary/nonzero-nonfinite-float-clear');
   c.same(invalid.result.error.code,'invalid-value','nonzero FLOAT clear refuses raw nonfinite integer union');row.actions.push(invalid);
  }finally{await finish(r,report,row);}
 }
 {
  const {r,row,f,targets}=await begin('original-depth-clear');
  try{
   r.add(metadata(16,16,4,4,0,1),new Uint8Array(32));
   c.ok((await submit(r,1,join(surface(90,16,16,0),packet(5,0,[4,90,20,21,22,23]),
    packet(1,3,[91,1|(1<<2),0,0,0]),packet(2,3,[91])),'boundary/depth-state')).result,'original Z16 depth state');
   const zero=clear(1,[0,0,0,0]);new DataView(zero.buffer).setFloat64(24,0,true);
   c.ok((await submit(r,1,zero,'boundary/depth-zero')).result,'full original zero-depth clear');
   await capture(r,row,f,await submit(r,1,draw(),'boundary/depth-rejects'),targets,{clearWords:f.clearWords});
   c.ok((await submit(r,1,clear(61,f.clearWords),'boundary/full-depth-and-four-colors')).result,'full original depth and color clear');
   c.same(gl.getParameter(gl.DEPTH_WRITEMASK),false,'full clear restores original disabled depth write mask');
   await capture(r,row,f,await submit(r,1,draw(),'boundary/depth-accepts'),targets);
   c.same(r.draws.at(-1).native.depthTest,true,'actual native depth test');c.same(r.draws.at(-1).native.depthFunction,gl.LESS,'actual original LESS depth function');
  }finally{await finish(r,report,row);}
 }
 {
  const {r,row,f}=await begin('actual-native-clear-failure',{nativeFault:'integer-clear'});
  try{
   r.armFault();const result=await submit(r,1,clear(32,f.clearWords),'boundary/actual-nonzero-clear-error');
   c.same(result.result.error.code,'backend-error','actual nonzero native clear GLenum failure is controlled');
   c.same(r.faultEvents.length,1,'actual native clear failure executed');row.actions.push(result);
  }finally{await finish(r,report,row);}
 }
 {
  const {r,row}=await begin('measured-host-closed-config');let allocations=0;
  const base={shaderBridge:bridge,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,uniformAccess:r.uniformAccess,imageAccess:r.imageAccess};
  try{
   for(const deny of ['extension','MAX_DRAW_BUFFERS','MAX_COLOR_ATTACHMENTS']){
    const proxy=new Proxy(gl,{get(target,name){const fn=Reflect.get(target,name,target);if(typeof fn!=='function')return fn;return(...args)=>{
     if(/^create/.test(name))allocations++;if(name==='getExtension'&&deny==='extension'&&args[0]==='OES_draw_buffers_indexed')return null;
     if(name==='getParameter'&&args[0]===gl[deny])return 3;return fn.apply(target,args);};}});
    const result=createVirglStandardMultipleColorAsyncRenderer({...base,gl:proxy});c.same(result.error.code,'unsupported-host','measured native host refusal '+deny);row.actions.push({deny,result});
   }
   c.same(allocations,0,'unsupported native capability refuses before any allocation');
   for(const config of [{multipleColors:true},{guestProfile:'multiple'},{limits:{contexts:9}},{jobLimits:{commandsPerStep:0}}]){
    const result=createVirglStandardMultipleColorAsyncRenderer({...base,gl,...config});c.same(result.ok,false,'strict selected original config refuses');row.actions.push({config,result});
   }
  }finally{await finish(r,report,row);}
 }
 report.status='passed';return report;
}
