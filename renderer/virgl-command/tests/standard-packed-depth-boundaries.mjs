import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll,callerState} from './standard-packed-depth-rig.mjs';
import {source,transfer,nativeMisses,canonical,originalFormat,publicMisses} from '../../../tools/virgl-packed-depth/fixtures.mjs';
import {command} from './standard-integer-images.mjs';
import {createFloatingDepthPacker} from '../floating-depth-gpu.mjs';
async function upload(r,src){for(const p of src.planes){const prepared=r.c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,p))),'boundary packed-depth upload preparation');r.c.ok(r.asyncAccess.provideInput(prepared.ticket,p.input),'boundary packed-depth source words');r.c.ok(r.asyncAccess.upload(prepared.ticket),'boundary native upload');r.c.ok(r.asyncAccess.release(prepared.ticket),'boundary upload release');}return physicalFence(r,'boundary-upload-completion');}
export async function runBoundaries({seed=0x31d075a9}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={schema:'original-packed-depth-image-boundaries-v1',status:'running',seed,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),runs:[],blobs:[],predictions:c.rows};window.__standardPackedDepthEvidence=report;
 for(const format of[21,20]){
  const src=source(format,13,7,3,seed^format),r=rig(gl,c,{delay:seed%3+1}),row={kind:'generation-context-held-range',metadata:src.metadata,backing:await blob(report,src.backing),planes:[]};report.runs.push(row);for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});
  try{
   const original=add(r,src.metadata,src.backing);row.sourceTexture=r.trace.id(r.allocations[0].storage.texture);row.sourceGeneration=original.generation;row.uploadFence=await upload(r,src);
   const lease=c.ok(r.store.retainStorage(1,6,'view'),'boundary old packed-depth storage').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'boundary old packed-depth private range'),resolved=c.ok(r.imageAccess.resolve(view.token),'boundary native identity');c.ok(r.imageAccess.refresh(view.token),'boundary native packed-depth copy');row.copyFence=await physicalFence(r,'boundary-copy-completion');const hold=c.ok(r.imageAccess.hold(view.token),'hold old private range').token;row.privateTexture=r.trace.id(resolved.storage.texture);row.privateGeneration=resolved.generation;
   const pending=c.ok(r.asyncAccess.prepareTransfer(2,command(transfer(6,src.planes[0],2))),'queued old packed-depth read');c.ok(r.asyncAccess.beginTransferRead(pending.ticket),'begin native queued old read');row.pendingBefore=r.store.inspect();c.ok(r.store.unref(6),'unref packed-depth source with held copy/read');const replacement=source(format===21?20:21,13,7,3,seed^0xabcdef);row.replacementBacking=await blob(report,replacement.backing);row.replacementGeneration=add(r,replacement.metadata,replacement.backing).generation;row.replacementTexture=r.trace.id(r.allocations.at(-1).storage.texture);c.same(row.replacementGeneration===original.generation,false,'source ID reuse changes generation');c.same(row.replacementTexture===row.sourceTexture,false,'source ID reuse allocates another native texture');
   c.same(r.asyncAccess.validate(pending.ticket).ok,false,'queued old packed-depth transfer becomes stale');c.same(r.asyncAccess.poll(pending.ticket).ok,false,'stale transfer cannot publish old words to reused ID');const discarded=await poll(r,pending.ticket,{discard:true});row.discarded={status:discarded.status,fence:r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1)};c.ok(r.asyncAccess.release(pending.ticket),'release physically completed stale packed-depth transfer');
   c.ok(r.store.destroyContext(1),'destroy old retained packed-depth context');c.same(r.imageAccess.resolve(view.token).ok,false,'stale packed-depth view context refuses');c.ok(r.imageAccess.release(view.token),'release old public view');c.ok(r.store.releaseStorage(lease),'release old lease while completion hold remains');row.beforeHoldRelease=r.store.inspect();
   row.heldPlanes=[];for(let local=0;local<3;local++){const p=src.planes[local+1],raw=await nativeRead(r,resolved.storage.texture,p.width,p.height,local,originalFormat(format).stencil);row.heldPlanes.push({local,original:p.level,native:await blob(report,raw)});c.same(nativeMisses(format,p.input,raw),[],'old packed-depth private pixels survive source ID/context reuse');}c.ok(r.imageAccess.release(hold),'release old private completion hold');row.afterHoldRelease=r.store.inspect();
  }finally{await finish(r,report,row);}
 }
 for(const mode of['complete','cancel-before-begin','cancel-after-begin','dispose-owner','dispose-backend']){
  const src=source(20,7,5,0,seed^mode.length),r=rig(gl,c,{delay:2+seed%3}),row={kind:'queued-'+mode,metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try{
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);const lease=c.ok(r.store.retainStorage(1,6,'view'),'queued packed-depth storage lease').lease;
   if(mode==='cancel-before-begin'){const request=c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0],2))),'unissued packed-depth queued read');row.before=r.store.inspect();c.ok(r.asyncAccess.release(request.ticket),'cancel unissued packed-depth read');}
   else{
    const request=c.ok(r.asyncAccess.beginStorageRead(lease,{x:0,y:0,z:0,width:7,height:5,depth:1}),'retained packed-depth PBO read');row.before=r.store.inspect();
    if(mode==='complete'){c.ok(r.store.unref(6),'destroy public packed-depth storage after read issue');c.ok(r.store.destroyContext(1),'switch context after read issue');c.ok(r.store.createContext(1),'replacement packed-depth context generation');const replacement=source(20,7,5,0,seed^0x888777);add(r,replacement.metadata,replacement.backing);const ready=await poll(r,request.ticket);row.output=await blob(report,ready.bytes);row.fence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.same(publicMisses(src.metadata.format,src.planes[0].input,ready.bytes),[],'retained old storage read returns exact old signed words');c.ok(r.asyncAccess.release(request.ticket),'release completed retained packed-depth read');}
    else if(mode==='cancel-after-begin'){c.ok(r.asyncAccess.release(request.ticket),'cancel issued packed-depth read');row.gpuComplete=false;}
    else if(mode==='dispose-owner'){c.ok(r.store.dispose(),'dispose packed-depth owner with issued PBO');row.gpuComplete=false;c.ok(r.asyncAccess.release(request.ticket),'consume packed-depth read disposal tombstone');c.same(r.asyncAccess.release(request.ticket).ok,false,'packed-depth read tombstone is one-use');}
    else{r.backend.dispose();row.gpuComplete=false;c.same(r.asyncAccess.poll(request.ticket).ok,false,'disposed native backend cannot publish packed-depth read');c.ok(r.asyncAccess.release(request.ticket),'release issued read after backend disposal');}
   }
   if(mode!=='dispose-owner')c.ok(r.store.releaseStorage(lease),'release queued packed-depth storage lease');row.after=r.store.inspect();
  }finally{await finish(r,report,row);}
 }
 for(const nativeFault of['texture','storage','upload','read','framebuffer','buffer','fence','collect','copy','shader','program','shader-second','shader-source','link','uniform','scratch-texture-1','scratch-texture-2','scratch-texture-3','scratch-storage','framebuffer-draw']){
  const src=source(20,13,7,3,seed^nativeFault.length),r=rig(gl,c,{nativeFault}),row={kind:'native-error-'+nativeFault,metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try{
   let result,release=null;
   if(['texture','storage'].includes(nativeFault)){r.armFault();result=r.store.createResource(src.metadata);}
   else{
    add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);
    if(nativeFault==='upload'){const request=c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0]))),'native-error upload ticket');c.ok(r.asyncAccess.provideInput(request.ticket,src.planes[0].input),'native-error source bytes');r.armFault();result=r.asyncAccess.upload(request.ticket);release=()=>r.asyncAccess.release(request.ticket);}
    else if(['framebuffer','copy'].includes(nativeFault)){const lease=c.ok(r.store.retainStorage(1,6,'view'),'native-error view lease').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'native-error private allocation');r.armFault();result=r.imageAccess.refresh(view.token);release=()=>{c.ok(r.imageAccess.release(view.token),'failed copy view release');return r.store.releaseStorage(lease);};}
    else{const request=c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0],2))),'native-error read ticket');if(nativeFault==='collect'){c.ok(r.asyncAccess.beginTransferRead(request.ticket),'native-error physical read issue');await poll(r,request.ticket,{discard:true});r.armFault();result=r.asyncAccess.poll(request.ticket);}else{r.armFault();result=r.asyncAccess.beginTransferRead(request.ticket);}release=()=>r.asyncAccess.release(request.ticket);}
   }
   row.result=result;c.same(result.ok,false,'actual packed-depth native error refuses');c.same(result.error.code,'backend-error','explicit native packed-depth failure');if(release)c.ok(release(),'failed packed-depth native operation cleanup');row.after=r.store.inspect();c.same(r.faultEvents.length>0,true,'native error injection executed');
  }finally{await finish(r,report,row);}
 }
 for(const budget of ['scratchBytes','cpuBytes','gpuBytes'])for(const short of [0,1]){
  const src=source(20,7,5,0,seed^budget.length),charge=7*5*8,base=7*5*4,staging=7*5*20,maximum=budget==='scratchBytes'?charge:budget==='cpuBytes'?src.backing.length+charge:base+staging;
  const r=rig(gl,c,{limits:{[budget]:maximum-short},delay:seed%3}),row={kind:'native-budget-'+budget+'-'+short,metadata:src.metadata,input:await blob(report,src.planes[0].input),backing:await blob(report,src.backing),limits:{[budget]:maximum-short},charge,base};report.runs.push(row);
  try{
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);row.before=r.store.inspect();const calls=r.nativeObjects.length,prepared=r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0],2)));row.prepared=prepared;
   if(short&&budget!=='gpuBytes'){c.same(prepared.ok,false,'packed scratch/CPU bound refuses before native issue');c.same(prepared.error.code,'limit-exceeded','explicit packed conversion budget error');}
   else{c.ok(prepared,'packed read scratch/CPU charge');const issued=r.asyncAccess.beginTransferRead(prepared.ticket);row.issued=issued;row.afterIssue=r.store.inspect();
    if(short){c.same(issued.ok,false,'packed PBO bound refuses before native issue');c.same(issued.error.code,'limit-exceeded','explicit packed staging budget error');}
    else{c.ok(issued,'packed staging exact budget');const ready=await poll(r,prepared.ticket);row.output=await blob(report,ready.bytes);row.fence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.same(publicMisses(src.metadata.format,src.planes[0].input,ready.bytes),[],'exact bounded native packed read words');}
    c.ok(r.asyncAccess.release(prepared.ticket),'bounded packed read cleanup');
   }
   if(short)c.same(r.nativeObjects.length,calls,'budget refusal creates no native PBO or helper');row.after=r.store.inspect();c.same(row.after.budgets,row.before.budgets,'bounded packed read returns original accounting');
  }finally{await finish(r,report,row);}
 }
 for(const format of [21,20]) {
  const src=source(format,7,5,1,seed^0x538715),r=rig(gl,c,{hideIndexed:true}),row={kind:'deliberately-masked-indexed-extension',metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try {
   gl.disable(gl.BLEND);gl.colorMask(false,true,false,true);gl.blendEquationSeparate(gl.FUNC_SUBTRACT,gl.FUNC_ADD);gl.blendFuncSeparate(gl.ONE,gl.ZERO,gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);gl.enable(gl.SCISSOR_TEST);
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);row.before=callerState(r.traced);
   const lease=c.ok(r.store.retainStorage(1,6,'readback'),'fallback floating depth read lease').lease,bytes=c.ok(r.store.readStorage(lease,{x:0,y:0,z:0,width:7,height:5,depth:1}),'actual fallback GPU depth packing').bytes;row.after=callerState(r.traced);c.same(row.after,row.before,'non-indexed helper restores global depth/stencil/blend/mask state');row.output=await blob(report,bytes);c.same(publicMisses(format,src.planes[0].input,bytes),[],'actual fallback native depth and stencil fields');c.ok(r.store.releaseStorage(lease),'fallback source lease release');
   row.native=await blob(report,await nativeRead(r,r.allocations[0].storage.texture,7,5,0,format===20));c.same(nativeMisses(format,src.planes[0].input,await nativeRead(r,r.allocations[0].storage.texture,7,5,0,format===20)),[],'fallback independent original native depth fields');
  } finally {await finish(r,report,row);}
 }
 for(const format of [21,20])for(const short of [0,1]) {
  const src=source(format,7,5,2,seed^0x9a7154),owned=4,sourceBytes=42*owned,viewBytes=7*owned,r=rig(gl,c,{limits:{gpuBytes:sourceBytes+viewBytes-short}}),row={kind:'private-range-budget-'+short,metadata:src.metadata,inputPlanes:[],sourceBytes,viewBytes,limit:sourceBytes+viewBytes-short};report.runs.push(row);
  for(const p of src.planes)row.inputPlanes.push({...p,input:await blob(report,p.input)});
  try {
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);const lease=c.ok(r.store.retainStorage(1,6,'view'),'bounded depth sampler lease').lease,count=r.nativeObjects.length;row.before=r.store.inspect();const view=r.imageAccess.capture(lease,1,2);row.capture=view;
   if(short){c.same(view.ok,false,'one-byte short native range and persistent PBO budget refuses');c.same(view.error.code,'limit-exceeded','explicit retained depth budget refusal');c.same(r.nativeObjects.length,count,'range refusal allocates no native texture or upload buffer');}
   else{c.ok(view,'exact original depth range allocation budget');row.allocated=r.store.inspect();c.same(row.allocated.budgets.gpuBytes,sourceBytes+viewBytes,'entire private texture and upload buffer cost charged');const resolved=c.ok(r.imageAccess.resolve(view.token),'bounded private native depth identity');c.ok(r.imageAccess.refresh(view.token),'exact bounded original native range copy');row.copyFence=await physicalFence(r,'bounded-depth-private-range-completion');row.planes=[];for(let local=0;local<2;local++){const p=src.planes[local+1],raw=await nativeRead(r,resolved.storage.texture,p.width,p.height,local,format===20);row.planes.push({local,original:p.level,native:await blob(report,raw)});c.same(nativeMisses(format,p.input,raw),[],'bounded original native depth range');}c.ok(r.imageAccess.release(view.token),'release bounded private depth allocation');}
   row.after=r.store.inspect();c.same(row.after.budgets,row.before.budgets,'bounded depth range cleanup returns original charge');c.ok(r.store.releaseStorage(lease),'release bounded depth lease');
  }finally{await finish(r,report,row);}
 }
 for(const [format,nativeFault]of [[21,'texture'],[20,'texture'],[20,'storage']]){
  const src=source(format,7,5,2,seed^0x92b145),r=rig(gl,c,{nativeFault}),row={kind:'private-allocation-error-'+nativeFault,metadata:src.metadata};report.runs.push(row);
  try{add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);const lease=c.ok(r.store.retainStorage(1,6,'view'),'private allocation failure source lease').lease;row.before=r.store.inspect();r.armFault();row.result=r.imageAccess.capture(lease,1,2);c.same(row.result.ok,false,'actual private depth allocation failure refuses');c.same(row.result.error.code,'backend-error','private depth allocation failure is explicit');row.after=r.store.inspect();c.same(row.after.budgets,row.before.budgets,'failed private texture and PBO charges roll back before publishing');c.ok(r.store.releaseStorage(lease),'private allocation failure lease release');}
  finally{await finish(r,report,row);}
 }
 {
  const metadata={id:17,target:0,format:64,bind:16,width:37,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},input=Uint8Array.from({length:37},(_,i)=>(i*73+seed)&255),r=rig(gl,c,{delay:seed%3}),row={kind:'raw-buffer-read',metadata,input:await blob(report,input)};report.runs.push(row);
  try{add(r,metadata,input);const fields={resourceHandle:17,level:0,usage:0,stride:37,layerStride:0,box:{x:0,y:0,z:0,width:37,height:1,depth:1},dataOffset:0,direction:1},request=c.ok(r.store.prepareTransfer(1,command(transfer(17,{level:0,stride:37,x:0,y:0,width:37,height:1,offset:0}))),'inherited raw buffer upload');c.ok(r.store.executeTransfer(request.ticket),'inherited native raw buffer upload');row.uploadFence=await physicalFence(r,'inherited-raw-buffer-upload-completion');const lease=c.ok(r.store.retainStorage(1,17,'readback'),'inherited raw buffer source lease').lease;row.sync=await blob(report,c.ok(r.store.readStorage(lease),'inherited raw buffer synchronous read').bytes);const read=c.ok(r.asyncAccess.beginStorageRead(lease,{x:0,y:0,z:0,width:37,height:1,depth:1}),'inherited native buffer staging copy'),ready=await poll(r,read.ticket);row.async=await blob(report,ready.bytes);row.fence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.same([...ready.bytes],[...input],'inherited raw buffer bypasses pixel conversion');c.ok(r.asyncAccess.release(read.ticket),'inherited buffer read release');c.ok(r.store.releaseStorage(lease),'inherited raw buffer lease release');}
  finally{await finish(r,report,row);}
 }
 {
  const src=source(20,7,5,0,seed^0x28a4),r=rig(gl,c),row={kind:'current-helper-program-disposal',metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try{
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);const lease=c.ok(r.store.retainStorage(1,6,'readback'),'current program depth read lease').lease;r.setLabel('current-packed-depth-packing-program');row.output=await blob(report,c.ok(r.store.readStorage(lease,{x:0,y:0,z:0,width:7,height:5,depth:1}),'own helper pipeline creation').bytes);c.ok(r.store.releaseStorage(lease),'current program source release');const own=r.nativeObjects.find(o=>o.name==='createProgram'&&o.label==='current-packed-depth-packing-program');c.same(Boolean(own),true,'actual own helper program recorded');r.traced.useProgram(own.object);row.currentBefore=r.trace.id(gl.getParameter(gl.CURRENT_PROGRAM));r.backend.dispose();row.currentAfter=r.trace.id(gl.getParameter(gl.CURRENT_PROGRAM));c.same(gl.getParameter(gl.CURRENT_PROGRAM),null,'native helper disposal unbinds its current program');
  }finally{await finish(r,report,row);}
 }
 {
  const r=rig(gl,c),src=source(20,1,1,0,seed),row={kind:'private-helper-ownership-guards',metadata:src.metadata,authority:'private-helper-only',refusals:[]};report.runs.push(row);
  const check=()=>{if(gl.getError()!==gl.NO_ERROR)throw Error('direct helper native error');},require=(value,code,message)=>{if(!value)throw Error(code+': '+message);},vao=r.traced.createVertexArray(),helper=createFloatingDepthPacker(r.traced,check,require,vao,null);
  try {
   for(const [name,operation]of [['invalid-width',()=>helper.createScratch(0,1,true)],['invalid-height',()=>helper.createScratch(1,NaN,true)],['invalid-stencil-format',()=>helper.createScratch(1,1,true,gl.RGBA8)],['foreign-pack',()=>helper.pack({},null,0,{width:1,height:1})],['foreign-read',()=>helper.read({},null)]]){let error=null;try{operation();}catch(e){error=e.message;}c.same(Boolean(error),true,'direct helper ownership guard '+name);row.refusals.push({name,error});}
   helper.releaseScratch({});const owned=helper.createScratch(1,1,true);row.ownedScratch={depth:r.trace.id(owned.depthColor),stencil:r.trace.id(owned.stencilColor),copy:r.trace.id(owned.depthCopy)};row.scratchFence=await physicalFence(r,'direct-owned-depth-scratch-completion');helper.dispose();helper.dispose();let error=null;try{helper.createScratch(1,1,false);}catch(e){error=e.message;}c.same(Boolean(error),true,'disposed native helper refuses allocations');row.refusals.push({name:'disposed',error});
  } finally {helper.dispose();r.traced.deleteVertexArray(vao);await finish(r,report,row);}
 }
 const lostCanvas=document.createElement('canvas'),lost=lostCanvas.getContext('webgl2'),r=rig(lost,c),src=source(20,7,5,0,seed),row={kind:'actual-context-loss',metadata:src.metadata};report.runs.push(row);
 try{add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);lostCanvas.addEventListener('webglcontextlost',e=>e.preventDefault(),{once:true});lost.getExtension('WEBGL_lose_context').loseContext();for(let i=0;i<100&&!lost.isContextLost();i++)await new Promise(resolve=>setTimeout(resolve,1));row.actualLost=lost.isContextLost();c.same(row.actualLost,true,'actual native packed-depth context loss');row.result=r.store.createResource({...src.metadata,id:7});c.same(row.result.ok,false,'lost host cannot allocate packed-depth authority');c.same(row.result.error.code,'backend-error','context loss has explicit packed-depth backend error');}finally{await finish(r,report,row);}
 report.status='passed';return report;
}
