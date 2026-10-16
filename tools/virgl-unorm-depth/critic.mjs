// Promoted critic: odd-stride mip subrectangle, stale PBO and retained generation.
import {rig,finish,blob,nativeRead,physicalFence,checks} from '../../renderer/virgl-command/tests/standard-unorm-depth-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {decodeStandardUnormDepthImageSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {source,nativeMisses} from './fixtures.mjs';
import {transfer,copyTransfer,hex} from '../virgl-command/standard-floating-depth-fixtures.mjs';
import {poll} from '../../renderer/virgl-command/tests/standard-floating-depth-rig.mjs';
const staging=(id,length)=>({id,target:0,format:64,bind:524288,width:length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const budgets=r=>({...r.store.inspect().budgets,stagingBytes:r.asyncAccess.inspect().stagingBytes});
export async function runAcceptance({seed=0x510e527f,fault=null}={}){
 if(fault)throw Error('this critic uses the unchanged worker recorder for sabotage');
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={status:'running',mode:'critic-subrectangle',seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardUnormDepthCriticEvidence=report;
 const input=source(16,seed,13,11,3),r=rig(gl,bridge,c,input,{delay:2}),row={kind:'critic-subrectangle',name:'UN16/odd-stride-mip/stale-copy/retained-generation',format:16,source:input.metadata,sourceBacking:await blob(report,input.backing),planes:[]};report.runs.push(row);
 const command=wire=>c.ok(decodeStandardUnormDepthImageSubmission(wire),'original critic transfer packet').commands[0];let lease,view,ticket;
 try{
  const original=r.add(input.metadata,input.backing);row.originalGeneration=original.generation;
  const texture=r.allocations[0].storage.texture;
  for(const p of input.planes){row.planes.push({...p,input:await blob(report,p.input)});const wire=transfer(6,p),prepared=c.ok(r.store.prepareTransfer(1,command(wire)),'critic full original upload');c.ok(r.store.executeTransfer(prepared.ticket),'critic native original upload');}
  row.initialFence=await physicalFence(r,'critic-original-upload-completion');row.originalNative=[];
  for(const p of input.planes){const raw=await nativeRead(r,texture,16,p.width,p.height,p.level);c.same(nativeMisses(16,p.input,raw),[],'critic initial native original words');row.originalNative.push(await blob(report,raw));}
  const patchWords=[0,65535,32768,1,65534,24575,24576,49151,16384],patchInput=new Uint8Array(18),dv=new DataView(patchInput.buffer);patchWords.forEach((word,i)=>dv.setUint16(i*2,word,true));
  const patch={level:1,x:2,y:1,width:3,height:3,stride:7,offset:5},patchBacking=new Uint8Array(32).fill(0x6d);
  for(let y=0;y<3;y++)patchBacking.set(patchInput.subarray(y*6,(y+1)*6),5+y*7);
  r.add(staging(7,patchBacking.length),patchBacking);row.patch={...patch,input:await blob(report,patchInput),backing:await blob(report,patchBacking)};
  const patchWire=copyTransfer(6,patch,7,1);row.patch.wire=hex(patchWire);r.setLabel('critic-odd-stride-original-mip-patch');const prepared=c.ok(r.store.prepareTransfer(2,command(patchWire)),'critic segmented source copy');row.patch.layout=prepared.layout;c.ok(r.store.executeTransfer(prepared.ticket),'critic partial native mip upload');row.patch.fence=await physicalFence(r,'critic-mip-patch-completion');
  const wanted=input.planes[1].input.slice();for(let y=0;y<3;y++)wanted.set(patchInput.subarray(y*6,(y+1)*6),((1+y)*6+2)*2);
  const patched=await nativeRead(r,texture,16,6,5,1);c.same(nativeMisses(16,wanted,patched),[],'critic exact nine words and all adjacent mip words');row.patch.native=await blob(report,patched);
  row.sourceBackingAfterPatch=await blob(report,c.ok(r.store.readBacking(6,0,input.backing.length),'critic original backing after GPU patch').bytes);c.same(row.sourceBackingAfterPatch.sha256,row.sourceBacking.sha256,'GPU-only subrectangle leaves all source backing and padding unchanged');
  lease=c.ok(r.store.retainStorage(1,6,'view'),'critic old generation sampler lease').lease;const capture=c.ok(r.imageAccess.capture(lease,1,2),'critic retained private original range');view=capture.token;row.view={first:1,last:2,generation:capture.generation,metadata:capture.metadata};
  const targetBacking=new Uint8Array(32).fill(0x2e);r.add(staging(8,targetBacking.length),targetBacking);row.stagingBefore=await blob(report,targetBacking);
  const readWire=copyTransfer(6,patch,8,3),read=c.ok(r.asyncAccess.prepareTransfer(1,command(readWire)),'critic pending original strided copy');ticket=read.ticket;row.pending={wire:hex(readWire),description:{resource:read.resource,backingGeneration:read.backingGeneration},layout:read.layout,before:budgets(r)};
  r.setLabel('critic-stale-copy-issued');c.ok(r.asyncAccess.beginTransferRead(ticket),'critic original PBO issue');row.pending.issued=budgets(r);
  c.ok(r.store.unref(6),'critic retire public original source');const replacement=source(126,seed^0xa54ff53a,11,7,2),fresh=r.add(replacement.metadata,replacement.backing);row.replacement={metadata:replacement.metadata,generation:fresh.generation,backing:await blob(report,replacement.backing)};c.same(fresh.generation>original.generation,true,'critic opposite format reuses fresh generation');
  const before=r.readbacks.filter(e=>e.cpu).length;row.pending.refusal=r.asyncAccess.poll(ticket);row.pending.cpuReadsBefore=before;row.pending.cpuReadsAfter=r.readbacks.filter(e=>e.cpu).length;c.same(row.pending.refusal.error.code,'stale-ticket','retired original async source refuses collection');c.same(row.pending.cpuReadsAfter,before,'stale original source rejects before CPU collection');
  await poll(r,ticket,{discard:true});row.pending.discardCompletion={...r.lastCompletion};c.ok(r.asyncAccess.release(ticket),'critic stale native staging retires');ticket=null;row.pending.released=budgets(r);
  row.stagingAfter=await blob(report,c.ok(r.store.readBacking(8,0,32),'critic untouched output staging').bytes);c.same(row.stagingAfter.sha256,row.stagingBefore.sha256,'refused stale copy preserves every destination byte');
  const resolved=c.ok(r.imageAccess.resolve(view),'critic exact retained private texture');row.view.texture=r.trace.id(resolved.storage.texture);row.view.resolvedGeneration=resolved.generation;c.same(resolved.generation,original.generation,'private range remains original generation');c.same(resolved.metadata.format,16,'private range remains original UN16 format');
  c.ok(r.imageAccess.refresh(view),'critic GPU-only retained source refresh');row.view.fence=await physicalFence(r,'critic-old-private-range-copy-completion');row.view.planes=[];
  for(let local=0;local<2;local++){const p=input.planes[local+1],raw=await nativeRead(r,resolved.storage.texture,16,p.width,p.height,local);c.same(nativeMisses(16,local===0?wanted:p.input,raw),[],'critic retained range reads original patched allocation');row.view.planes.push({local,original:p.level,width:p.width,height:p.height,native:await blob(report,raw)});}
  row.replacement.after=await blob(report,c.ok(r.store.readBacking(6,0,replacement.backing.length),'critic full replacement backing').bytes);c.same(row.replacement.after.sha256,row.replacement.backing.sha256,'old private refresh preserves all replacement bytes');
  c.ok(r.imageAccess.release(view),'critic old range retires');view=null;c.ok(r.store.releaseStorage(lease),'critic old sampler lease retires');lease=null;c.same(gl.getError(),gl.NO_ERROR,'critic real native operations have no GL errors');
 }finally{if(ticket)c.ok(r.asyncAccess.release(ticket),'critic outstanding ticket released');if(view)c.ok(r.imageAccess.release(view),'critic outstanding range released');if(lease)c.ok(r.store.releaseStorage(lease),'critic outstanding lease released');await finish(r,report,row);}
 report.status='passed';return report;
}
