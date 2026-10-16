import {createStandardPackedFloatColorResourceStore,createStandardPackedFloatColorTransferBackend} from '../resources.mjs';
import {checks,traceGL,blob as bytesBlob} from './standard-instanced-draws.mjs';
export {checks};
export const blob=(report,input)=>bytesBlob(report,new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice());
export function nativeRead(gl,texture,width,height,level=0){
 const framebuffer=gl.createFramebuffer(),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),data=new Float32Array(width*height*4);
 try{
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent native float framebuffer incomplete');
  gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const name of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[name],0);
  gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,data);return new Uint8Array(data.buffer);
 }finally{
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.deleteFramebuffer(framebuffer);
 }
}
export function rig(gl,c,{delay=0,fault=null,nativeFault=null,limits}={}){
 const trace=traceGL(gl,c,delay),allocations=[],nativeObjects=[],nativeEvents=[],uploads=[],readbacks=[],faultEvents=[];
 let label='',armed=false,failed=false;
 const traced=new Proxy(trace.gl,{get(target,name){
  const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   let delivered=[...args];
   if(armed&&!failed&&nativeFault==='extension'&&name==='getExtension'&&args[0]==='EXT_color_buffer_float'){failed=true;faultEvents.push({label,name,extension:args[0],delivered:null});return null;}
   if(armed&&!failed&&((nativeFault==='texture'&&name==='createTexture')||(nativeFault==='framebuffer'&&name==='createFramebuffer')||(nativeFault==='buffer'&&name==='createBuffer')||(nativeFault==='fence'&&name==='fenceSync'))){failed=true;faultEvents.push({label,name,delivered:null});return null;}
   if(armed&&!failed&&nativeFault==='storage'&&name==='texStorage2D'){failed=true;delivered[1]=0;faultEvents.push({label,name,original:args[1],delivered:0});}
   if(armed&&!failed&&nativeFault==='upload'&&name==='texSubImage2D'){failed=true;delivered[2]=-1;faultEvents.push({label,name,original:args[2],delivered:-1});}
   if(armed&&!failed&&nativeFault==='read'&&name==='readPixels'){failed=true;delivered[4]=gl.RGBA_INTEGER;faultEvents.push({label,name,original:args[4],delivered:gl.RGBA_INTEGER});}
   if(armed&&!failed&&nativeFault==='copy'&&name==='blitFramebuffer'){failed=true;delivered[8]=0x40000000;faultEvents.push({label,name,original:args[8],delivered:delivered[8]});}
   if(fault==='upload-lane'&&name==='texSubImage2D'&&args[6]===gl.RGB&&args[7]===gl.UNSIGNED_INT_10F_11F_11F_REV&&ArrayBuffer.isView(args[8])){
    const data=new Uint32Array(args[8]);for(let i=0;i<data.length;i++){const word=data[i];data[i]=((word&2047)<<11)|((word>>>11)&2047)|(word&0xffc00000);}delivered[8]=data;faultEvents.push({label,name,fault,bytes:data.byteLength});
   }
   if(fault==='copy-level'&&name==='framebufferTexture2D'&&args[0]===gl.READ_FRAMEBUFFER&&args[3]){delivered[4]=0;faultEvents.push({label,name,fault,original:args[4],delivered:0});}
   const answer=method(...delivered),id=trace.id;
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)nativeObjects.push({object:answer,id:id(answer),name,label,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){
    const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'each owned float native object retires once');}
   }
   if(name==='texSubImage2D'&&ArrayBuffer.isView(delivered[8]))uploads.push({label,texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D)),type:delivered[8].constructor.name,args:delivered.slice(0,8),raw:new Uint8Array(delivered[8].buffer,delivered[8].byteOffset,delivered[8].byteLength).slice()});
   if(name==='readPixels')readbacks.push({label,name,type:ArrayBuffer.isView(delivered[6])?delivered[6].constructor.name:'PBO',args:delivered.slice(0,6),buffer:id(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)),raw:ArrayBuffer.isView(delivered[6])?new Uint8Array(delivered[6].buffer,delivered[6].byteOffset,delivered[6].byteLength).slice():null});
   if(name==='getBufferSubData'&&ArrayBuffer.isView(delivered[2]))readbacks.push({label,name,args:delivered.slice(0,2),buffer:id(gl.getParameter(gl.COPY_READ_BUFFER_BINDING)),raw:new Uint8Array(delivered[2].buffer,delivered[2].byteOffset,delivered[2].byteLength).slice()});
   if(['texStorage2D','texParameteri','framebufferTexture2D','blitFramebuffer','clearBufferfv'].includes(name))nativeEvents.push({label,name,args:delivered.map(value=>ArrayBuffer.isView(value)?[...value]:value&&typeof value==='object'?id(value):value),...(name==='texStorage2D'?{texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D))}:{}),...(name==='blitFramebuffer'?{source:id(gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),sourceLevel:gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL),target:id(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),targetLevel:gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL)}:{})});
   return answer;
  };
 }});
 const backend=c.ok(createStandardPackedFloatColorTransferBackend(traced),'selected actual float transfer backend').backend;
 const owner=c.ok(createStandardPackedFloatColorResourceStore({backend:{...backend,allocate(meta){const storage=backend.allocate(meta);allocations.push({metadata:meta,storage});return storage;}},...(limits?{limits}:{})}),'selected actual float owner');
 for(const id of [1,2])c.ok(owner.store.createContext(id),'original float context');
 return{...owner,backend,gl,traced,c,trace,allocations,nativeObjects,nativeEvents,uploads,readbacks,faultEvents,operations:[],setLabel(value){label=value;trace.label(value);},armFault(){armed=true;},get label(){return label;}};
}
export async function physicalFence(r,label){
 r.setLabel(label);const sync=r.traced.fenceSync(r.gl.SYNC_GPU_COMMANDS_COMPLETE,0);r.c.same(Boolean(sync),true,'actual float final fence allocation');r.traced.flush();
 let status;try{
  for(let turn=0;turn<1000;turn++){
   await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();status=r.traced.clientWaitSync(sync,0,0);
   if(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED)break;
   r.c.same(status,r.gl.TIMEOUT_EXPIRED,'physical float fence remains legal');
  }
  r.c.same(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED,true,'bounded physical float fence completed');
  return r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);
 }finally{r.traced.deleteSync(sync);}
}
export async function poll(r,ticket,{discard=false}={}){
 let result;for(let turn=0;turn<1000;turn++){
  await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();result=r.c.ok(r.asyncAccess.poll(ticket,discard),'actual later-task float readback poll');if(result.status==='ready')break;
 }
 r.c.same(result.status,'ready','bounded physical float readback completion');return result;
}
export function add(r,metadata,bytes){
 const resource=r.c.ok(r.store.createResource(metadata),'original float resource allocation').resource;
 if(bytes){r.c.ok(r.store.attachBacking(metadata.id,[bytes.subarray(0,Math.min(7,bytes.length)),bytes.subarray(Math.min(7,bytes.length))]),'nonaligned owned float backing');}
 for(const id of [1,2])r.c.ok(r.store.attachContext(id,metadata.id),'float context membership');return resource;
}
export async function finish(r,report,row){
 r.c.ok(r.store.dispose(),'selected float owner disposal');
 Object.assign(row,{allocations:r.allocations.map(row=>({metadata:row.metadata,texture:r.trace.id(row.storage.texture),buffer:r.trace.id(row.storage.buffer)})),nativeEvents:r.nativeEvents,faultEvents:r.faultEvents,events:r.trace.events,operations:r.operations,nativeObjects:r.nativeObjects.map(({object,...row})=>row),final:r.store.inspect()});
 for(const kind of ['uploads','readbacks']){
  row[kind]=[];for(const {raw,...info}of r[kind])row[kind].push({...info,bytes:raw?await blob(report,raw):null});
 }
 for(const object of row.nativeObjects)r.c.same(object.deleted,1,'all float native objects retire exactly once');
 for(const value of Object.values(row.final.budgets))r.c.same(value,0,'all float terminal owner budgets zero');
 return row;
}
