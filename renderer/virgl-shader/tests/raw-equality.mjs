// E6-T12f1. Retained WebGL probe functions below remain byte-exact from E4c1.
import {createVirglShaderBridge} from '../index.mjs';
import {digest,texture2d,bindSystemBlocks} from './browser.mjs';
import {interpret} from './raw-equality-oracle.mjs';
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const equal=(a,b,message)=>require(JSON.stringify(a)===JSON.stringify(b),message+': '+JSON.stringify(a)+' / '+JSON.stringify(b));
const probes=new Map();
function expectedWords(name,vector){const text=probes.get(name);require(text,'bound literal program');const words=Array(184).fill(0);words.splice(0,4,...vector.a);words.splice(172,4,...vector.c);words.splice(180,4,...vector.b);const state=interpret(text,{0:[0,0,0,0x3f800000],1:[0,0,0,0x3f800000]},words);return [0,1,2,3].map(lane=>state.read('TEMP[117]',lane));}
async function source(path,sha256,size){
  const response=await fetch(`/${path}`);require(response.ok,`source ${path}`);const bytes=new Uint8Array(await response.arrayBuffer());
  const hash=await digest(bytes);if(sha256)equal(hash,sha256,'pinned source SHA');if(size!==undefined)equal(bytes.length,size,'pinned source size');
  return {path,sha256:hash,bytes:bytes.length,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}
function counted(gl,report){
  const kinds=['Shader','Program','Buffer','VertexArray','Framebuffer','Texture','TransformFeedback'];const owned=new Map();
  report.objects={created:{},deleted:{},live:0};
  return new Proxy(gl,{get(target,key){
    if(typeof key==='string')for(const kind of kinds){
      if(key===`create${kind}`)return(...args)=>{const value=target[key](...args);require(value,`${kind} allocation`);owned.set(value,kind);report.objects.created[kind]=(report.objects.created[kind]??0)+1;report.objects.live=owned.size;return value;};
      if(key===`delete${kind}`)return(value)=>{if(value!==null){equal(owned.get(value),kind,`owned ${kind} release`);owned.delete(value);report.objects.deleted[kind]=(report.objects.deleted[kind]??0)+1;report.objects.live=owned.size;}return target[key](value);};
    }
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
}
function compile(gl,vertex,fragment,feedback=false){
  const shaders=[],program=gl.createProgram(),logs={};
  try{
    for(const [stage,result,kind]of[['vertex',vertex,gl.VERTEX_SHADER],['fragment',fragment,gl.FRAGMENT_SHADER]]){
      const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,result.glsl);gl.compileShader(shader);logs[stage]=gl.getShaderInfoLog(shader);
      require(gl.getShaderParameter(shader,gl.COMPILE_STATUS),`${stage} actual compile: ${logs[stage]}`);gl.attachShader(program,shader);
    }
    if(feedback)gl.transformFeedbackVaryings(program,['gl_Position','vso_g0'],gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);logs.link=gl.getProgramInfoLog(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),`actual link: ${logs.link}`);
    return {program,logs};
  }catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
}
function attribute(gl,program,name,values,buffers){
  const location=gl.getAttribLocation(program,name);require(location>=0,`actual ${name} active`);const buffer=gl.createBuffer();buffers.push(buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values.flat()),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
  return {name,location,values};
}
function reflectConstants(gl,program,result,declaredCount){
  equal(result.metadata.uniforms.length,1,'raw probe one declared constant bank');const uniform=result.metadata.uniforms[0];
  equal([uniform.type,uniform.encoding,uniform.count],['uvec4[]','float32-bits',declaredCount],'unchanged declared constant ABI');
  const name=`${uniform.name}[0]`,index=gl.getUniformIndices(program,[name])[0],location=gl.getUniformLocation(program,name);
  require(index!==gl.INVALID_INDEX&&location!==null,'actual direct host uvec4 bank');
  const activeCount=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0],type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0];
  equal(type,gl.UNSIGNED_INT_VEC4,'actual raw uniform type');require(activeCount>=45&&activeCount<=declaredCount,'driver covers selector44 within truthful declared extent');
  const selector=gl.getUniformLocation(program,`${uniform.name}[44]`);require(selector!==null,'actual dynamic selector location');
  let padding=null;
  if(activeCount===47){const name=`${uniform.name}[46]`,location=gl.getUniformLocation(program,name);require(location!==null,'retained host-only padding location');const words=[0xdeadbeef,0x7f800001,0xff800000,1];gl.uniform4uiv(location,new Uint32Array(words));const observed=[...gl.getUniform(program,location)];equal(observed,words,'actual host-only padding poison');padding={location,record:{name,index:46,words,observed}};}
  return {name,index,location,selector,padding,uniformName:uniform.name,record:{name,index,declaredCount,activeCount,type,uploadCount:Math.min(activeCount,46),paddingPoison:padding?.record??null,hostUniformInjectionOnly:true}};
}
function upload(gl,program,binding,vector){
  const words=new Uint32Array(binding.record.uploadCount*4);words.set(vector.a,0);words.set(vector.c,172);if(binding.record.uploadCount===46)words.set(vector.b,180);
  gl.uniform4uiv(binding.location,words);const observedA=[...gl.getUniform(program,binding.location)];equal(observedA,vector.a,'actual raw A uniform words');
  let observedB=null;if(binding.record.uploadCount===46){const at45=gl.getUniformLocation(program,`${binding.uniformName}[45]`);require(at45!==null,'actual raw B high uniform');observedB=[...gl.getUniform(program,at45)];equal(observedB,vector.b,'actual raw B uniform words');}
  const at43=gl.getUniformLocation(program,`${binding.uniformName}[43]`);require(at43!==null,'actual raw C uniform');const observedC=[...gl.getUniform(program,at43)];equal(observedC,vector.c,'actual raw C uniform words');
  return {wordCount:words.length,words:[...words],observedA,observedB,observedC};
}
function select(gl,program,binding,value){const words=[value,value,value,value];gl.uniform4uiv(binding.selector,new Uint32Array(words));const observed=[...gl.getUniform(program,binding.selector)];equal(observed,words,'actual dynamic selector words');return {index:44,words,observed};}
function checkPadding(gl,program,binding){
  if(!binding.padding)return null;
  const observed=[...gl.getUniform(program,binding.padding.location)];equal(observed,binding.padding.record.words,'host-only padding survives actual draw');return observed;
}
function reset(gl){for(const cap of[gl.DITHER,gl.BLEND,gl.CULL_FACE,gl.DEPTH_TEST,gl.SCISSOR_TEST,gl.RASTERIZER_DISCARD])gl.disable(cap);gl.colorMask(true,true,true,true);}
function addTile(bytes,width,height,label){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);
  const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=canvas.toDataURL();image.alt=label;caption.textContent=label;figure.append(image,caption);document.querySelector('#draws').append(figure);
}
async function vertexProbe(gl,definition,vertex,fragment,vectors,report){
  const record={name:definition.name,oracle:definition.oracle,vertex:definition.vertex,fragment:'legacy-fragment',varyings:['gl_Position','vso_g0'],vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};
  report.vertexProbes.push(record);const {program,logs}=compile(gl,vertex,fragment,true);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attribute=attribute(gl,program,'in_0',[[0,0,0,1]],buffers);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    const binding=reflectConstants(gl,program,vertex,definition.name==='order'?47:46);record.uniformReflection=binding.record;record.feedbackReflection=[];
    equal(gl.getProgramParameter(program,gl.TRANSFORM_FEEDBACK_VARYINGS),2,'two float ABI feedback vec4s');
    for(let i=0;i<2;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[record.varyings[i],1,gl.FLOAT_VEC4],'actual finite float feedback ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
    for(const vector of vectors){
      const expected=expectedWords(definition.oracle,vector),result={name:vector.name,a:vector.a,b:vector.b,c:vector.c,expectedWords:expected,upload:upload(gl,program,binding,vector),captures:[],observedWords:[0,0,0,0]};record.vectors.push(result);
      const reconstructed=[0n,0n,0n,0n];
      for(const selector of[0,8,16,24]){
        const selectorUpload=select(gl,program,binding,selector);gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;
        const bytes=new Uint8Array(32);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'actual raw VS feedback readback');
        const observedBits=[...new Uint32Array(bytes.buffer)],expectedBytes=expected.map(word=>Number((BigInt(word)>>BigInt(selector))&255n));
        const expectedBits=[0,0,0,0x3f800000,...expectedBytes.map(byte=>0x3f000000+byte*32768)];
        const capture={selector,selectorUpload,expectedBytes,expectedBits,observedBits,rawBytes:[...bytes],bytesSha256:await digest(bytes),paddingAfterDraw:checkPadding(gl,program,binding)};result.captures.push(capture);
        if(JSON.stringify(observedBits)!==JSON.stringify(expectedBits))capture.failure={expectedBits,observedBits};
        equal(observedBits,expectedBits,`${definition.name}/${vector.name} independent vertex byte${selector/8}`);
        const decoded=observedBits.slice(4).map(word=>{require(word>=0x3f000000&&word<=0x3f7f8000&&(word-0x3f000000)%32768===0,'normal finite exact byte carrier');return(word-0x3f000000)/32768;});
        capture.decodedBytes=decoded;for(let i=0;i<4;i++)reconstructed[i]|=BigInt(decoded[i])<<BigInt(selector);
      }
      result.observedWords=reconstructed.map(Number);equal(result.observedWords,expected,`${definition.name}/${vector.name} independent all32 VS bits`);
    }
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
async function fragmentProbe(gl,definition,vertex,fragment,vectors,report){
  const record={name:definition.name,oracle:definition.oracle,vertex:'legacy-vertex',fragment:definition.fragment,width:1,height:1,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};
  report.fragmentProbes.push(record);const {program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),texture=texture2d(gl,1,1,null);
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attribute=attribute(gl,program,'in_0',[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],buffers);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    const binding=reflectConstants(gl,program,fragment,definition.name==='order'?47:46);record.uniformReflection=binding.record;gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'raw bitplane target');gl.viewport(0,0,1,1);reset(gl);
    for(const vector of vectors){
      const expected=expectedWords(definition.oracle,vector),result={name:vector.name,a:vector.a,b:vector.b,c:vector.c,expectedWords:expected,upload:upload(gl,program,binding,vector),draws:[],observedWords:[0,0,0,0]};record.vectors.push(result);
      const reconstructed=[0n,0n,0n,0n],tile=[];
      for(let selector=0;selector<32;selector++){
        const selectorUpload=select(gl,program,binding,selector);gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
        const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'actual FS bitplane readback');
        const expectedBytes=expected.map(word=>Number((BigInt(word)>>BigInt(selector))&1n)*255),observedBytes=[...bytes];const draw={selector,selectorUpload,expectedBytes,observedBytes,paddingAfterDraw:checkPadding(gl,program,binding)};result.draws.push(draw);tile.push(...observedBytes);
        if(JSON.stringify(observedBytes)!==JSON.stringify(expectedBytes))draw.failure={expectedBytes,observedBytes};equal(observedBytes,expectedBytes,`${definition.name}/${vector.name} independent fragment bit${selector}`);
        for(let i=0;i<4;i++)reconstructed[i]|=BigInt(observedBytes[i]/255)<<BigInt(selector);
      }
      result.observedWords=reconstructed.map(Number);equal(result.observedWords,expected,`${definition.name}/${vector.name} independent all32 FS bits`);
      result.bitPlaneBytesSha256=await digest(new Uint8Array(tile));if(vector.name==='nan-both')addTile(tile,32,1,`${definition.name}: all32 output bits for signed NaN payloads`);
    }
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteProgram(program);}
}

// These are the eight unchanged historical bodies, executed with independent
// literal carrier/pixel assertions. No historical negative fixture is rewritten.
async function migratedProbe(gl,bridge,entry,text,vectors,legacy,report){
 const result=bridge.translate({stage:entry.stage,text});require(result.ok,'migrated body compiles');equal(result.metadata.profile,entry.newProfile,'current migration profile');
 const vertex=entry.stage==='vertex'?result:legacy.vertex,fragment=entry.stage==='fragment'?result:legacy.fragment;
 const {program,logs}=compile(gl,vertex,fragment,entry.stage==='vertex'),buffers=[],vao=gl.createVertexArray();
 const record={...entry,textSha256:await digest(text),result,programLogs:logs,draws:[]};report.migratedProbes.push(record);
 let tf=null,output=null,framebuffer=null,texture=null,running=false;
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);attribute(gl,program,'in_0',entry.stage==='vertex'?[[0,0,0,1]]:[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],buffers);bindSystemBlocks(gl,program,vertex.metadata,buffers);reset(gl);
  const bankName=(entry.stage==='vertex'?'vs':'fs')+'const0',location=gl.getUniformLocation(program,bankName+'[0]');require(location!==null,'actual unchanged migration bank');
  if(entry.stage==='vertex'){tf=gl.createTransformFeedback();output=gl.createBuffer();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);}
  else{framebuffer=gl.createFramebuffer();texture=texture2d(gl,1,1,null);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'actual migration framebuffer');gl.viewport(0,0,1,1);}
  const opcode=entry.name.includes('FSEQ')?'FSEQ':'FSNE';
  for(const vector of vectors){
   const words=Array(184).fill(0);words.splice(0,4,...vector.a);words.splice(180,4,...vector.b);gl.uniform4uiv(location,new Uint32Array(words));
   const masks=interpret('IMM[0] UINT32 {'+vector.a+'}\nIMM[1] UINT32 {'+vector.b+'}\n'+opcode+' TEMP[0], IMM[0], IMM[1]\nEND\n',{},[]).registers.get('TEMP[0]');
   const trueCarrier=entry.group==='integerCases'?0x3f7f8000:0x3f7fffff,expectedBits=masks.map(word=>word===0?0x3f000000:trueCarrier);
   const draw={vector:vector.name,words,masks,expectedBits};record.draws.push(draw);
   if(entry.stage==='vertex'){gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(32);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);draw.observedBits=[...new Uint32Array(bytes.buffer)].slice(4);draw.rawBytes=[...bytes];equal(draw.observedBits,expectedBits,'unchanged migration exact vertex carriers');}
   else{gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);draw.observedBytes=[...bytes];draw.expectedBytes=masks.map(word=>word===0?128:255);equal(draw.observedBytes,draw.expectedBytes,'unchanged migration literal fragment pixels');}
   equal(gl.getError(),gl.NO_ERROR,'actual migration GPU readback');
  }
 }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(b=>gl.deleteBuffer(b));if(output)gl.deleteBuffer(output);if(tf)gl.deleteTransformFeedback(tf);if(framebuffer)gl.deleteFramebuffer(framebuffer);if(texture)gl.deleteTexture(texture);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}

export async function runAcceptance({fault=null,faultWasm=null}={}){
 const report={schema:'raw-equality-gpu-v1',status:'running',guestExecution:false,predecessorFullGateClaimed:false,fault,vertexProbes:[],fragmentProbes:[],migratedProbes:[],translations:[],objects:null};
 window.__virglRawEqualityReport=report;
 try{
  let module;const options={onRuntimeInitialized(){module=this;}};
  if(faultWasm){const response=await fetch(faultWasm);require(response.ok,'actual source-fault artifact');options.wasmBinary=new Uint8Array(await response.arrayBuffer());report.faultWasmSha256=await digest(options.wasmBinary);}
  const bridge=await createVirglShaderBridge(options);require(module.HEAPU8.byteLength===16777216,'fixed 16MiB shader memory');
  const file=await source('renderer/virgl-shader/tests/raw-equality-cases.json'),fixture=JSON.parse(file.text);report.fixture={path:file.path,bytes:file.bytes,sha256:file.sha256};
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const context=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(context instanceof WebGL2RenderingContext,'actual WebGL2');const debug=context.getExtension('WEBGL_debug_renderer_info');require(debug,'actual hardware identity');report.renderer={vendor:context.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:context.getParameter(debug.UNMASKED_RENDERER_WEBGL)};require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'actual hardware renderer');const gl=counted(context,report);
  const held=JSON.parse((await source('renderer/virgl-shader/tests/float-mask-hardware.json')).text),legacy={},legacyText={};for(const stage of ['vertex','fragment']){const input=held.shaders.find(e=>e.name==='legacy-'+stage);legacyText[stage]=input.text;legacy[stage]=bridge.translate({stage,text:input.text});require(legacy[stage].ok,'unchanged legacy partner');report.translations.push({name:input.name,stage,textSha256:await digest(input.text),result:legacy[stage]});}
  for(const kernel of fixture.kernels){const input=fixture.cases.find(e=>e.name===kernel.case),result=bridge.translate({stage:input.stage,text:input.text});require(result.ok,'authored kernel '+input.name);equal(result.metadata.profile,input.expected.profile,'literal obligations precede equality profile');report.translations.push({name:input.name,stage:input.stage,textSha256:await digest(input.text),result});probes.set(input.name,kernel.probeText);const pair=bridge.translatePair({vertexText:input.stage==='vertex'?input.text:legacyText.vertex,fragmentText:input.stage==='fragment'?input.text:legacyText.fragment});require(pair.ok,'actual checked linkage for '+input.name);report.translations.push({name:'gpu-'+input.name+'-pair',result:pair});
   const definition={name:kernel.name,oracle:input.name,vertex:input.name,fragment:input.name},vectors=kernel.vectorSet==='finite'?fixture.finiteVectors:fixture.vectors;
   if(input.stage==='vertex')await vertexProbe(gl,definition,pair.vertex,pair.fragment,vectors,report);else await fragmentProbe(gl,definition,pair.vertex,pair.fragment,vectors,report);
  }
  const migrationFile=await source('renderer/virgl-shader/tests/raw-equality-migrations.json'),manifest=JSON.parse(migrationFile.text);equal(manifest.entries.length,8,'closed eight migrations');report.migrationManifest={path:migrationFile.path,bytes:migrationFile.bytes,sha256:migrationFile.sha256};
  for(const entry of manifest.entries){const stem=entry.group==='integerCases'?'integer-mask':'float-mask',historical=JSON.parse((await source('renderer/virgl-shader/tests/'+stem+'-cases.json')).text),input=historical.find(e=>e.name===entry.name);require(input&&!input.ok,'original negative fixture unchanged');equal(await digest(input.text),entry.inputSha256,'exact migrated historical body');await migratedProbe(gl,bridge,entry,input.text,fixture.vectors,legacy,report);}
  equal(report.objects.live,0,'release every real GPU object');equal(Object.entries(report.objects.created).sort(),Object.entries(report.objects.deleted).sort(),'balanced GPU ownership');report.checkedWords=report.vertexProbes.reduce((n,p)=>n+p.vectors.length*4,0)+report.fragmentProbes.reduce((n,p)=>n+p.vectors.length*4,0);report.status='passed';document.querySelector('#status').textContent=report.checkedWords+' exact GPU words · raw float equality';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
 }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
