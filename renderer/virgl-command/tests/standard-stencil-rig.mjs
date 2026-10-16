import {rig as heldRig,finish as heldFinish,blob,nativeRead,physicalFence,submit,checks} from './standard-packed-depth-consumer-rig.mjs';
import {createVirglStandardStencilAsyncRenderer} from '../state.mjs';
export {blob,nativeRead,physicalFence,submit,checks};
const stencilNames=['STENCIL_FUNC','STENCIL_REF','STENCIL_VALUE_MASK','STENCIL_WRITEMASK','STENCIL_FAIL','STENCIL_PASS_DEPTH_FAIL','STENCIL_PASS_DEPTH_PASS'];
export const nativeStencil=gl=>({enabled:gl.isEnabled(gl.STENCIL_TEST),frontFace:gl.getParameter(gl.FRONT_FACE),faces:[false,true].map(back=>Object.fromEntries(stencilNames.map(name=>[name,gl.getParameter(gl[back?name.replace('STENCIL_','STENCIL_BACK_'):name])])))});
export function rig(gl,bridge,c,f,options={}){
 const states=[],controls=[];let r,armed=false,failed=false;
 const selected=options.rendererFactory??createVirglStandardStencilAsyncRenderer;
 const factory=opts=>selected({...opts,gl:new Proxy(opts.gl,{get(target,name){
  const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
  return(...args)=>{
   const delivered=[...args],interesting=['stencilFuncSeparate','stencilMaskSeparate','stencilOpSeparate','clearStencil','frontFace','clear','drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(name)||(name==='enable'||name==='disable')&&args[0]===gl.STENCIL_TEST;
   if(armed&&!failed&&options.stencilFailure===name){failed=true;delivered[0]=0;controls.push({name,args:[...args],delivered:[...delivered]});}
   if(armed&&options.stencilFault==='operation'&&name==='stencilOpSeparate'){delivered[1]=gl.KEEP;delivered[2]=gl.KEEP;delivered[3]=gl.KEEP;controls.push({name,args:[...args],delivered:[...delivered]});}
   if(armed&&options.stencilFault==='value-mask'&&name==='stencilFuncSeparate'){delivered[3]=0;controls.push({name,args:[...args],delivered:[...delivered]});}
   const before=interesting?{eventSequence:r?.events.at(-1)?.sequence??0,state:nativeStencil(gl)}:null;
   const answer=method(...delivered);
   if(interesting)states.push({index:states.length,label:r?.label??'',name,args:[...args],delivered:[...delivered],before,after:{eventSequence:r?.events.at(-1)?.sequence??0,state:nativeStencil(gl)}});
   return answer;
  };
 }})});
 r=heldRig(gl,bridge,c,f,{...options,rendererFactory:factory});r.stencilStates=states;r.stencilControls=controls;r.armStencilControl=(value=true)=>{armed=value;};return r;
}
export async function finish(r,report,row){await heldFinish(r,report,row);row.stencilStates=r.stencilStates;row.stencilControls=r.stencilControls;return row;}
