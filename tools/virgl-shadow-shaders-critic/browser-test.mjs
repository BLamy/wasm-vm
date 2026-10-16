import {createVirglStandardShadowTextureShaderBridge} from '/renderer/virgl-shader/standard.mjs';
import {createProgram,digest} from '/renderer/virgl-shader/tests/browser.mjs';
import {request,expectedWords,views,depths,units,comparisonFunctions,originalSamplerWords,originalViewWords,inputs} from './fixtures.mjs';
const need=(okay,message)=>{if(!okay)throw Error(message);},equal=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
function capture(native,report){
 const handles=new WeakMap(),methods=new Map(),bodies=[];let serial=1;
 const encode=value=>{
  if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength),key='body-'+bodies.length;bodies.push({key,bytes:bytes.slice()});return {key,type:value.constructor.name,byteLength:bytes.byteLength};}
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==='object'){if(!handles.has(value))handles.set(value,serial++);return {handle:handles.get(value),type:value.constructor.name};}
  return value===undefined?{undefined:true}:value;
 };
 return {bodies,gl:new Proxy(native,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;if(!methods.has(name))methods.set(name,(...args)=>{const event={id:report.events.length,method:name,args:args.map(encode)};report.events.push(event);try{const result=value.apply(target,args);event.result=encode(result);if(name==='readPixels'||name==='getBufferSubData')event.after=args.map(encode);return result;}catch(e){event.error=String(e);throw e;}});return methods.get(name);}})};
}
async function complete(gl,report){
 const writer=report.events.at(-1);need(writer.method==='drawArrays','immediately preceding original writer');
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0),created=report.events.at(-1);need(sync,'new physical native fence');gl.flush();let result,count=0;const began=performance.now();
 do{result=gl.clientWaitSync(sync,0,0);count++;need(performance.now()-began<20000,'completion deadline');if(result===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));}while(result===gl.TIMEOUT_EXPIRED);
 need([gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(result),'actual native completion');const consumed=report.events.at(-1);gl.deleteSync(sync);
 return {writerEvent:writer.id,createdEvent:created.id,consumedEvent:consumed.id,deleteEvent:report.events.at(-1).id,handle:created.result.handle,status:result,waits:count};
}
export async function runAcceptance(options){
 const report={schema:'independent-original-shadow-native-v1',status:'running',guestExecution:false,productionNegotiation:false,events:[],blobs:[],frames:[],original:{request,expectedWords,views,samplers:Object.fromEntries(['vertex','fragment'].map(stage=>[stage,originalSamplerWords(stage)])),viewPackets:Object.fromEntries(['vertex','fragment'].map(stage=>[stage,originalViewWords(stage)]))}};window.__shadowCriticReport=report;
 let bodies=[];
 try{
  const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;canvas.style='width:300px;height:200px;image-rendering:pixelated';document.querySelector('#draws').append(canvas);
  const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(native instanceof WebGL2RenderingContext,'actual WebGL2');
  const captured=capture(native,report),gl=captured.gl;bodies=captured.bodies;
  const info=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.renderer),'actual Apple Metal');
  const bridge=await createVirglStandardShadowTextureShaderBridge(),pair=bridge.translatePairImages(request);need(pair.ok,'novel original pair admitted');report.pair=pair;
  const nativeRows=(await(await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);equal(pair,nativeRows[0].result,'full original native/Wasm/browser response');
  const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program;report.logs=built.logs;gl.useProgram(program);
  const buffers=[],textures=[],samplers=[],vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const upload=(target,bytes)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,bytes,gl.STATIC_DRAW);const copied=new Uint8Array(bytes.length);gl.getBufferSubData(target,0,copied);equal([...copied],[...bytes],'retained whole original native input');return b;};
  const originalInputs=inputs();report.inputs=[];
  for(const [index,bytes]of originalInputs.entries()){const location=gl.getAttribLocation(program,'in_'+index);need(location>=0,'novel input active');const buffer=upload(gl.ARRAY_BUFFER,bytes);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);report.inputs.push({index,location,bufferEvent:report.events.findLast(e=>e.method==='bufferData').id,originalBytes:[...bytes]});}
  const block=gl.getUniformBlockIndex(program,'VirglBlock'),size=gl.getActiveUniformBlockParameter(program,block,gl.UNIFORM_BLOCK_DATA_SIZE),member=gl.getUniformIndices(program,['winsys_adjust_y'])[0],offset=gl.getActiveUniforms(program,[member],gl.UNIFORM_OFFSET)[0];need(size===656&&offset===640,'original coordinate block656');
  const blockBytes=new Uint8Array(656);new DataView(blockBytes.buffer).setFloat32(640,1,true);const blockBuffer=upload(gl.UNIFORM_BUFFER,blockBytes);gl.uniformBlockBinding(program,block,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,blockBuffer);gl.uniform2f(gl.getUniformLocation(program,'wv_point_size'),1,0);report.block={block,size,offset};
  report.uniforms=[];report.unused=[];
  for(const [stage,body]of [['vertex',pair.vertex],['fragment',pair.fragment]]){
   const prefix=stage==='vertex'?'vs':'fs';
   need(!body.metadata.samplers.some(u=>u.index===15)&&!body.metadata.shadowUniforms.some(u=>u.index===15),'unused original declarations own no metadata binding');
   const absent=['samp','shadmask','shadadd'].map(kind=>prefix+kind+'15');
   for(const name of absent)need(gl.getUniformLocation(program,name)===null,'unused native binding absent '+name);
   report.unused.push({stage,index:15,names:absent,metadataAbsent:true,nativeLocationsAbsent:true});
   for(const uniform of [...body.metadata.samplers,...body.metadata.shadowUniforms,...body.metadata.textureQueries]){
    const location=gl.getUniformLocation(program,uniform.name);
    need(location!==null,'stage-owned native location '+uniform.name);const index=gl.getUniformIndices(program,[uniform.name])[0],type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],size=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0];
    need(size===1&&type===(uniform.type==='vec4'?gl.FLOAT_VEC4:uniform.type==='int'?gl.INT:gl.SAMPLER_2D_SHADOW),'reflected exact stage-owned type');
    const value=uniform.type==='vec4'?views[stage].map(lane=>uniform.semantic==='SHADOW_MASK'?Number(lane<4):Number(lane===5)):uniform.type==='int'?3:units[stage];
    if(uniform.type==='vec4')gl.uniform4fv(location,new Float32Array(value));else gl.uniform1i(location,value);
    const actual=gl.getUniform(program,location);equal(uniform.type==='vec4'?[...actual]:actual,value,'original effective view binding '+uniform.name);report.uniforms.push({stage,...uniform,index,type,size,value,actual:uniform.type==='vec4'?[...actual]:actual});
   }
   const texture=gl.createTexture(),sampler=gl.createSampler();textures.push(texture);samplers.push(sampler);gl.activeTexture(gl.TEXTURE0+units[stage]);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,3,gl.DEPTH_COMPONENT32F,4,2);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,2);
   for(let level=0;level<3;level++){const width=Math.max(1,4>>level),height=Math.max(1,2>>level);gl.texSubImage2D(gl.TEXTURE_2D,level,0,0,width,height,gl.DEPTH_COMPONENT,gl.FLOAT,new Float32Array(width*height).fill(depths[stage][level]));}
   for(const [name,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST_MIPMAP_NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE],[gl.TEXTURE_COMPARE_FUNC,gl.NEVER+comparisonFunctions[stage]]]){gl.samplerParameteri(sampler,name,value);need(gl.getSamplerParameter(sampler,name)===value,'native comparison sampler state');}
   gl.samplerParameterf(sampler,gl.TEXTURE_MIN_LOD,0);gl.samplerParameterf(sampler,gl.TEXTURE_MAX_LOD,2);gl.bindSampler(units[stage],sampler);
   need(prefix+'samp7'===body.metadata.samplers.find(s=>s.index===7).name,'original stage isolation');
  }
  const output=gl.createTexture(),fb=gl.createFramebuffer();textures.push(output);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,3,2);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'complete physical whole output');
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(capability);gl.viewport(0,0,3,2);gl.colorMask(true,true,true,true);
  const baselineExpected=new Uint32Array(expectedWords),expectedHash=await digest(new Uint8Array(baselineExpected.buffer));
  for(const corrupted of [false,true]){
   if(corrupted){const value=new Float32Array([0,0,0,1]),location=gl.getUniformLocation(program,'fsshadmask7');gl.uniform4fv(location,value);equal([...gl.getUniform(program,location)],[...value],'physical single original mask.y corruption');}
   gl.clearBufferuiv(gl.COLOR,0,new Uint32Array([123,123,123,123]));gl.drawArrays(gl.POINTS,0,6);const fence=await complete(gl,report),actual=new Uint32Array(24);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,3,2,gl.RGBA_INTEGER,gl.UNSIGNED_INT,actual);const readEvent=report.events.at(-1),misses=[];
   need(gl.getError()===gl.NO_ERROR,'zero original native result errors');need(await digest(new Uint8Array(baselineExpected.buffer))===expectedHash,'retained baseline expected bytes');
   for(let index=0;index<24;index++)if(actual[index]!==baselineExpected[index])misses.push({index,x:(index>>2)%3,y:Math.floor(index/12),lane:index%4,expected:baselineExpected[index],observed:actual[index]});
   if(corrupted){need(misses.length===4&&misses.every(m=>m.lane===1&&m.observed===2&&m.expected===1065353218),'completed native corruption must refute original words');need(fence.handle!==report.frames[0].fence.handle,'actual distinct control completion');}
   else need(misses.length===0,'original novel whole plane must agree '+JSON.stringify(misses));
   report.frames.push({name:corrupted?'completed-fragment-mask-y-corruption':'original-baseline',width:3,height:2,corrupted,fence,readEvent:readEvent.id,outputKey:readEvent.after.at(-1).key,expectedSha256:expectedHash,expectedWords:[...baselineExpected],observedWords:[...actual],status:corrupted?'refuted':'held',misses});
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);for(const unit of [3,9]){gl.bindSampler(unit,null);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,null);
  for(const b of buffers)gl.deleteBuffer(b);for(const t of textures)gl.deleteTexture(t);for(const s of samplers)gl.deleteSampler(s);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(program);
  need(buffers.every(b=>!gl.isBuffer(b))&&textures.every(t=>!gl.isTexture(t))&&samplers.every(s=>!gl.isSampler(s))&&!gl.isFramebuffer(fb)&&!gl.isVertexArray(vao)&&!gl.isProgram(program),'all critic native objects retired');report.cleaned=true;
  report.status='passed';document.querySelector('#status').textContent='Original same-slot stage isolation held; completed mask corruption refuted.';document.querySelector('#renderer').textContent=report.renderer;
 }catch(e){report.status='failed';report.error=e.stack??String(e);document.querySelector('#status').textContent='Critic failed';}
 for(const {key,bytes}of bodies){const compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());let binary='';for(let at=0;at<compressed.length;at+=32768)binary+=String.fromCharCode(...compressed.subarray(at,at+32768));report.blobs.push({key,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(compressed),gzipBase64:btoa(binary)});}
 return report;
}
