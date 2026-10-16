// Fresh critic promotion: same original sampler slot has independent stage dimensions/types.
import {createVirglStandardDimensionalTextureShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {createProgram, digest} from '../../renderer/virgl-shader/tests/browser.mjs';
export const vertexText = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL SAMP[7]\nDCL SVIEW[7], 3D, UINT\nDCL TEMP[0..1]\nIMM[0] INT32 {1,0,2,1}\nIMM[1] INT32 {1,0,0,0}\n0: MOV OUT[0], IN[0]\n1: TXF TEMP[0], IMM[0], SAMP[7], 3D\n2: TXQ TEMP[1], IMM[1], SAMP[7], 3D\n3: XOR OUT[1], TEMP[0], TEMP[1]\n4: END\n';
export const fragmentText = 'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL SAMP[7]\nDCL SVIEW[7], 2D_ARRAY, SINT\nDCL TEMP[0..1]\nIMM[0] INT32 {0,1,3,1}\nIMM[1] INT32 {1,0,0,0}\n0: TXF TEMP[0], IMM[0], SAMP[7], 2D_ARRAY\n1: TXQ TEMP[1], IMM[1], SAMP[7], 2D_ARRAY\n2: XOR TEMP[0], TEMP[0], TEMP[1]\n3: XOR OUT[0], TEMP[0], IN[0]\n4: END\n';
export const request = {vertexText, fragmentText, signedMask: 0, unsignedMask: 0, packedSignedMask: 0, packedNormalizedMask: 0, bufferZeroMask: 0, signedColorMask: 0, unsignedColorMask: 1};
// This full sixteen-byte oracle is fixed from original literals, independently of GLSL.
export const expectedWords = [0x1effef07, 0x1effeef9, 0x1effeeff, 0x1effeefb];
const need = (v,why) => {if (!v) throw Error(why);};
function textureWords(stage,level,width,height,layers) {
 const out = [];
 for (let z=0;z<layers;z++) for (let y=0;y<height;y++) for (let x=0;x<width;x++) for (let k=0;k<4;k++)
  out.push(stage==='vertex' ? (0xe0000000+level*0x10000+z*0x1000+y*0x100+x*4+k)>>>0 : -(0x1000000+level*0x10000+z*0x1000+y*0x100+x*4+k));
 return stage==='vertex'?new Uint32Array(out):new Int32Array(out);
}
export async function runAcceptance(options) {
 const report={schema:'dimensional-stage-isolation-v1',status:'running',guestExecution:false,productionNegotiation:false,seed:options.seed,request,expectedWords,events:[],blobs:[]};window.__dimensionalIsolationReport=report;
 const bytes=[],handles=new WeakMap(),methods=new Map();let next=1;
 const encode=value=>{
  if(ArrayBuffer.isView(value)){const body=new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice(),key='body-'+bytes.length;bytes.push({key,body});return {key,type:value.constructor.name,bytes:body.length};}
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==='object'){if(!handles.has(value))handles.set(value,next++);return {handle:handles.get(value)};}
  return value===undefined?null:value;
 };
 let gl,program,vao,fb;const textures=[],buffers=[];
 try {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;document.querySelector('#draws').append(canvas);const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(native instanceof WebGL2RenderingContext,'actual WebGL2');
  gl=new Proxy(native,{get(t,name){const value=Reflect.get(t,name,t);if(typeof value!=='function')return value;if(!methods.has(name))methods.set(name,(...args)=>{const event={id:report.events.length,method:name,args:args.map(encode)};report.events.push(event);const result=value.apply(t,args);event.result=encode(result);if(name==='readPixels')event.after=args.map(encode);return result;});return methods.get(name);}});
  const info=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.renderer),'native M4 Max Metal');
  const bridge=await createVirglStandardDimensionalTextureShaderBridge();report.pair=bridge.translatePairImages(request);need(report.pair.ok,'original stage-local dimensions admitted');
  need(report.pair.vertex.metadata.samplers[0].type==='usampler3D'&&report.pair.fragment.metadata.samplers[0].type==='isampler2DArray','independent same-slot typed metadata');
  program=createProgram(gl,report.pair.vertex,report.pair.fragment).program;vao=gl.createVertexArray();fb=gl.createFramebuffer();need(vao&&fb,'native objects');gl.useProgram(program);gl.bindVertexArray(vao);
  const block=gl.getUniformBlockIndex(program,'VirglBlock');const blockData=new Uint8Array(656);new DataView(blockData.buffer).setFloat32(640,1,true);const ub=gl.createBuffer();buffers.push(ub);gl.bindBuffer(gl.UNIFORM_BUFFER,ub);gl.bufferData(gl.UNIFORM_BUFFER,blockData,gl.STATIC_DRAW);gl.uniformBlockBinding(program,block,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,ub);gl.uniform2f(gl.getUniformLocation(program,'wv_point_size'),1,0);
  const vb=gl.createBuffer();buffers.push(vb);gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,0,1]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'in_0');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,4,gl.FLOAT,false,0,0);
  report.reflection=[];report.uploads=[];
  for(const stage of ['vertex','fragment']) {
   const target=stage==='vertex'?gl.TEXTURE_3D:gl.TEXTURE_2D_ARRAY,prefix=stage==='vertex'?'vs':'fs',unit=stage==='vertex'?6:9,levels=stage==='vertex'?3:2;
   for(const [name,type,value] of [[prefix+'samp7',stage==='vertex'?gl.UNSIGNED_INT_SAMPLER_3D:gl.INT_SAMPLER_2D_ARRAY,unit],[prefix+'samplevels7',gl.INT,levels]]) {
    const location=gl.getUniformLocation(program,name),index=gl.getUniformIndices(program,[name])[0];need(location!==null&&index!==gl.INVALID_INDEX,'active stage-local original uniform');const actual=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0];need(actual===type,'actual stage-local native type');gl.uniform1i(location,value);need(gl.getUniform(program,location)===value,'distinct owned stage query and sampler binding');report.reflection.push({name,type:actual,value});
   }
   const texture=gl.createTexture();textures.push(texture);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(target,texture);gl.texStorage3D(target,levels,stage==='vertex'?gl.RGBA32UI:gl.RGBA32I,stage==='vertex'?5:3,stage==='vertex'?3:5,stage==='vertex'?7:4);
   gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.NEAREST_MIPMAP_NEAREST);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
   let order=Array.from({length:levels},(_,i)=>i);if((options.seed>>>0)&1)order.reverse();
   for(const level of order) {
    const width=Math.max(1,(stage==='vertex'?5:3)>>level),height=Math.max(1,(stage==='vertex'?3:5)>>level),layers=stage==='vertex'?Math.max(1,7>>level):4,original=textureWords(stage,level,width,height,layers),originalKey='original-'+bytes.length;bytes.push({key:originalKey,body:new Uint8Array(original.buffer).slice()});let data=original;
    if(options.fault&&stage==='fragment'){data=original.slice();const plane=width*height*4;data.set(original.subarray((layers-1)*plane),0);data.set(original.subarray(0,plane),(layers-1)*plane);}
    gl.texSubImage3D(target,level,0,0,0,width,height,layers,gl.RGBA_INTEGER,stage==='vertex'?gl.UNSIGNED_INT:gl.INT,data);report.uploads.push({stage,level,width,height,layers,originalKey,event:report.events.at(-1).id,swappedLayers:options.fault&&stage==='fragment'?[0,layers-1]:null});
   }
  }
  const output=gl.createTexture();textures.push(output);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,1,1);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'actual framebuffer');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);gl.viewport(0,0,1,1);gl.clearBufferuiv(gl.COLOR,0,new Uint32Array([0,0,0,0]));gl.drawArrays(gl.POINTS,0,1);const writer=report.events.at(-1).id;need(gl.getError()===gl.NO_ERROR,'valid native draw');
  const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0),created=report.events.at(-1).id;need(sync,'physical GPU fence');gl.flush();let status,waits=0;do{status=gl.clientWaitSync(sync,0,0);need(++waits<20000,'bounded wait');if(status===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));}while(status===gl.TIMEOUT_EXPIRED);const consumed=report.events.at(-1).id;need(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,'signaled native fence');gl.deleteSync(sync);report.completion={writer,created,consumed,status,waits};
  const pixels=new Uint32Array(4);gl.readPixels(0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,pixels);report.readEvent=report.events.at(-1).id;report.actualWords=[...pixels];need(gl.getError()===gl.NO_ERROR,'raw complete readback');report.matches=pixels.every((v,i)=>v===expectedWords[i]);need(report.matches,'unchanged sixteen-byte stage-isolation oracle');report.status='passed';
 } catch(error) {report.status='failed';report.error=error.stack??String(error);}
 finally {
  if(gl){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);for(const [unit,target]of [[6,gl.TEXTURE_3D],[9,gl.TEXTURE_2D_ARRAY],[0,gl.TEXTURE_2D]]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(target,null);}for(const t of textures)gl.deleteTexture(t);for(const b of buffers)gl.deleteBuffer(b);if(fb)gl.deleteFramebuffer(fb);if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);report.cleaned=textures.every(t=>!gl.isTexture(t))&&buffers.every(b=>!gl.isBuffer(b))&&(!fb||!gl.isFramebuffer(fb))&&(!vao||!gl.isVertexArray(vao))&&(!program||!gl.isProgram(program));need(report.cleaned,'retire all owned native objects');}
 }
 for(const {key,body}of bytes){const z=new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());let encoded='';for(let i=0;i<z.length;i+=32768)encoded+=String.fromCharCode(...z.subarray(i,i+32768));report.blobs.push({key,bytes:body.length,sha256:await digest(body),gzipSha256:await digest(z),gzipBase64:btoa(encoded)});}
 document.querySelector('#status').textContent=report.status+' original simultaneous stage textures';return report;
}
if(typeof window==='undefined') {
 const fs=await import('node:fs/promises'),path=await import('node:path'),{gunzipSync}=await import('node:zlib'),{createHash}=await import('node:crypto'),{runVirglBrowser,browserOptions,browserDocument}=await import('../lib/virgl-browser-runner.mjs');
 const options=browserOptions(['--seed','--fault']);need(!options.fault||options.fault==='wrong-layer','bounded physical sabotage');const source='tools/virgl-dimensional-shaders/stage-isolation-test.mjs';
 const report=await runVirglBrowser({options,task:'E6-T11d57',boundary:'Independent same-slot dimensional stage isolation',reportFields:{productionNegotiation:false},modulePath:'/'+source,windowReportKey:'__dimensionalIsolationReport',serializedAcceptance:true,browserArguments:{seed:Number(options.seed??0x27182818),fault:options.fault??null},servedFiles:[source],pinnedFiles:[{path:source,sha256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex')}],html:browserDocument({title:'Independent dimensional stage isolation',heading:'Original same-slot typed dimensions',description:'Distinct native 3D and array textures · complete original words · physical completion'}),validate(a){need(a.cleaned&&a.matches&&a.reflection.length===4&&a.uploads.length===5,'whole semantic assertion');},successMessage:()=> 'Original simultaneous stage dimensions passed.'});
 for(const blob of report.acceptance?.blobs??[]){const z=Buffer.from(blob.gzipBase64,'base64'),b=gunzipSync(z);need(b.length===blob.bytes&&createHash('sha256').update(b).digest('hex')===blob.sha256,'complete original body');delete blob.gzipBase64;blob.path=blob.key+'.bin.gz';await fs.writeFile(path.join(path.resolve(options.output),blob.path),z);}
 await fs.writeFile(path.join(path.resolve(options.output),'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
}
