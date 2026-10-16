import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-unorm-depth-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {createVirglStandardPackedUnsignedImageAsyncRenderer} from '../state.mjs';
import * as wire from '../decoder.mjs';
import * as owner from '../resources.mjs';
import {sampleCases,setupSample,viewsSample,readOutput,draw,sampleValue,floatWords,uniformPlane,missWords,metadata,positions,
 packet,join,shader,imageView,surface,word,sampler,textureTransfer,source,depthClear,depthCases,setupDepth,depthExpected,dsa,originalFormat,canonical,nativeMisses,depthLanes,backingMisses,domainCases,samplePlane} from '../../../tools/virgl-unorm-depth/fixtures.mjs';
export function runWireAcceptance(){
 const c=checks(),records=[],profiles=[],selected=wire.decodeStandardUnormDepthImageSubmission,prior=Object.entries(wire).filter(([name])=>/^decode.*Submission$/.test(name)&&name!=='decodeStandardUnormDepthImageSubmission');
 for(const [name,decoder]of prior)profiles.push({name,result:c.ok(decoder(new Uint8Array()),'closed historical empty profile')});
 for(const format of [16])for(const [kind,bytes]of [['base-view',imageView(9,6,format,0,0)],['swizzled-private-view',imageView(9,6,format,1,3,[2,4,0,5])],['mip-surface',surface(10,6,format,2)]]){
  const result=c.ok(selected(bytes),'original floating depth '+kind);c.same(result.profile,wire.STANDARD_UNORM_DEPTH_IMAGE_PROFILE,'separate selected floating depth consumer');
  const refusals=prior.map(([name,decode])=>{const value=decode(bytes);c.same(value.ok,false,'historical original depth remains closed');return {name,result:value};});
  records.push({format,kind,hex:[...bytes].map(n=>n.toString(16).padStart(2,'0')).join(''),result,refusals});
 }
 for(const format of [16])for(const [reason,bytes,index,value]of [
  ['view-target',imageView(9,6,format,1,3),3,format|3<<24],['view-layer',imageView(9,6,format,1,3),4,1],['view-reverse',imageView(9,6,format,1,3),5,3|1<<8],
  ['view-level',imageView(9,6,format,1,3),5,15<<8],['view-swizzle',imageView(9,6,format,1,3),6,6],['surface-layer',surface(10,6,format,2),5,1],['surface-level',surface(10,6,format,2),4,15]]){
  new DataView(bytes.buffer).setUint32(index*4,value,true);const result=selected(bytes);c.same(result.ok,false,'malformed original depth '+reason);records.push({format,kind:'refusal',reason,hex:[...bytes].map(n=>n.toString(16).padStart(2,'0')).join(''),result});
 }
 for(const format of [0,17,20,127,128,0xffffff])for(const bytes of [imageView(9,6,format,1,3),surface(10,6,format,2)])c.same(selected(bytes).ok,false,'other unqualified formats remain closed');
 const layouts=[];
 for(const bind of [1,8,9])for(const lastLevel of [0,2])for(const direction of [1,2]){
  const meta=metadata(29,16,9,7,lastLevel,bind),width=lastLevel?2:9,fields={resourceHandle:29,level:lastLevel,usage:0,stride:width*2+3,layerStride:0,box:{x:0,y:0,z:0,width,height:1,depth:1},dataOffset:3,direction},result=c.ok(owner.computeStandardUnormDepthTransferLayout(meta,fields,128),'original UN16 checked layout');
  c.same(result.layout.tightBytes,width*2,'original UN16 public byte cost');c.same(result.layout.scratchBytes,width*(direction===2?4:2),'UN16 charged native scratch cost');
  if(direction===2){c.same(result.layout.nativeReadBytes,width*4,'UN16 native FLOAT read bytes');c.same(result.layout.stagingBytes,width*8,'UN16 converter and PBO charges');}
  const legacy=owner.computeStandardFloatingDepthTransferLayout(meta,fields,128);c.same(legacy.ok,bind===1&&lastLevel===0,'historical UN16 role and mip admissions unchanged');layouts.push({metadata:meta,fields,backingByteLength:128,result,legacy});
 }
 const meta=metadata(29,16,9,7,2,9),fields={resourceHandle:29,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:9,height:7,depth:1},dataOffset:3,direction:1};
 for(const [key,value]of [['bind',0],['bind',2],['bind',3],['bind',10],['bind',17],['target',3],['depth',2],['arraySize',2],['nrSamples',1],['flags',1],['lastLevel',4],['width',0],['width',16385]]){
  const input={...meta,[key]:value},result=owner.computeStandardUnormDepthTransferLayout(input,fields,16000);c.same(result.ok,false,'original UN16 invalid metadata '+key);layouts.push({metadata:input,fields,backingByteLength:16000,result});
 }
 for(const input of [{...fields,level:3},{...fields,stride:1},{...fields,dataOffset:15999},{...fields,box:{...fields.box,x:1}},{...fields,box:{...fields.box,z:1}}]){
  const result=owner.computeStandardUnormDepthTransferLayout(meta,input,16000);c.same(result.ok,false,'invalid UN16 original transfer layout');layouts.push({metadata:meta,fields:input,backingByteLength:16000,result});
 }
 return {status:'passed',records,profiles,layouts,predictions:c.rows};
}
async function environment(mode,seed){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode,seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};
 window.__standardUnormDepthEvidence=report;return {c,gl,bridge,report};
}
async function makeRun(env,f,options){
 const {c,gl,bridge,report}=env,r=rig(gl,bridge,c,f,options),row={name:f.name,kind:f.kind,format:f.format,stage:f.stage,opcode:f.opcode,slot:f.slot,range:[f.firstLevel,f.lastLevel],swizzle:f.swizzle,lod:f.lod,coord:f.coord,linear:f.linear,parameters:f.parameters,width:f.width,height:f.height,vertex:f.vertex,fragment:f.fragment,source:f.source.metadata,level:f.level,outputLevel:f.outputLevel,outputLastLevel:f.outputLastLevel,outputFormat:f.outputFormat,domain:Boolean(f.domain),words:f.words,clearWords:f.clearWords,func:f.func,enabled:f.enabled,write:f.write,planes:[],frames:[],actions:[],clearEvents:[]};
 r.outputBackingBytes=Math.max(r.outputBackingBytes,5+f.height*(f.width*16+3));r.blobs=report.blobs;report.runs.push(row);r.add(metadata(1,f.outputFormat,f.targetWidth,f.targetHeight,f.outputLastLevel),new Uint8Array(r.outputBackingBytes).fill(0x2e));const target=r.allocations.at(-1);
 r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
 const original=r.add(f.source.metadata,f.source.backing);row.sourceGeneration=original.generation;row.sourceBacking=await blob(report,f.source.backing);row.positions=await blob(report,positions);row.target=target.metadata;
 for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
 return {r,row,target,original};
}
async function captureOutput(env,f,r,row,target,kind,expected,record){
 const {c,gl,report}=env;c.ok(record.result,'original consumer completion');c.same(record.result.gpuComplete,true,'physical original draw completion');
 const native=await nativeRead(r,target.storage.texture,f.outputFormat,f.width,f.height,f.outputLevel),miss=missWords(native,expected,depthLanes(f)),frame={run:report.runs.length-1,kind,completion:{...r.lastCompletion},historyIndex:r.history.length-1,native:await blob(report,native),outputs:[],bindings:[],depths:[]};
 report.frames.push(frame);row.frames.push(report.frames.length-1);if(miss.length)report.sabotage={fault:report.fault,held:false,miss,completion:frame.completion};c.same(miss,[],'every original native sampled or tested output word');
 for(let level=0;level<=f.outputLastLevel;level++){
  const width=Math.max(1,f.targetWidth>>level),height=Math.max(1,f.targetHeight>>level),raw=level===f.outputLevel?native:await nativeRead(r,target.storage.texture,f.outputFormat,width,height,level);
  if(level!==f.outputLevel)c.same(missWords(raw,uniformPlane(width,height,[0,0,0,0])),[],'untouched original output mip');frame.outputs.push({level,width,height,native:await blob(report,raw)});
 }
 const transfer=await submit(r,1,readOutput(f),record.label+'/public');c.ok(transfer.result,'original public color readback');frame.publicHistory=r.history.length-1;
 const backing=c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'full original output backing').bytes,expectedBacking=new Uint8Array(r.outputBackingBytes).fill(0x2e);
 for(let y=0;y<f.height;y++)expectedBacking.set(expected.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));
 frame.backing=await blob(report,backing);c.same(backingMisses(backing,expectedBacking,f),[],'every original public output word and padding');c.same(gl.getError(),gl.NO_ERROR,'native output diagnostic has no error');return frame;
}
async function captureDepths(env,f,r,frame,texture,first,last,expectedPlanes,label){
 const {c,report}=env,planes=[];
 frame[label].push({texture:r.trace.id(texture),planes});
 for(let original=first;original<=last;original++){
  const p=f.source.planes[original],local=original-first,raw=await nativeRead(r,texture,f.format,p.width,p.height,local),expected=expectedPlanes[original]??p.input;
  const row={original,local,width:p.width,height:p.height,completion:{...r.lastCompletion},native:await blob(report,raw)};planes.push(row);
  const miss=nativeMisses(f.format,expected,raw);if(miss.length)report.sabotage={fault:report.fault,held:false,miss,completion:row.completion};c.same(miss,[],'every native retained depth and stencil field '+label);
 }
}
async function publicDepths(env,f,r,row,expectedPlanes,label){
 const {c,report}=env;let expected=c.ok(r.store.readBacking(6,0,f.source.backing.length),'pre-read original depth backing').bytes.slice();const entry={kind:'depth-public',label,backingBefore:await blob(report,expected),reads:[]};row.actions.push(entry);
 for(const p of f.source.planes){
  const bpp=originalFormat(f.format).guestPixelBytes,stride=p.width*bpp+7,offset=6000+p.level*1500,bytes=packet(43,0,[6,p.level,0,stride,0,0,0,0,p.width,p.height,1,offset,2]);
  const record=await submit(r,1,bytes,label+'/level'+p.level);c.ok(record.result,'original public native depth readback');const tight=canonical(f.format,expectedPlanes[p.level]??p.input);
  for(let y=0;y<p.height;y++)expected.set(tight.subarray(y*p.width*bpp,(y+1)*p.width*bpp),offset+y*stride);
  const backing=c.ok(r.store.readBacking(6,0,f.source.backing.length),'all original depth backing bytes').bytes;entry.reads.push({level:p.level,historyIndex:r.history.length-1,backing:await blob(report,backing)});
  c.same([...backing],[...expected],'full depth fields and every untouched original backing byte');
 }
}
export async function runAcceptance({mode='samples',smoke=false,seed=0xd9403211,fault=null}={}){
 const env=await environment(mode,seed),{c,gl,bridge,report}=env;report.fault=fault;let state=seed>>>0;const jitter=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%4;};
 if(mode==='transfers')return (await import('./standard-unorm-depth-transfers.mjs')).runTransfers(env,{seed,smoke});
 if(mode==='surfaces')return runSurfaces(env,{smoke,seed,fault});
 let selected=mode==='domain'?domainCases({seed}):fault?sampleCases({smoke:true,seed}).filter(f=>f.format===16&&f.stage==='vertex'):sampleCases({smoke:mode==='boundaries'||smoke,seed});
 if(mode==='boundaries')selected=[...selected,...selected.map(f=>({...f,name:f.name+'/retirement2',source:source(16,seed^0x6a09e667,17,9,4)}))];
 for(const [ordinal,f]of selected.entries()){
  const {r,row,target,original}=await makeRun(env,f,{delay:mode==='boundaries'?jitter:ordinal%3,step:ordinal%2?1:64,fault});
  try{
   if(fault==='sample-plane'){r.add({...f.source.metadata,id:9},new Uint8Array(12000));}
   const setup=await submit(r,1,setupSample(f),'floating-sample-setup-'+ordinal);await captureOutput(env,f,r,row,target,'clear',uniformPlane(f.width,f.height,f.clearWords),setup);
   if(fault==='sample-plane')c.ok((await submit(r,1,join(...f.source.planes.map(p=>textureTransfer(9,p.level,p.width,p.height,p.offset,p.stride))),'floating-decoy-'+ordinal)).result,'actual wrong native sampler storage');
   c.ok((await submit(r,1,viewsSample(f),'floating-sample-view-'+ordinal)).result,'original depth view and sampler');if(fault)r.armFault();
   for(const temperature of ['first','warm']){
    const record=await submit(r,1,draw(),'floating-sample-draw-'+ordinal+'-'+temperature);
    if(fault==='completed-output'&&temperature==='first'){
     row.corruption={before:{...r.lastCompletion}};r.traced.clearBufferfv(gl.COLOR,0,new Float32Array([.0625,.25,.5,1]));row.corruption.after=await physicalFence(r,'completed-floating-output-corruption');
    }
    const frame=await captureOutput(env,f,r,row,target,'draw',samplePlane(f),record),unit=(f.stage==='vertex'?16:0)+f.slot,active=gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0+unit);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(a=>a.storage.texture===texture);gl.activeTexture(active);
    c.same(Boolean(allocation),true,'actual native retained depth sampler texture');await captureDepths(env,f,r,frame,texture,f.firstLevel,f.lastLevel,{},'bindings');await captureDepths(env,f,r,frame,r.allocations.find(a=>a.metadata.id===6).storage.texture,0,f.source.metadata.lastLevel,{},'depths');
    row.cache??=[];row.cache.push(r.renderer.inspect());
   }
   c.same(row.cache[0].work.programLinks,row.cache[1].work.programLinks,'warm original FLOAT sampler program reuse');
   await publicDepths(env,f,r,row,{},'floating-sampler-depth-public-'+ordinal);
   if(mode==='boundaries')await boundaries(env,f,r,row,target,original,ordinal);
  }finally{await finish(r,report,row);}
  if(mode==='boundaries'&&['complete','cancel'].includes(row.terminalMode)){
   const retired=row.retiredPlanes.find(p=>p.texture===r.trace.id(target.storage.texture));c.same(Boolean(retired),true,'old queued output captured after physical completion and before native deletion');
   const frame={run:report.runs.length-1,kind:'queued',retired:true,completion:retired.completion,historyIndex:row.history.findIndex(h=>h.label.startsWith('floating-queued-')),native:retired.native,outputs:[],bindings:[],depths:[]};row.frames.push(report.frames.length);report.frames.push(frame);
  }
 }
 report.status='passed';return report;
}
async function runSurfaces(env,{smoke,seed,fault}){
 const {c,gl,report}=env;
 for(const [ordinal,f]of depthCases({smoke,seed}).entries()){
  const {r,row,target}=await makeRun(env,f,{delay:ordinal%3,step:ordinal%2?1:64,fault}),sourceTexture=r.allocations.find(a=>a.metadata.id===6).storage.texture;
  try{
   if(fault==='depth-attachment')r.add({...f.source.metadata,id:9},new Uint8Array(12000));
   await captureOutput(env,f,r,row,target,'clear',uniformPlane(f.width,f.height,f.clearWords),await submit(r,1,setupDepth(f),'floating-depth-setup-'+ordinal));if(fault)r.armFault();
   const expected=depthExpected(f),record=await submit(r,1,draw(),'floating-depth-draw-'+ordinal);
   if(fault==='completed-depth'){
    row.corruption={before:{...r.lastCompletion}};r.traced.depthMask(true);r.traced.clearDepth(.0625);r.traced.clear(gl.DEPTH_BUFFER_BIT);row.corruption.after=await physicalFence(r,'completed-floating-depth-corruption');
   }
   const frame=await captureOutput(env,f,r,row,target,'draw',expected.color,record);await captureDepths(env,f,r,frame,sourceTexture,0,f.source.metadata.lastLevel,{[f.level]:expected.input},'depths');
   const drawRecord=r.draws.at(-1);c.same(drawRecord.native.depth[0].texture,r.trace.id(sourceTexture),'correct original native depth attachment');c.same(drawRecord.native.depth[0].level,f.level,'original depth surface mip');
   c.same(drawRecord.native.depth[1].texture,f.format===126?r.trace.id(sourceTexture):null,'combined depth and stencil attachment');c.same(drawRecord.native.stencilTest,false,'stencil untouched by guest depth operations');
   await publicDepths(env,f,r,row,{[f.level]:expected.input},'floating-surface-depth-public-'+ordinal);
   c.ok((await submit(r,1,join(dsa(31,0,false,false),depthClear(.6875)),'floating-full-depth-clear-'+ordinal)).result,'full original depth clear bypasses write mask');row.clearEvents.push({level:f.level,depth:.6875,historyIndex:r.history.length-1});
   const cleared=expected.input.slice(),view=new DataView(cleared.buffer),bpp=originalFormat(f.format).guestPixelBytes;for(let i=0;i<f.width*f.height;i++)view.setUint16(i*bpp,Math.round(.6875*65535),true);
   const clearFrame={depths:[]};row.depthClear=clearFrame;await captureDepths(env,f,r,clearFrame,sourceTexture,0,f.source.metadata.lastLevel,{[f.level]:cleared},'depths');await publicDepths(env,f,r,row,{[f.level]:cleared},'floating-cleared-depth-public-'+ordinal);
   if(f.func===0&&!f.write){
    row.switches=[];
    for(const [index,format]of [18,126,f.format].entries()){
     const id=100+index;
     if(index<2){
      const other=source(format,seed^id,f.width,f.height,0);r.add({...other.metadata,id,bind:1},other.backing);
      c.ok((await submit(r,1,textureTransfer(id,0,f.width,f.height,other.planes[0].offset,other.planes[0].stride),'floating-switch-upload-'+ordinal+'-'+format)).result,'upload original opposite depth and stencil fields');
      row.switchInputs??=[];row.switchInputs.push({format,resource:id,width:f.width,height:f.height,input:await blob(report,other.planes[0].input),backing:await blob(report,other.backing),stride:other.planes[0].stride,offset:other.planes[0].offset});
     }
     const texture=index===2?sourceTexture:r.allocations.find(a=>a.metadata.id===id).storage.texture,level=index===2?f.level:0;
     const record=await submit(r,1,join(surface(100+index,index===2?6:id,format,level),packet(5,0,[1,100+index,20]),dsa(200+index,1,true,false),depthClear(.75),draw()),'floating-depth-format-switch-'+ordinal+'-'+format);
     const frame=await captureOutput(env,f,r,row,target,'format-switch',uniformPlane(f.width,f.height,f.words),record),nativeState=r.draws.at(-1).native;
     c.same(nativeState.depth[0].texture,r.trace.id(texture),'switched original native depth texture');c.same(nativeState.depth[0].level,level,'switched original native depth level');c.same(nativeState.depth[1].texture,format===126?r.trace.id(texture):null,'switch removes stale native stencil attachment');
     row.switches.push({format,resource:index===2?6:id,level,historyIndex:frame.historyIndex,native:nativeState});
     if(index<2){
      const entry=row.switchInputs[index],original=source(format,seed^id,f.width,f.height,0).planes[0].input,wanted=original.slice(),dv=new DataView(wanted.buffer),bytes=originalFormat(format).guestPixelBytes;
      for(let i=0;i<f.width*f.height;i++)dv.setFloat32(i*bytes,.75,true);
      const raw=await nativeRead(r,texture,format,f.width,f.height,0);row.switchDepths??=[];row.switchDepths.push({...entry,input:entry.input,historyIndex:frame.historyIndex,native:await blob(report,raw)});
      c.same(nativeMisses(format,wanted,raw),[],'opposite native floating depth preserves every original S8 field');
     }else{
      const other=row.switchInputs.find(p=>p.format===126),allocation=r.allocations.find(a=>a.metadata.id===other.resource),wanted=source(126,seed^other.resource,f.width,f.height,0).planes[0].input,dv=new DataView(wanted.buffer);
      for(let i=0;i<f.width*f.height;i++)dv.setFloat32(i*8,.75,true);
      const raw=await nativeRead(r,allocation.storage.texture,126,f.width,f.height);row.switchPreserved={...other,historyIndex:frame.historyIndex,native:await blob(report,raw)};c.same(nativeMisses(126,wanted,raw),[],'return to UN16 leaves combined depth and original S8 unchanged');
     }
     const retained=cleared.slice(),dv=new DataView(retained.buffer);if(index===2)for(let i=0;i<f.width*f.height;i++)dv.setUint16(i*bpp,Math.round(.75*65535),true);
     await captureDepths(env,f,r,frame,sourceTexture,0,f.source.metadata.lastLevel,{[f.level]:retained},'depths');
    }
   }
  }finally{await finish(r,report,row);}
 }
 report.status='passed';return report;
}
async function boundaries(env,f,r,row,target,original,ordinal){
 const {c,gl,report}=env,before=()=>r.events.filter(e=>/^draw(?:Arrays|Elements)/.test(e.name)||e.name==='blitFramebuffer').length,initial=before(),actions=[];row.boundaries=actions;
 for(const [name,bytes]of [['alias-view',imageView(70,6,126,1,3)],['alias-surface',surface(71,6,126,1)],['extent-view',imageView(72,6,f.format,0,5)],['extent-surface',surface(73,6,f.format,5)]]){
  const record=await submit(r,1,bytes,'floating-refuse-'+name+'-'+ordinal);c.same(record.result.ok,false,'original '+name+' refused');actions.push(record);
 }
 for(const type of ['SINT','UINT']){
  const record=await submit(r,1,join(shader(type==='SINT'?74:75,f.stage==='vertex'?0:1,(f.stage==='vertex'?f.vertex:f.fragment).replace('2D, FLOAT','2D, '+type)),packet(31,0,[type==='SINT'?74:75,f.stage==='vertex'?0:1]),draw()),'floating-refuse-return-'+type+'-'+ordinal);
  c.same(record.result.error.code,'incompatible-resource','integer return cannot read original FLOAT depth');actions.push(record);
 }
 c.same(before(),initial,'original refusals issue no native guest draw or private copy');c.ok((await submit(r,1,packet(31,0,[f.stage==='vertex'?10:11,f.stage==='vertex'?0:1]),'floating-restore-FLOAT-'+ordinal)).result,'original FLOAT shader restored');
 for(const [index,key]of ['min','mag','mip'].entries()){
  const record=await submit(r,1,join(sampler(90+index,{...f.parameters,[key]:1}),packet(18,0,[f.stage==='vertex'?0:1,f.slot,90+index]),draw()),'floating-refuse-linear-'+key+'-'+ordinal);
  c.same(record.result.error.code,'unsupported-sampler','non-comparison depth linear filtering explicitly refused');actions.push(record);
 }
 c.same(before(),initial,'linear depth refusals issue no native guest draw or private copy');c.ok((await submit(r,1,packet(18,0,[f.stage==='vertex'?0:1,f.slot,50]),'floating-restore-nearest-'+ordinal)).result,'restore original nearest depth sampler');
 r.add({...f.source.metadata,id:81,bind:1},new Uint8Array(12000));r.add({...f.source.metadata,id:82,bind:8},new Uint8Array(12000));
 for(const [name,bytes]of [['surface-only-view',imageView(81,81,f.format,0,0)],['sampler-only-surface',surface(82,82,f.format,0)]]){
  const record=await submit(r,1,bytes,'floating-refuse-role-'+name+'-'+ordinal);c.same(record.result.ok,false,'original depth bind role refused');actions.push(record);
 }
 c.ok((await submit(r,1,surface(83,6,f.format,f.firstLevel),'floating-feedback-surface-'+ordinal)).result,'original depth feedback surface');
 const pFeedback=f.source.planes[f.firstLevel];r.add(metadata(8,31,pFeedback.width,pFeedback.height),new Uint8Array(20000));
 c.ok((await submit(r,1,surface(84,8,31,0),'floating-matching-color-'+ordinal)).result,'original matching color neighbor');
 for(const [name,bytes]of [['depth-as-color',packet(5,0,[1,0,83])],['color-as-depth',packet(5,0,[0,20])],['dimensions',packet(5,0,[1,83,20])],['feedback',join(packet(5,0,[1,83,84]),draw())]]){
  const record=await submit(r,1,bytes,'floating-refuse-'+name+'-'+ordinal);c.same(record.result.error.code,name==='feedback'?'framebuffer-feedback':'incompatible-resource','original '+name+' refused');actions.push(record);
 }
 c.same(before(),initial,'all original role, dimension and depth feedback refusals precede private copy and draw');
 c.ok((await submit(r,1,packet(5,0,[1,0,20]),'floating-restore-output-'+ordinal)).result,'restore original color output');
 if(f.firstLevel>0){
  const base=f.source.planes[0];r.add(metadata(85,31,base.width,base.height),new Uint8Array(20000));
  const record=await submit(r,1,join(surface(85,85,31,0),surface(86,6,f.format,0),packet(5,0,[1,86,85]),packet(4,0,[0,...[base.width/2,base.height/2,.5,base.width/2,base.height/2,.5].map(word)]),draw()),'floating-nonoverlap-depth-'+ordinal);
  c.ok(record.result,'nonoverlapping original source range and depth surface draw');const texture=r.allocations.find(a=>a.metadata.id===85).storage.texture,raw=await nativeRead(r,texture,31,base.width,base.height);
  c.same(missWords(raw,uniformPlane(base.width,base.height,floatWords(sampleValue(f))),depthLanes(f)),[],'disjoint original depth feedback output');row.nonoverlap={historyIndex:r.history.length-1,native:await blob(report,raw),width:base.width,height:base.height};
  c.ok((await submit(r,1,join(packet(5,0,[1,0,20]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)])),'floating-restore-after-nonoverlap-'+ordinal)).result,'restore original framebuffer and viewport');
 }
 const selected=r.renderer,old=c.ok(createVirglStandardPackedUnsignedImageAsyncRenderer({gl:r.traced,shaderBridge:r.bridge,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,uniformAccess:r.uniformAccess,imageAccess:r.imageAccess}),'closed historical consumer').renderer;
 try{c.ok(old.createContext(1),'closed historical context');r.renderer=old;const result=await submit(r,1,imageView(80,6,f.format,1,3),'floating-historical-refusal-'+ordinal);c.same(result.result.error.code,'unsupported-feature','historical depth sampler remains closed');actions.push(result);}
 finally{c.ok(old.dispose(),'historical consumer disposed');r.renderer=selected;c.ok(selected.restoreContext(1),'restore selected original context');}
 c.ok((await submit(r,1,surface(60,6,f.format,1),'floating-retained-surface-'+ordinal)).result,'retain original depth surface');
 c.ok(r.store.unref(6),'retire original depth source public name');const replacement=source(126,(report.seed^ordinal)>>>0,11,7,2),fresh=r.add(replacement.metadata,replacement.backing);
 actions.push({kind:'source-id-reuse',old:original.generation,fresh:fresh.generation,metadata:replacement.metadata,backing:await blob(report,replacement.backing)});c.same(fresh.generation>original.generation,true,'opposite original format owns fresh resource generation');
 c.ok((await submit(r,1,join(packet(5,0,[0,60]),depthClear(.8125)),'floating-GPU-only-old-generation-clear-'+ordinal)).result,'GPU-only retained depth surface clear');row.clearEvents.push({level:1,depth:.8125,historyIndex:r.history.length-1});
 const p=f.source.planes[1],input=p.input.slice(),dv=new DataView(input.buffer),bpp=originalFormat(f.format).guestPixelBytes;for(let i=0;i<p.width*p.height;i++)dv.setUint16(i*bpp,Math.round(.8125*65535),true);p.input=input;
 const record=await submit(r,1,join(packet(5,0,[1,0,20]),draw()),'floating-old-generation-refresh-'+ordinal),frame=await captureOutput(env,f,r,row,target,'refresh',samplePlane(f),record),active=gl.getParameter(gl.ACTIVE_TEXTURE),unit=(f.stage==='vertex'?16:0)+f.slot;
 gl.activeTexture(gl.TEXTURE0+unit);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.activeTexture(active);await captureDepths(env,f,r,frame,texture,f.firstLevel,f.lastLevel,{1:input},'bindings');
 const backing=c.ok(r.store.readBacking(6,0,replacement.backing.length),'new-generation depth backing').bytes;c.same([...backing],[...replacement.backing],'GPU-only original generation preserves all replacement bytes');row.replacementBackingAfter=await blob(report,backing);
 const mode=['complete','cancel','renderer-dispose','resource-dispose'][ordinal%4];row.terminalMode=mode;let point=null;
 const queued=await submit(r,1,join(draw(),packet(10,0,[f.stage==='vertex'?0:1,f.slot,0]),packet(3,6,[51]),packet(5,0,[0,0]),packet(3,8,[20]),packet(3,8,[60])),'floating-queued-'+mode+'-'+ordinal,async(step,job)=>{
  const state=r.renderer.inspect();if(state.jobs.status!=='finishing'||point)return;point={renderer:state,resources:r.store.inspect(),images:r.imageAccess.inspect()};row.pending=point;
  c.same(point.resources.budgets.imageHolds>=2,true,'native source range and output retained at physical completion');c.ok(r.store.unref(1),'retire queued output public name');const next=r.add(metadata(1,126,9,3,0,9),new Uint8Array(12000));point.targetGeneration=next.generation;
  if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel physical original depth sampler job');
  if(mode.endsWith('dispose')){if(mode==='resource-dispose')c.ok(r.store.dispose(),'dispose depth owner before consumer');c.ok(r.renderer.dispose(),'dispose selected depth consumer');return {disposed:true,appliedCommands:state.jobs.appliedCommands};}
 });actions.push(queued);c.same(Boolean(point),true,'native depth image reaches pending physical completion');if(mode==='complete')c.ok(queued.result,'retained native depth job completes');else c.same(queued.result.error.code,mode==='cancel'?'cancelled':'disposed','original terminal consumer outcome');
}
