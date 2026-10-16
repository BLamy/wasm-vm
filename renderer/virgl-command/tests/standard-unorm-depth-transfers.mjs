import {rig,finish,blob,nativeRead,physicalFence} from './standard-unorm-depth-rig.mjs';
import {source,metadata,nativeMisses} from '../../../tools/virgl-unorm-depth/fixtures.mjs';
import {transfer,copyTransfer,inlineTransfer,hex} from '../../../tools/virgl-command/standard-floating-depth-fixtures.mjs';
import {callerState,gpuClear,poll} from './standard-floating-depth-rig.mjs';
import {createStandardUnormDepthResourceStore} from '../resources.mjs';
import {decodeStandardUnormDepthImageSubmission} from '../decoder.mjs';
const state=r=>{const s=callerState(r.gl);for(const key of ['program','vao','read','draw'])s[key]=r.trace.id(s[key]);return s;};
const budget=r=>({...r.store.inspect().budgets,stagingBytes:r.asyncAccess.inspect().stagingBytes});
const sameBytes=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
export async function runTransfers(env,{seed,smoke=false}){
 const {c,gl,bridge,report}=env,cases=[];
 for(const bind of smoke?[9]:[1,8,9])for(const [width,height,lastLevel] of smoke?[[13,7,2]]:[[17,9,4],[13,7,2],[1,31,4],[29,1,4]])cases.push({bind,width,height,lastLevel});
 for(const [ordinal,f]of cases.entries()){
  const src=source(16,seed^ordinal,f.width,f.height,f.lastLevel);src.metadata.bind=f.bind;
  const r=rig(gl,bridge,c,f,{delay:ordinal%3}),row={name:'UN16-transfers/'+f.bind+'/'+f.width+'x'+f.height,kind:'transfer',format:16,source:src.metadata,sourceBacking:await blob(report,src.backing),planes:[],operations:[],views:[],clears:[],publicReads:[],patches:[]};
  report.runs.push(row);const expected=src.planes.map(p=>p.input.slice()),wanted=src.backing.slice();
  for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});
  const command=wire=>c.ok(decodeStandardUnormDepthImageSubmission(wire),'original UN16 transfer packet').commands[0];
  try{
   r.add(src.metadata,src.backing);const texture=r.allocations[0].storage.texture;
   for(const p of src.planes){
    const wire=p.level%3===0?inlineTransfer(6,p):transfer(6,p),before=budget(r);r.setLabel('UN16-upload-'+p.level);
    const api=p.level%3===2?r.asyncAccess:r.store,prepared=c.ok(api.prepareTransfer(1,command(wire)),'UN16 upload prepare'),afterPrepare=budget(r);
    if(api===r.asyncAccess){const input=p.input.slice();c.ok(api.provideInput(prepared.ticket,input),'UN16 owned async input');input.fill(0xff);c.ok(api.upload(prepared.ticket),'UN16 native async upload');c.ok(api.release(prepared.ticket),'UN16 input ticket release');}
    else c.ok(api.executeTransfer(prepared.ticket),'UN16 native synchronous upload');
    row.operations.push({kind:'upload',level:p.level,wire:hex(wire),layout:prepared.layout,before,afterPrepare,after:budget(r)});
   }
   row.uploadFence=await physicalFence(r,'UN16-upload-completion');
   for(const p of src.planes){const raw=await nativeRead(r,texture,16,p.width,p.height,p.level);p.observed=await blob(report,raw);row.planes[p.level].native=p.observed;c.same(nativeMisses(16,expected[p.level],raw),[],'original native UN16 plane');}
   // An original nonzero-level subrectangle must preserve every adjacent word.
   const p=src.planes[1],patchSource=source(16,seed^0x98765432,Math.min(2,p.width),1,0).planes[0],patch={...patchSource,level:1,x:p.width>2?1:0,y:0},wire=inlineTransfer(6,patch);
   r.setLabel('UN16-partial-mip-upload');const ticket=c.ok(r.store.prepareTransfer(2,command(wire)),'UN16 partial mip prepare');c.ok(r.store.executeTransfer(ticket.ticket),'native UN16 partial mip upload');
   for(let y=0;y<patch.height;y++)expected[1].set(patch.input.subarray(y*patch.width*2,(y+1)*patch.width*2),((patch.y+y)*p.width+patch.x)*2);
   const patchFence=await physicalFence(r,'UN16-partial-mip-completion'),patched=await nativeRead(r,texture,16,p.width,p.height,1);c.same(nativeMisses(16,expected[1],patched),[],'partial UN16 mip preserves adjacent words');row.patches.push({...patch,input:await blob(report,patch.input),wire:hex(wire),fence:patchFence,native:await blob(report,patched)});
   gl.enable(gl.SCISSOR_TEST);gl.scissor(1,1,2,2);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.enable(gl.STENCIL_TEST);gl.stencilMaskSeparate(gl.FRONT,0xb7);gl.stencilMaskSeparate(gl.BACK,0x69);gl.stencilFuncSeparate(gl.FRONT,gl.LESS,37,0x73);gl.stencilFuncSeparate(gl.BACK,gl.GREATER,91,0x9d);gl.colorMask(false,true,false,true);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_SUBTRACT,gl.FUNC_REVERSE_SUBTRACT);
   if(f.bind&8){
    const lease=c.ok(r.store.retainStorage(1,6,'view'),'UN16 sampler lease').lease;
    for(const [first,last]of [[0,f.lastLevel],[1,f.lastLevel],[f.lastLevel,f.lastLevel]]){
     const beforeCapture=budget(r),captured=c.ok(r.imageAccess.capture(lease,first,last),'UN16 original private range'),resolved=c.ok(r.imageAccess.resolve(captured.token),'UN16 native private range'),before=state(r);
     c.ok(r.imageAccess.refresh(captured.token),'UN16 GPU range copy');const after=state(r);c.same(after,before,'UN16 range copy restores exact caller state');
     const view={first,last,beforeCapture,afterCapture:budget(r),metadata:resolved.metadata,generation:captured.generation,texture:r.trace.id(resolved.storage.texture),caller:{before,after},fence:await physicalFence(r,'UN16-private-copy-completion'),planes:[]};row.views.push(view);
     for(let local=0;local<=last-first;local++){const p=src.planes[first+local],raw=await nativeRead(r,resolved.storage.texture,16,p.width,p.height,local);c.same(nativeMisses(16,expected[p.level],raw),[],'UN16 private copy contains every original word');view.planes.push({local,original:p.level,width:p.width,height:p.height,native:await blob(report,raw)});}
     c.ok(r.imageAccess.release(captured.token),'UN16 private range release');view.afterRelease=budget(r);
    }
    const before=state(r),read=c.ok(r.store.readStorage(lease),'native synchronous UN16 lease read').bytes,after=state(r);c.same(before,after,'UN16 lease read restores caller state');c.same(sameBytes(read,expected[0]),true,'UN16 synchronous lease returns canonical original bytes');row.leaseRead={bytes:await blob(report,read),caller:{before,after}};c.ok(r.store.releaseStorage(lease),'UN16 source lease release');
   }else c.same(r.store.retainStorage(1,6,'view').ok,false,'depth-only UN16 refuses sampler lease');
   if(f.bind&1){
    const p=src.planes[1],before=c.ok(r.store.readBacking(6,0,src.backing.length),'UN16 backing before GPU-only clear').bytes;
    const allowedOriginalWords=[Math.floor(.375*65535),Math.ceil(.375*65535)];
    gpuClear(r,texture,1,[.375,0],false);const fence=await physicalFence(r,'UN16-GPU-only-clear-completion'),raw=await nativeRead(r,texture,16,p.width,p.height,1),nativeDepth=new DataView(raw.buffer).getFloat32(0,true),chosenNativeWord=Math.round(nativeDepth*65535),dv=new DataView(expected[1].buffer);
    const point={level:1,depth:.375,allowedOriginalWords,chosenNativeWord,fence,native:await blob(report,raw),backingBefore:await blob(report,before),backingAfter:await blob(report,c.ok(r.store.readBacking(6,0,src.backing.length),'UN16 backing after GPU-only clear').bytes)};row.clears.push(point);
    c.same(allowedOriginalWords.includes(chosenNativeWord),true,'UN16 clear uses one of the two closest original fixed values');for(let i=0;i<p.width*p.height;i++)dv.setUint16(i*2,chosenNativeWord,true);c.same(nativeMisses(16,expected[1],raw),[],'UN16 clear is uniform and inside the specified conversion bound');c.same(sameBytes(before,c.ok(r.store.readBacking(6,0,src.backing.length),'UN16 unchanged CPU backing').bytes),true,'GPU-only UN16 clear leaves guest backing unchanged');
   }else c.same(r.store.retainStorage(1,6,'depth-surface').ok,false,'sampler-only UN16 refuses depth role');
   const staging=new Uint8Array(src.backing.length).fill(0x2e),staged=staging.slice();r.add({id:8,target:0,format:64,bind:524288,width:staging.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},staging);row.stagingBacking=await blob(report,staging);
   for(const p of src.planes){
    const wire=transfer(6,p,2),before=state(r),prepared=c.ok(r.store.prepareTransfer(1,command(wire)),'UN16 synchronous read prepare');r.setLabel('UN16-sync-read-'+p.level);c.ok(r.store.executeTransfer(prepared.ticket),'UN16 native synchronous read');const after=state(r);c.same(after,before,'UN16 native packing restores exact caller state');
    for(let y=0;y<p.height;y++)wanted.set(expected[p.level].subarray(y*p.width*2,(y+1)*p.width*2),p.offset+y*p.stride);
    const backing=c.ok(r.store.readBacking(6,0,src.backing.length),'whole UN16 synchronous backing').bytes;
    const rowRead={level:p.level,wire:hex(wire),backing:await blob(report,backing),caller:{before,after},reads:[]};row.publicReads.push(rowRead);c.same(sameBytes(backing,wanted),true,'exact UN16 synchronous rows and every padding byte');
    for(const opcode of [43,45]){
     const wire=opcode===43?transfer(6,p,2):copyTransfer(6,p,8),before=budget(r),prepared=c.ok(r.asyncAccess.prepareTransfer(2,command(wire)),'UN16 staged read prepare'),afterPrepare=budget(r);
     r.setLabel('UN16-staged-read-'+opcode+'-'+p.level);c.ok(r.asyncAccess.beginTransferRead(prepared.ticket),'UN16 native PBO read');const afterIssue=budget(r),ready=await poll(r,prepared.ticket);c.same(sameBytes(ready.bytes,expected[p.level]),true,'UN16 PBO returns exact canonical bytes');
     for(let y=0;y<p.height;y++)c.ok(r.store.writeBacking(opcode===43?6:8,p.offset+y*p.stride,ready.bytes.subarray(y*prepared.layout.rowBytes,(y+1)*prepared.layout.rowBytes)),'UN16 staged original rows');
     if(opcode===45)for(let y=0;y<p.height;y++)staged.set(expected[p.level].subarray(y*p.width*2,(y+1)*p.width*2),p.offset+y*p.stride);
     const entry={opcode,wire:hex(wire),layout:prepared.layout,before,afterPrepare,afterIssue,afterReady:budget(r),completion:{...r.lastCompletion},bytes:await blob(report,ready.bytes)};rowRead.reads.push(entry);c.ok(r.asyncAccess.release(prepared.ticket),'UN16 staged read release');entry.afterRelease=budget(r);c.same(r.asyncAccess.release(prepared.ticket).ok,false,'UN16 consumed ticket stays closed');
    }
   }
   row.finalBacking=await blob(report,c.ok(r.store.readBacking(6,0,wanted.length),'full UN16 guest backing').bytes);row.finalStagingBacking=await blob(report,c.ok(r.store.readBacking(8,0,staged.length),'full UN16 staging backing').bytes);c.same(sameBytes(c.ok(r.store.readBacking(8,0,staged.length),'staging bytes').bytes,staged),true,'every UN16 staging row and padding byte');c.same(gl.getError(),gl.NO_ERROR,'UN16 transfer matrix has no native errors');
  }finally{await finish(r,report,row);}
 }
 if(!smoke)for(const phase of ['resource','view']){
  const f=source(16,seed^0x12341234,13,7,2),r=rig(gl,bridge,c,f,{nativeFault:'allocation-rollback'}),row={name:'UN16-allocation-'+phase,kind:'allocation-failure',phase,source:f.metadata};report.runs.push(row);
  try{
   const bad=createStandardUnormDepthResourceStore({backend:{...r.backend,unormDepthProfile:'closed'}});row.badProfile=bad;c.same(bad.error.code,'invalid-input','UN16 owner requires its actual selected backend');
   let lease;if(phase==='view'){r.add(f.metadata,f.backing);lease=c.ok(r.store.retainStorage(1,6,'view'),'UN16 source for failed private allocation').lease;}
   row.before=budget(r);r.armFault();row.result=phase==='resource'?r.store.createResource(f.metadata):r.imageAccess.capture(lease,1,2);r.armFault(false);row.after=budget(r);
   c.same(row.result.error.code,'backend-error','failed native UN16 allocation returns explicit error');c.same(row.after,row.before,'failed native UN16 allocation rolls back every reservation');
   if(lease)c.ok(r.store.releaseStorage(lease),'failed private allocation leaves source lease valid');c.same(gl.getError(),gl.NO_ERROR,'native rollback control has no GL error');
  }finally{await finish(r,report,row);}
 }
 if(!smoke)for(const phase of ['resource','view','scratch','staging']){
  const src=source(16,seed^0xabcdef01,13,7,2),cost=src.planes.reduce((n,p)=>n+p.width*p.height*2,0),privateCost=src.planes.slice(1).reduce((n,p)=>n+p.width*p.height*2,0),readCost=src.planes[0].width*src.planes[0].height*4,
   resourceLimits=phase==='scratch'?{scratchBytes:readCost-1}:{gpuBytes:phase==='resource'?cost-1:phase==='view'?cost+privateCost-1:cost+readCost*2-1},r=rig(gl,bridge,c,src,{resourceLimits}),row={name:'UN16-budget-'+phase,kind:'budget-refusal',phase,source:src.metadata,limits:resourceLimits};report.runs.push(row);
  let lease,ticket;
  try{
   if(phase!=='resource')r.add(src.metadata,src.backing);
   if(phase==='view')lease=c.ok(r.store.retainStorage(1,6,'view'),'UN16 constrained sampler lease').lease;
   let input;
   if(['scratch','staging'].includes(phase)){const wire=transfer(6,src.planes[0],2);row.wire=hex(wire);input=c.ok(decodeStandardUnormDepthImageSubmission(wire),'UN16 constrained original read packet').commands[0];}
   if(phase==='staging')ticket=c.ok(r.asyncAccess.prepareTransfer(1,input),'UN16 constrained native read prepare').ticket;
   row.before=budget(r);row.nativeObjectsBefore=r.nativeObjects.length;row.allocationsBefore=r.allocations.length;row.readsBefore=r.readbacks.length;
   row.result=phase==='resource'?r.store.createResource(src.metadata):phase==='view'?r.imageAccess.capture(lease,1,2):phase==='scratch'?r.asyncAccess.prepareTransfer(1,input):r.asyncAccess.beginTransferRead(ticket);
   row.after=budget(r);row.nativeObjectsAfter=r.nativeObjects.length;row.allocationsAfter=r.allocations.length;row.readsAfter=r.readbacks.length;
   c.same(row.result.error.code,'limit-exceeded','UN16 exact constrained byte budget refusal');c.same(row.after,row.before,'UN16 refused budget publishes no reservation');c.same(row.nativeObjectsAfter,row.nativeObjectsBefore,'UN16 refusal occurs before any native object');c.same(row.allocationsAfter,row.allocationsBefore,'UN16 refusal occurs before texture allocation');c.same(row.readsAfter,row.readsBefore,'UN16 refusal occurs before CPU collection');
  }finally{if(ticket)c.ok(r.asyncAccess.release(ticket),'UN16 constrained ticket retires');if(lease)c.ok(r.store.releaseStorage(lease),'UN16 constrained lease retires');await finish(r,report,row);}
 }
 report.status='passed';return report;
}
