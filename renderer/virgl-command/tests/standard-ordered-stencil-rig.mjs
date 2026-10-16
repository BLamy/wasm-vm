import {rig as heldRig,finish as heldFinish,nativeStencil} from './standard-stencil-rig.mjs';
import {createVirglStandardOrderedStencilAsyncRenderer} from '../state.mjs';
export {blob,nativeRead,physicalFence,submit,checks} from './standard-stencil-rig.mjs';
const draws=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'];
export function rig(gl,bridge,c,f,options={}){
 const owned=[],states=[],controls=[],bufferOps=[],inputBodies=new Map();let r,armed=false,failed=false,nativeCalls=0,allocationCalls=0,uploadCalls=0;
 const binding=target=>({[gl.ARRAY_BUFFER]:gl.ARRAY_BUFFER_BINDING,[gl.ELEMENT_ARRAY_BUFFER]:gl.ELEMENT_ARRAY_BUFFER_BINDING,[gl.COPY_READ_BUFFER]:gl.COPY_READ_BUFFER_BINDING,[gl.COPY_WRITE_BUFFER]:gl.COPY_WRITE_BUFFER_BINDING,[gl.PIXEL_PACK_BUFFER]:gl.PIXEL_PACK_BUFFER_BINDING,[gl.PIXEL_UNPACK_BUFFER]:gl.PIXEL_UNPACK_BUFFER_BINDING,[gl.UNIFORM_BUFFER]:gl.UNIFORM_BUFFER_BINDING})[target];
 const observed=new Proxy(gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{let record=null;if(r&&['copyBufferSubData','bufferSubData','bufferData','getBufferSubData'].includes(name))record={name,index:bufferOps.length,label:r.label,beforeEventSequence:r.events.at(-1)?.sequence??0,buffer:r.trace.id(gl.getParameter(binding(name==='copyBufferSubData'?args[1]:args[0]))),...(name==='copyBufferSubData'?{source:r.trace.id(gl.getParameter(binding(args[0])))}:{}),args:args.map(value=>ArrayBuffer.isView(value)?{type:value.constructor.name,bytes:value.byteLength}:value),completion:r.lastCompletion};
   const answer=method.apply(target,args);if(record)bufferOps.push(record);return answer;
  };
 }});
 const selected=options.rendererFactory??createVirglStandardOrderedStencilAsyncRenderer;
 const snapshot=()=>({stencil:nativeStencil(gl),cull:gl.isEnabled(gl.CULL_FACE),cullFace:gl.getParameter(gl.CULL_FACE_MODE),ebo:r?.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING))??null,provoking:gl.getParameter(gl.getExtension('WEBGL_provoking_vertex').PROVOKING_VERTEX_WEBGL)});
 const inputs=()=>{const program=gl.getParameter(gl.CURRENT_PROGRAM),rows=[];for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){const info=gl.getActiveAttrib(program,i),location=gl.getAttribLocation(program,info.name);if(location<0)continue;const buffer=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),enabled=gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED),id=r.trace.id(buffer);if(enabled&&!inputBodies.has(id)){const previous=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);observed.bindBuffer(gl.COPY_READ_BUFFER,buffer);const raw=new Uint8Array(gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE));observed.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);observed.bindBuffer(gl.COPY_READ_BUFFER,previous);inputBodies.set(id,{buffer:id,raw,completion:{...r.lastCompletion},beforeEventSequence:r.events.at(-1)?.sequence??0});}rows.push({name:info.name,location,buffer:id,enabled,components:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),normalized:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),divisor:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_DIVISOR),genericValues:[...gl.getVertexAttrib(location,gl.CURRENT_VERTEX_ATTRIB)]});}return rows;};
 const factory=config=>selected({...config,gl:new Proxy(config.gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   const delivered=[...args],isDraw=draws.includes(name),interesting=isDraw||name==='cullFace'||(name==='enable'||name==='disable')&&args[0]===gl.CULL_FACE;
   if(armed&&!failed&&options.failure==='allocation'&&name==='createBuffer'&&++allocationCalls===(options.failAt??2)){
    const buffer=method(...args);if(buffer)target.deleteBuffer(buffer);failed=true;controls.push({name,kind:'actual-allocation-rollback',nativeBuffer:r.trace.id(buffer),delivered:null});return null;
   }
   if(armed&&!failed&&options.failure==='upload'&&name==='bufferData'&&args[0]===gl.ELEMENT_ARRAY_BUFFER&&args[1] instanceof Uint32Array&&++uploadCalls===(options.failAt??2)){failed=true;delivered[2]=0;controls.push({name,kind:'actual-invalid-usage',original:args[2],delivered:0});}
   if(isDraw&&armed){nativeCalls++;if(!failed&&options.failure==='draw'&&nativeCalls===(options.failAt??3)){failed=true;delivered[0]=0xffffffff;controls.push({name,kind:'actual-invalid-mode',nativeCalls,original:args[0],delivered:delivered[0]});}}
   const vertexInputs=isDraw?inputs():null;
   const before=interesting?{...(isDraw?{vertexInputs}:{}),eventSequence:r?.events.at(-1)?.sequence??0,native:snapshot(),inspection:r?.renderer.inspect().jobs??null}:null;
   let entry;
   if(name==='bufferData'&&args[0]===gl.ELEMENT_ARRAY_BUFFER&&args[1] instanceof Uint32Array){entry={buffer:gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING),raw:new Uint8Array(args[1].buffer,args[1].byteOffset,args[1].byteLength).slice(),label:r?.label??'',inspection:r?.renderer.inspect().jobs??null,deleted:false};owned.push(entry);}
   if(name==='deleteBuffer'){
    entry=owned.find(row=>row.buffer===args[0]);if(entry){const previous=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);observed.bindBuffer(gl.COPY_READ_BUFFER,entry.buffer);const size=gl.getBufferParameter(gl.COPY_READ_BUFFER,gl.BUFFER_SIZE),raw=new Uint8Array(size);observed.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);observed.bindBuffer(gl.COPY_READ_BUFFER,previous);entry.gpu=raw;entry.deleted=true;entry.retirement={completion:r.lastCompletion,eventSequence:r.events.at(-1)?.sequence??0,inspection:r.renderer.inspect().jobs};}
   }
   const answer=method(...delivered);
   if(interesting)states.push({index:states.length,label:r?.label??'',name,args:[...args],delivered:[...delivered],before,after:{eventSequence:r?.events.at(-1)?.sequence??0,native:snapshot()}});
   return answer;
  };
 }}),...(options.selection?{primitiveAssembly:options.selection}:{})});
 r=heldRig(observed,bridge,c,f,{...options,primitiveAssembly:'lists',rendererFactory:factory});r.orderedStates=states;r.orderedIndices=owned;r.orderedControls=controls;r.orderedBufferOps=bufferOps;r.orderedInputBodies=inputBodies;r.armOrderedFailure=(value=true)=>{armed=value;};r.nativeOrderedState=snapshot;return r;
}
export async function finish(r,report,row){await heldFinish(r,report,row);row.vertexInputBodies=[];for(const {raw,...value}of r.orderedInputBodies.values())row.vertexInputBodies.push({...value,bytes:await blob(report,raw)});row.orderedStates=r.orderedStates;row.orderedControls=r.orderedControls;row.orderedBufferOps=r.orderedBufferOps;row.orderedIndices=[];for(const {buffer,raw,gpu,...value}of r.orderedIndices){row.orderedIndices.push({...value,nativeBuffer:r.trace.id(buffer),input:await blob(report,raw),gpu:gpu?await blob(report,gpu):null});}return row;}
import {blob} from './standard-stencil-rig.mjs';
