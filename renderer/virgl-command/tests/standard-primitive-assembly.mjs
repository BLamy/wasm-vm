import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {createVirglStandardAsyncRenderer,createVirglAsyncRenderer} from '../state.mjs';
import {decodeSubmission,decodeStandardSubmission} from '../decoder.mjs';
import {checks,rig,meta,add,transfer,clear,submit,dispose,packet,join,blob,hex} from './standard-instanced-draws.mjs';
import {topologySpec,topologySetup} from './standard-core-topologies.mjs';
import {assemblyModel,comparePixels} from '../../../tools/virgl-command/standard-assembly-oracle.mjs';
export function assemblySpec(options={}){
 const o={mode:2,indexSize:2,instances:4,base:48,enabled:true,restartIndex:17,pattern:'split',generic:true,...options},s=topologySpec({mode:o.mode,count:4,indexSize:o.indexSize,instances:o.instances,base:o.base,...(o.offsets?{offsets:o.offsets}:{}),...(o.sourceOffsets?{sourceOffsets:o.sourceOffsets}:{}),...(o.seed?{seed:o.seed}:{})});Object.assign(s,o);
 s.vertexIds=[3,19,61,103,7,37,79,131].map(n=>s.base+n);if(o.maximumVertex&&(!s.enabled||s.restartIndex>2**(8*s.indexSize)-1))s.vertexIds[s.mode===1?1:3]=2**(8*s.indexSize)-1;
 let a=s.vertexIds.slice(0,4),b=s.vertexIds.slice(4);
 if(s.mode===1){a=a.slice(0,3);b=b.slice(0,3);}if(s.mode===4){a=[a[0],a[1],a[2],a[0],a[2],a[3]];b=[b[0],b[1],b[2],b[0],b[2],b[3]];}
 if(o.tail!==undefined){a=s.mode===2&&o.tail===3?[a[0],a[1],a[0]]:a.slice(0,o.tail);b=b.slice(0,o.tail);if(s.mode===2&&o.tail===3)b=[b[0],b[1],b[0]];}
 s.ids=s.pattern==='all'?Array(o.allCount??5).fill(s.restartIndex):s.pattern==='edges'?[s.restartIndex,s.restartIndex,...a,s.restartIndex,s.restartIndex,...b,s.restartIndex]:s.enabled&&s.restartIndex<=2**(8*s.indexSize)-1?[...a,s.restartIndex,...b]:[...a];
 if(o.ids)s.ids=[...o.ids];s.count=s.ids.length;s.used=[0,1,2];
 const prefix=s.offsets[0]+s.sourceOffsets[0],actual=s.ids.filter(id=>!s.enabled||id!==s.restartIndex),last=actual.length?Math.max(...actual):0;
 const raw=new Uint8Array(prefix+last*16+16-(o.shortSlot===0?1:0)),v=new DataView(raw.buffer),tri=s.mode>=4;
 const corners=tri?(s.mode===5?[[2,2],[6,2],[2,6],[6,6],[9,9],[13,9],[9,13],[13,13]]:[[2,2],[6,2],[6,6],[2,6],[9,9],[13,9],[13,13],[9,13]]):[[2.5,2.5],[6.5,2.5],[6.5,6.5],[2.5,6.5],[9.5,9.5],[13.5,9.5],[13.5,13.5],[9.5,13.5]];
 for(let i=0;i<s.vertexIds.length;i++){const id=s.vertexIds[i],point=corners[i],values=[point[0]/16,point[1]/8-1,id,1];for(let k=0;k<4;k++){const at=prefix+id*16+k*4;if(at+4<=raw.length)v.setFloat32(at,values[k],true);}}
 s.data.set(3,raw);if(!s.generic)s.bindings[1][0]=16;
 if(o.shortSlot===1)s.data.set(4,s.data.get(4).slice(0,-1));
 const indices=new Uint8Array(s.indexOffset+s.count*s.indexSize-(o.shortIndex?1:0)),iv=new DataView(indices.buffer);
 for(let i=0;i<s.ids.length;i++){const at=s.indexOffset+i*s.indexSize;if(at+s.indexSize<=indices.length){if(s.indexSize===1)iv.setUint8(at,s.ids[i]);else if(s.indexSize===2)iv.setUint16(at,s.ids[i],true);else iv.setUint32(at,s.ids[i],true);}}s.data.set(22,indices);
 const parts=s.vertex.split(/\n\d+: /),body=parts.slice(1).map(p=>p.trim()).filter(Boolean),declarations=parts[0].replace('DCL SV[0], INSTANCEID','DCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID').replace('DCL TEMP[0..1]','DCL TEMP[0..2]')+'\n';
 body[body.indexOf('MUL OUT[1], TEMP[1], IMM[1].xxxx')]='MUL TEMP[1], TEMP[1], IMM[1].xxxx';
 body.splice(body.length-1,0,'I2F TEMP[2].x, SV[1].xxxx','SEQ TEMP[2].x, TEMP[2].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[2].xxxx, IN[0].wwww','MOV OUT[0].z, IMM[0].zzzz','MOV OUT[1], TEMP[1]');s.vertex=declarations.replace('IMM[0]', 'IMM[0]')+'IMM[2] UINT32 {255,0,0,0}\nIMM[3] FLT32 {0.00390625,0.00390625,0.00390625,0.00390625}\nIMM[4] UINT32 {17,17,17,17}\n'+body.slice(0,-1).concat(['UMUL TEMP[2].x, SV[1].xxxx, IMM[4].xxxx','AND TEMP[2].x, TEMP[2].xxxx, IMM[2].xxxx','U2F TEMP[2].x, TEMP[2].xxxx','MUL OUT[1].x, TEMP[2].xxxx, IMM[3].xxxx','END']).map((l,i)=>i+': '+l+'\n').join('');
 if(o.smooth)s.fragment=s.fragment.replace('CONSTANT','PERSPECTIVE');
 if(o.indexed===false){s.enabled=false;s.restartIndex=0;s.start=o.start??4;s.count=o.count??(o.tail??4);s.ids=Array.from({length:s.count},(_,i)=>s.start+i);s.vertexIds=[...s.ids];s.data.delete(22);
  const prefix=s.offsets[0]+s.sourceOffsets[0],raw=new Uint8Array(prefix+(s.start+s.count-1)*16+16-(o.shortSlot===0?1:0)),v=new DataView(raw.buffer),corners=s.mode>=4?(s.mode===5?[[2,2],[6,2],[2,6],[6,6]]:s.mode===4?[[2,2],[6,2],[6,6],[2,2],[6,6],[2,6]]:[[2,2],[6,2],[6,6],[2,6]]):s.mode===2&&s.count===3?[[2.5,2.5],[6.5,2.5],[2.5,2.5]]:[[2.5,2.5],[6.5,2.5],[6.5,6.5],[2.5,6.5]];
  for(let i=0;i<s.ids.length;i++){const id=s.ids[i],point=corners[i%corners.length];[point[0]/16,point[1]/8-1,id,1].forEach((value,k)=>{const at=prefix+id*16+k*4;if(at+4<=raw.length)v.setFloat32(at,value,true);});}s.data.set(3,raw);
 }return s;
}
export const assemblyDraw=(s,overrides={})=>{const a={...s,...overrides};return packet(8,0,[a.indexed===false?a.start:0,a.count,a.mode,a.indexed===false?0:1,a.instances,0,0,a.enabled?1:0,a.enabled?a.restartIndex:0,0,0,0]);};
const word=value=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value,true);return view.getUint32(0,true);};
export const assemblySetup=(r,s,options={})=>join(topologySetup(r,s,options),...(s.cull?[packet(1,2,[99,2|(1<<29)|(2<<8)|(s.frontCcw?1<<15:0),word(1),0,65535,word(1),0,0,0]),packet(2,2,[99])]:[]));
export function assemblyRig(gl,bridge,c,s,options={}){
 const owned=[],events=[],nativeState=[],selection=[];let r,allocation=0,forcedError=0;
 const factory=config=>{
  if(options.probeSelection){
   for(const [label,override,expected]of [['unknown',{primitiveAssembly:'invalid'},'invalid-input'],['missing-extension',{primitiveAssembly:'lists',gl:new Proxy(config.gl,{get(target,name){return name==='getExtension'?()=>null:Reflect.get(target,name,target);}})},'unsupported-host'],['wrong-extension',{primitiveAssembly:'lists',gl:new Proxy(config.gl,{get(target,name){return name==='getExtension'?()=>({provokingVertexWEBGL(){},LAST_VERTEX_CONVENTION_WEBGL:0}):Reflect.get(target,name,target);}})},'unsupported-host']]){const result=createVirglStandardAsyncRenderer({...config,...override});c.same(result.ok,false,label+' selected gate');c.same(result.error.code,expected,label+' explicit error');selection.push({label,result});}
   const old=createVirglAsyncRenderer({...config,primitiveAssembly:'lists'});c.same(old.ok,false,'legacy does not acquire assembly option');c.same(old.error.code,'invalid-input','legacy option rejection');selection.push({label:'legacy',result:old});
  }
  const native=config.gl,wrapped=new Proxy(native,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{
   if(['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced'].includes(name)){const ext=gl.getExtension('WEBGL_provoking_vertex');nativeState.push({label:r.currentLabel,call:name,convention:gl.getParameter(ext.PROVOKING_VERTEX_WEBGL),indexBuffer:r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING))});}
   if(name==='createBuffer'&&options.failAllocation&&r?.renderer.inspect().jobs.status.startsWith('waiting-')&&++allocation===options.failAllocation){events.push({name:'forced-createBuffer-null',allocation});return null;}
   if(name==='getError'&&forcedError){const error=forcedError;forcedError=0;return error;}
   if(name==='bufferData'&&args[0]===gl.ELEMENT_ARRAY_BUFFER&&args[1] instanceof Uint32Array){
    const buffer=gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING),entry={buffer,nativeBuffer:r.trace.id(buffer),bytes:args[1].byteLength,label:r.currentLabel,deleted:false};owned.push(entry);
    const result=value.apply(target,args);events.push({name:'normalized-upload',traceEventCount:r.trace.events.length,nativeBuffer:entry.nativeBuffer,bytes:entry.bytes,inspection:r.renderer.inspect().jobs});
    if(options.failUpload&&owned.length===options.failUpload)forcedError=gl.OUT_OF_MEMORY;return result;
   }
   if(name==='deleteBuffer'){const entry=owned.find(e=>e.buffer===args[0]);if(entry){const before=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);gl.bindBuffer(gl.COPY_READ_BUFFER,entry.buffer);const raw=new Uint8Array(entry.bytes);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,before);
    entry.raw=raw;entry.deleted=true;events.push({name:'normalized-delete',traceEventCount:r.trace.events.length,nativeBuffer:entry.nativeBuffer,bytes:entry.bytes,inspection:r.renderer.inspect().jobs});}}
   return value.apply(target,args);
  };}});return createVirglStandardAsyncRenderer({...config,gl:wrapped,primitiveAssembly:"lists"});
 };
 r=rig(gl,bridge,c,{width:s.width,height:s.height,...options,factory});r.normalized=owned;r.normalizationEvents=events;r.nativeState=nativeState;r.selection=selection;return r;
}
export async function assemblySubmit(r,ctx,bytes,label,onYield=null){const ext=r.gl.getExtension('WEBGL_provoking_vertex');ext.provokingVertexWEBGL(ext.FIRST_VERTEX_CONVENTION_WEBGL);r.currentLabel=label;return submit(r,ctx,bytes,label,onYield);}
export async function assemblyFrame(r,record,{allowError=false}={}){
 const {gl,c}=r;if(!allowError)c.ok(record.result,record.label+' completed draw');c.same(record.result.gpuComplete,true,'actual final completion');
 const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);
 gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const name of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[name],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
 const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(framebuffer);
 const draw=record.result.draws.at(-1),buffers=[],normalized=[],calls=r.trace.calls.filter(call=>call.label===record.label).map(({program,...a})=>a);
 for(const [id,raw]of r.bufferBytes){const generation=id===22?(draw.indexResourceGeneration??r.allocations.find(a=>a.metadata.id===22).generation):draw.vertexFetches.find(f=>f.resourceId===id).resourceGeneration,allocation=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),physical=new Uint8Array(raw.length);
  gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,physical);gl.bindBuffer(gl.COPY_READ_BUFFER,null);const saved=await blob(r,physical);
  c.same(saved.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))),'original physical source '+id);buffers.push({resourceId:id,generation,nativeBuffer:r.trace.id(allocation.storage.buffer),blob:saved});}
 for(const entry of r.normalized.filter(e=>e.label===record.label)){c.same(entry.deleted,true,'normalized native storage retired');normalized.push({nativeBuffer:entry.nativeBuffer,bytes:entry.bytes,blob:await blob(r,entry.raw)});}
 const model=assemblyModel(r.history,r.bufferBytes),audit=comparePixels(pixels,model,r.width,r.height),frame={label:record.label,width:r.width,height:r.height,used:[0,1,2],history:r.history.map(h=>({...h})),inputs:r.exchanges.map(e=>({...e})),
  native:{calls,buffers,normalized,state:r.nativeState.filter(row=>row.label===record.label)},failedJob:!record.result.ok,predicted:{ids:model.ids,min:model.min,max:model.max,valid:model.valid,restarts:model.restarts,normalize:model.normalize,fetches:model.fetches},audit,pixels:await blob(r,pixels)};
 r.frames.push(frame);c.same(audit.misses,[],record.label+' independent assembly pixel oracle');
 const call=calls.at(-1),instanced=model.effective>1;c.same(call.name,(model.nativeIndexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'actual native entry');c.same(call.args,model.nativeIndexed?[model.nativeMode,model.nativeCount,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.effective]:[])]:[model.nativeMode,model.draw.start,model.nativeCount,...(instanced?[model.effective]:[])],'original primitive with native assembled indices');c.same(frame.native.state.map(row=>row.convention),Array(calls.length).fill(0x8e4e),'physical last provoking state at every actual draw');
 c.same(call.indexBuffer,model.normalize?normalized.find(n=>n.nativeBuffer===call.indexBuffer).nativeBuffer:model.draw.indexed?buffers.find(b=>b.resourceId===22).nativeBuffer:null,'correct owned native index binding');
 c.same([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],[model.min,model.max,model.valid,model.restarts,model.normalize,model.nativeSize,model.nativeOffset,model.draw.count*model.effective],'actual bounds and charged source work');
 c.same([draw.primitiveAssembly,draw.assembled,draw.nativeMode,draw.nativeCount,draw.nativeIndexed,draw.nativeVertexWork],['lists',model.assembled,model.nativeMode,model.nativeCount,model.nativeIndexed,model.nativeCount*model.effective],'separate original and native work');
 if(model.normalize){c.same(normalized.find(n=>n.nativeBuffer===call.indexBuffer).bytes,model.normalized.length,'physical normalized byte count');c.same(normalized.find(n=>n.nativeBuffer===call.indexBuffer).blob.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',model.normalized))),'independently predicted normalized GPU bytes');}
 for(const f of model.fetches){const a=call.attributes.find(a=>a.name==='in_'+f.attributeIndex),observed=draw.vertexFetches.find(a=>a.attributeIndex===f.attributeIndex),keys=['resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'];
  c.same(Object.fromEntries(keys.map(k=>[k,observed[k]])),Object.fromEntries(keys.map(k=>[k,f[k]])),'original actual fetch '+f.attributeIndex);c.same(a.enabled,!f.constant,'native generic/array selection');c.same(a.divisor,f.nativeDivisor,'native divisor');if(f.constant)c.same(a.genericValues,f.genericValues,'physical generic values');}
 c.same(gl.getError(),gl.NO_ERROR,'native assembly draw and readback error');return frame;
}
export function runWireAcceptance(){const c=checks(),records=[];
 const test=(words,expected,old,label)=>{const bytes=packet(8,0,words),standard=decodeStandardSubmission(bytes),legacy=decodeSubmission(bytes);c.same(standard.ok,expected,label+' standard');c.same(legacy.ok,old,label+' legacy');records.push({label,hex:hex(bytes),expected,legacyExpected:old,standard,legacy});};
 for(const mode of [0,1,2,3,4,5,6,7])for(const enabled of [0,1,2])for(const indexed of [0,1,2])for(const marker of [0,255,65535,4294967295]){
  const expected=mode>=1&&mode<=6&&indexed<=1&&enabled<=1&&(enabled===1?indexed===1:marker===0),old=[4,5].includes(mode)&&enabled===0&&marker===0&&indexed<=1;
  test([0,4,mode,indexed,1,0,0,enabled,marker,0,0,0],expected,old,'restart-'+[mode,indexed,enabled,marker].join('-'));}
 for(const [at,value]of [[5,1],[6,1],[11,1]]){const words=[0,4,2,1,3,0,0,1,17,0,0,0];words[at]=value;test(words,false,false,'unsupported-'+at);}
 const bytes=join(assemblyDraw(assemblySpec()),packet(8,0,[]));c.same(decodeStandardSubmission(bytes).ok,false,'malformed complete snapshot');c.same(decodeSubmission(bytes).ok,false,'malformed legacy snapshot');records.push({label:'malformed-tail',hex:hex(bytes),expected:false,legacyExpected:false});
 return {status:'passed',records,predictions:c.rows};}
export async function runAcceptance({smoke=false}={}){
 const c=checks(),report={schema:'virgl-standard-assembly-v1',status:'running',guestExecution:false,productionNegotiation:false,predictions:c.rows,frames:[],runs:[],blobs:[],rejections:[],suspensions:[],ownership:[]};window.__standardAssemblyEvidence=report;report.wire=runWireAcceptance();
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');c.same(Boolean(debug),true,'native GPU identity');report.gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);c.same(report.gpu.length>0,true,'nonempty GPU identity');c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu),false,'physical hardware');
 const bridge=await createVirglStandardShaderBridge(),make=(s,options={})=>{const r=assemblyRig(gl,bridge,c,s,options);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{const inspection=c.ok(r.renderer.inspect(),'completed counters');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'released '+key);
  report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),normalizationEvents:r.normalizationEvents,nativeState:r.nativeState,selection:r.selection,inspection});dispose(r);};
 for(const [delay,step]of smoke?[[0,64]]:[[0,64],[2,1],[5,3]])for(const mode of smoke?[2]:[1,2,3,4,5,6]){
  const configs=[['custom',{indexSize:2}],['wide-custom',{indexSize:4,base:70000,generic:false,instances:2}],['fixed-byte',{indexSize:1,base:16,restartIndex:255,instances:0}],['fixed-short',{indexSize:2,restartIndex:65535,instances:1}],['fixed-wide',{indexSize:4,base:70000,restartIndex:4294967295}],['byte-maximum',{indexSize:1,base:16,enabled:false,maximumVertex:true}],['short-maximum',{indexSize:2,enabled:false,maximumVertex:true,instances:1}],['out-of-type',{indexSize:1,base:16,restartIndex:65535,enabled:true,maximumVertex:true}],['arrays-zero',{indexed:false,instances:0}],['arrays-instanced',{indexed:false,instances:2,start:11}],['arrays-buffered',{indexed:false,instances:2,generic:false,start:19}],['smooth',{smooth:true,instances:1}],['cull-front',{cull:true,frontCcw:false,instances:1}],['cull-back',{cull:true,frontCcw:true,instances:1}]];
  for(const [label,options]of smoke?configs.slice(0,1):configs){const s=assemblySpec({mode,...options}),r=make(s,{delay,step});await assemblyFrame(r,await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'mode-'+mode+'-'+label+'-'+delay));done(r);}
 }
 if(!smoke){
  {const s=assemblySpec(),r=make(s,{probeSelection:true});c.same(r.selection.length,4,'four explicit factory gate checks');c.same(r.trace.calls.length,0,'configuration gates do not draw');done(r);}
  {const s=assemblySpec({indexed:false,mode:2,instances:1}),r=make(s,{delay:5,step:1}),raw=new Uint8Array(20);new DataView(raw.buffer).setUint16(12,17,true);s.data.set(22,raw);let observed=false;
   const setup=join(assemblySetup(r,s),packet(11,0,[22,2,12]));
   const rec=await assemblySubmit(r,1,join(setup,assemblyDraw(s)),'array-bound-original',()=>{const jobs=r.renderer.inspect().jobs;if(jobs.draws===1&&jobs.normalizedBuffers){observed=true;c.same(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)===r.allocations.find(a=>a.metadata.id===22).storage.buffer,true,'array conversion restores retained original EBO before yield');}});
   c.same(observed,true,'array conversion reaches a retained private-buffer yield');await assemblyFrame(r,rec);done(r);
  }
  for(const mode of [1,2,3,4,5,6])for(const options of [{pattern:'edges'},{pattern:'all',restartIndex:4294967295,indexSize:4},{tail:1},{tail:2},{tail:3}]){const s=assemblySpec({mode,...options}),r=make(s,{delay:2,step:1});await assemblyFrame(r,await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'tail-'+mode+'-'+(options.pattern??options.tail)));done(r);}
  for(const mode of [2,6])for(const count of [1,2,3]){const s=assemblySpec({mode,indexed:false,count,instances:1}),r=make(s,{delay:2,step:1});await assemblyFrame(r,await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'array-tail-'+mode+'-'+count));done(r);}
  for(const options of [{shortSlot:0},{shortIndex:true},{shortSlot:1}]){const s=assemblySpec(options),r=make(s),rec=await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'short-'+JSON.stringify(options));c.same(rec.result.error.code,'out-of-bounds','one-byte-short original fetch');c.same(r.trace.calls.length,0,'short source no native draw');c.same(r.normalized.length,0,'bounds before normalization');report.rejections.push({label:rec.label,record:rec,events:r.trace.events});done(r);}
  for(const budget of [36,35]){const s=assemblySpec(),r=make(s,{drawLimits:{indicesPerSubmission:budget}}),rec=await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'work-'+budget);if(budget===36)await assemblyFrame(r,rec);else{c.same(rec.result.error.code,'limit-exceeded','restart words charged');c.same(r.trace.calls.length,0,'work limit before draw');report.rejections.push({label:rec.label,record:rec,events:r.trace.events});}done(r);}
  for(const action of ['stale-index','collected-index','cancel','reuse']){const s=assemblySpec(),r=make(s,{delay:action==='collected-index'?({ordinal})=>ordinal%2===1?9:0:7,step:2});c.ok((await assemblySubmit(r,1,assemblySetup(r,s),'pending-setup-'+action)).result,'pending original setup');const oldGeneration=r.allocations.find(a=>a.metadata.id===22).generation;let point,fired=false,newGeneration;
   const rec=await assemblySubmit(r,1,join(clear([0,0,0,0]),assemblyDraw(s)),'pending-'+action,async(_step,token)=>{const inspection=r.renderer.inspect();if(fired||inspection.jobs.status!=='waiting-attributes'||action==='collected-index'&&!r.trace.events.some(e=>e.name==='getBufferSubData'&&e.bytes===s.count*s.indexSize))return;fired=true;point={inspection,events:r.trace.events.map(e=>({...e}))};
    if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel pending original read');else if(action==='reuse'){c.ok(r.store.unref(22),'retire original public index name');newGeneration=add(r,meta(22,0,64,32,s.data.get(22).length),new Uint8Array(s.data.get(22).length)).generation;}
    else{const bytes=s.data.get(22).slice();bytes.fill(0);c.ok(r.store.writeBacking(22,0,bytes),'change original index backing');const command=c.ok(decodeStandardSubmission(transfer(22,bytes.length)),'literal index upload').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'owned concurrent upload');c.ok(r.store.executeTransfer(access.ticket),'actual GPU index revision changed');}});
   c.same(fired,true,'delayed read reached');if(action==='reuse'){await assemblyFrame(r,rec);c.same(rec.result.draws[0].indexResourceGeneration,oldGeneration,'original retained index generation');}else{c.same(rec.result.error.code,action==='cancel'?'cancelled':'stale-storage','specific pending rejection');c.same(rec.result.gpuComplete,true,'pending read drain');c.same(r.trace.calls.length,0,'invalid source never draws');c.same(r.normalized.length,0,'invalid source never normalizes');}
   report.suspensions.push({action,point,oldGeneration,newGeneration,record:rec,events:r.trace.events});done(r);
  }

  // Poison an unrelated native VAO/EBO and alternate context/mode before A.
  {const a=assemblySpec(),b=assemblySpec({mode:3}),r=make(a,{delay:3,step:1}),vao=gl.createVertexArray(),ebo=gl.createBuffer();
   await assemblyFrame(r,await assemblySubmit(r,1,join(assemblySetup(r,a),assemblyDraw(a)),'restore-A-first'));
   const poison=()=>{const ext=gl.getExtension('WEBGL_provoking_vertex');ext.provokingVertexWEBGL(ext.FIRST_VERTEX_CONVENTION_WEBGL);gl.bindVertexArray(vao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array([0,0,0]),gl.STREAM_DRAW);gl.viewport(0,0,1,1);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.colorMask(false,false,false,false);};
   poison();await assemblyFrame(r,await assemblySubmit(r,2,join(assemblySetup(r,b,{create:false}),assemblyDraw(b)),'restore-B'));
   poison();r.spec=a;r.bufferBytes=a.data;await assemblyFrame(r,await assemblySubmit(r,1,join(clear([0,0,0,0]),assemblyDraw(a)),'restore-A-last'));
   gl.deleteVertexArray(vao);gl.deleteBuffer(ebo);done(r);
  }
  // Explicit all-restart custom lowering, including empty original fetch bounds.
  {const s=assemblySpec({pattern:'all'}),r=make(s,{delay:3,step:1});await assemblyFrame(r,await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'all-custom-empty'));done(r);}
  // Expanded fan work is at most three times the original 65536 source ceiling.
  for(const [label,count,repeats,limits,expected]of [
   ['scratch-exact-one',65536,1,{},null],['scratch-exact-64',1024,64,{},null],
   ['scratch-minus-one',1024,64,{drawLimits:{indicesPerSubmission:65535}},'limit-exceeded'],
   ['scratch-draw-65',1024,65,{},'limit-exceeded'],
   ['read-exact',65536,1,{jobLimits:{transferBytes:65552}},null],
   ['read-minus-one',65536,1,{jobLimits:{transferBytes:65551}},'limit-exceeded']]){
   const s=assemblySpec({mode:6,indexSize:1,instances:1,base:16,enabled:false,maximumVertex:true,ids:Array(count).fill(255)}),r=make(s,{step:1,...limits}),peaks=[];
   const rec=await assemblySubmit(r,1,join(assemblySetup(r,s),...Array.from({length:repeats},()=>assemblyDraw(s))),label,()=>{const inspection=r.renderer.inspect().jobs;peaks.push({...inspection});c.same(inspection.normalizedBytes<=786432,true,'native scratch derived byte ceiling');c.same(inspection.normalizedBuffers<=64,true,'native scratch derived buffer ceiling');c.same(inspection.normalizationScratchBytes,0,'CPU normalization scratch never crosses a yield');});
   if(!expected)await assemblyFrame(r,rec);else{c.same(rec.result.error.code,expected,'exact scratch/work/read bound');if(rec.result.draws.length)await assemblyFrame(r,rec,{allowError:true});else c.same(r.trace.calls.length,0,'read bound before native draw');report.rejections.push({label,record:rec,events:r.trace.events});}
   if(label==='scratch-exact-one')c.same(Math.max(...peaks.map(p=>p.normalizedBytes)),786408,'exact single-buffer bound reached');
   if(label==='scratch-exact-64')c.same([Math.max(...peaks.map(p=>p.normalizedBytes)),Math.max(...peaks.map(p=>p.normalizedBuffers))],[784896,64],'exact aggregate scratch bounds reached');
   report.ownership.push({label,record:rec,peaks,normalizationEvents:r.normalizationEvents});done(r);
  }
  // A partial native allocation/upload failure after a completed first draw.
  for(const [label,options]of [['native-create-fails',{failAllocation:2}],['native-upload-fails',{failUpload:2}]]){
   const s=assemblySpec(),r=make(s,{step:1,delay:3,...options}),rec=await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s),assemblyDraw(s)),label);
   c.same(rec.result.error.code,'backend-error','specific native normalization allocation error');c.same(rec.result.gpuComplete,true,'partial allocation drains final fence');c.same(rec.result.draws.length,1,'only preceding native draw completes');c.same(r.trace.calls.length,1,'failed second normalization never draws');await assemblyFrame(r,rec,{allowError:true});
   report.ownership.push({label,record:rec,normalizationEvents:r.normalizationEvents});done(r);
  }
  // Cancellation owns scratch while a later read or the final fence is pending.
  for(const phase of ['waiting-attributes','finishing']){const s=assemblySpec(),r=make(s,{delay:6,step:1});c.ok((await assemblySubmit(r,1,assemblySetup(r,s),'owned-setup-'+phase)).result,'owned scratch setup');let point,fired=false;
   const draws=phase==='finishing'?[assemblyDraw(s)]:[assemblyDraw(s),assemblyDraw(s)];
   const rec=await assemblySubmit(r,1,join(clear([0,0,0,0]),...draws),'owned-cancel-'+phase,(_step,token)=>{const inspection=r.renderer.inspect().jobs;if(!fired&&inspection.draws===1&&inspection.status===phase){fired=true;point={inspection,events:r.trace.events.map(e=>({...e}))};c.same(inspection.normalizedBuffers,1,'normalization remains owned across pending work');c.ok(r.renderer.cancel(token),'cancel job with retained native index');}});
   c.same(fired,true,'owned scratch suspension reached');c.same(rec.result.error.code,'cancelled','owned cancellation error');c.same(rec.result.gpuComplete,true,'owned cancellation drains final native fence');c.same(rec.result.draws.length,1,'cancelled suffix never draws');await assemblyFrame(r,rec,{allowError:true});
   report.ownership.push({label:'owned-cancel-'+phase,point,record:rec,normalizationEvents:r.normalizationEvents});done(r);
  }
  // Disposal invalidates a pending job and every retained native object.
  {const s=assemblySpec(),r=make(s,{delay:7,step:1});c.ok((await assemblySubmit(r,1,assemblySetup(r,s),'dispose-setup')).result,'dispose setup');const bytes=join(assemblyDraw(s),assemblyDraw(s));r.currentLabel='owned-dispose';r.trace.label(r.currentLabel);const token=c.ok(r.renderer.beginSubmission(1,bytes),'dispose job').job;let before;
   for(let i=0;i<1000;i++){await new Promise(resolve=>setTimeout(resolve,1));r.trace.nextTurn();const step=c.ok(r.renderer.step(token),'dispose later-task step'),inspection=r.renderer.inspect().jobs;if(inspection.draws===1&&inspection.status==='waiting-attributes'){before={inspection,events:r.trace.events.map(e=>({...e}))};break;}c.same(step.status==='done',false,'dispose suspension precedes completion');}
   c.same(Boolean(before),true,'dispose with scratch and pending reads');c.same(before.inspection.normalizedBuffers,1,'dispose owns one native index');c.ok(r.renderer.dispose(),'explicit renderer disposal');c.same(r.renderer.step(token).ok,false,'disposed token is invalid');for(const entry of r.normalized)c.same(gl.isBuffer(entry.buffer),false,'disposed normalized native buffer deleted');
   const after=r.renderer.inspect();for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(after.jobs[key],0,'explicit disposal releases '+key);report.ownership.push({label:'owned-dispose',hex:hex(bytes),before,after,events:r.trace.events,normalizationEvents:r.normalizationEvents,calls:r.trace.calls.map(({program,...a})=>a)});done(r);
  }
  // A real nonrestart u32 maximum cannot be represented by any native type.
  {const s=assemblySpec({indexSize:4,enabled:false}),r=make(s);new DataView(s.data.get(22).buffer).setUint32(s.indexOffset,4294967295,true);const rec=await assemblySubmit(r,1,join(assemblySetup(r,s),assemblyDraw(s)),'nonrestart-u32-max');c.same(rec.result.error.code,'unsupported-draw','u32 maximum rejected as a real vertex');c.same(r.trace.calls.length,0,'u32 maximum before native draw');c.same(r.normalized.length,0,'u32 maximum before allocation');report.rejections.push({label:rec.label,record:rec});done(r);}

 }
 report.status='passed';return report;
}
