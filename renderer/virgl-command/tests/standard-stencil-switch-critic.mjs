// The same original renderer/FBO switches from native S8 to depth-only storage.
import {rig,finish,blob,nativeRead,submit,checks,nativeStencil} from './standard-stencil-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {runWireAcceptance} from './standard-stencil-wire.mjs';
import {specimen,source,positionsFor,setup,packet,join,dsa,refs,face,metadata,surface,textureTransfer,clear,draw,uniformPlane,missWords,bytesPerPixel} from '../../../tools/virgl-stencil/fixtures.mjs';
import {nativeMisses} from '../../../tools/virgl-packed-depth-consumer/fixtures.mjs';
export {runWireAcceptance};
export async function runAcceptance({seed=0x29171111}={}) {
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 if(!gl)throw Error('critic depth-only WebGL2 unavailable');
 const bridge=await createVirglStandardIntegerImageShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'critic-switch',seed,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};window.__standardStencilEvidence=report;
 for(const format of [20,126])for(const replacementFormat of [18,21]) {
  const f=specimen(format,seed,0,{name:`stencil-critic-switch-${format}-to-${replacementFormat}`,depthWrite:true}),r=rig(gl,bridge,c,f,{step:1,delay:3}),row={name:f.name,format,replacementFormat,width:f.width,height:f.height,frames:[],planes:[],replacementPlanes:[],actions:[]};report.runs.push(row);r.blobs=report.blobs;
  const targetBytes=5+f.height*(f.width*16+3)+19,target=r.add(metadata(1,31,f.targetWidth,f.targetHeight,2),new Uint8Array(targetBytes).fill(0x2e));row.targetBackingBytes=targetBytes;
  const positions=positionsFor(0,false);r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);row.positions=await blob(report,positions);
  const original=r.add(f.source.metadata,f.source.backing),originalTexture=r.allocations.find(a=>a.metadata.id===6).storage.texture;row.sourceGeneration=original.generation;row.sourceMetadata=f.source.metadata;row.sourceBacking=await blob(report,f.source.backing);
  for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
  const next=source(replacementFormat,seed^0x927331);next.metadata={...next.metadata,id:8};const replacement=r.add(next.metadata,next.backing),replacementTexture=r.allocations.find(a=>a.metadata.id===8).storage.texture;row.replacementGeneration=replacement.generation;row.replacementMetadata=next.metadata;row.replacementBacking=await blob(report,next.backing);
  for(const p of next.planes)row.replacementPlanes.push({...p,input:await blob(report,p.input)});
  const framebuffer=()=>{const s=gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.STENCIL_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME),z=gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);return {framebuffer:r.trace.id(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),stencil:s===null?null:r.trace.id(s),depth:z===null?null:r.trace.id(z),state:nativeStencil(gl),eventSequence:r.events.at(-1)?.sequence??0};};
  try {
   c.ok((await submit(r,1,join(setup(f),clear(2,149)),'critic-S8-original-clear')).result,'critic original S8 setup/clear');row.before=framebuffer();c.same(row.before.stencil,r.trace.id(originalTexture),'critic actual native S8 attachment');
   const front=face({func:0,valueMask:85,writeMask:170}),back=face({func:0,valueMask:15,writeMask:127});
   const job=await submit(r,1,join(...next.planes.map(p=>textureTransfer(8,p.level,p.width,p.height,p.offset,p.stride)),surface(80,8,replacementFormat,0),packet(5,0,[1,80,20]),clear(4,0,1,f.clearWords),dsa(30,front,back,{depthWrite:true}),refs(13,29),draw(),clear(2,0xffffffff)),'critic-absent-S8-live-switch');
   c.ok(job.result,'critic original asymmetric absent-S8 draw/clear');c.same(job.result.gpuComplete,true,'critic actual live-switch completion');row.switchJob=job;row.after=framebuffer();c.same(row.after.framebuffer,row.before.framebuffer,'critic reuses the same native framebuffer');c.same(row.after.stencil,null,'critic no stale native S8 attachment');c.same(row.after.depth,r.trace.id(replacementTexture),'critic original depth-only attachment');
   const color=uniformPlane(f.width,f.height,f.words),native=await nativeRead(r,r.allocations.find(a=>a.metadata.id===1).storage.texture,31,f.width,f.height,0);row.nativeColor=await blob(report,native);c.same(missWords(native,color),[],'critic every absent-S8 fragment passes');
   c.ok((await submit(r,1,packet(43,0,[1,0,0,f.width*16+3,0,0,0,0,f.width,f.height,1,5,2]),'critic-switch-public-color')).result,'critic complete public color');row.publicColorHistoryIndex=r.history.length-1;const expected=new Uint8Array(targetBytes).fill(0x2e);for(let y=0;y<f.height;y++)expected.set(color.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));const observed=c.ok(r.store.readBacking(1,0,targetBytes),'critic whole color/padding').bytes;row.publicColor=await blob(report,observed);c.same([...observed],[...expected],'critic exact switch color/padding');
   row.nativeDepth=[];for(const p of next.planes){const raw=await nativeRead(r,replacementTexture,replacementFormat,p.width,p.height,p.level);row.nativeDepth.push({level:p.level,width:p.width,height:p.height,native:await blob(report,raw),completion:{...r.lastCompletion}});c.same(nativeMisses(replacementFormat,p.input,raw),[],'critic absent S8 leaves original depth untouched');}
   const old=f.source.planes[0].input.slice();for(let i=0;i<f.width*f.height;i++)old[i*bytesPerPixel(format)+(format===126?4:0)]=149;const nativeOld=await nativeRead(r,originalTexture,format,f.width,f.height,0);row.oldNative=await blob(report,nativeOld);c.same(nativeMisses(format,old,nativeOld),[],'critic switch preserves retained old S8');
   const before=c.ok(r.store.readBacking(8,0,next.backing.length),'critic replacement CPU backing').bytes;row.replacementBeforePublic=await blob(report,before);c.same([...before],[...next.backing],'critic absent-S8 clear leaves complete CPU backing');
   let cursor=next.backing.length-44000;const wanted=next.backing.slice();row.publicDepth=[];
   for(const p of next.planes){const bpp=bytesPerPixel(replacementFormat),stride=p.width*bpp+7,offset=cursor;cursor+=stride*p.height+17;c.ok((await submit(r,1,packet(43,0,[8,p.level,0,stride,0,0,0,0,p.width,p.height,1,offset,2]),'critic-switch-public-depth-'+p.level)).result,'critic absent-S8 public transfer');
    const tight=p.input.slice();if(replacementFormat===21)for(let i=3;i<tight.length;i+=4)tight[i]=0;for(let y=0;y<p.height;y++)wanted.set(tight.subarray(y*p.width*bpp,(y+1)*p.width*bpp),offset+y*stride);const backing=c.ok(r.store.readBacking(8,0,wanted.length),'critic whole depth-only public backing').bytes;row.publicDepth.push({level:p.level,stride,offset,historyIndex:r.history.length-1,backing:await blob(report,backing)});c.same([...backing],[...wanted],'critic every depth-only public byte and padding');
   }
  } finally {await finish(r,report,row);}
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,format:row.format,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};report.predictionCount=(report.predictionCount??0)+row.predictions.length;}
 }
 report.status='passed';return report;
}
