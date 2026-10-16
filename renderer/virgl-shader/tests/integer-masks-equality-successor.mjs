// E6-T12e4a: direct compiler/host-uniform proof. The guest constant wire is unchanged.
import { createVirglShaderBridge, LIMITS } from '../index.mjs';
import { ORIGINAL_INPUTS } from './components.mjs';
import { digest, texture2d, bindSystemBlocks } from './browser.mjs';
const require=(condition,label)=>{if(!condition)throw new Error(label);};
const equal=(actual,expected,label)=>require(JSON.stringify(actual)===JSON.stringify(expected),`${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
const accepted=(result,label)=>{require(result?.ok===true,`${label}: ${JSON.stringify(result)}`);return result;};
const RAW='virgl-webgl2-raw-bits-v2',LEGACY='virgl-webgl2-straight-line-v5';
const U32=value=>BigInt.asUintN(32,value),MASK=0xffffffffn;
// Mathematical signed conversion is intentionally independent of the compiler's
// XOR sign-bit lowering. No oracle consumes generated GLSL or driver results.
const signed=value=>value>=0x80000000n?value-0x100000000n:value;
export function reference(name,a,b,c){
  const A=a.map(BigInt),B=b.map(BigInt),C=c.map(BigInt);let result;
  switch(name){
    case 'uadd':case 'maximal':result=A.map((x,i)=>U32(x+B[i]));break;
    case 'isge':result=A.map((x,i)=>signed(x)>=signed(B[i])?MASK:0n);break;
    case 'useq':result=A.map((x,i)=>x===B[i]?MASK:0n);break;
    case 'usne':result=A.map((x,i)=>x!==B[i]?MASK:0n);break;
    case 'ucmp':case 'order':result=A.map((x,i)=>x!==0n?B[i]:C[i]);break;
    case 'alias-condition':result=[A[1]!==0n?B[3]:C[2],A[0]!==0n?B[2]:C[3],A[3]!==0n?B[0]:C[1],U32(A[3]+B[3])];break;
    case 'alias-true':result=[A[1]!==0n?B[1]:C[3],A[0]!==0n?B[0]:C[2],A[3]!==0n?B[3]:C[0],B[3]];break;
    case 'alias-false':result=[A[1]!==0n?B[3]:C[1],A[0]!==0n?B[2]:C[0],C[2],A[2]!==0n?B[1]:C[2]];break;
    case 'masked-sentinel':result=[U32(B[1]+A[3]),U32(B[0]+A[2]),signed(A[2])>=signed(B[2])?MASK:0n,A[0]!==0n?C[3]:C[2]];break;
    default:throw new Error(`unknown independent oracle ${name}`);
  }
  return result.map(x=>Number(U32(x)));
}
// Hand-derived results for the fixture's edges vector, not computed by the
// compiler or generated from the reference implementation.
const LITERAL_WITNESSES={
  uadd:[0xffffffff,0,0x80000000,0x7fffffff],
  isge:[0xffffffff,0xffffffff,0xffffffff,0],
  useq:[0,0,0,0],usne:[0xffffffff,0xffffffff,0xffffffff,0xffffffff],
  ucmp:[0x7fc00001,0xffffffff,1,0xffffffff],
  'alias-condition':[0xffffffff,0x80000000,0xffffffff,0x7fffffff],
  'alias-true':[0xffffffff,1,0xffffffff,0xffffffff],
  'alias-false':[0xffffffff,0x7fc00001,1,0xffffffff],
  'masked-sentinel':[0x7fffffff,0x7ffffffe,0xffffffff,1],
  maximal:[0xffffffff,0,0x80000000,0x7fffffff],
  order:[0x7fc00001,0xffffffff,1,0xffffffff],
};
function expectedWords(name,vector){
  const result=reference(name,vector.a,vector.b,vector.c);
  if(vector.name==='edges'){equal(result,LITERAL_WITNESSES[name],'independent reference literal witness');return LITERAL_WITNESSES[name];}
  return result;
}
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
      result.bitPlaneBytesSha256=await digest(new Uint8Array(tile));if(vector.name==='nan-inf')addTile(tile,32,1,`${definition.name}: all32 bits of NaN/Inf payloads`);
    }
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteProgram(program);}
}
async function orientationProbe(gl,vertex,fragment,vector,report){
  const record={vertex:'raw-uadd-vertex',fragment:'legacy-fragment',vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),varyings:['gl_Position','vso_g0'],captures:[]};report.orientation=record;
  const {program,logs}=compile(gl,vertex,fragment,true);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attribute=attribute(gl,program,'in_0',[[.25,.5,-.25,1]],buffers);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    equal(record.uniformBlocks.length,1,'one orientation system block');equal(record.uniformBlocks[0].byteLength,656,'actual orientation block size');equal(record.uniformBlocks[0].members[0].offset,640,'actual orientation member offset');
    const system=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,0);require(buffers.includes(system),'orientation updates owned actual bound UBO');
    const binding=reflectConstants(gl,program,vertex,46);record.uniformReflection=binding.record;record.vector=vector;record.upload=upload(gl,program,binding,vector);record.selectorUpload=select(gl,program,binding,0);
    record.feedbackReflection=[];for(let i=0;i<2;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[record.varyings[i],1,gl.FLOAT_VEC4],'orientation float feedback ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
    for(const adjust of[-1,1]){
      gl.bindBuffer(gl.UNIFORM_BUFFER,system);const written=new Float32Array([adjust]);gl.bufferSubData(gl.UNIFORM_BUFFER,640,written);const actual=new Uint8Array(4);gl.getBufferSubData(gl.UNIFORM_BUFFER,640,actual);const expectedUniformBits=adjust<0?0xbf800000:0x3f800000;equal([...new Uint32Array(actual.buffer)],[expectedUniformBits],'actual winsys UBO update');
      gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(32);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'orientation actual feedback');
      const carrierBytes=reference('uadd',vector.a,vector.b,vector.c).map(word=>Number(BigInt(word)&255n)),expectedBits=[0x3e800000,adjust<0?0xbf000000:0x3f000000,0xbe800000,0x3f800000,...carrierBytes.map(byte=>0x3f000000+byte*32768)],observedBits=[...new Uint32Array(bytes.buffer)];
      const capture={adjust,uniformUpdate:{offset:640,expectedBits:[expectedUniformBits],observedBits:[...new Uint32Array(actual.buffer)]},expectedBits,observedBits,rawBytes:[...bytes],bytesSha256:await digest(bytes)};record.captures.push(capture);equal(observedBits,expectedBits,'independent nonzero-y coordinate-system adjustment');
    }
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
function finiteUniform(gl,program,result){
  equal(result.metadata.uniforms.length,1,'finite selection one constant bank');const uniform=result.metadata.uniforms[0];
  equal([uniform.type,uniform.encoding,uniform.count],['uvec4[]','float32-bits',1],'finite condition raw constant ABI');
  const name=`${uniform.name}[0]`,index=gl.getUniformIndices(program,[name])[0],location=gl.getUniformLocation(program,name);
  require(index!==gl.INVALID_INDEX&&location!==null,'actual finite condition uniform');
  const activeCount=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0],type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0];
  equal([activeCount,type],[1,gl.UNSIGNED_INT_VEC4],'actual finite condition reflection');return {location,record:{name,index,declaredCount:1,activeCount,type}};
}
function finiteUpload(gl,program,binding,vector){
  gl.uniform4uiv(binding.location,new Uint32Array(vector.a));const observed=[...gl.getUniform(program,binding.location)];equal(observed,vector.a,'actual finite condition words');return {words:vector.a,observed};
}
async function finiteSelections(gl,anchors,vectors,report){
  report.finiteSelections={};
  for(const stage of ['vertex','fragment']){
    const vertex=anchors.get(stage==='vertex'?'finite-vertex':'legacy-vertex').result,fragment=anchors.get(stage==='fragment'?'finite-fragment':'legacy-fragment').result;
    const record={stage,vertex:stage==='vertex'?'finite-vertex':'legacy-vertex',fragment:stage==='fragment'?'finite-fragment':'legacy-fragment',vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),...(stage==='vertex'?{captures:[]}:{draws:[]})};report.finiteSelections[stage]=record;
    const {program,logs}=compile(gl,vertex,fragment,stage==='vertex');record.programLogs=logs;
    const buffers=[],vao=gl.createVertexArray();let feedback=null,output=null,framebuffer=null,texture=null,running=false;
    try{
      gl.useProgram(program);gl.bindVertexArray(vao);record.attribute=attribute(gl,program,'in_0',stage==='vertex'?[[0,0,0,1]]:[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],buffers);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
      const binding=finiteUniform(gl,program,stage==='vertex'?vertex:fragment);record.uniformReflection=binding.record;reset(gl);
      if(stage==='vertex'){
        feedback=gl.createTransformFeedback();output=gl.createBuffer();record.feedbackReflection=[];
        equal(gl.getProgramParameter(program,gl.TRANSFORM_FEEDBACK_VARYINGS),2,'finite selection two float feedback vec4s');
        for(let i=0;i<2;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[['gl_Position','vso_g0'][i],1,gl.FLOAT_VEC4],'finite float ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);
      }else{
        framebuffer=gl.createFramebuffer();texture=texture2d(gl,1,1,null);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'finite target complete');gl.viewport(0,0,1,1);
      }
      for(const vector of vectors){
        const entry={name:vector.name,condition:vector.a,upload:finiteUpload(gl,program,binding,vector)};
        if(stage==='vertex'){
          gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(32);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);
          entry.expectedBits=[0,0,0,0x3f800000,...vector.a.map(word=>word===0?0:0x3f800000)];entry.observedBits=[...new Uint32Array(bytes.buffer)];entry.rawBytes=[...bytes];entry.bytesSha256=await digest(bytes);record.captures.push(entry);equal(entry.observedBits,entry.expectedBits,'UCMP direct finite VS0/1 selection');
        }else{
          gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
          entry.expectedBytes=vector.a.map(word=>word===0?0:255);entry.observedBytes=[...bytes];entry.bytesSha256=await digest(bytes);record.draws.push(entry);equal(entry.observedBytes,entry.expectedBytes,'UCMP direct finite FS0/1 selection');
        }
        equal(gl.getError(),gl.NO_ERROR,'finite output actual hardware readback');
      }
    }finally{
      if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteVertexArray(vao);gl.deleteProgram(program);
    }
  }
}
const PAIR_SAMPLES=[[4,4,36,36],[12,4,100,36],[20,4,163,36],[4,12,36,100],[12,12,100,100],[4,20,36,163],[8,8,68,68]];
async function pairPixels(gl,definition,result,report){
  const mode=definition.name.endsWith('flat')?'flat':'smooth',record={name:definition.name,mode,interfaceKey:result.interfaceKey,checks:[],vertexGlslSha256:await digest(result.vertex.glsl),fragmentGlslSha256:await digest(result.fragment.glsl)};
  report.pairDraws.push(record);const {program,logs}=compile(gl,result.vertex,result.fragment);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),texture=texture2d(gl,32,32,null);
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attributes=[attribute(gl,program,'in_0',[[-1,-1,0,1],[1,-1,0,1],[-1,1,0,1]],buffers),attribute(gl,program,'in_1',[[0,0,0,1],[1,0,0,1],[0,1,0,1]],buffers)];record.uniformBlocks=bindSystemBlocks(gl,program,result.vertex.metadata,buffers);
    record.inactiveUniforms=[];
    for(const translated of [result.vertex,result.fragment])equal(translated.metadata.uniforms,[],'interface fixtures have no constant bank');
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'mixed backend framebuffer');gl.viewport(0,0,32,32);reset(gl);gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
    const bytes=new Uint8Array(4096);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'mixed backend actual pixel readback');record.rawBytes=[...bytes];record.bytesSha256=await digest(bytes);
    for(const[x,y,r,g]of PAIR_SAMPLES){const expected=mode==='flat'?[0,255,0,255]:[r,g,0,255],observed=[...bytes.subarray((y*32+x)*4,(y*32+x)*4+4)];record.checks.push({pixel:[x,y],expected,observed});equal(observed,expected,`${definition.name} independent interpolation (${x},${y})`);}
    for(const[x,y]of[[28,28],[28,12],[12,28]]){const expected=[0,0,255,255],observed=[...bytes.subarray((y*32+x)*4,(y*32+x)*4+4)];record.checks.push({pixel:[x,y],expected,observed});equal(observed,expected,'outside mixed triangle');}
    addTile(bytes,32,32,`${definition.name}: derived interface`);
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteProgram(program);}
}
async function sabotageOperation(result,mode,report){
  const definitions={
    'signed-compare':{expression:/\(vsconst0\[(0|45)\]\.([xyzw]) \^ 2147483648u\)/g,replacement:'vsconst0[$1].$2',matches:8,meaning:'Remove both sign-bit transforms in exactly four dynamic ISGE comparisons.'},
    'all-ones-mask':{expression:/(vsconst0\[0\]\.[xyzw] == vsconst0\[45\]\.[xyzw] \? )4294967295u/g,replacement:'$11u',matches:4,meaning:'Replace only the four dynamic USEQ true masks by integer one.'},
    'ucmp-selection':{expression:/vsconst0\[0\]\.([xyzw]) != 0u \? vsconst0\[45\]\.([xyzw]) : vsconst0\[43\]\.([xyzw])/g,replacement:'vsconst0[0].$1 == 1u ? vsconst0[45].$2 : vsconst0[43].$3',matches:4,meaning:'Narrow only the four dynamic UCMP conditions to raw integer one.'},
  };
  const definition=definitions[mode],matches=[...result.glsl.matchAll(definition.expression)];equal(matches.length,definition.matches,'exact source-bound opcode omissions');
  const glsl=mode==='all-ones-mask'?result.glsl.replace(definition.expression,(_match,prefix)=>`${prefix}1u`):result.glsl.replace(definition.expression,definition.replacement);
  report.omissions.push({mode,originalExpression:definition.expression.source,replacement:definition.replacement,matches:matches.length,originalGlsl:result.glsl,servedGlsl:glsl,originalGlslSha256:await digest(result.glsl),servedGlslSha256:await digest(glsl),meaning:definition.meaning+' Byte and bitplane encoders, TGSI, full translation results and metadata remain unchanged.'});
  return {...result,glsl};
}
export async function runAcceptance({sabotage=null}={}){
  require(sabotage===null||['signed-compare','all-ones-mask','ucmp-selection'].includes(sabotage),'known integer-mask sabotage');
  const report={status:'running',guestExecution:false,productionVirgl:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true,sabotage,limits:LIMITS,corpus:[],cases:[],anchors:[],pairs:[],vertexProbes:[],fragmentProbes:[],pairDraws:[],omissions:[]};window.__virglIntegerMasksReport=report;
  try{
    equal(LIMITS,{textBytes:16384,tokens:8192,glslBytes:65536,instructions:179,registerIndex:7,temporaryRegisterIndex:117,constantRegisterIndex:45},'unchanged fixed frontend limits');
    let module;const bridge=await createVirglShaderBridge({onRuntimeInitialized(){module=this;}});require(module?.HEAPU8,'observe actual Wasm memory');const memory=module.HEAPU8.buffer;
    report.memory={initialBytes:memory.byteLength,observations:0,bufferIdentityStable:true};equal(memory.byteLength,16777216,'fixed16MiB');
    report.measuredOutputMaxima={singleJSON:0,pairJSON:0,glsl:0};
    const observe=(result)=>{require(module.HEAPU8.buffer===memory,'Wasm buffer identity');equal(module.HEAPU8.byteLength,16777216,'no memory growth');report.memory.observations++;
      const pair=result.ok&&Object.hasOwn(result,'vertex'),bytes=new TextEncoder().encode(JSON.stringify(result)).length;
      require(bytes<(pair?295936:147456),'fixed response capacity');const kind=pair?'pairJSON':'singleJSON';report.measuredOutputMaxima[kind]=Math.max(report.measuredOutputMaxima[kind],bytes);
      for(const stage of result.ok?(pair?[result.vertex,result.fragment]:[result]):[]){const size=new TextEncoder().encode(stage.glsl).length;require(size<=65536,'fixed GLSL capacity');report.measuredOutputMaxima.glsl=Math.max(report.measuredOutputMaxima.glsl,size);}
      return result;};
    const translate=input=>observe(bridge.translate(input)),translatePair=input=>observe(bridge.translatePair(input));
    for(const input of ORIGINAL_INPUTS){const original=await source(input.path,input.sha256,input.size),result=translate({stage:input.stage,text:original.text});equal(result.ok,!original.text.includes('PRECISE'),'unchanged original outcome');if(result.ok)equal(result.metadata.profile,LEGACY,'unchanged original backend');else equal(result.error.code,'unsupported-feature','unchanged PRECISE rejection');report.corpus.push({path:input.path,sha256:input.sha256,bytes:original.bytes,stage:input.stage,result});}
    equal(report.corpus.filter(entry=>entry.result.ok).length,12,'unchanged12/19 acceptance');
    const hardware=await source('renderer/virgl-shader/tests/integer-mask-hardware.json'),fixture=JSON.parse(hardware.text);equal(fixture.schema,'wasm-vm-integer-mask-hardware-v1','shared hardware schema');report.hardwareFixture={path:hardware.path,sha256:hardware.sha256,bytes:hardware.bytes};report.literalWitnesses={...fixture.vectors.find(value=>value.name==='edges'),expected:LITERAL_WITNESSES};report.operationDefinitions=fixture.operationDefinitions;
    const anchors=new Map();
    for(const input of fixture.shaders){const request={stage:input.stage,text:input.text},result=accepted(translate(request),input.name);equal(result.metadata.profile,input.profile,'fixture-specific backend');const retained=JSON.stringify(result);request.text='invalid after conversion';request.stage='geometry';equal(JSON.stringify(result),retained,'single request ownership');
      const record={...input,inputSha256:await digest(input.text),result};report.anchors.push(record);anchors.set(input.name,record);}
    const pairs=new Map();
    for(const definition of fixture.pairs){const vertex=anchors.get(definition.vertex),fragment=anchors.get(definition.fragment);require(vertex&&fragment,'owned exact pair sources');const request={vertexText:vertex.text,fragmentText:fragment.text};const result=accepted(translatePair(request),definition.name);equal(result.interfaceKey,definition.interfaceKey,'derived literal pair key');equal(result.fragment,{glsl:fragment.result.glsl,metadata:fragment.result.metadata},'pair FS exactly standalone');equal(result.vertex.metadata.profile,vertex.profile,'pair VS backend');const retained=JSON.stringify(result);request.vertexText='mutated';request.fragmentText='mutated';equal(JSON.stringify(result),retained,'pair request ownership');const record={...definition,vertexSha256:vertex.inputSha256,fragmentSha256:fragment.inputSha256,result};report.pairs.push(record);pairs.set(definition.name,record);}
    const authored=await source('renderer/virgl-shader/tests/integer-mask-cases.json'),cases=JSON.parse(authored.text);require(Array.isArray(cases)&&cases.length>0&&cases.length<=1024,'bounded shared authored cases');report.caseFixture={path:authored.path,sha256:authored.sha256,bytes:authored.bytes};
    const migrationSource=await source('renderer/virgl-shader/tests/raw-equality-migrations.json'),migrations=JSON.parse(migrationSource.text);
    equal(migrations.schema,'raw-equality-eight-migrations-v1','closed successor migrations');
    const selected=migrations.entries.filter(entry=>entry.group==='integerCases');equal(selected.length,4,'exact four successor leaf migrations');
    report.expectationMigrations={fixture:{path:migrationSource.path,bytes:migrationSource.bytes,sha256:migrationSource.sha256},entries:[],predecessorFullGateClaimed:false};
    for(const entry of selected){const test=cases.find(value=>value.name===entry.name);require(test,'unchanged historical body');equal(test.ok,false,'historical expected rejection');equal(await digest(test.text),entry.inputSha256,'explicit unchanged migrated body');equal(test.stage,entry.stage,'migration stage');report.expectationMigrations.entries.push(entry);}
    const currentCases=cases.map(test=>selected.some(entry=>entry.name===test.name)?{...test,ok:true,expected:{profile:'virgl-webgl2-raw-bits-v13',constantCount:46}}:test);
    report.recovery={singleConversions:0,pairConversions:0};
    for(const test of currentCases){const result=translate({stage:test.stage,text:test.text});equal(result.ok,test.ok,`${test.name} authored outcome`);if(test.expected?.errorCode!==undefined)equal(result.error?.code,test.expected.errorCode,`${test.name} authored error`);if(test.expected?.constantCount!==undefined)equal(result.metadata?.uniforms[0]?.count,test.expected.constantCount,`${test.name} declared constant extent`);if((test.profile??test.expected?.profile)!==undefined)equal(result.metadata?.profile,test.profile??test.expected.profile,`${test.name} authored profile`);report.cases.push({name:test.name,stage:test.stage,inputSha256:await digest(test.text),ok:test.ok,...(test.expected?{expected:test.expected}:{}),result});
      for(const name of fixture.recoverySingles){const input=anchors.get(name);equal(translate({stage:input.stage,text:input.text}),input.result,'native-shared single recovery');report.recovery.singleConversions++;}
      for(const name of fixture.recoveryPairs){const input=pairs.get(name);equal(translatePair({vertexText:anchors.get(input.vertex).text,fragmentText:anchors.get(input.fragment).text}),input.result,'native-shared pair recovery');report.recovery.pairConversions++;}}
    report.rejectionPairs=[];
    for(const stage of ['vertex','fragment'])for(const code of ['parse-error','unsupported-feature']){
      const invalid=cases.find(test=>test.stage===stage&&!test.ok&&JSON.stringify(test.expected)===JSON.stringify({errorCode:code}));require(invalid,`native-shared ${stage}/${code} pair anchor`);
      const vertex=stage==='vertex'?invalid:anchors.get('raw-vertex'),fragment=stage==='fragment'?invalid:anchors.get('raw-fragment');
      const result=translatePair({vertexText:vertex.text,fragmentText:fragment.text});equal(result.ok,false,'invalid owned pair fails');equal(result.error.code,code,'exact rejected pair classification');
      report.rejectionPairs.push({name:`rejected-${stage}-${code}-pair`,vertex:vertex.name,fragment:fragment.name,ok:false,expected:{errorCode:code},vertexSha256:await digest(vertex.text),fragmentSha256:await digest(fragment.text),result});
      for(const name of fixture.recoveryPairs){const input=pairs.get(name);equal(translatePair({vertexText:anchors.get(input.vertex).text,fragmentText:anchors.get(input.fragment).text}),input.result,'rejected pair mixed-backend recovery');}
    }
    const maxV=anchors.get('raw-maximal-vertex'),maxF=anchors.get('raw-maximal-fragment'),stressInput={vertexText:maxV.text+'\n'.repeat(16384-maxV.text.length),fragmentText:maxF.text+'\n'.repeat(16384-maxF.text.length)},stressResult=accepted(translatePair(stressInput),'maximal pair');equal(stressResult,pairs.get('maximal-raw-pair').result,'native-shared exact maximal pair');
    equal(maxV.instructions,179,'maximal vertex179');equal(maxF.instructions,179,'maximal fragment179');report.stress={iterations:32,nonEndInstructionsPerStage:179,vertexBytes:stressInput.vertexText.length,fragmentBytes:stressInput.fragmentText.length,vertexSha256:await digest(stressInput.vertexText),fragmentSha256:await digest(stressInput.fragmentText),result:stressResult};
    for(let i=0;i<32;i++)equal(translatePair(stressInput),stressResult,'bounded maximal memory recovery');report.allocationPressure={scope:'Recorded in the current raw-equality Wasm successor, which covers all14 profiles; this retained GPU leaf does not repeat historical heap partition assumptions.'};report.memory.finalBytes=module.HEAPU8.byteLength;
    const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const context=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(context instanceof WebGL2RenderingContext,'actual WebGL2');const debug=context.getExtension('WEBGL_debug_renderer_info');require(debug,'hardware identity');report.renderer={vendor:context.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:context.getParameter(debug.UNMASKED_RENDERER_WEBGL)};require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'hardware driver');const gl=counted(context,report);
    await orientationProbe(gl,anchors.get('raw-uadd-vertex').result,anchors.get('legacy-fragment').result,fixture.vectors.find(value=>value.name==='edges'),report);
    await finiteSelections(gl,anchors,fixture.vectors,report);
    for(const definition of fixture.probes){const vectors=definition.vectors.map(name=>{const vector=fixture.vectors.find(value=>value.name===name);require(vector,'literal vector exists');return vector;});let vertex=anchors.get(definition.vertex).result;if(sabotage&&definition.name===({'signed-compare':'isge','all-ones-mask':'useq','ucmp-selection':'ucmp'}[sabotage]))vertex=await sabotageOperation(vertex,sabotage,report);
      await vertexProbe(gl,definition,vertex,anchors.get('legacy-fragment').result,vectors,report);await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.fragment).result,vectors,report);}
    for(const definition of fixture.pairs.filter(value=>value.name.endsWith('-smooth')||value.name.endsWith('-flat')))await pairPixels(gl,definition,pairs.get(definition.name).result,report);
    equal(report.objects.live,0,'every native GL object released');equal(Object.entries(report.objects.created).sort(),Object.entries(report.objects.deleted).sort(),'all GL ownership balanced');equal(report.omissions,[],'sabotage cannot pass');
    report.checkedWords=report.vertexProbes.reduce((sum,value)=>sum+value.vectors.length*4,0)+report.fragmentProbes.reduce((sum,value)=>sum+value.vectors.length*4,0);equal(report.checkedWords,704,'352 exactu32 words per stage');
    report.status='passed';document.querySelector('#status').textContent='704 exact raw words · five integer operations · both stages · safe finite selection · mixed float interfaces';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
