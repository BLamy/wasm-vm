// Original instance/divisor/two-face stencil draws composed with native shadow lookup.
import {rig,finish,blob,nativeRead,submit,checks} from './standard-instanced-stencil-rig.mjs';
import {createVirglStandardShadowSamplerAsyncRenderer} from '../state.mjs';
import {createVirglStandardShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {fixture,setup,state,draw,join,packet} from '../../../tools/virgl-instanced-stencil/fixtures.mjs';
import {model,compare} from '../../../tools/virgl-instanced-stencil/oracle.mjs';
import {metadata,textureTransfer,shader,imageView} from '../../../tools/virgl-shadow-samplers/fixtures.mjs';
export async function runAcceptance({seed=0x493a170d}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardShadowTextureShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'inherited',seed,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};window.__standardShadowSamplerEvidence=report;
 for(const format of [20,126])for(const primitive of [4,5,6]){
  const f=fixture({seed,format,mode:primitive,instances:5,attributeFormat:173,generic:false,attributeDivisor:3}),originalFragment=f.fragment;
  f.fragment=originalFragment.replace('0: MOV', 'DCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT\nDCL TEMP[0..1]\nIMM[0] FLT32 {0.5,0.5,0.5,1}\n0: MOV').replace('0: MOV OUT[0], IN[0]','0: MOV TEMP[1], IN[0]').replace('1: END\n','1: TEX TEMP[0], IMM[0], SAMP[7], SHADOW2D\n2: MUL OUT[0], TEMP[1], TEMP[0]\n3: END\n');
  let r;const samples=[];
  const rendererFactory=config=>createVirglStandardShadowSamplerAsyncRenderer({...config,gl:new Proxy(config.gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{
   let before;if(['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(name)){
    const program=gl.getParameter(gl.CURRENT_PROGRAM),uniforms={};for(const key of ['fssamp7','fsshadmask7','fsshadadd7','wv_instance_base']){const location=gl.getUniformLocation(program,key),value=location?gl.getUniform(program,location):null;uniforms[key]=ArrayBuffer.isView(value)?[...value]:value;}
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0+uniforms.fssamp7);const sampler=gl.getParameter(gl.SAMPLER_BINDING),texture=gl.getParameter(gl.TEXTURE_BINDING_2D);before={uniforms,sampler:r.trace.id(sampler),texture:r.trace.id(texture),mode:gl.getSamplerParameter(sampler,gl.TEXTURE_COMPARE_MODE),func:gl.getSamplerParameter(sampler,gl.TEXTURE_COMPARE_FUNC)};gl.activeTexture(active);
   }
   const answer=method(...args);if(before)samples.push({name,args:[...args],before,eventSequence:r.events.at(-1).sequence});return answer;
  };}})});
  r=rig(gl,bridge,c,f,{rendererFactory,step:1,delay:3});const row={name:'inherited-shadow/'+format+'/'+primitive,format,width:f.width,height:f.height,level:f.level,outputLevel:f.outputLevel,vertexText:f.vertex,fragmentText:f.fragment,originalFragment,clearWords:f.clearWords,planes:[],buffers:[],frames:[],nativeSamples:samples};r.blobs=report.blobs;report.runs.push(row);
  try{
   r.add(metadata(1,31,f.targetWidth,f.targetHeight,f.outputLastLevel),new Uint8Array(20000).fill(0x2e));for(const [id,bytes]of f.buffers){r.add({id,target:0,format:64,bind:0,width:bytes.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},bytes);row.buffers.push({id,input:await blob(report,bytes)});}
   r.add(f.source.metadata,f.source.backing);row.sourceMetadata=f.source.metadata;row.sourceBacking=await blob(report,f.source.backing);for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
   const depth=new Uint8Array(new Float32Array(4).fill(.5).buffer);r.add(metadata(9,18,2,2,0,8),depth);row.shadowInput=await blob(report,depth);
   c.ok((await submit(r,1,join(setup(f),state(f),textureTransfer(9,0,2,2,0,8),packet(1,7,[50,2|2<<3|2<<6|2<<11|1<<15|7<<16,0,0,0,0,0,0,0]),imageView(51,9,18,0,0,[0,1,2,3]),packet(10,0,[1,7,51]),packet(18,0,[1,7,50])),'shadow-inherited-setup')).result,'original instance/stencil/shadow setup');
   row.execution=await submit(r,1,draw(f),'shadow-inherited-draw');c.ok(row.execution.result,'ordered instanced shadow completion');
   const color=r.allocations.find(a=>a.metadata.id===1).storage.texture,depthTexture=r.allocations.find(a=>a.metadata.id===6).storage.texture,native=await nativeRead(r,color,31,f.width,f.height,f.outputLevel),completion={...r.lastCompletion},nativeDepth=await nativeRead(r,depthTexture,format,f.width,f.height,f.level),frame={historyIndex:r.history.length-1,completion,native:await blob(report,native),depth:await blob(report,nativeDepth)};row.frames.push(frame);
   // The original ALWAYS state and identity comparison view make the added
   // original TEX/MUL an identity. Prove the exact source/packets first, then
   // apply the held independent original primitive/stencil model to that body.
   row.oracleHistory=r.history.map(h=>{if(!h.hex.includes(BufferlessHex(shader(11,1,f.fragment))))return h;return{...h,hex:h.hex.replace(BufferlessHex(shader(11,1,f.fragment)),BufferlessHex(shader(11,1,originalFragment)))};});
   const predicted=model(row.oracleHistory,f.buffers,{format,width:f.width,height:f.height,input:f.source.planes[f.level].input,clearWords:f.clearWords});
   c.same(compare(predicted,native,nativeDepth,f.width,f.height,format),[],'whole inherited original color/depth/stencil plane');
  }finally{await finish(r,report,row);}
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};}
 }
 report.status='passed';return report;
}
const BufferlessHex=bytes=>[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
