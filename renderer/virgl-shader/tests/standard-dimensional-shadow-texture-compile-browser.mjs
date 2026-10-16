import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../standard.mjs';
const need=(value,message)=>{if(!value)throw Error(message);};
const vertex='#version 300 es\nprecision highp float; precision highp int;\nin vec4 p; flat out uvec4 vso_g0; void main(){gl_Position=p;vso_g0=uvec4(0u);}\n';
const fragment='#version 300 es\nprecision highp float; precision highp int;\nsmooth in vec4 vso_g0; out vec4 color; void main(){color=vso_g0;}\n';
function shader(gl,stage,source,record){
  const object=gl.createShader(stage==='vertex'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);need(object,'native shader');
  gl.shaderSource(object,source);gl.compileShader(object);
  const okay=gl.getShaderParameter(object,gl.COMPILE_STATUS),log=gl.getShaderInfoLog(object);record.push({stage,source,okay,log});
  if(!okay){gl.deleteShader(object);throw Error('native '+stage+' shader '+log);}return object;
}
export async function runAcceptance(options){
  const report={schema:'dimensional-shadow-compile-only-v1',status:'running',guestExecution:false,productionNegotiation:false,frames:[],compiles:[],refusals:[]};window.__dimensionalShadowCompileReport=report;
  try{
    const canvas=document.createElement('canvas');document.querySelector('#draws').append(canvas);const gl=canvas.getContext('webgl2');need(gl instanceof WebGL2RenderingContext,'actual WebGL2');
    const extension=gl.getExtension('WEBGL_debug_renderer_info');report.gl={renderer:gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};
    need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.gl.renderer),'actual headed M4 Max Metal');
    const {cases}=await(await fetch(options.matrixPath)).json(), rows=(await(await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);need(cases.length===rows.length,'whole native matrix');
    const bridge=await createVirglStandardDimensionalShadowTextureShaderBridge();
    for(const [index,c]of cases.entries()){
      const stage=c.kind===43?'vertex':'fragment',result=bridge.translate({stage,text:c.a});need(JSON.stringify(result)===JSON.stringify(rows[index].result),c.name+' browser/native complete response');
      if(!result.ok){report.refusals.push({index,name:c.name,result});continue;}
      const record={index,name:c.name,stage,text:c.a,result,shaders:[],uniforms:[]};report.compiles.push(record);let program,vs,fs;
      try{
        vs=shader(gl,'vertex',stage==='vertex'?result.glsl:vertex,record.shaders);fs=shader(gl,'fragment',stage==='fragment'?result.glsl:fragment,record.shaders);
        program=gl.createProgram();need(program,'native program');gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
        record.link={okay:gl.getProgramParameter(program,gl.LINK_STATUS),log:gl.getProgramInfoLog(program)};need(record.link.okay,'native comparison link '+record.link.log);
        for(const sampler of result.metadata.samplers){
          const location=gl.getUniformLocation(program,sampler.name),slot=gl.getUniformIndices(program,[sampler.name])[0];need(location!==null&&slot!==gl.INVALID_INDEX,'active comparison sampler '+sampler.name);
          const type=gl.getActiveUniforms(program,[slot],gl.UNIFORM_TYPE)[0],size=gl.getActiveUniforms(program,[slot],gl.UNIFORM_SIZE)[0];
          need(type===(sampler.type==='samplerCubeShadow'?36293:36292)&&size===1,'literal native comparison sampler type');record.uniforms.push({...sampler,type,size});
        }
      }finally{
        if(program)gl.deleteProgram(program);if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);
        record.cleaned=(!program||!gl.isProgram(program))&&(!vs||!gl.isShader(vs))&&(!fs||!gl.isShader(fs));need(record.cleaned,'all native compile objects retired');
      }
    }
    need(gl.getError()===gl.NO_ERROR,'zero final GL errors');report.status='passed';document.querySelector('#status').textContent=report.compiles.length+' native comparison programs compiled and linked';
  }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Comparison compiler proof failed';}
  return report;
}
