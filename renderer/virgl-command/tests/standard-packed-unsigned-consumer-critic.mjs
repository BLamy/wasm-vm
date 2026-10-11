// Promoted fresh-critic attack: partial mixed outputs at a retained nonzero mip.
import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-packed-unsigned-consumer-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {make,positions,ids,metadata,setup,state,draw,read,initial,update,miss,word} from '../../../tools/virgl-packed-unsigned-consumer/fixtures.mjs';

export async function runAcceptance({seed=0x510e527f,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 const bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const f=make('critic-mixed-alias-partial-output-generation',[225,31,200,253],{
  outputLevel:1,emitted:[1,3],mask:5,scissored:true,blendEnabled:true,source:7,destination:8,
  clearWords:[.125,.25,.5,.75].map(word),
  words:[[99,98,97,1],[-.25,2.5,.25,.75].map(word),[7,8,9,10],[17,0xffffffff,683,0xffffffff]]
 });
 const report={status:'running',mode:'critic',seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};
 window.__standardPackedUnsignedConsumerEvidence=report;
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 const r=rig(gl,bridge,c,f,{delay:jitter,step:1}),row={...f,kind:'critic-partial-generation',frames:[],actions:[]},targets=[],planes=initial(f);
 r.blobs=report.blobs;report.runs.push(row);row.positions=await blob(report,positions);
 for(let slot=0;slot<4;slot++){
  r.add(metadata(ids[slot],f.formats[slot],f.targetWidth,f.targetHeight,f.outputLastLevel,10),new Uint8Array(r.outputBackingBytes).fill(0x2e));
  targets.push({...r.allocations.at(-1),slot});
 }
 r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
 let reused=false;
 async function capture(kind,record,ctx,{sabotaged=false}={}){
  c.ok(record.result,'critic original command completes');c.same(record.result.gpuComplete,true,'critic exact native completion');
  if(!sabotaged)update(f,planes,kind);
  const frame={run:0,kind,historyIndex:r.history.indexOf(record),label:record.label,ctx,reused,sabotaged,completion:{...r.lastCompletion},targets:[]};
  report.frames.push(frame);row.frames.push(report.frames.length-1);
  for(const target of targets){
   const native=nativeRead(r,target.storage.texture,target.metadata.format,f.width,f.height,f.outputLevel);
   const captured={slot:target.slot,metadata:target.metadata,generation:target.generation,texture:r.trace.id(target.storage.texture),level:f.outputLevel,native:await blob(report,native),planes:[]};
   frame.targets.push(captured);
   for(let level=0;level<=f.outputLastLevel;level++){
    const width=Math.max(1,f.targetWidth>>level),height=Math.max(1,f.targetHeight>>level);
    captured.planes.push({level,width,height,native:await blob(report,nativeRead(r,target.storage.texture,target.metadata.format,width,height,level))});
   }
   if(!reused){
    const transfer=await submit(r,ctx,read(f,target.slot),record.label+'/public-'+target.slot);c.ok(transfer.result,'critic complete public original transfer');
    captured.publicHistory=r.history.length-1;captured.backing=await blob(report,c.ok(r.store.readBacking(target.metadata.id,0,r.outputBackingBytes),'critic original backing').bytes);
   }
   const differences=miss(native,planes[target.slot],target.metadata.format);
   if(differences.length&&sabotaged)report.sabotage={fault:'completed-output',held:false,slot:target.slot,miss:differences,originalCompletion:row.control.originalCompletion,sabotageCompletion:row.control.sabotageCompletion};
   c.same(differences,[],'critic entire independent mixed-target precheck '+target.slot);
  }
  c.same(gl.getError(),gl.NO_ERROR,'critic diagnostic native capture');return frame;
 }
 try{
  await capture('clear',await submit(r,1,setup(f),'critic/context1-setup'),1);
  c.ok((await submit(r,1,state(f),'critic/context1-state')).result,'critic masked scissor/blend state');
  await capture('draw',await submit(r,1,draw(),'critic/context1-first'),1);
  await capture('draw',await submit(r,1,draw(),'critic/context1-warm'),1);
  const oldProgram=r.draws.at(-1).native.program;
  await capture('clear',await submit(r,2,setup(f),'critic/context2-setup'),2);
  c.ok((await submit(r,2,state(f),'critic/context2-state')).result,'critic second original context state');
  await capture('draw',await submit(r,2,draw(),'critic/context2-first'),2);
  c.same(r.draws.at(-1).native.program!==oldProgram,true,'critic contexts have independent native program identity');
  const reusePoint={kind:'critic-mixed-alias-id-reuse',beforeHistory:r.history.length,replacements:[]};
  for(const slot of [0,3]){
   c.ok(r.store.unref(ids[slot]),'critic retire packed target resource name');
   const replacementFormat=f.formats[slot]===225?253:225,replacement=r.add(metadata(ids[slot],replacementFormat,9,3,0,10),new Uint8Array(r.outputBackingBytes).fill(0x71));
   const allocation=r.allocations.at(-1);c.same(replacement.generation>targets[slot].generation,true,'critic replacement generation increases');
   reusePoint.replacements.push({slot,oldGeneration:targets[slot].generation,newGeneration:replacement.generation,metadata:allocation.metadata,texture:r.trace.id(allocation.storage.texture),backing:await blob(report,c.ok(r.store.readBacking(ids[slot],0,r.outputBackingBytes),'critic replacement initial backing').bytes)});
  }
  row.actions.push(reusePoint);reused=true;
  await capture('draw',await submit(r,1,draw(),'critic/context1-retained'),1);
  c.same(r.draws.at(-1).native.program,oldProgram,'critic original program survives mixed-alias name replacement');
  await capture('draw',await submit(r,2,draw(),'critic/context2-retained'),2);
  c.ok(r.renderer.resetCaches(),'critic retained original cache eviction');c.ok(r.renderer.restoreContext(1),'critic retained original context restoration');
  const record=await submit(r,1,draw(),'critic/retained-restored');await capture('draw',record,1);
  for(const replacement of reusePoint.replacements){
   const after=c.ok(r.store.readBacking(replacement.metadata.id,0,r.outputBackingBytes),'critic replacement final backing').bytes;
   c.same(after.every(b=>b===0x71),true,'critic complete replacement backing remains untouched');replacement.backingAfter=await blob(report,after);
  }
  if(fault==='completed-output'){
   const texture=targets[3].storage.texture,before=nativeRead(r,texture,253,f.width,f.height,f.outputLevel),lanes=new Uint32Array(before.buffer,before.byteOffset,before.byteLength/4),packed=new Uint32Array(f.width*f.height);
   for(let pixel=0;pixel<packed.length;pixel++)for(let lane=0;lane<4;lane++)packed[pixel]|=lanes[pixel*4+lane]<<[0,10,20,30][lane];
   const changedPixel=f.width+1;packed[changedPixel]^=1;
   row.control={targetSlot:3,pixel:changedPixel,lane:0,before:await blob(report,before),originalCompletion:{...r.lastCompletion}};
   r.setLabel('critic/actual-completed-native-corruption');r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);r.traced.bindTexture(gl.TEXTURE_2D,texture);
   r.traced.pixelStorei(gl.UNPACK_ALIGNMENT,1);r.traced.pixelStorei(gl.UNPACK_ROW_LENGTH,0);
   r.traced.texSubImage2D(gl.TEXTURE_2D,f.outputLevel,0,0,f.width,f.height,gl.RGBA_INTEGER,gl.UNSIGNED_INT_2_10_10_10_REV,packed);
   row.control.sabotageCompletion={...await physicalFence(r,'critic/distinct-second-native-fence')};
   c.same(row.control.originalCompletion.sync!==row.control.sabotageCompletion.sync,true,'critic corruption requires distinct physical fence');
   await capture('draw',record,1,{sabotaged:true});
  }
 }finally{await finish(r,report,row);}
 report.status='passed';return report;
}
