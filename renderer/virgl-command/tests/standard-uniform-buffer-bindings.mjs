import {decodeSubmission,decodeStandardSubmission,decodeStandardUniformSubmission} from '../decoder.mjs';
import {createResourceStore,createStandardUniformResourceStore,computeTransferLayout,computeStandardUniformTransferLayout,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglStandardUniformAsyncRenderer,createVirglStandardAsyncRenderer} from '../state.mjs';
import {createVirglStandardUniformShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,packet,join,meta,add,transfer,clear,submit,dispose,hex,blob,traceGL} from './standard-instanced-draws.mjs';
import {specimen,setup,draw,bind} from '../../../tools/virgl-command/standard-uniform-binding-fixtures.mjs';

export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const stage of [0,1,2,5,6])for(const slot of [0,1,12,13,14,15])for(const id of [0,777]){
  const raw=bind(stage,slot,16,id?32:0xffffffff,id),expected=stage<=5&&slot<15&&(!id||stage<=1&&slot<=12),result=decodeStandardUniformSubmission(raw);
  c.same(result.ok,expected,'original uniform stage/slot/null reset');c.same([decodeSubmission(raw).ok,decodeStandardSubmission(raw).ok],[false,false],'old wire facets remain isolated');
  if(expected&&!id)c.same(result.commands[0].fields,{stage,index:slot,offset:0,length:0,resourceHandle:0},'original null ignores incoming range');records.push({hex:hex(raw),expected,result});
 }
 for(const fields of [[0,1,0,0,7],[0,1,0xffffffff,1,7],[0,1,0xfffffff0,32,7]]){
  const raw=packet(27,0,fields),result=decodeStandardUniformSubmission(raw);c.same(result.ok,false,'nonempty u32 uniform range');records.push({hex:hex(raw),expected:false,result});
 }
 for(const raw of [packet(27,0,[0,1,0,16]),packet(27,0,[0,1,0,16,7,0]),packet(27,1,[0,1,0,16,7]),join(bind(0,1,0,16,7),packet(27,0,[]))]){
  const result=decodeStandardUniformSubmission(raw);c.same(result.ok,false,'complete original uniform framing');records.push({hex:hex(raw),expected:false,result});
 }
 c.same(decodeStandardUniformSubmission(bind(0,1,0,16,7),{uniform:true}).error.code,'invalid-provenance','guest labels cannot select facets');
 const backend={maxTextureSize:4096,allocate:m=>({bytes:new Uint8Array(m.byteLength)}),destroy:s=>{s.destroyed=true;},upload:(s,m,l,b)=>s.bytes.set(b,l.box.x),readback:(s,m,l)=>s.bytes.slice(l.box.x,l.box.x+l.tightBytes),dispose(){}};
 const layouts=[],ownership=[];const fields={resourceHandle:200,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:64,height:1,depth:1},dataOffset:0,direction:1};
 for(const binding of [16,32,64,80,96,524288]){
  const metadata=meta(200,0,64,binding,64),a=computeStandardUniformTransferLayout(metadata,fields,64),old=computeTransferLayout(metadata,fields,64);
  c.same(a.ok,[16,32,64,80].includes(binding),'selected resource wire role');c.same(old.ok,[16,32].includes(binding),'old resource layout shape');layouts.push({metadata,fields,backingBytes:64,selected:a,old});
 }
 for(const action of ['detach','unref-reuse','lease','context','revision','failed-revision','submitted-upload','dispose']){
  let failed=false;const owner=c.ok(createStandardUniformResourceStore({backend:{...backend,upload(...args){backend.upload(...args);if(failed)throw Error('partial original upload');}}}),'range owner'),{store,uniformAccess:access}=owner;
  c.ok(store.createContext(1),'range context');const original=c.ok(store.createResource(meta(200,0,64,64,64)),'range allocation').resource;c.ok(store.attachContext(1,200),'range membership');c.ok(store.attachBacking(200,[new Uint8Array(64)]),'range backing');
  const lease=c.ok(store.retainStorage(1,200,'uniform'),'range lease').lease,range=c.ok(access.capture(lease,16,48),'exact original allocation end');
  for(const[offset,length]of [[65,1],[63,2],[0,0],[-1,1],['0',16]])c.same(access.capture(lease,offset,length).ok,false,'range primitive/bounds rejects');
  if(action==='detach')c.ok(store.detachContext(1,200),'detach retains original binding');
  if(action==='unref-reuse'){c.ok(store.unref(200),'public unref original');const newer=c.ok(store.createResource(meta(200,0,64,80,64)),'reuse numeric name').resource;c.same(newer.generation!==original.generation,true,'numeric ID owns distinct storage');}
  if(action==='lease')c.ok(store.releaseStorage(lease),'external lease release');
  if(action==='context'){c.ok(store.destroyContext(1),'destroy range context');c.ok(store.createContext(1),'reuse context ID');}
  if(action==='submitted-upload')c.ok(access.submit(range.token),'range becomes allocation hold');
  if(['revision','failed-revision','submitted-upload'].includes(action)){
   failed=action==='failed-revision';const command=decodeStandardUniformSubmission(transfer(200,64)).commands[0],prepared=c.ok(store.prepareTransfer(1,command),'original upload ticket');c.same(store.executeTransfer(prepared.ticket).ok,!failed,'actual upload revision');
  }
  if(action==='dispose')c.ok(store.dispose(),'dispose with pending range');
  const stale=['lease','context','revision','failed-revision','dispose','submitted-upload'].includes(action);c.same(access.validate(range.token).ok,!stale,'pending range owns exact lease/context/revision');
  if(!stale)c.ok(access.submit(range.token),'submit exact retained range');c.same(access.submit(range.token).ok,false,'range cannot submit twice');
  c.ok(access.release(range.token),'release pending/submitted/revoked range once');c.same(access.release(range.token).ok,false,'released range rejects');
  const before=store.inspect();c.ok(store.dispose(),'range final store cleanup');for(const [key,value]of Object.entries(store.inspect().budgets))c.same(value,0,'zero range budget '+key);ownership.push({action,original,range:{generation:range.generation,offset:range.offset,length:range.byteLength},before,after:store.inspect()});
 }
 {const owner=c.ok(createStandardUniformResourceStore({backend,limits:{tickets:2}}),'bounded uniform ticket owner'),{store,uniformAccess:access}=owner;c.ok(store.createContext(1),'budget context');c.ok(store.createResource(meta(200,0,64,16,64)),'vertex creation hint');c.ok(store.attachContext(1,200),'budget member');c.ok(store.attachBacking(200,[new Uint8Array(64)]),'budget backing');const lease=c.ok(store.retainStorage(1,200,'uniform'),'vertex can serve uniform').lease,a=c.ok(access.capture(lease,0,16),'ticket1'),b=c.ok(access.capture(lease,16,16),'ticket2');c.same(access.capture(lease,32,16).error.code,'limit-exceeded','uniform ranges share ticket ceiling');c.same(store.prepareTransfer(1,decodeStandardUniformSubmission(transfer(200,64)).commands[0]).error.code,'limit-exceeded','range snapshots share transfers ceiling');c.ok(access.release(a.token),'return first token');c.ok(access.release(b.token),'return second token');c.ok(store.releaseStorage(lease),'return original lease');c.ok(store.dispose(),'bounded owner cleanup');}
 {const owner=c.ok(createStandardUniformResourceStore({backend}),'strict original range owner'),{store,uniformAccess:access}=owner;c.ok(store.createContext(1),'strict range context');c.ok(store.createResource(meta(200,0,64,80,64)),'original combined role');c.ok(store.attachContext(1,200),'strict range membership');const lease=c.ok(store.retainStorage(1,200,'uniform'),'strict range lease').lease,vertex=c.ok(store.retainStorage(1,200,'vertex'),'constant creation hint can serve vertex').lease;let invoked=0;const adversarial=new Proxy({valueOf(){invoked++;return 0;}},{get(){invoked++;throw Error('unexpected getter');}});for(const args of [[adversarial,0,16],[lease,adversarial,16],[lease,0,adversarial],[vertex,0,16]])c.same(access.capture(...args).ok,false,'primitive range and capability identities reject');c.same(invoked,0,'range inputs never invoke proxy/getter/coercion');for(const token of [adversarial,{},null]){c.same(access.validate(token).ok,false,'foreign pending range');c.same(access.submit(token).ok,false,'foreign submitted range');c.same(access.release(token).ok,false,'foreign released range');}c.ok(store.dispose(),'strict range cleanup');}
 const old=c.ok(createResourceStore({backend}),'old factory');c.same(Object.hasOwn(old,'uniformAccess'),false,'old public shape stays isolated');c.ok(old.store.dispose(),'old cleanup');
 let getters=0;const malformed=meta(200,0,64,64,64);Object.defineProperty(malformed,'width',{get(){getters++;return 64;}});const owner=c.ok(createStandardUniformResourceStore({backend}),'descriptor owner');c.same(owner.store.createResource(malformed).ok,false,'metadata accessors reject');c.same(getters,0,'metadata getter never runs');c.ok(owner.store.dispose(),'descriptor cleanup');
 c.same(createVirglStandardAsyncRenderer({uniformAccess:{}}).ok,false,'old state facet rejects new capability');
 return{status:'passed',records,layouts,ownership,predictions:c.rows};
}

function rig(gl,bridge,c,s,{delay=0,step=64,resourceLimits,stateLimits,cacheLimits,jobLimits,fault,hostFault,nativeFault}={}){
 const trace=traceGL(gl,c,delay),allocations=[],draws=[],requests=[],leases=[],faultEvents=[];let faultArmed=false,calls=0;
 const native=new Proxy(trace.gl,{get(target,name){
  const base=Reflect.get(target,name,target);if(typeof base!=='function')return base;
  if(name==='getParameter'&&hostFault)return parameter=>{const value=base(parameter);const pins={vertex:gl.MAX_VERTEX_UNIFORM_BLOCKS,fragment:gl.MAX_FRAGMENT_UNIFORM_BLOCKS,combined:gl.MAX_COMBINED_UNIFORM_BLOCKS,block:gl.MAX_UNIFORM_BLOCK_SIZE,binding:gl.MAX_UNIFORM_BUFFER_BINDINGS,alignment:gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT};return parameter===pins[hostFault]?hostFault==='alignment'?0:hostFault==='block'?16383:hostFault==='vertex'?13:hostFault==='fragment'?12:26:value;};
  if(nativeFault&&name===nativeFault.method)return(...args)=>{
   if(faultArmed&&++calls===nativeFault.ordinal){faultEvents.push({method:name,ordinal:calls,mode:nativeFault.mode});
    if(nativeFault.mode==='null')return null;if(nativeFault.mode==='wait')return gl.WAIT_FAILED;
    if(nativeFault.mode==='error'){const result=base(...args);gl.enable(0);return result;}
   }return base(...args);
  };
  if(name==='bindBufferRange'&&fault==='range-offset')return(target,binding,buffer,offset,length)=>base(target,binding,buffer,binding===14?offset+s.alignment:offset,length);
  if(!['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'].includes(name))return base;
  return(...args)=>{
   const program=gl.getParameter(gl.CURRENT_PROGRAM),blocks=[];
   for(let index=0;index<gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS);index++){
    const name=gl.getActiveUniformBlockName(program,index),binding=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_BINDING),buffer=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,binding),allocation=allocations.find(a=>a.storage.buffer===buffer),members=[...gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)].map(i=>{const m=gl.getActiveUniform(program,i);return{name:m.name,type:m.type,count:m.size,offset:gl.getActiveUniforms(program,[i],gl.UNIFORM_OFFSET)[0],stride:gl.getActiveUniforms(program,[i],gl.UNIFORM_ARRAY_STRIDE)[0],blockIndex:gl.getActiveUniforms(program,[i],gl.UNIFORM_BLOCK_INDEX)[0]};});
    let raw=null;if(buffer){gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);raw=new Uint8Array(gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE));gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,null);}
    blocks.push({name,index,binding,bytes:gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE),vertex:gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER),fragment:gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER),start:gl.getIndexedParameter(gl.UNIFORM_BUFFER_START,binding),length:gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE,binding),resourceId:allocation?.metadata.id??null,generation:allocation?.generation??null,members,raw});
   }
   const attributes=[];
   for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){
    const info=gl.getActiveAttrib(program,i),location=gl.getAttribLocation(program,info.name);if(location<0)continue;
    const buffer=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),allocation=allocations.find(a=>a.storage.buffer===buffer);let raw=null;
    if(allocation){raw=new Uint8Array(allocation.metadata.byteLength);gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,null);}
    attributes.push({name:info.name,shaderType:info.type,location,enabled:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED),integer:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_INTEGER),type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),normalized:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),genericValues:[...gl.getVertexAttrib(location,gl.CURRENT_VERTEX_ATTRIB)],resourceId:allocation?.metadata.id??null,generation:allocation?.generation??null,raw});
   }
   draws.push({label:r.currentLabel,name,args:[...args],blocks,attributes,shaders:gl.getAttachedShaders(program).map(shader=>({stage:gl.getShaderParameter(shader,gl.SHADER_TYPE),glsl:gl.getShaderSource(shader)}))});return base(...args);
  };
 }});
 const backend=c.ok(createWebGL2TransferBackend(native),'real uniform backend').backend,owner=c.ok(createStandardUniformResourceStore({backend:{...backend,allocate(metadata){const storage=backend.allocate(metadata);allocations.push({metadata,storage});return storage;},upload(storage,metadata,layout,bytes){if(fault==='block-word'&&metadata.id===200){bytes=bytes.slice();bytes[s.banks[0].offset+s.vector*16]^=1;}return backend.upload(storage,metadata,layout,bytes);}},...(resourceLimits?{limits:resourceLimits}:{})}),'uniform resource owner');
 const original=bridge,selected={...bridge,translatePairUniforms(request){const result=original.translatePairUniforms(request);requests.push({request:{...request},result:JSON.parse(JSON.stringify(result))});return result;}};
 const store={...owner.store,retainStorage(...args){const answer=owner.store.retainStorage(...args);if(answer.ok)leases.push({lease:answer.lease,role:args[2],id:args[1]});return answer;}};
 const built=createVirglStandardUniformAsyncRenderer({gl:native,shaderBridge:selected,resources:store,bindings:owner.bindings,asyncAccess:owner.asyncAccess,uniformAccess:owner.uniformAccess,
  jobLimits:{commandsPerStep:step,...jobLimits},...(stateLimits?{limits:stateLimits}:{}),...(cacheLimits?{cacheLimits}:{}),primitiveAssembly:'lists'});
 if(hostFault){c.same(built.error?.code,'unsupported-host','native uniform limit gate');c.ok(owner.store.dispose(),'host rejection resource cleanup');return{hostRejected:built};}
 const renderer=c.ok(built,'selected original uniform renderer').renderer;
 const r={gl,c,bridge:selected,...owner,store,renderer,trace,allocations,draws,requests,leases,created:[],faultEvents,armFault(){faultArmed=true;calls=0;},width:s.width,height:s.height,frame:0,history:[],exchanges:[],blobs:[],frames:[],currentLabel:''};r.add=(metadata,bytes)=>{const resource=add(r,metadata,bytes);r.created.push({metadata:{...metadata},generation:resource.generation,beforeSubmission:r.history.length});return resource;};
 for(const id of[1,2]){c.ok(store.createContext(id),'uniform resource context');c.ok(renderer.createContext(id),'uniform state context');}
 r.add(meta(1,2,67,2,s.width,s.height),new Uint8Array(s.width*s.height*4));return r;
}
async function frame(r,record,s){
 r.c.ok(record.result,'original uniform draw completion');r.c.same(record.result.gpuComplete,true,'actual uniform GPU fence');
 const gl=r.gl,fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const name of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[name],0);
 const raw=new Uint8Array(s.width*s.height*4);gl.readPixels(0,0,s.width,s.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);gl.deleteFramebuffer(fb);
 const native=[];for(const draw of r.draws.filter(row=>row.label===record.label)){const blocks=[],attributes=[];for(const block of draw.blocks){const{raw,...info}=block;blocks.push({...info,storage:raw?await blob(r,raw):null});}for(const attribute of draw.attributes){const{raw,...info}=attribute;attributes.push({...info,storage:raw?await blob(r,raw):null});}native.push({...draw,blocks,attributes});}
 const expected=s.expected,misses=[];for(let at=0;at<raw.length;at++)if(raw[at]!==expected[at%4]){misses.push({at,expected:expected[at%4],actual:raw[at]});if(misses.length===16)break;}
 const row={label:record.label,width:s.width,height:s.height,expected,native,created:r.created.map(row=>({...row})),history:r.history.map(({hex,ctx,result,label})=>({hex,ctx,result,label})),inputs:r.exchanges.map(e=>({...e})),dump:record.dump,pixels:await blob(r,raw),audit:{held:misses.length===0,misses}};r.frames.push(row);
 r.c.same(misses,[],'independent original uniform pixels after completed fence');r.c.same(gl.getError(),gl.NO_ERROR,'uniform capture no GL error');return row;
}
export async function runAcceptance({smoke=false,fault}={}){
 const c=checks(),report={schema:'original-uniform-buffer-bindings-v1',status:'running',guestExecution:false,productionNegotiation:false,predictions:c.rows,frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[]};window.__standardUniformBindingEvidence=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('physical uniform GPU required');
 const bridge=await createVirglStandardUniformShaderBridge(),alignment=gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);report.host={alignment,vertex:gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS),fragment:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS),combined:gl.getParameter(gl.MAX_COMBINED_UNIFORM_BLOCKS),bindings:gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),blockBytes:gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE)};
 const make=(s,options={})=>{const r=rig(gl,options.bridge??bridge,c,s,options);if(!r.hostRejected){r.frames=report.frames;r.blobs=report.blobs;}return r;};
 const done=r=>{const inspection=c.ok(r.renderer.inspect(),'uniform final job ownership');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes','uniformPending','uniformHolds'])c.same(inspection.jobs[key],0,'uniform job released '+key);const run={history:r.history,requests:r.requests,events:r.trace.events,calls:r.trace.calls.map(({program,...row})=>row),faultEvents:r.faultEvents,inspection,uniformAccess:r.uniformAccess.inspect()};report.runs.push(run);dispose(r);run.final={renderer:r.renderer.inspect(),resources:r.store.inspect(),uniformAccess:r.uniformAccess.inspect()};};
 const run=async(options,label,extra={})=>{const s=specimen({alignment,...options}),r=make(s,extra);r.currentLabel=label;const rec=await submit(r,1,join(setup(r,s),draw(s)),label);await frame(r,rec,s);done(r);};
 if(smoke||fault){await run({slots:[0],count:2,vector:1,shift:0},'uniform-binding-smoke',{fault});report.status='passed';return report;}
 for(const stage of ['vertex','fragment','both'])for(const slot of [0,1,12])for(const shift of [0,8,16,24])await run({stage,slots:[slot],shift},'original-'+stage+'-'+slot+'-'+shift,{delay:2,step:3});
 for(const stage of ['vertex','fragment','both'])for(const slot of [0,1,12])for(const shift of [0,8,16,24])await run({stage,slots:[slot],vector:0,shift},'original-first-'+stage+'-'+slot+'-'+shift,{delay:1,step:2});
 for(const stage of ['vertex','fragment'])for(const slot of [0,1,12])for(const offset of [-32768,32767])await run({stage,slots:[slot],offset,shift:24,indexed:true},'original-offset-'+stage+'-'+slot+'-'+offset,{delay:3,step:1});
 for(const zeroInlineMask of [0,1,2,3])await run({slots:Array.from({length:13},(_,i)=>i),zeroInlineMask,shift:8},'all26-banks-'+zeroInlineMask,{step:3});
 for(const constant of [false,true])for(const zeroInlineMask of [0,1,2,3])for(const shift of [0,8,16,24])await run({slots:[0,12],zeroInlineMask,formats:true,constant,shift,indexed:true},'four-formats-'+constant+'-'+zeroInlineMask+'-'+shift,{delay:4,step:1});
 for(const bindBanks of [false,true]){const s=specimen({alignment,slots:[1,12],unused:true}),r=make(s);r.currentLabel='unused-'+bindBanks;await frame(r,await submit(r,1,join(setup(r,s,{bindBanks}),draw(s)),r.currentLabel),s);done(r);}
 {const s=specimen({alignment,slots:[1],count:4}),r=make(s,{delay:4,step:1});r.currentLabel='repeated-original-draws';const rec=await submit(r,1,join(setup(r,s),bind(5,14,0xffffffff,0xffffffff,0),draw(s),draw(s),draw(s)),r.currentLabel);await frame(r,rec,s);c.same(rec.result.draws.length,3,'repeated draw holds deduplicate one original allocation');done(r);}
 for(const evict of [false,true]){
  const s=specimen({alignment,slots:[0],count:2,vector:1,shift:16}),r=make(s,{delay:3,step:1,...(evict?{stateLimits:{programs:1},cacheLimits:{translations:1}}:{})});r.currentLabel='variant-first';await frame(r,await submit(r,1,join(setup(r,s),draw(s)),r.currentLabel),s);
  for(const [i,bytes]of [packet(12,0,[1,0,...s.banks[0].words]),packet(12,0,[0,0,...s.banks[0].words]),bind(1,0,s.banks[0].offset,s.banks[0].length,200),bind(0,0,s.banks[0].offset,s.banks[0].length,200),packet(12,0,[1,0,...s.banks[0].words]),bind(1,0,s.banks[0].offset,s.banks[0].length,200)].entries()){r.currentLabel='variant-'+evict+'-'+i;await frame(r,await submit(r,1,join(bytes,draw(s)),r.currentLabel),s);}
  c.same(r.requests.map(row=>row.request.bufferZeroMask).includes(0),true,'inline variant reaches original pair compiler');c.same(new Set(r.requests.map(row=>row.request.bufferZeroMask)).size,4,'both original slot-zero bits in cache');report.ownership.push({kind:'variant-cache',evict,requests:r.requests,inspection:r.renderer.inspect()});done(r);
 }
 for(const phase of ['waiting-index','waiting-attributes'])for(const action of ['revision','failed-revision','unref-reuse','detach','backing','cancel','context','lease','resource-dispose']){
  const s=specimen({alignment,slots:[1],count:4,shift:0,indexed:phase==='waiting-index',constant:phase==='waiting-attributes'}),r=make(s,{delay:7,step:1});c.ok((await submit(r,1,setup(r,s),'pending-setup')).result,'pending original setup');let fired=false,point;r.currentLabel='pending-'+phase+'-'+action;
  const rec=await submit(r,1,join(clear([0,0,0,0]),draw(s)),r.currentLabel,(_step,token)=>{const before=r.renderer.inspect();if(fired||before.jobs.status!==phase)return;fired=true;point={before,access:r.uniformAccess.inspect(),resources:r.store.inspect()};
   const bank=s.banks[0];if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel pending original uniform draw');
   else if(action==='unref-reuse'){c.ok(r.store.unref(bank.id),'drop original public name');r.add(meta(bank.id,0,64,64,bank.data.length),new Uint8Array(bank.data.length));}
   else if(action==='detach')c.ok(r.store.detachContext(1,bank.id),'detach original membership');
   else if(action==='context'){c.ok(r.store.destroyContext(1),'destroy original resource context');c.ok(r.store.createContext(1),'reuse resource context ID');}
   else if(action==='lease'){const lease=r.leases.find(row=>row.role==='uniform'&&row.id===bank.id).lease;c.ok(r.store.releaseStorage(lease),'release exact bound lease');}
   else if(action==='resource-dispose')c.ok(r.store.dispose(),'dispose store while range/index reads pending');
   else {const bytes=bank.data.slice();bytes.fill(123);c.ok(r.store.writeBacking(bank.id,0,bytes),'modify owned backing');if(action!=='backing'){const command=decodeStandardUniformSubmission(transfer(bank.id,bytes.length)).commands[0],ticket=c.ok(r.store.prepareTransfer(1,command),'capture concurrent original upload');if(action==='failed-revision'){const resolved=r.allocations.find(a=>a.metadata.id===bank.id);gl.bindBuffer(gl.COPY_WRITE_BUFFER,resolved.storage.buffer);gl.bufferSubData(gl.COPY_WRITE_BUFFER,0,bytes);gl.enable(0);}const uploaded=r.store.executeTransfer(ticket.ticket);c.same(uploaded.ok,action!=='failed-revision','failed/successful GPU write revises snapshot');}}
  });c.same(fired,true,'original pending phase reached');const healthy=['unref-reuse','detach','backing'].includes(action);
  if(healthy)await frame(r,rec,s);else{c.same(rec.result.ok,false,'pending original range invalidation rejects');c.same(r.trace.calls.filter(row=>row.label===r.currentLabel).length,0,'stale pending range never draws');if(action!=='resource-dispose')c.same(rec.result.gpuComplete,true,'pending range rejection drains native GPU');report.rejections.push(rec);}
  report.suspensions.push({phase,action,point,record:rec});if(action==='lease')c.ok(r.store.dispose(),'already released bound lease shutdown');done(r);
 }
 for(const releaseName of [false,true]){
  const s=specimen({alignment,slots:[1],count:4,shift:16}),r=make(s,{delay:5,step:1});c.ok((await submit(r,1,setup(r,s),'hold-setup')).result,'original hold setup');let point;
  r.currentLabel='submitted-hold-'+releaseName;
  const tail=releaseName?join(bind(0,1,0,0,0),bind(1,1,0,0,0)):new Uint8Array();
  const rec=await submit(r,1,join(draw(s),tail),r.currentLabel,()=>{
   const state=r.renderer.inspect();if(point||state.jobs.status!=='finishing')return;
   point={renderer:state,access:r.uniformAccess.inspect(),resources:r.store.inspect()};
   c.same(state.jobs.uniformHolds,1,'same original allocation has one submitted hold');c.same(state.jobs.uniformPending,0,'submitted snapshots no longer pending');
   if(releaseName)c.ok(r.store.unref(s.banks[0].id),'last public name removed after bound leases released');
   else {const bytes=s.banks[0].data.slice();bytes.fill(91);c.ok(r.store.writeBacking(s.banks[0].id,0,bytes),'later ordered submitted contents');const ticket=c.ok(r.store.prepareTransfer(1,decodeStandardUniformSubmission(transfer(s.banks[0].id,bytes.length)).commands[0]),'later ordered GPU upload');c.ok(r.store.executeTransfer(ticket.ticket),'submitted hold permits later ordered upload');}
   point.after=r.store.inspect();
  });c.same(Boolean(point),true,'submitted allocation remains through final native fence');await frame(r,rec,s);report.ownership.push({kind:'submitted-hold',releaseName,point});
  if(releaseName){const replacement=specimen({alignment,slots:[1],count:4,shift:16,seed:0x13579bdf}),bank=replacement.banks[0],originalGeneration=rec.result.draws[0].uniformRanges[0].resourceGeneration;r.add(meta(bank.id,0,64,80,bank.data.length),bank.data);r.currentLabel='explicit-rebind';await frame(r,await submit(r,1,join(transfer(bank.id,bank.data.length),bind(0,1,bank.offset,bank.length,bank.id),bind(1,1,bank.offset,bank.length,bank.id),draw(replacement)),r.currentLabel),replacement);c.same(r.frames.at(-1).native[0].blocks.find(b=>b.resourceId===bank.id).generation!==originalGeneration,true,'explicit rebind captures new allocation');}
  done(r);
 }
 {
  const a=specimen({alignment,slots:[0,12],count:4,shift:8}),b=specimen({alignment,slots:[0,12],count:4,shift:24,seed:0x2419bdac}),r=make(a,{delay:3,step:1}),poison=gl.createBuffer();
  const dirt=()=>{gl.bindBuffer(gl.UNIFORM_BUFFER,poison);gl.bufferData(gl.UNIFORM_BUFFER,16384,gl.STATIC_DRAW);for(let i=0;i<27;i++)gl.bindBufferBase(gl.UNIFORM_BUFFER,i,poison);gl.useProgram(null);gl.bindVertexArray(null);};
  r.currentLabel='restore-A-first';await frame(r,await submit(r,1,join(setup(r,a),draw(a)),r.currentLabel),a);
  for(const[id,bytes]of b.data)c.ok(r.store.writeBacking(id,0,bytes),'context B original backing');dirt();r.currentLabel='restore-B';await frame(r,await submit(r,2,join(setup(r,b,{create:false}),draw(b)),r.currentLabel),b);
  for(const[id,bytes]of a.data)c.ok(r.store.writeBacking(id,0,bytes),'context A original backing');c.ok(r.renderer.resetCaches(),'uniform cold native cache');dirt();r.currentLabel='restore-A-last';await frame(r,await submit(r,1,join(...[...a.data].map(([id,bytes])=>transfer(id,bytes.length)),draw(a)),r.currentLabel),a);
  r.currentLabel='subcontext-new';await frame(r,await submit(r,1,join(packet(29,0,[7]),packet(28,0,[7]),setup(r,a,{create:false}),draw(a)),r.currentLabel),a);
  dirt();r.currentLabel='subcontext-old';await frame(r,await submit(r,1,join(packet(28,0,[0]),packet(30,0,[7]),draw(a)),r.currentLabel),a);gl.deleteBuffer(poison);report.ownership.push({kind:'native-context-restoration',contexts:r.renderer.inspect().contexts});done(r);
 }
 for(const [label,options,specOptions]of [
  ['partial-range-budget',{resourceLimits:{tickets:1}},{slots:[1,12],count:4}],
  ['read-after-range-budget',{resourceLimits:{tickets:2}},{slots:[1],count:4,indexed:true}],
  ['partial-attribute-read-budget',{resourceLimits:{tickets:3}},{slots:[1],count:4,formats:true,constant:true,indexed:true}],
  ['zero-backing-short',{stateLimits:{uniformBytes:16384+655}},{slots:[1],count:4,unused:true}],
  ['zero-backing-exact',{stateLimits:{uniformBytes:16384+656}},{slots:[1],count:4,unused:true}],
 ]){
  const s=specimen({alignment,...specOptions}),r=make(s,{delay:4,step:1,...options});r.currentLabel=label;const rec=await submit(r,1,join(setup(r,s,{bindBanks:!s.unused}),draw(s)),label);
  if(label==='zero-backing-exact')await frame(r,rec,s);else{c.same(rec.result.ok,false,'bounded uniform failure '+label);c.same(r.trace.calls.length,0,'partial budget fails before draw');report.rejections.push(rec);}done(r);
 }
 for(const nativeFault of [
  {method:'createBuffer',ordinal:1,mode:'null'},{method:'createBuffer',ordinal:2,mode:'null'},
  {method:'bufferData',ordinal:1,mode:'error'},{method:'bufferData',ordinal:2,mode:'error'},
  {method:'fenceSync',ordinal:1,mode:'null'},{method:'clientWaitSync',ordinal:1,mode:'wait'},
  {method:'getBufferSubData',ordinal:2,mode:'error'},
 ]){
  const inLink=['createBuffer','bufferData'].includes(nativeFault.method),s=specimen({alignment,slots:[1],count:4,...(inLink?{unused:true}:{formats:true,constant:true,indexed:true})}),r=make(s,{delay:2,step:1,nativeFault});
  const prefix=setup(r,s,{bindBanks:!inLink});if(!inLink)c.ok((await submit(r,1,prefix,'native-failure-setup')).result,'native failure original setup');r.armFault();r.currentLabel='native-failure-'+nativeFault.method+'-'+nativeFault.ordinal;
  const rec=await submit(r,1,join(...(inLink?[prefix]:[]),draw(s)),r.currentLabel);c.same(rec.result.ok,false,'native uniform failure unwinds');c.same(r.faultEvents.length,1,'native fault boundary actually exercised');report.rejections.push(rec);report.ownership.push({kind:'native-failure',nativeFault,record:rec});done(r);
 }
 for(const phase of ['waiting-attributes','finishing']){
  const s=specimen({alignment,slots:[1],count:4,constant:phase==='waiting-attributes'}),r=make(s,{delay:6,step:1});c.ok((await submit(r,1,setup(r,s),'renderer-disposal-setup')).result,'renderer disposal setup');const token=c.ok(r.renderer.beginSubmission(1,draw(s)),'renderer disposal job').job;let point;
  for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'advance actual renderer disposal job');const state=r.renderer.inspect();if(state.jobs.status===phase){point={renderer:state,access:r.uniformAccess.inspect()};break;}}
  c.same(Boolean(point),true,'uniform renderer disposed with '+phase+' ownership');c.ok(r.renderer.dispose(),'renderer disposal releases pending/submitted ranges');c.same(r.renderer.step(token).ok,false,'disposed renderer token rejects');report.ownership.push({kind:'renderer-disposal',phase,point});done(r);
 }
 for(const mode of ['missing','short','unaligned','outside','index-role','missing-id','inline-clear']){
  const s=specimen({alignment,slots:[1],count:4}),r=make(s);c.ok((await submit(r,1,setup(r,s),'rejection-setup')).result,'range rejection setup');const bank=s.banks[0];let prefix;
  if(mode==='missing')prefix=bind(0,1,0xffffffff,0xffffffff,0);else if(mode==='short')prefix=bind(0,1,bank.offset,bank.length-1,bank.id);else if(mode==='unaligned')prefix=bind(0,1,bank.offset+1,bank.length,bank.id);else if(mode==='outside')prefix=bind(0,1,bank.offset,bank.data.length,bank.id);else if(mode==='inline-clear')prefix=packet(12,0,[0,1]);else if(mode==='missing-id')prefix=bind(0,1,0,64,777);else{r.add(meta(6,0,64,32,64),new Uint8Array(64));prefix=bind(0,1,0,64,6);}
  r.currentLabel='reject-'+mode;const rec=await submit(r,1,join(prefix,draw(s)),r.currentLabel);c.same(rec.result.ok,false,'original binding rejection '+mode);c.same(r.trace.calls.filter(call=>call.label===r.currentLabel).length,0,'invalid range before draw');report.rejections.push(rec);done(r);
 }
 for(const hostFault of ['vertex','fragment','combined','block','binding','alignment']){const s=specimen({alignment});report.rejections.push(make(s,{hostFault}).hostRejected);}
 report.status='passed';return report;
}
