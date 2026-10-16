import {rig,finish,blob,submit,nativeRead,checks} from './standard-integer-image-consumer-rig.mjs';
import {describe} from './standard-integer-image-consumer.mjs';
import {gpuClear} from './standard-integer-image-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {createVirglStandardIntegerImageAsyncRenderer} from '../state.mjs';
import {consumerCases,setup,views,draw,expectedFrame,fullMisses,originalFormat,metadata,
 packet,join,imageView,surface,sampler,word,integerClear} from '../../../tools/virgl-integer-image-consumer/fixtures.mjs';
import {source} from '../../../tools/virgl-command/standard-integer-image-fixtures.mjs';
import {blendState} from '../../../tools/virgl-command/standard-shared-exponent-consumer-fixtures.mjs';
const raster=(handle,scissor)=>join(packet(1,2,[handle,2|(1<<29)|(Number(scissor)<<14),word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[handle]));
export async function runBoundaries({seed=0x612309af}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),
  bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),
  report={status:'running',guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,
   mode:'boundaries',frames:[],runs:[],blobs:[],predictions:c.rows};window.__standardIntegerImageConsumerEvidence=report;
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 const fixtures=consumerCases({smoke:true});
 async function begin(f,kind,options={}){
  const r=rig(gl,bridge,c,f,{delay:jitter,step:1,...options}),row={...describe(f),name:kind+'-'+f.source.metadata.format,kind,actions:[]};
  r.blobs=report.blobs;row.target=r.allocations[0].metadata;row.positions=await blob(report,f.positions);row.backing=await blob(report,f.source.backing);
  for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
  r.add({id:3,target:0,format:64,bind:0,width:f.positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},f.positions);
  const resource=r.add(f.source.metadata,f.source.backing);row.sourceGeneration=resource.generation;report.runs.push(row);return{r,row,resource};
 }
 async function ready(r,f,label){c.ok((await submit(r,1,setup(f),label+'-setup')).result,'original integer boundary setup');
  c.ok((await submit(r,1,views(f),label+'-view')).result,'original integer boundary retained range');}
 async function capture(r,row,f,record,{kind='draw',outputFormat=f.outputFormat,target=r.allocations[0].storage.texture,mask=15,previous=null,sourceUpdate=null}={}){
  c.ok(record.result,'complete original integer boundary');c.same(record.result.gpuComplete,true,'boundary physical completion');
  let expected=expectedFrame({...f,outputFormat},kind);
  if(sourceUpdate&&kind==='draw'){
   const words=new Uint32Array(expected.buffer),lanes=f.swizzle.map(k=>k===4?0:k===5?1:sourceUpdate.words[k]);
   for(let i=0;i<f.width*f.height;i++)words.set(lanes,i*4);
  }
  if(previous!==null&&kind==='draw'){
   const prior=report.frames[previous]._raw,words=new Uint32Array(expected.buffer),old=new Uint32Array(prior.buffer);
   for(let i=0;i<words.length;i++)if(!(mask&(1<<(i%4))))words[i]=old[i];
  }
  const pixels=nativeRead(r,target,outputFormat,f.width,f.height,f.outputLevel),frame={run:report.runs.indexOf(row),label:record.label,kind,
   boundary:true,historyIndex:r.history.length-1,dump:record.dump,completion:{...r.lastCompletion},outputFormat,mask,previous,sourceUpdate,
   native:await blob(report,pixels),expected:await blob(report,expected),bindings:[],outputs:[],_raw:pixels};
  report.frames.push(frame);row.frames.push(report.frames.length-1);
  c.same(fullMisses(pixels,expected).slice(0,8),[],'original complete boundary word plane');
  if(kind==='draw'){
   const unit=(f.stage==='vertex'?16:0)+f.slot,active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0+unit);
   const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(a=>a.storage.texture===texture),planes=[];
   for(let local=0;local<=f.lastLevel-f.firstLevel;local++){
    const p=f.source.planes[f.firstLevel+local];planes.push({local,original:p.level,width:p.width,height:p.height,
     native:await blob(report,nativeRead(r,texture,f.source.metadata.format,p.width,p.height,local))});
   }
   frame.bindings.push({stage:f.stage,slot:f.slot,texture:r.trace.id(texture),metadata:allocation.metadata,planes});gl.activeTexture(active);
   const nativeDraw=r.draws.at(-1);c.same(nativeDraw.native.blend,false,'integer target bypasses native blending');
   c.same(nativeDraw.native.mask,[0,1,2,3].map(i=>Boolean(mask&(1<<i))),'native integer component mask');
  }
  c.same(gl.getError(),gl.NO_ERROR,'native integer boundary collection');return report.frames.length-1;
 }
 for(const f of fixtures){
  const {r,row,resource}=await begin(f,'retained-cache-refresh');
  try{
   await ready(r,f,'retained');await capture(r,row,f,await submit(r,1,draw(),'retained-before-reuse'));
   c.ok((await submit(r,2,join(setup(f),views(f)),'retained-second-context')).result,'interleaved original context');
   c.ok(r.store.unref(6),'retire original integer source name');const freshSource=source(f.source.metadata.format===196?200:196,11,7,2,seed),fresh=r.add(freshSource.metadata,freshSource.backing);
   c.same(fresh.generation>resource.generation,true,'same integer ID has distinct generation');row.actions.push({kind:'source-id-reuse',replacement:freshSource.metadata,newGeneration:fresh.generation,inspection:r.store.inspect()});
   await capture(r,row,f,await submit(r,1,draw(),'retained-after-reuse'));
   await capture(r,row,f,await submit(r,2,draw(),'retained-second-after-reuse'));
   c.ok(r.renderer.resetCaches(),'reset integer material caches');c.ok(r.renderer.restoreContext(1),'restore original retained context');
   await capture(r,row,f,await submit(r,1,draw(),'retained-after-restore'));
   const other=f.outputFormat===196?200:196;r.add(metadata(7,other,f.width,f.height,0,2),new Uint8Array(f.width*f.height*16));
   const links=r.renderer.inspect().work.programLinks;
   c.ok((await submit(r,1,join(surface(21,7,other,0),packet(5,0,[1,0,21])),'same-shader-other-target')).result,'original changed COLOR0 signedness');
   await capture(r,row,f,await submit(r,1,draw(),'same-shader-other-sign'),{outputFormat:other,target:r.allocations.find(a=>a.metadata.id===7).storage.texture});
   c.same(r.renderer.inspect().work.programLinks>links,true,'target sign enters native material cache');
   const changedLinks=r.renderer.inspect().work.programLinks;
   c.ok((await submit(r,1,packet(5,0,[1,0,4]),'same-shader-return-target')).result,'restore original COLOR0');
   await capture(r,row,f,await submit(r,1,draw(),'same-shader-original-sign'));
   c.same(r.renderer.inspect().work.programLinks,changedLinks,'original target type reuses own material');
   const original=r.allocations.find(a=>a.metadata.id===6&&a.metadata.width===17),level=f.firstLevel+1,
    words=originalFormat(f.source.metadata.format).signed?[0xffffffff,0x80000000,0x7fffffff,63]:[0xffffffff,0x80000000,1,63],
    values=originalFormat(f.source.metadata.format).signed?new Int32Array(words):new Uint32Array(words);
   r.setLabel('native-original-integer-GPU-only-update');gpuClear(r,original.storage.texture,level,values,originalFormat(f.source.metadata.format).signed);
   const update={level,words};row.sourceUpdate=update;
   // The public name now refers to fresh storage; the old retained source must
   // observe its GPU update, never CPU backing of that replacement.
   const unchanged=c.ok(r.store.readBacking(6,0,freshSource.backing.length),'new generation backing').bytes;
   c.same([...unchanged],[...freshSource.backing],'GPU-only update leaves replacement CPU bytes unchanged');row.replacementBackingAfter=await blob(report,unchanged);
   const prior=await capture(r,row,f,await submit(r,1,draw(),'retained-GPU-only-refresh'),{sourceUpdate:update});
   c.ok((await submit(r,1,blendState(28,true,5),'integer-original-blend-mask')).result,'original blend/component state');
   const masked=await capture(r,row,f,await submit(r,1,draw(),'integer-blend-bypass-mask'),{mask:5,previous:prior,sourceUpdate:update});
   c.same(r.draws.at(-1).shaders.every(s=>!s.glsl.includes('virgl_blend_')),true,'integer shader has no FLOAT blend fold');
   c.ok((await submit(r,1,join(raster(29,true),packet(15,0,[0,0,1|(1<<16)])),'integer-original-scissor')).result,'original integer scissor');
   await capture(r,row,f,await submit(r,1,integerClear(f.clearWords),'integer-full-clear-ignores-mask-scissor'),{kind:'clear'});
   row.maskedFrame=masked;
   // New resource authority cannot satisfy an old shader's native sampler type.
   const oldDraws=r.draws.length,wire=join(imageView(22,6,freshSource.metadata.format,0,2),packet(10,0,[1,f.slot,22]),draw()),refusal=await submit(r,1,wire,'integer-sampler-sign-refusal');
   c.same(refusal.result.error.code,'incompatible-resource','native sampler/storage type disagreement');c.same(r.draws.length,oldDraws,'type mismatch never issues guest draw');row.actions.push(refusal);
   c.ok((await submit(r,1,join(packet(10,0,[1,f.slot,5]),blendState(30,false,15),raster(31,false)),'restore-retained-integer-view')).result,'restore original retained typed view');
   await capture(r,row,f,await submit(r,1,draw(),'integer-sign-refusal-recovery'),{sourceUpdate:update});
   for(const change of [{min:1},{mag:1},{mip:1}]){
    const result=await submit(r,1,join(sampler(40,{...f.parameters,...change}),packet(18,0,[1,f.slot,40]),draw()),'integer-incomplete-filter-'+Object.keys(change)[0]);
    c.same(result.result.error.code,'unsupported-sampler','integer native incomplete filtering refuses');row.actions.push(result);
    c.ok((await submit(r,1,join(packet(18,0,[1,f.slot,8]),packet(3,7,[40])),'restore-integer-nearest')).result,'restore owned nearest sampler');
   }
   r.add(metadata(9,31,f.width,f.height,0,2),new Uint8Array(f.width*f.height*16));
   const invalid=await submit(r,1,join(surface(25,9,31,0),packet(5,0,[1,0,25]),integerClear([0x7fc01234,0,0,0])),'floating-nonfinite-clear-refusal');
   c.same(invalid.result.error.code,'invalid-value','FLOAT clear does not borrow raw integer union permission');row.actions.push(invalid);
  }finally{await finish(r,report,row);}
 }
 for(const f of fixtures)for(const mode of ['complete','cancel','renderer-dispose','resource-dispose']){
  const {r,row,resource}=await begin(f,'queued-'+mode);let point=null;
  try{
   await ready(r,f,'queued-prelude');
   const wire=join(draw(),packet(3,6,[5]),packet(10,0,[1,f.slot,0]),packet(5,0,[0,0]),packet(3,8,[4]));
   const record=await submit(r,1,wire,'queued-integer-'+f.source.metadata.format+'-'+mode,async(step,job)=>{
    const state=r.renderer.inspect();if(state.jobs.status!=='finishing'||point)return;
    c.ok(r.store.unref(6),'queued old source name');c.ok(r.store.unref(1),'queued old target name');
    point={before:r.store.inspect(),renderer:state,images:r.imageAccess.inspect()};
    const replacement=source(f.source.metadata.format===196?200:196,11,7,2,seed),fresh=r.add(replacement.metadata,replacement.backing);
    r.add(metadata(1,f.outputFormat,9,3,0,2),new Uint8Array(9*3*16));point.after=r.store.inspect();point.newGeneration=fresh.generation;
    row.actions.push({kind:'owned-native-final-fence-reuse',...point});c.same(point.before.budgets.imageHolds,2,'old integer source and target held by pending physical fence');
    c.same(fresh.generation>resource.generation,true,'queued replacement storage differs');
    if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel owned integer final fence');
    if(mode.endsWith('dispose')){if(mode==='resource-dispose')c.ok(r.store.dispose(),'dispose integer owner with pending physical holds');
     c.ok(r.renderer.dispose(),'dispose integer consumer');return{disposed:true,appliedCommands:state.jobs.appliedCommands};}
   });
   row.actions.push(record);c.same(Boolean(point),true,'integer job reaches later native completion phase');
   if(mode==='complete')c.ok(record.result,'queued original integer completion');else c.same(record.result.error.code,mode==='cancel'?'cancelled':'disposed','queued native terminal result');
  }finally{await finish(r,report,row);}
  if(mode==='complete'||mode==='cancel'){
   const d=row.draws.at(-1),plane=row.retiredPlanes.find(p=>p.texture===d.native.attachment);c.same(Boolean(plane),true,'retired integer output captured before physical handle deletion');
   const expected=expectedFrame(f),frame={run:report.runs.indexOf(row),label:d.label,kind:'draw',boundary:true,retired:true,completion:plane.completion,
    historyIndex:row.history.findIndex(h=>h.label===d.label),dump:{},native:plane.native,expected:await blob(report,expected),mask:15,previous:null,bindings:[],outputs:[]};
   report.frames.push(frame);row.frames.push(report.frames.length-1);
  }
 }
 for(const f of fixtures){
  const {r,row}=await begin(f,'native-integer-clear-error',{nativeFault:'integer-clear'});
  try{r.armFault();const record=await submit(r,1,setup(f),'actual-integer-clear-failure');row.actions.push(record);
   c.same(record.result.error.code,'backend-error','actual native clear GLenum failure is controlled');c.same(r.faultEvents.length,1,'actual integer clear sabotage executed');
   c.same(r.draws.length,0,'failed integer clear never draws');}finally{await finish(r,report,row);}
 }
 {
  const {r,row}=await begin(fixtures[0],'strict-integer-consumer-config');let allocations=0,reads=0;
  const proxy=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value==='function')return(...args)=>{
   if(/^create/.test(key))allocations++;return value.apply(target,args);};return value;}}),
   options={gl:proxy,shaderBridge:bridge,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,uniformAccess:r.uniformAccess,imageAccess:r.imageAccess},
   inherited=Object.create({resources:r.store}),getter={...options},trapped=new Proxy(options,{ownKeys(){throw Error('untrusted config trap');}});
  for(const[key,value]of Object.entries(options))if(key!=='resources')inherited[key]=value;
  Object.defineProperty(getter,'gl',{get(){reads++;return proxy;},enumerable:true});
  const candidates=[['unknown-private-marker',{...options,integerImages:true}],['inherited-owner',inherited],['accessor-host',getter],['throwing-ownkeys',trapped],
   ...['translateImages','translatePairImages'].map(key=>[key,{...options,shaderBridge:{...bridge,[key]:null}}])];
  for(const[name,input]of candidates){const result=createVirglStandardIntegerImageAsyncRenderer(input);c.same(result.error.code,'invalid-input','strict original integer consumer '+name);row.actions.push({name,result});}
  c.same(allocations,0,'invalid integer host contract allocates nothing');c.same(reads,0,'integer host contract calls no untrusted getters');row.allocations=allocations;row.getterReads=reads;await finish(r,report,row);
 }
 for(const name of ['EXT_color_buffer_float','EXT_float_blend','OES_texture_float_linear']){
  const {r,row}=await begin(fixtures[0],'missing-host-'+name);let allocations=0;
  const proxy=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(key==='getExtension')return n=>n===name?null:target.getExtension(n);
   if(typeof value==='function')return(...args)=>{if(/^create/.test(key))allocations++;return value.apply(target,args);};return value;}});
  const result=createVirglStandardIntegerImageAsyncRenderer({gl:proxy,shaderBridge:bridge,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,uniformAccess:r.uniformAccess,imageAccess:r.imageAccess});
  c.same(result.error.code,'unsupported-host','full selected format family needs retained FLOAT capability');c.same(allocations,0,'unsupported native host refuses before allocation');row.actions.push({name,result,allocations});await finish(r,report,row);
 }
 for(const frame of report.frames)delete frame._raw;report.status='passed';return report;
}
