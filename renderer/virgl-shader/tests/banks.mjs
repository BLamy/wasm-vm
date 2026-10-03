// E6-T12e3: frontend register banks only. No command decoder/state widening.
import { createVirglShaderBridge, LIMITS } from '../index.mjs';
import { ORIGINAL_INPUTS } from './components.mjs';
import { digest, texture2d, bindSystemBlocks } from './browser.mjs';
const require=(test,label)=>{if(!test)throw new Error(label);};
const equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),`${label}: expected ${JSON.stringify(b)}, observed ${JSON.stringify(a)}`);
const ok=(value,label)=>{require(value?.ok===true,`${label}: ${JSON.stringify(value)}`);return value;};
const SIMPLE_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
const SIMPLE_FRAGMENT='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1, 0, 0, 1}\nMOV OUT[0], IMM[0]\nEND\n';
function bankVertex(high) {
  const temp=high?117:9, result=high?116:8, constant=high?45:7;
  return `VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..45]\nDCL TEMP[0..117]\nMOV TEMP[17], CONST[5]\nMUL TEMP[${temp}], IN[0], CONST[${constant}]\nADD TEMP[${result}], TEMP[${temp}], CONST[0]\nMOV OUT[0], TEMP[${result}]\nMOV OUT[1], TEMP[${result}]\nMOV OUT[1].w, TEMP[17].xxxx\nEND\n`;
}
function bankFragment(high,order=false) {
  const declarations=order?'DCL CONST[45]\nDCL CONST[5]\nDCL CONST[0]':'DCL CONST[0..45]';
  return `FRAG\nDCL OUT[0], COLOR\n${declarations}\nDCL TEMP[0..117]\nMOV TEMP[17], CONST[5]\nMOV TEMP[${high?117:9}], CONST[${high?45:7}]\nADD OUT[0], TEMP[${high?117:9}], CONST[0]\nMOV OUT[0].w, TEMP[17].xxxx\nEND\n`;
}
function maximal(stage) {
  const vertex=stage==='vertex';
  const lines=[vertex?'VERT':'FRAG',...(vertex?['DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]']:['DCL OUT[0], COLOR']),
    'DCL CONST[0..45]','DCL TEMP[0..117]'];
  const instructions=[];
  for(let i=0;i<118;i++)instructions.push(`MOV TEMP[${i}], CONST[${i%46}]`);
  for(let i=0;i<(vertex?58:60);i++)instructions.push(`ADD TEMP[117], TEMP[117], CONST[${i%46}]`);
  if(vertex)instructions.push('ADD OUT[0].xyz, IN[0].xyzz, TEMP[117].xyzz','MOV OUT[0].w, IN[0].wwww','MOV OUT[1], TEMP[117]');else instructions.push('MOV OUT[0], TEMP[117]');
  equal(instructions.length,179,'literal non-END stress budget');
  return lines.concat([...instructions,'END'].map((line,index)=>`${index}: ${line}`)).join('\n')+'\n';
}
export const HARDWARE_ANCHORS=Object.freeze([
  {name:'hardware-simple-vertex',stage:'vertex',text:SIMPLE_VERTEX,ok:true},
  {name:'hardware-simple-fragment',stage:'fragment',text:SIMPLE_FRAGMENT,ok:true},
  {name:'hardware-low-vertex',stage:'vertex',text:bankVertex(false),ok:true,expected:{constantCount:46,instructions:6}},
  {name:'hardware-high-vertex',stage:'vertex',text:bankVertex(true),ok:true,expected:{constantCount:46,instructions:6}},
  {name:'hardware-low-fragment',stage:'fragment',text:bankFragment(false),ok:true,expected:{constantCount:46,instructions:4}},
  {name:'hardware-high-fragment',stage:'fragment',text:bankFragment(true),ok:true,expected:{constantCount:46,instructions:4}},
  {name:'hardware-order-fragment',stage:'fragment',text:bankFragment(true,true),ok:true,expected:{constantCount:47,instructions:4}},
  {name:'hardware-maximal-vertex',stage:'vertex',text:maximal('vertex'),ok:true,expected:{constantCount:46,instructions:179}},
  {name:'hardware-maximal-fragment',stage:'fragment',text:maximal('fragment'),ok:true,expected:{constantCount:46,instructions:179}},
]);
export const HARDWARE_PAIRS=Object.freeze([
  {name:'hardware-low-pair',vertex:'hardware-low-vertex',fragment:'hardware-low-fragment'},
  {name:'hardware-high-pair',vertex:'hardware-high-vertex',fragment:'hardware-high-fragment'},
  {name:'hardware-order-pair',vertex:'hardware-high-vertex',fragment:'hardware-order-fragment'},
  {name:'hardware-maximal-pair',vertex:'hardware-maximal-vertex',fragment:'hardware-maximal-fragment'},
]);

const TF_INPUTS=[[-.5,-.25,.25,1],[.75,.5,-.25,1],[-.125,.875,.5,1]];
const TF_EXPECTED={low:[[-.375,-.25,-.125,1],[.875,.125,-.375,1],[0,.3125,0,1]],
  high:[[-.125,-.1875,0,1],[.5,0,-.5,1],[.0625,.09375,.25,1]]};
const PIXELS={low:[128,96,64,191],high:[64,191,128,191],order:[64,191,128,191],maximal:[0,0,0,255]};
function constants(stage,stress=false) {
  const values=Array.from({length:46},()=>stress?[0,0,0,1]:[0,0,0,0]);
  if(!stress&&stage==='fragment'){
    values[0]=[.125,.25,.25,.25];values[5]=[.75,.125,.5,1];values[7]=[.375,.125,0,.5];values[45]=[.125,.5,.25,.5];
  }else if(!stress){values[0]=[.125,-.125,-.25,0];values[5]=[.75,.75,.75,.75];values[7]=[1,.5,.5,1];values[45]=[.5,.25,1,1];}
  return values;
}
async function source(path,sha256,size) {
  const response=await fetch(`/${path}`);require(response.ok,`source ${path}`);const bytes=new Uint8Array(await response.arrayBuffer());
  const actual=await digest(bytes);if(sha256)equal(actual,sha256,'original source SHA');if(size!==undefined)equal(bytes.length,size,'original byte length');
  return {path,sha256:actual,bytes:bytes.length,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}
function instructionCount(text){return text.split('\n').filter(line=>/^\s*(?:\d+:\s*)?(?:MOV|ADD|MUL|MAD|TEX)\b/.test(line)).length;}
function compile(gl,vertex,fragment,feedback=false) {
  const shaders=[],logs={},program=gl.createProgram();require(program,'program allocation');
  try{
    for(const [stage,input,kind]of[['vertex',vertex,gl.VERTEX_SHADER],['fragment',fragment,gl.FRAGMENT_SHADER]]){
      const shader=gl.createShader(kind);require(shader,'shader allocation');shaders.push(shader);gl.shaderSource(shader,input.glsl);gl.compileShader(shader);
      logs[stage]=gl.getShaderInfoLog(shader);require(gl.getShaderParameter(shader,gl.COMPILE_STATUS),`${stage} hardware compile: ${logs[stage]}`);gl.attachShader(program,shader);
    }
    if(feedback)gl.transformFeedbackVaryings(program,['gl_Position','vso_g0'],gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);logs.link=gl.getProgramInfoLog(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),`hardware link: ${logs.link}`);
    return {program,logs};
  }catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
}
function bankBindings(gl,program,result,values,requiredCount) {
  const records=[];
  for(const uniform of result.metadata.uniforms){
    require(uniform.type==='uvec4[]'&&uniform.encoding==='float32-bits','constant bit encoding');
    require(Number.isInteger(uniform.count)&&uniform.count>0&&uniform.count<=47,'finite truthful declared extent');
    const name=`${uniform.name}[0]`,index=gl.getUniformIndices(program,[name])[0],location=gl.getUniformLocation(program,name);
    require(index!==gl.INVALID_INDEX&&location!==null,'hardware bank uniform active');
    const activeCount=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0];
    equal(gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],gl.UNSIGNED_INT_VEC4,'actual bank type');
    require(Number.isInteger(activeCount)&&activeCount>=requiredCount&&activeCount<=uniform.count,'active array covers independently known constant operands');
    // Drivers may retain an unused declared suffix. Upload only the reflected
    // addressable prefix; no shader in this profile can address CONST[46].
    let paddingUpload=null;
    if(activeCount===47){
      const paddingName=`${uniform.name}[46]`,paddingLocation=gl.getUniformLocation(program,paddingName);require(paddingLocation!==null,'retained host padding location');
      const poison=[16,-8,4,-2],poisonWords=new Uint32Array(new Float32Array(poison).buffer);gl.uniform4uiv(paddingLocation,poisonWords);
      paddingUpload={name:paddingName,index:46,values:poison,bits:[...poisonWords]};
    }
    const uploadedCount=Math.min(activeCount,46),selected=values.slice(0,uploadedCount),words=new Uint32Array(new Float32Array(selected.flat()).buffer);gl.uniform4uiv(location,words);
    records.push({name,stage:result.metadata.stage,requiredCount,declaredCount:uniform.count,activeCount,uploadedCount,paddingUpload,values:selected,bits:[...words]});
  }
  return records;
}
function attribute(gl,program,values,buffers) {
  const location=gl.getAttribLocation(program,'in_0');require(location>=0,'actual vertex input active');
  const buffer=gl.createBuffer();require(buffer,'attribute allocation');buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values.flat()),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,0,0);return {name:'in_0',location,values};
}
function tile(bytes,name) {
  const image=document.createElement('canvas');image.width=image.height=32;const displayed=new Uint8ClampedArray(4096);
  for(let y=0;y<32;y++)displayed.set(bytes.subarray(y*128,(y+1)*128),(31-y)*128);
  image.getContext('2d').putImageData(new ImageData(displayed,32,32),0,0);
  const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=image.toDataURL();img.alt=name;caption.textContent=name;figure.append(img,caption);document.querySelector('#draws').append(figure);
}
async function pixels(gl,vertex,fragment,mode,name,report,alias=false) {
  const record={name,mode,width:32,height:32,checks:[],checkedPixels:0,expected:PIXELS[mode],vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl)};
  report.draws.push(record);const {program,logs}=compile(gl,vertex,fragment);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),texture=texture2d(gl,32,32,null);
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);
    record.attribute=attribute(gl,program,[[-1,-1,0,1],[1,-1,0,1],[-1,1,0,1],[-1,1,0,1],[1,-1,0,1],[1,1,0,1]],buffers);
    record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    record.uniforms=[...bankBindings(gl,program,vertex,constants('vertex',mode==='maximal'),mode==='maximal'?46:0),
      ...bankBindings(gl,program,fragment,constants('fragment',mode==='maximal'),alias?6:mode==='low'?8:46)];
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'bank pixel framebuffer');
    gl.viewport(0,0,32,32);for(const cap of [gl.DITHER,gl.BLEND,gl.CULL_FACE,gl.DEPTH_TEST,gl.SCISSOR_TEST,gl.RASTERIZER_DISCARD])gl.disable(cap);
    gl.colorMask(true,true,true,true);gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);
    const bytes=new Uint8Array(4096);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'hardware bank pixels');
    record.rgbaSha256=await digest(bytes);tile(bytes,name);
    for(let y=8;y<24;y++)for(let x=8;x<24;x++){
      const observed=[...bytes.subarray((y*32+x)*4,(y*32+x)*4+4)],expected=PIXELS[mode];record.checks.push({pixel:[x,y],expected,observed});
      if(JSON.stringify(observed)!==JSON.stringify(expected))record.failure={pixel:[x,y],expected,observed};
      equal(observed,expected,`${name} independent pixel (${x},${y})`);record.checkedPixels++;
    }
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteVertexArray(vao);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteProgram(program);}
}
async function feedback(gl,vertex,fragment,mode,name,report) {
  const record={name,mode,inputs:TF_INPUTS,varyings:['gl_Position','vso_g0'],vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl)};
  report.transformFeedback.push(record);const {program,logs}=compile(gl,vertex,fragment,true);record.programLogs=logs;
  const buffers=[],vao=gl.createVertexArray(),object=gl.createTransformFeedback(),output=gl.createBuffer();let running=false;
  require(vao&&object&&output,'transform feedback allocations');
  try{
    gl.useProgram(program);gl.bindVertexArray(vao);record.attribute=attribute(gl,program,TF_INPUTS,buffers);
    record.uniformBlocks=bindSystemBlocks(gl,program,vertex.metadata,buffers);
    record.uniforms=[...bankBindings(gl,program,vertex,constants('vertex',mode==='maximal'),mode==='low'?8:46),
      ...bankBindings(gl,program,fragment,constants('fragment',mode==='maximal'),mode==='maximal'?46:0)];
    equal(gl.getProgramParameter(program,gl.TRANSFORM_FEEDBACK_VARYINGS),2,'two captured vec4s');
    record.reflection=[];
    for(let i=0;i<2;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.size,info.type],[record.varyings[i],1,gl.FLOAT_VEC4],'actual TF reflection');record.reflection.push({name:info.name,size:info.size,type:info.type});}
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,object);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,96,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
    gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);running=true;gl.drawArrays(gl.POINTS,0,3);gl.endTransformFeedback();running=false;gl.disable(gl.RASTERIZER_DISCARD);
    const bytes=new Uint8Array(96);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'actual transform feedback readback');
    const expected=mode==='maximal'?TF_INPUTS.flatMap(v=>[...v,0,0,0,59]):TF_EXPECTED[mode].flatMap(v=>[...v,...v.slice(0,3),.75]);
    record.expectedFloats=expected;record.expectedBits=[...new Uint32Array(new Float32Array(expected).buffer)];
    record.observedFloats=[...new Float32Array(bytes.buffer)];record.observedBits=[...new Uint32Array(bytes.buffer)];record.bytesSha256=await digest(bytes);
    if(JSON.stringify(record.observedBits)!==JSON.stringify(record.expectedBits))record.failure={expectedBits:record.expectedBits,observedBits:record.observedBits};
    equal(record.observedBits,record.expectedBits,`${name} independent rawFloat32 transform feedback`);
  }finally{if(running)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteBuffer(output);gl.deleteTransformFeedback(object);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
}
async function aliasHigh(fragment,report) {
  const expression=/fsconst0\[45\]/g,matches=[...fragment.glsl.matchAll(expression)];equal(matches.length,1,'one exact high constant read for sabotage');
  const glsl=fragment.glsl.replace(expression,'fsconst0[5]');
  report.omissions.push({mode:'high-alias',original:'fsconst0[45]',replacement:'fsconst0[5]',originalGlslSha256:await digest(fragment.glsl),servedGlslSha256:await digest(glsl),
    meaning:'Alias the high constant operand only in generated GLSL; original TGSI and metadata remain unchanged.'});return {...fragment,glsl};
}
export async function runAcceptance({sabotage=null}={}) {
  require(sabotage===null||sabotage==='high-alias','known bank sabotage');
  const report={status:'running',guestExecution:false,productionVirgl:false,commandRendererWidened:false,sabotage,limits:LIMITS,corpus:[],cases:[],anchors:[],pairs:[],draws:[],transformFeedback:[],omissions:[]};window.__virglBanksReport=report;
  try{
    equal(LIMITS,{textBytes:16384,tokens:8192,glslBytes:65536,instructions:179,registerIndex:7,temporaryRegisterIndex:117,constantRegisterIndex:45},'independent fixed frontend limits');
    let module;const bridge=await createVirglShaderBridge({onRuntimeInitialized(){module=this;}});require(module?.HEAPU8,'observe actual fixed Wasm memory');
    const memory=module.HEAPU8.buffer;report.memory={initialBytes:memory.byteLength,observations:0,bufferIdentityStable:true};equal(memory.byteLength,16777216,'fixed16MiB Wasm memory');
    report.measuredOutputMaxima={singleJSON:{bytes:0,name:null},pairJSON:{bytes:0,name:null},glsl:{bytes:0,name:null}};
    const observe=(result,name,pair=false)=>{
      require(module.HEAPU8.buffer===memory,'fixed memory identity');equal(module.HEAPU8.byteLength,16777216,'no Wasm memory growth');report.memory.observations++;
      const size=new TextEncoder().encode(JSON.stringify(result)).length,kind=pair?'pairJSON':'singleJSON';require(size<(pair?295936:147456),'fixed response capacity');
      if(size>report.measuredOutputMaxima[kind].bytes)report.measuredOutputMaxima[kind]={bytes:size,name};
      for(const translated of pair&&result.ok?[result.vertex,result.fragment]:result.ok?[result]:[]){const bytes=new TextEncoder().encode(translated.glsl).length;require(bytes<=65536,'fixed generated GLSL bound');
        equal(translated.metadata.profile,'virgl-webgl2-straight-line-v5','v5 metadata');if(bytes>report.measuredOutputMaxima.glsl.bytes)report.measuredOutputMaxima.glsl={bytes,name};}
      return result;
    };
    const single=(input,name)=>observe(bridge.translate(input),name),pair=(input,name)=>observe(bridge.translatePair(input),name,true);
    for(const input of ORIGINAL_INPUTS){const original=await source(input.path,input.sha256,input.size),result=single({stage:input.stage,text:original.text},input.sha256);
      equal(result.ok,!original.text.includes('PRECISE'),'unchanged original outcome');if(!result.ok)equal(result.error.code,'unsupported-feature','PRECISE still rejected');
      report.corpus.push({path:input.path,sha256:input.sha256,bytes:original.bytes,stage:input.stage,result});}
    equal(report.corpus.filter(x=>x.result.ok).length,12,'exact12/19 original acceptance');
    const fixture=await source('renderer/virgl-shader/tests/bank-cases.json'),cases=JSON.parse(fixture.text);report.fixtureSha256=fixture.sha256;
    require(Array.isArray(cases)&&cases.length>0&&cases.length<=512,'bounded bank fixture');const names=new Set();
    for(const test of cases){require(!names.has(test.name),'unique bank name');names.add(test.name);
      const result=single({stage:test.stage,text:test.text},test.name);equal(result.ok,test.ok,`${test.name} literal outcome`);
      if(test.expected?.errorCode!==undefined)equal(result.error?.code,test.expected.errorCode,`${test.name} error classification`);
      if(test.expected?.constantCount!==undefined)equal(result.metadata.uniforms[0]?.count,test.expected.constantCount,`${test.name} declared extent`);
      if(test.expected?.instructions!==undefined)equal(instructionCount(test.text),test.expected.instructions,`${test.name} non-END instruction count`);
      report.cases.push({name:test.name,stage:test.stage,inputSha256:await digest(test.text),ok:test.ok,...(test.expected?{expected:test.expected}:{}),result});
    }
    const anchors=new Map();
    for(const input of HARDWARE_ANCHORS){const test=cases.find(c=>c.name===input.name);require(test,'every hardware anchor is native shared fixture');equal(test.text,input.text,'unchanged exact hardware anchor');equal(test.stage,input.stage,'anchor stage');
      const entry=report.cases.find(c=>c.name===input.name);ok(entry.result,'hardware anchor accepted');anchors.set(input.name,entry.result);report.anchors.push({...input,inputSha256:entry.inputSha256,result:entry.result});}
    const pairs=new Map();
    for(const definition of HARDWARE_PAIRS){const vertex=HARDWARE_ANCHORS.find(a=>a.name===definition.vertex),fragment=HARDWARE_ANCHORS.find(a=>a.name===definition.fragment);
      const result=ok(pair({vertexText:vertex.text,fragmentText:fragment.text},definition.name),'full-bank pair');equal(result.interfaceKey,'generic-interpolation-v1:','fragment has no varying inputs');
      for(const [stage,input]of[['vertex',vertex],['fragment',fragment]]){const standalone=anchors.get(input.name);equal(result[stage],{glsl:standalone.glsl,metadata:standalone.metadata},'pair stage preserves standalone result');}
      report.pairs.push({name:definition.name,vertexSha256:await digest(vertex.text),fragmentSha256:await digest(fragment.text),result});pairs.set(definition.name,{vertexText:vertex.text,fragmentText:fragment.text,result});}
    report.recovery={rounds:2,singleConversions:0,pairConversions:0};
    const recoveryNames=['hardware-low-vertex','hardware-high-vertex','hardware-low-fragment','hardware-high-fragment'];
    for(let round=0;round<2;round++)for(let i=0;i<cases.length;i++){
      const test=cases[i];equal(single({stage:test.stage,text:test.text},test.name),report.cases[i].result,'repeat bank result');
      for(const name of recoveryNames){const input=HARDWARE_ANCHORS.find(a=>a.name===name);equal(single({stage:input.stage,text:input.text},name),anchors.get(name),'low/high single recovery');report.recovery.singleConversions++;}
      for(const name of ['hardware-high-pair','hardware-maximal-pair']){const input=pairs.get(name);equal(pair({vertexText:input.vertexText,fragmentText:input.fragmentText},name),input.result,'maximum bank pair recovery');report.recovery.pairConversions++;}
    }
    const maximalPair=pairs.get('hardware-maximal-pair');
    const padded={vertexText:maximalPair.vertexText+'\n'.repeat(16384-maximalPair.vertexText.length),fragmentText:maximalPair.fragmentText+'\n'.repeat(16384-maximalPair.fragmentText.length)};
    report.stress={iterations:32,nonEndInstructionsPerStage:179,temporaryIndices:118,constantIndices:46,vertexBytes:padded.vertexText.length,fragmentBytes:padded.fragmentText.length,
      vertexSha256:await digest(padded.vertexText),fragmentSha256:await digest(padded.fragmentText),result:maximalPair.result};
    for(let i=0;i<32;i++)equal(pair(padded,'padded-maximal-pair'),maximalPair.result,'fixed-memory maximal pair stress');
    report.memory.finalBytes=module.HEAPU8.byteLength;
    const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(gl instanceof WebGL2RenderingContext,'actual WebGL2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'hardware identity');report.renderer={vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)};
    require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'hardware WebGL');
    // Transform feedback records exact dyadic position/echo values before rasterization.
    for(const mode of ['low','high','low'])await feedback(gl,anchors.get(`hardware-${mode}-vertex`),anchors.get('hardware-simple-fragment'),mode,`vertex ${mode} ${report.transformFeedback.length}`,report);
    await feedback(gl,maximalPair.result.vertex,maximalPair.result.fragment,'maximal','vertex maximal179',report);
    for(const mode of ['low','high','low','order']){
      let fragment=anchors.get(`hardware-${mode}-fragment`);const alias=sabotage==='high-alias'&&mode==='high';if(alias)fragment=await aliasHigh(fragment,report);
      await pixels(gl,anchors.get('hardware-simple-vertex'),fragment,mode,`fragment ${mode} ${report.draws.length}`,report,alias);
    }
    await pixels(gl,maximalPair.result.vertex,maximalPair.result.fragment,'maximal','pair maximal179',report);
    equal(report.omissions.length,0,'alias control cannot pass');report.checkedPixels=report.draws.reduce((n,d)=>n+d.checkedPixels,0);
    equal(report.checkedPixels,1280,'five independent256-pixel draws');equal(report.transformFeedback.length,4,'four exact transform feedback draws');
    report.status='passed';document.querySelector('#status').textContent='CONST45 · TEMP117 ·179 non-END instructions · exact native/Wasm and hardware proof';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
