import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll} from './standard-packed-float-image-rig.mjs';
import {createStandardPackedFloatColorTransferBackend} from '../resources.mjs';
import {originalFormats,source,transfer,copyTransfer,finiteMisses,originalValues,hex} from '../../../tools/virgl-command/standard-packed-float-image-fixtures.mjs';
import {decodeStandardColorSubmission} from '../decoder.mjs';
const decoded=wire=>{const r=decodeStandardColorSubmission(wire);if(!r.ok)throw Error(r.error.message);return r.commands[0];};
async function upload(r,src,label){
 for(const plane of src.planes){
  r.setLabel(label+'-'+plane.level);const wire=transfer(src.metadata.id,plane),prepared=r.c.ok(r.store.prepareTransfer(1,decoded(wire)),'bounded original float synchronous upload');r.c.ok(r.store.executeTransfer(prepared.ticket),'bounded float upload completion');r.operations.push({label:r.label,wire:hex(wire),layout:prepared.layout});
 }
}
function clearPlane(r,texture,level,values){
 const gl=r.traced,framebuffer=gl.createFramebuffer(),old=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),scissor=gl.isEnabled(gl.SCISSOR_TEST),mask=gl.getParameter(gl.COLOR_WRITEMASK);
 try{
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  r.c.same(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'actual native float clear framebuffer');gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl.clearBufferfv(gl.COLOR,0,new Float32Array(values));
 }finally{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,old);gl.colorMask(...mask);scissor?gl.enable(gl.SCISSOR_TEST):gl.disable(gl.SCISSOR_TEST);gl.deleteFramebuffer(framebuffer);}
}
const clearBytes=(profile,width,height,values)=>{
 const input=new Uint8Array(width*height*4),view=new DataView(input.buffer),word=(0x300|0x3d0<<11|0x220<<22)>>>0;
 for(let pixel=0;pixel<width*height;pixel++)view.setUint32(pixel*4,word,true);
 return input;
};
export async function runBoundaries({seed=0x13ac79e1}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={schema:'original-r11g11b10-image-boundaries-v1',status:'running',seed,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,predictions:c.rows,runs:[],blobs:[]};window.__standardPackedFloatImageEvidence=report;
 for(const[ordinal,profile]of originalFormats.entries()){
  const src=source(profile.format,13,7,3,(seed+ordinal)>>>0),r=rig(gl,c,{delay:()=>((seed+ordinal)>>>0)%4}),row={kind:'retained-native-range',seed:src.seed,metadata:src.metadata,backing:await blob(report,src.backing),planes:[],observations:[],snapshots:[]};report.runs.push(row);
  for(const plane of src.planes)row.planes.push({...plane,input:await blob(report,plane.input)});
  try{
   const created=add(r,src.metadata,src.backing);row.generation=created.generation;await upload(r,src,'bounded-float-upload');
   const lease=c.ok(r.store.retainStorage(1,6,'view'),'retained original float source').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'private original float range'),resolved=c.ok(r.imageAccess.resolve(view.token),'private float native allocation');c.ok(r.imageAccess.refresh(view.token),'actual native float private copy');row.view={firstLevel:1,lastLevel:3,metadata:resolved.metadata,texture:r.trace.id(resolved.storage.texture),generation:resolved.generation};
   const fence=await physicalFence(r,'bounded-float-private-copy');
   for(const plane of src.planes.slice(1)){
    const native=nativeRead(gl,resolved.storage.texture,plane.width,plane.height,plane.level-1);row.observations.push({kind:'copy',original:plane.level,local:plane.level-1,width:plane.width,height:plane.height,fence,native:await blob(report,native)});c.same(finiteMisses(profile.format,plane.input,native).slice(0,8),[],'bounded complete original private float plane');
   }
   const base=r.allocations.find(row=>row.metadata.id===6&&row.metadata.width===13).storage.texture,plane=src.planes[2],values=[.125,1.25,4,1],replacement=clearBytes(profile,plane.width,plane.height,values),before=c.ok(r.store.readBacking(6,0,src.backing.length),'original float backing before native-only clear').bytes;
   r.setLabel('bounded-float-native-only-clear');clearPlane(r,base,2,values);c.ok(r.imageAccess.refresh(view.token),'float view refresh reads actual GPU contents');const refreshed=await physicalFence(r,'bounded-float-native-refresh');
   for(const p of src.planes.slice(1)){
    const input=p.level===2?replacement:p.input,native=nativeRead(gl,resolved.storage.texture,p.width,p.height,p.level-1);row.observations.push({kind:'refresh',original:p.level,local:p.level-1,width:p.width,height:p.height,fence:refreshed,...(p.level===2?{originalClear:values,clearInput:await blob(report,replacement)}:{}),native:await blob(report,native)});c.same(finiteMisses(profile.format,input,native).slice(0,8),[],'private float view follows selected native mip mutation');
   }
   const after=c.ok(r.store.readBacking(6,0,src.backing.length),'original float backing after GPU refresh').bytes;c.same(hex(after),hex(before),'native float refresh never substitutes a CPU shadow');row.backingAfterRefresh=await blob(report,after);
   const hold=c.ok(r.imageAccess.hold(view.token),'owned float completion hold').token,box={x:0,y:0,z:0,width:src.metadata.width,height:src.metadata.height,depth:1},pending=c.ok(r.asyncAccess.beginStorageRead(lease,box),'owned float old allocation read');row.snapshots.push({point:'queued-old-read',state:r.store.inspect(),async:r.asyncAccess.inspect(),images:r.imageAccess.inspect()});
   c.ok(r.store.unref(6),'retire original public float ID');const replacementSource=source(profile.format,11,5,1,(seed^0x52af93d1)>>>0),fresh=add(r,replacementSource.metadata,replacementSource.backing);row.replacement={metadata:replacementSource.metadata,generation:fresh.generation,backing:await blob(report,replacementSource.backing),planes:[]};for(const plane of replacementSource.planes)row.replacement.planes.push({...plane,input:await blob(report,plane.input)});await upload(r,replacementSource,'bounded-float-unequal-replacement');c.same(fresh.generation>created.generation,true,'public float ID reuse gets new generation');const current=c.ok(r.store.retainStorage(2,6,'view'),'fresh unequal float lease').lease,newNative=c.ok(r.bindings.resolve(current),'fresh unequal native allocation');c.same(newNative.storage.texture===base,false,'old and unequal new float storage remain separate');
   const old=c.ok(r.imageAccess.resolve(view.token),'old original float range still retained');c.same(old.generation,created.generation,'retained float range preserves old generation');c.same([old.metadata.width,old.metadata.height,old.metadata.lastLevel],[6,3,2],'old float range keeps original dimensions and level count');
   const result=await poll(r,pending.ticket),oldFence=r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);row.observations.push({kind:'retained-old-read',generation:created.generation,metadata:src.metadata,fence:oldFence,native:await blob(report,result.bytes)});
   c.same(result.bytes.length,src.planes[0].input.length,'old physical read keeps complete original logical bytes');
   c.same(finiteMisses(profile.format,src.planes[0].input,new Uint8Array(new Float32Array(originalValues(profile.format,result.bytes)).buffer)).slice(0,8),[],'completed old float read remains tied to original generation');
   c.ok(r.asyncAccess.release(pending.ticket),'old native float read releases after consumed fence');
   row.snapshots.push({point:'old-read-completed',state:r.store.inspect(),async:r.asyncAccess.inspect(),images:r.imageAccess.inspect()});
   c.ok(r.imageAccess.release(view.token),'release float public view token');c.ok(r.store.releaseStorage(lease),'release float old source lease');c.same(r.store.inspect().resources.some(row=>row.generation===created.generation),true,'float final hold retains old source before fence');
   const heldFence=await physicalFence(r,'bounded-float-retained-final-hold');row.holdFence=heldFence;c.ok(r.imageAccess.release(hold),'release old float generation only after final native fence');c.same(r.store.inspect().resources.some(row=>row.generation===created.generation),false,'float old source and private allocation retire after final hold');c.ok(r.store.releaseStorage(current),'release fresh float storage lease');
   for(const phase of['cancel','dispose']){
    const token=c.ok(r.store.retainStorage(1,6,'readback'),'bounded float cancellation lease').lease,read=c.ok(r.asyncAccess.beginStorageRead(token,{x:0,y:0,z:0,width:11,height:5,depth:1}),'bounded float cancellation actual read');
    if(phase==='cancel'){await poll(r,read.ticket,{discard:true});c.ok(r.asyncAccess.release(read.ticket),'discarded real float PBO cleanup');c.ok(r.store.releaseStorage(token),'float cancellation lease cleanup');}
    else{row.snapshots.push({point:'dispose-pending-float-read',state:r.store.inspect(),async:r.asyncAccess.inspect()});c.ok(r.store.dispose(),'dispose pending original float GPU read');c.same(r.asyncAccess.poll(read.ticket).ok,false,'disposed float read cannot collect');c.ok(r.asyncAccess.release(read.ticket),'bounded revoked float ticket release');c.same(r.asyncAccess.release(read.ticket).ok,false,'revoked float ticket refuses second release');}
   }
  }finally{await finish(r,report,row);}
 }
 // One original nonzero box crosses odd public strides and scatter/gather backing.
 {
  const src=source(124,31,17,4,seed^0x317051ab),patchSource=source(124,7,4,0,seed^0xe6472351),patch={...patchSource.planes[0],level:1,x:3,y:2,stride:37,offset:src.backing.length+5};
  const backing=new Uint8Array(patch.offset+(patch.height-1)*patch.stride+patch.width*4+9).fill(0xa7);backing.set(src.backing);
  for(let y=0;y<patch.height;y++)backing.set(patch.input.subarray(y*patch.width*4,(y+1)*patch.width*4),patch.offset+y*patch.stride);
  const r=rig(gl,c,{delay:(seed>>>3)%4}),row={kind:'partial-original-box',seed:src.seed,metadata:src.metadata,backing:await blob(report,backing),planes:[],observations:[],patch:{...patch,input:await blob(report,patch.input)}};report.runs.push(row);
  for(const plane of src.planes)row.planes.push({...plane,input:await blob(report,plane.input)});
  try{
   add(r,src.metadata,backing);await upload(r,src,'bounded-packed-partial-base');
   const wire=transfer(6,patch),request=c.ok(r.store.prepareTransfer(1,decoded(wire)),'original nonzero packed upload box');r.setLabel('bounded-packed-patch-upload');c.ok(r.store.executeTransfer(request.ticket),'actual original packed patch upload');r.operations.push({label:r.label,wire:hex(wire),layout:request.layout});
   const fence=await physicalFence(r,'bounded-packed-partial-upload'),texture=r.allocations[0].storage.texture;
   const expected=plane=>{const bytes=plane.input.slice();if(plane.level===patch.level)for(let y=0;y<patch.height;y++)bytes.set(patch.input.subarray(y*patch.width*4,(y+1)*patch.width*4),((patch.y+y)*plane.width+patch.x)*4);return bytes;};
   for(const plane of src.planes){const native=nativeRead(gl,texture,plane.width,plane.height,plane.level);row.observations.push({kind:'partial-upload',original:plane.level,width:plane.width,height:plane.height,fence,native:await blob(report,native)});c.same(finiteMisses(124,expected(plane),native).slice(0,8),[],'complete nonzero packed upload and untouched native neighbors/mips');}
   const lease=c.ok(r.store.retainStorage(1,6,'view'),'original patched packed source lease').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'patched packed range'),resolved=c.ok(r.imageAccess.resolve(view.token),'actual patched packed private texture');c.ok(r.imageAccess.refresh(view.token),'native patched packed range copy');row.view={firstLevel:1,lastLevel:3,metadata:resolved.metadata,texture:r.trace.id(resolved.storage.texture)};const copied=await physicalFence(r,'bounded-packed-partial-copy');
   for(const plane of src.planes.slice(1,4)){const native=nativeRead(gl,resolved.storage.texture,plane.width,plane.height,plane.level-1);row.observations.push({kind:'partial-view',original:plane.level,local:plane.level-1,width:plane.width,height:plane.height,fence:copied,native:await blob(report,native)});c.same(finiteMisses(124,expected(plane),native).slice(0,8),[],'actual copied nonzero packed box with complete neighbors');}
   c.ok(r.imageAccess.release(view.token),'patched packed private view cleanup');c.ok(r.store.releaseStorage(lease),'patched packed source lease cleanup');
   const readWire=transfer(6,patch,2),syncRequest=c.ok(r.store.prepareTransfer(1,decoded(readWire)),'original nonzero packed sync read');r.setLabel('bounded-packed-patch-sync');c.ok(r.store.executeTransfer(syncRequest.ticket),'native packed patch read');const sync=new Uint8Array(patch.input.length);for(let y=0;y<patch.height;y++)sync.set(c.ok(r.store.readBacking(6,patch.offset+y*patch.stride,patch.width*4),'complete packed patch public row').bytes,y*patch.width*4);
   c.same(finiteMisses(124,patch.input,new Uint8Array(new Float32Array(originalValues(124,sync)).buffer)).slice(0,8),[],'original packed synchronous nonzero box values');row.partialReads={wire:hex(readWire),layout:syncRequest.layout,sync:await blob(report,sync),reads:[]};
   const staging=new Uint8Array(backing.length).fill(0x2e);add(r,{id:8,target:0,format:64,bind:524288,width:staging.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},staging);row.stagingBacking=await blob(report,staging);
   for(const opcode of[43,45]){const readWire=opcode===43?transfer(6,patch,2):copyTransfer(6,patch,8),read=c.ok(r.asyncAccess.prepareTransfer(1,decoded(readWire)),'original staged nonzero packed box');r.setLabel('bounded-packed-patch-staged-'+opcode);c.ok(r.asyncAccess.beginTransferRead(read.ticket),'actual packed nonzero PBO read');const result=await poll(r,read.ticket),fence=r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);c.same(finiteMisses(124,patch.input,new Uint8Array(new Float32Array(originalValues(124,result.bytes)).buffer)).slice(0,8),[],'original nonzero packed staged values');for(let y=0;y<patch.height;y++)c.ok(r.store.writeBacking(opcode===43?6:8,patch.offset+y*patch.stride,result.bytes.subarray(y*read.layout.rowBytes,(y+1)*read.layout.rowBytes)),'original strided nonzero packed publication');row.partialReads.reads.push({opcode,wire:hex(readWire),layout:read.layout,fence,nativeBytes:await blob(report,result.bytes)});c.ok(r.asyncAccess.release(read.ticket),'nonzero packed PBO cleanup');}
   row.finalBacking=await blob(report,c.ok(r.store.readBacking(6,0,backing.length),'complete nonzero packed original backing').bytes);row.finalStagingBacking=await blob(report,c.ok(r.store.readBacking(8,0,backing.length),'complete nonzero packed staging backing').bytes);c.same(gl.getError(),gl.NO_ERROR,'nonzero packed box leaves no native error');
  }finally{await finish(r,report,row);}
 }
 for(const boundary of['scratch-exact','scratch-short','staging-exact','staging-short']){
  const short=boundary.endsWith('short'),src=source(124,5,3,0,seed^0x589317ab),nativeBytes=5*3*16,limits=boundary.startsWith('scratch')?{scratchBytes:nativeBytes-Number(short)}:{gpuBytes:5*3*4+nativeBytes-Number(short)},r=rig(gl,c,{delay:(seed>>>5)%3,limits}),row={kind:'read-budget',boundary,seed:src.seed,metadata:src.metadata,limits,backing:await blob(report,src.backing),planes:[],observations:[]};report.runs.push(row);
  for(const plane of src.planes)row.planes.push({...plane,input:await blob(report,plane.input)});
  try{
   add(r,src.metadata,src.backing);await upload(r,src,'bounded-packed-read-budget-upload');const uploaded=await physicalFence(r,'bounded-packed-read-budget-uploaded'),native=nativeRead(gl,r.allocations[0].storage.texture,5,3);row.observations.push({kind:'read-budget-source',original:0,width:5,height:3,fence:uploaded,native:await blob(report,native)});c.same(finiteMisses(124,src.planes[0].input,native).slice(0,8),[],'original packed budget source is physically complete');
   const box={x:0,y:0,z:0,width:5,height:3,depth:1};row.foreignLease=r.asyncAccess.beginStorageRead({},box);c.same(row.foreignLease.ok,false,'foreign packed read capability refuses');c.same(row.foreignLease.error.code,'invalid-lease','foreign packed read cannot resolve native storage');
   const lease=c.ok(r.store.retainStorage(1,6,'readback'),'bounded packed read budget lease').lease,before=r.nativeObjects.length;r.setLabel('bounded-packed-read-budget');const result=r.asyncAccess.beginStorageRead(lease,box);row.start=result;row.queued={owner:r.store.inspect(),async:r.asyncAccess.inspect()};c.same(result.ok,!short,'complete native packed '+boundary);
   if(short){c.same(result.error.code,'limit-exceeded','one-byte-short packed read budget refuses');c.same(r.nativeObjects.length,before,'packed read budget refuses before native PBO allocation');c.same(r.store.inspect().budgets.scratchBytes,0,'refused packed read releases all scratch');c.same(r.asyncAccess.inspect().stagingBytes,0,'refused packed read releases all staging');}
   else{
    c.same(row.queued.owner.budgets.scratchBytes,nativeBytes,'exact packed read charges full native scratch');c.same(row.queued.async.stagingBytes,nativeBytes,'exact packed read charges full native PBO');const read=await poll(r,result.ticket),fence=r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);row.read={nativeBytes:await blob(report,read.bytes),fence};c.same(finiteMisses(124,src.planes[0].input,new Uint8Array(new Float32Array(originalValues(124,read.bytes)).buffer)).slice(0,8),[],'exact packed budget publishes actual original values');c.ok(r.asyncAccess.release(result.ticket),'exact packed read ticket cleanup');
   }
   c.ok(r.store.releaseStorage(lease),'packed read budget lease cleanup');c.same(gl.getError(),gl.NO_ERROR,'packed budget refusals leave no native error');
  }finally{await finish(r,report,row);}
 }
 for(const nativeFault of['texture','storage','upload','framebuffer','copy','read','buffer','fence']){
  const src=source(124,7,5,2,seed^0x29d13ef),r=rig(gl,c,{nativeFault}),row={kind:'native-failure',nativeFault,metadata:src.metadata,backing:await blob(report,src.backing),planes:[]};for(const plane of src.planes)row.planes.push({...plane,input:await blob(report,plane.input)});report.runs.push(row);
  try{
   if(['texture','storage'].includes(nativeFault)){
    r.armFault();r.setLabel('native-float-'+nativeFault+'-allocation');const failed=r.store.createResource(src.metadata);c.same(failed.ok,false,'bounded native float allocation failure');row.result=failed;
   }else{
    add(r,src.metadata,src.backing);
    if(nativeFault==='upload'){
     r.armFault();r.setLabel('native-float-upload-failure');const prepared=c.ok(r.store.prepareTransfer(1,decoded(transfer(6,src.planes[0]))),'prepare native failing original float upload'),failed=r.store.executeTransfer(prepared.ticket);c.same(failed.ok,false,'bounded native original float upload failure');row.result=failed;
    }else{
     await upload(r,src,'native-float-failure-setup');
     const lease=c.ok(r.store.retainStorage(1,6,'view'),'native float failure source lease').lease;
     if(['framebuffer','copy'].includes(nativeFault)){
      const view=c.ok(r.imageAccess.capture(lease,1,2),'native float failure private range');r.armFault();r.setLabel('native-float-'+nativeFault+'-copy-failure');const failed=r.imageAccess.refresh(view.token);c.same(failed.ok,false,'bounded native float private copy failure');row.result=failed;
     }else{
      r.armFault();r.setLabel('native-float-'+nativeFault+'-read-failure');const failed=r.asyncAccess.beginStorageRead(lease,{x:0,y:0,z:0,width:7,height:5,depth:1});c.same(failed.ok,false,'bounded native original float staged read failure');row.result=failed;c.same(r.asyncAccess.inspect().stagingBytes,0,'failed float staged read rolls back all PBO charges');c.same(r.store.inspect().budgets.scratchBytes,0,'failed float staged read rolls back all native scratch charges');
     }
    }
   }
   row.afterFailure=r.store.inspect();c.same(r.faultEvents.length,1,'one bounded actual native float failure');c.same(gl.getError(),gl.NO_ERROR,'native float failure error consumed');
  }finally{await finish(r,report,row);}
 }
 let nativeAllocations=0;
 const host=new Proxy(gl,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{if(name==='getExtension'&&args[0]==='EXT_color_buffer_float')return null;if(/^create/.test(name))nativeAllocations++;return value.apply(target,args);};}}),unsupported=createStandardPackedFloatColorTransferBackend(host);
 c.same(unsupported.ok,false,'unqualified float host refuses backend');c.same(unsupported.error.code,'unsupported-host','native float extension absence bounded');c.same(nativeAllocations,0,'float host refusal precedes all native object allocations');report.hostRefusal={actualExtension:Boolean(gl.getExtension('EXT_color_buffer_float')),deliveredExtension:null,result:unsupported,nativeAllocations};
 report.status='passed';return report;
}
