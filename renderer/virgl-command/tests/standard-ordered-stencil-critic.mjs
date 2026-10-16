// Fresh D45 critic: original restart/tail packet, noncommuting face operations,
// and fixed strict-interior predictions written before any native capture.
import {rig,finish,blob,nativeRead,submit,checks} from './standard-ordered-stencil-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {fixture,setup,state,draw,packet,join,face,clear,dsa,refs} from '../../../tools/virgl-ordered-stencil/fixtures.mjs';
import {model,compare} from '../../../tools/virgl-ordered-stencil/oracle.mjs';
import {metadata} from '../../../tools/virgl-stencil/fixtures.mjs';
import {nativeMisses} from '../../../tools/virgl-packed-depth-consumer/fixtures.mjs';

const ids=[37,37,4099,701,9031,4099,9031,701,4099,701,9031,4099,9031,701,
 37,4099,701,9031,4099,9031,701,4099,701,9031,4099,9031,701,37,4099,701];
const originalPrimitives=Array.from({length:8},(_,i)=>i%2?[4099,9031,701]:[4099,701,9031]);
const transitions=[93,94,187,186,95,68,161,160,69];
export async function runAcceptance({seed=0x243f6a88,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 if(!gl)throw Error('fresh ordered critic actual WebGL2 unavailable');
 if(fault&&fault!=='order')throw Error('fresh ordered critic only serves native order corruption');
 const bridge=await createVirglStandardIntegerImageShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'critic-ordered',seed,fault,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};
 window.__standardOrderedStencilEvidence=report;
 for(const format of [20,126])for(const step of [1,64]){
  const f=fixture({format,seed,ordinal:0,mode:4,indexSize:4,indexOffset:12,instances:0,ids,restartIndex:37,level:1,outputLevel:1,frontCcw:false,scissor:false,cull:false,
   front:face({func:1,fail:6,zfail:2,zpass:5,valueMask:95,writeMask:91}),
   back:face({func:5,fail:2,zfail:4,zpass:7,valueMask:213,writeMask:229}),frontRef:211,backRef:39,
   name:`fresh-ordered-${format}/step${step}/restart-tail-noncommuting`});
  const p=f.source.planes[f.level],v=new DataView(p.input.buffer);
  for(let i=0;i<p.width*p.height;i++)if(format===20)v.setUint32(i*4,(Math.round(.75*0xffffff)<<8)|93,true);else{v.setFloat32(i*8,.75,true);p.input[i*8+4]=93;}
  for(const plane of f.source.planes)for(let y=0;y<plane.height;y++)f.source.backing.set(plane.input.subarray(y*plane.width*(format===126?8:4),(y+1)*plane.width*(format===126?8:4)),plane.offset+y*plane.stride);
  const r=rig(gl,bridge,c,f,{step,delay:({ordinal})=>(Math.imul(ordinal+1,2654435761)^seed)>>>0&7}),row={name:f.name,format,level:f.level,width:f.width,height:f.height,outputLevel:f.outputLevel,sourceMetadata:f.source.metadata,sourceBacking:await blob(report,f.source.backing),planes:[],buffers:[],frames:[],target:metadata(1,31,f.targetWidth,f.targetHeight,f.outputLastLevel),handPrediction:{sourceWords:30,primitiveIds:originalPrimitives,faces:[0,1,0,1,0,1,0,1],provoking:originalPrimitives.map(p=>p[2]),transitions,originalS8:69,groupedS8:71,witness:{x:14,y:4},color:[.55078125,0,.75,1],normalizedBytes:96,nativeVertexWork:48,nativeDrawCalls:16}};
  report.runs.push(row);r.blobs=report.blobs;row.targetBackingBytes=r.outputBackingBytes=20000;
  r.add(row.target,new Uint8Array(r.outputBackingBytes).fill(0x2e));
  for(const [id,raw]of f.buffers){r.add({id,target:0,format:64,bind:0,width:raw.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},raw);row.buffers.push({id,input:await blob(report,raw)});}
  r.add(f.source.metadata,f.source.backing);for(const plane of f.source.planes)row.planes.push({...plane,input:await blob(report,plane.input)});
  try{
   c.ok((await submit(r,1,setup(f),'ordered-setup')).result,'fresh original compiler/vertex/index/mip setup');
   c.ok((await submit(r,1,state(f),'ordered-state')).result,'fresh original unequal state');
   // A physically completed common-field baseline is outside the split loop.
   // The served mutant cannot claim a pre-draw refusal as a control result.
   const common={...f,front:face({writeMask:0}),back:face({writeMask:0}),frontRef:0,backRef:0};
   row.baseline=await submit(r,1,join(dsa(32,common.front,common.back,common),refs(0,0),draw(f),clear(6,93,.75,f.clearWords)),'fresh-original-common-baseline');
   c.ok(row.baseline.result,'fresh completed common-field baseline');c.same(row.baseline.result.gpuComplete,true,'fresh baseline physically consumed');
   row.corruption={before:{...r.lastCompletion}};
   c.ok((await submit(r,1,join(packet(2,3,[30]),refs(f.frontRef,f.backRef)),'fresh-original-asymmetric-state')).result,'fresh asymmetric state after baseline');
   const originalEbo=r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING));
   gl.cullFace(gl.FRONT);gl.getExtension('WEBGL_provoking_vertex').provokingVertexWEBGL(0x8e4d);
   row.peaks=[];row.execution=await submit(r,1,draw(f),'ordered-draw',()=>row.peaks.push({...r.renderer.inspect().jobs}));
   c.ok(row.execution.result,'fresh actual ordered original packet');c.same(row.execution.result.gpuComplete,true,'fresh native draw completion consumed');
   row.corruption.after={...r.lastCompletion};row.restored=r.nativeOrderedState();
   c.same(row.restored.ebo,originalEbo,'fresh EBO detached/restored before later turn');
   c.same(row.restored.cull,false,'fresh literal no-cull restored');c.same(row.restored.cullFace,gl.BACK,'fresh supported BACK selection restored');
   c.same(row.peaks.every(p=>p.normalizationScratchBytes===0&&p.normalizedBytes<=360&&p.normalizedBuffers<=64),true,'fresh scratch detached and original-word charge held');
   const colorTexture=r.allocations.find(a=>a.metadata.id===1).storage.texture,depthTexture=r.allocations.find(a=>a.metadata.id===6).storage.texture,
    color=await nativeRead(r,colorTexture,31,f.width,f.height,f.outputLevel),depth=await nativeRead(r,depthTexture,format,f.width,f.height,f.level),
    original=model(r.history,f.buffers,{format,width:f.width,height:f.height,input:p.input,clearWords:f.clearWords});
   row.frames.push({historyIndex:r.history.length-1,completion:{...r.lastCompletion},color:await blob(report,color),depth:await blob(report,depth)});
   row.originalPrimitives=original.primitives;row.originalNativeIds=original.nativeIds;row.originalLowering=original.lowering;
   const i=4*f.width+14,cv=new DataView(color.buffer),observed={s8:depth[f.width*f.height*16+i*4],color:Array.from({length:4},(_,k)=>cv.getFloat32(i*16+k*4,true))};row.handObserved=observed;
   c.same(observed,{s8:69,color:[.55078125,0,.75,1]},'fresh unchanged hand prediction at strict-interior sample');
   c.same(original.primitives,originalPrimitives,'fresh independent original restart/tail assembly');
   c.same(compare(original,color,depth,f.width,f.height,format),[],'fresh complete original inverse after hand prediction');
   for(const plane of f.source.planes)if(plane.level!==f.level){const raw=await nativeRead(r,depthTexture,format,plane.width,plane.height,plane.level);row.frames[0].otherMips??=[];row.frames[0].otherMips.push({level:plane.level,native:await blob(report,raw)});c.same(nativeMisses(format,plane.input,raw),[],'fresh unaffected whole mip');}
   c.ok((await submit(r,1,packet(43,0,[1,f.outputLevel,0,f.width*16+3,0,0,0,0,f.width,f.height,1,5,2]),'ordered-public-color')).result,'fresh explicit public output');
   const publicColor=c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'fresh complete public backing').bytes,wanted=new Uint8Array(r.outputBackingBytes).fill(0x2e);
   for(let y=0;y<f.height;y++)wanted.set(color.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));
   c.same([...publicColor],[...wanted],'fresh exact output and every public padding byte');row.frames[0].publicColor=await blob(report,publicColor);
   const backing=c.ok(r.store.readBacking(6,0,f.source.backing.length),'fresh source backing').bytes;row.sourceBeforePublic=await blob(report,backing);c.same([...backing],[...f.source.backing],'fresh ordered native writes preserve complete original public source');
   row.finalNative=r.nativeOrderedState();
  }finally{await finish(r,report,row);}
  row.predictions=c.rows.splice(0);
  if(window.__recordPackedConsumerRun){const index=report.runs.indexOf(row);report.runs[index]={name:row.name,format:row.format,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};}
 }
 report.status='passed';return report;
}
