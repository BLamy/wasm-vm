// E6-T12e4c2: direct compiler/host-uniform proof. The guest constant wire is unchanged.
import { createVirglShaderBridge, LIMITS } from '../index.mjs';
import { ORIGINAL_INPUTS } from './components.mjs';
import { digest, texture2d, bindSystemBlocks } from './browser.mjs';
const require=(condition,label)=>{if(!condition)throw new Error(label);};
const equal=(actual,expected,label)=>require(JSON.stringify(actual)===JSON.stringify(expected),`${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
const accepted=(result,label)=>{require(result?.ok===true,`${label}: ${JSON.stringify(result)}`);return result;};
const LEGACY='virgl-webgl2-straight-line-v5';
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
function compile(gl,vertex,fragment,varyings=null){
  const shaders=[],program=gl.createProgram(),logs={};
  try{
    for(const [stage,result,kind]of[['vertex',vertex,gl.VERTEX_SHADER],['fragment',fragment,gl.FRAGMENT_SHADER]]){
      const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,result.glsl);gl.compileShader(shader);logs[stage]=gl.getShaderInfoLog(shader);
      require(gl.getShaderParameter(shader,gl.COMPILE_STATUS),`${stage} actual compile: ${logs[stage]}`);gl.attachShader(program,shader);
    }
    if(varyings)gl.transformFeedbackVaryings(program,varyings,gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);logs.link=gl.getProgramInfoLog(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),`actual link: ${logs.link}`);
    return {program,logs};
  }catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
}
function attribute(gl,program,name,values,buffers){
  const location=gl.getAttribLocation(program,name);if(location<0)return {name,location,active:false,values};const buffer=gl.createBuffer();buffers.push(buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values.flat()),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);
  const bytes=new Uint8Array(values.flat().length*4);gl.getBufferSubData(gl.ARRAY_BUFFER,0,bytes);const uploadedWords=[...new Uint32Array(bytes.buffer)];equal(uploadedWords,values.flat().map(value=>encodeScaled(scale(value))),`actual ${name} attribute bytes`);return {name,location,active:true,values,uploadedWords};
}
function reset(gl){for(const cap of[gl.DITHER,gl.BLEND,gl.CULL_FACE,gl.DEPTH_TEST,gl.SCISSOR_TEST,gl.RASTERIZER_DISCARD])gl.disable(cap);gl.colorMask(true,true,true,true);}
function addTile(bytes,width,height,label){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);
  const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=canvas.toDataURL();image.alt=label;caption.textContent=label;figure.append(image,caption);document.querySelector('#draws').append(figure);
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
function pressureProof(module,translate,translatePair,anchors,pairs,fixture,report){
  report.allocationPressure={chunkBytes:4096,releaseSchedule:[0,1,4,8,12,16,24,32,40,48,64],ownedAllocations:[{name:'raw IR',bytes:26232},{name:'raw GLSL',bytes:65537}],targets:[],failureMessages:[]};
  const failureMessages=new Set();
  const capacity=()=>{const pointers=[];let exhausted=false;try{for(let i=0;i<4096;i++){const pointer=module._malloc(4096);if(!pointer){exhausted=true;break;}pointers.push(pointer);}require(exhausted,'bounded capacity measurement');return {chunkBytes:4096,availableChunks:pointers.length,availableRequestedBytes:pointers.length*4096};}finally{for(const pointer of pointers)module._free(pointer);}};
  for(const name of ['raw-vertex','raw-fragment','recovery-raw-pair']){
    const paired=name.endsWith('-pair'),input=paired?pairs.get(name):anchors.get(name),baseline=input.result;
    const request=paired?{vertexText:anchors.get(input.vertex).text,fragmentText:anchors.get(input.fragment).text}:{stage:input.stage,text:input.text};
    const record={name,kind:paired?'pair':'single',heapBefore:module.HEAPU8.byteLength,reservedChunks:0,reservedRequestedBytes:0,releasedChunks:0,releasedRequestedBytes:0,attempts:[],recoveryPairs:[]};report.allocationPressure.targets.push(record);
    record.capacityBefore=capacity();const held=[];let exhausted=false,released=0,succeeded=false;
    try{
      for(let index=0;index<4096;index++){const pointer=module._malloc(4096);if(!pointer){exhausted=true;break;}held.push(pointer);}
      require(exhausted,'bounded fixed-heap exhaustion');record.reservedChunks=held.length;record.reservedRequestedBytes=held.length*4096;require(held.length>64,'actual heap pressure reserves more than last release');
      for(const release of report.allocationPressure.releaseSchedule){
        while(released<release){module._free(held.pop());released++;}
        const capacityBefore=capacity(),result=paired?translatePair(request):translate(request),capacityAfter=capacity();const attempt={releasedChunks:released,releasedRequestedBytes:released*4096,heldChunks:held.length,capacityBefore,capacityAfter,result};record.attempts.push(attempt);equal(capacityAfter,capacityBefore,'every attempt releases both owned allocation classes at4KiB granularity');
        if(result.ok){equal(result,baseline,'bounded allocation-pressure success');succeeded=true;break;}
        require((result.error.code==='allocation-failed'&&result.error.message==='Wasm input allocation failed.')||(result.error.code==='translation-error'&&['Raw IR allocation failed.','Raw GLSL allocation or output bound failed.'].includes(result.error.message)),'only actual owned allocation failures under pressure');
        failureMessages.add(result.error.message);
      }
      require(succeeded,'bounded allocation-pressure release reaches success');require(record.attempts.some(value=>!value.result.ok),'pressure really fails conversion');
    }finally{record.releasedChunks=released+held.length;record.releasedRequestedBytes=record.releasedChunks*4096;for(const pointer of held)module._free(pointer);}
    equal(record.releasedChunks,record.reservedChunks,'all host pressure allocations released');record.recoveredResult=paired?translatePair(request):translate(request);equal(record.recoveredResult,baseline,'exact owned conversion recovery after releasing pressure');
    for(const pairName of fixture.recoveryPairs){const pair=pairs.get(pairName),result=translatePair({vertexText:anchors.get(pair.vertex).text,fragmentText:anchors.get(pair.fragment).text});equal(result,pair.result,'both mixed backends recover after actual OOM');record.recoveryPairs.push({name:pairName,result});}
    record.heapAfter=module.HEAPU8.byteLength;record.capacityAfter=capacity();equal(record.capacityAfter,record.capacityBefore,'full malloc capacity restored after actual OOM and mixed recovery');equal(record.heapAfter,record.heapBefore,'heap never grows during actual OOM');
  }
  report.allocationPressure.failureMessages=[...failureMessages].sort();require(failureMessages.has('Raw IR allocation failed.'),'actual first owned allocation failure executed');require(failureMessages.has('Raw GLSL allocation or output bound failed.'),'actual second owned allocation failure executed');
}

// Exact dyadic oracle: every authored arithmetic result is integral at scale2^24.
// No generated GLSL, float bitcast or driver readback participates in this oracle.
const SCALE=1n<<24n;
const scale=value=>{const n=value*16777216;require(Number.isSafeInteger(n),'authored exact dyadic input');return BigInt(n);};
const fraction=(n,d=1n)=>SCALE*n/d;
export function encodeScaled(n){
  if(n===0n)return 0;
  const sign=n<0n?0x80000000:0;if(n<0n)n=-n;
  const length=n.toString(2).length,exponent=length-1-24,shift=length-24;
  require(exponent>=-126&&exponent<=127,'normal exact dyadic oracle domain');
  let significand;if(shift>0){require(n% (1n<<BigInt(shift))===0n,'exactly representable oracle');significand=n>>BigInt(shift);}else significand=n<<BigInt(-shift);
  return sign+(exponent+127)*8388608+Number(significand-(1n<<23n));
}
export function reference(name,vector){
  const A=vector.a.map(scale),B=vector.b.map(scale),condition=vector.condition;let values;
  switch(name){
    case 'chain':case 'maximal':values=A.map(x=>x+fraction(3n,8n));break;
    case 'mov-snapshot':values=[...A].reverse().map(x=>x+fraction(3n,8n));break;
    case 'mov-alias':{const z=(A[3]+fraction(1n,4n))/2n;values=[A[1]+fraction(1n,4n),A[0]+fraction(1n,4n),z,z+fraction(1n,8n)];break;}
    case 'ucmp-before':values=A.map((x,i)=>(condition[i]!==0?x:B[i])+fraction(1n,8n));break;
    case 'ucmp-alias-true':values=[condition[1]!==0?A[1]+fraction(1n,4n):B[3]/2n,condition[0]!==0?A[0]+fraction(1n,4n):B[2]/2n,A[2]+fraction(1n,4n),A[3]+fraction(1n,4n)].map(x=>x+fraction(1n,8n));break;
    case 'ucmp-alias-false':values=[condition[1]!==0?B[3]/2n:A[1]+fraction(1n,4n),condition[0]!==0?B[2]/2n:A[0]+fraction(1n,4n),A[2]+fraction(1n,4n),A[3]+fraction(1n,4n)].map(x=>x+fraction(1n,8n));break;
    case 'safe-raw':values=vector.raw.map(word=>SCALE+2n*(BigInt(word)&0x7fffffn));break;
    case 'invalidation':values=Array(4).fill(fraction(7n,8n));break;
    default:throw new Error(`unknown numeric oracle ${name}`);
  }
  return oracleRecord(values);
}
function oracleRecord(values){return {scale:16777216,scaled:values.map(String),values:values.map(n=>Number(n)/16777216),words:values.map(encodeScaled),doubledWords:values.map(n=>encodeScaled(n*2n))};}
const LITERAL_FIRST={chain:[0x3f000000,0x3f400000,0x3f800000,0x3fa00000],'mov-snapshot':[0x3fa00000,0x3f800000,0x3f400000,0x3f000000],'mov-alias':[0x3f200000,0x3ec00000,0x3f100000,0x3f300000],'ucmp-before':[0x3fd00000,0x3f000000,0x3f400000,0x3f800000],'ucmp-alias-true':[0x3f400000,0x3f200000,0x3f800000,0x3fa00000],'ucmp-alias-false':[0x3f000000,0x3f000000,0x3f800000,0x3fa00000],'safe-raw':[0x3f800000,0x3fc00001,0x3f800000,0x3fffffff],invalidation:[0x3f600000,0x3f600000,0x3f600000,0x3f600000],maximal:[0x3f000000,0x3f400000,0x3f800000,0x3fa00000]};
function numericOracle(definition,vector){const result=reference(definition.oracle,vector);if(vector.name==='eighths')equal(result.words,LITERAL_FIRST[definition.name],'hand-derived independent dyadic witness');return result;}
function constants(gl,program,result){
  equal(result.metadata.uniforms.length,1,'one declared raw constant bank');const uniform=result.metadata.uniforms[0];equal([uniform.type,uniform.encoding,uniform.count],['uvec4[]','float32-bits',46],'bounded constant ABI');
  const name=`${uniform.name}[0]`,index=gl.getUniformIndices(program,[name])[0],location=gl.getUniformLocation(program,name);require(index!==gl.INVALID_INDEX&&location!==null,'active raw constant bank');
  const activeCount=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0],type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0];equal(type,gl.UNSIGNED_INT_VEC4,'actual raw uniform type');require(activeCount>0&&activeCount<=46,'actual active extent');
  return {location,uniformName:uniform.name,selector:activeCount>44?gl.getUniformLocation(program,`${uniform.name}[44]`):null,record:{name,index,declaredCount:46,activeCount,type}};
}
function upload(gl,program,binding,vector,oracle){
  const words=new Uint32Array(binding.record.activeCount*4),inputs={0:vector.condition,1:vector.directCondition??[1,1,1,1],42:oracle.doubledWords,43:oracle.words,44:[0,0,0,0],45:vector.raw};
  for(const[index,value]of Object.entries(inputs))if(Number(index)<binding.record.activeCount)words.set(value,Number(index)*4);
  gl.uniform4uiv(binding.location,words);const slots=[];
  for(const[index,value]of Object.entries(inputs))if(Number(index)<binding.record.activeCount){const location=gl.getUniformLocation(program,`${binding.uniformName}[${index}]`);require(location!==null,'actual in-extent constant location');const observed=[...gl.getUniform(program,location)];equal(observed,value,'actual dynamic uniform upload/readback');slots.push({index:Number(index),words:value,observed});}
  return {wordCount:words.length,words:[...words],slots};
}
function select(gl,program,binding,value){require(binding.selector!==null,'actual raw selector44');const words=Array(4).fill(value);gl.uniform4uiv(binding.selector,new Uint32Array(words));const observed=[...gl.getUniform(program,binding.selector)];equal(observed,words,'actual selector upload');return {index:44,words,observed};}
function attributes(gl,program,vector,buffers,vertex=false){
  const positions=vertex?[[.25,.5,-.25,1]]:[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],copies=vertex?1:3;
  return [attribute(gl,program,'in_0',positions,buffers),...['a','b','c'].map((field,i)=>attribute(gl,program,`in_${i+1}`,Array.from({length:copies},()=>vector[field]),buffers))];
}
function sourceContract(result,text){
  const tgsiCount=text.split('\n').filter(line=>/^TEX /.test(line)).length,glslCount=[...result.glsl.matchAll(/\btexture\(/g)].length;
  equal(glslCount,tgsiCount,'one emitted texture evaluation per checked TEX instruction');
  require(result.glsl.includes('float_temp[')&&result.glsl.includes('float_rhs'),'owned ordinary float shadows emitted');
  return {textureInstructions:tgsiCount,textureCalls:glslCount,meaning:'Counts logical emitted texture calls, not driver physical fetches.'};
}
async function vertexProbe(gl,definition,vertex,fragment,vectors,report){
  const varyings=['gl_Position','vso_g5','vso_g6'],record={name:definition.name,oracle:definition.oracle,vertex:definition.vertex,fragment:'legacy-fragment',varyings,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};report.vertexProbes.push(record);
  const{program,logs}=compile(gl,vertex,fragment,varyings);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,vertex);record.uniformReflection=binding.record;
    equal(gl.getProgramParameter(program,gl.TRANSFORM_FEEDBACK_VARYINGS),3,'three actual feedback vec4s');record.feedbackReflection=[];
    for(let i=0;i<3;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[varyings[i],1,gl.FLOAT_VEC4],'float feedback ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,64,gl.STREAM_READ);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,output,0,48);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
    for(const vector of vectors){const oracle=numericOracle(definition,vector),entry={...vector,oracle,attributes:attributes(gl,program,vector,buffers,true),upload:upload(gl,program,binding,vector,oracle),captures:[]};record.vectors.push(entry);const reconstructed=[0n,0n,0n,0n];
      for(const selector of[0,8,16,24]){const guard=new Uint8Array(64).fill(0xa5);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,guard);const selectorUpload=select(gl,program,binding,selector);gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(64);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'actual numeric/raw feedback readback');
        const observedBits=[...new Uint32Array(bytes.buffer,0,12)],expectedBytes=oracle.words.map(word=>Number((BigInt(word)>>BigInt(selector))&255n)),expectedBits=[0x3e800000,0x3f000000,0xbe800000,0x3f800000,...oracle.words,...expectedBytes.map(byte=>0x3f000000+byte*32768)];
        const capture={selector,selectorUpload,expectedBytes,expectedBits,observedBits,rawBytes:[...bytes],bytesSha256:await digest(bytes),guard:[...bytes.subarray(48)]};entry.captures.push(capture);equal(capture.guard,Array(16).fill(0xa5),'feedback range guard');if(JSON.stringify(observedBits)!==JSON.stringify(expectedBits))capture.failure={expectedBits,observedBits};equal(observedBits,expectedBits,`${definition.name}/${vector.name} simultaneous numeric/raw byte${selector/8}`);
        const decoded=observedBits.slice(8).map(word=>{require(word>=0x3f000000&&word<=0x3f7f8000&&(word-0x3f000000)%32768===0,'finite exact byte carrier');return(word-0x3f000000)/32768;});capture.decodedBytes=decoded;for(let i=0;i<4;i++)reconstructed[i]|=BigInt(decoded[i])<<BigInt(selector);
      }entry.observedWords=reconstructed.map(Number);equal(entry.observedWords,oracle.words,'all captured numeric word bits');
    }
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
async function fragmentProbe(gl,definition,vertex,fragment,vectors,report,{cross=false,sample=null}={}){
  const record={name:definition.name,oracle:definition.oracle,vertex:'legacy-vertex',fragment:cross?definition.cross:definition.fragment,width:1,height:1,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};(cross?report.crossConsumerProbes:report.fragmentProbes).push(record);
  const{program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),target=texture2d(gl,1,1,null),sampleTextures=[];
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,fragment);record.uniformReflection=binding.record;
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'numeric fragment target');gl.viewport(0,0,1,1);reset(gl);
    for(const vector of vectors){const oracle=sample?vector.oracle:numericOracle(definition,vector),entry={...vector,oracle,attributes:attributes(gl,program,vector,buffers),upload:upload(gl,program,binding,vector,oracle),draws:[]};record.vectors.push(entry);if(sample)entry.samplers=bindSamples(gl,program,fragment,vector.sampleBindings,sampleTextures);
      const reconstructed=[0n,0n,0n,0n],tile=[];
      for(const selector of(cross?[null]:Array.from({length:32},(_,i)=>i))){const selectorUpload=selector===null?null:select(gl,program,binding,selector);gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'actual numeric FS readback');
        const expectedBytes=cross?[255,255,255,255]:oracle.words.map(word=>Number((BigInt(word)>>BigInt(selector))&1n)*255),observedBytes=[...bytes],draw={selector,selectorUpload,expectedBytes,observedBytes};entry.draws.push(draw);tile.push(...observedBytes);if(JSON.stringify(observedBytes)!==JSON.stringify(expectedBytes))draw.failure={expectedBytes,observedBytes};equal(observedBytes,expectedBytes,`${definition.name}/${vector.name} ${cross?'same-lane raw and float consumers':`bit${selector}`}`);if(!cross)for(let i=0;i<4;i++)reconstructed[i]|=BigInt(observedBytes[i]/255)<<BigInt(selector);
      }
      if(!cross){entry.observedWords=reconstructed.map(Number);equal(entry.observedWords,oracle.words,'all32 ordinary captured bits');entry.bitPlaneBytesSha256=await digest(new Uint8Array(tile));if(record.vectors.length===1)addTile(tile,32,1,definition.name+' captured finite words');}
    }
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));sampleTextures.forEach(x=>gl.deleteTexture(x));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(target);gl.deleteProgram(program);}
}
async function orientationProbe(gl,vertex,fragment,vector,report){
  const record={vertex:'numeric-chain-vertex',fragment:'legacy-fragment',vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),varyings:['gl_Position','vso_g5','vso_g6'],captures:[]};report.orientation=record;
  const {program,logs}=compile(gl,vertex,fragment,record.varyings);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attributes=attributes(gl,program,vector,buffers,true);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    equal(record.uniformBlocks.length,1,'one orientation system block');equal(record.uniformBlocks[0].byteLength,656,'actual orientation block size');equal(record.uniformBlocks[0].members[0].offset,640,'actual orientation member offset');
    const system=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,0);require(buffers.includes(system),'orientation updates owned actual bound UBO');
    const binding=constants(gl,program,vertex);record.uniformReflection=binding.record;record.vector=vector;record.oracle=reference('chain',vector);record.upload=upload(gl,program,binding,vector,record.oracle);record.selectorUpload=select(gl,program,binding,0);
    record.feedbackReflection=[];for(let i=0;i<3;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[record.varyings[i],1,gl.FLOAT_VEC4],'orientation float feedback ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,48,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
    for(const adjust of[-1,1]){
      gl.bindBuffer(gl.UNIFORM_BUFFER,system);const written=new Float32Array([adjust]);gl.bufferSubData(gl.UNIFORM_BUFFER,640,written);const actual=new Uint8Array(4);gl.getBufferSubData(gl.UNIFORM_BUFFER,640,actual);const expectedUniformBits=adjust<0?0xbf800000:0x3f800000;equal([...new Uint32Array(actual.buffer)],[expectedUniformBits],'actual winsys UBO update');
      gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(48);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'orientation actual feedback');
      const carrierBytes=record.oracle.words.map(word=>Number(BigInt(word)&255n)),expectedBits=[0x3e800000,adjust<0?0xbf000000:0x3f000000,0xbe800000,0x3f800000,...record.oracle.words,...carrierBytes.map(byte=>0x3f000000+byte*32768)],observedBits=[...new Uint32Array(bytes.buffer)];
      const capture={adjust,uniformUpdate:{offset:640,expectedBits:[expectedUniformBits],observedBits:[...new Uint32Array(actual.buffer)]},expectedBits,observedBits,rawBytes:[...bytes],bytesSha256:await digest(bytes)};record.captures.push(capture);equal(observedBits,expectedBits,'independent nonzero-y coordinate-system adjustment');
    }
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(value=>gl.deleteBuffer(value));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
function bindSamples(gl,program,fragment,bindings,textures){
  equal(fragment.metadata.samplers.map(s=>s.index),bindings.map(b=>b.index),'used sampler metadata only');
  const records=[];
  for(const binding of bindings){
    const sampler=fragment.metadata.samplers.find(s=>s.index===binding.index);equal([sampler.name,sampler.type],[`fssamp${binding.index}`,'sampler2D'],'owned sampler ABI');
    const unit=binding.index===7?3:5;gl.activeTexture(gl.TEXTURE0+unit);const texture=texture2d(gl,2,2,new Uint8Array(binding.texture.bytes));textures.push(texture);
    const uniformIndex=gl.getUniformIndices(program,[sampler.name])[0],location=gl.getUniformLocation(program,sampler.name);require(uniformIndex!==gl.INVALID_INDEX&&location!==null,'active actual sampler');
    const type=gl.getActiveUniforms(program,[uniformIndex],gl.UNIFORM_TYPE)[0],size=gl.getActiveUniforms(program,[uniformIndex],gl.UNIFORM_SIZE)[0];equal([type,size],[gl.SAMPLER_2D,1],'actual sampler reflection');gl.uniform1i(location,unit);const observedUnit=gl.getUniform(program,location);equal(observedUnit,unit,'actual sampler assignment');
    const parameters={min:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER),mag:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER),s:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S),t:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T)};equal(parameters,{min:gl.NEAREST,mag:gl.NEAREST,s:gl.CLAMP_TO_EDGE,t:gl.CLAMP_TO_EDGE},'actual texture parameters');
    const previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),readback=gl.createFramebuffer();let uploadedBytes;
    try{gl.bindFramebuffer(gl.FRAMEBUFFER,readback);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'sampled texture readback target');const bytes=new Uint8Array(16);gl.readPixels(0,0,2,2,gl.RGBA,gl.UNSIGNED_BYTE,bytes);uploadedBytes=[...bytes];equal(uploadedBytes,binding.texture.bytes,'actual texture upload bytes');}finally{gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(readback);}
    records.push({...sampler,unit,observedUnit,uniformIndex,reflectedType:type,size,parameters,texture:binding.texture,uploadedBytes});
  }
  gl.activeTexture(gl.TEXTURE0);equal(gl.getError(),gl.NO_ERROR,'sampler reflection and texture upload');return records;
}
function textureVector(definition,fixture,phase,texel){
  const condition=phase===0?[0,1,2,0x80000000]:[0xffffffff,0,0x80000000,2],directCondition=phase===0?[1,0,2,0]:[0,0x80000000,0,0xffffffff];
  const sampleBindings=definition.samplers.map(index=>({index,texture:fixture.textures[(index===7?0:1)^phase]}));
  const sampledBytes=Array.from({length:4},(_,lane)=>{const index=definition.name==='tex-chain'||condition[lane]!==0?7:0;return sampleBindings.find(b=>b.index===index).texture.bytes[texel*4+lane];});
  const oracle=oracleRecord(sampledBytes.map(byte=>{require(byte===0||byte===255,'literal texture endpoint');return byte===0?SCALE/4n:3n*SCALE/4n;}));
  return {name:`phase${phase}-texel${texel}`,phase,texel,a:[(texel%2+.5)/2,(Math.floor(texel/2)+.5)/2,0,1],b:[.25,.5,.75,1],c:[1,.75,.5,.25],condition,directCondition,raw:[0,0,0,0],sampleBindings,sampledBytes,oracle};
}
async function textureDraw(gl,definition,vertex,fragment,fixture,phase,report){
  const vector=textureVector(definition,fixture,phase,0),record={name:definition.name,phase,vertex:'legacy-vertex',fragment:definition.direct,width:32,height:32,condition:vector.condition,directCondition:vector.directCondition,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl)};report.textureDraws.push(record);
  const{program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),target=texture2d(gl,32,32,null),textures=[];
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attributes=[attribute(gl,program,'in_0',[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],buffers),attribute(gl,program,'in_1',[[0,0,0,1],[2,0,0,1],[0,2,0,1]],buffers)];record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,fragment);record.uniformReflection=binding.record;record.upload=upload(gl,program,binding,vector,vector.oracle);record.samplers=bindSamples(gl,program,fragment,vector.sampleBindings,textures);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'direct texture target');gl.viewport(0,0,32,32);reset(gl);gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4096);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);record.rawBytes=[...bytes];record.bytesSha256=await digest(bytes);equal(gl.getError(),gl.NO_ERROR,'actual texture arithmetic output');
    let checkedPixels=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++){const texel=(x>=16?1:0)+(y>=16?2:0),sample=textureVector(definition,fixture,phase,texel),expected=sample.sampledBytes.map((byte,lane)=>sample.directCondition[lane]!==0?byte:255-byte),observed=[...bytes.subarray((y*32+x)*4,(y*32+x)*4+4)];if(JSON.stringify(observed)!==JSON.stringify(expected))record.failure={pixel:[x,y],texel,expected,observed};equal(observed,expected,`${definition.name} exact texture arithmetic pixel (${x},${y})`);checkedPixels++;}record.checkedPixels=checkedPixels;addTile(bytes,32,32,`${definition.name} phase ${phase}: sampled arithmetic`);
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));textures.forEach(x=>gl.deleteTexture(x));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(target);gl.deleteProgram(program);}
}
async function sabotageOperation(result,mode,report){
  const definitions={
    'stale-shadow':{expression:/float_temp\[9\]\.xyzw = float_rhs\.xyzw;/g,replacement:'float_temp[9].xyzw = float_temp[117].xyzw;',matches:1,meaning:'Publish the unswizzled old source into the MOV destination shadow; retain the raw MOV and both output encoders.'},
    'numeric-decode':{expression:/uintBitsToFloat\(raw_temp\[9\]\.([xyzw])\)/g,replacement:'float(raw_temp[9].$1)',matches:4,meaning:'Numerically convert the proved normal raw source instead of decoding its bits; retain the raw input construction and encoders.'},
    'sampler-index':{expression:/texture\(fssamp([07]),/g,replacement:'swap sampler0 and sampler7',matches:2,meaning:'Swap only the two active sampler identifiers; retain coordinates, arithmetic, selection and output encoders.'},
  };
  const definition=definitions[mode],matches=[...result.glsl.matchAll(definition.expression)];equal(matches.length,definition.matches,'exact source-bound numeric omission');const glsl=result.glsl.replace(definition.expression,mode==='sampler-index'?((_,index)=>`texture(fssamp${7-Number(index)},`):definition.replacement);
  report.omissions.push({mode,originalExpression:definition.expression.source,replacement:definition.replacement,matches:matches.length,originalGlsl:result.glsl,servedGlsl:glsl,originalGlslSha256:await digest(result.glsl),servedGlslSha256:await digest(glsl),meaning:definition.meaning+' Original TGSI, full translation results and metadata remain unchanged.'});return {...result,glsl};
}
export async function runAcceptance({sabotage=null}={}){
  require(sabotage===null||['stale-shadow','numeric-decode','sampler-index'].includes(sabotage),'known numeric-shadow sabotage');
  const report={status:'running',guestExecution:false,productionVirgl:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true,sabotage,limits:LIMITS,corpus:[],cases:[],anchors:[],pairs:[],vertexProbes:[],fragmentProbes:[],pairDraws:[],crossConsumerProbes:[],textureDraws:[],sourceContracts:[],omissions:[]};window.__virglNumericFloatsReport=report;
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
    const hardware=await source('renderer/virgl-shader/tests/numeric-float-hardware.json'),fixture=JSON.parse(hardware.text);equal(fixture.schema,'wasm-vm-numeric-float-hardware-v1','shared hardware schema');report.hardwareFixture={path:hardware.path,sha256:hardware.sha256,bytes:hardware.bytes};report.literalWitnesses={input:fixture.numericVectors[0],expected:LITERAL_FIRST};report.operationDefinitions=fixture.operationDefinitions;
    const anchors=new Map();
    for(const input of fixture.shaders){const request={stage:input.stage,text:input.text},result=accepted(translate(request),input.name);equal(result.metadata.profile,input.profile,'fixture-specific backend');const retained=JSON.stringify(result);request.text='invalid after conversion';request.stage='geometry';equal(JSON.stringify(result),retained,'single request ownership');
      const record={...input,inputSha256:await digest(input.text),result};report.anchors.push(record);anchors.set(input.name,record);if(input.profile==='virgl-webgl2-raw-bits-v4')report.sourceContracts.push({name:input.name,inputSha256:record.inputSha256,glslSha256:await digest(result.glsl),...sourceContract(result,input.text)});}
    const pairs=new Map();
    for(const definition of fixture.pairs){const vertex=anchors.get(definition.vertex),fragment=anchors.get(definition.fragment);require(vertex&&fragment,'owned exact pair sources');const request={vertexText:vertex.text,fragmentText:fragment.text};const result=accepted(translatePair(request),definition.name);equal(result.interfaceKey,definition.interfaceKey,'derived literal pair key');equal(result.fragment,{glsl:fragment.result.glsl,metadata:fragment.result.metadata},'pair FS exactly standalone');equal(result.vertex.metadata.profile,vertex.profile,'pair VS backend');const retained=JSON.stringify(result);request.vertexText='mutated';request.fragmentText='mutated';equal(JSON.stringify(result),retained,'pair request ownership');const record={...definition,vertexSha256:vertex.inputSha256,fragmentSha256:fragment.inputSha256,result};report.pairs.push(record);pairs.set(definition.name,record);}
    const authored=await source('renderer/virgl-shader/tests/numeric-float-cases.json'),cases=JSON.parse(authored.text);require(Array.isArray(cases)&&cases.length>0&&cases.length<=1024,'bounded shared authored cases');report.caseFixture={path:authored.path,sha256:authored.sha256,bytes:authored.bytes};
    report.recovery={singleConversions:0,pairConversions:0};
    for(const test of cases){const result=translate({stage:test.stage,text:test.text});equal(result.ok,test.ok,`${test.name} authored outcome`);if(test.expected?.errorCode!==undefined)equal(result.error?.code,test.expected.errorCode,`${test.name} authored error`);if(test.expected?.constantCount!==undefined)equal(result.metadata?.uniforms[0]?.count,test.expected.constantCount,`${test.name} declared constant extent`);if((test.profile??test.expected?.profile)!==undefined)equal(result.metadata?.profile,test.profile??test.expected.profile,`${test.name} authored profile`);report.cases.push({name:test.name,stage:test.stage,inputSha256:await digest(test.text),ok:test.ok,...(test.expected?{expected:test.expected}:{}),result});
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
    for(let i=0;i<32;i++)equal(translatePair(stressInput),stressResult,'bounded maximal memory recovery');pressureProof(module,translate,translatePair,anchors,pairs,fixture,report);report.memory.finalBytes=module.HEAPU8.byteLength;
    const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const context=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(context instanceof WebGL2RenderingContext,'actual WebGL2');const debug=context.getExtension('WEBGL_debug_renderer_info');require(debug,'hardware identity');report.renderer={vendor:context.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:context.getParameter(debug.UNMASKED_RENDERER_WEBGL)};require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'hardware driver');const gl=counted(context,report);
    await orientationProbe(gl,anchors.get('numeric-chain-vertex').result,anchors.get('legacy-fragment').result,fixture.numericVectors[0],report);
    for(const definition of fixture.numericPrograms){const vectors=definition.vectors.map(name=>{const vector=fixture.numericVectors.find(value=>value.name===name);require(vector,'literal numeric vector exists');return vector;});let vertex=anchors.get(definition.vertex).result;if(sabotage&&definition.name===({'stale-shadow':'mov-snapshot','numeric-decode':'safe-raw'}[sabotage]))vertex=await sabotageOperation(vertex,sabotage,report);
      await vertexProbe(gl,definition,vertex,anchors.get('legacy-fragment').result,vectors,report);await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.fragment).result,vectors,report);if(definition.cross)await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.cross).result,vectors,report,{cross:true});}
    for(const definition of fixture.texturePrograms){const vectors=[0,1].flatMap(phase=>[0,1,2,3].map(texel=>textureVector(definition,fixture,phase,texel)));let fragment=anchors.get(definition.fragment).result;if(sabotage==='sampler-index'&&definition.name==='tex-select')fragment=await sabotageOperation(fragment,sabotage,report);
      await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,fragment,vectors,report,{sample:true});await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.cross).result,vectors,report,{sample:true,cross:true});for(const phase of[0,1])await textureDraw(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.direct).result,fixture,phase,report);}
    for(const definition of fixture.pairs.filter(value=>value.name.endsWith('-smooth')||value.name.endsWith('-flat')))await pairPixels(gl,definition,pairs.get(definition.name).result,report);
    equal(report.objects.live,0,'every native GL object released');equal(Object.entries(report.objects.created).sort(),Object.entries(report.objects.deleted).sort(),'all GL ownership balanced');equal(report.omissions,[],'sabotage cannot pass');
    report.checkedWords=report.vertexProbes.reduce((sum,value)=>sum+value.vectors.length*4,0)+report.fragmentProbes.reduce((sum,value)=>sum+value.vectors.length*4,0);equal(report.checkedWords,352,'exact captured numeric and texture words');report.checkedTexturePixels=report.textureDraws.reduce((sum,value)=>sum+value.checkedPixels,0);equal(report.checkedTexturePixels,4096,'all direct texture pixels');
    report.status='passed';document.querySelector('#status').textContent='352 exact words · numeric float shadows · sampled arithmetic · aliases · mixed stage interfaces';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
