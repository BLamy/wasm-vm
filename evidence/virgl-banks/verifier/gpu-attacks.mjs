import {createVirglShaderBridge,LIMITS} from '/renderer/virgl-shader/index.mjs';
const eq=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${label}: expected ${JSON.stringify(b)}, observed ${JSON.stringify(a)}`);};
const must=(x,label)=>{if(!x)throw new Error(label);};
const hash=async x=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof x==='string'?new TextEncoder().encode(x):x))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function run(sabotage=false){
 const r={status:'running',sabotage,assertions:0,parity:[],draws:[],feedback:[],translations:[],gpuErrors:[],memory:[]};window.bankCritic=r;
 try{
 const anchors=await(await fetch('/anchors.json')).json(),cases=await(await fetch('/browser-cases.json')).json(),expected=await(await fetch('/browser-expectations.json')).json();
 let mod;const b=await createVirglShaderBridge({onRuntimeInitialized(){mod=this;}});const memory=mod.HEAPU8.buffer;
 eq(LIMITS,{textBytes:16384,tokens:8192,glslBytes:65536,instructions:179,registerIndex:7,temporaryRegisterIndex:117,constantRegisterIndex:45},'frozen public limits');
 for(let i=0;i<cases.length;i++){
  const c=cases[i],a=c.mode===2?b.translatePair({vertexText:c.a,fragmentText:c.b}):b.translate({stage:c.mode?'fragment':'vertex',text:c.a});eq(c.name,expected[i].name,'aligned native case');eq(a,expected[i].result,`full independent native/Wasm ${c.name}`);eq(a.ok,c.ok,`literal independent acceptance ${c.name}`);if(c.code)eq(a.error.code,c.code,'literal diagnostic');
  must(mod.HEAPU8.buffer===memory,'memory identity');eq(memory.byteLength,16777216,'fixed memory');r.assertions+=4;r.parity.push({name:c.name,resultSha256:await hash(JSON.stringify(a))});
 }
 const single=(stage,text,name)=>{const result=b.translate({stage,text});must(result.ok,`translate ${name}`);r.translations.push({name,stage,text,result});return result;};
 const vs=single('vertex',anchors.vertexText,'high vertex'),fs=single('fragment',anchors.fragmentText,'high fragment');
 const dvs=single('vertex',anchors.vertexText.replace('DCL CONST[0..45]','DCL CONST[45]\nDCL CONST[44]\nDCL CONST[5]\nDCL CONST[0]'),'declared47 vertex');
 const dfs=single('fragment',anchors.fragmentText.replace('DCL CONST[0..45]','DCL CONST[45]\nDCL CONST[44]\nDCL CONST[5]\nDCL CONST[0]'),'declared47 fragment');
 eq(dvs.metadata.uniforms[0].count,47,'truthful vertex extent47');eq(dfs.metadata.uniforms[0].count,47,'truthful fragment extent47');
 const simpleVS=single('vertex','VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n','simple vertex');
 const simpleFS=single('fragment','FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1, 0, 0, 1}\nMOV OUT[0], IMM[0]\nEND\n','simple fragment');
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=16;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});must(gl instanceof WebGL2RenderingContext,'real WebGL2');const ext=gl.getExtension('WEBGL_debug_renderer_info');must(ext,'hardware identity');r.renderer={vendor:gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};must(!/swiftshader|llvmpipe|software|mock/i.test(r.renderer.renderer),'hardware device');
 const floats=new Float32Array(46*4);for(const [index,values]of Object.entries(anchors.constants))floats.set(values,Number(index)*4);const words=new Uint32Array(floats.buffer);
 function program(vertex,fragment,feedback,alias){
  const p=gl.createProgram(),logs={};for(const [stage,t]of[['vertex',vertex],['fragment',fragment]]){const shader=gl.createShader(stage==='vertex'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);let source=t.glsl;
   if(alias&&stage==='vertex'){const pieces=source.split('void main(void)');eq(pieces.length,2,'precise mutation anchor');source=pieces[0]+'void main(void)'+pieces[1].replace(/\btemp117\b/g,'temp17');r.sabotageMutation={original:'temp117',replacement:'temp17',stage,originalGlsl:t.glsl,mutatedGlsl:source};}
   gl.shaderSource(shader,source);gl.compileShader(shader);logs[stage]=gl.getShaderInfoLog(shader);must(gl.getShaderParameter(shader,gl.COMPILE_STATUS),`${stage} compile ${logs[stage]}`);gl.attachShader(p,shader);gl.deleteShader(shader);}
  if(feedback)gl.transformFeedbackVaryings(p,['vso_g0'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(p);logs.link=gl.getProgramInfoLog(p);must(gl.getProgramParameter(p,gl.LINK_STATUS),`link ${logs.link}`);return {p,logs};
 }
 function bindings(p,vertex,fragment,poison){
  const buffers=[],uniforms=[];gl.useProgram(p);
  for(const result of[vertex,fragment])for(const u of result.metadata.uniforms){const loc=gl.getUniformLocation(p,u.name+'[0]'),idx=gl.getUniformIndices(p,[u.name+'[0]'])[0];must(loc!==null&&idx!==gl.INVALID_INDEX,'active high constant');const size=gl.getActiveUniforms(p,[idx],gl.UNIFORM_SIZE)[0];eq(gl.getActiveUniforms(p,[idx],gl.UNIFORM_TYPE)[0],gl.UNSIGNED_INT_VEC4,'bit vector type');must(size>=46&&size<=u.count,'truthful active suffix');
   const info={name:u.name,declared:u.count,active:size,uploaded:46,padding:poison,words:[...words]};
   if(size===47){const loc46=gl.getUniformLocation(p,u.name+'[46]');must(loc46!==null,'retained padding');gl.uniform4uiv(loc46,new Uint32Array(new Float32Array(poison).buffer));}else info.padding=null;
   gl.uniform4uiv(loc,words);uniforms.push(info);
  }
  const bi=gl.getUniformBlockIndex(p,'VirglBlock');if(bi!==gl.INVALID_INDEX){const length=gl.getActiveUniformBlockParameter(p,bi,gl.UNIFORM_BLOCK_DATA_SIZE),idx=gl.getUniformIndices(p,['winsys_adjust_y'])[0];eq(length,656,'system block length');eq(gl.getActiveUniforms(p,[idx],gl.UNIFORM_OFFSET)[0],640,'system y offset');const data=new Uint8Array(656);new DataView(data.buffer).setFloat32(640,1,true);const buf=gl.createBuffer();buffers.push(buf);gl.bindBuffer(gl.UNIFORM_BUFFER,buf);gl.bufferData(gl.UNIFORM_BUFFER,data,gl.STATIC_DRAW);gl.uniformBlockBinding(p,bi,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,buf);}
  return {buffers,uniforms};
 }
 function attr(p,buffers){const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buf=gl.createBuffer();buffers.push(buf);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(p,'in_0');must(loc>=0,'position input');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,4,gl.FLOAT,false,0,0);return vao;}
 function feedback(vertex,name,poison,alias=false){const {p,logs}=program(vertex,simpleFS,true,alias),bind=bindings(p,vertex,simpleFS,poison),vao=attr(p,bind.buffers),tf=gl.createTransformFeedback(),output=gl.createBuffer(),record={name,logs,uniforms:bind.uniforms};r.feedback.push(record);
  try{const guard=0x3badcafe;const data=new Uint32Array(16).fill(guard);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data,gl.STREAM_READ);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,output,0,48);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,3);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
   const expected=[...anchors.expectedFloatBits,...anchors.expectedFloatBits,...anchors.expectedFloatBits,guard,guard,guard,guard];record.expected=expected;record.observed=[...data];eq(gl.getError(),gl.NO_ERROR,'transform feedback GPU error');eq(record.observed,expected,'independent high TEMP arithmetic bits');r.assertions+=17;
  }finally{gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.disable(gl.RASTERIZER_DISCARD);gl.deleteBuffer(output);gl.deleteTransformFeedback(tf);bind.buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteVertexArray(vao);gl.deleteProgram(p);}}
 function draw(fragment,name,poison){const {p,logs}=program(simpleVS,fragment,false,false),bind=bindings(p,simpleVS,fragment,poison),vao=attr(p,bind.buffers),texture=gl.createTexture(),fb=gl.createFramebuffer(),record={name,logs,uniforms:bind.uniforms,checks:[]};r.draws.push(record);
  try{gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,16,16,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);eq(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'FBO');for(const cap of[gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.RASTERIZER_DISCARD])gl.disable(cap);gl.viewport(0,0,16,16);gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);const bytes=new Uint8Array(16*16*4);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,bytes);eq(gl.getError(),gl.NO_ERROR,'pixel GPU error');
   for(let y=0;y<16;y++)for(let x=0;x<16;x++){const observed=[...bytes.slice((y*16+x)*4,(y*16+x+1)*4)],expected=anchors.expectedRGBA;record.checks.push({pixel:[x,y],expected,observed});eq(observed,expected,`independent fragment high arithmetic ${name} (${x},${y})`);r.assertions++;}
   const img=document.createElement('canvas');img.width=img.height=16;img.style.width='160px';img.style.imageRendering='pixelated';img.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),16,16),0,0);const f=document.createElement('figure');f.append(img);const cap=document.createElement('figcaption');cap.textContent=name;f.append(cap);document.querySelector('#frames').append(f);
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.deleteTexture(texture);gl.deleteFramebuffer(fb);bind.buffers.forEach(x=>gl.deleteBuffer(x));gl.deleteVertexArray(vao);gl.deleteProgram(p);}}
 feedback(vs,'high vertex exact independent arithmetic',[0,0,0,0],sabotage);
 feedback(dvs,'declared47 vertex poisonA',[16,-8,4,-2]);feedback(dvs,'declared47 vertex poisonB',[-32,64,-128,256]);feedback(vs,'high vertex after poison',[0,0,0,0]);
 draw(fs,'high fragment exact independent arithmetic',[0,0,0,0]);draw(dfs,'declared47 fragment poisonA',[16,-8,4,-2]);draw(dfs,'declared47 fragment poisonB',[-32,64,-128,256]);draw(fs,'high fragment after poison',[0,0,0,0]);
 eq(mod.HEAPU8.byteLength,16777216,'final fixed memory');must(mod.HEAPU8.buffer===memory,'final memory identity');r.memory={initial:memory.byteLength,final:mod.HEAPU8.byteLength,same:true};r.status='passed';
 }catch(e){r.status='failed';r.error={message:e.message,stack:e.stack};}return r;
}
