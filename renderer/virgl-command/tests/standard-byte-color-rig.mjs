import {createStandardColorResourceStore,createStandardColorTransferBackend} from '../resources.mjs';
import {createVirglStandardColorAsyncRenderer} from '../state.mjs';
import {packet,join,meta,add,dispose,blob as byteBlob,traceGL} from './standard-instanced-draws.mjs';
import {originalFormat} from '../../../tools/virgl-command/standard-byte-color-fixtures.mjs';
export function nativeRead(gl,texture,format,width,height,level){
 const framebuffer=gl.createFramebuffer(),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),signed=originalFormat(format)?.snorm,data=format===233?new Uint32Array(width*height):signed?new Int8Array(width*height*4):new Uint8Array(width*height*4);
 try{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.readBuffer(gl.COLOR_ATTACHMENT0);if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent native byte-color framebuffer incomplete');gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.readPixels(0,0,width,height,gl.RGBA,format===233?gl.UNSIGNED_INT_2_10_10_10_REV:signed?gl.BYTE:gl.UNSIGNED_BYTE,data);return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);}
 finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.deleteFramebuffer(framebuffer);}
}
const names=['TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_WRAP_R','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_COMPARE_MODE','TEXTURE_COMPARE_FUNC','TEXTURE_MIN_LOD','TEXTURE_MAX_LOD'];
// Preserve all bytes of packed native words; the older RGBA helper takes bytes.
export const blob=(report,input)=>byteBlob(report,new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice());
export async function submit(r,ctx,bytes,label,onYield=null){
 const {c,renderer,trace}=r,original=bytes.slice();trace.label(label);r.currentLabel=label;c.ok(renderer.beginFrame(++r.frame),'begin original image record');
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
   if(step.status==='needs-output'){const request=step.request,layout=request.layout;c.same(request.bytes.byteLength,layout.tightBytes,'owned original color output logical length');r.exchanges.push({label,direction:'readback',resource:request.resource,backingGeneration:request.backingGeneration,layout,blob:await blob(r,request.bytes)});for(let row=0;row<layout.rowCount;row++)c.ok(r.store.writeBacking(request.resource.id,layout.offset+row*layout.rowStride,request.bytes.subarray(row*layout.rowBytes,(row+1)*layout.rowBytes)),'owned original color output rows');c.ok(renderer.acknowledgeOutput(begun.job,request.token),'owned logical color output acknowledgment');c.same(renderer.acknowledgeOutput(begun.job,request.token).ok,false,'consumed original color output token rejects');}
  }
  c.same(Boolean(result),true,'bounded original image job completion');c.same(renderer.step(begun.job).ok,false,'consumed original image job rejects');
 }
 const dump=disposed?null:c.ok(renderer.endFrame(r.frame),'end original image record').dump;
 const record={label,ctx,hex:[...original].map(v=>v.toString(16).padStart(2,'0')).join(''),result,steps,dump,...(disposed?{disposed,appliedBeforeDispose}: {})};r.history.push(record);return record;
}
export function rig(gl,bridge,c,s,{delay=0,step=64,fault,nativeFault,resourceLimits,jobLimits}={}){
 const trace=traceGL(gl,c,delay),allocations=[],draws=[],requests=[],nativeObjects=[],faultEvents=[],imageEvents=[],uploads=[],readbacks=[],retiredPlanes=[];let armed=false,failed=false,currentLabel='';
 const object=o=>trace.id(o);
 const traced=new Proxy(trace.gl,{get(target,name){
  const base=Reflect.get(target,name,target);if(typeof base!=='function')return base;
  return(...args)=>{
   let delivered=[...args];
   if(fault==='srgb-storage'&&name==='texStorage2D'&&args[2]===gl.SRGB8_ALPHA8){delivered[2]=gl.RGBA8;faultEvents.push({name,mode:fault,label:currentLabel,original:args[2],delivered:delivered[2]});}
   if(fault==='upload-channel'&&name==='texSubImage2D'&&ArrayBuffer.isView(args[8])&&args[6]===gl.RGBA){const data=new args[8].constructor(args[8]);for(let i=0;i<data.length;i+=4){const value=data[i];data[i]=data[i+1];data[i+1]=value;}delivered[8]=data;faultEvents.push({name,mode:fault,label:currentLabel,bytes:data.byteLength});}
   if(armed&&!failed&&nativeFault==='storage'&&name==='texStorage2D'){delivered[1]=0;failed=true;faultEvents.push({name,mode:nativeFault,label:currentLabel,original:[...args],delivered});}
   if(armed&&!failed&&nativeFault==='upload'&&name==='texSubImage2D'){delivered[2]=-1;failed=true;faultEvents.push({name,mode:nativeFault,label:currentLabel,originalX:args[2],deliveredX:-1});}
   if(armed&&!failed&&nativeFault==='read'&&name==='readPixels'){delivered[4]=gl.RGBA_INTEGER;failed=true;faultEvents.push({name,mode:nativeFault,label:currentLabel,originalFormat:args[4],deliveredFormat:gl.RGBA_INTEGER});}

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
   if(name==='deleteTexture'&&args[0]&&currentLabel.startsWith('queued-color-')){const a=allocations.find(row=>row.storage.texture===args[0]&&row.metadata.id===1);if(a)retiredPlanes.push({label:currentLabel,texture:object(args[0]),metadata:a.metadata,fencePoint:trace.events.filter(e=>e.name==='clientWaitSync').at(-1)??null,raw:nativeRead(gl,args[0],a.metadata.format,a.metadata.width,a.metadata.height,0)});}
   const answer=base(...delivered);
   if(name==='texSubImage2D'&&ArrayBuffer.isView(delivered[8]))uploads.push({label:currentLabel,texture:object(gl.getParameter(gl.TEXTURE_BINDING_2D)),type:delivered[8].constructor.name,args:delivered.slice(0,8),raw:new Uint8Array(delivered[8].buffer,delivered[8].byteOffset,delivered[8].byteLength).slice()});
   if(name==='readPixels'&&ArrayBuffer.isView(delivered[6]))readbacks.push({label:currentLabel,type:delivered[6].constructor.name,args:delivered.slice(0,6),raw:new Uint8Array(delivered[6].buffer,delivered[6].byteOffset,delivered[6].byteLength).slice()});
   if(name==='readPixels'&&!ArrayBuffer.isView(delivered[6]))readbacks.push({label:currentLabel,name,type:'PBO',args:[...delivered],buffer:object(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)),raw:null});
   if(name==='getBufferSubData'&&ArrayBuffer.isView(delivered[2]))readbacks.push({label:currentLabel,name,args:delivered.slice(0,2),raw:new Uint8Array(delivered[2].buffer,delivered[2].byteOffset,delivered[2].byteLength).slice()});
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)nativeObjects.push({object:answer,id:object(answer),name,label:currentLabel,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'each owned native image object retires once');}}
   if(['texStorage2D','framebufferTexture2D','blitFramebuffer','texParameteri','bindFramebuffer'].includes(name))imageEvents.push({name,label:currentLabel,...(name==='texStorage2D'?{texture:object(gl.getParameter(gl.TEXTURE_BINDING_2D))}:{}),args:delivered.map(v=>v&&typeof v==='object'?object(v):v),...(name==='blitFramebuffer'?{read:object(gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),readLevel:gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),draw:object(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),drawLevel:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL)}:{})});
   return answer;
  };
 }});
 const backend=c.ok(createStandardColorTransferBackend(traced),'actual image transfer backend').backend;
 const owner=c.ok(createStandardColorResourceStore({backend:{...backend,allocate(metadata){const storage=backend.allocate(metadata);allocations.push({metadata,storage});return storage;}},...(resourceLimits?{limits:resourceLimits}:{})}),'explicit original image resource owner');
 const selected={...bridge,translatePairUniforms(request){const result=bridge.translatePairUniforms(request);requests.push({request:{...request},result:JSON.parse(JSON.stringify(result))});return result;}};
 const renderer=c.ok(createVirglStandardColorAsyncRenderer({gl:traced,shaderBridge:selected,resources:owner.store,bindings:owner.bindings,asyncAccess:owner.asyncAccess,uniformAccess:owner.uniformAccess,imageAccess:owner.imageAccess,jobLimits:{commandsPerStep:step,...jobLimits},primitiveAssembly:'lists'}),'actual original image async renderer').renderer;
 const r={gl,c,bridge:selected,...owner,renderer,trace,allocations,draws,requests,nativeObjects,imageEvents,faultEvents,uploads,readbacks,retiredPlanes,armFault(){armed=true;},width:s.width,height:s.height,frame:0,history:[],exchanges:[],created:[],blobs:[],get currentLabel(){return currentLabel;},set currentLabel(v){currentLabel=v;}};
 r.add=(metadata,bytes)=>{const resource=add(r,metadata,bytes);r.created.push({metadata:{...metadata},generation:resource.generation,beforeSubmission:r.history.length});return resource;};
 for(const ctx of [1,2]){c.ok(owner.store.createContext(ctx),'image resource context');c.ok(renderer.createContext(ctx),'image renderer context');}
 r.add(meta(1,2,67,2,s.width,s.height),new Uint8Array(s.width*s.height*4));return r;
}
export async function finish(r,report,row){
 Object.assign(row,{allocations:r.allocations.map(a=>({metadata:a.metadata,texture:a.storage.texture? r.trace.id(a.storage.texture):null,buffer:a.storage.buffer? r.trace.id(a.storage.buffer):null})),history:r.history,exchanges:r.exchanges,created:r.created,requests:r.requests,events:r.trace.events,imageEvents:r.imageEvents,faultEvents:r.faultEvents,draws:[]});
 for(const d of r.draws){const samplers=[],attributes=[];for(const {raw,...p}of d.samplers)samplers.push({...p,texels:raw?await blob(report,raw):null});for(const {raw,...p}of d.attributes)attributes.push({...p,bytes:raw?await blob(report,raw):null});row.draws.push({...d,samplers,attributes});}
 for(const kind of ['uploads','readbacks']){row[kind]=[];for(const {raw,...p}of r[kind])row[kind].push({...p,bytes:raw?await blob(report,raw):null});}
 dispose(r);row.retiredPlanes=[];for(const {raw,...p}of r.retiredPlanes)row.retiredPlanes.push({...p,pixels:await blob(report,raw)});row.nativeObjects=r.nativeObjects.map(({object,...p})=>p);for(const o of row.nativeObjects)r.c.same(o.deleted,1,'all actual image native objects retired');row.final={renderer:r.renderer.inspect(),resources:r.store.inspect(),imageAccess:r.imageAccess.inspect()};for(const n of Object.values(row.final.resources.budgets))r.c.same(n,0,'all image owner terminal budgets zero');for(const n of Object.values(row.final.renderer.budgets))r.c.same(n,0,'all image renderer terminal budgets zero');return row;
}
