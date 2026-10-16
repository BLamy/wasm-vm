import {rig,finish,blob,nativeRead,physicalFence,submit,checks,nativeStencil} from './standard-stencil-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {createVirglStandardPackedDepthImageAsyncRenderer} from '../state.mjs';
import {runWireAcceptance} from './standard-stencil-wire.mjs';
import {cases,specimen,source,positionsFor,setup,state,expected,clear,packet,join,dsa,refs,face,metadata,surface,word,textureTransfer,shader,draw,uniformPlane,missWords,bytesPerPixel,stencilOffset,setDepth,depthAt} from '../../../tools/virgl-stencil/fixtures.mjs';
import {nativeMisses} from '../../../tools/virgl-packed-depth-consumer/fixtures.mjs';
export {runWireAcceptance};
async function environment({mode,seed,fault}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});if(!gl)throw Error('actual stencil WebGL2 unavailable');
 const bridge=await createVirglStandardIntegerImageShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode,seed,fault,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};window.__standardStencilEvidence=report;return {c,gl,bridge,report};
}
async function sealRun(report,row,c){if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,format:row.format,kind:row.kind,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};report.predictionCount=(report.predictionCount??0)+row.predictions.length;}}
async function makeRun(env,f,options={}){
 const {c,gl,bridge,report}=env,r=rig(gl,bridge,c,f,options),row={name:f.name,kind:f.kind,format:f.format,level:f.level,width:f.width,height:f.height,outputLevel:f.outputLevel,targetWidth:f.targetWidth,targetHeight:f.targetHeight,outputLastLevel:f.outputLastLevel,vertex:f.vertex,fragment:f.fragment,front:f.front,back:f.back,frontRef:f.frontRef,backRef:f.backRef,depthEnable:f.depthEnable,depthWrite:f.depthWrite,depthFunc:f.depthFunc,incoming:f.incoming,reverse:f.reverse,frontCcw:f.frontCcw,scissor:f.scissor,frames:[],planes:[],actions:[],clearBuffers:f.clearBuffers,clearStencil:f.clearStencil,clearDepth:f.clearDepth};
 r.blobs=report.blobs;r.outputBackingBytes=Math.max(20000,5+f.height*(f.width*16+3));report.runs.push(row);const target=r.add(metadata(1,31,f.targetWidth,f.targetHeight,f.outputLastLevel),new Uint8Array(r.outputBackingBytes).fill(0x2e));
 const positions=positionsFor(f.incoming,f.reverse);r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
 const original=r.add(f.source.metadata,f.source.backing),texture=r.allocations.find(a=>a.metadata.id===6).storage.texture;row.sourceGeneration=original.generation;row.sourceMetadata=f.source.metadata;row.sourceBacking=await blob(report,f.source.backing);row.positions=await blob(report,positions);row.target=metadata(1,31,f.targetWidth,f.targetHeight,f.outputLastLevel);row.targetBackingBytes=r.outputBackingBytes;
 for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});return {r,row,target,original,texture};
}
async function output(env,f,r,row,target,color,label,record){
 const {c,report}=env;c.ok(record.result,'original native stencil completion');c.same(record.result.gpuComplete,true,'stencil command has physically completed');
 const texture=r.allocations.find(a=>a.metadata.id===1&&a.storage.texture===target.storage?.texture)?.storage.texture??r.allocations.find(a=>a.metadata.id===1).storage.texture,
  native=await nativeRead(r,texture,31,f.width,f.height,f.outputLevel),frame={label,historyIndex:r.history.length-1,completion:{...r.lastCompletion},native:await blob(report,native),depths:[]};row.frames.push(frame);
 const miss=missWords(native,color);if(miss.length)report.sabotage={fault:report.fault,miss,completion:frame.completion};c.same(miss,[],'all native stencil-tested color words');
 const read=packet(43,0,[1,f.outputLevel,0,f.width*16+3,0,0,0,0,f.width,f.height,1,5,2]);c.ok((await submit(r,1,read,label+'/public-color')).result,'original native public color read');frame.publicHistoryIndex=r.history.length-1;
 const wanted=new Uint8Array(r.outputBackingBytes).fill(0x2e);for(let y=0;y<f.height;y++)wanted.set(color.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));
 const backing=c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'whole original stencil output backing').bytes;frame.backing=await blob(report,backing);c.same([...backing],[...wanted],'every stencil-tested public color and padding byte');return frame;
}
async function depths(env,f,r,row,frame,texture,planes={},clearDepths={},first=0,last=f.source.metadata.lastLevel){
 const {c,report}=env;
 for(let level=first;level<=last;level++){
  const p=f.source.planes[level],input=planes[level]??p.input,native=await nativeRead(r,texture,f.format,p.width,p.height,level-first),item={level,local:level-first,width:p.width,height:p.height,completion:{...r.lastCompletion},native:await blob(report,native)};frame.depths.push(item);
  const miss=nativeMisses(f.format,input,native,f.format===20?(clearDepths[level]??null):null);if(miss.length)report.sabotage={fault:report.fault,miss,completion:item.completion};c.same(miss,[],'independent native stencil/depth and unaffected mip '+level);
 }
}
function canonical(format,input){const out=input.slice();if(format===126)for(let i=0;i<out.length;i+=8)out.fill(0,i+5,i+8);if(format===21)for(let i=3;i<out.length;i+=4)out[i]=0;return out;}
async function publicDepth(env,f,r,row,planes={},clearDepths={}){
 const {c,report}=env;let wanted=f.source.backing.slice(),cursor=f.source.backing.length-44000;
 const before=c.ok(r.store.readBacking(6,0,wanted.length),'original source backing before native read').bytes;row.publicBackingBefore=await blob(report,before);c.same([...before],[...wanted],'GPU-only stencil work preserves original backing');row.publicDepth=[];
 for(const p of f.source.planes){
  let input=(planes[p.level]??p.input).slice(),nativeChoice=null;
  if(clearDepths[p.level]!==undefined&&f.format===20){const texture=r.allocations.find(a=>a.metadata.id===6).storage.texture,raw=await nativeRead(r,texture,f.format,p.width,p.height,p.level);c.same(nativeMisses(f.format,input,raw,clearDepths[p.level]),[],'native packed clear depth in original conversion interval');nativeChoice=await blob(report,raw);const v=new DataView(raw.buffer);for(let i=0;i<p.width*p.height;i++)setDepth(f.format,input,i,v.getFloat32(i*16,true));}
  const bpp=bytesPerPixel(f.format),stride=p.width*bpp+7,offset=cursor;cursor+=stride*p.height+17;
  const bytes=packet(43,0,[6,p.level,0,stride,0,0,0,0,p.width,p.height,1,offset,2]);c.ok((await submit(r,1,bytes,'stencil-public-depth-'+p.level)).result,'original native stencil public transfer');
  const tight=canonical(f.format,input);for(let y=0;y<p.height;y++)wanted.set(tight.subarray(y*p.width*bpp,(y+1)*p.width*bpp),offset+y*stride);
  const observed=c.ok(r.store.readBacking(6,0,wanted.length),'whole original stencil source public backing').bytes;row.publicDepth.push({level:p.level,stride,offset,historyIndex:r.history.length-1,nativeChoice,backing:await blob(report,observed)});c.same([...observed],[...wanted],'exact original stencil/depth public fields and all padding');
 }
}
export async function runAcceptance({mode='operations',seed=0xd9443211,smoke=false,fault=null}={}){
 const env=await environment({mode,seed,fault}),{c,gl,report}=env;
 if(mode==='failures')return failures(env,{seed});if(mode==='absent')return absent(env,{seed});
 let selected=cases({mode,seed,smoke});if(mode==='clears')for(const format of [20,126]){
  selected.push(specimen(format,seed,selected.length,{name:'stencil-'+format+'/clear-without-DSA',kind:'clear',clearBuffers:2,clearStencil:199,clearDepth:.5,noDsa:true}));
  selected.push(specimen(format,seed,selected.length,{name:'stencil-'+format+'/front-only-clear-and-draw',kind:'clear',clearBuffers:2,clearStencil:0xffffffa5,clearDepth:.5,front:face({writeMask:85,zpass:3}),back:face({enabled:false,writeMask:15,valueMask:240,zpass:7}),frontRef:31,backRef:29,scissor:true,afterClearDraw:true}));
 }
 if(fault)selected=cases({mode:fault==='value-mask'?'compares':'operations',seed,smoke:true}).filter(f=>f.format===20&&f.name.includes(fault==='value-mask'?'/compare1/front':'/depth-pass/front')).slice(0,1);
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 for(const [ordinal,f]of selected.entries()){
  const {r,row,target,texture,original}=await makeRun(env,f,{delay:mode==='boundaries'?jitter:ordinal%3,step:ordinal%2?1:64,stencilFault:fault});
  try{
   c.ok((await submit(r,1,setup(f),'stencil-setup-'+ordinal)).result,'original native stencil setup');if(!f.noDsa)c.ok((await submit(r,1,state(f),'stencil-state-'+ordinal)).result,'original native DSA and references');
   if(fault)r.armStencilControl();
   let input,color,clearDepths={};
   if(f.kind==='clear'){
    input=f.source.planes[f.level].input.slice();const offset=stencilOffset(f.format);if(f.clearBuffers&2)for(let i=0;i<f.width*f.height;i++)input[i*bytesPerPixel(f.format)+offset]=f.clearStencil;
    if(f.clearBuffers&1){for(let i=0;i<f.width*f.height;i++)setDepth(f.format,input,i,f.clearDepth);clearDepths[f.level]=f.clearDepth;}
    color=uniformPlane(f.width,f.height,f.clearBuffers&4?f.words:f.clearWords);row.execution=await submit(r,1,clear(f.clearBuffers,f.clearStencil,f.clearDepth,f.words),'stencil-full-clear-'+ordinal);
   }else {({input,color}=expected(f));row.execution=await submit(r,1,draw(),'stencil-draw-'+ordinal);}
   if(fault==='completed-stencil'||fault==='completed-output'){
    row.corruption={before:{...r.lastCompletion}};
    if(fault==='completed-stencil'){r.traced.stencilMask(255);r.traced.clearStencil(97);r.traced.clear(gl.STENCIL_BUFFER_BIT);}
    else r.traced.clearBufferfv(gl.COLOR,0,new Float32Array([1,.25,.5,1]));
    row.corruption.after=await physicalFence(r,'completed-original-stencil-corruption');
   }
   const frame=await output(env,f,r,row,target,color,f.kind,row.execution);await depths(env,f,r,row,frame,texture,{[f.level]:input},clearDepths);
   if(f.afterClearDraw){const next=expected(f,input),record=await submit(r,1,draw(),'stencil-restored-front-only-draw'),after=await output(env,f,r,row,target,next.color,'post-clear-draw',record);input=next.input;await depths(env,f,r,row,after,texture,{[f.level]:input},clearDepths);}
   await publicDepth(env,f,r,row,{[f.level]:input},clearDepths);
   row.after=nativeStencil(gl);
   if(mode==='boundaries')await boundaries(env,f,r,row,target,texture,original,input,ordinal);
  }finally{await finish(r,report,row);}
  await sealRun(report,row,c);
 }
 report.status='passed';return report;
}
async function failures(env,{seed}){
 const {c,gl,report}=env;
 for(const format of [20,126])for(const phase of ['reference','value-mask','write-mask','func-native','op-native','attachment-native','draw-native','read-native','historical']){
  const f=specimen(format,seed,report.runs.length,{name:'stencil-'+format+'/refusal-'+phase}),stencilFailure=phase==='func-native'?'stencilFuncSeparate':phase==='op-native'?'stencilOpSeparate':null,nativeFault=phase.endsWith('-native')&&!stencilFailure?phase.slice(0,-7):null,
   {r,row}=await makeRun(env,f,{stencilFailure,nativeFault});row.failurePhase=phase;
  try{
   c.ok((await submit(r,1,setup(f),'stencil-failure-setup')).result,'original native failure setup');c.ok((await submit(r,1,state(f),'stencil-failure-state')).result,'original native failure DSA');
   const before=r.events.filter(e=>['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer'].includes(e.name)).length;row.beforeFailure={renderer:r.renderer.inspect(),resources:r.store.inspect()};
   if(['reference','value-mask','write-mask'].includes(phase)){
    const front=face(),back=face(phase==='value-mask'?{valueMask:85}:phase==='write-mask'?{writeMask:170}:{}),backRef=phase==='reference'?29:127;
    row.failure=await submit(r,1,join(dsa(31,front,back),refs(127,backRef),draw()),'stencil-original-asymmetric-refusal');c.same(row.failure.result.error.code,'unsupported-stencil','active S8 asymmetry refuses before native draw');c.same(r.events.filter(e=>['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer'].includes(e.name)).length,before,'no private copy or draw on refused asymmetry');
   }else if(phase==='historical'){
    const selected=r.renderer,prior=c.ok(createVirglStandardPackedDepthImageAsyncRenderer({gl:r.traced,shaderBridge:r.bridge,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,uniformAccess:r.uniformAccess,imageAccess:r.imageAccess}),'historical consumer').renderer;
    try{c.ok(prior.createContext(1),'historical original context');r.renderer=prior;row.failure=await submit(r,1,state(f),'stencil-historical-refusal');c.same(row.failure.result.error.code,'unsupported-feature','historical stencil remains closed');}finally{c.ok(prior.dispose(),'historical owner disposed');r.renderer=selected;c.ok(selected.restoreContext(1),'selected stencil restored');}
   }else{
    r.armFault();r.armStencilControl();row.failure=await submit(r,1,phase==='read-native'?packet(43,0,[6,f.level,0,0,0,0,0,0,f.width,f.height,1,0,2]):phase==='attachment-native'?packet(5,0,[1,21,20]):draw(),'stencil-actual-native-failure');r.armFault(false);r.armStencilControl(false);c.same(row.failure.result.ok,false,'actual native stencil failure is reported');c.same(r.faultEvents.length+r.stencilControls.length>0,true,'actual native failure executed');c.same(gl.getError(),gl.NO_ERROR,'native stencil failure drained');
   }
   row.afterFailure={renderer:r.renderer.inspect(),resources:r.store.inspect()};
  }finally{await finish(r,report,row);}
  await sealRun(report,row,c);
 }
 report.status='passed';return report;
}
async function absent(env,{seed}){
 const {c,gl,report}=env;
 for(const format of [18,21])for(const attached of [true,false]){
  const f=specimen(format,seed,report.runs.length,{name:'absent-stencil-'+format+'/'+attached,front:face({func:0,valueMask:85,writeMask:170,zpass:7}),back:face({func:1,valueMask:15,writeMask:127,zpass:3}),frontRef:13,backRef:29,depthEnable:false,depthWrite:true}),{r,row,target,texture}=await makeRun(env,f,{});row.absentStencil=true;row.attached=attached;
  try{
   c.ok((await submit(r,1,setup(f),'absent-S8-setup')).result,'complete original absent-S8 setup');c.ok((await submit(r,1,join(state(f),packet(5,0,[1,attached?21:0,20])),'absent-S8-state')).result,'original asymmetric absent-S8 state');
   const prediction=expected(f,f.source.planes[f.level].input,{present:false}),record=await submit(r,1,draw(),'absent-S8-original-draw'),frame=await output(env,f,r,row,target,prediction.color,'absent-draw',record);await depths(env,f,r,row,frame,texture);
   const cleared=await submit(r,1,clear(2,97),'absent-S8-original-clear'),after=await output(env,f,r,row,target,prediction.color,'absent-clear',cleared);await depths(env,f,r,row,after,texture);await publicDepth(env,f,r,row);c.same(gl.getError(),gl.NO_ERROR,'absent-S8 native semantics remain valid');
  }finally{await finish(r,report,row);}
  await sealRun(report,row,c);
 }
 report.status='passed';return report;
}
async function boundaries(env,f,r,row,target,texture,original,input,ordinal){
 const {c,gl,report}=env;row.boundaries=[];
 c.ok((await submit(r,2,join(dsa(30,face({func:0,writeMask:170}),face({func:7,writeMask:170})),refs(93,93)),'stencil-context2-state')).result,'second context stencil state');row.context2=nativeStencil(gl);
 c.ok(r.renderer.restoreContext(1),'restore original native stencil context');row.context1=nativeStencil(gl);
 // A retained nonzero native view carries both original depth and S8.
 const lease=c.ok(r.store.retainStorage(1,6,'view'),'retained original stencil view').lease,view=c.ok(r.imageAccess.capture(lease,1,2),'private original stencil mip range');row.privateRange={firstLevel:1,lastLevel:2,metadata:view.metadata,generation:view.generation};
 const p=f.source.planes[1];c.ok((await submit(r,1,join(surface(60,6,f.format,1),surface(61,1,31,1),packet(5,0,[1,60,61]),clear(2,117)),'stencil-GPU-only-private-mip-clear')).result,'GPU-only S8 on retained mip');
 c.ok(r.imageAccess.refresh(view.token),'refresh complete native original stencil range');const resolved=c.ok(r.imageAccess.resolve(view.token),'native private stencil range');row.privateRange.texture=r.trace.id(resolved.storage.texture);await physicalFence(r,'original-private-S8-copy-completion');const privateFrame={depths:[]};row.privateNative=privateFrame;
 const updated=p.input.slice();for(let i=0;i<p.width*p.height;i++)updated[i*bytesPerPixel(f.format)+stencilOffset(f.format)]=117;await depths(env,f,r,row,privateFrame,resolved.storage.texture,{1:updated},{},1,2);c.ok(r.imageAccess.release(view.token),'release original private range');c.ok(r.store.releaseStorage(lease),'release original private storage lease');
 c.ok((await submit(r,1,join(packet(5,0,[1,21,20]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)])),'stencil-restore-original-FBO')).result,'restore original stencil framebuffer');
 c.ok(r.store.unref(6),'retire original public stencil source');const replacement=source(f.format===20?126:20,report.seed^ordinal,9,7,2),fresh=r.add(replacement.metadata,replacement.backing);row.replacement={metadata:replacement.metadata,generation:fresh.generation,backing:await blob(report,replacement.backing)};c.same(fresh.generation>original.generation,true,'opposite-format replacement is a new generation');
 const retained=await submit(r,1,clear(2,53),'stencil-retained-old-generation-clear');c.ok(retained.result,'retained original S8 remains writable after name reuse');const old=input.slice();for(let i=0;i<f.width*f.height;i++)old[i*bytesPerPixel(f.format)+stencilOffset(f.format)]=53;row.oldGeneration={depths:[]};await depths(env,f,r,row,row.oldGeneration,texture,{[f.level]:old,1:f.level===1?old:updated});
 const replacementBacking=c.ok(r.store.readBacking(6,0,replacement.backing.length),'replacement original backing').bytes;row.replacement.after=await blob(report,replacementBacking);c.same([...replacementBacking],[...replacement.backing],'old GPU-only stencil clear preserves every replacement byte');
 const mode=f.terminalMode;row.terminalMode=mode;let point=null;
 row.queued=await submit(r,1,join(clear(2,71),packet(5,0,[0,0]),packet(3,8,[20]),packet(3,8,[21]),packet(3,8,[60]),packet(3,8,[61])),'stencil-queued-'+mode,async(step,job)=>{
  const inspection=r.renderer.inspect();if(inspection.jobs.status!=='finishing'||point)return;point={renderer:inspection,resources:r.store.inspect(),images:r.imageAccess.inspect()};row.pending=point;
  const queued=old.slice();for(let i=0;i<f.width*f.height;i++)queued[i*bytesPerPixel(f.format)+stencilOffset(f.format)]=71;row.queuedNative={depths:[]};await depths(env,f,r,row,row.queuedNative,texture,{[f.level]:queued,1:f.level===1?queued:updated});
  c.same(point.resources.budgets.imageHolds>=2,true,'native stencil/output held through completion');c.ok(r.store.unref(1),'retire queued native output');r.add(metadata(1,126,9,3,0,9),new Uint8Array(12000));
  if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel queued native stencil job');
  if(mode==='owner-first'||mode==='renderer-first'){if(mode==='owner-first')c.ok(r.store.dispose(),'dispose stencil owner first');c.ok(r.renderer.dispose(),'dispose stencil renderer');return {disposed:true,appliedCommands:inspection.jobs.appliedCommands};}
 });c.same(Boolean(point),true,'stencil job reaches pending physical completion');if(mode==='complete')c.ok(row.queued.result,'queued native stencil job physically completes');else c.same(row.queued.result.error.code,mode==='cancel'?'cancelled':'disposed','original queued stencil terminal result');
}
