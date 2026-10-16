// Fresh-critic regression: alpha-only mixed targets, odd mip ranges and boxed public reads.
import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-packed-normalized-consumer-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {make,positions,ids,metadata,setup,state,draw,read,packet,join,surface,outputFormat,rawValues,normalizedFormat,word} from '../../../tools/virgl-packed-normalized-consumer/fixtures.mjs';
import {imageView} from '../../../tools/virgl-command/standard-image-fixtures.mjs';

export const criticFormats=[[308,31,200,131],[122,31,196,407],[135,31,200,409],[319,31,196,308],[320,31,200,407],[321,31,8,409]];
export const criticMasks=[8,5,10,15];
export async function runAcceptance({seed=0xc73e19b5,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={status:'running',mode:'matrix',seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};
 window.__standardPackedNormalizedConsumerEvidence=report;
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%5;};
 for(const [ordinal,formats]of(fault?[criticFormats[0]]:criticFormats).entries()){
  const words=formats.map((format,slot)=>normalizedFormat(format)?[.125,.875,.375,.25].map(word):format===31?[-1.25,4.5,.125,.375].map(word):rawValues(format,slot));
  const f=make('critic-mixed-alpha-mip-'+ordinal,formats,{outputLevel:1,mask:8,words}),r=rig(gl,bridge,c,f,{delay:jitter,step:1}),row={...f,frames:[],partialReads:[],identityRefusals:[]},targets=[];
  r.blobs=report.blobs;report.runs.push(row);row.profileKeys=[];row.positions=await blob(report,positions);
  for(let slot=0;slot<4;slot++){
   const resource=r.add(metadata(ids[slot],formats[slot],f.targetWidth,f.targetHeight,2,10),new Uint8Array(r.outputBackingBytes).fill(0x2e));
   targets.push({...r.allocations.at(-1),generation:resource.generation,slot});
  }
  r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
  async function capture(kind,record,{sabotage=false}={}){
   c.ok(record.result,'critic original command completion');c.same(record.result.gpuComplete,true,'critic native completion');
   const frame={run:report.runs.length-1,kind,historyIndex:r.history.length-1,label:record.label,completion:{...r.lastCompletion},targets:[]};
   report.frames.push(frame);row.frames.push(report.frames.length-1);
   for(const target of targets){
    if(sabotage&&target.slot===3){
     const before=nativeRead(r,target.storage.texture,target.metadata.format,f.width,f.height,1),words=new Uint32Array(before.buffer).slice();words[0]^=1;
     frame.beforeSabotage=await blob(report,before);frame.originalCompletion={...r.lastCompletion};
     r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);r.traced.bindTexture(gl.TEXTURE_2D,target.storage.texture);
     r.traced.pixelStorei(gl.UNPACK_ALIGNMENT,1);r.traced.pixelStorei(gl.UNPACK_ROW_LENGTH,0);
     r.traced.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);r.traced.pixelStorei(gl.UNPACK_SKIP_ROWS,0);
     r.traced.texSubImage2D(gl.TEXTURE_2D,1,0,0,f.width,f.height,gl.RGBA,gl.UNSIGNED_INT_2_10_10_10_REV,words);
     frame.sabotageCompletion=await physicalFence(r,'critic-completed-packed-native-corruption');
     c.same(frame.sabotageCompletion.sync!==frame.originalCompletion.sync,true,'critic corruption owns a distinct physical fence');
     report.sabotage={fault:'completed-output',slot:3,held:false,completion:{...r.lastCompletion}};
    }
    const t={slot:target.slot,metadata:target.metadata,generation:target.generation,texture:r.trace.id(target.storage.texture),level:1,native:await blob(report,nativeRead(r,target.storage.texture,target.metadata.format,f.width,f.height,1)),planes:[]};
    frame.targets.push(t);
    for(let level=0;level<=2;level++){
     const width=Math.max(1,f.targetWidth>>level),height=Math.max(1,f.targetHeight>>level);
     t.planes.push({level,width,height,native:await blob(report,nativeRead(r,target.storage.texture,target.metadata.format,width,height,level))});
    }
    c.ok((await submit(r,1,read(f,target.slot),record.label+'/public-'+target.slot)).result,'critic original full public transfer');
    t.publicHistory=r.history.length-1;t.backing=await blob(report,c.ok(r.store.readBacking(target.metadata.id,0,r.outputBackingBytes),'critic complete public backing').bytes);
   }
   c.same(gl.getError(),gl.NO_ERROR,'critic real native captures');return frame;
  }
  const originalStringify=JSON.stringify;
  JSON.stringify=function(value,...args){
   const result=Reflect.apply(originalStringify,JSON,[value,...args]);
   if(Array.isArray(value)&&['stage','pair'].includes(value[1]))row.profileKeys.push({label:r.label,key:result,stack:new Error('private translation cache key custody').stack});
   return result;
  };
  try{
   await capture('clear',await submit(r,1,setup(f),'critic-setup-'+ordinal));
   const before=r.events.length;row.refusalBefore={nativeObjects:r.nativeObjects.length,rendererBudgets:r.renderer.inspect().budgets,resourceBudgets:r.store.inspect().budgets};
   for(const [kind,wire]of [['surface',surface(90,ids[0],formats[0]===308?8:308,1)],['view',imageView(91,ids[0],formats[0]===308?8:308,1,2,[3,4,0,5])]]){
    const record=await submit(r,1,wire,'critic-identity-'+kind+'-'+ordinal);c.same(record.result.error.code,'incompatible-resource','native-equivalent alias refuses original format mismatch');row.identityRefusals.push(record);
   }
   row.refusalEventRange=[before,r.events.length];row.refusalAfter={nativeObjects:r.nativeObjects.length,rendererBudgets:r.renderer.inspect().budgets,resourceBudgets:r.store.inspect().budgets};
   c.same(r.events.slice(before).every(e=>['fenceSync','clientWaitSync','deleteSync'].includes(e.name)),true,'identity refusal issues only owned completion fences');
   c.same(row.refusalAfter.nativeObjects,row.refusalBefore.nativeObjects,'identity refusal allocates no native image or renderer object');
   for(const key of ['objects','leases','programs','shaders','samplers'])c.same(row.refusalAfter.rendererBudgets[key],row.refusalBefore.rendererBudgets[key],'identity refusal preserves renderer ownership '+key);
   c.same(row.refusalAfter.resourceBudgets,row.refusalBefore.resourceBudgets,'identity refusal preserves every storage budget');
   for(const [index,mask]of criticMasks.entries()){
    f.mask=mask;c.ok((await submit(r,1,state(f,30+index*2),'critic-mask-'+ordinal+'-'+mask)).result,'critic original mixed mask state');
    await capture('draw',await submit(r,1,draw(),'critic-draw-'+ordinal+'-'+mask),{sabotage:Boolean(fault&&index===criticMasks.length-1)});
    row.cache??=[];row.cache.push(r.renderer.inspect());
   }
   if(!fault){
    for(const target of targets){
     const pixel=outputFormat(target.metadata.format).pixelBytes,width=3,height=2,stride=width*pixel+5;
     const prior=c.ok(r.store.readBacking(target.metadata.id,0,r.outputBackingBytes),'critic pre-box complete backing').bytes;
     const record=await submit(r,1,packet(43,0,[target.metadata.id,1,0,stride,0,2,1,0,width,height,1,7,2]),'critic-box-'+ordinal+'-'+target.slot);
     c.ok(record.result,'critic original odd-stride boxed public transfer');c.same(record.result.gpuComplete,true,'critic boxed physical completion');
     row.partialReads.push({slot:target.slot,frame:row.frames.at(-1),historyIndex:r.history.length-1,before:await blob(report,prior),after:await blob(report,c.ok(r.store.readBacking(target.metadata.id,0,r.outputBackingBytes),'critic post-box complete backing').bytes),completion:{...r.lastCompletion}});
    }
   }
  }finally{JSON.stringify=originalStringify;await finish(r,report,row);}
 }
 if(fault)throw Error('critic physical completed-output mutation retained for unchanged independent inverse');
 report.status='passed';return report;
}
