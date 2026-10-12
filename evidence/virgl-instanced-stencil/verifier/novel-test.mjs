// Fresh critic test: original restart, vertex identity and overlapping divisor phases.
import {rig,finish,blob,nativeRead,physicalFence,submit,checks} from './standard-instanced-stencil-rig.mjs';
import {createVirglStandardInstanceBaseShaderBridge} from '../../virgl-shader/standard.mjs';
import {criticFixture} from '../../../tools/virgl-instanced-stencil/critic-fixtures.mjs';
import {setup,state,draw,join,face,dsa,refs,clear,packet} from '../../../tools/virgl-instanced-stencil/fixtures.mjs';
import {model,compare} from '../../../tools/virgl-instanced-stencil/oracle.mjs';
import {metadata} from '../../../tools/virgl-stencil/fixtures.mjs';
export async function runAcceptance({seed=0x510e527f,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 if(!gl)throw Error('actual critic Metal context unavailable');
 if(fault&&fault!=='order')throw Error('critic novel control is completed primitive-major ordering');
 const bridge=await createVirglStandardInstanceBaseShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info');
 const report={status:'running',mode:'critic-novel',seed,fault,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};
 window.__standardInstancedStencilEvidence=report;
 for(const format of fault?[20]:[20,126]){
  const f=criticFixture(format,seed),r=rig(gl,bridge,c,f,{step:1,delay:({ordinal})=>(Math.imul(ordinal+3,seed)>>>0)%9});
  const row={name:f.name,format:f.format,level:f.level,width:f.width,height:f.height,outputLevel:f.outputLevel,
   sourceMetadata:f.source.metadata,sourceBacking:await blob(report,f.source.backing),planes:[],buffers:[],frames:[],failurePhase:null,
   target:metadata(1,31,f.targetWidth,f.targetHeight,f.outputLastLevel)};
  report.runs.push(row);r.blobs=report.blobs;r.outputBackingBytes=Math.max(20000,5+f.height*(f.width*16+3));row.targetBackingBytes=r.outputBackingBytes;
  r.add(row.target,new Uint8Array(r.outputBackingBytes).fill(0x2e));
  for(const [id,raw] of f.buffers){r.add({id,target:0,format:64,bind:0,width:raw.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},raw);row.buffers.push({id,input:await blob(report,raw)});}
  r.add(f.source.metadata,f.source.backing);for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
  try{
   c.ok((await submit(r,1,setup(f),'critic-original-setup')).result,'complete original critic setup');
   c.ok((await submit(r,1,state(f),'critic-original-state')).result,'complete original critic asymmetric state');
   row.before={renderer:r.renderer.inspect(),resources:r.store.inspect(),native:r.nativeOrderedState()};
   if(fault){
    row.baseline=await submit(r,1,join(dsa(33,face({writeMask:0}),face({writeMask:0})),refs(0,0),draw(f),clear(4,0,1,f.clearWords)),'critic-common-baseline');
    c.ok(row.baseline.result,'actual original common baseline completed');row.corruption={before:{...r.lastCompletion}};
    c.ok((await submit(r,1,join(packet(2,3,[30]),refs(f.frontRef,f.backRef)),'critic-original-asymmetric')).result,'restore original asymmetric state after baseline');
   }
   gl.cullFace(gl.FRONT);gl.getExtension('WEBGL_provoking_vertex').provokingVertexWEBGL(0x8e4d);
   const ebo=r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING));row.yields=[];
   row.execution=await submit(r,1,draw(f),'instanced-draw',()=>row.yields.push({renderer:r.renderer.inspect().jobs,native:r.nativeOrderedState(),eventSequence:r.events.at(-1)?.sequence??0}));
   c.ok(row.execution.result,'original seven-instance restart-strip draw completes');
   c.same(row.execution.result.gpuComplete,true,'owned final native completion consumed');
   row.restored=r.nativeOrderedState();row.after={renderer:r.renderer.inspect(),resources:r.store.inspect(),native:row.restored};
   c.same(row.restored.instance.base,0,'zero uint base restored before yield');c.same(row.restored.ebo,ebo,'original EBO restored before yield');
   c.same(r.draws.filter(d=>d.label==='instanced-draw').length,112,'eight original primitives times seven instances times two faces');
   await physicalFence(r,'critic-original-post-drain-native-completion');if(fault)row.corruption.after={...r.lastCompletion};
   const colorTexture=r.allocations.find(a=>a.metadata.id===1).storage.texture,depthTexture=r.allocations.find(a=>a.metadata.id===6).storage.texture;
   const color=await nativeRead(r,colorTexture,31,f.width,f.height,f.outputLevel),depth=await nativeRead(r,depthTexture,f.format,f.width,f.height,f.level);
   const historyIndex=r.history.length-1,original=model(r.history,f.buffers,{format:f.format,width:f.width,height:f.height,input:f.source.planes[f.level].input});
   row.frames.push({historyIndex,prefixPasses:null,completion:{...r.lastCompletion},color:await blob(report,color),depth:await blob(report,depth)});
   row.originalPrimitives=original.primitives;row.originalNativeIds=original.nativeIds;row.originalLowering=original.lowering;
   c.same(original.pixel(8,4).map(v=>({color:v.color,stencil:v.stencil})),[{color:[0.73046875,0.5,-0.4990215301513672,1],stencil:119}],'original-byte pre-recorded center prediction remains exact');
   c.same(compare(original,color,depth,f.width,f.height,f.format),[],'full original critic RGBA/depth/S8 against physical native bodies');
  }finally{await finish(r,report,row);}
  for(const entry of row.orderedIndices)c.same(entry.deleted,true,'single normalized original stream retires once');
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,format:row.format,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};}
 }
 report.status='passed';return report;
}
