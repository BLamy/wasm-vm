import {createStandardIntegerColorResourceStore,createStandardIntegerColorTransferBackend} from '../resources.mjs';
import {createVirglStandardIntegerImageAsyncRenderer} from '../state.mjs';
import {checks,traceGL,add as addResource,dispose,blob as bytesBlob} from './standard-instanced-draws.mjs';
import {submit} from './standard-shared-exponent-consumer-rig.mjs';
import {nativeRead as integerRead} from './standard-integer-image-rig.mjs';
import {nativeRead as priorRead} from './standard-shared-exponent-consumer-rig.mjs';
import {originalFormat,metadata} from '../../../tools/virgl-integer-image-consumer/fixtures.mjs';
export {checks,submit};
export const blob=(report,input)=>bytesBlob(report,new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice());
export function nativeRead(r,texture,format,width,height,level=0){
 r.c.same(Boolean(r.lastCompletion),true,'native diagnostic follows actual physical completion');
 const old=r.diagnosticActive;r.diagnosticActive=true;
 try{return originalFormat(format)?integerRead(r,texture,width,height,level,originalFormat(format).signed):
  priorRead({...r,gl:r.traced},texture,format,width,height,level);}
 finally{r.diagnosticActive=old;}
}
const drawNames=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'];
const samplerNames=['TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_MIN_LOD','TEXTURE_MAX_LOD'];
export function rig(gl,bridge,c,f,{delay=0,step=64,fault=null,nativeFault=null,primitiveAssembly='native',limits={},resourceLimits}={}){
 const trace=traceGL(gl,c,delay),allocations=[],nativeObjects=[],events=[],draws=[],requests=[],faultEvents=[],uploads=[],readbacks=[],retiredPlanes=[];
 const syncs=new Map();let sequence=0,completed=null,currentLabel='',diagnosticActive=false,armed=false,failed=false,r;
 const id=object=>trace.id(object),emit=row=>events.push({sequence:++sequence,label:currentLabel,...row});
 const traced=new Proxy(trace.gl,{get(target,name){
  const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   const delivered=[...args];
   if(armed&&!failed&&nativeFault===name){failed=true;faultEvents.push({name,label:currentLabel,result:null});return null;}
   if(fault==='original-level'&&name==='bindTexture'&&args[0]===gl.TEXTURE_2D&&
    gl.getParameter(gl.ACTIVE_TEXTURE)===gl.TEXTURE0+(f.stage==='vertex'?16:0)+f.slot){
    const source=allocations.find(a=>a.metadata.id===6&&a.metadata.width===17),range=allocations.find(a=>a.storage.texture===args[1]);
    if(source&&range&&originalFormat(range.metadata.format)&&range.metadata.width!==17){
     delivered[1]=source.storage.texture;faultEvents.push({name,label:currentLabel,original:id(args[1]),delivered:id(delivered[1])});
    }
   }
   if(fault==='original-words'&&name==='texSubImage2D'&&ArrayBuffer.isView(args[8])){
    const allocation=allocations.find(a=>a.storage.texture===gl.getParameter(gl.TEXTURE_BINDING_2D));
    if(allocation?.metadata.id===6&&originalFormat(allocation.metadata.format)){
     delivered[8]=args[8].slice();for(let i=0;i<delivered[8].length;i++)delivered[8][i]^=1;
     faultEvents.push({name,label:currentLabel,texture:id(allocation.storage.texture),original:[...args[8]],delivered:[...delivered[8]]});
    }
   }
   if(armed&&!failed&&nativeFault==='integer-clear'&&['clearBufferiv','clearBufferuiv'].includes(name)){
    failed=true;delivered[0]=0;faultEvents.push({name,label:currentLabel,original:args[0],delivered:0});
   }
   if(name==='deleteTexture'&&!diagnosticActive&&currentLabel.startsWith('queued-')){
    const allocation=allocations.find(a=>a.storage.texture===args[0]&&a.metadata.id===1),draw=draws.findLast(d=>d.native.attachment===id(args[0]));
    if(allocation&&draw&&completed?.sequence>draw.sequence){
     const m=allocation.metadata,level=draw.native.level,width=Math.max(1,m.width>>level),height=Math.max(1,m.height>>level);
     retiredPlanes.push({texture:id(args[0]),metadata:m,level,width,height,completion:{...completed},raw:nativeRead(r,args[0],m.format,width,height,level)});
    }
   }
   if(drawNames.includes(name)&&!diagnosticActive){
    const program=gl.getParameter(gl.CURRENT_PROGRAM),copy=gl.getUniformLocation(program,'sourceTexture')!==null;
    if(!copy){
     const active=gl.getParameter(gl.ACTIVE_TEXTURE),samplers=[],queries=[],attributes=[];
     for(let index=0;index<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);index++){
      const uniform=gl.getActiveUniform(program,index),location=gl.getUniformLocation(program,uniform.name);
      if(uniform.type===gl.INT&&/^[vf]ssamplevels/.test(uniform.name))queries.push({name:uniform.name,type:uniform.type,value:gl.getUniform(program,location)});
      if(![gl.SAMPLER_2D,gl.INT_SAMPLER_2D,gl.UNSIGNED_INT_SAMPLER_2D].includes(uniform.type))continue;
      const unit=gl.getUniform(program,location);gl.activeTexture(gl.TEXTURE0+unit);
      const sampler=gl.getParameter(gl.SAMPLER_BINDING),texture=gl.getParameter(gl.TEXTURE_BINDING_2D),
       allocation=allocations.find(a=>a.storage.texture===texture);
      samplers.push({name:uniform.name,type:uniform.type,unit,sampler:id(sampler),texture:id(texture),metadata:allocation?.metadata,
       parameters:Object.fromEntries(samplerNames.map(key=>[key,gl.getSamplerParameter(sampler,gl[key])])),
       base:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),last:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL)});
     }
     gl.activeTexture(active);
     for(let index=0;index<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);index++){
      const attribute=gl.getActiveAttrib(program,index),location=gl.getAttribLocation(program,attribute.name);
      attributes.push({name:attribute.name,type:attribute.type,location,buffer:id(gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)),
       stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),
       integer:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_INTEGER),divisor:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_DIVISOR)});
     }
     draws.push({name,args:[...delivered],label:currentLabel,sequence:sequence+1,samplers,queries,attributes,
      native:{program:id(program),vao:id(gl.getParameter(gl.VERTEX_ARRAY_BINDING)),framebuffer:id(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),
       attachment:id(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),
       level:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),
       componentType:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE),
       mask:[...gl.getParameter(gl.COLOR_WRITEMASK)],blend:gl.isEnabled(gl.BLEND),scissor:gl.isEnabled(gl.SCISSOR_TEST)},
      shaders:gl.getAttachedShaders(program).map(shader=>({type:gl.getShaderParameter(shader,gl.SHADER_TYPE),glsl:gl.getShaderSource(shader)}))});
    }
   }
   const answer=method(...delivered);
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)
    nativeObjects.push({object:answer,id:id(answer),name,label:currentLabel,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){
    const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'native image object retires once');}
   }
   if(name==='fenceSync'&&answer){
    c.same(syncs.has(answer),false,'native fence identity is unique');
    const entry={id:syncs.size+1,identity:answer.constructor.name,createdSequence:sequence+1,polls:[],deleted:0};
    c.same(entry.identity,'WebGLSync','actual native sync object');syncs.set(answer,entry);
    emit({name,sync:entry.id,identity:entry.identity,args:[...args]});
   }else if(name==='clientWaitSync'){
    const entry=syncs.get(args[0]),actual=trace.events.at(-1);
    const row={name,sync:entry.id,args:args.slice(1),actual:actual.actual,delivered:answer};
    emit(row);entry.polls.push({...events.at(-1)});
    if(answer===gl.ALREADY_SIGNALED||answer===gl.CONDITION_SATISFIED){completed={sync:entry.id,sequence,actual:actual.actual,delivered:answer};entry.completed=completed;}
   }else if(name==='deleteSync'){
    const entry=syncs.get(args[0]);c.same(Boolean(entry),true,'retire actual owned sync');entry.deleted++;
    c.same(entry.deleted,1,'physical sync retires once');emit({name,sync:entry.id});
   }else if(name==='readPixels'||name==='getBufferSubData'){
    const data=name==='readPixels'?delivered[6]:delivered[2],cpu=ArrayBuffer.isView(data);
    if(cpu)c.same(Boolean(completed),true,'CPU collection follows physical native completion');
    emit({name,cpu,completion:completed,args:delivered.slice(0,name==='readPixels'?6:2),
     target:name==='readPixels'?id(gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)):null,
     type:cpu?data.constructor.name:'PBO',bytes:cpu?data.byteLength:0});
    readbacks.push({...events.at(-1),raw:cpu?new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice():null});
   }else if(name==='texSubImage2D'){
    const data=delivered[8];emit({name,texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D)),type:ArrayBuffer.isView(data)?data.constructor.name:'PBO',args:delivered.slice(0,8)});
    uploads.push({...events.at(-1),raw:ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice():null});
   }else if(drawNames.includes(name)||['clearBufferiv','clearBufferuiv','clearBufferfv','texStorage2D','blitFramebuffer','framebufferTexture2D','shaderSource'].includes(name))
    emit({name,args:delivered.map(value=>ArrayBuffer.isView(value)||Array.isArray(value)?[...value]:value&&typeof value==='object'?id(value):value)});
   return answer;
  };
 }});
 const backend=c.ok(createStandardIntegerColorTransferBackend(traced),'selected original integer transfer backend').backend;
 const owner=c.ok(createStandardIntegerColorResourceStore({backend:{...backend,allocate(metadata){
  const storage=backend.allocate(metadata);allocations.push({metadata,storage});return storage;
 }},...(resourceLimits?{limits:resourceLimits}:{})}),'selected retained integer image owner');
 const selected={...bridge,translateImages(request){const result=bridge.translateImages(request);requests.push({method:'stage',request:{...request},result:JSON.parse(JSON.stringify(result))});return result;},
  translatePairImages(request){const result=bridge.translatePairImages(request);requests.push({method:'pair',request:{...request},result:JSON.parse(JSON.stringify(result))});return result;}};
 const renderer=c.ok(createVirglStandardIntegerImageAsyncRenderer({gl:traced,shaderBridge:selected,resources:owner.store,bindings:owner.bindings,
  asyncAccess:owner.asyncAccess,uniformAccess:owner.uniformAccess,imageAccess:owner.imageAccess,jobLimits:{commandsPerStep:step},
  primitiveAssembly,...limits}),'selected original integer async renderer').renderer;
 r={gl,traced,c,bridge:selected,...owner,renderer,trace,allocations,nativeObjects,events,draws,requests,faultEvents,uploads,readbacks,
  syncs,retiredPlanes,frame:0,history:[],exchanges:[],created:[],blobs:[],outputBackingBytes:20000,
  armFault(){armed=true;},get label(){return currentLabel;},setLabel(value){currentLabel=value;trace.label(value);},
  get currentLabel(){return currentLabel;},set currentLabel(value){currentLabel=value;},
  get diagnosticActive(){return diagnosticActive;},set diagnosticActive(value){diagnosticActive=value;},
  get lastCompletion(){return completed;}};
 r.add=(meta,bytes)=>{const resource=addResource(r,meta,bytes);r.created.push({metadata:{...meta},generation:resource.generation});return resource;};
 for(const ctx of [1,2]){c.ok(owner.store.createContext(ctx),'original resource context');c.ok(renderer.createContext(ctx),'original renderer context');}
 r.add(metadata(1,f.outputFormat,f.targetWidth,f.targetHeight,f.outputLastLevel,2),new Uint8Array(r.outputBackingBytes).fill(0x2e));
 return r;
}
export async function physicalFence(r,label){
 r.setLabel(label);const sync=r.traced.fenceSync(r.gl.SYNC_GPU_COMMANDS_COMPLETE,0);r.c.same(Boolean(sync),true,'physical fence allocation');r.traced.flush();
 try{let status;for(let i=0;i<1000;i++){
  await new Promise(resolve=>setTimeout(resolve,i%3));r.trace.nextTurn();status=r.traced.clientWaitSync(sync,0,0);
  if(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED)break;r.c.same(status,r.gl.TIMEOUT_EXPIRED,'bounded native fence status');
 }r.c.same(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED,true,'native physical fence completion');return r.lastCompletion;}
 finally{r.traced.deleteSync(sync);}
}
export async function finish(r,report,row){
 dispose(r);
 Object.assign(row,{history:r.history,exchanges:r.exchanges,created:r.created,requests:r.requests,events:r.events,draws:r.draws,
  fenceObjects:[...r.syncs.values()],faultEvents:r.faultEvents,
  allocations:r.allocations.map(a=>({metadata:a.metadata,texture:r.trace.id(a.storage.texture),buffer:r.trace.id(a.storage.buffer)})),
  nativeObjects:r.nativeObjects.map(({object,...value})=>value),
  final:{renderer:r.renderer.inspect(),resources:r.store.inspect(),images:r.imageAccess.inspect()}});
 for(const kind of ['uploads','readbacks']){row[kind]=[];for(const {raw,...value}of r[kind])row[kind].push({...value,bytes:raw?await blob(report,raw):null});}
 row.retiredPlanes=[];for(const {raw,...value}of r.retiredPlanes)row.retiredPlanes.push({...value,native:await blob(report,raw)});
 for(const sync of row.fenceObjects)r.c.same(sync.deleted,1,'all recorded sync identities retire once');
 for(const object of row.nativeObjects)r.c.same(object.deleted,1,'all native objects retire once');
 for(const budgets of [row.final.renderer.budgets,row.final.resources.budgets])for(const value of Object.values(budgets))r.c.same(value,0,'terminal native image budget drains');
 return row;
}
