import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from '../../../web/node_modules/playwright/index.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),fixture=JSON.parse(await fs.readFile(path.join(dir,process.argv[2]??'gpu-inputs.json'),'utf8'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.setContent('<canvas width="16" height="16"></canvas>');
 const report=await page.evaluate(fixture=>{
  const assert=(c,m)=>{if(!c)throw Error(m)},gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');assert(gl,'WebGL2');
  const report={renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),programs:[],draws:0};assert(!/swiftshader|llvmpipe/i.test(report.renderer),'hardware GPU required');
  const decode=w=>{const e=(w>>>23)&255,f=w&0x7fffff;return (w>>>31?-1:1)*(e===0?f*2**-149:(f+2**23)*2**(e-150));};
  for(const def of fixture.programs){
   const p=gl.createProgram(),shaders=[];
   for(const[type,source]of[[gl.VERTEX_SHADER,def.result.glsl],[gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.0);}']]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);assert(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(p,s);}
   gl.transformFeedbackVaryings(p,['vso_g0','vso_g1'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(p);assert(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));gl.useProgram(p);
   const vao=gl.createVertexArray();gl.bindVertexArray(vao);const tf=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);const buffer=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
   const block=gl.getUniformBlockIndex(p,'VirglBlock'),ubo=gl.createBuffer();if(block!==gl.INVALID_INDEX){gl.uniformBlockBinding(p,block,0);gl.bindBuffer(gl.UNIFORM_BUFFER,ubo);gl.bufferData(gl.UNIFORM_BUFFER,1024,gl.STATIC_DRAW);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,ubo);}
   const location=gl.getUniformLocation(p,'vsconst0[0]'),entry={name:def.name,vectors:[]};report.programs.push(entry);
   gl.enable(gl.RASTERIZER_DISCARD);
   for(const vec of def.vectors){
    for(const [i,values]of [[0,[0,0,0,1]],...vec.inputs.map((v,i)=>[i+1,v])]){const loc=gl.getAttribLocation(p,`in_${i}`);if(loc>=0){gl.disableVertexAttribArray(loc);gl.vertexAttrib4fv(loc,new Float32Array(values));}}
    const record={captures:[]};entry.vectors.push(record);
    for(const shift of[0,8,16,24]){gl.uniform4uiv(location,new Uint32Array([shift,shift,shift,shift]));gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const bytes=new Uint8Array(32);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);assert(gl.getError()===gl.NO_ERROR,'GPU no errors');const words=[...new Uint32Array(bytes.buffer)];record.captures.push({shift,words});report.draws++;
     for(let lane=0;lane<4;lane++){const actual=words[lane],expected=vec.expectedWords[lane];if(lane<vec.divisionLanes){const [n,d]=vec.rationals[lane].map(Number),q=n/d,spacing=2**(Math.floor(Math.log2(Math.abs(q)))-23);assert(q===0?decode(actual)===0:Math.abs(decode(actual)-q)<=2.5*spacing,`${def.name} DIV rational range`);}else assert(actual===expected||(expected===0&&actual===0x80000000),`${def.name} exact lane${lane}: expected${expected} observed${actual}`);
      const byte=(actual>>>shift)&255;assert(words[lane+4]===0x3f000000+byte*32768,`${def.name} simultaneous raw shadow lane${lane}`);}
    }
   }
   gl.disable(gl.RASTERIZER_DISCARD);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.deleteBuffer(buffer);gl.deleteBuffer(ubo);gl.deleteTransformFeedback(tf);gl.deleteVertexArray(vao);shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(p);
  }
  return report;
 },fixture);
 report.status='passed';report.consoleErrors=errors;report.sourceDigests=fixture.runtimeSourceDigests;report.librarySha256=fixture.librarySha256;await fs.writeFile(path.join(dir,process.argv[3]??'gpu-results.json'),JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({status:report.status,renderer:report.renderer,programs:report.programs.length,draws:report.draws,consoleErrors:errors}));
}catch(error){await fs.writeFile(path.join(dir,process.argv[3]??'gpu-failure.json'),JSON.stringify({status:'failed',message:error.message,stack:error.stack,librarySha256:fixture.librarySha256},null,2)+'\n');throw error;}finally{await browser.close();}
