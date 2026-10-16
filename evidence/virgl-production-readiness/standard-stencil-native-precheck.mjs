import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const repo='/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm';
const output='/tmp/wasmvm-production-api-plan/stencil-native-precheck';
const sha=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(output,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
const executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({executablePath:executable,headless:false,args:['--enable-gpu']});
const report={schema:1,authority:'native-host-precheck-only',guestExecution:false,productionNegotiation:false,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),source:{bytes:(await fs.readFile(import.meta.filename)).length,sha256:sha(await fs.readFile(import.meta.filename))},browser:{executable,sha256:sha(await fs.readFile(executable)),version:browser.version()},console:[],pageErrors:[]};
try{
 const session=await browser.newBrowserCDPSession();report.browser.system=await session.send('SystemInfo.getInfo');report.browser.command=await session.send('Browser.getBrowserCommandLine');
 const page=await browser.newPage();page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.setContent('<!doctype html><title>Original stencil native precheck</title><h1>Native stencil boundary precheck</h1><canvas id="gpu" width="8" height="8"></canvas><pre id="result"></pre>');
 report.result=await page.evaluate(async()=>{
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});if(!gl)throw Error('native WebGL2 unavailable');
  const ext=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),events=[];
  const program=gl.createProgram(),shaderSources=[['VERTEX_SHADER','#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}'],['FRAGMENT_SHADER','#version 300 es\nprecision highp float;out vec4 o;void main(){o=vec4(1.,.5,.25,1.);}']];
  const shaders=shaderSources.map(([type,source])=>{const s=gl.createShader(gl[type]);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(program,s);return s;});gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const fbo=gl.createFramebuffer(),color=gl.createTexture(),stencil=gl.createRenderbuffer(),vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,color);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,8,8);gl.bindRenderbuffer(gl.RENDERBUFFER,stencil);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH24_STENCIL8,8,8);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.viewport(0,0,8,8);
  const fence=async()=>{const s=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!s)throw Error('native fence allocation');gl.flush();let status;for(let i=0;i<1000;i++){await new Promise(r=>setTimeout(r,i%3));status=gl.clientWaitSync(s,0,0);events.push({op:'wait',turn:i,status});if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED){gl.deleteSync(s);return status;}if(status!==gl.TIMEOUT_EXPIRED)throw Error('native fence failure');}gl.deleteSync(s);throw Error('native fence timeout');};
  const cases=[['common',true,true,13,255,255,0],['different-ref',true,true,29,255,255,1282],['different-value-mask',true,true,13,7,255,1282],['different-write-mask',true,true,13,255,85,1282],['disabled-asymmetric',true,false,29,7,85,0],['absent-S8-asymmetric',false,true,29,7,85,0]];const rows=[];
  for(const [name,attached,enabled,backRef,backValue,backWrite,expected]of cases){
   gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,attached?stencil:null);const complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER);if(complete!==gl.FRAMEBUFFER_COMPLETE)throw Error('precheck FBO incomplete');
   gl.disable(gl.STENCIL_TEST);gl.stencilMask(255);gl.clearStencil(17);gl.clear(gl.STENCIL_BUFFER_BIT);gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,0,0,0]));
   gl.stencilFuncSeparate(gl.FRONT,gl.ALWAYS,13,255);gl.stencilFuncSeparate(gl.BACK,gl.ALWAYS,backRef,backValue);gl.stencilMaskSeparate(gl.FRONT,255);gl.stencilMaskSeparate(gl.BACK,backWrite);gl.stencilOpSeparate(gl.FRONT_AND_BACK,gl.KEEP,gl.KEEP,gl.REPLACE);gl[enabled?'enable':'disable'](gl.STENCIL_TEST);const before=gl.getError();if(before)throw Error('precheck setup '+before);
   gl.drawArrays(gl.TRIANGLES,0,3);const observed=gl.getError(),completion=await fence(),pixels=new Uint8Array(256);gl.readPixels(0,0,8,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const readError=gl.getError();if(readError)throw Error('precheck read '+readError);
   rows.push({name,attached,enabled,front:{ref:13,valueMask:255,writeMask:255},back:{ref:backRef,valueMask:backValue,writeMask:backWrite},expected,observed,completion,pixels:[...pixels]});if(observed!==expected)throw Error('native restriction mismatch '+name+': '+observed);
  }
  gl.deleteVertexArray(vao);gl.deleteFramebuffer(fbo);gl.deleteTexture(color);gl.deleteRenderbuffer(stencil);gl.deleteProgram(program);for(const s of shaders)gl.deleteShader(s);
  const result={status:'passed',gpu,shaderSources,rows,events};document.querySelector('#result').textContent=JSON.stringify(rows.map(({name,expected,observed})=>({name,expected,observed})),null,2);return result;
 });await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.status='passed';
}catch(e){report.status='failed';report.error={message:e.message,stack:e.stack};throw e;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:report.status,gpu:report.result.gpu,cases:report.result.rows.map(r=>({name:r.name,expected:r.expected,observed:r.observed}))}));
