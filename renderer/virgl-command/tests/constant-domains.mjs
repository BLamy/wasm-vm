// Trusted host contract wrappers exercise the real consumer; compiler admission is unchanged.
// Pixel expectations are literal rational geometry/color, never translated GLSL.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
import { ORIGINAL_INPUTS } from '../../virgl-shader/tests/components.mjs';
import { digest } from '../../virgl-shader/tests/browser.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglDrawRenderer, createVirglAsyncRenderer } from '../state.mjs';
import { decodeSubmission } from '../decoder.mjs';

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
function bank(mode, stage) {
  const values = Array.from({ length: 46 }, () => [0, 0, 0, 0]);
  if (stage === 0) {
    values[0] = mode === 'B' ? [.25, -.25, 0, 0] : [0, 0, 0, 0];
    values[5] = [.75, .75, .75, .75]; values[7] = [1, 1, 1, 1];
    values[45] = mode === 'B' ? [.5, .5, 1, 1] : [1, 1, 1, 1];
  } else {
    values[0] = [.125, .25, .25, .25]; values[5] = [.75, .125, .5, 1];
    values[7] = [.375, .125, 0, .5]; values[45] = mode === 'B' ? [.625, .25, .5, .5] : [.125, .5, .25, .5];
  }
  return values.flat().map(bits);
}
function currentSub(snapshot, id) { const ctx = snapshot.contexts.find(value => value.id === id); return ctx.subContexts.find(value => value.id === ctx.currentSubContext); }
function expected(mode) {
  return { rectangle: mode === 'B' ? [12, 4, 16, 16] : [0, 0, 32, 32],
    color: mode === 'B' ? [191, 128, 191, 191] : mode === 'low' ? [128, 96, 64, 191] : mode === 'both-inactive' ? [255, 0, 0, 255] : [64, 191, 128, 191] };
}
function tile(bytes, name) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const flipped = new Uint8ClampedArray(4096);
  for (let y = 0; y < 32; y++) flipped.set(bytes.subarray(y * 128, (y + 1) * 128), (31 - y) * 128);
  canvas.getContext('2d').putImageData(new ImageData(flipped, 32, 32), 0, 0);
  const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
  image.src = canvas.toDataURL(); image.alt = name; caption.textContent = name; figure.append(image, caption); document.querySelector('#draws').append(figure);
}
const CONDITIONAL='virgl-webgl2-raw-bits-v7',KIND='constant-bank-finite-f32-v1';
const finite=word=>Number.isInteger(word)&&word>=0&&word<=0xffffffff&&Math.floor(word/8388608)%256!==255;
const clone=value=>JSON.parse(JSON.stringify(value));
function wrap(original,stage,rig){
  const result=clone(ok(original,'real compiler fixture before host contract'));
  if(rig.contractStages==='both'||rig.contractStages===stage){const name=stage==='vertex'?'vsconst0':'fsconst0';result.metadata.profile=CONDITIONAL;result.metadata.constantDomains=[{kind:KIND,stage,slot:0,name,count:result.metadata.uniforms[0].count}];}
  if(rig.contractFault&&rig.faultStage===stage){const m=result.metadata,d=m.constantDomains[0];switch(rig.contractFault){
    case 'missing':delete m.constantDomains;break;case 'profile':m.profile=original.metadata.profile;break;
    case 'kind':d.kind='constant-bank-finite-f32-v2';break;case 'stage':d.stage=stage==='vertex'?'fragment':'vertex';break;
    case 'slot':d.slot=1;break;case 'name':d.name='otherconst0';break;case 'duplicate':m.constantDomains.push({...d});break;
    case 'count-zero':d.count=0;break;case 'count-fraction':d.count=1.5;break;case 'count-large':d.count=48;break;
    case 'count-mismatch':d.count=45;break;case 'domains-object':m.constantDomains={...d};break;
    case 'domain-null':m.constantDomains=[null];break;case 'unknown-field':d.optional=true;break;
    default:throw new Error('unknown host contract corruption');
  }}return result;
}
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
function makeRig(gl,bridge,report,asynchronous=false){
  const watch=instrument(gl,report),allocations=new Map(),actualBackend=ok(createWebGL2TransferBackend(watch.gl),'actual backend').backend;
  const backend={...actualBackend,allocate(meta){const value=actualBackend.allocate(meta);allocations.set(meta.id,value);return value;}};
  const {store,bindings,asyncAccess}=ok(createResourceStore({backend}),'actual resource store');
  Object.assign(report,{translations:[],submissions:[],draws:[],rawDraws:[],attacks:[],lifecycle:[],yieldAttacks:[],poison:[]});
  const rig={gl,watch,store,allocations,report,asynchronous,contractStages:report.contractStages,contractFault:null,faultStage:'vertex',width:report.width??32};
  const capability={translate(request){const original=bridge.translate(request),result=wrap(original,request.stage,rig);report.translations.push({kind:'single',request:clone(request),original,result:clone(result),contractStages:rig.contractStages,fault:rig.contractFault,faultStage:rig.faultStage});return result;},translatePair(request){const original=ok(bridge.translatePair(request),'real pair compiler fixture before host contract');const result={...original,vertex:wrap({ok:true,...original.vertex},'vertex',rig),fragment:wrap({ok:true,...original.fragment},'fragment',rig)};delete result.vertex.ok;delete result.fragment.ok;report.translations.push({kind:'pair',request:clone(request),original,result:clone(result),contractStages:rig.contractStages,fault:rig.contractFault,faultStage:rig.faultStage});return result;}};
  const renderer=rig.renderer=ok((asynchronous?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:watch.gl,resources:store,bindings,...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:report.schedule.commandsPerStep}}:{}),shaderBridge:capability}),'renderer').renderer;
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
function setupBytes(fixtures,variant='high',width=32){
  let vertex,fragment;
  if(variant.startsWith('raw-')){const [_,stage,index]=variant.split('-');vertex=fixtures.find(x=>x.name===(stage==='vertex'?`raw-c${index}-vertex`:'raw-pass-vertex'));fragment=fixtures.find(x=>x.name===(stage==='fragment'?`raw-c${index}-fragment`:'raw-pass-fragment'));}
  else{vertex=fixtures.find(x=>x.name===`hardware-${variant}-vertex`);fragment=fixtures.find(x=>x.name===`hardware-${variant}-fragment`);}
  return join(shaderPacket(1,0,vertex.text),shaderPacket(2,1,fragment.text),packet(1,8,[10,103,67,0,0]),packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29]),packet(2,5,[11]),packet(6,0,[8,0,101]),packet(11,0,[102,2,0]),packet(4,0,[0,bits(width/2),bits(width/2),bits(.5),bits(width/2),bits(width/2),bits(.5)]),bind(1,0));
}
async function prepare(rig,fixtures,id,variant='high',mode='A',upload=true){
  await rig.must(id,setupBytes(fixtures,variant,rig.width),`${variant} setup`);
  if(upload)await rig.must(id,join(constants(0,bank(mode,0)),constants(1,bank(mode,1))),`${mode} banks`);
  await rig.must(id,link(),'prelink');await rig.must(id,bind(2,1),'bind fragment');
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
async function capture(rig, id, name, mode, drawResult, display = true) {
  const snapshot = rig.snapshot(), sub = currentSub(snapshot, id), program = sub.programs.find(value => value.vertexGeneration === sub.bindings.vertexShader.generation && value.fragmentGeneration === sub.bindings.fragmentShader.generation);
  require(program, 'active diagnostic program'); const bytes = readPixels(rig), oracle = expected(mode);
  const record = { name, expectedMode: mode, contextId: id, subContextId: sub.id, subContextGeneration: sub.generation, ...oracle, pixels: 0,
    program, nativeProgramId: rig.watch.id(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM)), bindings: sub.bindings, hostUniformComponents: snapshot.hostUniformComponents, budgets: snapshot.budgets, nativeCounts: rig.watch.counts(), storedConstantBytes: snapshot.contexts.reduce((sum, ctx) => sum + ctx.subContexts.reduce((n, current) => n + current.bindings.constants.reduce((words, stage) => words + stage.length * 4, 0), 0), 0),
    uniforms: actualUniforms(rig, program), rgbaBytes: [...bytes], rgbaSha256: await digest(bytes), draw: drawResult.draws[0] };
  record.submissionIndex = rig.report.submissions.length - 1; record.selectedShaders = sub.objects.filter(value => [sub.bindings.vertexShader.generation, sub.bindings.fragmentShader.generation].includes(value.generation)).map(value => ({ stage: value.fields.stage, text: value.fields.text }));
  rig.report.draws.push(record); if (display && document.querySelector('#draws').children.length < 18) tile(bytes, name);
  const [x0, y0, width, height] = oracle.rectangle;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const want = x >= x0 && x < x0 + width && y >= y0 && y < y0 + height ? oracle.color : [0, 0, 255, 255], observed = [...bytes.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    if (JSON.stringify(observed) !== JSON.stringify(want)) record.failure = { pixel: [x, y], expected: want, observed };
    equal(observed, want, `${name} independent pixel (${x},${y})`); record.pixels++;
  }
  return record;
}
async function phase(rig,id,name,mode,options={}){await rig.must(id,CLEAR.slice(),name+' clear');const result=await rig.must(id,DRAW.slice(),name+' draw',options);return capture(rig,id,name,mode,result,true);}
async function rejectDraw(rig,id,label,code='incomplete-draw',prefix=null){
  const before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],at=rig.watch.events.length;
  const result=await rig.run(id,prefix?join(prefix,DRAW):DRAW.slice(),label);equal(result.ok,false,'invalid draw rejected');equal(result.error.code,code,'exact draw rejection');equal(result.appliedCommands,prefix?1:0,'honest applied command prefix');
  const after=rig.snapshot(),pixelsAfter=[...readPixels(rig)],events=rig.watch.events.slice(at);equal(pixelsAfter,pixelsBefore,'rejected draw preserves entire framebuffer');equal(after.budgets,before.budgets,'rejected draw budget');require(!events.some(e=>['drawElements','getBufferSubData','copyBufferSubData'].includes(e.call)),'reject before index read/stage/draw');
  const entry={name:label,before,after,result,events,pixelsBefore,pixelsAfter};rig.report.attacks.push(entry);return entry;
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
async function lifecycle(rig,fixtures){
  createResources(rig);createContext(rig,1);await prepare(rig,fixtures,1);
  await phase(rig,1,'A initial','A');
  await rig.must(1,join(constants(0,bank('A',0)),constants(1,bank('A',1))),'caller mutation ownership',{mutate:true});
  equal(currentSub(rig.snapshot(),1).bindings.constants,[bank('A',0),bank('A',1)],'immutable decoded bank words');
  await phase(rig,1,'A owned bank','A');
  await rig.must(1,join(constants(0,bank('B',0)),constants(1,bank('B',1))),'B replacement');await phase(rig,1,'B same program','B');
  await rig.must(1,join(constants(0,bank('A',0)),constants(1,bank('A',1))),'A replacement');externalPoison(rig,'before A restored draw');
  await phase(rig,1,'A same program restored','A');
  createContext(rig,2);await prepare(rig,fixtures,2,'high','B');await phase(rig,2,'B context2','B');await phase(rig,1,'A context1 restored','A');
  await rig.must(1,packet(29,0,[7]),'create subcontext7');await prepare(rig,fixtures,1,'high','B');await phase(rig,1,'B subcontext7','B');
  await rig.must(1,packet(28,0,[0]),'select default');await phase(rig,1,'A default restored','A');
  await rig.must(1,packet(28,0,[7]),'select subcontext7');const old=rig.snapshot();
  await rig.must(1,join(packet(30,0,[7]),packet(29,0,[7])),'recreate subcontext7');await prepare(rig,fixtures,1,'high','B',false);
  equal(currentSub(rig.snapshot(),1).bindings.constants,[[],[]],'recreated subcontext owns no old constants');require(currentSub(rig.snapshot(),1).generation!==currentSub(old,1).generation,'subcontext generation advances');
  await rejectDraw(rig,1,'recreated subcontext empty');await rig.must(1,join(constants(0,bank('B',0)),constants(1,bank('B',1))),'recreated B banks');await phase(rig,1,'B recreated subcontext','B');rig.report.lifecycle.push({name:'subcontext reuse',before:old,after:rig.snapshot()});
  await rig.must(1,packet(28,0,[0]),'return to default');
  const before=rig.snapshot(),body=fixtures.find(x=>x.name==='hardware-high-vertex').text;
  await rig.must(1,join(packet(3,4,[1]),shaderPacket(1,0,body),bind(1,0),link()),'recreate vertex handle1');
  const after=rig.snapshot();require(currentSub(before,1).bindings.vertexShader.generation!==currentSub(after,1).bindings.vertexShader.generation,'shader handle reuse gets new identity');rig.report.lifecycle.push({name:'shader handle reuse',before,after});await phase(rig,1,'A new shader generation','A');
  for(const stage of[0,1])for(const length of[180,0]){
    await rig.must(1,constants(stage,bank('A',stage).slice(0,length)),`stage${stage} shortened${length}`);
    const state=currentSub(rig.snapshot(),1);equal(state.bindings.constants[stage],bank('A',stage).slice(0,length),'replacement discards old suffix');
    await rejectDraw(rig,1,`stage${stage} missing prefix${length}`);await rig.must(1,constants(stage,bank('A',stage)),`stage${stage} restore complete`);
  }
  for(const stage of[0,1]){await rejectDraw(rig,1,`stage${stage} applied short prefix`,'incomplete-draw',constants(stage,bank('A',stage).slice(0,180)));await rig.must(1,constants(stage,bank('A',stage)),'recover applied prefix');}
  let yielded=false;
  await phase(rig,1,'A final recovery','A',rig.asynchronous?{onYield:async(state)=>{
    if(yielded||rig.snapshot().jobs.status!=='waiting-index')return;yielded=true;const before=rig.snapshot();
    const attempts=[['begin',rig.renderer.beginSubmission(1,DRAW.slice())],['restore',rig.renderer.restoreContext(1)],['destroy',rig.renderer.destroyContext(1)]];
    attempts.forEach(([name,result])=>{equal(result.ok,false,'busy '+name);equal(result.error.code,'busy','busy mutation classification');});
    let frozen=false;try{before.contexts[0].subContexts[0].bindings.constants[0][0]=0xffffffff;}catch{frozen=true;}
    const poisoned=externalPoison(rig,'during waiting-index');const after=rig.snapshot();equal(after.contexts,before.contexts,'no public async mutation changes checked identities');
    rig.report.yieldAttacks.push({before,after,attempts:attempts.map(([name,result])=>({name,result})),inspectionMutationRejected:frozen,poisoned});
  }}:{});
  if(rig.asynchronous)require(yielded,'actual index-read yield attacked');
}
async function extentVariant(gl,bridge,fixtures,report,variant,contractStages='both'){
  const rig=makeRig(gl,bridge,report);rig.contractStages=contractStages;
  try{createResources(rig);createContext(rig,1);await prepare(rig,fixtures,1,variant,'A',false);const reflection=currentSub(rig.snapshot(),1).programs[0].reflection.uniforms;report.reflection=reflection;
    for(const uniform of reflection)if(uniform.uploadCount){const stage=uniform.stage==='vertex'?0:1;await rig.must(1,constants(stage,bank('A',stage).slice(0,uniform.uploadCount*4)),'actual reflected prefix');}
    await phase(rig,1,variant+' '+contractStages,variant==='inactive'?'both-inactive':variant==='low'?'low':'A');
    if(variant==='order'){report.padding=[];for(const values of POISONS){const poisoned=poison(rig,values,true);require(poisoned.entries.length>0,'actual driver retains declaration47 padding');await phase(rig,1,'order47 padding restored','A');const program=gl.getParameter(gl.CURRENT_PROGRAM),after=poisoned.entries.map(e=>({name:e.name,observed:[...gl.getUniform(program,gl.getUniformLocation(program,e.name))]}));equal(after,poisoned.entries.map(e=>({name:e.name,observed:values})),'unaddressable C46 unchanged');report.padding.push({poisoned,after});}}
  }finally{rig.dispose();}
}
const RAW_SETS=[[0,0x80000000,1,0x80000001],[0x007fffff,0x807fffff,0x3f800000,0xbf800000]];
function rawBank(phase,selector){const words=Array(184).fill(0);words.splice(0,4,...RAW_SETS[phase]);words.splice(180,4,...RAW_SETS[1-phase]);words.splice(176,4,...Array(4).fill(selector));return words;}
async function rawMatrix(gl,bridge,fixtures,report){
  const rig=makeRig(gl,bridge,report,Boolean(report.schedule));
  try{createResources(rig);createContext(rig,1);
    for(const stage of['vertex','fragment'])for(const index of[0,45]){
      if(report.rawDraws.length){await rig.must(1,packet(30,0,[7]),'drop previous raw subcontext');await rig.must(1,packet(29,0,[7]),'new raw subcontext');}else await rig.must(1,packet(29,0,[7]),'first raw subcontext');
      await prepare(rig,fixtures,1,`raw-${stage}-${index}`,'A',false);
      for(const phase of[0,1]){const expectedWords=RAW_SETS[index===0?phase:1-phase],record={stage,index,phase,expectedWords,planes:[]},reconstructed=[0n,0n,0n,0n];report.rawDraws.push(record);
        for(let selector=0;selector<32;selector++){
          const words=rawBank(phase,selector),input=join(constants(0,words),constants(1,words),DRAW);
          const eventsStart=rig.watch.events.length,result=await rig.must(1,input,`raw ${stage} C${index} phase${phase} bit${selector}`),pixels=readPixels(rig),expectedBytes=expectedWords.map(word=>Number((BigInt(word)>>BigInt(selector))&1n)*255),snapshot=rig.snapshot(),sub=currentSub(snapshot,1),program=sub.programs.find(p=>p.vertexGeneration===sub.bindings.vertexShader.generation&&p.fragmentGeneration===sub.bindings.fragmentShader.generation);
          const plane={selector,expectedBytes,words,rgbaBytes:[...pixels],rgbaSha256:await digest(pixels),program,nativeProgramId:rig.watch.id(gl.getParameter(gl.CURRENT_PROGRAM)),uniforms:actualUniforms(rig,program),draw:result.draws[0],contextId:1,subContextId:sub.id,subContextGeneration:sub.generation,bindings:sub.bindings,eventsStart,eventsEnd:rig.watch.events.length,submissionIndex:report.submissions.length-1};record.planes.push(plane);
          for(let at=0;at<pixels.length;at+=4)equal([...pixels.subarray(at,at+4)],expectedBytes,'exact raw bit plane whole framebuffer');for(let lane=0;lane<4;lane++)reconstructed[lane]|=BigInt(pixels[lane]/255)<<BigInt(selector);
        }record.observedWords=reconstructed.map(Number);equal(record.observedWords,expectedWords,'signed-zero and subnormal raw payload preserved exactly');
      }
    }
  }finally{rig.dispose();}
}
function invalidUploads(rig,at){return rig.watch.events.slice(at).filter(e=>e.call==='uniform4uiv'&&e.words.some(word=>!finite(word)));}
async function invalidMatrix(gl,bridge,fixtures,report,mode){
  const rig=makeRig(gl,bridge,report,Boolean(report.schedule));
  try{createResources(rig);createContext(rig,1);await prepare(rig,fixtures,1);await phase(rig,1,'finite baseline before invalid wire','A');
    const payloads=[0x7f800000,0xff800000,0x7fc12345,0xff800001];
    for(const stage of[0,1])for(const position of[0,90,183])for(const word of payloads){
      const words=bank('A',stage);words[position]=word;const label=`stage${stage} word${position} ${word.toString(16)}`,packetBytes=join(constants(1-stage,bank('B',1-stage)),constants(stage,words));
      const packetBefore=[...packetBytes],before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],at=rig.watch.events.length,result=await rig.run(1,packetBytes,label+' invalid packet');const after=rig.snapshot(),pixelsAfter=[...readPixels(rig)];
      const entry={name:label,stage,position,word,words,before,after,pixelsBefore,pixelsAfter,result,events:rig.watch.events.slice(at),packetBytes:packetBefore,callerBytesAfter:[...packetBytes]};report.attacks.push(entry);equal(pixelsAfter,pixelsBefore,'invalid SET leaves complete framebuffer unchanged');
      if(mode==='normal'){equal(result.ok,false,'normal invalid wire rejected');equal(result.error.code,'invalid-value','normal wire nonfinite error');equal(result.appliedCommands,0,'predecode applies no valid prefix');equal(after.contexts,before.contexts,'normal invalid wire state atomic');equal(entry.events,[],'normal invalid wire has zero GL effects');}
      else{ok(result,'decoder bypass stores raw bank');equal(result.appliedCommands,2,'both decoded SET commands honestly applied');equal(currentSub(after,1).bindings.constants[stage],words,'bad CPU bank preserved, never silently normalized');
        const uploads=invalidUploads(rig,at);entry.invalidUploads=uploads;
        if(uploads.length){entry.guardContradiction={expectedInvalidUploads:0,actualInvalidUploads:uploads.length,first:uploads[0]};require(uploads.every(e=>JSON.stringify(e.words)===JSON.stringify(e.observed)),'actual native invalid uniform readback');throw new Error('finite guard omission: actual invalid conditional uniform upload');}
        await rejectDraw(rig,1,label+' guarded draw','constant-domain-error');
      }
      await rig.must(1,join(constants(0,bank('A',0)),constants(1,bank('A',1))),label+' finite recovery');
    }
    await phase(rig,1,'A recovered from all invalid banks','A');
  }finally{rig.dispose();}
}
async function metadataFaults(gl,bridge,fixtures,reports){
  for(const stage of['vertex','fragment'])for(const fault of['missing','profile','kind','stage','slot','name','duplicate','count-zero','count-fraction','count-large','count-mismatch','domains-object','domain-null','unknown-field']){
    const report={name:`${stage}-${fault}`,contractStages:'both',classification:'trusted-host-metadata-fault'},rig=makeRig(gl,bridge,report);reports.push(report);
    try{createResources(rig);createContext(rig,1);await prepare(rig,fixtures,1);await rig.must(1,CLEAR.slice(),'metadata baseline clear');const before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],at=rig.watch.events.length;
      rig.contractFault=fault;rig.faultStage=stage;const text=fixtures.find(x=>x.name===`hardware-high-${stage}`).text,result=await rig.run(1,shaderPacket(77,stage==='vertex'?0:1,text),'malformed conditional metadata');
      equal(result.ok,false,'malformed contract rejected');equal(result.error.code,'shader-domain-error','metadata domain error');equal(result.appliedCommands,0,'malformed shader unpublished');const after=rig.snapshot(),pixelsAfter=[...readPixels(rig)],events=rig.watch.events.slice(at);equal(after,before,'metadata rejection unchanged state');equal(pixelsAfter,pixelsBefore,'metadata rejection whole framebuffer');equal(events,[],'metadata rejection has no native GL effects');
      report.validation={fault,stage,before,after,pixelsBefore,pixelsAfter,result,events};rig.contractFault=null;await phase(rig,1,'metadata failure recovery','A');
    }finally{rig.dispose();}
  }
}
export async function runAcceptance({mode='normal'}={}){
  require(['normal','decoder-bypass','decoder-and-guard-bypass'].includes(mode),'known consumer proof mode');
  const report={schema:'wasm-vm-constant-domain-browser-v1',status:'running',mode,guestExecution:false,productionVirgl:false,trustedHostMetadataWrapper:true,compilerAdmissionUnchanged:true,shaderFixtures:[],corpus:[],rigs:[],metadataRigs:[]};window.__virglConstantDomainsReport=report;
  try{
    const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(gl instanceof WebGL2RenderingContext,'actual WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'actual hardware identity');report.renderer={vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)};require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'actual hardware rendering');
    const bridge=await createVirglShaderBridge(),response=await fetch('/renderer/virgl-command/tests/constant-domain-shaders.json');require(response.ok,'fixture fetch');const bytes=new Uint8Array(await response.arrayBuffer()),fixtures=JSON.parse(new TextDecoder().decode(bytes));report.fixture={path:'renderer/virgl-command/tests/constant-domain-shaders.json',bytes:bytes.length,sha256:await digest(bytes)};
    for(const input of fixtures){const original=ok(bridge.translate({stage:input.stage,text:input.text}),input.name);equal(original.metadata.uniforms[0].count,input.expected.constantCount,'literal declaration extent');require(original.metadata.profile!==CONDITIONAL&&!Object.hasOwn(original.metadata,'constantDomains'),'real compiler remains unconditional');report.shaderFixtures.push({...input,inputSha256:await digest(input.text),original});}
    for(const input of ORIGINAL_INPUTS){const response=await fetch('/'+input.path),bytes=new Uint8Array(await response.arrayBuffer());equal(await digest(bytes),input.sha256,'pinned original corpus');const text=new TextDecoder().decode(bytes),result=bridge.translate({stage:input.stage,text});report.corpus.push({...input,result});}equal(report.corpus.filter(x=>x.result.ok).length,12,'unchanged full original outcome');
    const schedules=[{seed:0x7c1209ad,commandsPerStep:1},{seed:0x491be583,commandsPerStep:2},{seed:0xea016f35,commandsPerStep:3},{seed:0x265d8cb7,commandsPerStep:8}];
    if(mode==='normal'){
      for(const schedule of[null,...schedules]){const entry={name:schedule?'lifecycle-async-'+schedule.seed.toString(16):'lifecycle-sync',...(schedule?{schedule}:{}),contractStages:'both'};report.rigs.push(entry);const rig=makeRig(gl,bridge,entry,Boolean(schedule));try{await lifecycle(rig,fixtures);}finally{rig.dispose();}}
      for(const [variant,stages]of[['high','vertex'],['high','fragment'],['low','both'],['order','both'],['inactive','both']]){const entry={name:variant+'-'+stages,contractStages:stages};report.rigs.push(entry);await extentVariant(gl,bridge,fixtures,entry,variant,stages);}
      for(const schedule of[null,schedules[1]]){const entry={name:schedule?'raw-async':'raw-sync',width:4,...(schedule?{schedule}:{}),contractStages:'both'};report.rigs.push(entry);await rawMatrix(gl,bridge,fixtures,entry);}
      await metadataFaults(gl,bridge,fixtures,report.metadataRigs);
    }
    for(const schedule of[null,...(mode==='decoder-and-guard-bypass'?[]:schedules)]){const entry={name:schedule?'invalid-async-'+schedule.seed.toString(16):'invalid-sync',...(schedule?{schedule}:{}),contractStages:'both'};report.rigs.push(entry);await invalidMatrix(gl,bridge,fixtures,entry,mode);}
    const rigs=[...report.rigs,...report.metadataRigs];report.checkedPixels=rigs.reduce((n,r)=>n+r.draws.reduce((sum,d)=>sum+d.pixels,0)+r.rawDraws.reduce((sum,d)=>sum+d.planes.reduce((m,p)=>m+p.rgbaBytes.length/4,0),0),0);report.rawWords=rigs.reduce((n,r)=>n+r.rawDraws.length*4,0);report.invalidCases=report.rigs.filter(r=>r.name.startsWith('invalid-')).reduce((n,r)=>n+r.attacks.filter(a=>Object.hasOwn(a,'word')).length,0);
    require(mode!=='decoder-and-guard-bypass','guard bypass must contradict actual native uploads');report.status='passed';document.querySelector('#status').textContent=`${report.checkedPixels} checked pixels · ${report.rawWords} raw words · ${report.invalidCases} invalid bank cases · trusted host contracts`;document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
