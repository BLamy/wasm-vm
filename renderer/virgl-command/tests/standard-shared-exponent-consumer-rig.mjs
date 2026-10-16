import {nativeRead as readSharedNative} from './standard-shared-exponent-rig.mjs';
import {createStandardSharedExponentResourceStore,createStandardSharedExponentTransferBackend} from '../resources.mjs';
import {createVirglStandardSharedExponentImageAsyncRenderer} from '../state.mjs';
import {packet,join,meta,add,dispose,blob as byteBlob,traceGL} from './standard-instanced-draws.mjs';
import {originalFormat} from '../../../tools/virgl-command/standard-byte-color-fixtures.mjs';
import {originalFormat as floatingFormat} from '../../../tools/virgl-command/standard-float-image-fixtures.mjs';
const isFloating=format=>format===124||floatingFormat(format);
export function nativeRead(r,texture,format,width,height,level){
 const gl=r.gl;
 if(format===125){const old=r.currentLabel;r.diagnosticActive=true;try{return readSharedNative({gl,traced:r.traced,c:r.c,get label(){return r.currentLabel;},setLabel(value){r.currentLabel=value;r.trace.label(value);}},texture,width,height,level);}finally{r.diagnosticActive=false;r.currentLabel=old;r.trace.label(old);}}

 const framebuffer=gl.createFramebuffer(),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),floating=isFloating(format),signed=originalFormat(format)?.snorm,data=floating?new Float32Array(width*height*4):format===233?new Uint32Array(width*height):signed?new Int8Array(width*height*4):new Uint8Array(width*height*4);
 try{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.readBuffer(gl.COLOR_ATTACHMENT0);if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent native byte-color framebuffer incomplete');gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.readPixels(0,0,width,height,gl.RGBA,floating?gl.FLOAT:format===233?gl.UNSIGNED_INT_2_10_10_10_REV:signed?gl.BYTE:gl.UNSIGNED_BYTE,data);return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);}
 finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.deleteFramebuffer(framebuffer);}
}
const names=['TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_WRAP_R','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_COMPARE_MODE','TEXTURE_COMPARE_FUNC','TEXTURE_MIN_LOD','TEXTURE_MAX_LOD'];
// Preserve all bytes of original packed shared-exponent words; the older RGBA helper takes bytes.
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
 const trace=traceGL(gl,c,delay),allocations=[],draws=[],copyDraws=[],requests=[],nativeObjects=[],faultEvents=[],imageEvents=[],uploads=[],readbacks=[],retiredPlanes=[];let armed=false,failed=false,currentLabel='',diagnosticActive=false,r;
 const object=o=>trace.id(o);
 const traced=new Proxy(trace.gl,{get(target,name){
  const base=Reflect.get(target,name,target);if(typeof base!=='function')return base;
  return(...args)=>{
   let delivered=[...args];
   if(fault==='original-level'&&name==='bindTexture'&&args[0]===gl.TEXTURE_2D&&gl.getParameter(gl.ACTIVE_TEXTURE)===gl.TEXTURE0+(s.stage==='vertex'?16:0)+s.slot){const expected=allocations.find(a=>a.storage.texture===args[1]),source=allocations.find(a=>a.metadata.id===6&&a.metadata.width===s.source.metadata.width);if(expected?.metadata.format===125&&source&&args[1]!==source.storage.texture){delivered[1]=source.storage.texture;faultEvents.push({name,mode:fault,label:currentLabel,original:object(args[1]),delivered:object(delivered[1])});}}
   if(fault==='linear-filter'&&name==='samplerParameteri'&&[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].includes(args[1])){delivered[2]=args[1]===gl.TEXTURE_MAG_FILTER?gl.NEAREST:gl.NEAREST_MIPMAP_NEAREST;faultEvents.push({name,mode:fault,label:currentLabel,original:args[2],delivered:delivered[2]});}
   if(armed&&!failed&&nativeFault==='clear'&&name==='clearBufferfv'){delivered[0]=gl.STENCIL;failed=true;faultEvents.push({name,mode:nativeFault,label:currentLabel,original:args[0],delivered:delivered[0]});}

   const nativeDraw=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(name),programAtDraw=nativeDraw?gl.getParameter(gl.CURRENT_PROGRAM):null,copyProgram=nativeDraw&&gl.getUniformLocation(programAtDraw,'sourceTexture')&&gl.getUniformLocation(programAtDraw,'sourceLevel');
   if(nativeDraw&&copyProgram&&!diagnosticActive){const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);copyDraws.push({label:currentLabel,name,args:[...args],program:object(programAtDraw),source:object(gl.getParameter(gl.TEXTURE_BINDING_2D)),level:gl.getUniform(programAtDraw,gl.getUniformLocation(programAtDraw,'sourceLevel')),origin:[...gl.getUniform(programAtDraw,gl.getUniformLocation(programAtDraw,'origin'))],target:object(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),viewport:[...gl.getParameter(gl.VIEWPORT)],shaders:gl.getAttachedShaders(programAtDraw).map(shader=>({stage:gl.getShaderParameter(shader,gl.SHADER_TYPE),glsl:gl.getShaderSource(shader)}))});gl.activeTexture(active);}
   if(nativeDraw&&!copyProgram&&!diagnosticActive){
    const program=gl.getParameter(gl.CURRENT_PROGRAM),active=gl.getParameter(gl.ACTIVE_TEXTURE),samplers=[],attributes=[],queries=[],blocks=[];
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){
     const u=gl.getActiveUniform(program,i);if(u.type===gl.INT&&/^[vf]ssamplevels/.test(u.name)){queries.push({name:u.name,type:u.type,size:u.size,value:gl.getUniform(program,gl.getUniformLocation(program,u.name))});continue;}if(u.type!==gl.SAMPLER_2D)continue;const unit=gl.getUniform(program,gl.getUniformLocation(program,u.name));gl.activeTexture(gl.TEXTURE0+unit);const sampler=gl.getParameter(gl.SAMPLER_BINDING),texture=gl.getParameter(gl.TEXTURE_BINDING_2D),a=allocations.find(a=>a.storage.texture===texture);
     samplers.push({name:u.name,unit,sampler:object(sampler),texture:object(texture),metadata:a?.metadata,parameters:Object.fromEntries(names.map(k=>[k,gl.getSamplerParameter(sampler,gl[k])])),base:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),last:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL),raw:a?nativeRead(r,texture,a.metadata.format,a.metadata.width,a.metadata.height,0):null});
    }
    gl.activeTexture(active);
    for(let index=0;index<gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS);index++){
     const name=gl.getActiveUniformBlockName(program,index),binding=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_BINDING),buffer=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,binding),previous=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);let raw=null;
     if(buffer){gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);raw=new Uint8Array(gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE));gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,previous);}
     blocks.push({name,index,binding,start:gl.getIndexedParameter(gl.UNIFORM_BUFFER_START,binding),length:gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE,binding),byteLength:gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE),raw});
    }
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){
     const a=gl.getActiveAttrib(program,i),location=gl.getAttribLocation(program,a.name),buffer=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),previous=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);let raw=null;
     if(buffer){gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);raw=new Uint8Array(gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE));gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,previous);}
     attributes.push({name:a.name,location,buffer:object(buffer),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),enabled:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED),divisor:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_DIVISOR),components:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),normalized:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),raw});
    }
    draws.push({label:currentLabel,name,args:[...args],samplers,attributes,queries,blocks,native:{drawBuffer:gl.getParameter(gl.DRAW_BUFFER0),program:object(program),vao:object(gl.getParameter(gl.VERTEX_ARRAY_BINDING)),framebuffer:object(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),attachment:object(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),level:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),viewport:[...gl.getParameter(gl.VIEWPORT)],mask:[...gl.getParameter(gl.COLOR_WRITEMASK)],scissor:gl.isEnabled(gl.SCISSOR_TEST),capabilities:Object.fromEntries(['BLEND','DEPTH_TEST','STENCIL_TEST','CULL_FACE','DITHER','RASTERIZER_DISCARD','SAMPLE_ALPHA_TO_COVERAGE','SAMPLE_COVERAGE'].map(name=>[name,gl.isEnabled(gl[name])]))},shaders:gl.getAttachedShaders(program).map(shader=>({stage:gl.getShaderParameter(shader,gl.SHADER_TYPE),glsl:gl.getShaderSource(shader)}))});
   }
   if(name==='deleteTexture'&&args[0]&&currentLabel.startsWith('queued-shared-exponent-')){const a=allocations.find(row=>row.storage.texture===args[0]&&row.metadata.id===1);if(a)retiredPlanes.push({label:currentLabel,texture:object(args[0]),metadata:a.metadata,fencePoint:trace.events.filter(e=>e.name==='clientWaitSync').at(-1)??null,raw:nativeRead(r,args[0],a.metadata.format,a.metadata.width,a.metadata.height,0)});}
   const answer=base(...delivered);
   if(name==='texSubImage2D')uploads.push({label:currentLabel,texture:object(gl.getParameter(gl.TEXTURE_BINDING_2D)),type:ArrayBuffer.isView(delivered[8])?delivered[8].constructor.name:'PBO',unpackBuffer:object(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)),args:delivered.slice(0,8),raw:ArrayBuffer.isView(delivered[8])?new Uint8Array(delivered[8].buffer,delivered[8].byteOffset,delivered[8].byteLength).slice():null});
   if(name==='readPixels'&&ArrayBuffer.isView(delivered[6]))readbacks.push({label:currentLabel,type:delivered[6].constructor.name,args:delivered.slice(0,6),raw:new Uint8Array(delivered[6].buffer,delivered[6].byteOffset,delivered[6].byteLength).slice()});
   if(name==='readPixels'&&!ArrayBuffer.isView(delivered[6]))readbacks.push({label:currentLabel,name,type:'PBO',args:[...delivered],buffer:object(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)),raw:null});
   if(name==='getBufferSubData'&&ArrayBuffer.isView(delivered[2]))readbacks.push({label:currentLabel,name,args:delivered.slice(0,2),raw:new Uint8Array(delivered[2].buffer,delivered[2].byteOffset,delivered[2].byteLength).slice()});
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)nativeObjects.push({object:answer,id:object(answer),name,label:currentLabel,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'each owned native image object retires once');}}
   if(['texStorage2D','framebufferTexture2D','blitFramebuffer','texParameteri','bindFramebuffer','bindBuffer','bufferData','shaderSource','uniform1i','uniform2i','drawArrays','clearBufferfv'].includes(name))imageEvents.push({name,label:currentLabel,...(name==='texStorage2D'?{texture:object(gl.getParameter(gl.TEXTURE_BINDING_2D))}:{}),args:delivered.map(v=>ArrayBuffer.isView(v)?[...v]:v&&typeof v==='object'?object(v):v),...(name==='bufferData'?{buffer:object(gl.getParameter(delivered[0]===gl.PIXEL_PACK_BUFFER?gl.PIXEL_PACK_BUFFER_BINDING:delivered[0]===gl.PIXEL_UNPACK_BUFFER?gl.PIXEL_UNPACK_BUFFER_BINDING:gl.COPY_WRITE_BUFFER_BINDING))}:{}),...(name==='blitFramebuffer'?{read:object(gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),readLevel:gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),draw:object(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),drawLevel:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL)}:{})});
   return answer;
  };
 }});
 const backend=c.ok(createStandardSharedExponentTransferBackend(traced),'actual image transfer backend').backend;
 const owner=c.ok(createStandardSharedExponentResourceStore({backend:{...backend,allocate(metadata){const storage=backend.allocate(metadata);allocations.push({metadata,storage});return storage;}},...(resourceLimits?{limits:resourceLimits}:{})}),'explicit original image resource owner');
 const selected={...bridge,translatePairUniforms(request){const result=bridge.translatePairUniforms(request);requests.push({request:{...request},result:JSON.parse(JSON.stringify(result))});return result;}};
 const renderer=c.ok(createVirglStandardSharedExponentImageAsyncRenderer({gl:traced,shaderBridge:selected,resources:owner.store,bindings:owner.bindings,asyncAccess:owner.asyncAccess,uniformAccess:owner.uniformAccess,imageAccess:owner.imageAccess,jobLimits:{commandsPerStep:step,...jobLimits},primitiveAssembly:'lists'}),'actual original image async renderer').renderer;
 r={gl,traced,c,bridge:selected,...owner,renderer,trace,allocations,draws,copyDraws,requests,nativeObjects,imageEvents,faultEvents,uploads,readbacks,retiredPlanes,armFault(){armed=true;},width:s.width,height:s.height,frame:0,history:[],exchanges:[],created:[],blobs:[],get currentLabel(){return currentLabel;},set currentLabel(v){currentLabel=v;},get diagnosticActive(){return diagnosticActive;},set diagnosticActive(v){diagnosticActive=v;}};
 r.add=(metadata,bytes)=>{const resource=add(r,metadata,bytes);r.created.push({metadata:{...metadata},generation:resource.generation,beforeSubmission:r.history.length});return resource;};
 for(const ctx of [1,2]){c.ok(owner.store.createContext(ctx),'image resource context');c.ok(renderer.createContext(ctx),'image renderer context');}
 const ow=s.targetWidth??s.width,oh=s.targetHeight??s.height,ol=s.outputLastLevel??0;let bytes=0;for(let level=0;level<=ol;level++)bytes+=Math.max(1,Math.floor(ow/2**level))*Math.max(1,Math.floor(oh/2**level))*(s.outputFormat===124?4:(floatingFormat(s.outputFormat??31)?.precision/8??1)*(floatingFormat(s.outputFormat??31)?.components??4));r.outputBackingBytes=bytes+100;r.add({...meta(1,2,s.outputFormat??31,2,ow,oh),lastLevel:ol},new Uint8Array(r.outputBackingBytes).fill(0x2e));return r;
}
export async function finish(r,report,row){
 Object.assign(row,{allocations:r.allocations.map(a=>({metadata:a.metadata,texture:a.storage.texture? r.trace.id(a.storage.texture):null,buffer:a.storage.buffer? r.trace.id(a.storage.buffer):null,copyScratch:a.storage.sharedCopyScratch?{texture:r.trace.id(a.storage.sharedCopyScratch.texture),buffer:r.trace.id(a.storage.sharedCopyScratch.buffer),width:a.storage.sharedCopyScratch.width,height:a.storage.sharedCopyScratch.height}:null})),history:r.history,exchanges:r.exchanges,created:r.created,requests:r.requests,events:r.trace.events,imageEvents:r.imageEvents,copyDraws:r.copyDraws,faultEvents:r.faultEvents,draws:[]});
 for(const d of r.draws){const samplers=[],attributes=[],blocks=[];for(const {raw,...p}of d.blocks)blocks.push({...p,bytes:raw?await blob(report,raw):null});for(const {raw,...p}of d.samplers)samplers.push({...p,texels:raw?await blob(report,raw):null});for(const {raw,...p}of d.attributes)attributes.push({...p,bytes:raw?await blob(report,raw):null});row.draws.push({...d,samplers,attributes,blocks});}
 for(const kind of ['uploads','readbacks']){row[kind]=[];for(const {raw,...p}of r[kind])row[kind].push({...p,bytes:raw?await blob(report,raw):null});}
 dispose(r);row.retiredPlanes=[];for(const {raw,...p}of r.retiredPlanes)row.retiredPlanes.push({...p,pixels:await blob(report,raw)});row.nativeObjects=r.nativeObjects.map(({object,...p})=>p);for(const o of row.nativeObjects)r.c.same(o.deleted,1,'all actual image native objects retired');row.final={renderer:r.renderer.inspect(),resources:r.store.inspect(),imageAccess:r.imageAccess.inspect()};for(const n of Object.values(row.final.resources.budgets))r.c.same(n,0,'all image owner terminal budgets zero');for(const n of Object.values(row.final.renderer.budgets))r.c.same(n,0,'all image renderer terminal budgets zero');return row;
}
