import {createVirglStandardTextureShaderBridge} from '../standard.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';
import {textureOperationFixtures} from '../../../tools/virgl-standard-texture/hardware-fixtures.mjs';
const need=(value,message)=>{if(!value)throw Error(message);};
const equal=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
function encoded(bytes){let value='';for(let at=0;at<bytes.length;at+=32768)value+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(value);}
async function blob(report,bytes,kind){
 const zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 const item={key:'blob-'+report.blobs.length,kind,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(zipped),gzipBase64:encoded(zipped)};report.blobs.push(item);return item.key;
}
async function complete(gl,frame){
 const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(fence,'physical texture-operation fence');gl.flush();const start=performance.now();let status,waits=0;
 do{status=gl.clientWaitSync(fence,0,0);waits++;if(status===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));need(performance.now()-start<20000,'texture-operation completion deadline');}while(status===gl.TIMEOUT_EXPIRED);
 need(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,'native fence signaled on a later task');gl.deleteSync(fence);frame.gpuComplete={submitted:true,fenced:true,status,waits};
}
function compileOnly(gl,stage,body){
 const shader=gl.createShader(stage==='vertex'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);need(shader,'native matrix shader');
 try{gl.shaderSource(shader,body.glsl);gl.compileShader(shader);const log=gl.getShaderInfoLog(shader),okay=gl.getShaderParameter(shader,gl.COMPILE_STATUS);need(okay,'native texture matrix compile: '+log);return {okay,log};}finally{gl.deleteShader(shader);need(!gl.isShader(shader),'native matrix shader cleanup');}
}
async function draw(gl,bridge,f,cases,native,report,fault){
 const pair=bridge.translatePairUniforms({vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors});need(pair.ok,'complete original texture-operation pair '+f.name);
 const nativeIndex=cases.findIndex(c=>c.kind===2&&c.a===f.vertexText&&c.b===f.fragmentText&&Object.keys(f.selectors).every(k=>c.selectors[k]===f.selectors[k]));need(nativeIndex>=0,'frozen native original pair');equal(pair,native[nativeIndex].result,'complete browser/native pair');
 const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],textures=[],framebuffers=[],vao=gl.createVertexArray();need(vao,'native texture vertex array');
 const frame={name:f.name,stage:f.stage,opcode:f.opcode,slot:f.slot,range:f.range,kind:f.kind,linear:f.linear,width:f.width,height:f.height,levels:f.levels,resourceWidth:f.resourceWidth,resourceHeight:f.resourceHeight,firstLevel:f.firstLevel,lastLevel:f.lastLevel,frameWidth:f.frameWidth,frameHeight:f.frameHeight,lod:f.lod,coord:f.coord,dx:f.dx,dy:f.dy,fetch:f.fetch,queryMask:f.queryMask,selectors:f.selectors,vertexText:f.vertexText,fragmentText:f.fragmentText,nativeIndex,pair,logs:built.logs,planes:[],attributes:[],samplers:[],queries:[],calls:[],fault};report.frames.push(frame);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);frame.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  const point=gl.getUniformLocation(program,'wv_point_size');need(point!==null,'native point-size metadata');gl.uniform2f(point,1,0);
  for(const [index,data]of [[0,f.positions],...(f.stage==='fragment'?[[1,f.coordinates]]:[])]){
   const buffer=gl.createBuffer();need(buffer,'original native attribute buffer');buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);const location=gl.getAttribLocation(program,'in_'+index);need(location>=0,'native original attribute location');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
   const raw=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),stored=new Uint8Array(raw.length);gl.getBufferSubData(gl.ARRAY_BUFFER,0,stored);equal([...stored],[...raw],'complete original native attribute words');frame.attributes.push({index,location,original:await blob(report,raw,'original-attribute'),native:await blob(report,stored,'native-attribute'),type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER)});
  }
  const image=gl.createTexture();need(image,'native original 2D texture');textures.push(image);const unit=(f.stage==='vertex'?16:0)+f.slot;
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,image);
  const internal=f.kind==='snorm'?gl.RGBA8_SNORM:f.kind==='srgb'?gl.SRGB8_ALPHA8:gl.RGBA8,type=f.kind==='snorm'?gl.BYTE:gl.UNSIGNED_BYTE;
  gl.texStorage2D(gl.TEXTURE_2D,f.levels,internal,f.width,f.height);need(gl.getError()===gl.NO_ERROR,'native immutable texture storage');
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,f.levels-1);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,f.linear?gl.LINEAR_MIPMAP_NEAREST:gl.NEAREST_MIPMAP_NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,f.linear?gl.LINEAR:gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  for(const plane of f.planes){const input=f.kind==='snorm'?new Int8Array(plane.bytes.buffer,plane.bytes.byteOffset,plane.bytes.byteLength):plane.bytes;gl.texSubImage2D(gl.TEXTURE_2D,plane.level,0,0,plane.width,plane.height,gl.RGBA,type,input);need(gl.getError()===gl.NO_ERROR,'native original texture plane upload');frame.planes.push({level:plane.level,width:plane.width,height:plane.height,internal,type,arrayType:input.constructor.name,original:await blob(report,plane.bytes,'original-texture-plane')});}
  for(const [stage,body]of [[0,pair.vertex],[1,pair.fragment]]){
   for(const sampler of body.metadata.samplers){const location=gl.getUniformLocation(program,sampler.name),index=gl.getUniformIndices(program,[sampler.name])[0];if(location!==null){need(index!==gl.INVALID_INDEX&&gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]===gl.SAMPLER_2D&&gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0]===1,'native original sampler reflection');gl.uniform1i(location,unit);}frame.samplers.push({stage,index:sampler.index,name:sampler.name,active:location!==null,unit});}
   for(const query of body.metadata.textureQueries){const location=gl.getUniformLocation(program,query.name),index=gl.getUniformIndices(program,[query.name])[0];need(location!==null&&index!==gl.INVALID_INDEX&&gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]===gl.INT&&gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0]===1,'native view-level integer reflection');const actual=fault==='query-levels'&&f.opcode==='TXQ'?f.levels+1:f.levels;gl.uniform1i(location,actual);frame.queries.push({...query,stage,expected:f.levels,actual,readback:gl.getUniform(program,location),nativeType:gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]});}
  }
  // Full native plane capture is collected through physical framebuffer reads.
  const inspect=gl.createFramebuffer();need(inspect,'native texture plane inspector');framebuffers.push(inspect);gl.bindFramebuffer(gl.FRAMEBUFFER,inspect);
  for(const plane of frame.planes){gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,image,plane.level);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'physical texture plane complete');const pixels=f.kind==='snorm'?new Int8Array(plane.width*plane.height*4):new Uint8Array(plane.width*plane.height*4);gl.readPixels(0,0,plane.width,plane.height,gl.RGBA,type,pixels);need(gl.getError()===gl.NO_ERROR,'physical texture plane bytes');plane.native=await blob(report,new Uint8Array(pixels.buffer),'complete-native-texture-plane');plane.readType=type;}
  const target=gl.createTexture(),fb=gl.createFramebuffer();need(target&&fb,'physical original output');textures.push(target);framebuffers.push(fb);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,target);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,f.frameWidth,f.frameHeight);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'native highp output attachment');
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,image);
  if(fault==='lod-selection'&&f.opcode==='TXL'){gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,1);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,f.levels-1);frame.nativeFault={name:'TEXTURE_BASE_LEVEL',actual:1};}
  if(fault==='gradient-state'&&f.opcode==='TXD'){gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_LOD,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LOD,0);frame.nativeFault={name:'TEXTURE_MAX_LOD',actual:0};}
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(capability);
  gl.viewport(0,0,f.frameWidth,f.frameHeight);gl.colorMask(true,true,true,true);gl.clearColor(-9999,-9999,-9999,-9999);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);frame.calls.push({name:'drawArrays',mode:gl.TRIANGLES,first:0,count:6});await complete(gl,frame);
  const pixels=new Float32Array(f.frameWidth*f.frameHeight*4);gl.readPixels(0,0,f.frameWidth,f.frameHeight,gl.RGBA,gl.FLOAT,pixels);need(gl.getError()===gl.NO_ERROR,'completed original texture draw');frame.pixels=await blob(report,new Uint8Array(pixels.buffer),'complete-f32-texture-pixels');
  const mismatches=[];let checked=0;for(let y=0;y<f.frameHeight;y++)for(let x=0;x<f.frameWidth;x++){const expected=f.expected(x,y);for(let lane=0;lane<4;lane++){const actual=pixels[(y*f.frameWidth+x)*4+lane],tolerance=f.opcode==='TXQ'?0:f.kind==='srgb'?.005:f.linear?.0003:.00002;checked++;if(!Number.isFinite(actual)||Math.abs(actual-expected[lane])>tolerance)if(mismatches.length<12)mismatches.push({x,y,lane,expected:expected[lane],actual,tolerance});}}
  frame.audit={held:!mismatches.length,checkedWords:checked,mismatches};
  if(f.slot===3&&f.range==='full'&&f.kind==='unorm'&&!f.linear&&f.queryMask==='xyw'){
   const preview=document.createElement('canvas');preview.width=f.frameWidth;preview.height=f.frameHeight;const context=preview.getContext('2d'),image=context.createImageData(f.frameWidth,f.frameHeight);
   for(let index=0;index<pixels.length;index+=4){for(let lane=0;lane<3;lane++)image.data[index+lane]=Math.max(0,Math.min(255,pixels[index+lane]*(f.opcode==='TXQ'?8:255)));image.data[index+3]=255;}context.putImageData(image,0,0);
   const figure=document.createElement('figure'),shown=document.createElement('img'),caption=document.createElement('figcaption');shown.src=preview.toDataURL('image/png');caption.textContent=f.name+' · completed native pixels';figure.append(shown,caption);document.querySelector('#draws').append(figure);
  }
  need(frame.audit.held,'original texture pixels after consumed fence: '+JSON.stringify(mismatches));
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.activeTexture(gl.TEXTURE0+((f.stage==='vertex'?16:0)+f.slot));gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
  for(const handle of buffers)gl.deleteBuffer(handle);for(const handle of textures)gl.deleteTexture(handle);for(const handle of framebuffers)gl.deleteFramebuffer(handle);gl.deleteVertexArray(vao);gl.deleteProgram(program);
  frame.cleaned=buffers.every(h=>!gl.isBuffer(h))&&textures.every(h=>!gl.isTexture(h))&&framebuffers.every(h=>!gl.isFramebuffer(h))&&!gl.isVertexArray(vao)&&!gl.isProgram(program);need(frame.cleaned,'complete physical texture program cleanup');
 }
}
export async function runStandardTextureSuite(options){
 const report={schema:'original-2d-texture-operation-browser-v1',status:'running',guestExecution:false,productionNegotiation:false,frames:[],compiles:[],blobs:[]};window.__standardTextureReport=report;
 try{
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;document.querySelector('#draws').append(canvas);const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(gl instanceof WebGL2RenderingContext,'actual WebGL2');
  need(gl.getExtension('EXT_color_buffer_float'),'physical float output capability');need(gl.getExtension('EXT_render_snorm'),'physical signed plane inspection');
  const info=gl.getExtension('WEBGL_debug_renderer_info');report.gl={version:gl.getParameter(gl.VERSION),renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:info?gl.getParameter(info.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),extensions:gl.getSupportedExtensions()};need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.gl.renderer),'actual headed M4 Max Metal');
  report.limits={units:gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),vertexUnits:gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),fragmentUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};need(report.limits.units>=32&&report.limits.vertexUnits>=16&&report.limits.fragmentUnits>=16,'actual original stage slots');
  const cases=(await (await fetch(options.matrixPath)).json()).cases,native=(await (await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);need(cases.length===native.length,'complete original native matrix');
  if(!options.fault)for(const [i,row]of native.entries())if(row.result.ok){for(const [stage,body]of row.result.vertex?[['vertex',row.result.vertex],['fragment',row.result.fragment]]:[[cases[i].kind===0||cases[i].kind===7||cases[i].kind===12?'vertex':'fragment',row.result]]){const observed=compileOnly(gl,stage,body);report.compiles.push({case:i,name:cases[i].name,stage,source:body.glsl,metadata:body.metadata,...observed});}}
  const bridge=await createVirglStandardTextureShaderBridge();let fixtures=textureOperationFixtures();if(options.fault)fixtures=fixtures.filter(f=>f.stage==='fragment'&&f.range==='full'&&f.slot===3&&f.kind==='unorm'&&!f.linear&&f.opcode===(options.fault==='query-levels'?'TXQ':options.fault==='lod-selection'?'TXL':'TXD')).slice(0,1);
  for(const f of fixtures)await draw(gl,bridge,f,cases,native,report,options.fault??null);need(gl.getError()===gl.NO_ERROR,'zero final native errors');report.status='passed';document.querySelector('#status').textContent=fixtures.length+' original texture-operation frames passed';
 }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Texture-operation evidence failed';}
 return report;
}

export {runStandardTextureSuite as runAcceptance};
