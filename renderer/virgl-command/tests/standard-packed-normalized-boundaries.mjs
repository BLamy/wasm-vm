import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll} from './standard-packed-normalized-rig.mjs';
import {source,transfer,nativeMisses,canonical,originalFormat} from '../../../tools/virgl-command/standard-packed-normalized-fixtures.mjs';
import {command} from './standard-integer-images.mjs';
async function upload(r,src){for(const p of src.planes){const prepared=r.c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,p))),'boundary packed-normalized upload preparation');r.c.ok(r.asyncAccess.provideInput(prepared.ticket,p.input),'boundary packed-normalized source words');r.c.ok(r.asyncAccess.upload(prepared.ticket),'boundary native upload');r.c.ok(r.asyncAccess.release(prepared.ticket),'boundary upload release');}return physicalFence(r,'boundary-upload-completion');}
export async function runBoundaries({seed=0x31d075a9}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={schema:'original-packed-normalized-image-boundaries-v1',status:'running',seed,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),runs:[],blobs:[],predictions:c.rows};window.__standardPackedNormalizedEvidence=report;
 for(const format of[5,8,407,409]){
  const src=source(format,13,7,3,seed^format),r=rig(gl,c,{delay:seed%3+1}),row={kind:'generation-context-held-range',metadata:src.metadata,backing:await blob(report,src.backing),planes:[]};report.runs.push(row);for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});
  try{
   const original=add(r,src.metadata,src.backing);row.sourceTexture=r.trace.id(r.allocations[0].storage.texture);row.sourceGeneration=original.generation;row.uploadFence=await upload(r,src);
   const lease=c.ok(r.store.retainStorage(1,6,'view'),'boundary old packed-normalized storage').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'boundary old packed-normalized private range'),resolved=c.ok(r.imageAccess.resolve(view.token),'boundary native identity');c.ok(r.imageAccess.refresh(view.token),'boundary native packed-normalized copy');row.copyFence=await physicalFence(r,'boundary-copy-completion');const hold=c.ok(r.imageAccess.hold(view.token),'hold old private range').token;row.privateTexture=r.trace.id(resolved.storage.texture);row.privateGeneration=resolved.generation;
   const pending=c.ok(r.asyncAccess.prepareTransfer(2,command(transfer(6,src.planes[0],2))),'queued old packed-normalized read');c.ok(r.asyncAccess.beginTransferRead(pending.ticket),'begin native queued old read');row.pendingBefore=r.store.inspect();c.ok(r.store.unref(6),'unref packed-normalized source with held copy/read');const replacement=source(format,13,7,3,seed^0xabcdef);row.replacementBacking=await blob(report,replacement.backing);row.replacementGeneration=add(r,replacement.metadata,replacement.backing).generation;row.replacementTexture=r.trace.id(r.allocations.at(-1).storage.texture);c.same(row.replacementGeneration===original.generation,false,'source ID reuse changes generation');c.same(row.replacementTexture===row.sourceTexture,false,'source ID reuse allocates another native texture');
   c.same(r.asyncAccess.validate(pending.ticket).ok,false,'queued old packed-normalized transfer becomes stale');c.same(r.asyncAccess.poll(pending.ticket).ok,false,'stale transfer cannot publish old words to reused ID');const discarded=await poll(r,pending.ticket,{discard:true});row.discarded={status:discarded.status,fence:r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1)};c.ok(r.asyncAccess.release(pending.ticket),'release physically completed stale packed-normalized transfer');
   c.ok(r.store.destroyContext(1),'destroy old retained packed-normalized context');c.same(r.imageAccess.resolve(view.token).ok,false,'stale packed-normalized view context refuses');c.ok(r.imageAccess.release(view.token),'release old public view');c.ok(r.store.releaseStorage(lease),'release old lease while completion hold remains');row.beforeHoldRelease=r.store.inspect();
   row.heldPlanes=[];for(let local=0;local<3;local++){const p=src.planes[local+1],raw=nativeRead(r,resolved.storage.texture,p.width,p.height,local,originalFormat(format).guestPixelBytes===4);row.heldPlanes.push({local,original:p.level,native:await blob(report,raw)});c.same(nativeMisses(format,p.input,raw),[],'old packed-normalized private pixels survive source ID/context reuse');}c.ok(r.imageAccess.release(hold),'release old private completion hold');row.afterHoldRelease=r.store.inspect();
  }finally{await finish(r,report,row);}
 }
 for(const mode of['complete','cancel-before-begin','cancel-after-begin','dispose-owner','dispose-backend']){
  const src=source(131,7,5,0,seed^mode.length),r=rig(gl,c,{delay:2+seed%3}),row={kind:'queued-'+mode,metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try{
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);const lease=c.ok(r.store.retainStorage(1,6,'view'),'queued packed-normalized storage lease').lease;
   if(mode==='cancel-before-begin'){const request=c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0],2))),'unissued packed-normalized queued read');row.before=r.store.inspect();c.ok(r.asyncAccess.release(request.ticket),'cancel unissued packed-normalized read');}
   else{
    const request=c.ok(r.asyncAccess.beginStorageRead(lease,{x:0,y:0,z:0,width:7,height:5,depth:1}),'retained packed-normalized PBO read');row.before=r.store.inspect();
    if(mode==='complete'){c.ok(r.store.unref(6),'destroy public packed-normalized storage after read issue');c.ok(r.store.destroyContext(1),'switch context after read issue');c.ok(r.store.createContext(1),'replacement packed-normalized context generation');const replacement=source(131,7,5,0,seed^0x888777);add(r,replacement.metadata,replacement.backing);const ready=await poll(r,request.ticket);row.output=await blob(report,ready.bytes);row.fence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.same([...ready.bytes],[...canonical(src.metadata.format,src.planes[0].input)],'retained old storage read returns exact old signed words');c.ok(r.asyncAccess.release(request.ticket),'release completed retained packed-normalized read');}
    else if(mode==='cancel-after-begin'){c.ok(r.asyncAccess.release(request.ticket),'cancel issued packed-normalized read');row.gpuComplete=false;}
    else if(mode==='dispose-owner'){c.ok(r.store.dispose(),'dispose packed-normalized owner with issued PBO');row.gpuComplete=false;c.ok(r.asyncAccess.release(request.ticket),'consume packed-normalized read disposal tombstone');c.same(r.asyncAccess.release(request.ticket).ok,false,'packed-normalized read tombstone is one-use');}
    else{r.backend.dispose();row.gpuComplete=false;c.same(r.asyncAccess.poll(request.ticket).ok,false,'disposed native backend cannot publish packed-normalized read');c.ok(r.asyncAccess.release(request.ticket),'release issued read after backend disposal');}
   }
   if(mode!=='dispose-owner')c.ok(r.store.releaseStorage(lease),'release queued packed-normalized storage lease');row.after=r.store.inspect();
  }finally{await finish(r,report,row);}
 }
 for(const nativeFault of['texture','storage','initialize','upload','read','framebuffer','buffer','fence','collect']){
  const src=source(409,13,7,3,seed^nativeFault.length),r=rig(gl,c,{nativeFault}),row={kind:'native-error-'+nativeFault,metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try{
   let result,release=null;
   if(['texture','storage','initialize'].includes(nativeFault)){r.armFault();result=r.store.createResource(src.metadata);}
   else{
    add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);
    if(nativeFault==='upload'){const request=c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0]))),'native-error upload ticket');c.ok(r.asyncAccess.provideInput(request.ticket,src.planes[0].input),'native-error source bytes');r.armFault();result=r.asyncAccess.upload(request.ticket);release=()=>r.asyncAccess.release(request.ticket);}
    else if(nativeFault==='framebuffer'){const lease=c.ok(r.store.retainStorage(1,6,'view'),'native-error view lease').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'native-error private allocation');r.armFault();result=r.imageAccess.refresh(view.token);release=()=>{c.ok(r.imageAccess.release(view.token),'failed copy view release');return r.store.releaseStorage(lease);};}
    else{const request=c.ok(r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0],2))),'native-error read ticket');if(nativeFault==='collect'){c.ok(r.asyncAccess.beginTransferRead(request.ticket),'native-error physical read issue');await poll(r,request.ticket,{discard:true});r.armFault();result=r.asyncAccess.poll(request.ticket);}else{r.armFault();result=r.asyncAccess.beginTransferRead(request.ticket);}release=()=>r.asyncAccess.release(request.ticket);}
   }
   row.result=result;c.same(result.ok,false,'actual packed-normalized native error refuses');c.same(result.error.code,'backend-error','explicit native packed-normalized failure');if(release)c.ok(release(),'failed packed-normalized native operation cleanup');row.after=r.store.inspect();c.same(r.faultEvents.length>0,true,'native error injection executed');
  }finally{await finish(r,report,row);}
 }
 for(const budget of ['scratchBytes','cpuBytes','gpuBytes'])for(const short of [0,1]){
  const src=source(5,7,5,0,seed^budget.length),charge=7*5*4,base=src.planes[0].input.length,maximum=budget==='scratchBytes'?charge:budget==='cpuBytes'?src.backing.length+charge:base+charge;
  const r=rig(gl,c,{limits:{[budget]:maximum-short},delay:seed%3}),row={kind:'native-budget-'+budget+'-'+short,metadata:src.metadata,input:await blob(report,src.planes[0].input),backing:await blob(report,src.backing),limits:{[budget]:maximum-short},charge,base};report.runs.push(row);
  try{
   add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);row.before=r.store.inspect();const calls=r.nativeObjects.length,prepared=r.asyncAccess.prepareTransfer(1,command(transfer(6,src.planes[0],2)));row.prepared=prepared;
   if(short&&budget!=='gpuBytes'){c.same(prepared.ok,false,'packed scratch/CPU bound refuses before native issue');c.same(prepared.error.code,'limit-exceeded','explicit packed conversion budget error');}
   else{c.ok(prepared,'packed read scratch/CPU charge');const issued=r.asyncAccess.beginTransferRead(prepared.ticket);row.issued=issued;row.afterIssue=r.store.inspect();
    if(short){c.same(issued.ok,false,'packed PBO bound refuses before native issue');c.same(issued.error.code,'limit-exceeded','explicit packed staging budget error');}
    else{c.ok(issued,'packed staging exact budget');const ready=await poll(r,prepared.ticket);row.output=await blob(report,ready.bytes);row.fence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.same([...ready.bytes],[...src.planes[0].input],'exact bounded native packed read words');}
    c.ok(r.asyncAccess.release(prepared.ticket),'bounded packed read cleanup');
   }
   if(short)c.same(r.nativeObjects.length,calls,'budget refusal creates no native PBO or helper');row.after=r.store.inspect();c.same(row.after.budgets,row.before.budgets,'bounded packed read returns original accounting');
  }finally{await finish(r,report,row);}
 }
 {
  const src=source(409,7,5,0,seed),r=rig(gl,c,{hideIndexed:true}),row={kind:'deliberately-masked-indexed-extension',metadata:src.metadata,input:await blob(report,src.planes[0].input)};report.runs.push(row);
  try{gl.colorMask(false,true,false,true);gl.enable(gl.SCISSOR_TEST);row.before={mask:gl.getParameter(gl.COLOR_WRITEMASK),scissor:gl.isEnabled(gl.SCISSOR_TEST)};add(r,src.metadata,src.backing);row.after={mask:gl.getParameter(gl.COLOR_WRITEMASK),scissor:gl.isEnabled(gl.SCISSOR_TEST)};c.same(row.before,row.after,'packed initialization restores global state when indexed extension is masked');row.uploadFence=await upload(r,src);const raw=nativeRead(r,r.allocations[0].storage.texture,7,5,0,false);row.native=await blob(report,raw);c.same(nativeMisses(409,src.planes[0].input,raw),[],'actual opaque packed pixels remain correct without indexed authority');}
  finally{await finish(r,report,row);}
 }
 const lostCanvas=document.createElement('canvas'),lost=lostCanvas.getContext('webgl2'),r=rig(lost,c),src=source(8,7,5,0,seed),row={kind:'actual-context-loss',metadata:src.metadata};report.runs.push(row);
 try{add(r,src.metadata,src.backing);row.uploadFence=await upload(r,src);lostCanvas.addEventListener('webglcontextlost',e=>e.preventDefault(),{once:true});lost.getExtension('WEBGL_lose_context').loseContext();for(let i=0;i<100&&!lost.isContextLost();i++)await new Promise(resolve=>setTimeout(resolve,1));row.actualLost=lost.isContextLost();c.same(row.actualLost,true,'actual native packed-normalized context loss');row.result=r.store.createResource({...src.metadata,id:7});c.same(row.result.ok,false,'lost host cannot allocate packed-normalized authority');c.same(row.result.error.code,'backend-error','context loss has explicit packed-normalized backend error');}finally{await finish(r,report,row);}
 report.status='passed';return report;
}
