import {createVirglStandardInstanceBaseShaderBridge} from '../standard.mjs';
import {createProgram,digest} from './browser.mjs';
import {instanceFixtures,inputBytes,expectedWords,constantWords,dimensionalWords,imageWords} from '../../../tools/virgl-instance-base/fixtures.mjs';
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
 try{gl.shaderSource(shader,source);gl.compileShader(shader);const log=gl.getShaderInfoLog(shader),okay=gl.getShaderParameter(shader,gl.COMPILE_STATUS);need(okay===expect,'native INSTANCEID compile '+log);return {okay,log};}
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
function bindBlocks(gl,program,pair,f,buffers,frame){
 frame.blocks=[];let binding=0;
 for(const block of [...pair.vertex.metadata.uniformBlocks,...pair.vertex.metadata.guestUniformBlocks]){
  const index=gl.getUniformBlockIndex(program,block.name);need(index!==gl.INVALID_INDEX,'active original block '+block.name);const bytes=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE);need(bytes===block.byteLength,'original block native length');
  const data=new Uint8Array(bytes),words=new Uint32Array(data.buffer),members=[];
  if(block.name==='VirglBlock'){
   need(bytes===656,'private VirglBlock remains 656');const member=block.members[0],at=gl.getUniformIndices(program,[member.name])[0],offset=gl.getActiveUniforms(program,[at],gl.UNIFORM_OFFSET)[0],type=gl.getActiveUniforms(program,[at],gl.UNIFORM_TYPE)[0];need(offset===640&&type===gl.FLOAT,'unchanged coordinate member');new DataView(data.buffer).setFloat32(640,1,true);members.push({name:member.name,offset,type,value:1});
  }else{
   const member=block.members[0],at=gl.getUniformIndices(program,[member.name+'[0]'])[0],offset=gl.getActiveUniforms(program,[at],gl.UNIFORM_OFFSET)[0],stride=gl.getActiveUniforms(program,[at],gl.UNIFORM_ARRAY_STRIDE)[0],type=gl.getActiveUniforms(program,[at],gl.UNIFORM_TYPE)[0];need(offset===0&&stride===16&&type===gl.UNSIGNED_INT_VEC4,'original raw constant layout');words.set(block.slot===0?constantWords:dimensionalWords,block.slot===0?0:8);members.push({name:member.name,offset,stride,type,slot:block.slot});
  }
  upload(gl,gl.UNIFORM_BUFFER,data,buffers);gl.uniformBlockBinding(program,index,binding);gl.bindBufferBase(gl.UNIFORM_BUFFER,binding,buffers.at(-1));frame.blocks.push({name:block.name,index,bytes,binding:binding++,members});
 }
 for(const uniform of pair.vertex.metadata.uniforms){const location=gl.getUniformLocation(program,uniform.name+'[0]');need(location!==null,'original slot0 uniform');const index=gl.getUniformIndices(program,[uniform.name+'[0]'])[0];need(gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]===gl.UNSIGNED_INT_VEC4,'original slot0 raw type');gl.uniform4uiv(location,new Uint32Array(constantWords));}
 need(gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS)===binding,'all native blocks separately described');
}
async function draw(gl,bridge,f,lookup,report,fault){
 const pair=bridge.translatePairImages({vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors});need(pair.ok,'original selected pair');const row=lookup.get(JSON.stringify([f.vertexText,f.fragmentText,f.selectors]));need(row,'frozen original native pair');same(pair,row.result,'whole native/Wasm/browser response');
 const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();need(vao&&fb,'native frame objects');
 const bytes=inputBytes(f),frame={...f,width:bytes.width,height:bytes.height,nativeIndex:row.index,pair,logs:built.logs,firstEvent:report.events.length,fault};report.frames.push(frame);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);bindBlocks(gl,program,pair,f,buffers,frame);
  const point=gl.getUniformLocation(program,'wv_point_size');need(point!==null,'native point size');gl.uniform2f(point,1,0);
  const offset=gl.getUniformLocation(program,'wv_instance_base'),active=offset!==null,index=active?gl.getUniformIndices(program,['wv_instance_base'])[0]:gl.INVALID_INDEX;
  frame.offset={active,default:active?gl.getUniform(program,offset):null,type:active?gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]:null,metadata:pair.vertex.metadata.instanceUniforms};
  const used=!['vertex1','absent','unused'].includes(f.variant);need(active===used,'actual instance uniform native liveness');
  if(active){need(frame.offset.default===0&&frame.offset.type===gl.UNSIGNED_INT&&gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0]===1,'uint offset initialization/reflection');const value=fault==='wrong-offset'?(f.base+1)>>>0:f.base;gl.uniform1ui(offset,value);frame.offset.actual=gl.getUniform(program,offset);need(frame.offset.actual===value,'actual uniform1ui');}
  frame.attributes=[];
  for(const [attribute,data,divisor]of [[0,bytes.positions,0],[1,bytes.offsets,1],...(bytes.attribute?[[2,bytes.attribute,0]]:[])]){
   upload(gl,gl.ARRAY_BUFFER,data,buffers);const location=gl.getAttribLocation(program,'in_'+attribute);need(location>=0,'native original input');gl.enableVertexAttribArray(location);
   let type=gl.FLOAT,integer=false;if(attribute===2){if(f.composition==='uint'||f.composition==='sint'){integer=true;type=f.composition==='uint'?gl.UNSIGNED_INT:gl.INT;}else type=gl.UNSIGNED_INT_2_10_10_10_REV;}
   if(integer)gl.vertexAttribIPointer(location,4,type,0,0);else gl.vertexAttribPointer(location,4,type,false,0,0);gl.vertexAttribDivisor(location,divisor);frame.attributes.push({attribute,location,type,integer,divisor,bufferHandle:report.events.findLast(e=>e.method==='createBuffer').result.handle});
  }
  if(f.composition!=='none'){
   const image=gl.createTexture();textures.push(image);gl.activeTexture(gl.TEXTURE0+19);gl.bindTexture(gl.TEXTURE_2D,image);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,1,1);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,new Uint32Array(imageWords));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   const location=gl.getUniformLocation(program,'vssamp3'),index=gl.getUniformIndices(program,['vssamp3'])[0];need(location!==null&&gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]===gl.UNSIGNED_INT_SAMPLER_2D,'actual original UINT sampler');gl.uniform1i(location,19);
  }
  let type=null,offsetBytes=0;if(bytes.indices){upload(gl,gl.ELEMENT_ARRAY_BUFFER,bytes.indices,buffers);type=gl[{8:'UNSIGNED_BYTE',16:'UNSIGNED_SHORT',32:'UNSIGNED_INT'}[f.indexBits]];offsetBytes=f.indexPrefix*f.indexBits/8;}
  const output=gl.createTexture();textures.push(output);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,f.signedOutput?gl.RGBA32I:gl.RGBA32UI,bytes.width,bytes.height);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'raw output framebuffer');
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(capability);gl.viewport(0,0,bytes.width,bytes.height);gl.colorMask(true,true,true,true);
  if(f.signedOutput)gl.clearBufferiv(gl.COLOR,0,new Int32Array([-123,-123,-123,-123]));else gl.clearBufferuiv(gl.COLOR,0,new Uint32Array([123,123,123,123]));
  if(bytes.indices){if(f.ordinary)gl.drawElements(gl.POINTS,f.vertices.length,type,offsetBytes);else gl.drawElementsInstanced(gl.POINTS,f.vertices.length,type,offsetBytes,f.instances);}
  else if(f.ordinary)gl.drawArrays(gl.POINTS,f.vertices[0],f.vertices.length);else gl.drawArraysInstanced(gl.POINTS,f.vertices[0],f.vertices.length,f.instances);
  need(gl.getError()===gl.NO_ERROR,'actual original instanced draw');await complete(gl,frame,report);
  const pixels=f.signedOutput?new Int32Array(bytes.width*bytes.height*4):new Uint32Array(bytes.width*bytes.height*4);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,bytes.width,bytes.height,gl.RGBA_INTEGER,f.signedOutput?gl.INT:gl.UNSIGNED_INT,pixels);need(gl.getError()===gl.NO_ERROR,'complete native raw output');const readEvent=report.events.findLast(e=>e.method==='readPixels');frame.output={readEvent:readEvent.id,bytesKey:readEvent.after.at(-1).key,signed:!!f.signedOutput};
  const words=new Uint32Array(pixels.buffer),mismatches=[];let checkedWords=0;
  for(let y=0;y<bytes.height;y++)for(let x=0;x<bytes.width;x++){const expected=expectedWords(f,f.vertices[x],y);for(let lane=0;lane<4;lane++){const actual=words[(y*bytes.width+x)*4+lane];checkedWords++;if(actual!==expected[lane]&&mismatches.length<16)mismatches.push({x,y,lane,vertex:f.vertices[x],instance:y,expected:expected[lane],actual});}}
  frame.audit={held:mismatches.length===0,checkedWords,mismatches};need(frame.audit.held,'original instance/vertex words after native fence: '+JSON.stringify(mismatches));
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);for(let i=0;i<3;i++)gl.bindBufferBase(gl.UNIFORM_BUFFER,i,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.activeTexture(gl.TEXTURE0+19);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
  for(const buffer of buffers)gl.deleteBuffer(buffer);for(const texture of textures)gl.deleteTexture(texture);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(program);frame.cleaned=buffers.every(h=>!gl.isBuffer(h))&&textures.every(h=>!gl.isTexture(h))&&!gl.isFramebuffer(fb)&&!gl.isVertexArray(vao)&&!gl.isProgram(program);need(frame.cleaned,'native handles retired');frame.lastEvent=report.events.length-1;
 }
}
export async function runAcceptance(options){
 const report={schema:'original-instance-base-native-v1',status:'running',guestExecution:false,productionNegotiation:false,frames:[],compiles:[],typeControls:[],events:[],blobs:[]};window.__instanceBaseReport=report;let bodies=[];
 try{
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=4;document.querySelector('#draws').append(canvas);const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(native instanceof WebGL2RenderingContext,'actual WebGL2');const capture=captureGL(native,report),gl=capture.gl;bodies=capture.bodies;
  const info=gl.getExtension('WEBGL_debug_renderer_info');report.gl={renderer:gl.getParameter(info.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.gl.renderer),'actual M4 Max Metal');
  const cases=(await(await fetch(options.matrixPath)).json()).cases,rows=(await(await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);need(cases.length===rows.length,'complete original native matrix');const lookup=new Map();
  for(const [i,c]of cases.entries())if(c.kind===24&&rows[i].result.ok)lookup.set(JSON.stringify([c.a,c.b,c.selectors]),{index:i,result:rows[i].result});
  if(!options.fault)for(const [i,row]of rows.entries())if(cases[i].kind>=22&&row.result.ok){const paired=!!row.result.vertex,bodies=paired?[['vertex',row.result.vertex],['fragment',row.result.fragment]]:[[cases[i].kind===22?'vertex':'fragment',row.result]];for(const [stage,body]of bodies)report.compiles.push({case:i,name:cases[i].name,stage,source:body.glsl,metadata:body.metadata,...compileOnly(gl,stage,body.glsl)});}
  const bridge=await createVirglStandardInstanceBaseShaderBridge();let fixtures=instanceFixtures();if(options.fault)fixtures=fixtures.filter(f=>f.name==='raw/base17/index16');
  if(!options.fault){const f=fixtures[0],pair=bridge.translatePairImages({vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors}),wrong=pair.vertex.glsl.replace('uniform highp uint wv_instance_base;','uniform highp vec4 wv_instance_base;');need(wrong!==pair.vertex.glsl,'actual offset type mutation');report.typeControls.push({kind:'wrong-uniform-native-type',original:pair.vertex.glsl,mutated:wrong,...compileOnly(gl,'vertex',wrong,false)});need(gl.getError()===gl.NO_ERROR,'type refusal has no GL error');}
  for(const f of fixtures)await draw(gl,bridge,f,lookup,report,options.fault??null);need(gl.getError()===gl.NO_ERROR,'zero final native errors');report.status='passed';document.querySelector('#status').textContent=fixtures.length+' original instance/vertex raw planes passed';
 }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Instance offset proof failed';}
 await saveBodies(report,bodies);return report;
}
