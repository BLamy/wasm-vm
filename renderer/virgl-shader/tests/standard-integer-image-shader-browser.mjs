import {createVirglStandardIntegerImageShaderBridge} from '../standard.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';
import {integerImageFixtures,sampledWords,positions} from '../../../tools/virgl-integer-image-shader/fixtures.mjs';
const need=(v,message)=>{if(!v)throw Error(message);};
const same=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
function encoded(bytes){let r='';for(let at=0;at<bytes.length;at+=32768)r+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(r);}
async function blob(report,bytes,kind){
 const zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 const item={key:'blob-'+report.blobs.length,kind,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(zipped),gzipBase64:encoded(zipped)};report.blobs.push(item);return item.key;
}
async function complete(gl,frame){
 const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(fence,'actual integer shader fence');gl.flush();const start=performance.now();let status,waits=0;
 do{status=gl.clientWaitSync(fence,0,0);waits++;if(status===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));need(performance.now()-start<20000,'integer shader completion deadline');}while(status===gl.TIMEOUT_EXPIRED);
 need(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,'integer shader GPU completion');gl.deleteSync(fence);frame.gpuComplete={submitted:true,fenced:true,status,waits};
}
function compileOnly(gl,stage,body,expect=true){
 const shader=gl.createShader(stage==='vertex'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);need(shader,'native matrix shader');
 try{gl.shaderSource(shader,body.glsl);gl.compileShader(shader);const log=gl.getShaderInfoLog(shader),okay=gl.getShaderParameter(shader,gl.COMPILE_STATUS);need(okay===expect,'native integer image shader compile: '+log);return {okay,log};}
 finally{gl.deleteShader(shader);need(!gl.isShader(shader),'native shader retirement');}
}
function uploadArray(f,plane){
 const components=f.components===3?4:f.components,ArrayType=globalThis[(f.signed?'Int':'Uint')+f.bits+'Array'],result=new ArrayType(plane.width*plane.height*components),view=new DataView(plane.bytes.buffer,plane.bytes.byteOffset,plane.bytes.byteLength);
 for(let pixel=0;pixel<plane.width*plane.height;pixel++)for(let lane=0;lane<components;lane++)result[pixel*components+lane]=lane<f.components?view[(f.signed?'getInt':'getUint')+f.bits]((pixel*f.components+lane)*f.bits/8,true):1;
 return result;
}
async function draw(gl,bridge,f,lookup,report,fault){
 const request={vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors},pair=bridge.translatePairImages(request);need(pair.ok,'complete original typed pair '+f.name);
 const key=JSON.stringify([f.vertexText,f.fragmentText,f.selectors]),row=lookup.get(key);need(row,'frozen original native pair');same(pair,row.result,'complete native/Wasm/browser pair');
 const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],textures=[],framebuffers=[],vao=gl.createVertexArray();need(vao,'actual integer shader VAO');
 const frame={name:f.name,format:f.format,bits:f.bits,signed:f.signed,components:f.components,stage:f.stage,opcode:f.opcode,range:f.range,firstLevel:f.firstLevel,lastLevel:f.lastLevel,width:f.width,height:f.height,levels:f.levels,slot:f.slot,lod:f.lod,coord:f.coord,fetch:f.fetch,frameWidth:f.frameWidth,frameHeight:f.frameHeight,queryMask:f.queryMask,writeMask:f.writeMask,initial:f.initial,saturate:!!f.saturate,precise:!!f.precise,finite:!!f.finite,modifier:f.modifier??null,broadcast:!!f.broadcast,sparse:!!f.sparse,selectors:f.selectors,vertexText:f.vertexText,fragmentText:f.fragmentText,nativeIndex:row.index,pair,logs:built.logs,planes:[],attributes:[],samplers:[],queries:[],outputs:[],fault};report.frames.push(frame);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);frame.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  const point=gl.getUniformLocation(program,'wv_point_size');need(point!==null,'point-size binding');gl.uniform2f(point,1,0);
  const coordinates=new Float32Array([0,0,0,f.lod,1,0,0,f.lod,0,1,0,f.lod,0,1,0,f.lod,1,0,0,f.lod,1,1,0,f.lod]);
  for(const [index,data]of [[0,positions],...(f.opcode==='TXB'?[[1,coordinates]]:[])]){
   const buffer=gl.createBuffer();need(buffer,'original attribute');buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);const location=gl.getAttribLocation(program,'in_'+index);need(location>=0,'native original attribute');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
   const raw=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),stored=new Uint8Array(raw.length);gl.getBufferSubData(gl.ARRAY_BUFFER,0,stored);same([...stored],[...raw],'complete original attribute bytes');frame.attributes.push({index,location,original:await blob(report,raw,'original-attribute'),native:await blob(report,stored,'native-attribute')});
  }
  const unit=(f.stage==='vertex'?16:0)+f.slot,image=gl.createTexture();need(image,'original native integer image');textures.push(image);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,image);
  const channels=f.components===1?'R':f.components===2?'RG':'RGBA',internal=gl[channels+f.bits+(f.signed?'I':'UI')],type=gl[f.signed?{8:'BYTE',16:'SHORT',32:'INT'}[f.bits]:{8:'UNSIGNED_BYTE',16:'UNSIGNED_SHORT',32:'UNSIGNED_INT'}[f.bits]],format=gl[channels==='R'?'RED_INTEGER':channels+'_INTEGER'];
  gl.texStorage2D(gl.TEXTURE_2D,f.levels,internal,f.width,f.height);need(gl.getError()===gl.NO_ERROR,'actual integer immutable image');
  for(const [name,value]of [['TEXTURE_BASE_LEVEL',0],['TEXTURE_MAX_LEVEL',f.levels-1],['TEXTURE_MIN_FILTER',gl.NEAREST_MIPMAP_NEAREST],['TEXTURE_MAG_FILTER',gl.NEAREST],['TEXTURE_WRAP_S',gl.CLAMP_TO_EDGE],['TEXTURE_WRAP_T',gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,gl[name],value);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  for(const plane of f.planes){const input=uploadArray(f,plane);gl.texSubImage2D(gl.TEXTURE_2D,plane.level,0,0,plane.width,plane.height,format,type,input);need(gl.getError()===gl.NO_ERROR,'actual original integer upload');frame.planes.push({level:plane.level,width:plane.width,height:plane.height,internal,type,format,arrayType:input.constructor.name,original:await blob(report,plane.bytes,'original-integer-plane'),uploaded:await blob(report,new Uint8Array(input.buffer),'original-native-integer-upload')});}
  for(const [stage,body]of [[0,pair.vertex],[1,pair.fragment]]){
   for(const sampler of body.metadata.samplers){const location=gl.getUniformLocation(program,sampler.name),index=gl.getUniformIndices(program,[sampler.name])[0],expected=gl[{sampler2D:'SAMPLER_2D',isampler2D:'INT_SAMPLER_2D',usampler2D:'UNSIGNED_INT_SAMPLER_2D'}[sampler.type]];let nativeType=null;
    if(location!==null){nativeType=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0];need(index!==gl.INVALID_INDEX&&nativeType===expected&&gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0]===1,'actual original integer sampler type');gl.uniform1i(location,unit);}frame.samplers.push({...sampler,stage,active:location!==null,unit,nativeType,expected});}
   for(const query of body.metadata.textureQueries){const location=gl.getUniformLocation(program,query.name),index=gl.getUniformIndices(program,[query.name])[0];need(location!==null&&index!==gl.INVALID_INDEX&&gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0]===gl.INT,'native integer query levels');gl.uniform1i(location,f.levels);frame.queries.push({...query,stage,expected:f.levels,actual:gl.getUniform(program,location)});}
  }
  const fb=gl.createFramebuffer();need(fb,'typed output framebuffer');framebuffers.push(fb);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,fb);
  const attachments=[];
  for(const [location,kind]of f.targets.entries()){
   if(kind===null){attachments.push(gl.NONE);continue;}
   const texture=gl.createTexture();need(texture,'typed output image');textures.push(texture);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);const internal=gl[kind==='sint'?'RGBA32I':kind==='uint'?'RGBA32UI':'RGBA32F'];gl.texStorage2D(gl.TEXTURE_2D,1,internal,f.frameWidth,f.frameHeight);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0+location,gl.TEXTURE_2D,texture,0);attachments.push(gl.COLOR_ATTACHMENT0+location);frame.outputs.push({location,kind,internal});
  }
  gl.drawBuffers(attachments);need(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'actual mixed integer/float framebuffer');gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,image);
  if(fault==='wrong-level'){gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,1);frame.nativeFault={method:'texParameteri',name:'TEXTURE_BASE_LEVEL',actual:1};}
  if(fault==='wrong-words'){
   const input=uploadArray(f,f.planes[f.lod]),at=(f.fetch[1]*f.planes[f.lod].width+f.fetch[0])*(f.components===3?4:f.components);input[at]=(input[at]^1)>>>0;gl.texSubImage2D(gl.TEXTURE_2D,f.lod,0,0,f.planes[f.lod].width,f.planes[f.lod].height,format,type,input);frame.nativeFault={method:'texSubImage2D',level:f.lod,lane:'r',bit:0};
  }
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(capability);
  gl.viewport(0,0,f.frameWidth,f.frameHeight);gl.colorMask(true,true,true,true);
  for(const output of frame.outputs)gl[output.kind==='sint'?'clearBufferiv':output.kind==='uint'?'clearBufferuiv':'clearBufferfv'](gl.COLOR,output.location,output.kind==='sint'?new Int32Array([-123,-123,-123,-123]):output.kind==='uint'?new Uint32Array([0xdeadbeef,0xdeadbeef,0xdeadbeef,0xdeadbeef]):new Float32Array([-123,-123,-123,-123]));
  gl.drawArrays(gl.TRIANGLES,0,6);need(gl.getError()===gl.NO_ERROR,'actual typed shader draw');await complete(gl,frame);
  if(fault==='wrong-level')gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);
  const inspection=gl.createFramebuffer();need(inspection,'native full-plane inspector');framebuffers.push(inspection);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,inspection);
  for(const plane of frame.planes){gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,image,plane.level);gl.readBuffer(gl.COLOR_ATTACHMENT0);need(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'native source plane');const pixels=f.signed?new Int32Array(plane.width*plane.height*4):new Uint32Array(plane.width*plane.height*4);gl.readPixels(0,0,plane.width,plane.height,gl.RGBA_INTEGER,f.signed?gl.INT:gl.UNSIGNED_INT,pixels);need(gl.getError()===gl.NO_ERROR,'native source whole words');plane.native=await blob(report,new Uint8Array(pixels.buffer),'complete-native-integer-plane');}
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);const mismatches=[];let checked=0;
  for(const output of frame.outputs){gl.readBuffer(gl.COLOR_ATTACHMENT0+output.location);const pixels=output.kind==='sint'?new Int32Array(f.frameWidth*f.frameHeight*4):output.kind==='uint'?new Uint32Array(f.frameWidth*f.frameHeight*4):new Float32Array(f.frameWidth*f.frameHeight*4);gl.readPixels(0,0,f.frameWidth,f.frameHeight,output.kind==='float'?gl.RGBA:gl.RGBA_INTEGER,output.kind==='sint'?gl.INT:output.kind==='uint'?gl.UNSIGNED_INT:gl.FLOAT,pixels);need(gl.getError()===gl.NO_ERROR,'complete native typed output');output.native=await blob(report,new Uint8Array(pixels.buffer),'complete-typed-output');const words=new Uint32Array(pixels.buffer);
   for(let y=0;y<f.frameHeight;y++)for(let x=0;x<f.frameWidth;x++){const expected=sampledWords(f,x,y);for(let lane=0;lane<4;lane++){const actual=words[(y*f.frameWidth+x)*4+lane];checked++;if(actual!==expected[lane]&&mismatches.length<12)mismatches.push({location:output.location,x,y,lane,expected:expected[lane],actual});}}
  }
  frame.audit={held:mismatches.length===0,checkedWords:checked,mismatches};need(frame.audit.held,'original integer shader pixels after native fence: '+JSON.stringify(mismatches));
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.activeTexture(gl.TEXTURE0+((f.stage==='vertex'?16:0)+f.slot));gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
  for(const b of buffers)gl.deleteBuffer(b);for(const t of textures)gl.deleteTexture(t);for(const fb of framebuffers)gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(program);frame.cleaned=buffers.every(h=>!gl.isBuffer(h))&&textures.every(h=>!gl.isTexture(h))&&framebuffers.every(h=>!gl.isFramebuffer(h))&&!gl.isVertexArray(vao)&&!gl.isProgram(program);need(frame.cleaned,'all native shader objects retired');
 }
}
export async function runAcceptance(options){
 const report={schema:'original-integer-image-shader-native-v1',status:'running',guestExecution:false,productionNegotiation:false,frames:[],compiles:[],typeControls:[],blobs:[]};window.__integerImageShaderReport=report;
 try{
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;document.querySelector('#draws').append(canvas);const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(gl instanceof WebGL2RenderingContext,'actual WebGL2');need(gl.getExtension('EXT_color_buffer_float'),'mixed native float attachment');const info=gl.getExtension('WEBGL_debug_renderer_info');report.gl={renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),extensions:gl.getSupportedExtensions()};need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.gl.renderer),'actual M4 Max Metal');
  const cases=(await(await fetch(options.matrixPath)).json()).cases,native=(await(await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);need(cases.length===native.length,'complete frozen native cases');const lookup=new Map();
  for(const [index,c]of cases.entries()){if(c.kind===17&&native[index].result.ok)lookup.set(JSON.stringify([c.a,c.b,c.selectors]),{index,result:native[index].result});}
  if(!options.fault)for(const [index,row]of native.entries())if(row.result.ok){const bodies=row.result.vertex?[['vertex',row.result.vertex],['fragment',row.result.fragment]]:[[cases[index].kind===0||cases[index].kind===7||cases[index].kind===12||cases[index].kind===15?'vertex':'fragment',row.result]];for(const [stage,body]of bodies)report.compiles.push({case:index,name:cases[index].name,stage,source:body.glsl,metadata:body.metadata,...compileOnly(gl,stage,body)});}
  const bridge=await createVirglStandardIntegerImageShaderBridge();let fixtures=integerImageFixtures();
  if(options.fault)fixtures=fixtures.filter(f=>!f.signed&&f.bits===32&&f.components===4&&f.stage==='fragment'&&f.range==='full'&&f.opcode===(options.fault==='wrong-level'?'TXL':'TXF')).slice(0,1);
  if(!options.fault){const f=fixtures.find(f=>!f.signed&&f.bits===32&&f.components===4&&f.stage==='fragment'&&f.opcode==='TXL'),pair=bridge.translatePairImages({vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors}),wrong=pair.fragment.glsl.replace('uvec4 r = uvec4(textureLod','uvec4 r = floatBitsToUint(textureLod');need(wrong!==pair.fragment.glsl,'actual typed native emission mutation');report.typeControls.push({kind:'integer-through-float-emission',original:pair.fragment.glsl,mutated:wrong,...compileOnly(gl,'fragment',{glsl:wrong},false)});}
  for(const f of fixtures)await draw(gl,bridge,f,lookup,report,options.fault??null);
  need(gl.getError()===gl.NO_ERROR,'zero final native errors');report.status='passed';document.querySelector('#status').textContent=fixtures.length+' original integer shader frames passed';
 }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Original integer shader evidence failed';}
 return report;
}
