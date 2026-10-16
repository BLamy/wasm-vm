// Actual compiler-produced exact preconditions, unchanged original TGSI, shared real renderers.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
import { digest } from '../../virgl-shader/tests/browser.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglDrawRenderer, createVirglAsyncRenderer } from '../state.mjs';
import { SEEDS, VERTEX, FRAGMENT, clone, literalBank } from '../../../tools/virgl-exact-producer/fixtures.mjs';
const require = (condition, label) => { if (!condition) throw new Error(label); };
const equal = (actual, expected, label) => require(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
const ok = (result, label) => { require(result?.ok === true, `${label}: ${JSON.stringify(result)}`); return result; };
const bits = (value) => { const b = new ArrayBuffer(4), v = new DataView(b); v.setFloat32(0, value, true); return v.getUint32(0, true); };
const packet = (opcode, type, words) => { const b = new Uint8Array(4 + words.length * 4), v = new DataView(b.buffer); v.setUint32(0, opcode + type * 256 + words.length * 65536, true); words.forEach((word, i) => v.setUint32(4 + 4 * i, word, true)); return b; };
const join = (...parts) => { const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { b.set(part, at); at += part.length; } return b; };
const bind = (handle, stage) => packet(31, 0, [handle, stage]);
const constants = (stage, words) => packet(12, 0, [stage, 0, ...words]);
const link = () => packet(52, 0, [1, 2, 0, 0, 0, 0]);
const CLEAR = packet(7, 0, [4, 0, 0, bits(1), bits(1), 0, 0, 0]);
const DRAW = packet(8, 0, [0, 6, 4, 1, 1, 0, 0, 0, 0, 0, 3, 0]);
const VERTICES = [-1, -1, 1, -1, 1, 1, -1, 1];
const INDICES = [0, 1, 2, 0, 2, 3];
const POISONS = [[16, -8, 4, -2], [-1, 32, -16, 8]].map(values => values.map(bits));
function shaderPacket(handle, stage, text) {
  const result = packet(1, 4, [handle, stage, text.length + 1, 256, 0, ...Array(Math.ceil((text.length + 1) / 4)).fill(0)]);
  result.set(new TextEncoder().encode(text), 24); return result;
}
function currentSub(snapshot, id) { const ctx = snapshot.contexts.find(value => value.id === id); return ctx.subContexts.find(value => value.id === ctx.currentSubContext); }
function instrument(gl,report){
  const ids=new WeakMap(),locations=new WeakMap(),objects=[],live=new Map(),fences=new WeakMap();let serial=0,fenceCount=0;
  const events=report.glEvents=[],control={label:'',mutation:null,turn:0,schedule:report.schedule??null};
  const id=o=>o?ids.get(o)??null:null,record=(call,details={})=>events.push({sequence:events.length,turn:control.turn,label:control.label,call,...details});
  const creates={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createVertexArray:'VertexArray',createFramebuffer:'Framebuffer',createSampler:'Sampler',fenceSync:'Sync'};
  const proxy=new Proxy(gl,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return(...args)=>{
    if(control.mutation&&key==='useProgram'){control.mutation.fill(0xff);record('input-mutation',{bytes:control.mutation.length});control.mutation=null;}
    const actual=fn.apply(target,args);let result=actual;
    if(creates[key]&&actual){const identity=creates[key]+':'+ ++serial;ids.set(actual,identity);objects.push({object:actual,id:identity,kind:creates[key]});live.set(identity,creates[key]);record(key,{id:identity});}
    if(/^delete/.test(key)&&args[0]){live.delete(id(args[0]));record(key,{id:id(args[0])});}
    if(key==='getUniformLocation'){if(actual)locations.set(actual,{name:args[1],programId:id(args[0])});record(key,{programId:id(args[0]),name:args[1],present:actual!==null});}
    if(key==='getUniformIndices')record(key,{programId:id(args[0]),names:[...args[1]],indices:[...actual]});
    if(key==='getActiveUniforms')record(key,{programId:id(args[0]),indices:[...args[1]],parameter:args[2],values:[...actual]});
    if(key==='shaderSource')record(key,{id:id(args[0]),source:args[1]});
    if(key==='attachShader')record(key,{programId:id(args[0]),shaderId:id(args[1])});
    if(key==='compileShader')record(key,{id:id(args[0]),status:target.getShaderParameter(args[0],gl.COMPILE_STATUS),log:target.getShaderInfoLog(args[0])});
    if(key==='linkProgram')record(key,{id:id(args[0]),status:target.getProgramParameter(args[0],gl.LINK_STATUS),log:target.getProgramInfoLog(args[0])});
    if(key==='uniform4uiv'){const location=locations.get(args[0]),program=target.getParameter(gl.CURRENT_PROGRAM),observed=[];
      for(let index=0;index<args[1].length/4;index++){const at=target.getUniformLocation(program,location.name.replace(/\[0\]$/,'')+'['+index+']');require(at!==null,'uploaded uniform element exists');observed.push(...target.getUniform(program,at));}
      record(key,{...location,words:[...args[1]],observed,currentProgramId:id(program)});
    }
    if(key==='fenceSync'){require(control.schedule,'fence belongs to an explicitly scheduled async rig');const withheld=((Math.imul(++fenceCount,1664525)+control.schedule.seed+1013904223)>>>0)%4;fences.set(actual,{turn:control.turn,lastPoll:-1,withheld});record('fenceSchedule',{id:id(actual),withheld});}
    if(key==='clientWaitSync'){const f=fences.get(args[0]);require(f&&control.turn>f.turn&&f.lastPoll!==control.turn,'fence polled at most once in a later browser task');equal(args.slice(1),[0,0],'zero-timeout async polling');f.lastPoll=control.turn;
      if((actual===gl.ALREADY_SIGNALED||actual===gl.CONDITION_SATISFIED)&&f.withheld>0){f.withheld--;result=gl.TIMEOUT_EXPIRED;}record(key,{id:id(args[0]),actual,delivered:result});}
    if(['drawElements','getBufferSubData','copyBufferSubData','useProgram','bindFramebuffer','bindVertexArray'].includes(key))record(key,{programId:id(target.getParameter(gl.CURRENT_PROGRAM)),arguments:args.map(x=>typeof x==='number'?x:ArrayBuffer.isView(x)?{byteLength:x.byteLength}:id(x))});
    require(key!=='finish','no blocking GPU finish');return result;
  };}});
  return {gl:proxy,control,events,id,counts:()=>Object.fromEntries(Object.values(creates).map(kind=>[kind,[...live.values()].filter(x=>x===kind).length])),finish(){equal(live.size,0,'all native objects deleted');for(const o of objects)equal(gl['is'+o.kind](o.object),false,'native object actually collected');report.glObjects={created:objects.length,live:live.size};}};
}
function makeRig(gl,bridge,report,asynchronous=false,constructors=null){
  const watch=instrument(gl,report),allocations=new Map(),actualBackend=ok(createWebGL2TransferBackend(watch.gl),'actual backend').backend;
  const backend={...actualBackend,allocate(meta){const value=actualBackend.allocate(meta);allocations.set(meta.id,value);return value;}};
  const {store,bindings,asyncAccess}=ok(createResourceStore({backend}),'actual resource store');
  Object.assign(report,{translations:[],submissions:[],draws:[],rawDraws:[],attacks:[],lifecycle:[],yieldAttacks:[],poison:[]});
  const rig={gl,watch,store,allocations,report,asynchronous,plans:{vertex:null,fragment:null},width:report.width??8};
  const capability={translate(request){
    const plan=rig.plans[request.stage];
    const input=plan?{stage:request.stage,text:request.text,components:clone(plan.components)}:request;
    const result=plan?bridge.translateExact(input):bridge.translate(input);
    report.translations.push({kind:plan?'exact':'default',request:clone(input),result:clone(result)});return result;
  },translatePair(request){const result=bridge.translatePair(request);report.translations.push({kind:'pair',request:clone(request),result:clone(result)});return result;}};
  const renderer=rig.renderer=ok((asynchronous?(constructors?.createVirglAsyncRenderer??createVirglAsyncRenderer):(constructors?.createVirglDrawRenderer??createVirglDrawRenderer))({gl:watch.gl,resources:store,bindings,...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:report.schedule.commandsPerStep}}:{}),shaderBridge:capability}),'renderer').renderer;
  rig.snapshot=()=>ok(renderer.inspect(),'snapshot');
  rig.run=async(contextId,bytes,label,options={})=>{
    watch.control.label=label;const record={label,contextId,bytes:[...bytes],states:[],eventsStart:watch.events.length};report.submissions.push(record);let result;
    if(!asynchronous){if(options.mutate)watch.control.mutation=bytes;result=renderer.executeSubmission(contextId,bytes);}
    else{const started=renderer.beginSubmission(contextId,bytes);record.begin=started;if(!started.ok)result=started;else{bytes.fill(0xff);record.inputAfter=[...bytes];for(let step=0;step<2000;step++){
      const state=ok(renderer.step(started.job),'async step');record.states.push({status:state.status,appliedCommands:state.appliedCommands,jobs:rig.snapshot().jobs});
      if(state.status==='done'){result=state.result;break;}require(['ready','waiting-gpu'].includes(state.status),'no fixture DMA exchange');
      if(options.onYield)await options.onYield(state,started.job,step);
      const delay=(Math.imul(report.schedule.seed,step+1)>>>0)%3;record.delays??=[];record.delays.push(delay);await new Promise(resolve=>setTimeout(resolve,delay));watch.control.turn++;
    }require(result,'bounded async completion');}}
    if(options.mutate){record.inputAfter=[...bytes];require(bytes.every(x=>x===255),'caller bytes actually mutated after decode');}
    record.result=result;record.eventsEnd=watch.events.length;return result;
  };
  rig.must=async(...args)=>ok(await rig.run(...args),args[2]);
  rig.dispose=()=>{ok(renderer.dispose(),'renderer disposal');report.finalBudgets=rig.snapshot().budgets;Object.values(report.finalBudgets).forEach(x=>equal(x,0,'final renderer budget'));ok(store.dispose(),'resource disposal');report.finalResourceBudgets=ok(store.inspect(),'disposed store').budgets;Object.values(report.finalResourceBudgets).forEach(x=>equal(x,0,'final resource budget'));equal(gl.getError(),gl.NO_ERROR,'final native GL error');watch.finish();};
  return rig;
}
function createResources(rig) {
  rig.report.geometry = { positions: VERTICES, components: 2, indices: INDICES, width: rig.width, height: rig.width };
  for (const [id, target, format, bindFlags, width, height, data] of [
    [101, 0, 64, 16, 32, 1, new Uint8Array(new Float32Array(VERTICES).buffer)],
    [102, 0, 64, 32, 12, 1, new Uint8Array(new Uint16Array(INDICES).buffer)],
    [103, 2, 67, 10, rig.width, rig.width, new Uint8Array(rig.width*rig.width*4)]]) {
    ok(rig.store.createResource({ id, target, format, bind: bindFlags, width, height, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 }), 'resource creation');
    ok(rig.store.attachBacking(id, [data]), 'resource backing');
  }
}
function createContext(rig, id) {
  ok(rig.store.createContext(id), 'resource context'); ok(rig.renderer.createContext(id), 'renderer context');
  for (const resourceId of [101, 102, 103]) ok(rig.store.attachContext(id, resourceId), 'resource membership');
  for (const [resourceHandle, width] of [[101, 32], [102, 12]]) {
    const ticket = ok(rig.store.prepareTransfer(id, { opcode: 43, fields: { resourceHandle, level: 0, usage: 0, stride: 0, layerStride: 0, box: { x: 0, y: 0, z: 0, width, height: 1, depth: 1 }, dataOffset: 0, direction: 1 } }), 'resource upload preparation').ticket;
    ok(rig.store.executeTransfer(ticket), 'actual fixture resource upload');
  }
}
function readPixels(rig) {
  const gl = rig.gl, old = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), fb = gl.createFramebuffer();
  try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rig.allocations.get(103).texture, 0);
    equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'independent read FBO'); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const bytes = new Uint8Array(rig.width*rig.width*4); gl.readPixels(0, 0, rig.width, rig.width, gl.RGBA, gl.UNSIGNED_BYTE, bytes); equal(gl.getError(), gl.NO_ERROR, 'independent GPU pixel read'); return bytes;
  } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old); gl.deleteFramebuffer(fb); }
}
function actualUniforms(rig, program) {
  const gl = rig.gl, actual = gl.getParameter(gl.CURRENT_PROGRAM), records = [];
  for (const uniform of program.reflection.uniforms) {
    const base = uniform.name.replace(/\[0\]$/, ''), words = [];
    for (let i = 0; i < uniform.activeCount; i++) { const at = gl.getUniformLocation(actual, `${base}[${i}]`); require(at !== null, 'actual retained element location'); words.push(...gl.getUniform(actual, at)); }
    records.push({ ...uniform, words });
  }
  return records;
}
function poison(rig, values, paddingOnly = false) {
  const gl = rig.gl, program = gl.getParameter(gl.CURRENT_PROGRAM), before = [];
  for (const stage of ['vs', 'fs']) for (const index of paddingOnly ? [46] : [0, 5, 7, 45]) {
    const name = `${stage}const0[${index}]`, location = gl.getUniformLocation(program, name); if (location === null) continue;
    gl.uniform4uiv(location, new Uint32Array(values)); before.push({ name, values, observed: [...gl.getUniform(program, location)] });
  }
  equal(gl.getError(), gl.NO_ERROR, 'actual external uniform poison'); return { nativeProgramId: rig.watch.id(program), entries: before };
}
function externalPoison(rig,label){
  const entry={label,...poison(rig,POISONS[0])},gl=rig.gl;
  gl.useProgram(null);gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,null);gl.viewport(0,0,1,1);gl.colorMask(false,false,false,false);
  entry.after={programId:rig.watch.id(gl.getParameter(gl.CURRENT_PROGRAM)),framebufferNull:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null,vertexArrayNull:gl.getParameter(gl.VERTEX_ARRAY_BINDING)===null,viewport:[...gl.getParameter(gl.VIEWPORT)],colorMask:[...gl.getParameter(gl.COLOR_WRITEMASK)]};
  equal(gl.getError(),gl.NO_ERROR,'external binding poison');rig.report.poison.push(entry);return entry;
}

function setupBytes(vertex,fragment,width){
  return join(shaderPacket(1,0,vertex),shaderPacket(2,1,fragment),packet(1,8,[10,103,67,0,0]),
    packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29]),packet(2,5,[11]),packet(6,0,[8,0,101]),
    packet(11,0,[102,2,0]),packet(4,0,[0,bits(width/2),bits(width/2),bits(.5),bits(width/2),bits(width/2),bits(.5)]),bind(1,0));
}
async function prepare(rig,input,id=1){
  rig.plans={vertex:null,fragment:null};rig.plans[input.stage]=input;
  const stage=input.stage==='vertex'?0:1,vertex=stage===0?input.text:VERTEX,fragment=stage===1?input.text:FRAGMENT;
  const words=input.safeWords?.slice()??literalBank(input);
  await rig.must(id,setupBytes(vertex,fragment,rig.width),input.name+' setup');
  await rig.must(id,constants(stage,words),input.name+' bank');
  await rig.must(id,link(),'prelink');await rig.must(id,bind(2,1),'bind fragment');
  return {stage,words,color:input.expectedColor};
}
function tile(rig,bytes,name){
  if(document.querySelector('#draws').children.length>=12)return;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=rig.width;
  const flipped=new Uint8ClampedArray(bytes.length);for(let y=0;y<rig.width;y++)flipped.set(bytes.subarray(y*rig.width*4,(y+1)*rig.width*4),(rig.width-1-y)*rig.width*4);
  canvas.getContext('2d').putImageData(new ImageData(flipped,rig.width,rig.width),0,0);
  const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=canvas.toDataURL();image.alt=name;caption.textContent=name;figure.append(image,caption);document.querySelector('#draws').append(figure);
}
async function capture(rig,id,name,color,result){
  const snapshot=rig.snapshot(),sub=currentSub(snapshot,id),program=sub.programs.find(p=>p.vertexGeneration===sub.bindings.vertexShader.generation&&p.fragmentGeneration===sub.bindings.fragmentShader.generation),bytes=readPixels(rig);
  require(program,'selected real program');const uniforms=actualUniforms(rig,program);
  const entry={name,contextId:id,submissionIndex:rig.report.submissions.length-1,snapshot,program,nativeProgramId:rig.watch.id(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM)),uniforms,expectedColor:color,rgbaBytes:[...bytes],rgbaSha256:await digest(bytes),pixels:rig.width**2,result};rig.report.draws.push(entry);
  for(let i=0;i<bytes.length;i+=4)equal([...bytes.subarray(i,i+4)],color,name+' independent full-frame pixel '+i/4);
  for(const uniform of uniforms){const stage=uniform.stage==='vertex'?0:1,expected=sub.bindings.constants[stage];equal(uniform.words.slice(0,Math.min(uniform.activeCount,46)*4),expected.slice(0,Math.min(uniform.activeCount,46)*4),name+' real native words');}
  tile(rig,bytes,name);return entry;
}
async function phase(rig,id,name,color,options={}){
  await rig.must(id,CLEAR.slice(),name+' clear');const result=await rig.must(id,DRAW.slice(),name+' draw',options);return capture(rig,id,name,color,result);
}
async function rejectDraw(rig,id,name,stage,prefix=null,code='constant-exact-domain-error'){
  const before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],at=rig.watch.events.length;
  const result=await rig.run(id,prefix?join(prefix,DRAW):DRAW.slice(),name),after=rig.snapshot(),pixelsAfter=[...readPixels(rig)],events=rig.watch.events.slice(at);
  const entry={name,stage,prefix:prefix?[...prefix]:null,before,after,result,events,pixelsBefore,pixelsAfter};rig.report.attacks.push(entry);
  equal(result.ok,false,name+' real guard rejection');equal(result.error.code,code,name+' exact error');equal(result.appliedCommands,prefix?1:0,name+' honest SET prefix');equal(pixelsAfter,pixelsBefore,name+' unchanged framebuffer');equal(after.budgets,before.budgets,name+' budgets');
  require(!events.some(e=>['drawElements','getBufferSubData','copyBufferSubData','createShader','createProgram','linkProgram'].includes(e.call)),name+' zero DRAW/index/link effects');
  require(!events.some(e=>e.call==='uniform4uiv'&&e.name.startsWith(stage===0?'vs':'fs')),name+' unsafe stage cannot upload');return entry;
}
async function exercise(rig,input,fault){
  createResources(rig);createContext(rig,1);const selected=await prepare(rig,input),{stage}=selected;
  await phase(rig,1,input.name+' baseline',selected.color);
  if(fault==='metadata'){
    const red=packet(7,0,[4,bits(1),0,0,bits(1),0,0,0]);await rig.must(1,red,'independent red fault sentinel');
    const wrong=selected.words.slice(),entry=input.components[0];wrong[entry.register*4+entry.component]=2;
    await rejectDraw(rig,1,input.name+' stripped exact precondition',stage,constants(stage,wrong));return;
  }
  for(const obligation of input.components){
    const changes=[0,2,0x80000000,(obligation.word^1)>>>0].filter((word,i,a)=>word!==obligation.word&&a.indexOf(word)===i);
    for(const word of changes){const wrong=selected.words.slice();wrong[obligation.register*4+obligation.component]=word;
      const record=await rejectDraw(rig,1,input.name+' mismatch '+obligation.register+'.'+obligation.component+'/'+word,stage,constants(stage,wrong));
      equal(currentSub(record.after,1).bindings.constants[stage],wrong,'rejected bank remains honest CPU state');
      await rig.must(1,constants(stage,selected.words),'safe recovery');await phase(rig,1,input.name+' recovery',selected.color);
    }
  }
  for(const attack of input.inheritedAttacks??[]){const wrong=selected.words.slice();wrong[attack.index]=attack.word;
    await rejectDraw(rig,1,input.name+' inherited '+attack.code,stage,constants(stage,wrong),attack.code);
    await rig.must(1,constants(stage,selected.words),'inherited recovery');await phase(rig,1,input.name+' inherited recovery',selected.color);
  }
  if(input.name.includes('unused-pruned')){const program=currentSub(rig.snapshot(),1).programs[0];require(program.reflection.uniforms.find(u=>u.stage===input.stage).activeCount===0,'real driver prunes entire bank');rig.report.prunedReflection=program.reflection;}
  for(const length of [0,selected.words.length-4]){await rejectDraw(rig,1,input.name+' short '+length,stage,constants(stage,selected.words.slice(0,length)),'incomplete-draw');await rig.must(1,constants(stage,selected.words),'full bank replacement');}
  let attacked=false;
  await phase(rig,1,input.name+' owned restored draw',selected.color,{mutate:true,onYield:async()=>{
    if(attacked)return;attacked=true;const before=rig.snapshot(),busy=[rig.renderer.restoreContext(1),rig.renderer.destroyContext(1),rig.renderer.beginSubmission(1,constants(stage,[]))];
    for(const result of busy){equal(result.ok,false,'async plan locked');equal(result.error.code,'busy','actual busy state');}
    equal(rig.snapshot(),before,'no locked mutation');externalPoison(rig,'external bindings poisoned during async yield');rig.report.yieldAttacks.push({before,busy,after:rig.snapshot()});
  }});if(rig.asynchronous)require(attacked,'actual async yield');
}
async function lifecycle(gl,bridge,fixtures,report){
  const rig=makeRig(gl,bridge,report,true);try{
    createResources(rig);createContext(rig,1);createContext(rig,2);
    const a=fixtures.find(c=>c.name==='vertex-reg0-xxxx-count1'),b=fixtures.find(c=>c.name==='vertex-reg0-xxxx-count0');
    await prepare(rig,a,1);await phase(rig,1,'A count1',a.expectedColor);
    await prepare(rig,b,2);await phase(rig,2,'B count0',b.expectedColor);externalPoison(rig,'before B to A');
    await phase(rig,1,'A restored',a.expectedColor);await phase(rig,2,'B restored',b.expectedColor);
    await rig.must(1,packet(29,0,[7]),'new subcontext');await prepare(rig,b,1);await phase(rig,1,'subcontext count0',b.expectedColor);
    await rig.must(1,packet(28,0,[0]),'default subcontext');await phase(rig,1,'default count1',a.expectedColor);
    const before=rig.snapshot();await rig.must(1,join(packet(3,4,[1]),shaderPacket(1,0,b.text),bind(1,0),link()),'recreate handle with generated count0 contract');
    require(currentSub(before,1).bindings.vertexShader.generation!==currentSub(rig.snapshot(),1).bindings.vertexShader.generation,'distinct generation');
    await rejectDraw(rig,1,'old bank rejects new compiler generation',0);await rig.must(1,constants(0,literalBank(b)),'new count0 bank');await phase(rig,1,'new count0 generation',b.expectedColor);
    report.lifecycle.push({name:'actual compiler contracts survive contexts/subcontexts/generation replacement',before,after:rig.snapshot()});
  }finally{rig.dispose();}
}
export async function runAcceptance({seed=SEEDS[0],fault=null}={}){
  const report={schema:1,task:'E6-T12g6m3b',status:'running',guestExecution:false,trustedHostWrapper:false,seed,fault,rigs:[],shaderFixtures:[]};window.__virglExactProducerReport=report;
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=8;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});require(gl instanceof WebGL2RenderingContext,'physical WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);document.querySelector('#renderer').textContent=report.renderer;
  try{
    let options={};if(fault){const bytes=new Uint8Array(await(await fetch('/target/virgl-exact-producer-fault/'+fault+'/virgl-shader.wasm')).arrayBuffer());options={wasmBinary:bytes};report.faultWasm={sha256:await digest(bytes),bytes:bytes.length};}
    const bridge=await createVirglShaderBridge(options),response=await fetch('/tools/virgl-exact-producer/fixtures.json'),raw=new Uint8Array(await response.arrayBuffer()),fixtures=JSON.parse(new TextDecoder().decode(raw)).filter(c=>c.role==='physical');report.fixture={sha256:await digest(raw),bytes:raw.length};
    for(const c of fault?fixtures.slice(0,1):fixtures){const request={stage:c.stage,text:c.text,components:clone(c.components)},result=ok(bridge.translateExact(request),c.name);report.shaderFixtures.push({fixture:c,request,result,textSha256:await digest(c.text)});}
    for(const asynchronous of fault?[false]:[false,true])for(const input of fault?fixtures.slice(0,1):fixtures){
      const entry={name:input.name+(asynchronous?'-async':'-sync'),fixture:input.name,width:8,...(asynchronous?{schedule:{seed,commandsPerStep:1+(seed%3)}}:{})};report.rigs.push(entry);const rig=makeRig(gl,bridge,entry,asynchronous);try{await exercise(rig,input,fault);}finally{rig.dispose();}
    }
    if(!fault){const entry={name:'compiler lifecycle',width:8,schedule:{seed,commandsPerStep:1+(seed%3)}};report.rigs.push(entry);await lifecycle(gl,bridge,fixtures,entry);}
    report.status='passed';document.querySelector('#status').textContent='Compiler-derived exact banks, real pixels and async restore passed.';
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;}
  return report;
}
