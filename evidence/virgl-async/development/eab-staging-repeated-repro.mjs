import { chromium } from '/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/web/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
const page=await browser.newPage();
const messages=[];page.on('console',m=>messages.push({type:m.type(),text:m.text()}));
await page.setContent('<canvas id="gpu"></canvas>');
const result=await page.evaluate(async()=>{
 const variants=[];
 for(const kind of ['element']) for(const usage of ['DYNAMIC_COPY','STREAM_READ','DYNAMIC_DRAW','STREAM_READ','DYNAMIC_COPY','STREAM_READ','DYNAMIC_DRAW','STREAM_READ']) {
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
  const log=[],call=(name,...args)=>{const value=gl[name](...args);log.push({name,error:gl.getError()});return value;};
  const vao=call('createVertexArray');call('bindVertexArray',vao);
  const target=kind==='element'?gl.ELEMENT_ARRAY_BUFFER:gl.ARRAY_BUFFER;
  const source=call('createBuffer');call('bindBuffer',target,source);call('bufferData',target,new Uint16Array([0,1,2,2,1,3]),gl.DYNAMIC_DRAW);
  call('bindBuffer',target,null);call('bindVertexArray',null);
  const dest=call('createBuffer');call('bindVertexArray',vao);call('bindBuffer',target,dest);call('bufferData',target,12,gl[usage]);call('bindBuffer',target,null);call('bindVertexArray',null);
  call('bindBuffer',gl.COPY_READ_BUFFER,source);call('bindBuffer',gl.COPY_WRITE_BUFFER,dest);call('copyBufferSubData',gl.COPY_READ_BUFFER,gl.COPY_WRITE_BUFFER,0,0,12);
  const sync=call('fenceSync',gl.SYNC_GPU_COMMANDS_COMPLETE,0);call('flush');
  const waits=[];
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,4));const status=gl.clientWaitSync(sync,0,0);waits.push({status,error:gl.getError()});if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED||status===gl.WAIT_FAILED)break;}
  const output=new Uint16Array(6);call('bindBuffer',gl.COPY_READ_BUFFER,dest);call('getBufferSubData',gl.COPY_READ_BUFFER,0,output);
  variants.push({kind,usage,log,waits,output:[...output],lost:gl.isContextLost()});
  gl.deleteSync(sync);gl.deleteBuffer(source);gl.deleteBuffer(dest);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();
 }
 return variants;
});
const report={version:browser.version(),variants:result,messages};
await fs.writeFile('/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/target/evidence/virgl-eab-repeated-repro.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,variants:result.map(v=>({kind:v.kind,usage:v.usage,errors:v.log.filter(x=>x.error),waits:v.waits,output:v.output})),messages},null,2));await browser.close();
