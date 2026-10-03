// Compiler results pass unchanged to the production shared draw renderer.
// Observer/poison modes are explicit source-bound diagnostic instrumentation.
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
import {digest} from '../../virgl-shader/tests/browser.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer} from '../state.mjs';
import {bank,expected} from './selected-lanes-oracle.mjs';
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
function observerSource(stage,result,kernel,mode,poison){
 if(typeof result.glsl!=='string'||stage!==kernel.stage||mode==='normal')return result;
 let code=result.glsl;const seam=' highp vec4 float_rhs;\n';require(code.split(seam).length===2,'one physical shadow declaration');
 if(mode==='observer'){
  code=code.replace(seam,seam+' highp uint demand_reads = 0u;\n');
  const mark=' /* guarded interpolation */\n',start=code.indexOf(mark);require(start>=0&&code.indexOf(mark,start+1)<0,'one source-bound guarded interpolation');
  const brace=code.indexOf('{\n',start);require(brace>start,'actual emitted guard block');code=code.slice(0,brace+2)+' demand_reads = 1u;\n'+code.slice(brace+2);
  const end=code.lastIndexOf('}\n');require(end>=0,'closed actual shader');
  code=code.slice(0,end)+' '+(stage==='vertex'?'vso_g0':'fsout_c0')+' = vec4(float(demand_reads));\n'+code.slice(end);
 }else{
  require(mode==='poison'&&Array.isArray(poison)&&poison.length===4,'explicit diagnostic poison');
  const r=kernel.roles.payload;
  code=code.replace(seam,seam+` raw_temp[${r}] = uvec4(${poison.map(x=>x+'u').join(', ')});\n float_temp[${r}] = uintBitsToFloat(raw_temp[${r}]);\n`);
 }
 return{...result,glsl:code};
}
function makeRig(gl,bridge,report,kernel,mode='normal',poison=null){
 report.glEvents=[];report.translations=[];report.submissions=[];report.draws=[];
 const watch=instrument(gl,report),allocations=new Map(),backend=ok(createWebGL2TransferBackend(watch.gl),'actual transfer backend').backend;
 const wrapped={...backend,allocate(meta){const value=backend.allocate(meta);allocations.set(meta.id,value);return value;}};
 const {store,bindings}=ok(createResourceStore({backend:wrapped}),'owned resource store');
 const capability={
  translate(request){const actual=bridge.translate(request),result=observerSource(request.stage,actual,kernel,mode,poison);report.translations.push({kind:'single',request:clone(request),actual:clone(actual),result:clone(result)});return result;},
  translatePair(request){const actual=bridge.translatePair(request),result=actual.ok?{...actual,vertex:observerSource('vertex',actual.vertex,kernel,mode,poison),fragment:observerSource('fragment',actual.fragment,kernel,mode,poison)}:actual;report.translations.push({kind:'pair',request:clone(request),actual:clone(actual),result:clone(result)});return result;}
 };
 const renderer=ok(createVirglDrawRenderer({gl:watch.gl,resources:store,bindings,shaderBridge:capability}),'actual shared draw renderer').renderer;
 const run=(bytes,label)=>{const eventsStart=report.glEvents.length,result=renderer.executeSubmission(1,bytes);report.submissions.push({label,bytes:[...bytes],eventsStart,eventsEnd:report.glEvents.length,result:clone(result)});return ok(result,label);};
 return{gl,watch,store,allocations,renderer,run,report,dispose(){ok(renderer.dispose(),'renderer disposal');report.finalBudgets=ok(renderer.inspect(),'disposed renderer').budgets;Object.values(report.finalBudgets).forEach(x=>equal(x,0,'zero renderer budget'));ok(store.dispose(),'resource disposal');report.finalResourceBudgets=ok(store.inspect(),'disposed resource store').budgets;Object.values(report.finalResourceBudgets).forEach(x=>equal(x,0,'zero resource budget'));equal(gl.getError(),gl.NO_ERROR,'no final GL error');watch.finish();}};
}
function resources(rig){
 const positions=[],selectors=[],inputs=[],indices=[];
 for(let bit=0;bit<32;bit++){const first=positions.length/2;for(const[dx,dy]of[[0,0],[1,0],[1,1],[0,1]]){positions.push(-1+(bit+dx)/16,-1+dy/16);selectors.push((96+bit)*8388608+4194304,96*8388608+4194304);inputs.push(0x3e800000,0x3f400000);}indices.push(first,first+1,first+2,first,first+2,first+3);}
 const words=[];for(let i=0;i<positions.length/2;i++)words.push(...positions.slice(i*2,i*2+2).map(bits),...selectors.slice(i*2,i*2+2),...inputs.slice(i*2,i*2+2),0x3f000017,0x3e000000);
 const vb=new Uint8Array(new Uint32Array(words).buffer),ib=new Uint8Array(new Uint16Array(indices).buffer);
 rig.report.geometry={width:64,height:64,stride:32,vertexWords:words,indexWords:indices};rig.report.resourceInputs=[];
 const definitions=[{id:101,target:0,format:64,bind:16,width:vb.length,height:1,bytes:vb},{id:102,target:0,format:64,bind:32,width:ib.length,height:1,bytes:ib},{id:103,target:2,format:67,bind:10,width:64,height:64,bytes:new Uint8Array(64*64*4)}];
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
 const initial=join(shaderPacket(1,0,vertex),shaderPacket(2,1,fragment),packet(1,8,[10,103,67,0,0]),packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29,8,0,0,29,16,0,0,29,24,0,0,29]),packet(2,5,[11]),packet(6,0,[32,0,101]),packet(11,0,[102,2,0]),packet(4,0,[0,bits(32),bits(32),bits(.5),bits(32),bits(32),bits(.5)]),bind(1,0));
 rig.run(initial,'actual shader/resource setup');rig.run(join(constants(0,words),constants(1,words)),'owned complete initial banks');rig.run(packet(52,0,[1,2,0,0,0,0]),'actual native pair link');rig.run(bind(2,1),'select fragment');
}
function readPixels(rig){const gl=rig.gl,old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),fb=rig.watch.gl.createFramebuffer();try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rig.allocations.get(103).texture,0);equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'independent complete readback framebuffer');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);const bytes=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'actual framebuffer readback');return bytes;}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);rig.watch.gl.deleteFramebuffer(fb);}}
async function draw(rig,kernel,vector,fixture,mode,expectedPoison=null,allowMismatch=false){
 const words=bank(vector);rig.run(join(constants(0,words),constants(1,words)),vector.name+' immutable banks');rig.run(CLEAR.slice(),'deterministic clear');const result=rig.run(rig.draw(),vector.name+' shared draw'),bytes=readPixels(rig),oracle=expected(kernel,vector,fixture),reconstructed=[0n,0n,0n,0n];
 const record={vector:clone(vector),bank:words,oracle,submission:rig.report.submissions.length-1,draw:result.draws[0],rgbaBytes:[...bytes],rgbaSha256:await digest(bytes),words:null,checkedPixels:4096};rig.report.draws.push(record);
 const wanted=expectedPoison??oracle.words;
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const pixel=[...bytes.slice((64*y+x)*4,(64*y+x+1)*4)];let expectedPixel;
  if(y>=2)expectedPixel=[0,0,255,255];else if(mode==='observer')expectedPixel=Array(4).fill(oracle.demanded?255:0);else expectedPixel=wanted.map(word=>((word>>>Math.floor(x/2))&1)*255);
  if(JSON.stringify(pixel)!==JSON.stringify(expectedPixel)){record.failure??={x,y,expectedPixel,observedPixel:pixel};if(!allowMismatch)throw new Error(kernel.name+'/'+vector.name+' independent '+mode+' pixel mismatch');}
  if(mode!=='observer'&&y===0&&x%2===0)for(let lane=0;lane<4;lane++)reconstructed[lane]|=BigInt(pixel[lane]/255)<<BigInt(x/2);
 }
 if(mode!=='observer'){record.words=reconstructed.map(Number);equal(record.words,wanted,'all physical reconstructed words');}
 return record;
}
async function source(name){const response=await fetch('/'+name);require(response.ok,'exact source '+name);const text=await response.text();return{path:name,sha256:await digest(text),bytes:new TextEncoder().encode(text).length,text};}
export async function runAcceptance({mode='normal',faultWasm=null}={}){
 require(['normal','guard-open','width-proof'].includes(mode),'closed source-fault modes');
 const report={schema:'selected-lanes-gpu-v1',status:'running',guestExecution:false,mode,rigs:[],checkedWords:0,checkedPixels:0,observerPixels:0,poisonWitness:[]};window.__virglSelectedLanesReport=report;
 try{
  let module;const options={onRuntimeInitialized(){module=this;}};
  if(faultWasm){const response=await fetch(faultWasm);require(response.ok,'actual compiler fault artifact');options.wasmBinary=new Uint8Array(await response.arrayBuffer());report.faultWasmSha256=await digest(options.wasmBinary);}
  const bridge=await createVirglShaderBridge(options);equal(module.HEAPU8.byteLength,16777216,'fixed compiler Wasm memory');
  const input=await source('renderer/virgl-shader/tests/selected-lanes-cases.json'),fixture=JSON.parse(input.text);report.fixture={path:input.path,sha256:input.sha256,bytes:input.bytes};
  const old=await source('renderer/virgl-command/tests/bounded-loops-shaders.json'),partners=JSON.parse(old.text);report.partners={path:old.path,sha256:old.sha256,bytes:old.bytes};
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=64;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(gl instanceof WebGL2RenderingContext,'actual WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'actual hardware identity');report.renderer={vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)};require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'actual hardware renderer');
  const passVertex=partners.shaders.find(x=>x.name==='pass-vertex').text,passFragment=partners.shaders.find(x=>x.name==='pass-fragment').text;
  const kernels=mode==='normal'?fixture.kernels:fixture.kernels.filter(k=>k.variant==='plain'&&k.roles.form==='a');
  for(const kernel of kernels){
   const original=fixture.cases.find(x=>x.name===kernel.case);
   const entry=mode==='width-proof'?fixture.cases.find(x=>x.name==='reject-a-nonzero-missing-width-'+kernel.stage):original;
   const vertex=kernel.stage==='vertex'?entry.text:passVertex,fragment=kernel.stage==='fragment'?entry.text:passFragment;
   const categories=mode==='width-proof'?['poison']:mode==='guard-open'?['observer']:['normal',...(kernel.variant==='plain'||kernel.variant==='old-destination'||kernel.variant==='discarded-nan'?['observer']:[])];
   for(const category of categories){
    const poisons=category==='poison'?[[0,0,0,0],[0x3f800000,0x3f800000,0x3f800000,0x3f800000]]:[null];
    for(const poison of poisons){const record={kernel:clone(kernel),input:entry.name,category,poison},rig=makeRig(gl,bridge,record,kernel,category,poison);report.rigs.push(record);
     try{
      resources(rig);setup(rig,vertex,fragment,bank(fixture.vectors[0]));
      const vectors=category==='poison'?[fixture.vectors.find(x=>x.name==='discarded')]:mode==='guard-open'?fixture.vectors.slice(0,2):fixture.vectors;
      for(const vector of vectors){const captured=await draw(rig,kernel,vector,fixture,category,category==='poison'?poison:null,mode==='guard-open');if(category==='observer')report.observerPixels+=captured.checkedPixels;else{report.checkedWords+=4;report.checkedPixels+=captured.checkedPixels;}}
     }finally{rig.dispose();}
    }
   }
  }
  if(mode==='width-proof'){
   for(const stage of['vertex','fragment']){const records=report.rigs.filter(r=>r.kernel.stage===stage);require(records.length===2,'two independent poisons');require(JSON.stringify(records[0].draws[0].words)!==JSON.stringify(records[1].draws[0].words),'actual missing-path poison reaches observable words');report.poisonWitness.push({stage,words:records.map(r=>r.draws[0].words)});}
   report.failure={message:'Missing predecessor admitted by actual width-certificate fault; independent poison changes observable words.'};throw new Error(report.failure.message);
  }
  if(mode==='guard-open'){
   for(const stage of['vertex','fragment']){const records=report.rigs.filter(r=>r.kernel.stage===stage);require(records.length===1&&records[0].draws.some(d=>d.vector.name==='discarded'&&d.failure),'actual guard fault reaches independent demand failure in both stages');}
   report.failure={message:'Actual emitter guard fault reads the discarded interpolation path; independent demand observer fails in both stages.'};throw new Error(report.failure.message);
  }
  report.status='passed';document.querySelector('#status').textContent=report.checkedWords+' exact words through shared renderer';document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
 }catch(error){report.status='failed';report.failure??={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
