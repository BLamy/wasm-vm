import {rig,finish,blob,submit} from './standard-image-rig.mjs';
import {createVirglStandardUniformShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeSubmission,decodeStandardSubmission,decodeStandardUniformSubmission,decodeStandardTextureSubmission,decodeStandardImageSubmission} from '../decoder.mjs';
import {checks} from './standard-instanced-draws.mjs';
import {nativeRead} from './standard-texture-storage.mjs';
import {packet,join,meta,sampler,bind,draw,specimen,source,statePackets,imageView,surface,clear,word,originalPixels,hex,nativeFromGuest,levels} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
const later=()=>new Promise(resolve=>setTimeout(resolve,0));
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const format of [2,67,233])for(let first=0;first<15;first++)for(let last=0;last<15;last++){
  const wire=imageView(77,6,format,first,last),observed=decodeStandardImageSubmission(wire),valid=first<=last;c.same(observed.ok,valid,'literal original bounded view range admission');
  for(const old of [decodeSubmission,decodeStandardSubmission,decodeStandardUniformSubmission,decodeStandardTextureSubmission])c.same(old(wire).ok,first===0&&last===0,'historical view admission unchanged');records.push({kind:'view',hex:hex(wire),format,first,last,valid,observed});
 }
 for(const format of [2,67,233,16])for(let level=0;level<17;level++){
  const wire=surface(77,6,format,level),valid=format===16?level===0:level<15,observed=decodeStandardImageSubmission(wire);c.same(observed.ok,valid,'literal original bounded surface plane admission');
  for(const old of [decodeSubmission,decodeStandardSubmission,decodeStandardUniformSubmission,decodeStandardTextureSubmission])c.same(old(wire).ok,level===0,'historical surface admission unchanged');records.push({kind:'surface',hex:hex(wire),format,level,valid,observed});
 }
 for(const [at,bits]of [[16,1],[20,0x10000],[20,0xff00],[20,0xff],[12,3<<24],[24,6],[24,0x80000000]]){const wire=imageView(77,6,67,0,0),dv=new DataView(wire.buffer);dv.setUint32(at,dv.getUint32(at,true)|bits,true);const observed=decodeStandardImageSubmission(wire);c.same(observed.ok,false,'malformed original view layers target range or swizzle rejects');records.push({kind:'bad-view',hex:hex(wire),observed});}
 c.same(decodeStandardTextureSubmission(imageView(77,6,67,1,2),{images:true}).ok,false,'guest label cannot select host image facet');
 const original=imageView(77,6,67,1,2),snapshot=decodeStandardImageSubmission(original);c.ok(snapshot,'owned original view bytes');original.fill(0);c.same(snapshot.commands[0].fields.firstLevel,1,'view owns exact original range snapshot');
 const wire=join(imageView(77,6,67,1,2),packet(8,0,[]));c.same(decodeStandardImageSubmission(wire).ok,false,'malformed tail rejects complete original view submission');return{status:'passed',records,predictions:c.rows};
}
export async function runAcceptance({fault,seed=0xa5471e03}={}){
 const wire=runWireAcceptance();
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardUniformShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',schema:'original-image-boundaries-v1',gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),seed,fault,guestExecution:false,productionNegotiation:false,frames:[],runs:[],blobs:[],predictions:c.rows};window.__standardImageEvidence=report;
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu))throw Error('physical original image GPU required');
 const live=new Map();let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 async function make({format=67,w=7,h=5,lastLevel,resourceLimits,nativeFault}={}){
  const originalSeed=random,s=specimen({stage:'both',scale:0,offset:[.25,.25],vsCoord:[.25,.25]}),src=source(w,h,format,originalSeed,lastLevel),r=rig(gl,bridge,c,s,{delay:jitter,step:1,fault,nativeFault,resourceLimits});r.blobs=report.blobs;
  r.add(meta(3,0,64,0,s.positions.length),s.positions);const created=r.add(src.metadata,src.backing);r.currentLabel='setup';c.ok((await submit(r,1,statePackets(s,src),'setup')).result,'original multilevel image setup');const row={kind:'boundaries',originalSeed,metadata:src.metadata,generation:created.generation,backing:await blob(report,src.backing),planes:[],observations:[]};for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});report.runs.push(row);live.set(r,row);return{r,s,src,row};
 }
 async function pixels(t,wire,label,expected,texture=t.r.allocations[0].storage.texture,format=67,width=t.s.width,height=t.s.height,level=0){
  const {r,row}=t;r.currentLabel=label;const record=await submit(r,1,wire,label);c.ok(record.result,'original image draw/clear completes');c.same(record.result.gpuComplete,true,'actual image completion fence');const raw=nativeRead(gl,texture,format,width,height,level),prediction=format===233?nativeFromGuest(format,expected):[...expected],observed=[...raw];
  const misses=[];for(let i=0;i<observed.length;i++)if(Math.abs(observed[i]-prediction[i])>(format===233?0:1))misses.push({at:i,expected:prediction[i],observed:observed[i]});
  const entry={label,wire:r.history.at(-1).hex,format,width,height,level,texture:r.trace.id(texture),native:await blob(report,raw),expected:await blob(report,expected),historyIndex:r.history.length-1,misses:misses.slice(0,8),dump:record.dump};row.observations.push(entry);report.frames.push(entry);if(fault)report.sabotage={kind:fault,fenceCompleted:record.result.gpuComplete,held:entry.misses.length===0,frame:report.frames.length-1,misses:entry.misses};c.same(entry.misses,[],'independent original image boundary pixels after completed native fence');return record;
 }
 const setupViews=(format,vs,fs)=>join(imageView(5,6,format,...vs),imageView(6,6,format,...fs),sampler(8,{s:2,t:2,r:2,min:0,mip:2,mag:0}),bind(0,5,8),bind(1,6,8));
 const p={s:2,t:2,r:2,min:0,mip:2,mag:0,minLod:0,maxLod:1000};
 const retire=async(r,row)=>{await finish(r,report,row);live.delete(r);};
 try {
 for(const format of (fault?[67]:[2,67,233])){
  const t=await make({format,w:8,h:4}),{r,src,row}=t,vs=[0,0],fs=[1,1];
  await pixels(t,join(setupViews(format,vs,fs),draw()),'source-original-ranges',originalPixels(src,vs,fs,p).pixels);
  // Native-only mutation of original level 1, with literal normalized values.
  const originalBacking=src.backing.slice(),l=src.planes[1],channels=format===233?[257,513,769,3]:[17,49,81,255],value=format===233?channels.map((v,i)=>v/(i===3?3:1023)):channels.map(v=>v/255),replacement=new Uint8Array(l.width*l.height*4);
  for(let i=0;i<l.width*l.height;i++){if(format===233)new DataView(replacement.buffer).setUint32(i*4,(channels[0]<<20|channels[1]<<10|channels[2]|channels[3]<<30)>>>0,true);else replacement.set(format===2?[channels[2],channels[1],channels[0],255]:channels,i*4);}
  const clearWire=join(surface(12,6,format,1),packet(5,0,[1,0,12]),clear(value));
  r.currentLabel='native-only-mip-clear';const clearing=await submit(r,1,clearWire,r.currentLabel);c.ok(clearing.result,'original selected plane clear');c.same(clearing.result.gpuComplete,true,'GPU-only clear final fence');
  const plane=nativeRead(gl,r.allocations.find(a=>a.metadata.id===6&&a.metadata.width===8).storage.texture,format,l.width,l.height,1);row.observations.push({label:r.currentLabel,wire:r.history.at(-1).hex,width:l.width,height:l.height,level:1,format,native:await blob(report,plane),expected:await blob(report,replacement),dump:clearing.dump});if(fault)report.sabotage={kind:fault,fenceCompleted:clearing.result.gpuComplete,held:JSON.stringify([...plane])===JSON.stringify(nativeFromGuest(format,replacement)),original:row.observations.at(-1)};c.same([...plane],nativeFromGuest(format,replacement),'independent original selected plane after completed native fence');c.same([...src.backing],[...originalBacking],'GPU-only clear never edits original CPU backing');l.input=replacement;
  await pixels(t,join(packet(5,0,[1,0,4]),draw()),'fresh-GPU-range-copy',originalPixels(src,vs,fs,p).pixels);
  if(fault==='copy-level'){report.status='unexpected-sabotage-pass';return report;}
  // Defined same-image feedback uses only logical levels outside the destination.
  const target=src.planes[2],expected=originalPixels(src,vs,fs,p,[0,1,2,3],[0,1,2,3],target.width,target.height).pixels;
  const same=join(surface(13,6,format,2),packet(5,0,[1,0,13]),packet(4,0,[0,...[target.width/2,target.height/2,.5,target.width/2,target.height/2,.5].map(word)]),draw());
  // Packed output must use native 10-bit precision. A separate rgba target is
  // authoritative for filtered colors; these same-image draws use RGBA8 only.
  if(format===67){await pixels(t,same,'defined-nonoverlap-original-plane',expected,r.allocations.find(a=>a.metadata.id===6&&a.metadata.width===8).storage.texture,format,target.width,target.height,2);const d=row.observations.at(-1).dump.draws.at(-1).command;c.same(d.framebuffer.width,target.width,'logical framebuffer width selects original plane');c.same(d.framebuffer.height,target.height,'logical framebuffer height selects original plane');target.input=expected;await pixels(t,join(imageView(17,6,67,2,2),bind(1,17,8),packet(5,0,[1,0,4]),packet(4,0,[0,...[4,4,.5,4,4,.5].map(word)]),draw()),'fresh-GPU-drawn-source-copy',originalPixels(src,vs,[2,2],p).pixels);}
  r.currentLabel='reject-logical-overlap';const rejected=await submit(r,1,join(bind(1,6,8),surface(14,6,format,1),packet(5,0,[1,0,14]),draw()),r.currentLabel);c.same(rejected.result.ok,false,'logical overlapping original image rejects');c.same(rejected.result.error.code,'framebuffer-feedback','overlap has explicit original feedback error');c.same(r.draws.filter(d=>d.label===r.currentLabel).length,0,'overlapping private view never draws');row.observations.push(rejected);
  c.ok(r.store.unref(6),'unref original source public ID');const fresh=r.add(src.metadata,new Uint8Array(src.backing.length).fill(203));c.same(fresh.generation>row.generation,true,'source numeric reuse advances generation');
  await pixels(t,join(packet(5,0,[1,0,4]),packet(4,0,[0,...[4,4,.5,4,4,.5].map(word)]),draw()),'retained-view-original-generation',originalPixels(src,vs,fs,p).pixels);await retire(r,row);
 }
 if(fault){report.status='unexpected-sabotage-pass';return report;}
 // Every original surface plane is attached literally; all other planes retain
 // their exact original bytes. Both full and truncated NPOT storage participate.
 for(const format of [2,67,233])for(const truncation of [0,1]){
  const t=await make({format,lastLevel:2-truncation}),{r,src,row}=t,storage=r.allocations.find(a=>a.metadata.id===6).storage;
  for(const l of src.planes){const channels=format===233?[100+l.level,200+l.level,300+l.level,3]:[25+l.level,57+l.level,89+l.level,255],values=format===233?channels.map((v,i)=>v/(i===3?3:1023)):channels.map(v=>v/255),replacement=new Uint8Array(l.width*l.height*4);for(let i=0;i<l.width*l.height;i++){if(format===233)new DataView(replacement.buffer).setUint32(i*4,(channels[0]<<20|channels[1]<<10|channels[2]|channels[3]<<30)>>>0,true);else replacement.set(format===2?[channels[2],channels[1],channels[0],255]:channels,i*4);}
   const wire=join(surface(20+l.level,6,format,l.level),packet(5,0,[1,0,20+l.level]),clear(values));r.currentLabel='surface-plane-'+l.level;const record=await submit(r,1,wire,r.currentLabel);c.ok(record.result,'each original NPOT surface clears');c.same(record.result.gpuComplete,true,'surface original completion fence');l.input=replacement;
   for(const probe of src.planes){const raw=nativeRead(gl,storage.texture,format,probe.width,probe.height,probe.level);const frame={label:r.currentLabel,wire:r.history.at(-1).hex,selected:l.level,level:probe.level,width:probe.width,height:probe.height,format,native:await blob(report,raw),expected:await blob(report,probe.input),historyIndex:r.history.length-1,dump:record.dump};row.observations.push(frame);c.same([...raw],nativeFromGuest(format,probe.input),'only selected original NPOT plane changes');}
  }await retire(r,row);
 }
 // The original maximum mip word and rectangular native bounds execute in
 // real sampled views and framebuffer planes, not metadata-only probes.
 for(const format of [2,67,233])for(const [w,h]of [[16384,1],[1,16384]]){
  const t=await make({format,w,h,lastLevel:14}),{r,src,row}=t;
  await pixels(t,join(setupViews(format,[14,14],[13,14]),draw()),'maximum-original-mip-range',originalPixels(src,[14,14],[13,14],p).pixels);
  const values=[0,0,0,1],texture=r.allocations.find(a=>a.metadata.id===6&&a.metadata.width===w&&a.metadata.height===h).storage.texture,wire=join(surface(40,6,format,14),packet(5,0,[1,0,40]),clear(values));r.currentLabel='maximum-original-surface-plane';const record=await submit(r,1,wire,r.currentLabel);c.ok(record.result,'maximum original level14 surface');c.same(record.result.gpuComplete,true,'maximum original plane completion fence');const native=nativeRead(gl,texture,format,1,1,14),expected=format===233?[0xc0000000]:[0,0,0,255];row.observations.push({label:r.currentLabel,wire:r.history.at(-1).hex,level:14,width:1,height:1,format,native:await blob(report,native),expectedWords:expected,dump:record.dump});c.same([...native],expected,'maximum original plane selects actual 1x1 native level');await retire(r,row);
 }
 // Both original contexts/subcontexts retain their own range identities even
 // after native texture/FBO state and renderer caches are disturbed.
 {
  const t=await make(),{r,s,src,row}=t,a=originalPixels(src,[0,0],[1,1],p).pixels,b=originalPixels(src,[1,2],[0,2],p).pixels;
  await pixels(t,join(setupViews(67,[0,0],[1,1]),draw()),'context-range-A',a);
  r.currentLabel='context-range-B';const second=await submit(r,2,join(statePackets(s,src),setupViews(67,[1,2],[0,2]),draw()),r.currentLabel);c.ok(second.result,'independent second original context');const rawSecond=nativeRead(gl,r.allocations[0].storage.texture,67,8,8,0),badSecond=[...rawSecond].flatMap((v,i)=>Math.abs(v-b[i])>1?[{at:i,observed:v,expected:b[i]}]:[]);row.observations.push({kind:'context-B',label:r.currentLabel,wire:r.history.at(-1).hex,format:67,width:8,height:8,level:0,record:second,native:await blob(report,rawSecond),expected:await blob(report,b)});c.same(badSecond,[],'second context uses its own original ranges');
  for(const unit of [0,16]){gl.activeTexture(gl.TEXTURE0+unit);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,1);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,1);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindSampler(unit,null);}const poison=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,poison);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);gl.activeTexture(gl.TEXTURE0+7);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);
  c.ok(r.renderer.resetCaches(),'reset original image caches');c.ok(r.renderer.restoreContext(1),'restore original context range bindings');await pixels(t,draw(),'restored-context-range-A',a);gl.deleteFramebuffer(poison);
  await pixels(t,join(packet(29,0,[7]),statePackets(s,src),setupViews(67,[1,2],[0,2]),draw()),'independent-original-subcontext-range',b);
  await pixels(t,join(packet(28,0,[0]),packet(30,0,[7]),draw()),'restored-original-subcontext-range',a);await retire(r,row);
 }
 for(const depthWidth of [3,4]){
  const t=await make(),{r,src,row}=t;r.add(meta(7,2,16,1,depthWidth,2),new Uint8Array(depthWidth*2*2));r.currentLabel='selected-color-depth-dimensions-'+depthWidth;
  const wire=join(setupViews(67,[0,0],[2,2]),surface(21,6,67,1),surface(22,7,16,0),packet(5,0,[1,22,21]),packet(4,0,[0,...[1.5,1,.5,1.5,1,.5].map(word)]),draw()),record=await submit(r,1,wire,r.currentLabel);row.observations.push(record);c.same(record.result.ok,depthWidth===3,'depth attachment matches selected original color plane dimensions');if(depthWidth===3){c.same(record.result.gpuComplete,true,'selected plane depth job final fence');c.same(record.dump.draws[0].command.framebuffer.width,3,'selected depth/color framebuffer width');}else c.same(r.draws.length,0,'mismatched original selected depth plane never draws');await retire(r,row);
 }
 // Once native commands execute, deleted views and surfaces stay charged until
 // the final native fence, including original public/handle reuse in one job.
 for(const mode of ['complete','cancel','renderer-dispose']){
  const t=await make({w:8,h:4}),{r,src,row}=t;await pixels(t,join(setupViews(67,[0,0],[1,1]),draw()),'queued-setup',originalPixels(src,[0,0],[1,1],p).pixels);
  let point=null;const wire=join(draw(),packet(3,6,[5]),packet(3,6,[6]),packet(10,0,[0,0,0]),packet(10,0,[1,0,0]),packet(5,0,[0,0]),packet(3,8,[4]));r.currentLabel='queued-retired-images-'+mode;row.originalQueuedWire=hex(wire.slice());
  const result=await submit(r,1,wire,r.currentLabel,async(step,job)=>{const state=r.renderer.inspect();if(state.jobs.status==='finishing'&&!point){c.ok(r.store.unref(6),'queued source unref');c.ok(r.store.unref(1),'queued surface unref');point={renderer:r.renderer.inspect(),resources:r.store.inspect()};report.diagnostic={mode,point,history:r.history,wire:r.history.at(-1).hex,lastNative:r.draws.at(-1)};c.same(point.renderer.jobs.imageHolds,2,'two exact original view holds survive queued deletion');c.same(point.renderer.jobs.imageSources,1,'exact framebuffer allocation survives queued deletion');c.same(r.imageAccess.inspect().views,0,'queued public image views are retired');c.same(point.resources.budgets.imageViews,2,'queued native private allocations stay charged');c.same(point.resources.budgets.imageHolds,3,'all native allocations charged at pending final fence');if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel final pending image fence');if(mode==='renderer-dispose'){const appliedCommands=point.renderer.jobs.appliedCommands;c.ok(r.renderer.dispose(),'dispose renderer with pending image fence');return{disposed:true,appliedCommands};}}});
  c.same(Boolean(point),true,'native image job reaches later-task finishing');row.observations.push({mode,point,result});if(mode==='complete')c.ok(result.result,'retired image job final native completion');if(mode==='cancel')c.same(result.result.ok,false,'cancelled original image completion');if(mode==='renderer-dispose')c.same(result.result.error.code,'disposed','pending original image disposal explicit result');await retire(r,row);
 }
 // Exact private allocations share the original bounded GPU budget.
 for(const ceiling of [636,635]){
  const t=await make({w:8,h:4,resourceLimits:{gpuBytes:ceiling}}),{r,src,row}=t;r.currentLabel='private-budget-'+ceiling;
  const record=await submit(r,1,join(setupViews(67,[0,0],[1,1]),draw()),r.currentLabel);row.observations.push({ceiling,record,budgets:r.store.inspect().budgets});c.same(record.result.ok,ceiling===636,'exact or one-byte-short complete private GPU charge');
  c.same(r.store.inspect().budgets.gpuBytes,ceiling===636?636:604,'every allocated original/private plane remains charged');if(ceiling===635){c.same(record.result.error.code,'limit-exceeded','short private budget explicit failure');c.same(r.draws.length,0,'short private budget never draws');}await retire(r,row);
 }
 for(const mode of ['tokens','stale-context','store-dispose','hold-limit','view-limit']){
  const t=await make({w:8,h:4}),{r,src,row}=t,lease=c.ok(r.store.retainStorage(1,6,'view'),'explicit original view lease').lease,image=c.ok(r.imageAccess.capture(lease,1,2),'explicit owned original image range').token;
  c.same(r.store.inspect().budgets.gpuBytes,516,'original chain plus complete private range is charged');
  const first=c.ok(r.imageAccess.resolve(image),'owned native range').storage.texture;gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);const beforeRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),beforeDraw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);c.ok(r.imageAccess.refresh(image),'actual owned GPU range blit');c.same(gl.isEnabled(gl.SCISSOR_TEST),true,'GPU range copy restores caller scissor');c.same(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)===beforeRead,true,'GPU range copy restores caller read framebuffer');c.same(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)===beforeDraw,true,'GPU range copy restores caller draw framebuffer');gl.disable(gl.SCISSOR_TEST);row.observations.push({mode,metadata:src.metadata,texture:r.trace.id(first),native:await blob(report,nativeRead(gl,first,67,4,2,0))});
  if(mode==='tokens'){
   c.same(r.imageAccess.resolve({}).ok,false,'foreign opaque image token rejects');c.same(r.imageAccess.hold({}).ok,false,'foreign image hold rejects');c.same(r.imageAccess.release({}).ok,false,'foreign image release rejects');
   const wrong=c.ok(r.store.retainStorage(1,3,'vertex'),'wrong original buffer lease').lease;c.same(r.imageAccess.capture(wrong,0,0).ok,false,'buffer lease cannot become image');c.ok(r.store.releaseStorage(wrong),'wrong role lease cleanup');
   for(const [a,b]of [[-1,0],[0,4],[3,2],[0,0xffffffff],[NaN,0]])c.same(r.imageAccess.capture(lease,a,b).ok,false,'bad retained level bounds reject before allocation');
   const held=c.ok(r.imageAccess.hold(image),'owned image allocation hold').token;c.ok(r.imageAccess.release(image),'retire public image token');c.same(r.imageAccess.resolve(image).ok,false,'retired public image does not resolve via hold');c.same(r.imageAccess.release(image).ok,false,'image token releases only once');c.same(r.store.inspect().budgets.gpuBytes,516,'retired held private range stays charged');c.ok(r.imageAccess.release(held),'retire original completion hold');c.same(r.imageAccess.release(held).ok,false,'completion hold releases only once');c.same(r.store.inspect().budgets.gpuBytes,476,'private range charge retires after final hold');c.ok(r.store.releaseStorage(lease),'retire original view lease');
  }else if(mode==='stale-context'){
   c.ok(r.store.destroyContext(1),'revoke resource context');for(const method of ['resolve','refresh','hold'])c.same(r.imageAccess[method](image).ok,false,'stale original image context rejects');c.ok(r.imageAccess.release(image),'stale image cleanup');c.ok(r.store.releaseStorage(lease),'stale lease cleanup');
  }else if(mode==='store-dispose'){
   const held=c.ok(r.imageAccess.hold(image),'owned disposing image hold').token;c.ok(r.store.dispose(),'revoke owner with images held');c.same(r.imageAccess.resolve(image).ok,false,'disposed original image rejects');c.ok(r.imageAccess.release(image),'revoked public image tombstone retires once');c.same(r.imageAccess.release(image).ok,false,'revoked public image refuses duplicate retirement');c.ok(r.imageAccess.release(held),'revoked completion image tombstone retires once');c.ok(r.renderer.dispose(),'renderer retire after image owner disposal');
  }else if(mode==='hold-limit'){
   const holds=[];for(let i=0;i<64;i++)holds.push(c.ok(r.imageAccess.hold(image),'bounded exact native image hold').token);c.same(r.imageAccess.hold(image).ok,false,'65th image hold rejects');c.same(r.store.inspect().budgets.imageHolds,64,'all bounded pending image holds charged');for(const held of holds)c.ok(r.imageAccess.release(held),'bounded image hold cleanup');c.ok(r.imageAccess.release(image),'hold-limit image cleanup');c.ok(r.store.releaseStorage(lease),'hold-limit original lease cleanup');
  }else{
   const views=[image];for(let i=1;i<64;i++)views.push(c.ok(r.imageAccess.capture(lease,0,3),'bounded full-range native alias').token);c.same(r.imageAccess.capture(lease,0,3).ok,false,'65th native image view rejects');c.same(r.store.inspect().budgets.imageViews,64,'all native aliases count toward allocation budget');for(const token of views)c.ok(r.imageAccess.release(token),'bounded native image cleanup');c.ok(r.store.releaseStorage(lease),'view-limit original lease cleanup');
  }await retire(r,row);
 }
 // Invalid original image ranges and native copy/allocation failures publish no
 // partial guest object and no successful draw.
 for(const mode of ['view-range','surface-level','native-texture','native-framebuffer','native-copy']){
  const t=await make({nativeFault:mode.startsWith('native-')?mode.slice(7):null}),{r,src,row}=t;r.currentLabel=mode;r.armFault();
  const wire=mode==='view-range'?imageView(5,6,67,0,14):mode==='surface-level'?surface(5,6,67,14):join(setupViews(67,[0,0],[1,1]),draw());const record=await submit(r,1,wire,mode);c.same(record.result.ok,false,'invalid or failed original native image refuses');c.same(r.draws.length,0,'invalid native image never issues a draw');if(mode.startsWith('native-'))c.same(r.faultEvents.length,1,'actual native image fault fired once');row.observations.push(record);await retire(r,row);
 }
 report.status='passed';report.resources=report.runs.at(-1).final.resources;return report;
 } catch(error){report.failure={message:error.message,stack:error.stack};throw error;} finally{for(const [r,row]of live)await finish(r,report,row);}
}
