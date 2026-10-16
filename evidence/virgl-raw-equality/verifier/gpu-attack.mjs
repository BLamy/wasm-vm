// Fresh critic oracle: direct physical output from independently seeded raw words.
import {createVirglShaderBridge} from '../../../renderer/virgl-shader/index.mjs';
import {bindSystemBlocks} from '../../../renderer/virgl-shader/tests/browser.mjs';
const seeds=[0x615a4ec7,0xcab92135,0x037d8a61,0x92f460bd];
const special=[0,0x80000000,1,0x80000001,0x7fffff,0x800000,0x3f800000,0xbf800000,0x7f800000,0xff800000,0x7f800001,0xff800001,0x7fc00001,0xffc00001,0x7fffffff,0xffffffff];
function assert(value,message){if(!value)throw new Error(message);}
function equal(a,b,message){assert(JSON.stringify(a)===JSON.stringify(b),message+' '+JSON.stringify(a)+' / '+JSON.stringify(b));}
function eq(a,b){const nan=x=>Math.floor(x/8388608)%256===255&&x%8388608!==0;return !nan(a)&&!nan(b)&&(a===b||a%2147483648===0&&b%2147483648===0);}
function vectors(){const result=[{seed:'literal',a:[0,0x80000000,0x7f800005,1],b:[0x80000000,0,0x7f800005,0]}];for(const seed of seeds){let state=seed;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};for(let i=0;i<8;i++){const a=Array.from({length:4},(_,j)=>j%2?special[random()%special.length]:random()),b=a.map(x=>random()%3===0?x:special[random()%special.length]);result.push({seed:seed.toString(16),index:i,a,b});}}return result;}
function expected(vector,op,alias){let a=vector.a,b=vector.b;if(alias==='self')b=a;if(alias==='left'){a=a.slice().reverse();b=[b[1],b[0],b[3],b[2]];}if(alias==='right'){a=[a[2],a[3],a[0],a[1]];b=b.slice().reverse();}return a.map((x,i)=>(op==='FSEQ'?eq(x,b[i]):!eq(x,b[i]))?0xffffffff:0);}
function text(stage,op,alias){
 const lines=stage==='vertex'?['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]']:['FRAG','DCL OUT[0], COLOR'];
 lines.push('DCL TEMP[0..2]','DCL CONST[0..2]','IMM[0] UINT32 {255,15,1,0}','IMM[1] UINT32 {1056964608,1065353216,0,0}');
 if(alias==='left')lines.push('MOV TEMP[0], CONST[0]','MOV TEMP[1], CONST[1]',`${op} TEMP[0], TEMP[0].wzyx, TEMP[1].yxwz`);
 else if(alias==='right')lines.push('MOV TEMP[0], CONST[0]','MOV TEMP[1], CONST[1]',`${op} TEMP[1], TEMP[0].zwxy, TEMP[1].wzyx`,'MOV TEMP[0], TEMP[1]');
 else lines.push(`${op} TEMP[0], CONST[0], CONST[${alias==='self'?0:1}]`);
 lines.push('USHR TEMP[2], TEMP[0], CONST[2]');
 if(stage==='vertex')lines.push('AND TEMP[2], TEMP[2], IMM[0].xxxx','SHL TEMP[2], TEMP[2], IMM[0].yyyy','OR TEMP[2], TEMP[2], IMM[1].xxxx','MOV OUT[1], TEMP[2]','MOV OUT[0], IN[0]');
 else lines.push('AND TEMP[2], TEMP[2], IMM[0].zzzz','NOT TEMP[2], TEMP[2]','UADD TEMP[2], TEMP[2], IMM[0].zzzz','AND TEMP[2], TEMP[2], IMM[1].yyyy','MOV OUT[0], TEMP[2]');
 return lines.concat('END').join('\n')+'\n';
}
const vertexPartner='#version 300 es\nin vec4 in_0; void main(){gl_Position=in_0;}';
const fragmentPartner='#version 300 es\nprecision highp float; out vec4 color; void main(){color=vec4(1.0);}';
function compile(gl,vertex,fragment,feedback){const program=gl.createProgram(),shaders=[];try{for(const[kind,source]of[[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const s=gl.createShader(kind);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);assert(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(program,s);}if(feedback)gl.transformFeedbackVaryings(program,['gl_Position','vso_g0'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);assert(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));return program;}catch(e){gl.deleteProgram(program);throw e;}finally{for(const s of shaders)gl.deleteShader(s);}}
export async function runAcceptance(){
 const report={status:'running',guestExecution:false,seeds:seeds.map(x=>x.toString(16)),kernels:[],checkedWords:0};window.__freshRawEqualityReport=report;
 try{
  const bridge=await createVirglShaderBridge(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});assert(gl instanceof WebGL2RenderingContext,'actual WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);assert(!/swiftshader|software|llvmpipe/i.test(report.renderer),'real hardware');
  for(const cap of[gl.DITHER,gl.BLEND,gl.CULL_FACE,gl.DEPTH_TEST,gl.SCISSOR_TEST])gl.disable(cap);gl.colorMask(true,true,true,true);
  const samples=vectors();
  for(const stage of['vertex','fragment'])for(const op of['FSEQ','FSNE'])for(const alias of['none','self','left','right']){
   const tgsi=text(stage,op,alias),result=bridge.translate({stage,text:tgsi});assert(result.ok,'safe raw shader admitted');equal(result.metadata.profile,'virgl-webgl2-raw-bits-v13','pure predicate profile');assert(!Object.hasOwn(result.metadata,'constantDomains'),'no manufactured bank dependency');
   const record={stage,op,alias,text:tgsi,result,vectors:[]};report.kernels.push(record);
   const program=compile(gl,stage==='vertex'?result.glsl:vertexPartner,stage==='fragment'?result.glsl:fragmentPartner,stage==='vertex');
   const vao=gl.createVertexArray(),input=gl.createBuffer(),system=[];let output=null,feedback=null,framebuffer=null,texture=null;
   try{
    gl.useProgram(program);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,input);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(stage==='vertex'?[0,0,0,1]:[-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'in_0');assert(attr>=0,'actual position input');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,4,gl.FLOAT,false,0,0);
    record.uniformBlocks=stage==='vertex'?bindSystemBlocks(gl,program,result.metadata,system):[];
    if(stage==='fragment')equal(gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS),0,'standalone fragment partner has no system block');
    const location=gl.getUniformLocation(program,(stage==='vertex'?'vs':'fs')+'const0[0]'),selector=gl.getUniformLocation(program,(stage==='vertex'?'vs':'fs')+'const0[2]');assert(location&&selector,'actual uint bank and selector');
    if(stage==='vertex'){output=gl.createBuffer();feedback=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);}
    else{texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'actual complete framebuffer');gl.viewport(0,0,1,1);}
    for(const vector of samples){const wanted=expected(vector,op,alias),observed=[0,0,0,0],sample={...vector,expectedWords:wanted,captures:[]};record.vectors.push(sample);gl.uniform4uiv(location,new Uint32Array([...vector.a,...vector.b,0,0,0,0]));
     for(const bit of stage==='vertex'?[0,8,16,24]:Array.from({length:32},(_,i)=>i)){gl.uniform4uiv(selector,new Uint32Array([bit,bit,bit,bit]));if(stage==='vertex'){gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const bytes=new Uint8Array(32);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);const words=[...new Uint32Array(bytes.buffer)];equal(words.slice(0,4),[0,0,0,0x3f800000],'actual position feedback');sample.captures.push({bit,bytes:[...bytes]});for(let i=0;i<4;i++){const byte=(words[i+4]-0x3f000000)/32768;assert(Number.isInteger(byte)&&byte>=0&&byte<=255,'exact finite byte carrier');observed[i]=(observed[i]|(byte<<bit))>>>0;}}
     else{gl.clearColor(.25,.25,.25,.25);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);sample.captures.push({bit,bytes:[...bytes]});for(let i=0;i<4;i++){assert(bytes[i]===0||bytes[i]===255,'exact binary pixel');observed[i]=(observed[i]|((bytes[i]/255)<<bit))>>>0;}}
     assert(gl.getError()===gl.NO_ERROR,'zero GL errors');}sample.observedWords=observed;equal(observed,wanted,'independent whole-word GPU mask');report.checkedWords+=4;
    }
   }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);if(output)gl.deleteBuffer(output);if(feedback)gl.deleteTransformFeedback(feedback);if(framebuffer)gl.deleteFramebuffer(framebuffer);if(texture)gl.deleteTexture(texture);for(const buffer of system)gl.deleteBuffer(buffer);gl.deleteBuffer(input);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
  }
  equal(report.checkedWords,2112,'complete sixteen seeded hardware kernels');report.status='passed';document.querySelector('#status').textContent=report.checkedWords+' independently seeded exact GPU words';document.querySelector('#renderer').textContent=report.renderer;return report;
 }catch(e){report.status='failed';report.error=e.message;throw e;}
}
