import {createStandardPackedDepthResourceStore,createStandardPackedDepthTransferBackend} from '../resources.mjs';
import {checks,traceGL,blob as bytesBlob} from './standard-instanced-draws.mjs';
export {checks};
export const blob=(report,input)=>bytesBlob(report,new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice());
const caps=['BLEND','DEPTH_TEST','STENCIL_TEST','SCISSOR_TEST','CULL_FACE','DITHER','RASTERIZER_DISCARD','SAMPLE_ALPHA_TO_COVERAGE','SAMPLE_COVERAGE'];
const blends=['BLEND_EQUATION_RGB','BLEND_EQUATION_ALPHA','BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA'];
const stencilState=['STENCIL_FUNC','STENCIL_REF','STENCIL_VALUE_MASK','STENCIL_WRITEMASK','STENCIL_FAIL','STENCIL_PASS_DEPTH_FAIL','STENCIL_PASS_DEPTH_PASS'];
function blendEnabled(gl,enabled){const ext=gl.getExtension('OES_draw_buffers_indexed');if(ext)ext[enabled?'enableiOES':'disableiOES'](gl.BLEND,0);else gl[enabled?'enable':'disable'](gl.BLEND);}
function colorMask(gl,values){const ext=gl.getExtension('OES_draw_buffers_indexed');if(ext)ext.colorMaskiOES(0,...values);else gl.colorMask(...values);}
export function callerState(gl) {
 const indexed=gl.getExtension('OES_draw_buffers_indexed');
 return {program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),viewport:gl.getParameter(gl.VIEWPORT),mask:gl.getParameter(gl.COLOR_WRITEMASK),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK),active:gl.getParameter(gl.ACTIVE_TEXTURE),caps:caps.map(n=>gl.isEnabled(gl[n])),blend:blends.map(n=>gl.getParameter(gl[n])),stencil:[false,true].map(back=>stencilState.map(n=>gl.getParameter(gl[back?n.replace('STENCIL_','STENCIL_BACK_'):n]))),indexed:indexed?Array.from({length:gl.getParameter(gl.MAX_DRAW_BUFFERS)},(_,i)=>({mask:gl.getIndexedParameter(gl.COLOR_WRITEMASK,i),blend:blends.map(n=>gl.getIndexedParameter(gl[n],i))})):null};
}
function restoreState(gl,s) {
 gl.bindFramebuffer(gl.READ_FRAMEBUFFER,s.read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,s.draw);gl.bindVertexArray(s.vao);gl.useProgram(s.program);gl.viewport(...s.viewport);colorMask(gl,s.mask);gl.depthMask(s.depthMask);const ext=gl.getExtension('OES_draw_buffers_indexed');if(ext){ext.blendEquationSeparateiOES(0,...s.blend.slice(0,2));ext.blendFuncSeparateiOES(0,...s.blend.slice(2));}else{gl.blendEquationSeparate(...s.blend.slice(0,2));gl.blendFuncSeparate(...s.blend.slice(2));}caps.forEach((n,i)=>n==='BLEND'?blendEnabled(gl,s.caps[i]):gl[s.caps[i]?'enable':'disable'](gl[n]));
 s.stencil.forEach(([func,ref,mask,write,fail,zfail,zpass],i)=>{const side=i?gl.BACK:gl.FRONT;gl.stencilFuncSeparate(side,func,ref,mask);gl.stencilMaskSeparate(side,write);gl.stencilOpSeparate(side,fail,zfail,zpass);});
 const indexed=gl.getExtension('OES_draw_buffers_indexed');s.indexed?.forEach((v,i)=>{indexed.colorMaskiOES(i,...v.mask);indexed.blendEquationSeparateiOES(i,...v.blend.slice(0,2));indexed.blendFuncSeparateiOES(i,...v.blend.slice(2));});gl.activeTexture(s.active);
}
// Independent diagnostic writes float bit patterns to integer color lanes.
// Stencil uses exhaustive exact EQUAL references, unlike the product's bit mask
// accumulation. Neither path imports product packing or public conversion.
export async function nativeRead(r,texture,width,height,level=0,stencil=false) {
 const gl=r.traced,oldLabel=r.label;r.setLabel('independent-packed-depth-diagnostic');
 const previous=callerState(gl),objects=[];gl.activeTexture(gl.TEXTURE0);
 const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),oldSampler=gl.getParameter(gl.SAMPLER_BINDING),oldPack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),oldUnpack=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING),packNames=['PACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'],packValues=packNames.map(n=>gl.getParameter(gl[n]));
 gl.bindTexture(gl.TEXTURE_2D,texture);const names=['TEXTURE_BASE_LEVEL','TEXTURE_MAX_LEVEL','TEXTURE_COMPARE_MODE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER'],values=names.map(n=>gl.getTexParameter(gl.TEXTURE_2D,gl[n]));
 const make=(kind)=>{const o=gl['create'+kind]();if(!o)throw Error('independent depth '+kind+' allocation');objects.push([kind,o]);return o;};
 const shader=text=>{
  const p=make('Program');
  for(const[type,source]of [[gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'],[gl.FRAGMENT_SHADER,text]]){const s=gl.createShader(type);if(!s)throw Error('diagnostic shader allocation');objects.push(['Shader',s]);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
 };
 const data=new Uint32Array(width*height*4),stencilData=new Uint8Array(width*height*4);
 try {
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);packNames.forEach((n,i)=>gl.pixelStorei(gl[n],i===0?1:0));
  const fbo=make('Framebuffer'),vao=make('VertexArray'),color=make('Texture');gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,color);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,width,height);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent depth word framebuffer');
  const depth=shader('#version 300 es\nprecision highp float;precision highp int;uniform highp sampler2D src;uniform int level;layout(location=0)out uvec4 words;void main(){float z=texelFetch(src,ivec2(gl_FragCoord.xy),level).r;words=uvec4(floatBitsToUint(z),0u,0u,1u);}');
  gl.useProgram(depth);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,level);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.NONE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.bindSampler(0,null);gl.uniform1i(gl.getUniformLocation(depth,'src'),0);gl.uniform1i(gl.getUniformLocation(depth,'level'),level);
  caps.forEach(n=>n==='BLEND'?blendEnabled(gl,false):gl.disable(gl[n]));colorMask(gl,[true,true,true,true]);gl.viewport(0,0,width,height);gl.drawArrays(gl.TRIANGLES,0,3);if(gl.getError()!==gl.NO_ERROR)throw Error('independent depth word shader');
  await physicalFence(r,'independent-depth-word-completion');gl.readPixels(0,0,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,data);
  if(stencil) {
   r.setLabel('independent-exhaustive-stencil-diagnostic');gl.bindTexture(gl.TEXTURE_2D,null);
   const bytes=make('Texture');gl.bindTexture(gl.TEXTURE_2D,bytes);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);gl.bindTexture(gl.TEXTURE_2D,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,bytes,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,texture,level);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent stencil framebuffer');
   const p=shader('#version 300 es\nprecision highp float;uniform float reference;out vec4 value;void main(){value=vec4(reference/255.0,0.0,0.0,0.0);}');gl.useProgram(p);gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,0,0,0]));gl.depthMask(false);gl.stencilMask(0);gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);gl.enable(gl.STENCIL_TEST);
   for(let value=0;value<256;value++){gl.stencilFunc(gl.EQUAL,value,255);gl.uniform1f(gl.getUniformLocation(p,'reference'),value);gl.drawArrays(gl.TRIANGLES,0,3);}
   await physicalFence(r,'independent-exhaustive-stencil-completion');gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,stencilData);
  }
  if(gl.getError()!==gl.NO_ERROR)throw Error('independent depth or stencil read');const out=new Uint8Array(width*height*20);out.set(new Uint8Array(data.buffer));out.set(stencilData,data.byteLength);return out;
 } finally {
  gl.bindTexture(gl.TEXTURE_2D,texture);names.forEach((n,i)=>gl.texParameteri(gl.TEXTURE_2D,gl[n],values[i]));gl.bindTexture(gl.TEXTURE_2D,oldTexture);gl.bindSampler(0,oldSampler);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,oldPack);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,oldUnpack);packNames.forEach((n,i)=>gl.pixelStorei(gl[n],packValues[i]));restoreState(gl,previous);for(const[kind,o]of objects.reverse())gl['delete'+kind](o);r.setLabel(oldLabel);
 }
}
export function gpuClear(r,texture,level,[depth,stencil],packed) {
 const gl=r.traced,old=callerState(gl),framebuffer=gl.createFramebuffer();
 try {gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,packed?gl.DEPTH_STENCIL_ATTACHMENT:gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,texture,level);gl.drawBuffers([gl.NONE]);if(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('native floating depth clear framebuffer');gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.stencilMask(255);if(packed)gl.clearBufferfi(gl.DEPTH_STENCIL,0,depth,stencil);else gl.clearBufferfv(gl.DEPTH,0,new Float32Array([depth]));if(gl.getError()!==gl.NO_ERROR)throw Error('native floating depth clear');}
 finally {restoreState(gl,old);if(framebuffer)gl.deleteFramebuffer(framebuffer);}
}
export function rig(gl,c,{delay=0,fault=null,nativeFault=null,limits,hideIndexed=false}={}){
 const trace=traceGL(gl,c,delay),allocations=[],nativeObjects=[],nativeEvents=[],uploads=[],readbacks=[],faultEvents=[];let sequence=0,label='',armed=false,failed=false,owner=null,textureFaultCalls=0,framebufferFaultCalls=0,shaderFaultCalls=0;
 const traced=new Proxy(trace.gl,{get(target,name){
  const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   const seq=++sequence,eventStart=trace.events.length;let delivered=[...args];
   if(armed&&!failed&&((nativeFault==='texture'&&name==='createTexture')||(nativeFault==='framebuffer'&&name==='createFramebuffer')||(nativeFault==='buffer'&&name==='createBuffer')||(nativeFault==='fence'&&name==='fenceSync'))){failed=true;faultEvents.push({sequence:seq,label,name,delivered:null});return null;}
   if(armed&&!failed&&name==='createTexture'&&nativeFault?.startsWith('scratch-texture-')){textureFaultCalls++;if(textureFaultCalls===Number(nativeFault.at(-1))){failed=true;faultEvents.push({sequence:seq,label,name,ordinal:textureFaultCalls,delivered:null});return null;}}
   if(armed&&!failed&&name==='createFramebuffer'&&nativeFault==='framebuffer-draw'){framebufferFaultCalls++;if(framebufferFaultCalls===2){failed=true;faultEvents.push({sequence:seq,label,name,ordinal:2,delivered:null});return null;}}
   if(armed&&!failed&&name==='createShader'&&nativeFault==='shader-second'){shaderFaultCalls++;if(shaderFaultCalls===2){failed=true;faultEvents.push({sequence:seq,label,name,ordinal:2,delivered:null});return null;}}
   if(armed&&!failed&&nativeFault==='shader-source'&&name==='shaderSource'&&gl.getShaderParameter(args[0],gl.SHADER_TYPE)===gl.FRAGMENT_SHADER){failed=true;delivered[1]='invalid fragment source';faultEvents.push({sequence:seq,label,name,original:args[1],delivered:delivered[1]});}
   if(armed&&!failed&&nativeFault==='link'&&name==='linkProgram'){failed=true;const attached=gl.getAttachedShaders(args[0]),fragment=attached.find(shader=>gl.getShaderParameter(shader,gl.SHADER_TYPE)===gl.FRAGMENT_SHADER);gl.detachShader(args[0],fragment);faultEvents.push({sequence:seq,label,name,actualDetachedFragment:trace.id(fragment)});}
   if(armed&&!failed&&nativeFault==='uniform'&&name==='shaderSource'&&gl.getShaderParameter(args[0],gl.SHADER_TYPE)===gl.FRAGMENT_SHADER){failed=true;delivered[1]='#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.0);}';faultEvents.push({sequence:seq,label,name,original:args[1],delivered:delivered[1]});}
   if(armed&&!failed&&nativeFault==='initialize'&&['clearBufferiv','clearBufferuiv','clearBufferfv'].includes(name)){failed=true;delivered[0]=0;faultEvents.push({sequence:seq,label,name,original:args[0],delivered:0});}
   if(armed&&!failed&&['storage','scratch-storage'].includes(nativeFault)&&name==='texStorage2D'){failed=true;delivered[1]=0;faultEvents.push({sequence:seq,label,name,original:args[1],delivered:0});}
   if(armed&&!failed&&nativeFault==='upload-buffer'&&name==='bufferData'&&args[0]===gl.PIXEL_UNPACK_BUFFER){failed=true;delivered[1]=-1;faultEvents.push({sequence:seq,label,name,original:args[1],delivered:-1});}
   if(armed&&!failed&&nativeFault==='copy'&&name==='blitFramebuffer'){failed=true;delivered[9]=gl.LINEAR;faultEvents.push({sequence:seq,label,name,original:args[9],delivered:gl.LINEAR});}
   if(armed&&!failed&&nativeFault==='shader'&&name==='createShader'){failed=true;faultEvents.push({sequence:seq,label,name,delivered:null});return null;}
   if(armed&&!failed&&nativeFault==='program'&&name==='createProgram'){failed=true;faultEvents.push({sequence:seq,label,name,delivered:null});return null;}
   if(armed&&!failed&&nativeFault==='upload'&&name==='texSubImage2D'){failed=true;delivered[2]=-1;faultEvents.push({sequence:seq,label,name,original:args[2],delivered:-1});}
   if(armed&&!failed&&nativeFault==='read'&&name==='readPixels'){failed=true;delivered[4]=gl.DEPTH_COMPONENT;faultEvents.push({sequence:seq,label,name,original:args[4],delivered:gl.DEPTH_COMPONENT});}
   if(armed&&!failed&&nativeFault==='collect'&&name==='getBufferSubData'){failed=true;delivered[1]=-1;faultEvents.push({sequence:seq,label,name,original:args[1],delivered:-1});}
   if(fault==='upload-lane'&&name==='texSubImage2D'&&ArrayBuffer.isView(args[8])){delivered[8]=args[8].slice();delivered[8][0]=delivered[8][0]===0?1:0;faultEvents.push({sequence:seq,label,name,fault,original:args[8][0],delivered:delivered[8][0]});}
   if(fault==='copy-level'&&name==='framebufferTexture2D'&&args[0]===gl.READ_FRAMEBUFFER&&args[3]&&label==='original-packed-depth-range-copy'){delivered[4]=0;faultEvents.push({sequence:seq,label,name,fault,original:args[4],delivered:0});}
   if(fault==='stencil-selection'&&name==='stencilFunc'&&label.startsWith('original-packed-depth-sync-read')){
    delivered[0]=gl.NOTEQUAL;faultEvents.push({sequence:seq,label,name,fault,original:args[0],delivered:delivered[0]});
   }
   if(name==='getExtension'&&args[0]==='OES_draw_buffers_indexed'&&hideIndexed){nativeEvents.push({sequence:seq,label,name,requested:args[0],actualAvailable:Boolean(method(...delivered)),deliberatelyMasked:true});return null;}
   const answer=method(...delivered),id=trace.id;for(const event of trace.events.slice(eventStart))event.sequence=seq;
   if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&answer)nativeObjects.push({object:answer,id:id(answer),name,label,deleted:0});
   if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){const row=nativeObjects.find(row=>row.object===args[0]);if(row){row.deleted++;c.same(row.deleted,1,'each owned packed-depth image native object retires once');}}
   if(name==='texSubImage2D')uploads.push({sequence:seq,label,texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D)),type:ArrayBuffer.isView(delivered[8])?delivered[8].constructor.name:'PBO',unpackBuffer:id(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)),args:delivered.slice(0,8),raw:ArrayBuffer.isView(delivered[8])?new Uint8Array(delivered[8].buffer,delivered[8].byteOffset,delivered[8].byteLength).slice():null});
   if(name==='bufferSubData'&&ArrayBuffer.isView(delivered[2]))uploads.push({sequence:seq,label,name,args:delivered.slice(0,2),type:delivered[2].constructor.name,unpackBuffer:id(gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)),raw:new Uint8Array(delivered[2].buffer,delivered[2].byteOffset,delivered[2].byteLength).slice()});
   if(name==='readPixels')readbacks.push({sequence:seq,label,name,type:ArrayBuffer.isView(delivered[6])?delivered[6].constructor.name:'PBO',args:delivered.slice(0,6),offset:ArrayBuffer.isView(delivered[6])?null:delivered[6],buffer:id(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)),raw:ArrayBuffer.isView(delivered[6])?new Uint8Array(delivered[6].buffer,delivered[6].byteOffset,delivered[6].byteLength).slice():null});
   if(name==='getBufferSubData'&&ArrayBuffer.isView(delivered[2]))readbacks.push({sequence:seq,label,name,args:delivered.slice(0,2),buffer:id(gl.getParameter(gl.COPY_READ_BUFFER_BINDING)),raw:new Uint8Array(delivered[2].buffer,delivered[2].byteOffset,delivered[2].byteLength).slice()});
   if(['texStorage2D','texParameteri','framebufferTexture2D','drawArrays','uniform1i','uniform2i','uniform1f','bindBuffer','bufferData','shaderSource','linkProgram','clearBufferuiv','clearBufferiv','clearBufferfv','clearBufferfi','blitFramebuffer','stencilFunc','stencilMask','stencilOp','depthMask','getShaderParameter','getProgramParameter','getUniformLocation','compileShader'].includes(name))nativeEvents.push({sequence:seq,label,name,...(owner?{budgets:owner.store.inspect().budgets}:{}),args:delivered.map(value=>ArrayBuffer.isView(value)||Array.isArray(value)?[...value]:value&&typeof value==='object'?id(value):value),...(name==='texStorage2D'?{texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D))}:{}),...(name==='bufferData'?{buffer:id(gl.getParameter(delivered[0]===gl.PIXEL_PACK_BUFFER?gl.PIXEL_PACK_BUFFER_BINDING:delivered[0]===gl.PIXEL_UNPACK_BUFFER?gl.PIXEL_UNPACK_BUFFER_BINDING:gl.COPY_WRITE_BUFFER_BINDING))}:{}),...(name==='drawArrays'?{program:id(gl.getParameter(gl.CURRENT_PROGRAM)),target:id(gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME))}:{}),...(['getShaderParameter','getProgramParameter'].includes(name)?{result:answer}:{}),...(name==='getUniformLocation'?{uniform:args[1],found:answer!==null}:{})});
   return answer;
  };
 }});
 const backend=c.ok(createStandardPackedDepthTransferBackend(traced),'selected actual packed-depth image transfer backend').backend;
 owner=c.ok(createStandardPackedDepthResourceStore({backend:{...backend,allocate(meta){const storage=backend.allocate(meta);allocations.push({metadata:meta,storage});return storage;}},...(limits?{limits}:{})}),'selected actual packed-depth image owner');
 for(const id of [1,2])c.ok(owner.store.createContext(id),'original packed-depth image context');
 return{...owner,backend,gl,traced,c,trace,allocations,nativeObjects,nativeEvents,uploads,readbacks,faultEvents,operations:[],setLabel(value){label=value;trace.label(value);},armFault(){armed=true;},get label(){return label;}};
}
export async function physicalFence(r,label){
 r.setLabel(label);const sync=r.traced.fenceSync(r.gl.SYNC_GPU_COMMANDS_COMPLETE,0);r.c.same(Boolean(sync),true,'actual packed-depth image final fence allocation');r.traced.flush();let status;
 try{for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();status=r.traced.clientWaitSync(sync,0,0);if(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED)break;r.c.same(status,r.gl.TIMEOUT_EXPIRED,'physical packed-depth image fence remains legal');}r.c.same(status===r.gl.ALREADY_SIGNALED||status===r.gl.CONDITION_SATISFIED,true,'bounded physical packed-depth image fence completed');return r.trace.events.filter(row=>row.name==='clientWaitSync').at(-1);}finally{r.traced.deleteSync(sync);}
}
export async function poll(r,ticket,{discard=false}={}){
 let result;for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();result=r.c.ok(r.asyncAccess.poll(ticket,discard),'actual later-task packed-depth image readback poll');if(result.status==='ready')break;}r.c.same(result.status,'ready','bounded physical packed-depth image readback completion');return result;
}
export function add(r,metadata,bytes){const resource=r.c.ok(r.store.createResource(metadata),'original packed-depth image resource allocation').resource;if(bytes){r.c.ok(r.store.attachBacking(metadata.id,[bytes.subarray(0,Math.min(7,bytes.length)),bytes.subarray(Math.min(7,bytes.length))]),'nonaligned owned packed-depth image backing');}for(const id of [1,2])r.c.ok(r.store.attachContext(id,metadata.id),'packed-depth image context membership');return resource;}
export async function finish(r,report,row){
 r.c.ok(r.store.dispose(),'selected packed-depth image owner disposal');Object.assign(row,{allocations:r.allocations.map(row=>({metadata:row.metadata,texture:r.trace.id(row.storage.texture),buffer:r.trace.id(row.storage.buffer),uploadBuffer:r.trace.id(row.storage.depthUploadBuffer),copyScratch:row.storage.sharedCopyScratch?{texture:r.trace.id(row.storage.sharedCopyScratch.texture),buffer:r.trace.id(row.storage.sharedCopyScratch.buffer),width:row.storage.sharedCopyScratch.width,height:row.storage.sharedCopyScratch.height}:null})),nativeEvents:r.nativeEvents,faultEvents:r.faultEvents,events:r.trace.events,operations:r.operations,nativeObjects:r.nativeObjects.map(({object,...row})=>row),final:r.store.inspect()});for(const kind of ['uploads','readbacks']){row[kind]=[];for(const {raw,...info}of r[kind])row[kind].push({...info,bytes:raw?await blob(report,raw):null});}for(const fence of row.events.filter(e=>e.name==='fenceSync'))r.c.same(row.events.filter(e=>e.name==='deleteSync'&&e.sync===fence.sync).length,1,'all owned packed-depth syncs retire once');for(const object of row.nativeObjects)r.c.same(object.deleted,1,'all packed-depth image native objects retire exactly once');for(const value of Object.values(row.final.budgets))r.c.same(value,0,'all packed-depth image terminal owner budgets zero');return row;
}
