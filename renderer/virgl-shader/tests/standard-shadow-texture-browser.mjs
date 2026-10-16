import {createVirglStandardShadowTextureShaderBridge} from '../standard.mjs';
import {createProgram,digest} from './browser.mjs';
import {shadowFixtures,inputBytes,expectedWords,originalSamplerWords,originalViewWords} from '../../../tools/virgl-shadow-shaders/fixtures.mjs';
const need=(value,message)=>{if(!value)throw Error(message);};
const same=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
function encoded(bytes){let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);}
function captureGL(native,report){
 const handles=new WeakMap(),methods=new Map(),bodies=[];let next=1;
 const encode=value=>{
  if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength),key='native-bytes-'+bodies.length;bodies.push({key,kind:'complete-native-call-bytes',bytes:bytes.slice()});return {key,type:value.constructor.name,byteLength:bytes.byteLength};}
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==='object'){if(!handles.has(value))handles.set(value,next++);return {handle:handles.get(value),type:value.constructor.name};}
  return value===undefined?{undefined:true}:value;
 };
 const gl=new Proxy(native,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;if(!methods.has(name))methods.set(name,(...args)=>{
  const event={id:report.events.length,method:name,args:args.map(encode)};report.events.push(event);
  try{const result=value.apply(target,args);event.result=encode(result);if(['readPixels','getBufferSubData'].includes(name))event.after=args.map(encode);return result;}catch(error){event.error=String(error);throw error;}
 });return methods.get(name);}});
 return {gl,bodies};
}
async function saveBodies(report,bodies){
 for(const body of bodies){const bytes=body.bytes,zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());report.blobs.push({key:body.key,kind:body.kind,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(zipped),gzipBase64:encoded(zipped)});}
}
function compileOnly(gl,stage,source,expect=true){
 const shader=gl.createShader(stage==='vertex'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);need(shader,'native compiler shader');
 try{gl.shaderSource(shader,source);gl.compileShader(shader);const log=gl.getShaderInfoLog(shader),okay=gl.getShaderParameter(shader,gl.COMPILE_STATUS);need(okay===expect,'native shadow compile '+log);return {okay,log};}
 finally{gl.deleteShader(shader);}
}
async function complete(gl,frame,report){
 const writer=report.events.filter(e=>/^draw(?:Arrays|Elements)(?:Instanced)?$/.test(e.method)).at(-1);need(writer,'actual preceding native writer');
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(sync,'native completion object');const created=report.events.at(-1),start=performance.now();gl.flush();let status,waits=0;
 do{status=gl.clientWaitSync(sync,0,0);waits++;need(performance.now()-start<20000,'native fence deadline');if(status===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));}while(status===gl.TIMEOUT_EXPIRED);
 need(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,'native fence consumed');const consumed=report.events.at(-1);gl.deleteSync(sync);
 frame.gpuComplete={fenced:true,status,waits,writerEvent:writer.id,createdEvent:created.id,consumedEvent:consumed.id,handle:created.result.handle};
}
function upload(gl,target,bytes,buffers){
 const buffer=gl.createBuffer();need(buffer,'native buffer');buffers.push(buffer);gl.bindBuffer(target,buffer);gl.bufferData(target,bytes,gl.STATIC_DRAW);const copied=new Uint8Array(bytes.length);gl.getBufferSubData(target,0,copied);same([...copied],[...bytes],'whole original native buffer');return buffer;
}
function controls(gl,program,pair,f,frame){
 frame.uniforms=[];
 for(const [stage,body]of [['vertex',pair.vertex],['fragment',pair.fragment]]){
  for(const record of [...body.metadata.samplers,...body.metadata.shadowUniforms,...body.metadata.textureQueries,...body.metadata.instanceUniforms]){
   const location=gl.getUniformLocation(program,record.name),index=gl.getUniformIndices(program,[record.name])[0];
   need(location!==null&&index!==gl.INVALID_INDEX,'actual owned native uniform '+record.name);
   const type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],size=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0],initial=gl.getUniform(program,location);
   const expected=record.type==='sampler2DShadow'?gl.SAMPLER_2D_SHADOW:record.type==='vec4'?gl.FLOAT_VEC4:record.type==='uint'?gl.UNSIGNED_INT:gl.INT;
   need(type===expected&&size===1,'exact native uniform type/size '+record.name);
   const value=record.type==='sampler2DShadow'?8:record.type==='int'?3:record.type==='uint'?f.base:f.swizzle.map(lane=>record.semantic==='SHADOW_MASK'?Number(lane<4):Number(lane===5));
   if(record.type==='vec4'){same([...initial],[0,0,0,0],'native zero control');gl.uniform4fv(location,new Float32Array(value));}
   else{need(initial===0,'native default sampler/query');if(record.type==='uint')gl.uniform1ui(location,value);else gl.uniform1i(location,value);}
   const actual=gl.getUniform(program,location);same(record.type==='vec4'?[...actual]:actual,value,'native bound original view/query control');
   frame.uniforms.push({stage,...record,index,type,size,initial:record.type==='vec4'?[...initial]:initial,value,actual:record.type==='vec4'?[...actual]:actual});
  }
 }
}
function bindBlock(gl,program,buffers,frame){
 const index=gl.getUniformBlockIndex(program,'VirglBlock');need(index!==gl.INVALID_INDEX,'original VirglBlock');
 const size=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE),member=gl.getUniformIndices(program,['winsys_adjust_y'])[0];
 const offset=gl.getActiveUniforms(program,[member],gl.UNIFORM_OFFSET)[0],type=gl.getActiveUniforms(program,[member],gl.UNIFORM_TYPE)[0];
 need(size===656&&offset===640&&type===gl.FLOAT,'unchanged original coordinate block');
 const bytes=new Uint8Array(656);new DataView(bytes.buffer).setFloat32(640,1,true);upload(gl,gl.UNIFORM_BUFFER,bytes,buffers);gl.uniformBlockBinding(program,index,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,buffers.at(-1));
 frame.block={index,size,offset,type};
 const point=gl.getUniformLocation(program,'wv_point_size');need(point!==null,'native point size');gl.uniform2f(point,1,0);
}
async function read(gl,frame,report,f){
 await complete(gl,frame,report);
 const pixels=new Uint32Array(frame.width*frame.height*4);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,frame.width,frame.height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,pixels);
 need(gl.getError()===gl.NO_ERROR,'whole raw native output');
 const event=report.events.findLast(e=>e.method==='readPixels');frame.output={readEvent:event.id,bytesKey:event.after.at(-1).key};
 const misses=[];let checkedWords=0;
 for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
  const expected=expectedWords(f,x,y);
  for(let lane=0;lane<4;lane++){checkedWords++;const actual=pixels[(y*frame.width+x)*4+lane];if(actual!==expected[lane]&&misses.length<16)misses.push({x,y,lane,expected:expected[lane],actual});}
 }
 frame.audit={held:misses.length===0,checkedWords,misses};need(frame.audit.held,'original shadow/view words after completion: '+JSON.stringify(misses));
}
async function draw(gl,bridge,f,lookup,report,bodyRecords,fault){
 const pair=bridge.translatePairImages({vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors}),row=lookup.get(JSON.stringify([f.vertexText,f.fragmentText,f.selectors]));
 need(pair.ok&&row,'original selected shadow pair');same(pair,row.result,'complete actual native/Wasm/browser pair');
 const bytes=inputBytes(f),built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer(),sampler=gl.createSampler();
 need(vao&&fb&&sampler,'actual native shadow objects');
 const frame={...f,width:bytes.width,height:bytes.height,nativeIndex:row.index,pair,logs:built.logs,firstEvent:report.events.length,originalSamplerWords:originalSamplerWords(f),originalViewWords:originalViewWords(f),depthFormat:18};
 report.frames.push(frame);
 for(const [name,data]of Object.entries(bytes))if(data instanceof Uint8Array){const key='original-'+report.frames.length+'-'+name;bodyRecords.push({key,kind:'original-host-probe-input',bytes:data.slice()});(frame.originalInputs??={})[name]=key;}
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);bindBlock(gl,program,buffers,frame);controls(gl,program,pair,f,frame);
  frame.attributes=[];
  for(const [index,data]of [[0,bytes.positions],[1,bytes.coordinates],[2,bytes.dx],[3,bytes.dy],...(f.ids?[[4,bytes.offsets]]:[])]){
   const location=gl.getAttribLocation(program,'in_'+index);frame.attributes.push({index,location});
   if(location<0)continue;upload(gl,gl.ARRAY_BUFFER,data,buffers);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,f.packed&&index===1?gl.UNSIGNED_INT_2_10_10_10_REV:gl.FLOAT,false,0,0);gl.vertexAttribDivisor(location,index===4?1:0);
  }
  const depth=gl.createTexture();need(depth,'actual depth texture');textures.push(depth);gl.activeTexture(gl.TEXTURE0+8);gl.bindTexture(gl.TEXTURE_2D,depth);
  gl.texStorage2D(gl.TEXTURE_2D,3,gl.DEPTH_COMPONENT32F,4,2);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,2);
  frame.levels=[];
  for(const level of bytes.levels){gl.texSubImage2D(gl.TEXTURE_2D,level.level,0,0,level.width,level.height,gl.DEPTH_COMPONENT,gl.FLOAT,new Float32Array(level.bytes.buffer));const event=report.events.at(-1);frame.levels.push({level:level.level,width:level.width,height:level.height,inputKey:event.args.at(-1).key,event:event.id});}
  const parameters=[[gl.TEXTURE_MIN_FILTER,f.filter==='linear'?gl.LINEAR_MIPMAP_NEAREST:gl.NEAREST_MIPMAP_NEAREST],[gl.TEXTURE_MAG_FILTER,f.filter==='linear'?gl.LINEAR:gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE],[gl.TEXTURE_COMPARE_FUNC,gl.NEVER+f.compareFunction]];
  frame.samplerParameters=[];
  for(const [name,value]of parameters){gl.samplerParameteri(sampler,name,value);const actual=gl.getSamplerParameter(sampler,name);need(actual===value,'real original comparison sampler state');frame.samplerParameters.push({name,value,actual});}
  gl.samplerParameterf(sampler,gl.TEXTURE_MIN_LOD,0);gl.samplerParameterf(sampler,gl.TEXTURE_MAX_LOD,2);gl.bindSampler(8,sampler);
  const output=gl.createTexture();need(output,'actual raw color texture');textures.push(output);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,bytes.width,bytes.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'actual whole raw framebuffer');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(cap);gl.viewport(0,0,bytes.width,bytes.height);gl.colorMask(true,true,true,true);gl.clearBufferuiv(gl.COLOR,0,new Uint32Array([123,123,123,123]));
  if(f.ids)gl.drawArraysInstanced(gl.POINTS,0,9,3);else gl.drawArrays(f.biasProbe?gl.TRIANGLES:gl.POINTS,0,f.biasProbe?6:9);
  need(gl.getError()===gl.NO_ERROR,'real original shadow writer');await read(gl,frame,report,f);
  if(fault){
   const bad={...frame,name:f.name+'/completed-wrong-mask',fault,firstEvent:report.events.length};delete bad.gpuComplete;delete bad.output;delete bad.audit;report.frames.push(bad);
   const prefix=f.stage==='vertex'?'vs':'fs',location=gl.getUniformLocation(program,prefix+'shadmask'+f.slot),value=f.swizzle.map(lane=>Number(lane<4));value[0]=0;
   gl.uniform4fv(location,new Float32Array(value));bad.corruption={name:prefix+'shadmask'+f.slot,value,actual:[...gl.getUniform(program,location)]};
   gl.drawArrays(gl.POINTS,0,bytes.width*bytes.height);need(gl.getError()===gl.NO_ERROR,'completed valid wrong-mask draw');await read(gl,bad,report,f);
  }
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindSampler(8,null);gl.activeTexture(gl.TEXTURE0+8);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
  for(const b of buffers)gl.deleteBuffer(b);for(const t of textures)gl.deleteTexture(t);gl.deleteSampler(sampler);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(program);
  frame.cleaned=buffers.every(h=>!gl.isBuffer(h))&&textures.every(h=>!gl.isTexture(h))&&!gl.isSampler(sampler)&&!gl.isFramebuffer(fb)&&!gl.isVertexArray(vao)&&!gl.isProgram(program);need(frame.cleaned,'all original native objects retired');
  frame.lastEvent=report.events.length-1;if(fault&&report.frames.at(-1)!==frame){report.frames.at(-1).cleaned=frame.cleaned;report.frames.at(-1).lastEvent=frame.lastEvent;}
 }
}
export async function runAcceptance(options){
 const report={schema:'original-shadow-texture-native-v1',status:'running',guestExecution:false,productionNegotiation:false,frames:[],compiles:[],typeControls:[],events:[],blobs:[]};window.__shadowTextureReport=report;let bodies=[];
 try{
  const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;document.querySelector('#draws').append(canvas);const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(native instanceof WebGL2RenderingContext,'actual WebGL2');
  const capture=captureGL(native,report),gl=capture.gl;bodies=capture.bodies;const info=gl.getExtension('WEBGL_debug_renderer_info');report.gl={renderer:gl.getParameter(info.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.gl.renderer),'actual headed M4 Max Metal');
  const cases=(await(await fetch(options.matrixPath)).json()).cases,rows=(await(await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);need(cases.length===rows.length,'full original native compiler matrix');const lookup=new Map();
  for(const [i,c]of cases.entries())if(c.kind===31&&rows[i].result.ok)lookup.set(JSON.stringify([c.a,c.b,c.selectors]),{index:i,result:rows[i].result});
  if(!options.fault)for(const [i,row]of rows.entries())if(cases[i].kind>=29&&row.result.ok){const paired=!!row.result.vertex,stages=paired?[['vertex',row.result.vertex],['fragment',row.result.fragment]]:[[cases[i].kind===29?'vertex':'fragment',row.result]];for(const [stage,body]of stages)report.compiles.push({case:i,name:cases[i].name,stage,source:body.glsl,metadata:body.metadata,...compileOnly(gl,stage,body.glsl)});}
  const bridge=await createVirglStandardShadowTextureShaderBridge();let fixtures=shadowFixtures();
  if(options.fault)fixtures=fixtures.filter(f=>f.name==='vertex/TEX/slot7/nearest/swizzle3450/fn2');
  if(!options.fault){
   const pair=bridge.translatePairImages({vertexText:fixtures[0].vertexText,fragmentText:fixtures[0].fragmentText,...fixtures[0].selectors}),source=pair.vertex.glsl,mutated=source.replace('uniform highp sampler2DShadow','uniform highp sampler2D');need(mutated!==source,'native shadow type negative');
   report.typeControls.push({source,mutated,...compileOnly(gl,'vertex',mutated,false)});
  }
  need(fixtures.length>0,'nonempty original physical proof');
  for(const f of fixtures)await draw(gl,bridge,f,lookup,report,bodies,options.fault??null);
  need(gl.getError()===gl.NO_ERROR,'zero final GL errors');report.status='passed';document.querySelector('#status').textContent=fixtures.length+' original shadow/view raw planes passed';
 }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Original shadow proof failed';}
 await saveBodies(report,bodies);return report;
}
