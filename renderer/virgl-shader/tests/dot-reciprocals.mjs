// E6-T12e6: direct compiler/host-uniform proof. The guest constant wire is unchanged.
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
  const A=vector.a.map(scale),B=vector.b.map(scale),C=vector.c.map(scale),quarter=SCALE/4n;
  const dot=(a,b)=>(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/SCALE;
  let q=dot(A,B),values;
  if(name==='dp3-swizzle')q=-(A[2]*B[1]+A[0]*B[2]+A[1]*B[0])/SCALE;
  if(name==='dp3-safe')q=dot(vector.raw.map(word=>SCALE/2n+quarter*((BigInt(word)>>22n)&1n)),B);
  if(name==='dp3-alias-xy'){const t=A.map(x=>x+quarter);q=dot([t[1],t[2],t[0]],[B[2],B[0],B[1]]);values=[q,q,t[2],t[3]];}
  else if(name.startsWith('dp3-partial-')){values=[...C];for(const lane of name.slice('dp3-partial-'.length))values['xyzw'.indexOf(lane)]=q;}
  else {require(['dp3','dp3-swizzle','dp3-safe','dp3-shadow','maximal'].includes(name),'known exact dot oracle');values=Array(4).fill(q);}
  return oracleRecord(values);
}
function oracleRecord(values){return {scale:16777216,scaled:values.map(String),values:values.map(n=>Number(n)/16777216),words:values.map(encodeScaled),doubledWords:values.map(n=>encodeScaled(n*2n)),zeroSignFreedom:true};}
const LITERAL_FIRST={dp3:Array(4).fill(0x40880000),'dp3-swizzle':Array(4).fill(0xc0400000),'dp3-safe':Array(4).fill(0x40800000)};
const equivalentWord=(actual,expected)=>actual===expected||(expected===0&&actual===0x80000000);
function broadcast(words,groups){for(const group of groups)for(const lane of group){const first=words[group[0]],word=words[lane];require(word===first||(classify(word)==='zero'&&classify(first)==='zero'),'scalar broadcast words agree, with ordinary zero-sign latitude');}}
function numericOracle(definition,vector){const result=reference(definition.oracle,vector);if(vector.name==='basis'&&LITERAL_FIRST[definition.name])equal(result.words,LITERAL_FIRST[definition.name],'hand-derived independent dyadic witness');return result;}
function constants(gl,program,result){
  equal(result.metadata.uniforms.length,1,'one declared raw constant bank');const uniform=result.metadata.uniforms[0];equal([uniform.type,uniform.encoding,uniform.count],['uvec4[]','float32-bits',46],'bounded constant ABI');
  const name=`${uniform.name}[0]`,index=gl.getUniformIndices(program,[name])[0],location=gl.getUniformLocation(program,name);require(index!==gl.INVALID_INDEX&&location!==null,'active raw constant bank');
  const activeCount=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0],type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0];equal(type,gl.UNSIGNED_INT_VEC4,'actual raw uniform type');require(activeCount>0&&activeCount<=46,'actual active extent');
  return {location,uniformName:uniform.name,selector:activeCount>44?gl.getUniformLocation(program,`${uniform.name}[44]`):null,record:{name,index,declaredCount:46,activeCount,type}};
}
function upload(gl,program,binding,vector,oracle){
  const words=new Uint32Array(binding.record.activeCount*4),inputs={0:vector.condition,1:vector.directCondition??[1,1,1,1],...(oracle.boundWords?{40:oracle.boundWords.doubledUpper,41:oracle.boundWords.doubledLower,42:oracle.boundWords.upper,43:oracle.boundWords.lower}:{42:oracle.doubledWords,43:oracle.words}),44:[0,0,0,0],45:vector.raw};
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
  const instructions=opcode=>text.split('\n').filter(line=>line.startsWith(opcode+' ')).length;
  const tgsiCount=instructions('TEX'),glslCount=[...result.glsl.matchAll(/\btexture\(/g)].length;
  equal(glslCount,tgsiCount,'one emitted texture evaluation per checked TEX instruction');
  require(result.glsl.includes('float_temp[')&&result.glsl.includes('float_rhs'),'owned ordinary float shadows emitted');
  const scalarEvaluations=[['DP3',/\bdot\(/g],['RCP',/vec4\(1\.0 \/ \(/g],['RSQ',/\binversesqrt\(/g]].map(([opcode,expression])=>{const count=instructions(opcode),expressions=[...result.glsl.matchAll(expression)].length;equal(expressions,count,'one logical scalar evaluation per checked '+opcode);return {opcode,instructions:count,expressions};});
  return {textureInstructions:tgsiCount,textureCalls:glslCount,scalarEvaluations,consumedLanes:{DP3:[0,1,2],RCP:[0],RSQ:[0]},meaning:'Counts logical emitted scalar and texture expressions, not driver physical evaluations.'};
}
async function vertexProbe(gl,definition,vertex,fragment,vectors,report){
  const varyings=['gl_Position','vso_g5','vso_g6'],record={name:definition.name,oracle:definition.oracle,broadcastGroups:definition.broadcastGroups,vertex:definition.vertex,fragment:'legacy-fragment',varyings,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};report.vertexProbes.push(record);
  const{program,logs}=compile(gl,vertex,fragment,varyings);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,vertex);record.uniformReflection=binding.record;
    equal(gl.getProgramParameter(program,gl.TRANSFORM_FEEDBACK_VARYINGS),3,'three actual feedback vec4s');record.feedbackReflection=[];
    for(let i=0;i<3;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[varyings[i],1,gl.FLOAT_VEC4],'float feedback ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,64,gl.STREAM_READ);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,output,0,48);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
    for(const vector of vectors){const oracle=numericOracle(definition,vector),entry={...vector,oracle,attributes:attributes(gl,program,vector,buffers,true),upload:upload(gl,program,binding,vector,oracle),captures:[]};record.vectors.push(entry);const reconstructed=[0n,0n,0n,0n];
      for(const selector of[0,8,16,24]){const guard=new Uint8Array(64).fill(0xa5);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,guard);const selectorUpload=select(gl,program,binding,selector);gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(64);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'actual numeric/raw feedback readback');
        const observedBits=[...new Uint32Array(bytes.buffer,0,12)],expectedBytes=oracle.words.map(word=>Number((BigInt(word)>>BigInt(selector))&255n)),expectedBits=[0x3e800000,0x3f000000,0xbe800000,0x3f800000,...oracle.words,...expectedBytes.map(byte=>0x3f000000+byte*32768)];
        const capture={selector,selectorUpload,expectedBytes,expectedBits,observedBits,rawBytes:[...bytes],bytesSha256:await digest(bytes),guard:[...bytes.subarray(48)]};entry.captures.push(capture);equal(capture.guard,Array(16).fill(0xa5),'feedback range guard');broadcast(observedBits.slice(4,8),definition.broadcastGroups);const numericOkay=observedBits.slice(4,8).every((word,i)=>equivalentWord(word,oracle.words[i])),carrierOkay=observedBits.slice(8).every((word,i)=>word===expectedBits[8+i]||(oracle.words[i]===0&&selector===24&&word===0x3f400000)),valid=numericOkay&&carrierOkay&&JSON.stringify(observedBits.slice(0,4))===JSON.stringify(expectedBits.slice(0,4));if(!valid)capture.failure={expectedBits,observedBits};require(valid,`${definition.name}/${vector.name} simultaneous numeric/raw byte${selector/8}: expected ${JSON.stringify(expectedBits)}, observed ${JSON.stringify(observedBits)}`);
        const decoded=observedBits.slice(8).map(word=>{require(word>=0x3f000000&&word<=0x3f7f8000&&(word-0x3f000000)%32768===0,'finite exact byte carrier');return(word-0x3f000000)/32768;});capture.decodedBytes=decoded;for(let i=0;i<4;i++)reconstructed[i]|=BigInt(decoded[i])<<BigInt(selector);
      }entry.observedWords=reconstructed.map(Number);broadcast(entry.observedWords,definition.broadcastGroups);require(entry.observedWords.every((word,i)=>equivalentWord(word,oracle.words[i])),'all captured numeric word bits with ordinary zero-sign freedom');
    }
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
async function fragmentProbe(gl,definition,vertex,fragment,vectors,report,{cross=false,sample=null}={}){
  const record={name:definition.name,oracle:definition.oracle,broadcastGroups:definition.broadcastGroups,vertex:'legacy-vertex',fragment:cross?definition.cross:definition.fragment,width:1,height:1,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};(cross?report.crossConsumerProbes:report.fragmentProbes).push(record);
  const{program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),target=texture2d(gl,1,1,null),sampleTextures=[];
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,fragment);record.uniformReflection=binding.record;
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'numeric fragment target');gl.viewport(0,0,1,1);reset(gl);
    for(const vector of vectors){const oracle=sample?vector.oracle:numericOracle(definition,vector),entry={...vector,oracle,attributes:attributes(gl,program,vector,buffers),upload:upload(gl,program,binding,vector,oracle),draws:[]};record.vectors.push(entry);if(sample)entry.samplers=bindSamples(gl,program,fragment,vector.sampleBindings,sampleTextures);
      const reconstructed=[0n,0n,0n,0n],tile=[];
      for(const selector of(cross?[null]:Array.from({length:32},(_,i)=>i))){const selectorUpload=selector===null?null:select(gl,program,binding,selector);gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'actual numeric FS readback');
        const expectedBytes=cross?[255,255,255,255]:oracle.words.map(word=>Number((BigInt(word)>>BigInt(selector))&1n)*255),observedBytes=[...bytes],draw={selector,selectorUpload,expectedBytes,observedBytes};entry.draws.push(draw);tile.push(...observedBytes);const valid=observedBytes.every((byte,i)=>byte===expectedBytes[i]||(!cross&&oracle.words[i]===0&&selector===31&&byte===255));if(!valid)draw.failure={expectedBytes,observedBytes};require(valid,`${definition.name}/${vector.name} ${cross?'same-lane raw and float consumers':`bit${selector}`}: expected ${JSON.stringify(expectedBytes)}, observed ${JSON.stringify(observedBytes)}`);if(!cross)for(let i=0;i<4;i++)reconstructed[i]|=BigInt(observedBytes[i]/255)<<BigInt(selector);
      }
      if(!cross){entry.observedWords=reconstructed.map(Number);broadcast(entry.observedWords,definition.broadcastGroups);require(entry.observedWords.every((word,i)=>equivalentWord(word,oracle.words[i])),'all32 captured bits with ordinary zero-sign freedom');entry.bitPlaneBytesSha256=await digest(new Uint8Array(tile));if(record.vectors.length===1)addTile(tile,32,1,definition.name+' captured finite words');}
    }
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));sampleTextures.forEach(x=>gl.deleteTexture(x));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(target);gl.deleteProgram(program);}
}
async function orientationProbe(gl,vertex,fragment,vector,report){
  const record={vertex:'scalar-dp3-vertex',fragment:'legacy-fragment',vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),varyings:['gl_Position','vso_g5','vso_g6'],captures:[]};report.orientation=record;
  const {program,logs}=compile(gl,vertex,fragment,record.varyings);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attributes=attributes(gl,program,vector,buffers,true);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    equal(record.uniformBlocks.length,1,'one orientation system block');equal(record.uniformBlocks[0].byteLength,656,'actual orientation block size');equal(record.uniformBlocks[0].members[0].offset,640,'actual orientation member offset');
    const system=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,0);require(buffers.includes(system),'orientation updates owned actual bound UBO');
    const binding=constants(gl,program,vertex);record.uniformReflection=binding.record;record.vector=vector;record.oracle=reference('dp3',vector);record.upload=upload(gl,program,binding,vector,record.oracle);record.selectorUpload=select(gl,program,binding,0);
    record.feedbackReflection=[];for(let i=0;i<3;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[record.varyings[i],1,gl.FLOAT_VEC4],'orientation float feedback ABI');record.feedbackReflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,48,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
    for(const adjust of[-1,1]){
      gl.bindBuffer(gl.UNIFORM_BUFFER,system);const written=new Float32Array([adjust]);gl.bufferSubData(gl.UNIFORM_BUFFER,640,written);const actual=new Uint8Array(4);gl.getBufferSubData(gl.UNIFORM_BUFFER,640,actual);const expectedUniformBits=adjust<0?0xbf800000:0x3f800000;equal([...new Uint32Array(actual.buffer)],[expectedUniformBits],'actual winsys UBO update');
      gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(48);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'orientation actual feedback');
      const carrierBytes=record.oracle.words.map(word=>Number(BigInt(word)&255n)),expectedBits=[0x3e800000,adjust<0?0xbf000000:0x3f000000,0xbe800000,0x3f800000,...record.oracle.words,...carrierBytes.map(byte=>0x3f000000+byte*32768)],observedBits=[...new Uint32Array(bytes.buffer)];
      const capture={adjust,uniformUpdate:{offset:640,expectedBits:[expectedUniformBits],observedBits:[...new Uint32Array(actual.buffer)]},expectedBits,observedBits,rawBytes:[...bytes],bytesSha256:await digest(bytes)};record.captures.push(capture);require(observedBits.every((word,i)=>word===expectedBits[i]||(i>=4&&i<8&&record.oracle.words[i-4]===0&&word===0x80000000)),'independent nonzero-y coordinate-system adjustment');
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
  const sampledBytes=sampleBindings.find(b=>b.index===7).texture.bytes.slice(texel*4,texel*4+4);
  require(sampledBytes.every(byte=>byte===0||byte===255),'literal texture endpoints');
  const selected=definition.name==='tex-rsq'?1:0,input=rat(BigInt(1+sampledBytes[selected]/255));
  const oracle=definition.name==='tex-dp3'?oracleRecord(Array(4).fill(SCALE/4n+BigInt(sampledBytes[0]/255+sampledBytes[1]/255+2*sampledBytes[2]/255)*SCALE/4n)):reciprocalRecord(Array(4).fill(definition.name==='tex-rcp'?divisionBound(rat(1n),input):rsqBound(input)),definition.broadcastGroups);
  const directBytes=definition.thresholds.map((threshold,i)=>{const lo=oracle.lanes?fromJson(oracle.lanes[i].lower):rat(BigInt(oracle.scaled[i]),SCALE),hi=oracle.lanes?fromJson(oracle.lanes[i].upper):lo,t=rat(scale(threshold),SCALE);require(cmpR(lo,t)>=0||cmpR(hi,t)<0,'complete numerical enclosure remains on one side of pixel threshold');return cmpR(lo,t)>=0?255:0;});
  return {name:`phase${phase}-texel${texel}`,phase,texel,a:[(texel%2+.5)/2,(Math.floor(texel/2)+.5)/2,0,1],b:[.25,.5,.75,1],c:[1,.75,.5,.25],condition,directCondition,raw:[0,0,0,0],sampleBindings,sampledBytes,directBytes,oracle};
}
async function textureDraw(gl,definition,vertex,fragment,fixture,phase,report){
  const vector=textureVector(definition,fixture,phase,0),record={name:definition.name,phase,vertex:'legacy-vertex',fragment:definition.direct,width:32,height:32,condition:vector.condition,directCondition:vector.directCondition,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl)};report.textureDraws.push(record);
  const{program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),target=texture2d(gl,32,32,null),textures=[];
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attributes=[attribute(gl,program,'in_0',[[-1,-1,0,1],[3,-1,0,1],[-1,3,0,1]],buffers),attribute(gl,program,'in_1',[[0,0,0,1],[2,0,0,1],[0,2,0,1]].map(row=>row.map(value=>definition.coordinateNegated&&value!==0?-value:value)),buffers)];record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,fragment);record.uniformReflection=binding.record;record.upload=upload(gl,program,binding,vector,vector.oracle);record.samplers=bindSamples(gl,program,fragment,vector.sampleBindings,textures);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'direct texture target');gl.viewport(0,0,32,32);reset(gl);gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4096);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);record.rawBytes=[...bytes];record.bytesSha256=await digest(bytes);equal(gl.getError(),gl.NO_ERROR,'actual texture arithmetic output');
    let checkedPixels=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++){const texel=(x>=16?1:0)+(y>=16?2:0),sample=textureVector(definition,fixture,phase,texel),expected=sample.directBytes.map((byte,lane)=>sample.directCondition[lane]!==0?byte:255-byte),observed=[...bytes.subarray((y*32+x)*4,(y*32+x)*4+4)];if(JSON.stringify(observed)!==JSON.stringify(expected))record.failure={pixel:[x,y],texel,expected,observed};equal(observed,expected,`${definition.name} exact texture arithmetic pixel (${x},${y})`);checkedPixels++;}record.checkedPixels=checkedPixels;addTile(bytes,32,32,`${definition.name} phase ${phase}: sampled arithmetic`);
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));textures.forEach(x=>gl.deleteTexture(x));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(target);gl.deleteProgram(program);}
}
function gcd(a,b){a=a<0n?-a:a;while(b){const t=a%b;a=b;b=t;}return a;}
const rat=(n,d=1n)=>{require(d!==0n,'nonzero rational denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};};
const addR=(a,b)=>rat(a.n*b.d+b.n*a.d,a.d*b.d),subR=(a,b)=>rat(a.n*b.d-b.n*a.d,a.d*b.d),mulR=(a,b)=>rat(a.n*b.n,a.d*b.d),divR=(a,b)=>rat(a.n*b.d,a.d*b.n),cmpR=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const power=e=>e>=0?rat(1n<<BigInt(e)):rat(1n,1n<<BigInt(-e)),jsonR=r=>({numerator:String(r.n),denominator:String(r.d)});
export function classify(word){const exponent=Math.floor(word/8388608)%256,mantissa=word%8388608;return exponent===255?(mantissa?'nan':'infinity'):exponent===0?(mantissa?'subnormal':'zero'):'normal';}
function decode(word){const kind=classify(word);require(kind!=='nan'&&kind!=='infinity','finite rational word decode');const exponent=Math.floor(word/8388608)%256,mantissa=word%8388608,sign=word>=2147483648?-1n:1n;return mulR(rat(sign*BigInt(exponent===0?mantissa:8388608+mantissa)),power(exponent===0?-149:exponent-150));}
function exponentR(value){const a=rat(value.n<0n?-value.n:value.n,value.d);require(a.n>0n,'nonzero binade');let e=a.n.toString(2).length-a.d.toString(2).length;if(cmpR(a,power(e))<0)e--;return e;}
function outwardWord(value,up){if(value.n===0n)return 0;const negative=value.n<0n,a=rat(negative?-value.n:value.n,value.d),e=exponentR(a),significand=divR(a,power(e-23)),towardCeil=negative?!up:up;let n=significand.n/significand.d;if(towardCeil&&significand.n%significand.d!==0n)n++;require(e>=-126&&e<=127,'normal outward bound');return(negative?2147483648:0)+(e+127)*8388608+Number(n-8388608n);}
function divisionBound(a,b){require(cmpR(b,power(-126))>=0&&cmpR(b,power(126))<=0,'quantitative DIV positive denominator range only');const q=divR(a,b),abs=rat(q.n<0n?-q.n:q.n,q.d),e=exponentR(q),ulp=power(e-23),radius=mulR(rat(5n,2n),ulp),lo=subR(q,radius),hi=addR(q,radius),boundary=cmpR(abs,power(e))===0;
  require(cmpR(subR(abs,radius),power(-126))>0&&cmpR(addR(abs,radius),power(e+1))<0,'interior normal DIV enclosure with no upper binade crossing');return {numerator:jsonR(a),denominator:jsonR(b),quotient:jsonR(q),exponent:e,ulpQuantum:jsonR(ulp),lower:jsonR(lo),upper:jsonR(hi),boundary};}
const fromJson=r=>rat(BigInt(r.numerator),BigInt(r.denominator));
function integerSqrt(n){require(n>=0n,'nonnegative integer square root');if(n<2n)return n;let x=1n<<BigInt(Math.ceil(n.toString(2).length/2));for(;;){const next=(x+n/x)/2n;if(next>=x)return x;x=next;}}
export function rsqBound(input){
  require(input.n>0n&&classify(outwardWord(input,true))==='normal'&&cmpR(decode(outwardWord(input,true)),input)===0,'RSQ witness equals positive normal binary32');
  const squared=divR(rat(1n),input),scaleBits=192,e=Math.floor(exponentR(squared)/2),scaledNumerator=squared.n<<384n,m=integerSqrt(scaledNumerator/squared.d),exactRoot=m*m*squared.d===scaledNumerator,rootLower=rat(m,1n<<192n),rootUpper=rat(exactRoot?m:m+1n,1n<<192n),ulp=power(e-23),radius=mulR(rat(2n),ulp),lo=subR(rootLower,radius),hi=addR(rootUpper,radius),boundary=cmpR(squared,power(2*e))===0;
  require(cmpR(mulR(rootLower,rootLower),squared)<=0&&cmpR(mulR(rootUpper,rootUpper),squared)>=0,'integer-derived square root bracket');
  require(cmpR(lo,power(-126))>0&&cmpR(hi,power(e+1))<0&&(boundary||cmpR(lo,power(e))>0),'RSQ normal interior or exact-boundary witness enclosure');
  return {kind:'rsq',input:jsonR(input),squaredReciprocal:jsonR(squared),rootLower:jsonR(rootLower),rootUpper:jsonR(rootUpper),exactRoot,scaleBits,exponent:e,ulpQuantum:jsonR(ulp),lower:jsonR(lo),upper:jsonR(hi),boundary};
}
function reciprocalRecord(lanes,broadcastGroups){const endpoint=(lane,upper)=>fromJson(lane.kind==='exact'?lane.value:upper?lane.upper:lane.lower),boundWords={lower:lanes.map(x=>outwardWord(endpoint(x,false),false)),upper:lanes.map(x=>outwardWord(endpoint(x,true),true)),doubledLower:lanes.map(x=>outwardWord(mulR(endpoint(x,false),rat(2n)),false)),doubledUpper:lanes.map(x=>outwardWord(mulR(endpoint(x,true),rat(2n)),true))};return {kind:'reciprocal-enclosure',lanes,broadcastGroups,boundWords};}
export function reciprocalOracle(name,vector){
  const A=vector.a.map(value=>decode(encodeScaled(scale(value)))),B=vector.b.map(value=>decode(encodeScaled(scale(value)))),t=A.map(x=>addR(x,rat(1n,4n))),exact=x=>({kind:'exact',value:jsonR(x),word:outwardWord(x,true)});let scalar,lanes,groups;
  if(name==='rcp')scalar=divisionBound(rat(1n),A[1]);
  else if(name==='rcp-negate-shadow')scalar=divisionBound(rat(1n),rat(-B[3].n,B[3].d));
  else if(name==='rcp-alias-w'){scalar=divisionBound(rat(1n),t[2]);lanes=[...t.slice(0,3).map(exact),scalar];groups=[[3]];}
  else if(name==='rsq')scalar=rsqBound(A[2]);
  else if(name==='rsq-alias-xy'){scalar=rsqBound(t[3]);lanes=[scalar,scalar,exact(t[2]),exact(t[3])];groups=[[0,1]];}
  else if(name==='rsq-safe')scalar=rsqBound(rat(2n+((BigInt(vector.raw[1])>>22n)&1n),4n));
  else throw new Error('unknown reciprocal oracle '+name);
  return reciprocalRecord(lanes??Array(4).fill(scalar),groups??[[0,1,2,3]]);
}
export function reciprocalObservation(lane,word){
  const kind=classify(word);if(lane.kind==='exact'){const finite=kind!=='nan'&&kind!=='infinity';return {...lane,observedWord:word,...(finite?{observedValue:jsonR(decode(word)),error:jsonR(subR(decode(word),fromJson(lane.value)))}:{}),classification:kind,withinEnclosure:equivalentWord(word,lane.word)};}
  if(kind!=='normal')return {...lane,observedWord:word,classification:kind,withinEnclosure:false};const value=decode(word),error=lane.kind==='rsq'?{errorLower:jsonR(subR(value,fromJson(lane.rootUpper))),errorUpper:jsonR(subR(value,fromJson(lane.rootLower)))}:{error:jsonR(subR(value,fromJson(lane.quotient)))};
  return {...lane,observedWord:word,observedValue:jsonR(value),...error,classification:kind,withinEnclosure:cmpR(value,fromJson(lane.lower))>=0&&cmpR(value,fromJson(lane.upper))<=0};
}
async function reciprocalVertex(gl,definition,vertex,fragment,vectors,report){
 const record={name:definition.name,oracle:definition.oracle,broadcastGroups:definition.broadcastGroups,vertex:definition.vertex,fragment:'legacy-fragment',varyings:['gl_Position','vso_g5','vso_g6'],vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};report.reciprocalVertexProbes.push(record);const{program,logs}=compile(gl,vertex,fragment,record.varyings);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
 try{gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,vertex);record.uniformReflection=binding.record;record.feedbackReflection=record.varyings.map((name,i)=>{const x=gl.getTransformFeedbackVarying(program,i);equal([x.name,x.size,x.type],[name,1,gl.FLOAT_VEC4],'DIV feedback ABI');return {name:x.name,size:x.size,type:x.type};});gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,64,gl.STREAM_READ);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,output,0,48);reset(gl);gl.enable(gl.RASTERIZER_DISCARD);
  for(const vector of vectors){const oracle=reciprocalOracle(definition.oracle,vector),entry={...vector,oracle,attributes:attributes(gl,program,vector,buffers,true),upload:upload(gl,program,binding,vector,oracle),captures:[]};record.vectors.push(entry);const words=[0n,0n,0n,0n];
   for(const shift of[0,8,16,24]){gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,new Uint8Array(64).fill(0xa5));const selectorUpload=select(gl,program,binding,shift);gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;const bytes=new Uint8Array(64);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'DIV actual feedback');const observedBits=[...new Uint32Array(bytes.buffer,0,12)],decodedBytes=observedBits.slice(8).map(word=>{require(word>=0x3f000000&&word<=0x3f7f8000&&(word-0x3f000000)%32768===0,'DIV safe byte carrier');return(word-0x3f000000)/32768;}),numericObservations=observedBits.slice(4,8).map((word,i)=>reciprocalObservation(oracle.lanes[i],word));
    const capture={selector:shift,selectorUpload,observedBits,decodedBytes,numericObservations,rawBytes:[...bytes],bytesSha256:await digest(bytes),guard:[...bytes.subarray(48)]};entry.captures.push(capture);equal(capture.guard,Array(16).fill(0xa5),'DIV feedback guard');equal(observedBits.slice(0,4),[0x3e800000,0x3f000000,0xbe800000,0x3f800000],'DIV position');broadcast(observedBits.slice(4,8),definition.broadcastGroups);const failed=numericObservations.flatMap((v,i)=>v.withinEnclosure?[]:[i]);if(failed.length)capture.failure={lanes:failed};require(failed.length===0,`${definition.name}/${vector.name} ordinary reciprocal feedback outside rational enclosure`);for(let i=0;i<4;i++)words[i]|=BigInt(decodedBytes[i])<<BigInt(shift);
   }entry.observedWords=words.map(Number);broadcast(entry.observedWords,definition.broadcastGroups);entry.rawObservations=entry.observedWords.map((word,i)=>reciprocalObservation(oracle.lanes[i],word));require(entry.rawObservations.every(v=>v.withinEnclosure),'captured raw reciprocal words inside independent enclosure');
  }
 }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
async function reciprocalFragment(gl,definition,vertex,fragment,vectors,report,cross=false,sample=false){
 const record={name:definition.name,oracle:definition.oracle,broadcastGroups:definition.broadcastGroups,vertex:'legacy-vertex',fragment:cross?definition.cross:definition.fragment,width:1,height:1,vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};(cross?report.reciprocalCrossProbes:report.reciprocalFragmentProbes).push(record);const{program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),target=texture2d(gl,1,1,null),sampleTextures=[];
 try{gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,fragment);record.uniformReflection=binding.record;gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'DIV FS target');gl.viewport(0,0,1,1);reset(gl);
  for(const vector of vectors){const oracle=sample?vector.oracle:reciprocalOracle(definition.oracle,vector),entry={...vector,oracle,attributes:attributes(gl,program,vector,buffers),upload:upload(gl,program,binding,vector,oracle),draws:[]};record.vectors.push(entry);if(sample)entry.samplers=bindSamples(gl,program,fragment,vector.sampleBindings,sampleTextures);const words=[0n,0n,0n,0n],all=[];
   for(const bit of(cross?[null]:Array.from({length:32},(_,i)=>i))){const selectorUpload=bit===null?null:select(gl,program,binding,bit);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'DIV FS actual readback');const observedBytes=[...bytes],draw={selector:bit,selectorUpload,observedBytes};entry.draws.push(draw);require(observedBytes.every(b=>b===0||b===255),'DIV bitplane endpoints');if(cross){draw.expectedBytes=[255,255,255,255];equal(observedBytes,draw.expectedBytes,'DIV same-lane raw and doubled float enclosure selection');}else{for(let i=0;i<4;i++)words[i]|=BigInt(observedBytes[i]/255)<<BigInt(bit);all.push(...observedBytes);}}
   if(!cross){entry.observedWords=words.map(Number);broadcast(entry.observedWords,definition.broadcastGroups);entry.rawObservations=entry.observedWords.map((word,i)=>reciprocalObservation(oracle.lanes[i],word));entry.bitPlaneBytesSha256=await digest(new Uint8Array(all));require(entry.rawObservations.every(v=>v.withinEnclosure),'actual FS raw reciprocal words inside rational enclosure');if(record.vectors.length===1)addTile(all,32,1,definition.name+' bounded reciprocal words');}
  }
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));sampleTextures.forEach(x=>gl.deleteTexture(x));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(target);gl.deleteProgram(program);}
}
function wordAttribute(gl,program,name,inputWords,buffers){const location=gl.getAttribLocation(program,name);if(location<0)return {name,location,active:false,inputWords};const buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint32Array(inputWords),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);const uploaded=new Uint32Array(inputWords.length);gl.getBufferSubData(gl.ARRAY_BUFFER,0,uploaded);equal([...uploaded],inputWords,'actual authored special input bytes');return {name,location,active:true,inputWords,uploadedWords:[...uploaded]};}
async function observationProbe(gl,definition,anchors,vectors,report){
 for(const stage of['vertex','fragment']){const vertex=anchors.get(stage==='vertex'?definition.vertex:'legacy-vertex').result,fragment=anchors.get(stage==='vertex'?'legacy-fragment':definition.fragment).result,varyings=stage==='vertex'?['gl_Position','vso_g5','vso_g6']:null,record={name:definition.name,stage,vertex:stage==='vertex'?definition.vertex:'legacy-vertex',fragment:stage==='vertex'?'legacy-fragment':definition.fragment,claim:'Ordinary ESSL observations; no NaN payload, computed zero sign or subnormal retention promise.',vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),vectors:[]};report.observationProbes.push(record);const{program,logs}=compile(gl,vertex,fragment,varyings);record.programLogs=logs;const buffers=[],vao=gl.createVertexArray(),feedback=stage==='vertex'?gl.createTransformFeedback():null,output=stage==='vertex'?gl.createBuffer():null,framebuffer=stage==='fragment'?gl.createFramebuffer():null,target=stage==='fragment'?texture2d(gl,1,1,null):null;let running=false;
  try{gl.useProgram(program);gl.bindVertexArray(vao);record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);const binding=constants(gl,program,stage==='vertex'?vertex:fragment);record.uniformReflection=binding.record;reset(gl);if(stage==='vertex'){record.varyings=varyings;record.feedbackReflection=varyings.map((name,i)=>{const x=gl.getTransformFeedbackVarying(program,i);equal([x.name,x.size,x.type],[name,1,gl.FLOAT_VEC4],'ordinary observation feedback ABI');return {name:x.name,size:x.size,type:x.type};});gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,64,gl.STREAM_READ);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,output,0,48);gl.enable(gl.RASTERIZER_DISCARD);}else{gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'ordinary observation target');gl.viewport(0,0,1,1);}
   for(const vector of vectors){const position=stage==='vertex'?[.25,.5,-.25,1]:[-1,-1,0,1,3,-1,0,1,-1,3,0,1],copies=stage==='vertex'?1:3,inputWords=[position.map(x=>encodeScaled(scale(x))),...['aWords','bWords','cWords'].map(k=>Array.from({length:copies},()=>vector[k]).flat())],entry={...vector,attributes:inputWords.map((words,i)=>wordAttribute(gl,program,`in_${i}`,words,buffers)),upload:upload(gl,program,binding,{condition:[0,0,0,0],raw:[0,0,0,0]},{words:[0,0,0,0],doubledWords:[0,0,0,0]}),observations:[]};record.vectors.push(entry);const reconstructed=[0n,0n,0n,0n];
    for(const shift of(stage==='vertex'?[0,8,16,24]:Array.from({length:32},(_,i)=>i))){const selectorUpload=select(gl,program,binding,shift);let bytes,observedBits,decoded;
     if(stage==='vertex'){gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,new Uint8Array(64).fill(0xa5));gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();running=false;bytes=new Uint8Array(64);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);observedBits=[...new Uint32Array(bytes.buffer,0,12)];equal(observedBits.slice(0,4),[0x3e800000,0x3f000000,0xbe800000,0x3f800000],'ordinary observation position');equal([...bytes.subarray(48)],Array(16).fill(0xa5),'ordinary observation guard');decoded=observedBits.slice(8).map(word=>{require(word>=0x3f000000&&word<=0x3f7f8000&&(word-0x3f000000)%32768===0,'ordinary observation safe carrier');return(word-0x3f000000)/32768;});}
     else{gl.drawArrays(gl.TRIANGLES,0,3);bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);require([...bytes].every(b=>b===0||b===255),'ordinary observation bitplane endpoints');decoded=[...bytes].map(b=>b/255);}
     equal(gl.getError(),gl.NO_ERROR,'ordinary special-value actual readback');entry.observations.push({selector:shift,selectorUpload,rawBytes:[...bytes],bytesSha256:await digest(bytes),...(observedBits?{observedBits,numericClasses:observedBits.slice(4,8).map(classify)}:{}),decoded});for(let i=0;i<4;i++)reconstructed[i]|=BigInt(decoded[i])<<BigInt(shift);
    }entry.observedWords=reconstructed.map(Number);entry.classifications=entry.observedWords.map(classify);entry.requiredClasses=definition.name==='rcp'&&vector.name==='zero-boundaries'?['infinity','infinity','infinity','infinity']:[null,null,null,null];entry.requiredClasses.forEach((kind,i)=>{if(kind!==null){equal(entry.classifications[i],kind,'highp nonzero/zero DIV infinity class; zero sign implementation may vary');if(stage==='vertex')entry.observations.forEach(o=>equal(o.numericClasses[i],kind,'ordinary numeric DIV infinity class'));}});
   }
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));if(output)gl.deleteBuffer(output);if(feedback)gl.deleteTransformFeedback(feedback);if(framebuffer)gl.deleteFramebuffer(framebuffer);if(target)gl.deleteTexture(target);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
 }
}
async function sabotageOperation(result,mode,report){const definitions={
 'dp3-lane':{expression:/dot\(vec3\(in_1\.x, in_1\.y, in_1\.z\),/g,replacement:'dot(vec3(in_1.x, in_1.y, in_1.w),',matches:1,meaning:'Replace one consumed DP3 z with the authored poison w; retain all raw output encoders.'},
 'rcp-source':{expression:/1\.0 \/ \(in_1\.y\)/g,replacement:'1.0 / (in_1.x)',matches:1,meaning:'Replace the post-swizzle reciprocal source y with original x; retain numerator and encoders.'},
 'rsq-operation':{expression:/inversesqrt\(in_1\.z\)/g,replacement:'sqrt(in_1.z)',matches:1,meaning:'Replace reciprocal square root with square root; retain input and encoders.'},
 'numeric-negate':{expression:/-\(in_2\.y\)/g,replacement:'in_2.y',matches:1,meaning:'Drop the first consumed post-swizzle DP3 source minus; retain other modifiers and encoders.'},
 };const d=definitions[mode],matches=[...result.glsl.matchAll(d.expression)];equal(matches.length,d.matches,'exact source-bound scalar omission');const glsl=result.glsl.replace(d.expression,d.replacement);report.omissions.push({mode,originalExpression:d.expression.source,replacement:d.replacement,matches:matches.length,originalGlsl:result.glsl,servedGlsl:glsl,originalGlslSha256:await digest(result.glsl),servedGlslSha256:await digest(glsl),meaning:d.meaning+' Original TGSI, full translation results and metadata remain unchanged.'});return {...result,glsl};}
export async function runAcceptance({sabotage=null}={}){
  require(sabotage===null||['dp3-lane','rcp-source','rsq-operation','numeric-negate'].includes(sabotage),'known scalar-operation sabotage');
  const report={status:'running',guestExecution:false,productionVirgl:false,guestConstantTransportUnchanged:true,hostUniformInjectionOnly:true,sabotage,limits:LIMITS,corpus:[],cases:[],anchors:[],pairs:[],vertexProbes:[],fragmentProbes:[],pairDraws:[],crossConsumerProbes:[],textureDraws:[],reciprocalVertexProbes:[],reciprocalFragmentProbes:[],reciprocalCrossProbes:[],observationProbes:[],sourceContracts:[],omissions:[]};window.__virglDotReciprocalsReport=report;
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
    const hardware=await source('renderer/virgl-shader/tests/dot-reciprocal-hardware.json'),fixture=JSON.parse(hardware.text);equal(fixture.schema,'wasm-vm-dot-reciprocal-hardware-v1','shared hardware schema');report.hardwareFixture={path:hardware.path,sha256:hardware.sha256,bytes:hardware.bytes};report.literalWitnesses={input:fixture.numericVectors[0],expected:LITERAL_FIRST};report.operationDefinitions=fixture.operationDefinitions;
    const anchors=new Map();
    for(const input of fixture.shaders){const request={stage:input.stage,text:input.text},result=accepted(translate(request),input.name);equal(result.metadata.profile,input.profile,'fixture-specific backend');const retained=JSON.stringify(result);request.text='invalid after conversion';request.stage='geometry';equal(JSON.stringify(result),retained,'single request ownership');
      const record={...input,inputSha256:await digest(input.text),result};report.anchors.push(record);anchors.set(input.name,record);if(input.profile==='virgl-webgl2-raw-bits-v6')report.sourceContracts.push({name:input.name,inputSha256:record.inputSha256,glslSha256:await digest(result.glsl),...sourceContract(result,input.text)});}
    const pairs=new Map();
    for(const definition of fixture.pairs){const vertex=anchors.get(definition.vertex),fragment=anchors.get(definition.fragment);require(vertex&&fragment,'owned exact pair sources');const request={vertexText:vertex.text,fragmentText:fragment.text};const result=accepted(translatePair(request),definition.name);equal(result.interfaceKey,definition.interfaceKey,'derived literal pair key');equal(result.fragment,{glsl:fragment.result.glsl,metadata:fragment.result.metadata},'pair FS exactly standalone');equal(result.vertex.metadata.profile,vertex.profile,'pair VS backend');const retained=JSON.stringify(result);request.vertexText='mutated';request.fragmentText='mutated';equal(JSON.stringify(result),retained,'pair request ownership');const record={...definition,vertexSha256:vertex.inputSha256,fragmentSha256:fragment.inputSha256,result};report.pairs.push(record);pairs.set(definition.name,record);}
    const authored=await source('renderer/virgl-shader/tests/dot-reciprocal-cases.json'),cases=JSON.parse(authored.text);require(Array.isArray(cases)&&cases.length>0&&cases.length<=1024,'bounded shared authored cases');report.caseFixture={path:authored.path,sha256:authored.sha256,bytes:authored.bytes};
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
    await orientationProbe(gl,anchors.get('scalar-dp3-vertex').result,anchors.get('legacy-fragment').result,fixture.numericVectors[0],report);
    for(const definition of fixture.numericPrograms){const vectors=definition.vectors.map(name=>fixture.numericVectors.find(value=>value.name===name));let vertex=anchors.get(definition.vertex).result;if(sabotage&&definition.name===({'dp3-lane':'dp3','numeric-negate':'dp3-swizzle'}[sabotage]))vertex=await sabotageOperation(vertex,sabotage,report);
      await vertexProbe(gl,definition,vertex,anchors.get('legacy-fragment').result,vectors,report);await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.fragment).result,vectors,report);if(definition.cross)await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.cross).result,vectors,report,{cross:true});}
    for(const definition of fixture.reciprocalPrograms){const vectors=definition.vectors.map(name=>fixture.reciprocalVectors.find(value=>value.name===name));let vertex=anchors.get(definition.vertex).result;if(sabotage&&definition.name===({'rcp-source':'rcp','rsq-operation':'rsq'}[sabotage]))vertex=await sabotageOperation(vertex,sabotage,report);await reciprocalVertex(gl,definition,vertex,anchors.get('legacy-fragment').result,vectors,report);await reciprocalFragment(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.fragment).result,vectors,report);await reciprocalFragment(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.cross).result,vectors,report,true);}
    for(const definition of fixture.texturePrograms){const vectors=[0,1].flatMap(phase=>[0,1,2,3].map(texel=>textureVector(definition,fixture,phase,texel)));if(definition.approximate){await reciprocalFragment(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.fragment).result,vectors,report,false,true);await reciprocalFragment(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.cross).result,vectors,report,true,true);}else{await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.fragment).result,vectors,report,{sample:true});await fragmentProbe(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.cross).result,vectors,report,{sample:true,cross:true});}for(const phase of[0,1])await textureDraw(gl,definition,anchors.get('legacy-vertex').result,anchors.get(definition.direct).result,fixture,phase,report);}
    for(const definition of fixture.observationPrograms)await observationProbe(gl,definition,anchors,fixture.observationVectors,report);
    for(const definition of fixture.pairs.filter(value=>value.name.endsWith('-smooth')||value.name.endsWith('-flat')))await pairPixels(gl,definition,pairs.get(definition.name).result,report);
    equal(report.objects.live,0,'every native GL object released');equal(Object.entries(report.objects.created).sort(),Object.entries(report.objects.deleted).sort(),'all GL ownership balanced');equal(report.omissions,[],'sabotage cannot pass');
    report.checkedWords=[report.vertexProbes,report.fragmentProbes,report.reciprocalVertexProbes,report.reciprocalFragmentProbes].flat().reduce((sum,value)=>sum+value.vectors.length*4,0);equal(report.checkedWords,488,'exact and interval checked captured scalar words');report.exactWords=310;report.boundedReciprocalWords=178;report.observedSpecialWords=72;report.checkedTexturePixels=report.textureDraws.reduce((sum,value)=>sum+value.checkedPixels,0);equal(report.checkedTexturePixels,6144,'all direct texture pixels');
    report.status='passed';document.querySelector('#status').textContent='488 captured words · DP3 / RCP / RSQ · independent rational bounds · sampled arithmetic';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
