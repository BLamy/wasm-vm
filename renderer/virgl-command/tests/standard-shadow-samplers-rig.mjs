import {rig as heldRig,finish as heldFinish} from './standard-packed-depth-consumer-rig.mjs';
import {createVirglStandardShadowSamplerAsyncRenderer as selected} from '../state.mjs';
export {blob,nativeRead,physicalFence,submit,checks} from './standard-packed-depth-consumer-rig.mjs';
const draws=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'];
export function rig(gl,bridge,c,f,options={}){
 let r,armed=false,failed=false;const calls=[],states=[],controls=[],names=new Map();
 const snapshot=()=>{const program=gl.getParameter(gl.CURRENT_PROGRAM),uniforms=[],samplers=[],active=gl.getParameter(gl.ACTIVE_TEXTURE);if(!program)return null;
  for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){
   const info=gl.getActiveUniform(program,i),location=gl.getUniformLocation(program,info.name),value=location===null?null:gl.getUniform(program,location);
   uniforms.push({name:info.name,type:info.type,size:info.size,value:ArrayBuffer.isView(value)?[...value]:value});
   if(![gl.SAMPLER_2D_SHADOW,gl.SAMPLER_2D,gl.INT_SAMPLER_2D,gl.UNSIGNED_INT_SAMPLER_2D].includes(info.type))continue;
   gl.activeTexture(gl.TEXTURE0+value);const sampler=gl.getParameter(gl.SAMPLER_BINDING),texture=gl.getParameter(gl.TEXTURE_BINDING_2D);
   samplers.push({name:info.name,type:info.type,unit:value,sampler:r.trace.id(sampler),texture:r.trace.id(texture),
    parameters:Object.fromEntries(['TEXTURE_COMPARE_MODE','TEXTURE_COMPARE_FUNC','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_MIN_LOD','TEXTURE_MAX_LOD'].map(key=>[key,sampler?gl.getSamplerParameter(sampler,gl[key]):null])),
    base:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),last:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL)});
  }gl.activeTexture(active);return {program:r.trace.id(program),uniforms,samplers};};
 const factory=config=>selected({...config,gl:new Proxy(config.gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   const delivered=[...args];
   if(armed&&options.fault==='mask'&&name==='uniform4fv'&&/shadmask/.test(names.get(args[0])??'')){delivered[1]=new Float32Array(args[1]);delivered[1][0]=0;controls.push({name,kind:'actual-mask-corruption',original:[...args[1]],delivered:[...delivered[1]]});}
   if(armed&&options.fault==='compare'&&draws.includes(name)){
    const program=gl.getParameter(gl.CURRENT_PROGRAM),active=gl.getParameter(gl.ACTIVE_TEXTURE);
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(program,i);if(info.type!==gl.SAMPLER_2D_SHADOW)continue;
     const unit=gl.getUniform(program,gl.getUniformLocation(program,info.name));gl.activeTexture(gl.TEXTURE0+unit);const sampler=gl.getParameter(gl.SAMPLER_BINDING),original=gl.getSamplerParameter(sampler,gl.TEXTURE_COMPARE_FUNC);
     target.samplerParameteri(sampler,gl.TEXTURE_COMPARE_FUNC,gl.NEVER);controls.push({name:'samplerParameteri',kind:'actual-compare-corruption',original,delivered:gl.NEVER,sampler:r.trace.id(sampler)});
    }gl.activeTexture(active);
   }
   if(armed&&!failed&&options.failure==='binding'&&name==='uniform4fv'&&/shadmask/.test(names.get(args[0])??'')){
    failed=true;target.uniform4uiv(args[0],new Uint32Array(args[1]));controls.push({name,kind:'actual-invalid-native-shadow-binding'});return;
   }
   const before=draws.includes(name)?snapshot():null,actual=method(...delivered);let answer=actual;
   const control=options.reflection;
   if(control&&((name==='getUniformLocation'||name==='getUniformIndices')&&String(args[1]).includes('shadmask')||
     name==='getActiveUniforms'&&args[1][0]===gl.getUniformIndices(args[0],['fsshadmask7'])[0]||
     name==='getUniform'&&/shadmask/.test(names.get(args[1])??'')||name==='getParameter'&&args[0]===gl.MAX_FRAGMENT_UNIFORM_COMPONENTS)){
    if(name==='getUniformLocation'&&control==='location')answer=null;
    if(name==='getUniformIndices'&&control==='index')answer=[gl.INVALID_INDEX];
    if(name==='getUniformIndices'&&control==='undefined-index')answer=[];
    if(name==='getActiveUniforms'&&args[2]===gl.UNIFORM_TYPE&&control==='type')answer=[gl.UNSIGNED_INT_VEC4];
    if(name==='getActiveUniforms'&&args[2]===gl.UNIFORM_SIZE&&control==='size')answer=[2];
    if(name==='getUniform'&&control==='default')answer=new Float32Array([1,0,0,0]);
    if(name==='getUniform'&&control==='shape')answer=[0,0,0,0];
    if(name==='getParameter'&&control==='budget')answer=7;
    if(answer!==actual)controls.push({name,kind:'tightened-native-reflection',control,actual:ArrayBuffer.isView(actual)||Array.isArray(actual)?[...actual]:actual&&typeof actual==='object'?'native-location':actual,delivered:ArrayBuffer.isView(answer)||Array.isArray(answer)?[...answer]:answer});
   }
   if(name==='getUniformLocation'&&answer)names.set(answer,args[1]);
   if(['getUniformLocation','getUniformIndices','getActiveUniforms','getUniform','uniform4fv','uniform1i','samplerParameteri','samplerParameterf'].includes(name))
    calls.push({name,label:r?.label??'',args:delivered.map(v=>ArrayBuffer.isView(v)||Array.isArray(v)?[...v]:v&&typeof v==='object'?r?.trace.id(v)??null:v),
     result:ArrayBuffer.isView(answer)||Array.isArray(answer)?[...answer]:answer&&typeof answer==='object'?r?.trace.id(answer)??null:answer});
   if(before)states.push({name,args:[...args],before,eventSequence:r.events.at(-1)?.sequence??0});
   return answer;
  };
 }})});
 r=heldRig(gl,bridge,c,f,{...options,rendererFactory:factory});r.shadowCalls=calls;r.shadowStates=states;r.shadowControls=controls;r.armShadow=value=>{armed=value;};return r;
}
export async function finish(r,report,row){await heldFinish(r,report,row);row.shadowCalls=r.shadowCalls;row.shadowStates=r.shadowStates;row.shadowControls=r.shadowControls;return row;}
