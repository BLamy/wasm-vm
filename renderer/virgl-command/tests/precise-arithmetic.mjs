// Actual compiler output passes unchanged to the shared draw renderer.
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
import {digest} from '../../virgl-shader/tests/browser.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer} from '../state.mjs';
import {bank,expected,kernelVectors,proof} from '../../../tools/virgl-precise-arithmetic/oracle.mjs';
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const equal=(a,b,message)=>require(JSON.stringify(a)===JSON.stringify(b),message);
const ok=(value,message)=>{require(value?.ok===true,message+': '+JSON.stringify(value));return value;};
const clone=value=>JSON.parse(JSON.stringify(value));
function bits(value){const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,value,true);return v.getUint32(0,true);}
function packet(op,type,words){const bytes=new Uint8Array(4+words.length*4),view=new DataView(bytes.buffer);view.setUint32(0,op+type*256+words.length*65536,true);words.forEach((x,i)=>view.setUint32(4+4*i,x,true));return bytes;}
function join(...parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function shaderPacket(handle,stage,text){const b=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
const bind=(handle,stage)=>packet(31,0,[handle,stage]);
const constants=(stage,words)=>packet(12,0,[stage,0,...words]);
const CLEAR=packet(7,0,[4,0,0,bits(1),bits(1),0,0,0]);
function instrument(gl,report){
 const ids=new WeakMap(),locations=new WeakMap(),live=new Map(),objects=[];let serial=0;
 const record=(call,fields={})=>report.glEvents.push({sequence:report.glEvents.length,call,...fields});
 const id=o=>o?ids.get(o)??null:null;
 const kinds={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createVertexArray:'VertexArray',createFramebuffer:'Framebuffer',createSampler:'Sampler'};
 const proxy=new Proxy(gl,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return(...args)=>{
  require(key!=='finish','no blocking finish');const actual=fn.apply(target,args);
  if(kinds[key]&&actual){const name=kinds[key]+':'+ ++serial;ids.set(actual,name);live.set(name,kinds[key]);objects.push({object:actual,name,kind:kinds[key]});record(key,{id:name});}
  if(/^delete/.test(key)&&args[0]){record(key,{id:id(args[0])});live.delete(id(args[0]));}
  if(key==='getUniformLocation'&&actual)locations.set(actual,{name:args[1],programId:id(args[0])});
  if(key==='shaderSource')record(key,{id:id(args[0]),source:args[1]});
  if(key==='attachShader')record(key,{programId:id(args[0]),shaderId:id(args[1])});
  if(key==='compileShader')record(key,{id:id(args[0]),status:target.getShaderParameter(args[0],gl.COMPILE_STATUS),log:target.getShaderInfoLog(args[0])});
  if(key==='linkProgram')record(key,{id:id(args[0]),status:target.getProgramParameter(args[0],gl.LINK_STATUS),log:target.getProgramInfoLog(args[0])});
  if(key==='uniform4uiv'){
   const location=locations.get(args[0]),program=target.getParameter(gl.CURRENT_PROGRAM),observed=[];require(location,'recorded actual uniform location');
   for(let i=0;i<args[1].length/4;i++){const at=target.getUniformLocation(program,location.name.replace(/\[0\]$/,'')+'['+i+']');require(at,'actual uploaded bank element');observed.push(...target.getUniform(program,at));}
   record(key,{...location,words:[...args[1]],observed,currentProgramId:id(program)});
  }
  if(['drawElements','useProgram','bindFramebuffer','bindVertexArray'].includes(key))record(key,{programId:id(target.getParameter(gl.CURRENT_PROGRAM)),arguments:args.map(x=>typeof x==='number'?x:id(x))});
  return actual;
 };}});
 return{gl:proxy,id,finish(){equal(live.size,0,'release every actual GPU object');for(const o of objects)equal(gl['is'+o.kind](o.object),false,'native object deleted');report.objects={created:objects.length,live:live.size};}};
}
function countedSource(source,markers){
 if(!source.includes('uint raw_exact_jam('))return source;
 const anchor=' raw_rhs = uvec4((raw_temp[117].x >>';
 equal(source.split(anchor).length,2,'one unmodified bit-plane observer');
 source=source.replace('uint raw_exact_jam(', 'uvec2 raw_exact_hits = uvec2(0u);\nuint raw_exact_jam(');
 source=source.replace(/\/\* exact:([a-z-]+) \*\//g,(match,name)=>{
  const index=markers.indexOf(name);require(index>=0,'source-bound helper marker');
  return match+' raw_exact_hits.'+(index<32?'x':'y')+' |= '+(2**(index%32))+'u;';
 });
 return source.replace(anchor,' raw_temp[117] = uvec4(raw_exact_hits, 0u, 0u);\n'+anchor);
}
function makeRig(gl,bridge,report,markers=null){
 report.glEvents=[];report.translations=[];report.submissions=[];report.draws=[];
 const watch=instrument(gl,report),allocations=new Map(),backend=ok(createWebGL2TransferBackend(watch.gl),'actual transfer backend').backend;
 const wrapped={...backend,allocate(meta){const value=backend.allocate(meta);allocations.set(meta.id,value);return value;}};
 const {store,bindings}=ok(createResourceStore({backend:wrapped}),'owned resource store');
 const counted=value=>!markers||value.ok===false?value:Object.hasOwn(value,'vertex')?{...value,vertex:counted(value.vertex),fragment:counted(value.fragment)}:{...value,glsl:countedSource(value.glsl,markers)};
 const capability={
  translate(request){const actual=bridge.translate(request),result=counted(actual);report.translations.push({kind:'single',request:clone(request),actual:clone(actual),result:clone(result)});return result;},
  translatePair(request){const actual=bridge.translatePair(request),result=counted(actual);report.translations.push({kind:'pair',request:clone(request),actual:clone(actual),result:clone(result)});return result;}
 };
 const renderer=ok(createVirglDrawRenderer({gl:watch.gl,resources:store,bindings,shaderBridge:capability}),'actual shared draw renderer').renderer;
 const run=(bytes,label)=>{const eventsStart=report.glEvents.length,result=renderer.executeSubmission(1,bytes);report.submissions.push({label,bytes:[...bytes],eventsStart,eventsEnd:report.glEvents.length,result:clone(result)});return ok(result,label);};
 return{gl,watch,store,allocations,renderer,run,report,dispose(){ok(renderer.dispose(),'renderer disposal');report.finalBudgets=ok(renderer.inspect(),'disposed renderer').budgets;Object.values(report.finalBudgets).forEach(x=>equal(x,0,'zero renderer budget'));ok(store.dispose(),'resource disposal');report.finalResourceBudgets=ok(store.inspect(),'disposed resource store').budgets;Object.values(report.finalResourceBudgets).forEach(x=>equal(x,0,'zero resource budget'));equal(gl.getError(),gl.NO_ERROR,'no final GL error');watch.finish();}};
}
function resources(rig){
 const positions=[],selectors=[],inputs=[],indices=[];
 for(let bit=0;bit<32;bit++){const first=positions.length/2;for(const[dx,dy]of[[0,0],[1,0],[1,1],[0,1]]){positions.push(-1+(bit+dx)/16,-1+dy*2);selectors.push((96+bit)*8388608+4194304,96*8388608+4194304);inputs.push(0x3e800000,0x3f400000);}indices.push(first,first+1,first+2,first,first+2,first+3);}
 const words=[];for(let i=0;i<positions.length/2;i++)words.push(...positions.slice(i*2,i*2+2).map(bits),...selectors.slice(i*2,i*2+2),...inputs.slice(i*2,i*2+2),0x3f000017,0x3e000000);
 const vb=new Uint8Array(new Uint32Array(words).buffer),ib=new Uint8Array(new Uint16Array(indices).buffer);
 rig.report.geometry={width:64,height:2,stride:32,vertexWords:words,indexWords:indices};rig.report.resourceInputs=[];
 const definitions=[{id:101,target:0,format:64,bind:16,width:vb.length,height:1,bytes:vb},{id:102,target:0,format:64,bind:32,width:ib.length,height:1,bytes:ib},{id:103,target:2,format:67,bind:10,width:64,height:2,bytes:new Uint8Array(64*2*4)}];
 for(const x of definitions){
  const{id,target,format,bind,width,height,bytes}=x;ok(rig.store.createResource({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'actual resource');ok(rig.store.attachBacking(id,[bytes]),'actual backing');rig.report.resourceInputs.push({id,target,format,bind,width,height,bytes:[...bytes]});
 }
 ok(rig.store.createContext(1),'resource context');ok(rig.renderer.createContext(1),'renderer context');
 for(const x of definitions){ok(rig.store.attachContext(1,x.id),'resource membership');if(x.id===103)continue;const ticket=ok(rig.store.prepareTransfer(1,{opcode:43,fields:{resourceHandle:x.id,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:x.width,height:x.height,depth:1},dataOffset:0,direction:1}}),'actual resource upload preparation').ticket;ok(rig.store.executeTransfer(ticket),'actual resource upload');}
 rig.report.bufferReadbacks=[];
 for(const id of[101,102]){const storage=rig.allocations.get(id),input=rig.report.resourceInputs.find(x=>x.id===id),bytes=new Uint8Array(input.bytes.length);rig.gl.bindBuffer(rig.gl.COPY_READ_BUFFER,storage.buffer);rig.gl.getBufferSubData(rig.gl.COPY_READ_BUFFER,0,bytes);rig.gl.bindBuffer(rig.gl.COPY_READ_BUFFER,null);equal([...bytes],input.bytes,'actual immutable input buffer bytes');rig.report.bufferReadbacks.push({resourceId:id,bytes:[...bytes]});}
 equal(rig.gl.getError(),rig.gl.NO_ERROR,'actual buffer upload/readback');
 rig.draw=()=>packet(8,0,[0,indices.length,4,1,1,0,0,0,0,0,4095,0]);
}
function setup(rig,vertex,fragment,words){
 const initial=join(shaderPacket(1,0,vertex),shaderPacket(2,1,fragment),packet(1,8,[10,103,67,0,0]),packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29,8,0,0,29,16,0,0,29,24,0,0,29]),packet(2,5,[11]),packet(6,0,[32,0,101]),packet(11,0,[102,2,0]),packet(4,0,[0,bits(32),bits(1),bits(.5),bits(32),bits(1),bits(.5)]),bind(1,0));
 rig.run(initial,'actual shader/resource setup');rig.run(join(constants(0,words),constants(1,words)),'owned complete initial banks');rig.run(packet(52,0,[1,2,0,0,0,0]),'actual native pair link');rig.run(bind(2,1),'select fragment');
}
function readPixels(rig){const gl=rig.gl,old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),fb=rig.watch.gl.createFramebuffer();try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rig.allocations.get(103).texture,0);equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'independent complete readback framebuffer');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);const bytes=new Uint8Array(64*2*4);gl.readPixels(0,0,64,2,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'actual framebuffer readback');return bytes;}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);rig.watch.gl.deleteFramebuffer(fb);}}
async function draw(rig,kernel,vector,markers=null){
 const words=bank(kernel,vector);rig.run(join(constants(0,words),constants(1,words)),vector.name+' immutable banks');rig.run(CLEAR.slice(),'deterministic clear');const result=rig.run(rig.draw(),vector.name+' shared draw'),bytes=readPixels(rig),oracle=expected(kernel,vector),reconstructed=[0n,0n,0n,0n];
 const record={vector:clone(vector),bank:words,oracle,submission:rig.report.submissions.length-1,draw:result.draws[0],rgbaBytes:[...bytes],rgbaSha256:await digest(bytes),words:null,checkedPixels:128};rig.report.draws.push(record);
 const wanted=oracle.words;
 for(let y=0;y<2;y++)for(let x=0;x<64;x++){
  const pixel=[...bytes.slice((64*y+x)*4,(64*y+x+1)*4)];let expectedPixel;
  expectedPixel=markers?[...bytes.slice(Math.floor(x/2)*8,Math.floor(x/2)*8+4)]:kernel.op==='ORIGINAL'?oracle.color:wanted.map(word=>((word>>>Math.floor(x/2))&1)*255);
  if(markers)require(pixel.every(value=>value===0||value===255),'physical branch flags are binary');
  if(JSON.stringify(pixel)!==JSON.stringify(expectedPixel)){record.failure??={x,y,expectedPixel,observedPixel:pixel};throw new Error(kernel.case+'/'+vector.name+' independent exact word pixel mismatch: '+JSON.stringify(record.failure));}
  if(kernel.op!=='ORIGINAL'&&y===0&&x%2===0)for(let lane=0;lane<4;lane++)reconstructed[lane]|=BigInt(pixel[lane]/255)<<BigInt(x/2);
 }
 if(kernel.op!=='ORIGINAL'){
  const words=reconstructed.map(Number);
  if(markers){record.counterWords=words;record.helperBranches=markers.filter((_,i)=>((words[i<32?0:1]>>>(i%32))&1)!==0);equal(words.slice(2),[0,0],'unused counter lanes');}
  else{record.words=words;equal(record.words,wanted,'all physical reconstructed words');}
 }
 return record;
}
async function source(name){const response=await fetch('/'+name);require(response.ok,'exact source '+name);const text=await response.text();return{path:name,sha256:await digest(text),bytes:new TextEncoder().encode(text).length,text};}
export async function runAcceptance({faultWasm=null,faultKernel=null,faultVector=null,seed=0x5e74bf09}={}) {
 const report={schema:'precise-arithmetic-gpu-v1',status:'running',guestExecution:false,seed:seed>>>0,
  rigs:[],helperCoverage:[],checkedWords:0,checkedPixels:0,drawCount:0,proof:proof(seed)};
 window.__virglPreciseArithmeticReport=report;
 try {
  let module;const options={onRuntimeInitialized(){module=this;}};
  if(faultWasm){const response=await fetch(faultWasm);require(response.ok,'actual compiler fault artifact');options.wasmBinary=new Uint8Array(await response.arrayBuffer());report.faultWasmSha256=await digest(options.wasmBinary);}
  const bridge=await createVirglShaderBridge(options);equal(module.HEAPU8.byteLength,16777216,'fixed compiler Wasm memory');
  const input=await source('renderer/virgl-shader/tests/precise-arithmetic-cases.json'),fixture=JSON.parse(input.text);
  report.fixture={path:input.path,sha256:input.sha256,bytes:input.bytes};
  const old=await source('renderer/virgl-command/tests/bounded-loops-shaders.json'),partners=JSON.parse(old.text);
  report.partners={path:old.path,sha256:old.sha256,bytes:old.bytes};
  const canvas=document.querySelector('#gpu');canvas.width=64;canvas.height=2;
  const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
  require(gl instanceof WebGL2RenderingContext,'actual WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'hardware identity');
  report.renderer={vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)};
  require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'actual hardware renderer');
  const passVertex=partners.shaders.find(e=>e.name==='pass-vertex').text,passFragment=partners.shaders.find(e=>e.name==='pass-fragment').text;
  require(!(faultKernel||faultVector)||faultWasm,'source-fault schedules require an actual fault artifact');
  const kernels=faultKernel?fixture.kernels.filter(k=>k.case===faultKernel):fixture.kernels;
  require(kernels.length>0,'literal source-fault kernel');
  for(const kernel of kernels){
   const entry=fixture.cases.find(e=>e.name===kernel.case),record={kernel:clone(kernel),input:entry.name},rig=makeRig(gl,bridge,record);
   if(kernel.op==='ORIGINAL'){const original=await source(kernel.originalPath);equal(original.text,entry.text,'unchanged original body');equal(original.sha256,kernel.originalSha256,'unchanged original hash');record.original={path:original.path,sha256:original.sha256,bytes:original.bytes};}
   report.rigs.push(record);
   try{
    const vectors=kernelVectors(kernel,seed).filter(v=>!faultVector||v.name===faultVector);require(vectors.length>0,'literal source-fault vector');resources(rig);
    setup(rig,kernel.stage==='vertex'?entry.text:passVertex,kernel.stage==='fragment'?entry.text:passFragment,bank(kernel,vectors[0]));
    for(const vector of vectors){const captured=await draw(rig,kernel,vector);report.checkedWords+=captured.words?4:0;report.checkedPixels+=captured.checkedPixels;report.drawCount++;}
   }finally{rig.dispose();}
  }
  // A separate GPU run observes marker hits. It never replaces the exact-word
  // run above or changes its sources. Both source versions are recorded.
  const header=await source('renderer/virgl-shader/raw_binary32.h');
  const markers=[...header.text.matchAll(/\/\* exact:([a-z-]+) \*\//g)].map(match=>match[1]);
  require(markers.length<=64&&new Set(markers).size===markers.length,'bounded unique source markers');
  report.helperHeader={path:header.path,sha256:header.sha256,bytes:header.bytes,markers};
  for(const kernel of fixture.kernels.filter(k=>k.variant==='direct'&&['ADD','CHAIN'].includes(k.op)&&k.mask==='xyzw')){
   const entry=fixture.cases.find(e=>e.name===kernel.case),record={kernel:clone(kernel),input:entry.name,instrumentation:'helper-branch-flags-v1'},rig=makeRig(gl,bridge,record,markers);
   report.helperCoverage.push(record);
   try{
    const vectors=kernelVectors(kernel,seed);resources(rig);
    setup(rig,kernel.stage==='vertex'?entry.text:passVertex,kernel.stage==='fragment'?entry.text:passFragment,bank(kernel,vectors[0]));
    for(const vector of vectors)await draw(rig,kernel,vector,markers);
    record.executed=markers.filter(name=>record.draws.some(d=>d.helperBranches.includes(name)));
   }finally{rig.dispose();}
  }
  report.helperCoverageByStage=Object.fromEntries(['vertex','fragment'].map(stage=>[stage,markers.filter(name=>report.helperCoverage.some(r=>r.kernel.stage===stage&&r.executed.includes(name)))]));
  for(const stage of ['vertex','fragment'])equal(report.helperCoverageByStage[stage],markers,'every binary32 helper marker executed in '+stage);
  report.status='passed';document.querySelector('#status').textContent=report.checkedWords+' exact words rounded binary32 words through shared renderer';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
 }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;return report;}
}
