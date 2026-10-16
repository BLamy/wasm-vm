import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll} from './standard-packed-depth-rig.mjs';
import {source,originalFormats,transfer,hex,nativeMisses,publicMisses} from '../../../tools/virgl-packed-depth/fixtures.mjs';
import {command} from './standard-integer-images.mjs';
export async function runDomain({seed=0x31d075a9,smoke=false}={}) {
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),ext=gl.getExtension('WEBGL_debug_renderer_info');
 const report={schema:'original-packed-depth-full-domain-v1',status:'running',seed,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),runs:[],blobs:[],predictions:c.rows};window.__standardPackedDepthEvidence=report;
 for(const f of originalFormats)for(let domainStart=0;domainStart<(smoke?262144:16777216);domainStart+=262144) {
  const src=source(f.originalFormat,512,512,0,seed^domainStart,{domainStart}),p=src.planes[0],r=rig(gl,c,{delay:domainStart%3}),row={kind:'domain',domainStart,metadata:src.metadata,seed:src.seed,backing:await blob(report,src.backing),input:await blob(report,p.input),plane:{level:0,width:512,height:512,stride:p.stride,offset:p.offset}};report.runs.push(row);
  try {
   add(r,src.metadata,src.backing);r.setLabel('original-packed-depth-domain-upload');const wire=transfer(6,p),request=c.ok(r.store.prepareTransfer(1,command(wire)),'domain original segmented upload');row.upload={wire:hex(wire),layout:request.layout};c.ok(r.store.executeTransfer(request.ticket),'domain native upload');row.uploadFence=await physicalFence(r,'domain-upload-completion');
   // The large domain uses an independent integer-lane depth diagnostic.
   // Full S8 is independently checked on small matrices with exhaustive EQUAL
   // references; domain S8 is checked exactly in both actual public streams.
   const native=await nativeRead(r,r.allocations[0].storage.texture,512,512,0,false);row.native=await blob(report,native);row.depthOnlyDiagnostic=true;c.same(nativeMisses(f.originalFormat,p.input,native,{depthOnly:true}),[],'complete domain native FLOAT values and exact diagnostic lanes');
   const lease=c.ok(r.store.retainStorage(1,6,'readback'),'domain native read lease').lease;r.setLabel('original-packed-depth-domain-sync-read');const sync=c.ok(r.store.readStorage(lease,{x:0,y:0,z:0,width:512,height:512,depth:1}),'domain synchronous native packing').bytes;row.sync=await blob(report,sync);c.same(publicMisses(f.originalFormat,p.input,sync),[],'all original domain public words');
   r.setLabel('original-packed-depth-domain-PBO-read');const read=c.ok(r.asyncAccess.beginStorageRead(lease,{x:0,y:0,z:0,width:512,height:512,depth:1}),'domain native PBO packing'),ready=await poll(r,read.ticket);row.async=await blob(report,ready.bytes);row.fence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.same(publicMisses(f.originalFormat,p.input,ready.bytes),[],'all original domain asynchronous public words');c.ok(r.asyncAccess.release(read.ticket),'release domain read');c.ok(r.store.releaseStorage(lease),'release domain native lease');
  }finally{
   await finish(r,report,row);
   if(window.__recordPackedDepthBlob)for(const body of report.blobs)if(body.gzipBase64){body.path=await window.__recordPackedDepthBlob(body);delete body.gzipBase64;}
   document.querySelector('#status').textContent='Recorded '+report.runs.length+' of '+(smoke?2:128)+' complete original UN24 chunks';
  }
 }
 report.status='passed';return report;
}
