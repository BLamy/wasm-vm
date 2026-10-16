import {createStandardImageResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglStandardImageAsyncRenderer} from '../state.mjs';
import {packet,join,meta,add,dispose,blob as byteBlob,traceGL} from './standard-instanced-draws.mjs';
import {nativeRead} from './standard-texture-storage.mjs';
const names=['TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_WRAP_R','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_COMPARE_MODE','TEXTURE_COMPARE_FUNC','TEXTURE_MIN_LOD','TEXTURE_MAX_LOD'];
// Preserve all bytes of packed native words; the older RGBA helper takes bytes.
export const blob=(report,input)=>byteBlob(report,new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice());
export async function submit(r,ctx,bytes,label,onYield=null){
 const {c,renderer,trace}=r,original=bytes.slice();trace.label(label);c.ok(renderer.beginFrame(++r.frame),'begin original image record');
 const begun=renderer.beginSubmission(ctx,bytes);let result,steps=0,disposed=false,appliedBeforeDispose;
 if(!begun.ok)result=begun;
 else{
  bytes.fill(255);
  for(;steps<10000;steps++){
   await new Promise(resolve=>setTimeout(resolve,steps%3));trace.nextTurn();
   const step=c.ok(renderer.step(begun.job),'owned later-task image step');
   if(step.status==='done'){result=step.result;break;}
   const stop=onYield?await onYield(step,begun.job,r):null;
   if(stop?.disposed){disposed=true;appliedBeforeDispose=stop.appliedCommands;result=renderer.step(begun.job);c.same(result.ok,false,'disposed image job refuses further steps');c.same(result.error.code,'disposed','disposed image job explicit error');break;}
   if(step.status==='needs-input'){
    const request=step.request,layout=request.layout,rows=[];
    for(let row=0;row<layout.rowCount;row++)rows.push(c.ok(r.store.readBacking(request.resource.id,layout.offset+row*layout.rowStride,layout.rowBytes),'fresh original image input row').bytes);
    const input=join(...rows);r.exchanges.push({label,direction:'upload',resource:request.resource,layout,blob:await blob(r,input)});
    c.ok(renderer.provideInput(begun.job,request.token,input),'owned original image input exchange');input.fill(255);c.same(renderer.provideInput(begun.job,request.token,input).ok,false,'consumed original image input token rejects');
   }
  }
  c.same(Boolean(result),true,'bounded original image job completion');c.same(renderer.step(begun.job).ok,false,'consumed original image job rejects');
 }
 const dump=disposed?null:c.ok(renderer.endFrame(r.frame),'end original image record').dump;
 const record={label,ctx,hex:[...original].map(v=>v.toString(16).padStart(2,'0')).join(''),result,steps,dump,...(disposed?{disposed,appliedBeforeDispose}: {})};r.history.push(record);return record;
}
export function rig(gl,bridge,c,s,{delay=0,step=64,fault,nativeFault,resourceLimits,jobLimits}={}){
 const trace=traceGL(gl,c,delay),allocations=[],draws=[],requests=[],nativeObjects=[],faultEvents=[],imageEvents=[];let armed=false,failed=false,currentLabel='';
 const object=o=>trace.id(o);
 const traced=new Proxy(trace.gl,{get(target,name){
  const base=Reflect.get(target,name,target);if(typeof base!=='function')return base;
  return(...args)=>{
   let delivered=[...args];
   if(armed&&!failed&&((nativeFault==='texture'&&name==='createTexture')||(nativeFault==='framebuffer'&&name==='createFramebuffer'))){failed=true;faultEvents.push({name,mode:nativeFault,label:currentLabel});return null;}
   if(armed&&!failed&&nativeFault==='copy'&&name==='blitFramebuffer'){delivered[8]=0x40000000;failed=true;faultEvents.push({name,mode:'copy',label:currentLabel,original:[...args],delivered});}
   if(fault==='copy-level'&&name==='framebufferTexture2D'&&args[0]===gl.READ_FRAMEBUFFER&&args[2]===gl.TEXTURE_2D&&args[3]){delivered[4]=0;faultEvents.push({name,mode:fault,label:currentLabel,originalLevel:args[4],deliveredLevel:0});}
   if(fault==='surface-level'&&name==='framebufferTexture2D'&&args[0]===gl.FRAMEBUFFER&&args[2]===gl.TEXTURE_2D&&args[3]&&args[4]>0){delivered[4]=0;faultEvents.push({name,mode:fault,label:currentLabel,originalLevel:args[4],deliveredLevel:0});}
   if(['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(name)){
    const program=gl.getParameter(gl.CURRENT_PROGRAM),active=gl.getParameter(gl.ACTIVE_TEXTURE),samplers=[],attributes=[];
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){
     const u=gl.getActiveUniform(program,i);if(u.type!==gl.SAMPLER_2D)continue;const unit=gl.getUniform(program,gl.getUniformLocation(program,u.name));gl.activeTexture(gl.TEXTURE0+unit);const sampler=gl.getParameter(gl.SAMPLER_BINDING),texture=gl.getParameter(gl.TEXTURE_BINDING_2D),a=allocations.find(a=>a.storage.texture===texture);
     samplers.push({name:u.name,unit,sampler:object(sampler),texture:object(texture),metadata:a?.metadata,parameters:Object.fromEntries(names.map(k=>[k,gl.getSamplerParameter(sampler,gl[k])])),base:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),last:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL),raw:a?nativeRead(gl,texture,a.metadata.format,a.metadata.width,a.metadata.height,0):null});
    }
    gl.activeTexture(active);
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){
     const a=gl.getActiveAttrib(program,i),location=gl.getAttribLocation(program,a.name),buffer=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),previous=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);let raw=null;
     if(buffer){gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);raw=new Uint8Array(gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE));gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,previous);}
     attributes.push({name:a.name,location,buffer:object(buffer),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),raw});
    }
    draws.push({label:currentLabel,name,args:[...args],samplers,attributes,native:{framebuffer:object(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),attachment:object(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),level:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),viewport:[...gl.getParameter(gl.VIEWPORT)],mask:[...gl.getParameter(gl.COLOR_WRITEMASK)],scissor:gl.isEnabled(gl.SCISSOR_TEST)},shaders:gl.getAttachedShaders(program).map(shader=>({stage:gl.getShaderParameter(shader,gl.SHADER_TYPE),glsl:gl.getShaderSource(shader)}))});
   }
   const answer=base(...delivered);
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)nativeObjects.push({object:answer,id:object(answer),name,label:currentLabel,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'each owned native image object retires once');}}
   if(['texStorage2D','framebufferTexture2D','blitFramebuffer','texParameteri','bindFramebuffer'].includes(name))imageEvents.push({name,label:currentLabel,args:delivered.map(v=>v&&typeof v==='object'?object(v):v),...(name==='blitFramebuffer'?{read:object(gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),readLevel:gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),draw:object(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),drawLevel:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL)}:{})});
   return answer;
  };
 }});
 const backend=c.ok(createWebGL2TransferBackend(traced),'actual image transfer backend').backend;
 const owner=c.ok(createStandardImageResourceStore({backend:{...backend,allocate(metadata){const storage=backend.allocate(metadata);allocations.push({metadata,storage});return storage;}},...(resourceLimits?{limits:resourceLimits}:{})}),'explicit original image resource owner');
 const selected={...bridge,translatePairUniforms(request){const result=bridge.translatePairUniforms(request);requests.push({request:{...request},result:JSON.parse(JSON.stringify(result))});return result;}};
 const renderer=c.ok(createVirglStandardImageAsyncRenderer({gl:traced,shaderBridge:selected,resources:owner.store,bindings:owner.bindings,asyncAccess:owner.asyncAccess,uniformAccess:owner.uniformAccess,imageAccess:owner.imageAccess,jobLimits:{commandsPerStep:step,...jobLimits},primitiveAssembly:'lists'}),'actual original image async renderer').renderer;
 const r={gl,c,bridge:selected,...owner,renderer,trace,allocations,draws,requests,nativeObjects,imageEvents,faultEvents,armFault(){armed=true;},width:s.width,height:s.height,frame:0,history:[],exchanges:[],created:[],blobs:[],get currentLabel(){return currentLabel;},set currentLabel(v){currentLabel=v;}};
 r.add=(metadata,bytes)=>{const resource=add(r,metadata,bytes);r.created.push({metadata:{...metadata},generation:resource.generation,beforeSubmission:r.history.length});return resource;};
 for(const ctx of [1,2]){c.ok(owner.store.createContext(ctx),'image resource context');c.ok(renderer.createContext(ctx),'image renderer context');}
 r.add(meta(1,2,67,2,s.width,s.height),new Uint8Array(s.width*s.height*4));return r;
}
export async function finish(r,report,row){
 Object.assign(row,{history:r.history,exchanges:r.exchanges,created:r.created,requests:r.requests,events:r.trace.events,imageEvents:r.imageEvents,faultEvents:r.faultEvents,draws:[]});
 for(const d of r.draws){const samplers=[],attributes=[];for(const {raw,...p}of d.samplers)samplers.push({...p,texels:raw?await blob(report,raw):null});for(const {raw,...p}of d.attributes)attributes.push({...p,bytes:raw?await blob(report,raw):null});row.draws.push({...d,samplers,attributes});}
 dispose(r);row.nativeObjects=r.nativeObjects.map(({object,...p})=>p);for(const o of row.nativeObjects)r.c.same(o.deleted,1,'all actual image native objects retired');row.final={renderer:r.renderer.inspect(),resources:r.store.inspect(),imageAccess:r.imageAccess.inspect()};for(const n of Object.values(row.final.resources.budgets))r.c.same(n,0,'all image owner terminal budgets zero');for(const n of Object.values(row.final.renderer.budgets))r.c.same(n,0,'all image renderer terminal budgets zero');return row;
}
