import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll} from './standard-float-image-rig.mjs';
import {createStandardFloatColorTransferBackend} from '../resources.mjs';
import {originalFormats,source,transfer,finiteMisses,originalValues,hex} from '../../../tools/virgl-command/standard-float-image-fixtures.mjs';
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
 const p=profile.precision/8,input=new Uint8Array(width*height*profile.components*p),view=new DataView(input.buffer),half=[0x3000,0xbd00,0x4400,0x3c00];
 for(let pixel=0;pixel<width*height;pixel++)for(let lane=0;lane<profile.components;lane++)profile.precision===16?view.setUint16((pixel*profile.components+lane)*p,half[lane],true):view.setFloat32((pixel*profile.components+lane)*p,values[lane],true);
 return input;
};
export async function runBoundaries({seed=0x13ac79e1}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={schema:'original-float-image-boundaries-v1',status:'running',seed,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,predictions:c.rows,runs:[],blobs:[]};window.__standardFloatImageEvidence=report;
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
   const base=r.allocations.find(row=>row.metadata.id===6&&row.metadata.width===13).storage.texture,plane=src.planes[2],values=[.125,-1.25,4,1],replacement=clearBytes(profile,plane.width,plane.height,values),before=c.ok(r.store.readBacking(6,0,src.backing.length),'original float backing before native-only clear').bytes;
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
 for(const nativeFault of['texture','storage','upload','framebuffer','copy','read','buffer','fence']){
  const src=source(nativeFault==='upload'?93:31,7,5,2,seed^0x29d13ef),r=rig(gl,c,{nativeFault}),row={kind:'native-failure',nativeFault,metadata:src.metadata,backing:await blob(report,src.backing),planes:[]};for(const plane of src.planes)row.planes.push({...plane,input:await blob(report,plane.input)});report.runs.push(row);
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
 const host=new Proxy(gl,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{if(name==='getExtension'&&args[0]==='EXT_color_buffer_float')return null;if(/^create/.test(name))nativeAllocations++;return value.apply(target,args);};}}),unsupported=createStandardFloatColorTransferBackend(host);
 c.same(unsupported.ok,false,'unqualified float host refuses backend');c.same(unsupported.error.code,'unsupported-host','native float extension absence bounded');c.same(nativeAllocations,0,'float host refusal precedes all native object allocations');report.hostRefusal={actualExtension:Boolean(gl.getExtension('EXT_color_buffer_float')),deliveredExtension:null,result:unsupported,nativeAllocations};
 report.status='passed';return report;
}
