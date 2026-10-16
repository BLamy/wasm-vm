import {createVirglStandardInstanceBaseShaderBridge} from '../standard.mjs';
import {digest} from './browser.mjs';
import {fixtures,predicted} from '../../../tools/virgl-instance-base/critic_fixtures.mjs';
const need=(v,m)=>{if(!v)throw Error(m);};
const equal=(a,b,m)=>need(JSON.stringify(a)===JSON.stringify(b),m);
function capture(native,report){
 const handles=new WeakMap(),methods=new Map(),bytes=[];let next=1;
 const encode=v=>{
  if(ArrayBuffer.isView(v)){const raw=new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice(),key='call-'+bytes.length;bytes.push({key,raw});return {key,type:v.constructor.name,byteLength:raw.length};}
  if(Array.isArray(v))return v.map(encode);
  if(v&&typeof v==='object'){if(!handles.has(v))handles.set(v,next++);return {handle:handles.get(v),type:v.constructor.name};}
  return v===undefined?{undefined:true}:v;
 };
 const gl=new Proxy(native,{get(t,k){const fn=Reflect.get(t,k,t);if(typeof fn!=='function')return fn;if(!methods.has(k))methods.set(k,(...args)=>{const event={id:report.events.length,method:k,args:args.map(encode)};report.events.push(event);try{const r=fn.apply(t,args);event.result=encode(r);if(['readPixels','getBufferSubData'].includes(k))event.after=args.map(encode);return r;}catch(error){event.error=String(error);throw error;}});return methods.get(k);}});
 return {gl,bytes};
}
function program(gl,pair){
 const shaders=[];
 for(const [type,body]of [[gl.VERTEX_SHADER,pair.vertex],[gl.FRAGMENT_SHADER,pair.fragment]]){
  const s=gl.createShader(type);need(s,'real shader');shaders.push(s);gl.shaderSource(s,body.glsl);gl.compileShader(s);equal(gl.getShaderSource(s),body.glsl,'actual queried C-emitted source');need(gl.getShaderParameter(s,gl.COMPILE_STATUS),'real native compile '+gl.getShaderInfoLog(s));
 }
 const p=gl.createProgram();for(const s of shaders)gl.attachShader(p,s);gl.linkProgram(p);need(gl.getProgramParameter(p,gl.LINK_STATUS),'real native link '+gl.getProgramInfoLog(p));for(const s of shaders)gl.deleteShader(s);return p;
}
async function finish(gl,report,delay){
 const writer=report.events.findLast(e=>e.method==='drawElementsInstanced'||e.method==='drawArrays');need(writer,'original actual writer');
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0),created=report.events.at(-1);need(sync,'physical sync');gl.flush();let value,waits=0;const start=performance.now();
 do{value=gl.clientWaitSync(sync,0,0);waits++;need(performance.now()-start<20000,'bounded native completion');if(value===gl.TIMEOUT_EXPIRED)await new Promise(r=>setTimeout(r,delay));}while(value===gl.TIMEOUT_EXPIRED);
 need([gl.CONDITION_SATISFIED,gl.ALREADY_SIGNALED].includes(value),'physical native wait success');const consumed=report.events.at(-1);gl.deleteSync(sync);
 return {fenced:true,writerEvent:writer.id,createdEvent:created.id,consumedEvent:consumed.id,handle:created.result.handle,status:value,waits};
}
function upload(gl,target,raw,buffers){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,raw,gl.STATIC_DRAW);const check=new Uint8Array(raw.byteLength);gl.getBufferSubData(target,0,check);equal([...check],[...new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength)],'complete actual upload');return b;}
function input(f){
 const count=Math.max(...f.vertices)+1,positions=new Float32Array(count*4),offsets=new Float32Array(f.instances*4);
 for(const [x,v]of f.vertices.entries()){positions[v*4]=Math.fround(2*(x+.5)/f.vertices.length-1);positions[v*4+3]=1;}
 for(let i=0;i<f.instances;i++)offsets[i*4+1]=Math.fround(2*(i+.5)/f.instances-1);
 let indices=null;if(f.indexBits){indices=new globalThis['Uint'+f.indexBits+'Array'](f.vertices.length+f.indexPrefix);indices.set(f.vertices,f.indexPrefix);}
 return {positions,offsets,indices};
}
async function draw(gl,bridge,f,rows,report,fault){
 const nativeIndex=rows.findIndex(r=>JSON.stringify(r.request)===JSON.stringify({vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors}));need(nativeIndex>=0,'original native response exists');const row=rows[nativeIndex],pair=bridge.translatePairImages(row.request);equal(pair,row.result,'complete C/native/Wasm/browser compiler response');need(pair.ok,'original critic pair admitted');
 const p=program(gl,pair),vao=gl.createVertexArray(),fb=gl.createFramebuffer(),texture=gl.createTexture(),buffers=[],bytes=input(f);
 const frame={...f,pair,nativeIndex,firstEvent:report.events.length,width:f.vertices.length,height:f.instances,fault};report.frames.push(frame);
 try{
  gl.useProgram(p);gl.bindVertexArray(vao);
  const block=gl.getUniformBlockIndex(p,'VirglBlock');need(block!==gl.INVALID_INDEX,'original private block');need(gl.getActiveUniformBlockParameter(p,block,gl.UNIFORM_BLOCK_DATA_SIZE)===656,'original 656 byte block');const member=gl.getUniformIndices(p,['winsys_adjust_y'])[0];need(gl.getActiveUniforms(p,[member],gl.UNIFORM_OFFSET)[0]===640,'original offset640');const system=new Uint8Array(656);new DataView(system.buffer).setFloat32(640,1,true);const systemBuffer=upload(gl,gl.UNIFORM_BUFFER,system,buffers);gl.uniformBlockBinding(p,block,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,systemBuffer);
  const point=gl.getUniformLocation(p,'wv_point_size');need(point,'native point size');gl.uniform2f(point,1,0);
  const offset=gl.getUniformLocation(p,'wv_instance_base');need((offset!==null)===(f.variant==='used'),'actual unused/absent liveness');frame.offset={active:offset!==null};
  if(offset!==null){const index=gl.getUniformIndices(p,['wv_instance_base'])[0];need(gl.getActiveUniforms(p,[index],gl.UNIFORM_TYPE)[0]===gl.UNSIGNED_INT&&gl.getActiveUniforms(p,[index],gl.UNIFORM_SIZE)[0]===1,'actual uint scalar');frame.offset.default=gl.getUniform(p,offset);need(frame.offset.default===0,'native default zero');gl.uniform1ui(offset,f.base);need(gl.getUniform(p,offset)===f.base,'actual original base');}
  for(const [index,data,divisor]of [[0,bytes.positions,0],[1,bytes.offsets,1]]){upload(gl,gl.ARRAY_BUFFER,data,buffers);const at=gl.getAttribLocation(p,'in_'+index);need(at>=0,'actual original attribute');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(at,divisor);}
  let type=null,offsetBytes=0;if(bytes.indices){upload(gl,gl.ELEMENT_ARRAY_BUFFER,bytes.indices,buffers);type=gl[{8:'UNSIGNED_BYTE',16:'UNSIGNED_SHORT',32:'UNSIGNED_INT'}[f.indexBits]];offsetBytes=f.indexPrefix*f.indexBits/8;}
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,frame.width,frame.height);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'actual complete FBO');
  for(const c of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(c);gl.viewport(0,0,frame.width,frame.height);gl.colorMask(true,true,true,true);gl.clearBufferuiv(gl.COLOR,0,new Uint32Array([123,123,123,123]));
  const issue=()=>{if(bytes.indices)gl.drawElementsInstanced(gl.POINTS,f.vertices.length,type,offsetBytes,f.instances);else gl.drawArrays(gl.POINTS,f.vertices[0],f.vertices.length);need(gl.getError()===gl.NO_ERROR,'actual original draw');};
  const collect=()=>{const pixels=new Uint32Array(frame.width*frame.height*4);gl.readPixels(0,0,frame.width,frame.height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,pixels);const e=report.events.at(-1);need(gl.getError()===gl.NO_ERROR,'actual native raw output');return {pixels,record:{readEvent:e.id,bytesKey:e.after.at(-1).key}};};
  const check=pixels=>{const differences=[];for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){const expected=predicted(f,f.vertices[x],y);for(let lane=0;lane<4;lane++)if(pixels[(y*frame.width+x)*4+lane]!==expected[lane])differences.push({x,y,lane,expected:expected[lane],actual:pixels[(y*frame.width+x)*4+lane]});}return differences;};
  issue();frame.gpuComplete=await finish(gl,report,f.pollDelay);let result=collect();
  if(fault){need(offset!==null,'sabotage needs native active offset');need(check(result.pixels).length===0,'original positive before physical sabotage');frame.originalComplete=frame.gpuComplete;frame.originalOutput=result.record;frame.corruption={originalBase:f.base,actualBase:(f.base+17)>>>0};gl.uniform1ui(offset,frame.corruption.actualBase);issue();frame.gpuComplete=await finish(gl,report,f.pollDelay);need(frame.gpuComplete.handle!==frame.originalComplete.handle,'distinct physical second fence');result=collect();}
  frame.output=result.record;frame.differences=check(result.pixels);need(!frame.differences.length,'original critic modifier words after actual completion '+JSON.stringify(frame.differences));
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);for(const b of buffers)gl.deleteBuffer(b);gl.deleteTexture(texture);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(p);frame.lastEvent=report.events.length-1;
 }
}
export async function runAcceptance(options){
 const report={schema:'original-instance-base-fresh-critic-v1',status:'running',guestExecution:false,productionNegotiation:false,seed:options.seed,frames:[],events:[],blobs:[]};window.__instanceBaseCritic=report;let body=[];
 try{
  const canvas=document.createElement('canvas');document.querySelector('#draws').append(canvas);const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(native instanceof WebGL2RenderingContext,'actual WebGL2');const captured=capture(native,report);body=captured.bytes;const gl=captured.gl,info=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.renderer),'actual M4 Max Metal');
  const rows=await(await fetch(options.nativePath)).json(),bridge=await createVirglStandardInstanceBaseShaderBridge();let selected=fixtures(options.seed);if(options.fault)selected=selected.filter(f=>f.indexBits===8&&f.variant==='used');for(const f of selected)await draw(gl,bridge,f,rows,report,options.fault);report.status='passed';document.querySelector('#status').textContent=selected.length+' independent original modifier planes passed';
 }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Independent original modifier proof failed';}
 for(const {key,raw}of body){const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());let s='';for(let i=0;i<compressed.length;i+=32768)s+=String.fromCharCode(...compressed.subarray(i,i+32768));report.blobs.push({key,bytes:raw.length,sha256:await digest(raw),gzipSha256:await digest(compressed),gzipBase64:btoa(s)});}
 return report;
}
