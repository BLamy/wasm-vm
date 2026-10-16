// Fresh critic: inclusive mip feedback is physical-generation identity, including
// an opposite-format public-name reuse. Product and worker harness stay unchanged.
import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-floating-depth-consumer-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {sampleCases,setupSample,viewsSample,readOutput,draw,sampleValue,floatWords,uniformPlane,missWords,metadata,positions,
 packet,join,surface,source,depthClear,nativeMisses} from '../../../tools/virgl-floating-depth-consumer/fixtures.mjs';
export async function runAcceptance({seed=0x5be0cd19,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),
  bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),
  report={schema:'fresh-floating-depth-retained-inclusive-endpoint-v1',status:'running',mode:'novel',seed,fault,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};
 window.__standardFloatingDepthConsumerEvidence=report;
 const f=sampleCases({smoke:true,seed}).find(f=>f.format===126&&f.stage==='vertex');
 Object.assign(f,{name:'retained-combined-depth/inclusive-last-mip/opposite-format-reuse',firstLevel:1,lastLevel:2,slot:15,swizzle:[0,3,4,0],outputLevel:2,outputLastLevel:2,targetWidth:9,targetHeight:7,width:2,height:1});
 f.vertex=f.vertex.replaceAll('SAMP[0]','SAMP[15]').replaceAll('SVIEW[0]','SVIEW[15]');
 const r=rig(gl,bridge,c,f,{delay:2,step:1}),row={name:f.name,kind:f.kind,format:f.format,stage:f.stage,opcode:f.opcode,slot:f.slot,range:[f.firstLevel,f.lastLevel],swizzle:f.swizzle,lod:f.lod,coord:f.coord,linear:f.linear,parameters:f.parameters,width:f.width,height:f.height,vertex:f.vertex,fragment:f.fragment,source:f.source.metadata,outputLevel:f.outputLevel,outputLastLevel:f.outputLastLevel,outputFormat:f.outputFormat,clearWords:f.clearWords,planes:[],frames:[],actions:[],boundaries:[],clearEvents:[]};
 r.blobs=report.blobs;report.runs.push(row);
 r.add(metadata(1,31,f.targetWidth,f.targetHeight,f.outputLastLevel),new Uint8Array(r.outputBackingBytes).fill(0x2e));const target=r.allocations.at(-1);
 r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
 const original=r.add(f.source.metadata,f.source.backing),sourceTexture=r.allocations.at(-1).storage.texture;
 row.sourceGeneration=original.generation;row.sourceBacking=await blob(report,f.source.backing);row.positions=await blob(report,positions);row.target=target.metadata;
 for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
 async function capture(record,kind='draw'){
  c.ok(record.result,'retained original draw');c.same(record.result.gpuComplete,true,'real physical completion');
  const expected=kind==='clear'?uniformPlane(f.width,f.height,f.clearWords):uniformPlane(f.width,f.height,floatWords(sampleValue(f))),
   frame={run:0,kind,completion:{...r.lastCompletion},historyIndex:r.history.length-1,native:await blob(report,await nativeRead(r,target.storage.texture,31,f.width,f.height,f.outputLevel)),outputs:[],bindings:[],depths:[]};
  row.frames.push(report.frames.length);report.frames.push(frame);
  c.same(missWords(await nativeRead(r,target.storage.texture,31,f.width,f.height,f.outputLevel),expected),[],'unchanged full original native color inverse');
  for(let level=0;level<=f.outputLastLevel;level++){
   const width=Math.max(1,f.targetWidth>>level),height=Math.max(1,f.targetHeight>>level),raw=await nativeRead(r,target.storage.texture,31,width,height,level);
   frame.outputs.push({level,width,height,native:await blob(report,raw)});c.same(missWords(raw,level===f.outputLevel?expected:uniformPlane(width,height,[0,0,0,0])),[],'every untouched output mip');
  }
  c.ok((await submit(r,1,readOutput(f),record.label+'/public')).result,'original public output');frame.publicHistory=r.history.length-1;
  const backing=c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'original full output backing').bytes,wanted=new Uint8Array(r.outputBackingBytes).fill(0x2e);
  for(let y=0;y<f.height;y++)wanted.set(expected.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));
  frame.backing=await blob(report,backing);c.same([...backing],[...wanted],'unchanged original public words and all padding');return frame;
 }
 async function depths(frame,texture,first,last,label){
  const entry={texture:r.trace.id(texture),planes:[]};frame[label].push(entry);
  for(let originalLevel=first;originalLevel<=last;originalLevel++){
   const p=f.source.planes[originalLevel],local=originalLevel-first,raw=await nativeRead(r,texture,126,p.width,p.height,local),entryPlane={original:originalLevel,local,width:p.width,height:p.height,completion:{...r.lastCompletion},native:await blob(report,raw)};
   entry.planes.push(entryPlane);const misses=nativeMisses(126,p.input,raw);
   if(misses.length)report.sabotage={fault,held:false,miss:misses,completion:entryPlane.completion};
   c.same(misses,[],'unchanged full retained native depth and stencil inverse');
  }
 }
 async function sampledDepths(frame){
  const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0+31);const sampled=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.activeTexture(active);
  c.same(r.allocations.some(a=>a.storage.texture===sampled&&a.metadata.id===6&&a.metadata.format===126),true,'old generation private depth sampler');
  await depths(frame,sampled,1,2,'bindings');await depths(frame,sourceTexture,0,4,'depths');
 }
 try{
  await capture(await submit(r,1,setupSample(f),'critic-original-setup'),'clear');
  c.ok((await submit(r,1,viewsSample(f),'critic-original-private-view')).result,'original private view');
  r.add(metadata(8,31,4,2),new Uint8Array(r.outputBackingBytes));
  c.ok((await submit(r,1,join(surface(83,6,126,3),surface(84,6,126,2),surface(85,8,31,0),packet(5,0,[1,83,20])),'critic-retain-adjacent-surfaces')).result,'retained original disjoint and inclusive endpoint surfaces');
  const before=await capture(await submit(r,1,draw(),'critic-disjoint-before-reuse'));await sampledDepths(before);
  c.ok(r.store.unref(6),'retire source public name');const replacement=source(18,seed^0xaffecafe,11,7,2),fresh=r.add(replacement.metadata,replacement.backing);
  c.same(fresh.generation>original.generation,true,'opposite-format public name has fresh generation');row.boundaries.push({kind:'source-id-reuse',old:original.generation,fresh:fresh.generation,metadata:replacement.metadata,backing:await blob(report,replacement.backing)});
  const reused=await capture(await submit(r,1,draw(),'critic-disjoint-after-reuse'));await sampledDepths(reused);
  const count=()=>r.events.filter(e=>/^draw(?:Arrays|Elements)/.test(e.name)||e.name==='blitFramebuffer').length,initial=count();
  const endpoint=await submit(r,1,join(packet(5,0,[1,84,85]),draw()),'critic-inclusive-last-level-feedback');
  row.boundaries.push(endpoint);c.same(endpoint.result.error.code,'framebuffer-feedback','inclusive last-level feedback survives opposite-format name reuse');c.same(count(),initial,'endpoint refuses before every private copy or guest draw');
  c.ok((await submit(r,1,join(packet(5,0,[0,84]),depthClear(.90625)),'critic-retained-endpoint-GPU-clear')).result,'GPU-only old endpoint depth clear');
  row.clearEvents.push({level:2,depth:.90625,historyIndex:r.history.length-1});
  const cleared=f.source.planes[2].input.slice(),dv=new DataView(cleared.buffer);for(let i=0;i<f.source.planes[2].width*f.source.planes[2].height;i++)dv.setFloat32(i*8,.90625,true);f.source.planes[2].input=cleared;
  c.ok((await submit(r,1,packet(5,0,[1,83,20]),'critic-restore-disjoint-original')).result,'restore old disjoint mip attachment');
  const refreshed=await capture(await submit(r,1,draw(),'critic-disjoint-refreshed-after-reuse'),'refresh');await sampledDepths(refreshed);
  const backing=c.ok(r.store.readBacking(6,0,replacement.backing.length),'all replacement backing').bytes;row.replacementBackingAfter=await blob(report,backing);c.same([...backing],[...replacement.backing],'old GPU clear and sampler preserve new format backing');
  if(fault==='completed-stencil'){
   const oldDraw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),oldRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),fb=r.traced.createFramebuffer();
   row.corruption={before:{...r.lastCompletion},texture:r.trace.id(sourceTexture),originalLevel:2,stencil:0x5a};r.setLabel('critic-completed-native-stencil-corruption');
   r.traced.bindFramebuffer(gl.FRAMEBUFFER,fb);r.traced.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,sourceTexture,2);r.traced.drawBuffers([gl.NONE]);r.traced.readBuffer(gl.NONE);
   c.same(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'actual original source corruption framebuffer');r.traced.stencilMask(0xff);r.traced.clearStencil(0x5a);r.traced.clear(gl.STENCIL_BUFFER_BIT);
   row.corruption.after=await physicalFence(r,'critic-completed-native-stencil-second-fence');
   c.same(row.corruption.before.sync!==row.corruption.after.sync&&row.corruption.after.sequence>row.corruption.before.sequence,true,'distinct consumed physical fence follows actual native corruption');
   r.traced.bindFramebuffer(gl.DRAW_FRAMEBUFFER,oldDraw);r.traced.bindFramebuffer(gl.READ_FRAMEBUFFER,oldRead);r.traced.deleteFramebuffer(fb);
   await depths(refreshed,sourceTexture,0,4,'depths');
  }
  c.same(gl.getError(),gl.NO_ERROR,'original generation endpoint attack has no native errors');
 }finally{await finish(r,report,row);}
 report.status='passed';return report;
}
