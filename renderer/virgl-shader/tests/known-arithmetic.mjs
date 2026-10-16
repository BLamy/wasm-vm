import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {physicalPlan,carrier,bytesFragment,mathCarrier,PARTNER_VERTEX,PARTNER_FRAGMENT,getCases,SEEDS} from '../../../tools/virgl-known-arithmetic/cases.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../../virgl-command/resources.mjs';
import {createVirglStateRenderer,createVirglAsyncRenderer} from '../../virgl-command/state.mjs';
const require=(v,label)=>{if(!v)throw new Error(label);},equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
const bits=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
function monitor(native,report){
 const live=new Map(),objects=[],ids=new WeakMap();let serial=0;
 const kinds={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createFramebuffer:'Framebuffer',createVertexArray:'VertexArray',createTransformFeedback:'TransformFeedback',createSampler:'Sampler'};
 const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
  const result=value.apply(target,args);if(kinds[key]&&result){const id=kinds[key]+':'+(++serial);ids.set(result,id);live.set(id,kinds[key]);objects.push({id,kind:kinds[key],object:result});}
  if(/^delete/.test(key)&&args[0])live.delete(ids.get(args[0]));
  if(key==='shaderSource')report.events.push({call:key,source:args[1]});
  if(key==='uniform4uiv')report.events.push({call:key,words:[...args[1]]});return result;
 };}});
 return{gl,finish(){equal(live.size,0,'all GL objects disposed');for(const o of objects)equal(native['is'+o.kind](o.object),false,'physical deletion '+o.id);report.objects={created:objects.length,live:live.size};}};
}
function faultSource(source,fault){
 if(!fault)return{source,mutation:null};
 const expression=fault==='word'?/\/\* known:word \*\/ raw_rhs\.([xyzw]) = (\d+)u;/:/\/\* known:shadow \*\/ uintBitsToFloat\((\d+)u\)/;
 const match=source.match(expression);require(match,'fault reaches literal emission');
 const replacement=fault==='word'?`/* known:word */ raw_rhs.${match[1]} = (${match[2]}u ^ 1u);`:'/* known:shadow */ uintBitsToFloat(1069547520u)';
 const changed=source.replace(expression,replacement);return{source:changed,mutation:{fault,original:source,served:changed,needle:match[0],replacement}};
}
async function vertexProbe(gl,bridge,row,report,fault){
 const text=carrier(row),pair=bridge.translatePair({vertexText:text,fragmentText:PARTNER_FRAGMENT});require(pair.ok,'known carrier pair');
 const changed=faultSource(pair.vertex.glsl,fault),built=createProgram(gl,{...pair.vertex,glsl:changed.source},pair.fragment),program=built.program;
 const buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();require(vao&&feedback&&output,'physical feedback objects');buffers.push(output);
 const record={row,text,textSha256:await digest(text),pair,mutation:changed.mutation,logs:built.logs,reflection:[],vectors:[]};report.vertices.push(record);
 try{
  const varyings=['gl_Position','vso_g0','vso_g1','vso_g2','vso_g3'];gl.transformFeedbackVaryings(program,varyings,gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),'feedback relink');
  for(let i=0;i<5;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.type,info.size],[varyings[i],gl.FLOAT_VEC4,1],'physical varying reflection');record.reflection.push({name:info.name,type:info.type,size:info.size});}
  gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  const at=gl.getAttribLocation(program,'in_0'),zero=gl.getAttribLocation(program,'in_1');require(at>=0&&zero>=0,'physical dynamic numeric input');gl.disableVertexAttribArray(at);gl.disableVertexAttribArray(zero);gl.vertexAttrib4fv(zero,new Float32Array([0,0,0,0]));
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,80,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);
  for(const position of [[-.5,-.25,.125,1],[.25,.5,-.125,1]]){
   const wanted=[...position.map(bits),...row.words.map(w=>((w&0x7fffff)|0x3f000000)>>>0),...row.words.map(w=>((w>>>23)|0x3f000000)>>>0),...row.numeric,...row.words];
   const entry={position,expectedWords:wanted};record.vectors.push(entry);gl.vertexAttrib4fv(at,new Float32Array(position));
   gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const raw=new Uint8Array(80);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,raw);equal(gl.getError(),gl.NO_ERROR,'feedback errors');entry.bytes=[...raw];entry.sha256=await digest(raw);entry.observed=[...new Uint32Array(raw.buffer)];
   for(let lane=0;lane<20;lane++){
    // Numeric zero sign is not a new ordinary highp encoding guarantee. The
    // independent raw carriers still check both source zero signs exactly.
    const numericZero=lane>=16&&(wanted[lane]&0x7fffffff)===0&&(entry.observed[lane]&0x7fffffff)===0;
    if(entry.observed[lane]!==wanted[lane]&&!numericZero){entry.failure={lane,expected:wanted[lane],actual:entry.observed[lane]};throw new Error('independent known word mismatch '+row.name);}
   }
   entry.checkedWords=20;
  }
 }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
async function fragmentProbe(gl,bridge,row,lane,converted,report){
 const text=bytesFragment(row,lane,converted),pair=bridge.translatePair({vertexText:PARTNER_VERTEX,fragmentText:text});require(pair.ok,'known byte pair');
 const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer(),target=texture2d(gl,4,4,null);require(vao&&fb,'physical byte objects');
 const word=(converted?row.integers:row.words)[lane],wanted=[0,8,16,24].map(shift=>(word>>>shift)&255),record={row,text,lane,converted,textSha256:await digest(text),pair,logs:built.logs,expectedBytes:wanted};report.fragments.push(record);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  const mesh=gl.createBuffer();require(mesh,'physical mesh');buffers.push(mesh);gl.bindBuffer(gl.ARRAY_BUFFER,mesh);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),gl.STATIC_DRAW);
  const at=gl.getAttribLocation(program,'in_0');require(at>=0,'position attribute');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'physical RGBA8');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);gl.viewport(0,0,4,4);gl.colorMask(true,true,true,true);
  gl.clearColor(.1,.2,.3,.4);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);const raw=new Uint8Array(64);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'physical byte errors');record.bytes=[...raw];record.sha256=await digest(raw);
  for(let pixel=0;pixel<16;pixel++)equal([...raw.slice(pixel*4,pixel*4+4)],wanted,'independent literal byte prediction');record.checkedPixels=16;
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteTexture(target);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
const packet=(op,type,words)=>{const bytes=new Uint8Array(4+words.length*4),view=new DataView(bytes.buffer);view.setUint32(0,op+type*256+words.length*65536,true);words.forEach((w,i)=>view.setUint32(4+4*i,w,true));return bytes;};
async function mathProbe(gl,bridge,producer,consumer,report){
 const x=producer==='ADD'?.75:.125,expected=consumer==='SIN'?Math.sin(x):consumer==='POW'?x*x:consumer==='EX2'?2**x:Math.log2(x),budget=consumer==='POW'?Math.abs(expected)*2**-14:2**-20*Math.max(1,Math.abs(expected));
 const text=mathCarrier(producer,consumer),pair=bridge.translatePair({vertexText:text,fragmentText:PARTNER_FRAGMENT});require(pair.ok,'physical math pair');const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();require(vao&&feedback&&output,'physical math feedback');buffers.push(output);
 const record={producer,consumer,text,pair,expected,budget,logs:built.logs,reflection:[]};report.math.push(record);
 try{
  gl.transformFeedbackVaryings(program,['gl_Position','vso_g0'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),'math feedback link');for(let i=0;i<2;i++){const v=gl.getTransformFeedbackVarying(program,i);record.reflection.push({name:v.name,type:v.type,size:v.size});}
  gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);const at=gl.getAttribLocation(program,'in_0');require(at>=0,'math position');gl.disableVertexAttribArray(at);gl.vertexAttrib4fv(at,new Float32Array([0,0,0,1]));
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const bytes=new Uint8Array(32);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,bytes);equal(gl.getError(),gl.NO_ERROR,'math feedback errors');record.bytes=[...bytes];record.sha256=await digest(bytes);record.observed=[...new Float32Array(bytes.buffer)];equal(record.observed.slice(0,4),[0,0,0,1],'math position');
  for(const y of record.observed.slice(4))require(Number.isFinite(y)&&Math.abs(y-expected)<=budget,'independent known '+consumer+' equation');record.checkedWords=8;
 }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
const joined=(...parts)=>{const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;};
function shaderPacket(handle,stage,text){const bytes=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);bytes.set(new TextEncoder().encode(text),24);return bytes;}
async function consumerProbe(gl,bridge,asynchronous,seed,report){
 const ok=(r,label)=>{require(r?.ok===true,label+': '+JSON.stringify(r));return r;},record={asynchronous,submissions:[],captures:[]};report.consumers.push(record);
 const {store,bindings,asyncAccess}=ok(createResourceStore({backend:ok(createWebGL2TransferBackend(gl),'transfer').backend}),'resources');
 const renderer=ok((asynchronous?createVirglAsyncRenderer:createVirglStateRenderer)({gl,resources:store,bindings,shaderBridge:bridge,...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:1+seed%3}}:{})}),'consumer').renderer;
 const snapshot=()=>ok(renderer.inspect(),'snapshot');
 async function submit(bytes,label){const entry={label,before:[...bytes],steps:[]};record.submissions.push(entry);let result;
  if(!asynchronous){result=renderer.executeSubmission(1,bytes);bytes.fill(255);}else{const begun=renderer.beginSubmission(1,bytes);bytes.fill(255);entry.begin=begun;if(!begun.ok)result=begun;else for(let i=0;i<128;i++){const step=ok(renderer.step(begun.job),'step');entry.steps.push(step);if(step.status==='done'){result=step.result;break;}await new Promise(resolve=>setTimeout(resolve,0));}}
  require(result,'bounded completion');entry.after=[...bytes];entry.result=result;return result;
 }
 try{
  ok(store.createContext(1),'resource context');ok(renderer.createContext(1),'shader context');const text=getCases().find(c=>c.name==='direct-bank-composition').text;record.sources={vertexText:PARTNER_VERTEX,fragmentText:text};
  ok(await submit(joined(shaderPacket(1,0,PARTNER_VERTEX),shaderPacket(2,1,text),packet(31,0,[1,0]),packet(31,0,[2,1]),packet(52,0,[1,2,0,0,0,0])),'actual create/link'),'create/link');
  for(const word of [0x3fc00000,0xc0000000,0]){const words=Array(184).fill(0);words[0]=word;ok(await submit(packet(12,0,[1,0,...words]),'owned safe bank'),'bank replacement');
   const state=snapshot(),program=gl.getParameter(gl.CURRENT_PROGRAM),at=gl.getUniformLocation(program,'fsconst0[0]');require(at,'physical guarded bank');equal([...gl.getUniform(program,at)],words.slice(0,4),'physical copied words');record.captures.push({snapshot:state,observed:[...gl.getUniform(program,at)]});ok(renderer.restoreContext(1),'context restoration');}
  record.deferredBanks=[];
  for(const word of [0x4f000000,0xcf000001]){const words=Array(184).fill(0);words[0]=word;const program=gl.getParameter(gl.CURRENT_PROGRAM),at=gl.getUniformLocation(program,'fsconst0[0]'),prior=[...gl.getUniform(program,at)],events=report.events.length;
   const r=await submit(packet(12,0,[1,0,...words]),'finite out-of-range bank');equal(r.ok,true,'finite CPU bank retained');equal([...gl.getUniform(program,at)],prior,'unapproved bank never uploaded');equal(report.events.length,events,'no unsafe native writes');record.deferredBanks.push({word,result:r,snapshot:snapshot(),prior,observed:[...gl.getUniform(program,at)]});}
  const words=Array(184).fill(0);words[0]=0x7f800000;const before=snapshot(),events=report.events.length,r=await submit(packet(12,0,[1,0,...words]),'nonfinite wire bank');equal(r.ok,false,'wire rejection');equal(r.appliedCommands,0,'atomic wire bank');equal(snapshot(),before,'unchanged rejected wire state');equal(report.events.length,events,'no native writes on wire rejection');record.rejection={before,after:snapshot(),result:r};
 }finally{ok(renderer.dispose(),'consumer disposal');record.finalBudgets=snapshot().budgets;require(Object.values(record.finalBudgets).every(n=>n===0),'zero consumer budgets');ok(store.dispose(),'store disposal');record.finalResourceBudgets=ok(store.inspect(),'resources final').budgets;require(Object.values(record.finalResourceBudgets).every(n=>n===0),'zero resources');gl.useProgram(null);}
}
export async function runAcceptance({seed=SEEDS[0],fault=null}={}){
 const report={schema:'virgl-known-arithmetic-gpu-v1',status:'running',guestExecution:false,productionNegotiation:false,seed,fault,vertices:[],fragments:[],math:[],consumers:[],events:[]};window.__virglKnownArithmeticReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=4;const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(native instanceof WebGL2RenderingContext,'actual WebGL2');
 const debug=native.getExtension('WEBGL_debug_renderer_info');require(debug,'physical renderer identity');report.renderer={vendor:native.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:native.getParameter(debug.UNMASKED_RENDERER_WEBGL)};require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer.renderer),'physical hardware');
 const managed=monitor(native,report),gl=managed.gl,bridge=await createVirglShaderBridge();
 try{
  const plan=physicalPlan(seed);report.plan=plan;report.planSha256=await digest(JSON.stringify(plan));
  for(let i=0;i<plan.length;i++){const row=plan[i];await vertexProbe(gl,bridge,row,report,i===0?fault:null);for(let lane=0;lane<4;lane++)for(const converted of [false,true])await fragmentProbe(gl,bridge,row,lane,converted,report);}
  for(const producer of ['ADD','MUL'])for(const consumer of ['SIN','POW','EX2','LG2'])await mathProbe(gl,bridge,producer,consumer,report);
  for(const asynchronous of [false,true])await consumerProbe(gl,bridge,asynchronous,seed,report);
  report.checkedWords=report.vertices.reduce((n,v)=>n+v.vectors.reduce((a,b)=>a+b.checkedWords,0),0)+report.math.reduce((n,v)=>n+v.checkedWords,0);report.checkedPixels=report.fragments.reduce((n,f)=>n+f.checkedPixels,0);report.status='passed';document.querySelector('#status').textContent=`${report.checkedWords} carrier/conversion/shadow words; ${report.checkedPixels} byte pixels. Passed.`;return report;
 }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};throw error;}finally{managed.finish();}
}
