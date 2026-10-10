import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll} from './standard-float-image-rig.mjs';
import {originalFormats,originalFormat,metadata,source,transfer,copyTransfer,finiteMisses,originalValues,hex} from '../../../tools/virgl-command/standard-float-image-fixtures.mjs';
import {createStandardFloatColorResourceStore,createStandardColorResourceStore,computeStandardFloatColorTransferLayout,computeStandardColorTransferLayout} from '../resources.mjs';
import {decodeStandardColorSubmission} from '../decoder.mjs';
const command=bytes=>{
 const result=decodeStandardColorSubmission(bytes);if(!result.ok)throw Error(result.error.message);return result.commands[0];
};
const nativeBytes=input=>new Uint8Array(new Float32Array(input).buffer);
function publicMisses(format,input,output){
 const expected=originalValues(format,input),actual=originalValues(format,output),native=nativeBytes(actual);return finiteMisses(format,input,native);
}
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const profile of originalFormats){
  const src=source(profile.format,17,9,3,0x17a92),pixelBytes=profile.components*profile.precision/8,nativePixelBytes=(profile.components===3?4:profile.components)*profile.precision/8,physical=src.planes.reduce((n,p)=>n+p.width*p.height*nativePixelBytes,0),logical=src.planes.reduce((n,p)=>n+p.input.length,0);
  const backend={maxTextureSize:16384,colorProfile:'virgl-standard-byte-color-transfers-v1',floatProfile:'virgl-standard-float-color-transfers-v1',allocate:()=>({}),destroy(){},upload(){},readback(){},dispose(){},copyTextureRange(){}};
  const previousBackend={...backend};delete previousBackend.floatProfile;const refused=createStandardFloatColorResourceStore({backend:previousBackend});c.same(refused.ok,false,'historical transfer profile cannot activate float owner');c.same(refused.error.code,'invalid-input','float backend selection requires its own exact host profile');records.push({kind:'backend-profile',format:profile.format,result:refused});
  const owner=c.ok(createStandardFloatColorResourceStore({backend}),'selected synthetic float layout owner').store;
  const historical=c.ok(createStandardColorResourceStore({backend}),'historical byte-only layout owner').store;
  c.same(historical.createResource(src.metadata).ok,false,'historical owner remains closed to float images');
  const result=c.ok(owner.createResource(src.metadata),'original full NPOT float chain').resource;
  c.same(result.byteLength,logical,'complete original logical float bytes');c.same(result.gpuByteLength,physical,'complete native float allocation bytes');
  records.push({kind:'metadata',original:src.metadata,result});
  for(const plane of src.planes)for(const direction of [1,2]){
   const bytes=transfer(6,plane,direction),decoded=command(bytes),selected=c.ok(computeStandardFloatColorTransferLayout(src.metadata,decoded.fields,src.backing.length),'original strided float transfer').layout;
   c.same(computeStandardColorTransferLayout(src.metadata,decoded.fields,src.backing.length).ok,false,'historical float layout inverse remains closed');
   c.same(selected.tightBytes,plane.input.length,'original float tight byte count');c.same(selected.rowBytes,plane.width*pixelBytes,'original logical float row count');
   c.same(selected.scratchBytes,plane.width*plane.height*(direction===2?16:Math.max(pixelBytes,nativePixelBytes)),'complete native float scratch charge');
   c.same(selected.stagingBytes,direction===2?plane.width*plane.height*16:0,'complete native float PBO charge');records.push({kind:'layout',format:profile.format,metadata:src.metadata,wire:hex(bytes),fields:decoded.fields,layout:selected});
  }
  for(const boundary of ['resource-exact','resource-short','gpu-exact','gpu-short']){
   let allocations=0;const limits=boundary.startsWith('resource')?{resourceBytes:Math.max(logical,physical)-(boundary.endsWith('short')?1:0)}:{gpuBytes:physical-(boundary.endsWith('short')?1:0)};
   const bounded=c.ok(createStandardFloatColorResourceStore({backend:{...backend,allocate(){allocations++;return{};}},limits}),'bounded metadata-only float owner').store;
   const result=bounded.createResource(src.metadata);c.same(result.ok,boundary.endsWith('exact'),'original complete float '+boundary);c.same(allocations,boundary.endsWith('exact')?1:0,'one-byte-short rejects before native allocation');records.push({kind:'allocation-limit',boundary,format:profile.format,metadata:src.metadata,limits,result,allocations});c.ok(bounded.dispose(),'synthetic float allocation owner cleanup');
  }
  for(const invalid of [{format:124},{target:3},{bind:0},{bind:1},{depth:2},{arraySize:2},{nrSamples:1},{lastLevel:5},{width:0},{height:0},{width:0xffffffff},{flags:1}]){
   const result=owner.createResource({...src.metadata,id:7,...invalid});c.same(result.ok,false,'strict original float metadata '+JSON.stringify(invalid));records.push({kind:'invalid',metadata:{...src.metadata,id:7,...invalid},result});
  }
  for(const mutation of ['getter','proxy','unknown','prototype']){
   let calls=0,meta={...src.metadata,id:7};
   if(mutation==='getter')Object.defineProperty(meta,'width',{enumerable:true,get(){calls++;return 17;}});
   if(mutation==='proxy')meta=new Proxy(meta,{ownKeys(){calls++;throw Error('hostile float metadata');}});
   if(mutation==='unknown')meta.floatPrecision=16;
   if(mutation==='prototype')meta=Object.create(meta);
   const result=owner.createResource(meta);c.same(result.ok,false,'hostile own float metadata '+mutation);c.same(calls,mutation==='proxy'?1:0,'accessor never executes; proxy refuses once');records.push({kind:'hostile',mutation,result,calls});
  }
  c.ok(owner.dispose(),'synthetic selected float owner cleanup');c.ok(historical.dispose(),'synthetic historical float inverse cleanup');
 }
 return{status:'passed',authority:'wire-and-synthetic-layout-only',records,predictions:c.rows};
}
export async function runAcceptance({smoke=false,fault=null,seed=0x27d031a5,mode='matrix'}={}){
 if(mode==='boundaries')return(await import('./standard-float-image-boundaries.mjs')).runBoundaries({seed});
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),ext=gl.getExtension('WEBGL_debug_renderer_info');
 const report={schema:'original-float-image-storage-v1',status:'running',guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),seed,fault,mode,runs:[],blobs:[],predictions:c.rows};window.__standardFloatImageEvidence=report;
 report.nativeEnums=Object.fromEntries(['R16F','RG16F','RGBA16F','R32F','RG32F','RGBA32F','RED','RG','RGBA','HALF_FLOAT','FLOAT'].map(name=>[name,gl[name]]));
 report.nativeExtensions={EXT_color_buffer_float:Boolean(gl.getExtension('EXT_color_buffer_float')),EXT_render_snorm:Boolean(gl.getExtension('EXT_render_snorm'))};
 const formats=fault?[originalFormat(31)]:originalFormats;let ordinal=0;
 for(const profile of formats)for(const [w,h]of smoke||fault?[[7,5]]:[[17,9],[1,13],[9,1]])for(const truncation of smoke||fault?[0]:[0,1])for(const exceptional of smoke||fault?[false]:[false,true]){
  const src=source(profile.format,w,h,Math.max(0,Math.floor(Math.log2(Math.max(w,h)))-truncation),(seed+ordinal++)>>>0,{exceptional}),r=rig(gl,c,{delay:ordinal%3,fault});
  const row={seed:src.seed,metadata:src.metadata,exceptional,backing:await blob(report,src.backing),planes:[],views:[],transfers:[]};report.runs.push(row);
  for(const plane of src.planes)row.planes.push({...plane,input:await blob(report,plane.input)});
  try{
   const callerMetadata={...src.metadata},original=add(r,callerMetadata,src.backing),texture=r.allocations[0].storage.texture;row.generation=original.generation;
   callerMetadata.width=999;c.same(original.width,src.metadata.width,'owned original float metadata is immutable');
   for(const plane of src.planes){
    r.setLabel('original-float-upload-'+plane.level);const wire=transfer(6,plane),decoded=command(wire),prepared=c.ok(r.asyncAccess.prepareTransfer(1,decoded),'owned original async float upload');
    const input=plane.input.slice();c.ok(r.asyncAccess.provideInput(prepared.ticket,input),'owned original float input');input.fill(255);
    c.ok(r.asyncAccess.upload(prepared.ticket),'native original float upload');c.ok(r.asyncAccess.release(prepared.ticket),'release owned float upload');r.operations.push({label:r.label,wire:hex(wire),layout:prepared.layout,budgets:r.store.inspect().budgets});
   }
   const final=await physicalFence(r,'original-float-upload-completion');row.uploadFence=final;
   for(const plane of src.planes){
    const raw=nativeRead(gl,texture,plane.width,plane.height,plane.level),miss=finiteMisses(profile.format,plane.input,raw),observation={level:plane.level,width:plane.width,height:plane.height,texture:r.trace.id(texture),native:await blob(report,raw),misses:miss.slice(0,8)};row.planes[plane.level].observed=observation;
    if(fault)report.sabotage={fault,fence:final,fenceCompleted:true,held:miss.length===0,misses:miss.slice(0,8),observation};
    c.same(miss.slice(0,8),[],'independent original float plane after physical fence');
   }
   const lease=c.ok(r.store.retainStorage(1,6,'view'),'original float source lease').lease,last=src.metadata.lastLevel;
   for(const[firstLevel,lastLevel]of [[0,last],[Math.min(1,last),last],[last,last]]){
    const captured=c.ok(r.imageAccess.capture(lease,firstLevel,lastLevel),'native original float image range'),resolved=c.ok(r.imageAccess.resolve(captured.token),'owned original float view'),view={firstLevel,lastLevel,metadata:resolved.metadata,generation:resolved.generation,texture:r.trace.id(resolved.storage.texture),planes:[]};row.views.push(view);
    c.ok(r.imageAccess.refresh(captured.token),'native original float range copy');const fence=await physicalFence(r,'original-float-range-copy');view.fence=fence;
    for(let local=0;local<=lastLevel-firstLevel;local++){
     const plane=src.planes[firstLevel+local],raw=nativeRead(gl,resolved.storage.texture,plane.width,plane.height,local),miss=finiteMisses(profile.format,plane.input,raw),observation={local,original:plane.level,width:plane.width,height:plane.height,native:await blob(report,raw)};view.planes.push(observation);if(fault&&miss.length)report.sabotage={fault,fence,fenceCompleted:true,held:false,misses:miss.slice(0,8),observation};c.same(miss.slice(0,8),[],'complete original native float retained range');
    }
    c.ok(r.imageAccess.release(captured.token),'release original float view');
   }
   c.ok(r.store.releaseStorage(lease),'release original float source lease');
   const staging=new Uint8Array(src.backing.length).fill(0x2e);add(r,{id:8,target:0,format:64,bind:524288,width:staging.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},staging);row.stagingBacking=await blob(report,staging);
   for(const plane of src.planes){
    const wire=transfer(6,plane,2),decoded=command(wire),prepared=c.ok(r.store.prepareTransfer(1,decoded),'synchronous original float transfer');r.setLabel('original-float-sync-read-'+plane.level);c.ok(r.store.executeTransfer(prepared.ticket),'synchronous native float read');
    const rows=[];for(let y=0;y<plane.height;y++)rows.push(c.ok(r.store.readBacking(6,plane.offset+y*plane.stride,plane.width*profile.components*profile.precision/8),'complete public float row').bytes);
    const sync=new Uint8Array(plane.input.length);let at=0;for(const bytes of rows){sync.set(bytes,at);at+=bytes.length;}c.same(publicMisses(profile.format,plane.input,sync).slice(0,8),[],'original public synchronous float values');
    const reads=[];for(const opcode of[43,45]){
     const readWire=opcode===43?wire:copyTransfer(6,plane,8),request=c.ok(r.asyncAccess.prepareTransfer(1,command(readWire)),'original staged float read');r.setLabel('original-float-staged-'+opcode+'-'+plane.level);c.ok(r.asyncAccess.beginTransferRead(request.ticket),'issue actual original float PBO');const result=await poll(r,request.ticket),fence=r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);c.same(publicMisses(profile.format,plane.input,result.bytes).slice(0,8),[],'original public staged float values');
     const id=opcode===43?6:8;for(let y=0;y<plane.height;y++)c.ok(r.store.writeBacking(id,plane.offset+y*plane.stride,result.bytes.subarray(y*request.layout.rowBytes,(y+1)*request.layout.rowBytes)),'owned float output rows');
     reads.push({opcode,wire:hex(readWire),layout:request.layout,resource:request.resource,backingGeneration:request.backingGeneration,fence,nativeBytes:await blob(report,result.bytes)});c.ok(r.asyncAccess.release(request.ticket),'release physical float readback');c.same(r.asyncAccess.release(request.ticket).ok,false,'consumed float ticket refuses');
    }
    row.transfers.push({level:plane.level,wire:hex(wire),sync:await blob(report,sync),reads});
   }
   row.finalBacking=await blob(report,c.ok(r.store.readBacking(6,0,src.backing.length),'complete original float backing custody').bytes);row.finalStagingBacking=await blob(report,c.ok(r.store.readBacking(8,0,staging.length),'complete staged float backing custody').bytes);
   c.same(gl.getError(),gl.NO_ERROR,'complete native float matrix has no GL errors');
  }finally{await finish(r,report,row);}
 }
 report.status='passed';return report;
}
