// Promoted independent TEMP-alias/layout ownership and physical varying regression.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>i%2?null:[v.replace(/^--/,''),a[i+1]]).filter(Boolean));
assert.ok(options.output&&options.authority);
const output=path.resolve(options.output),authority=path.resolve(options.authority),sha=b=>createHash('sha256').update(b).digest('hex');
const seeds=options.seeds?.split(',').map(Number)??[1779033703,3144134277,1013904242];
assert.ok(seeds.length&&new Set(seeds).size===seeds.length&&seeds.every(s=>Number.isInteger(s)&&s>=0&&s<=0xffffffff));
await fs.mkdir(output,{recursive:true});
const sources=new Map();
for(const name of ['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm']){
 const file=name.includes('/build/wasm/')?path.join(authority,'generated',path.basename(name)):path.join(authority,'sources',name);
 const body=await fs.readFile(file);if(!name.includes('/build/wasm/'))assert.deepEqual(body,await fs.readFile(path.join(repo,name)));sources.set('/'+name,body);
}
const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Original stream-output TEMP alias critic</title><style>body{background:#101620;color:#eee;font:16px system-ui;margin:32px}pre{white-space:pre-wrap}</style><h1>Original stream-output TEMP alias and layout custody</h1><p>Selected compiler proof; production acceleration remains disabled.</p><canvas id="gpu" width="4" height="4"></canvas><pre id="result">Running original typed capture…</pre>');
let server,browser,page,profiler;
const served=new Set(),errors=[];
const report={schema:'stream-output-shader-independent-alias-browser-v1',task:'E6-T11d65',status:'running',
 command:[process.execPath,...process.argv.slice(1)],submission:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
 trackedChanges:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}),
 authority,seeds,fault:options.fault==='true',actualGuest:false,productionAuthority:false,startedAt:new Date().toISOString()};
try{
 server=createServer((request,response)=>{const name=new URL(request.url,'http://local').pathname;if(name==='/favicon.ico'){response.writeHead(204).end();return;}const body=name==='/'?html:sources.get(name);if(!body){response.writeHead(404).end();return;}served.add(name);response.writeHead(200,{'Content-Type':name==='/'?'text/html':name.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(body);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});
 const session=await browser.newBrowserCDPSession();report.hardware=await session.send('SystemInfo.getInfo');report.browserCommand=await session.send('Browser.getBrowserCommandLine');
 assert.equal(report.hardware.gpu.featureStatus.webgl2??report.hardware.gpu.featureStatus.webgl,'enabled');
 assert.ok(!/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/i.test(JSON.stringify(report.browserCommand)));
 report.browserVersion=browser.version();report.headless=false;
 page=await browser.newPage({viewport:{width:1100,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>errors.push(r.failure()?.errorText));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
 report.result=await page.evaluate(async({seeds,fault})=>{
  const {createVirglStandardStreamOutputShaderBridge}=await import('/renderer/virgl-shader/standard.mjs');
  let runtime;const bridge=await createVirglStandardStreamOutputShaderBridge({onRuntimeInitialized(){runtime=this;}});
  const originalMalloc=runtime._malloc,originalFree=runtime._free,live=new Map(),allocations=[];
  runtime._malloc=size=>{const pointer=originalMalloc(size);allocations.push({method:'malloc',pointer,size});if(pointer)live.set(pointer,size);return pointer;};
  runtime._free=pointer=>{allocations.push({method:'free',pointer});if(pointer&&!live.delete(pointer))throw Error('unowned JS arena free');return originalFree(pointer);};
  const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});if(!native)throw Error('Hardware WebGL2 missing');
  const debug=native.getExtension('WEBGL_debug_renderer_info'),renderer=debug?native.getParameter(debug.UNMASKED_RENDERER_WEBGL):native.getParameter(native.RENDERER);
  if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(renderer))throw Error('Software renderer');
  const nativeCalls=[],rows=[],ids=new WeakMap();let nextId=1,active=null;
  const encode=x=>{if(ArrayBuffer.isView(x))return {type:x.constructor.name,bytes:[...new Uint8Array(x.buffer,x.byteOffset,x.byteLength)]};if(Array.isArray(x))return x.map(encode);if(x&&typeof x==='object'){if(!ids.has(x))ids.set(x,nextId++);return {object:ids.get(x),type:x.constructor.name};}return x===undefined?{undefined:true}:x;};
  const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{const delivered=args.slice(),event={sequence:nativeCalls.length,row:active,method:key,args:args.map(encode)};if(fault&&key==='transformFeedbackVaryings'){delivered[1]=[...args[1]].reverse();event.fault='valid-same-type-native-order-swap';}const result=value.apply(target,delivered);event.delivered=delivered.map(encode);event.result=encode(result);if(key==='getBufferSubData')event.after=delivered.map(encode);nativeCalls.push(event);return result;};}});
  const checked=()=>{if(gl.getError()!==gl.NO_ERROR)throw Error('native error');};
  const result={rows,nativeCalls,allocations,renderer,fixedMemoryBytes:runtime.HEAPU8.byteLength};window.__streamOutputAlias=result;
  const entries=[{registerIndex:31,startComponent:3,numComponents:1,outputBuffer:3,destinationOffset:63,stream:0},
   {registerIndex:31,startComponent:1,numComponents:2,outputBuffer:1,destinationOffset:17,stream:0},
   {registerIndex:31,startComponent:0,numComponents:3,outputBuffer:0,destinationOffset:5,stream:0},
   {registerIndex:31,startComponent:1,numComponents:3,outputBuffer:2,destinationOffset:29,stream:0},
   {registerIndex:31,startComponent:0,numComponents:1,outputBuffer:3,destinationOffset:7,stream:0}];
  const strides=[11,23,35,64],words=[entries.length,...strides,...entries.flatMap(e=>[(e.registerIndex|(e.startComponent<<8)|(e.numComponents<<10)|(e.outputBuffer<<13)|(e.destinationOffset<<16))>>>0,0])];
  const vertexText='VERT\nDCL CONST[0..1]\nDCL TEMP[0]\nDCL OUT[0], POSITION\nDCL OUT[31], GENERIC[0]\nIMM[0] INT32 {0,0,0,0}\n0: MOV OUT[0], CONST[0]\n1: MOV TEMP[0], IMM[0]\n2: MOV TEMP[0].xyz, CONST[1]\n3: MOV TEMP[0].yz, TEMP[0].wxyz\n4: MOV OUT[31], TEMP[0]\n5: END\n';
  const fragmentText='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.0,0.0,0.0,1.0}\n0: MOV OUT[0], IMM[0]\n1: END\n';
  const oldResults=[];
  for(const [schedule,seed]of (fault?seeds.slice(0,1):seeds).entries())for(const buffer of fault?[3]:[0,1,2,3]){
   active=rows.length;const source=[schedule===0?0x80000000:schedule===1?0x7fa12345:0xffffffff,schedule===0?(0x7fc00000|(seed&65535))>>>0:schedule===1?0:(0xabcdef00|(seed&255))>>>0,(0xdead0000|(seed&65535))>>>0,0xffffffff],original=[source[0],source[0],source[1],0],position=[0,0x80000000,0,0x3f800000];
   const caller=words.slice(),request={vertexText,fragmentText,signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:0,streamOutputWords:caller,captureBuffer:buffer};
   const response=bridge.translatePairStreamOutput(request);if(!response.ok)throw Error(JSON.stringify(response));
   const saved=JSON.stringify(response);caller.fill(0xffffffff);if(JSON.stringify(response)!==saved)throw Error('caller layout aliases compiler response');
   for(const previous of oldResults)if(JSON.stringify(previous.response)!==previous.saved)throw Error('later compiler call aliases earlier response');oldResults.push({response,saved});
   const varyings=[];let total=0;for(const [i,e]of entries.entries())if(e.outputBuffer===buffer){varyings.push({outputIndex:i,name:'wv_so_'+i,type:e.numComponents===1?'uint':'uvec'+e.numComponents,components:e.numComponents,packedOffset:total*4});total+=e.numComponents;}
   const wanted={encoding:'raw-32bit-words',captureBuffer:buffer,strides,outputs:entries,varyings,packedStrideBytes:total*4};
   if(JSON.stringify(response.vertex.metadata.streamOutput)!==JSON.stringify(wanted))throw Error('immutable full original layout mismatch');
   if(live.size||runtime.HEAPU8.byteLength!==16777216)throw Error('JS arena ownership or fixed memory diverged');
   const row={schedule,seed,buffer,originalWords:words.slice(),callerAfterMutation:caller.slice(),request:{...request,streamOutputWords:words.slice()},response,wanted,source,position,original,allocationsAfterCompile:allocations.length,liveAfterCompile:[...live],nativeStart:nativeCalls.length};rows.push(row);
   const program=gl.createProgram(),shaders=[];for(const[type,sourceText]of [[gl.VERTEX_SHADER,response.vertex.glsl],[gl.FRAGMENT_SHADER,response.fragment.glsl]]){const shader=gl.createShader(type);gl.shaderSource(shader,sourceText);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);shaders.push(shader);}
   gl.transformFeedbackVaryings(program,varyings.map(v=>v.name),gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
   gl.uniform4uiv(gl.getUniformLocation(program,'vsconst0[0]'),new Uint32Array([...position,...source]));gl.uniform2f(gl.getUniformLocation(program,'wv_point_size'),1,0);
   const system=gl.createBuffer(),systemBytes=new Uint8Array(656);new DataView(systemBytes.buffer).setFloat32(640,-1,true);gl.bindBuffer(gl.UNIFORM_BUFFER,system);gl.bufferData(gl.UNIFORM_BUFFER,systemBytes,gl.STATIC_DRAW);gl.uniformBlockBinding(program,gl.getUniformBlockIndex(program,'VirglBlock'),0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,system);
   const target=gl.createBuffer(),feedback=gl.createTransformFeedback(),vertices=5,size=total*4*vertices,initial=new Uint8Array(size+32).fill(0xa3);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,target);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,initial,gl.STREAM_READ);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,target,16,size);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,vertices);gl.endTransformFeedback();checked();
   gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();let waited;for(let i=0;i<1000;i++){await new Promise(r=>setTimeout(r,0));waited=gl.clientWaitSync(fence,0,0);if([gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(waited))break;if(waited===gl.WAIT_FAILED)throw Error('native fence failed');}if(![gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(waited))throw Error('native fence timed out');
   const actual=new Uint8Array(initial.length);gl.bindBuffer(gl.COPY_READ_BUFFER,target);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,actual);checked();
   const packed=entries.filter(e=>e.outputBuffer===buffer).flatMap(e=>original.slice(e.startComponent,e.startComponent+e.numComponents)),expected=initial.slice(),view=new DataView(expected.buffer);for(let vertex=0;vertex<vertices;vertex++)for(let i=0;i<packed.length;i++)view.setUint32(16+(vertex*packed.length+i)*4,packed[i],true);
   row.completedNativeReadback=true;row.expected=[...expected];row.actual=[...actual];row.fence=waited;row.vertices=vertices;row.nativeVaryings=Array.from({length:gl.getProgramParameter(program,gl.TRANSFORM_FEEDBACK_VARYINGS)},(_,i)=>{const v=gl.getTransformFeedbackVarying(program,i);return {name:v.name,type:v.type,size:v.size};});row.mismatches=[...actual].flatMap((value,offset)=>value===expected[offset]?[]:[{offset,expected:expected[offset],actual:value}]);
   gl.deleteSync(fence);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.COPY_READ_BUFFER,null);gl.deleteBuffer(target);gl.deleteBuffer(system);gl.deleteTransformFeedback(feedback);gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);checked();row.nativeEnd=nativeCalls.length;
   if(row.mismatches.length)throw Error('complete original alias word oracle failed after native readback');row.status='passed';
  }
  result.status='passed';result.ownerBalance=[...live];document.querySelector('#result').textContent=rows.length+' complete original alias captures passed on '+renderer;return result;
 },{seeds,fault:options.fault==='true'});
 assert.deepEqual(errors,[]);report.status='passed';console.log(JSON.stringify({status:'passed',runs:report.result.rows.length,renderer:report.result.renderer}));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};if(page)report.partial=await page.evaluate(()=>window.__streamOutputAlias??null).catch(()=>null);process.exitCode=1;console.error(error.stack);}
finally{
 if(profiler){const coverage=await profiler.send('Profiler.takePreciseCoverage');const scripts=[];for(const [name,body]of sources){const entry=coverage.result.find(r=>r.url.endsWith(name));if(entry)scripts.push({source:name.slice(1),sha256:sha(body),sourceBody:body.toString(),coverage:entry});}const bytes=Buffer.from(JSON.stringify({schema:1,scripts},null,2)+'\n');await fs.writeFile(path.join(output,'browser-coverage.json'),bytes);report.browserCoverage={path:'browser-coverage.json',sha256:sha(bytes)};await profiler.send('Profiler.stopPreciseCoverage');}
 if(page){await page.screenshot({path:path.join(output,'browser.png')});report.screenshotSha256=sha(await fs.readFile(path.join(output,'browser.png')));}
 report.errors=errors;report.sources=[];for(const[name,body]of sources){const destination=path.join(output,'source',name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,body);report.sources.push({path:name.slice(1),bytes:body.length,sha256:sha(body)});}report.served=[...served];await fs.writeFile(path.join(output,'served-root.html'),html);await fs.writeFile(path.join(output,'recorder.mjs'),await fs.readFile(new URL(import.meta.url)));report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
}
