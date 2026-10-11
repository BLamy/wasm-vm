import {createStandardPackedUnsignedResourceStore,createStandardPackedUnsignedTransferBackend} from '../resources.mjs';
import {checks,traceGL,blob as bytesBlob} from './standard-instanced-draws.mjs';
export {checks};
export const blob=(report,input)=>bytesBlob(report,new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice());
// Independent diagnostic reads actual packed-unsigned FBO storage, without product conversion.
export function nativeRead(r,texture,width,height,level=0,wide=false){
 const gl=r.traced,oldLabel=r.label;r.setLabel('independent-packed-unsigned-diagnostic');
 const old={read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),alignment:gl.getParameter(gl.PACK_ALIGNMENT),row:gl.getParameter(gl.PACK_ROW_LENGTH),x:gl.getParameter(gl.PACK_SKIP_PIXELS),y:gl.getParameter(gl.PACK_SKIP_ROWS)};
 const framebuffer=gl.createFramebuffer(),data=new Uint32Array(width*height*4);
 try{
  if(!framebuffer)throw Error('independent packed-unsigned diagnostic allocation');gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent packed-unsigned diagnostic framebuffer');
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);
  gl.readPixels(0,0,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,data);if(gl.getError()!==gl.NO_ERROR)throw Error('independent packed-unsigned diagnostic GL error');return new Uint8Array(data.buffer);
 }finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old.read);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,old.pack);gl.pixelStorei(gl.PACK_ALIGNMENT,old.alignment);gl.pixelStorei(gl.PACK_ROW_LENGTH,old.row);gl.pixelStorei(gl.PACK_SKIP_PIXELS,old.x);gl.pixelStorei(gl.PACK_SKIP_ROWS,old.y);if(framebuffer)gl.deleteFramebuffer(framebuffer);r.setLabel(oldLabel);}
}
export function gpuClear(r,texture,level,values){
 const gl=r.traced,old={draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),mask:gl.getParameter(gl.COLOR_WRITEMASK),scissor:gl.isEnabled(gl.SCISSOR_TEST)},framebuffer=gl.createFramebuffer();
 try{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);if(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('packed-unsigned clear framebuffer');gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl.clearBufferuiv(gl.COLOR,0,new Uint32Array(values));if(gl.getError()!==gl.NO_ERROR)throw Error('packed-unsigned GPU-only clear');}
 finally{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,old.draw);gl.colorMask(...old.mask);gl[old.scissor?'enable':'disable'](gl.SCISSOR_TEST);if(framebuffer)gl.deleteFramebuffer(framebuffer);}
}
export function rig(gl,c,{delay=0,fault=null,nativeFault=null,limits,hideIndexed=false}={}){
 const trace=traceGL(gl,c,delay),allocations=[],nativeObjects=[],nativeEvents=[],uploads=[],readbacks=[],faultEvents=[];let label='',armed=false,failed=false,owner=null;
 const traced=new Proxy(trace.gl,{get(target,name){
  const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   let delivered=[...args];
   if(armed&&!failed&&((nativeFault==='texture'&&name==='createTexture')||(nativeFault==='framebuffer'&&name==='createFramebuffer')||(nativeFault==='buffer'&&name==='createBuffer')||(nativeFault==='fence'&&name==='fenceSync'))){failed=true;faultEvents.push({label,name,delivered:null});return null;}
   if(armed&&!failed&&nativeFault==='initialize'&&['clearBufferiv','clearBufferuiv','clearBufferfv'].includes(name)){failed=true;delivered[0]=0;faultEvents.push({label,name,original:args[0],delivered:0});}
   if(armed&&!failed&&nativeFault==='storage'&&name==='texStorage2D'){failed=true;delivered[1]=0;faultEvents.push({label,name,original:args[1],delivered:0});}
   if(armed&&!failed&&nativeFault==='upload'&&name==='texSubImage2D'){failed=true;delivered[2]=-1;faultEvents.push({label,name,original:args[2],delivered:-1});}
   if(armed&&!failed&&nativeFault==='read'&&name==='readPixels'){failed=true;delivered[4]=gl.DEPTH_COMPONENT;faultEvents.push({label,name,original:args[4],delivered:gl.DEPTH_COMPONENT});}
   if(armed&&!failed&&nativeFault==='collect'&&name==='getBufferSubData'){failed=true;delivered[1]=-1;faultEvents.push({label,name,original:args[1],delivered:-1});}
   if(fault==='upload-lane'&&name==='texSubImage2D'&&ArrayBuffer.isView(args[8])){delivered[8]=args[8].slice();delivered[8][0]=delivered[8][0]===0?1:0;faultEvents.push({label,name,fault,original:args[8][0],delivered:delivered[8][0]});}
   if(fault==='copy-level'&&name==='framebufferTexture2D'&&args[0]===gl.READ_FRAMEBUFFER&&args[3]&&label==='original-packed-unsigned-range-copy'){delivered[4]=0;faultEvents.push({label,name,fault,original:args[4],delivered:0});}
   if(name==='getExtension'&&args[0]==='OES_draw_buffers_indexed'&&hideIndexed){nativeEvents.push({label,name,requested:args[0],actualAvailable:Boolean(method(...delivered)),deliberatelyMasked:true});return null;}
   const answer=method(...delivered),id=trace.id;
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)nativeObjects.push({object:answer,id:id(answer),name,label,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'each owned packed-unsigned image native object retires once');}}
   if(name==='texSubImage2D')uploads.push({label,texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D)),type:ArrayBuffer.isView(delivered[8])?delivered[8].constructor.name:'PBO',unpackBuffer:id(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)),args:delivered.slice(0,8),raw:ArrayBuffer.isView(delivered[8])?new Uint8Array(delivered[8].buffer,delivered[8].byteOffset,delivered[8].byteLength).slice():null});
   if(name==='readPixels')readbacks.push({label,name,type:ArrayBuffer.isView(delivered[6])?delivered[6].constructor.name:'PBO',args:delivered.slice(0,6),buffer:id(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)),raw:ArrayBuffer.isView(delivered[6])?new Uint8Array(delivered[6].buffer,delivered[6].byteOffset,delivered[6].byteLength).slice():null});
   if(name==='getBufferSubData'&&ArrayBuffer.isView(delivered[2]))readbacks.push({label,name,args:delivered.slice(0,2),buffer:id(gl.getParameter(gl.COPY_READ_BUFFER_BINDING)),raw:new Uint8Array(delivered[2].buffer,delivered[2].byteOffset,delivered[2].byteLength).slice()});
   if(['texStorage2D','texParameteri','framebufferTexture2D','drawArrays','uniform1i','uniform2i','bindBuffer','bufferData','shaderSource','linkProgram','clearBufferuiv','clearBufferiv','clearBufferfv','blitFramebuffer'].includes(name))nativeEvents.push({label,name,...(owner?{budgets:owner.store.inspect().budgets}:{}),args:delivered.map(value=>ArrayBuffer.isView(value)||Array.isArray(value)?[...value]:value&&typeof value==='object'?id(value):value),...(name==='texStorage2D'?{texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D))}:{}),...(name==='bufferData'?{buffer:id(gl.getParameter(delivered[0]===gl.PIXEL_PACK_BUFFER?gl.PIXEL_PACK_BUFFER_BINDING:delivered[0]===gl.PIXEL_UNPACK_BUFFER?gl.PIXEL_UNPACK_BUFFER_BINDING:gl.COPY_WRITE_BUFFER_BINDING))}:{}),...(name==='drawArrays'?{program:id(gl.getParameter(gl.CURRENT_PROGRAM)),target:id(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME))}:{}),...(name==='getUniformLocation'?{uniform:args[1]}:{})});
   return answer;
  };
 }});
 const backend=c.ok(createStandardPackedUnsignedTransferBackend(traced),'selected actual packed-unsigned image transfer backend').backend;
 owner=c.ok(createStandardPackedUnsignedResourceStore({backend:{...backend,allocate(meta){const storage=backend.allocate(meta);allocations.push({metadata:meta,storage});return storage;}},...(limits?{limits}:{})}),'selected actual packed-unsigned image owner');
 for(const id of [1,2])c.ok(owner.store.createContext(id),'original packed-unsigned image context');
 return{...owner,backend,gl,traced,c,trace,allocations,nativeObjects,nativeEvents,uploads,readbacks,faultEvents,operations:[],setLabel(value){label=value;trace.label(value);},armFault(){armed=true;},get label(){return label;}};
}
export async function physicalFence(r,label){
 r.setLabel(label);const sync=r.traced.fenceSync(r.gl.SYNC_GPU_COMMANDS_COMPLETE,0);r.c.same(Boolean(sync),true,'actual packed-unsigned image final fence allocation');r.traced.flush();let status;
 try{for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();status=r.traced.clientWaitSync(sync,0,0);if(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED)break;r.c.same(status,r.gl.TIMEOUT_EXPIRED,'physical packed-unsigned image fence remains legal');}r.c.same(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED,true,'bounded physical packed-unsigned image fence completed');return r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);}finally{r.traced.deleteSync(sync);}
}
export async function poll(r,ticket,{discard=false}={}){
 let result;for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();result=r.c.ok(r.asyncAccess.poll(ticket,discard),'actual later-task packed-unsigned image readback poll');if(result.status==='ready')break;}r.c.same(result.status,'ready','bounded physical packed-unsigned image readback completion');return result;
}
export function add(r,metadata,bytes){const resource=r.c.ok(r.store.createResource(metadata),'original packed-unsigned image resource allocation').resource;if(bytes){r.c.ok(r.store.attachBacking(metadata.id,[bytes.subarray(0,Math.min(7,bytes.length)),bytes.subarray(Math.min(7,bytes.length))]),'nonaligned owned packed-unsigned image backing');}for(const id of [1,2])r.c.ok(r.store.attachContext(id,metadata.id),'packed-unsigned image context membership');return resource;}
export async function finish(r,report,row){
 r.c.ok(r.store.dispose(),'selected packed-unsigned image owner disposal');Object.assign(row,{allocations:r.allocations.map(row=>({metadata:row.metadata,texture:r.trace.id(row.storage.texture),buffer:r.trace.id(row.storage.buffer),copyScratch:row.storage.sharedCopyScratch?{texture:r.trace.id(row.storage.sharedCopyScratch.texture),buffer:r.trace.id(row.storage.sharedCopyScratch.buffer),width:row.storage.sharedCopyScratch.width,height:row.storage.sharedCopyScratch.height}:null})),nativeEvents:r.nativeEvents,faultEvents:r.faultEvents,events:r.trace.events,operations:r.operations,nativeObjects:r.nativeObjects.map(({object,...row})=>row),final:r.store.inspect()});for(const kind of ['uploads','readbacks']){row[kind]=[];for(const {raw,...info}of r[kind])row[kind].push({...info,bytes:raw?await blob(report,raw):null});}for(const fence of row.events.filter(e=>e.name==='fenceSync'))r.c.same(row.events.filter(e=>e.name==='deleteSync'&&e.sync===fence.sync).length,1,'all owned packed-unsigned syncs retire once');for(const object of row.nativeObjects)r.c.same(object.deleted,1,'all packed-unsigned image native objects retire exactly once');for(const value of Object.values(row.final.budgets))r.c.same(value,0,'all packed-unsigned image terminal owner budgets zero');return row;
}
