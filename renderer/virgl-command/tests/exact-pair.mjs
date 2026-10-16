// Actual compiler-produced exact preconditions, unchanged original TGSI, shared real renderers.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
import { digest } from '../../virgl-shader/tests/browser.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglDrawRenderer, createVirglAsyncRenderer } from '../state.mjs';
const SEEDS=[0x6a09e667,0xbb67ae85,0x3c6ef372];
const clone=x=>JSON.parse(JSON.stringify(x));
const bank=components=>{const words=Array(184).fill(0);for(const w of components)words[w.register*4+w.component]=w.word;return words;};
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
const VERTICES = [-1,-1,0,0, 1,-1,1,0, 1,1,1,1, -1,1,0,1];
const INDICES = [0,1,2,0,2,3, 1,2,0,2,3,0];
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
  },translatePair(request){const input={vertexText:request.vertexText,fragmentText:request.fragmentText,vertexComponents:clone(rig.plans.vertex?.components??[]),fragmentComponents:clone(rig.plans.fragment?.components??[])};const result=bridge.translatePairExact(input);report.translations.push({kind:'pair-exact',request:clone(input),result:clone(result)});return result;}};
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
  rig.report.geometry = { positions: VERTICES, components: 4, indices: INDICES, width: rig.width, height: rig.width, viewport: [0,0,10,8] };
  for (const [id, target, format, bindFlags, width, height, data] of [
    [101, 0, 64, 16, 64, 1, new Uint8Array(new Float32Array(VERTICES).buffer)],
    [102, 0, 64, 32, 24, 1, new Uint8Array(new Uint16Array(INDICES).buffer)],
    [103, 2, 67, 10, rig.width, rig.width, new Uint8Array(rig.width*rig.width*4)]]) {
    ok(rig.store.createResource({ id, target, format, bind: bindFlags, width, height, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 }), 'resource creation');
    ok(rig.store.attachBacking(id, [data]), 'resource backing');
  }
}
function createContext(rig, id) {
  ok(rig.store.createContext(id), 'resource context'); ok(rig.renderer.createContext(id), 'renderer context');
  for (const resourceId of [101, 102, 103]) ok(rig.store.attachContext(id, resourceId), 'resource membership');
  for (const [resourceHandle, width] of [[101, 64], [102, 24]]) {
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

function setupBytes(input){
  return join(shaderPacket(1,0,input.vertexText),shaderPacket(2,1,input.fragmentText),packet(1,8,[10,103,67,0,0]),
    packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29,8,0,0,29]),packet(2,5,[11]),packet(6,0,[16,0,101]),
    packet(11,0,[102,2,0]),packet(4,0,[0,bits(5),bits(4),bits(.5),bits(5),bits(4),bits(.5)]),bind(1,0));
}
async function prepare(rig,input,id=1){
  rig.plans={vertex:input.vertexComponents.length?{components:input.vertexComponents}:null,fragment:input.fragmentComponents.length?{components:input.fragmentComponents}:null};
  const words=[bank(input.vertexComponents),bank(input.fragmentComponents)];
  await rig.must(id,setupBytes(input),input.name+' setup');
  for(let stage=0;stage<2;stage++)await rig.must(id,constants(stage,words[stage]),input.name+' bank/'+stage);
  await rig.must(id,link(),'real paired link');await rig.must(id,bind(2,1),'bind fragment');
  return words;
}
// ES triangle provoking values and literal barycentric/FragCoord equations.
// The viewport is10x8 and target8x8, avoiding samples on the shared diagonal.
function predicted(input,alternate=false){
  const rgba=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    let color;
    if(input.physical==='flat')color=alternate?[0,0,0,255]:10*(y+.5)<8*(x+.5)?[255,255,0,255]:[0,255,0,255];
    else if(input.physical==='smooth')color=[Math.floor((x+.5)/10*255+.5),Math.floor((y+.5)/8*255+.5),0,255];
    else if(input.physical==='coordinate-bytes'){const word=bits(x+.5);color=[word&255,word>>>8&255,word>>>16&255,word>>>24];}
    else if(input.physical==='spatial-discard')color=x+.5<4?[0,0,255,255]:[64,128,191,255];
    else if(input.physical==='always-discard')color=[0,0,255,255];
    else throw new Error('literal physical oracle kind');
    rgba.push(...color);
  }
  return rgba;
}
async function capture(rig,id,name,prediction,result){
  const snapshot=rig.snapshot(),sub=currentSub(snapshot,id),program=sub.programs.find(p=>p.vertexGeneration===sub.bindings.vertexShader.generation&&p.fragmentGeneration===sub.bindings.fragmentShader.generation);
  require(program,'selected actual paired program');const bytes=readPixels(rig),uniforms=actualUniforms(rig,program);
  const entry={name,contextId:id,submissionIndex:rig.report.submissions.length-1,prediction,snapshot,program,nativeProgramId:rig.watch.id(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM)),uniforms,rgbaBytes:[...bytes],rgbaSha256:await digest(bytes),pixels:64,result};rig.report.draws.push(entry);
  equal([...bytes],prediction.rgba,name+' literal complete physical frame');
  for(const uniform of uniforms){const stage=uniform.stage==='vertex'?0:1;equal(uniform.words.slice(0,Math.min(uniform.activeCount,46)*4),sub.bindings.constants[stage].slice(0,Math.min(uniform.activeCount,46)*4),name+' actual uniform snapshot');}
  if(document.querySelector('#draws').children.length<12){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const flipped=new Uint8ClampedArray(bytes.length);
    for(let y=0;y<8;y++)flipped.set(bytes.subarray(y*32,(y+1)*32),(7-y)*32);
    canvas.getContext('2d').putImageData(new ImageData(flipped,8,8),0,0);
    const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=canvas.toDataURL();image.alt=name;caption.textContent=name;figure.append(image,caption);document.querySelector('#draws').append(figure);
  }
  return entry;
}
async function phase(rig,id,input,name,alternate=false,options={}){
  const prediction={fixture:input.name,physical:input.physical,alternate,rgba:predicted(input,alternate),madeBeforeEvent:rig.watch.events.length};
  rig.report.predictions??=[];rig.report.predictions.push(prediction);
  await rig.must(id,packet(11,0,[102,2,alternate?12:0]),name+' literal provoking order');
  await rig.must(id,CLEAR.slice(),name+' clear');const result=await rig.must(id,DRAW.slice(),name+' draw',options);
  return capture(rig,id,name,prediction,result);
}
async function rejectDraw(rig,id,name,stage,prefix,code='constant-exact-domain-error'){
  const before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],at=rig.watch.events.length;
  const result=await rig.run(id,prefix?join(prefix,DRAW):DRAW.slice(),name),after=rig.snapshot(),pixelsAfter=[...readPixels(rig)],events=rig.watch.events.slice(at);
  const entry={name,stage,before,after,prefix:prefix?[...prefix]:null,result,events,pixelsBefore,pixelsAfter};rig.report.attacks.push(entry);
  equal(result.ok,false,name+' rejection');equal(result.error.code,code,name+' exact error');equal(result.appliedCommands,prefix?1:0,name+' honest prefix');
  equal(pixelsBefore,pixelsAfter,name+' no framebuffer effects');equal(before.budgets,after.budgets,name+' unchanged budgets');
  require(!events.some(e=>['drawElements','getBufferSubData','copyBufferSubData','createShader','createProgram','linkProgram'].includes(e.call)),name+' no DRAW/index/link effects');
  require(!events.some(e=>e.call==='uniform4uiv'&&e.name.startsWith(stage===0?'vs':'fs')),name+' no unsafe stage upload');return entry;
}
async function exercise(rig,input){
  createResources(rig);createContext(rig,1);const words=await prepare(rig,input);
  await phase(rig,1,input,input.name+' baseline');await phase(rig,1,input,input.name+' reordered',true);
  const paired=rig.report.translations.find(x=>x.kind==='pair-exact');require(paired?.result.ok,'actual owned paired facet called');
  equal(paired.result.interfaceKey,input.interfaceKey,'full literal fragment interface');
  for(let stage=0;stage<2;stage++){
    const key=stage===0?'vertex':'fragment',metadata=paired.result[key].metadata;
    if(metadata.profile==='virgl-webgl2-raw-bits-v42')for(const component of input[key+'Components']){
      for(const word of [0,2,0x80000000,(component.word^1)>>>0].filter((v,i,a)=>v!==component.word&&a.indexOf(v)===i)){
        const wrong=words[stage].slice();wrong[component.register*4+component.component]=word;
        const entry=await rejectDraw(rig,1,input.name+' stage'+stage+' mismatch '+component.register+'.'+component.component+'/'+word,stage,constants(stage,wrong));
        equal(currentSub(entry.after,1).bindings.constants[stage],wrong,'honest rejected bank state');
        await rig.must(1,constants(stage,words[stage]),'safe stage recovery');await phase(rig,1,input,input.name+' paired recovery');
      }
    }
    if(metadata.profile==='virgl-webgl2-raw-bits-v42')for(const length of [0,180]){
      await rejectDraw(rig,1,input.name+' short stage'+stage+'/'+length,stage,constants(stage,words[stage].slice(0,length)),'incomplete-draw');await rig.must(1,constants(stage,words[stage]),'complete stage bank');
    }else{
      await rig.must(1,constants(stage,[]),'ordinary unused bank remains unconstrained');
      await phase(rig,1,input,input.name+' ordinary empty bank/'+stage);
      await rig.must(1,constants(stage,words[stage]),'restore ordinary bank');
    }
  }
  externalPoison(rig,'before owned pair restore');let attacked=false;
  await phase(rig,1,input,input.name+' owned restore',false,{mutate:true,onYield:async()=>{
    if(attacked)return;attacked=true;const before=rig.snapshot(),busy=[rig.renderer.restoreContext(1),rig.renderer.destroyContext(1),rig.renderer.beginSubmission(1,constants(0,[]))];
    for(const result of busy){equal(result.ok,false,'locked pair job');equal(result.error.code,'busy','actual async busy state');}
    equal(rig.snapshot(),before,'busy pair mutation has no effects');externalPoison(rig,'during owned paired yield');rig.report.yieldAttacks.push({before,busy,after:rig.snapshot()});
  }});if(rig.asynchronous)require(attacked,'actual async yield');
  rig.report.prunedReflection=currentSub(rig.snapshot(),1).programs[0].reflection;
}
async function lifecycle(gl,bridge,fixtures,report){
  const rig=makeRig(gl,bridge,report,true);try{
    createResources(rig);createContext(rig,1);createContext(rig,2);
    const a=fixtures.find(c=>c.name==='both-qualified-flat'),b=fixtures.find(c=>c.name==='both-qualified-coordinate-discard');
    const aw=await prepare(rig,a,1);await phase(rig,1,a,'context A flat');await prepare(rig,b,2);await phase(rig,2,b,'context B coordinate/discard');
    externalPoison(rig,'B to A pair state');await phase(rig,1,a,'A full paired restore');await phase(rig,2,b,'B full paired restore');
    await rig.must(1,packet(29,0,[7]),'new pair subcontext');await prepare(rig,b,1);await phase(rig,1,b,'isolated pair subcontext');
    await rig.must(1,packet(28,0,[0]),'default pair subcontext');await phase(rig,1,a,'surviving pair subcontext');
    rig.plans={vertex:{components:a.vertexComponents},fragment:{components:a.fragmentComponents}};
    const before=rig.snapshot();await rig.must(1,join(packet(3,4,[1]),shaderPacket(1,0,a.vertexText),bind(1,0),link()),'actual exact pair generation replacement');
    require(currentSub(before,1).bindings.vertexShader.generation!==currentSub(rig.snapshot(),1).bindings.vertexShader.generation,'new exact pair generation');
    await phase(rig,1,a,'replaced exact pair generation');report.lifecycle.push({before,after:rig.snapshot(),banks:aw});
  }finally{rig.dispose();}
}
export async function runAcceptance({seed=SEEDS[0],fault=null}={}){
  const report={schema:1,task:'E6-T12g6m3c',status:'running',guestExecution:false,trustedHostWrapper:false,seed,fault,rigs:[],shaderFixtures:[]};window.__virglExactPairReport=report;
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=8;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});require(gl instanceof WebGL2RenderingContext,'physical WebGL2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);document.querySelector('#renderer').textContent=report.renderer;
  try{
    let options={};if(fault){const bytes=new Uint8Array(await(await fetch('/target/virgl-exact-pair-fault/'+fault+'/virgl-shader.wasm')).arrayBuffer());options={wasmBinary:bytes};report.faultWasm={sha256:await digest(bytes),bytes:bytes.length};}
    const bridge=await createVirglShaderBridge(options),response=await fetch('/tools/virgl-exact-pair/fixtures.json'),raw=new Uint8Array(await response.arrayBuffer()),fixtures=JSON.parse(new TextDecoder().decode(raw)).filter(c=>c.physical);report.fixture={sha256:await digest(raw),bytes:raw.length};
    for(const input of fault?fixtures.slice(0,1):fixtures){const request=Object.fromEntries(['vertexText','fragmentText','vertexComponents','fragmentComponents'].map(k=>[k,clone(input[k])]));const result=ok(bridge.translatePairExact(request),input.name);report.shaderFixtures.push({fixture:input.name,request,result});}
    for(const asynchronous of fault?[false]:[false,true])for(const input of fault?fixtures.slice(0,1):fixtures){
      const entry={name:input.name+(asynchronous?'-async':'-sync'),fixture:input.name,width:8,...(asynchronous?{schedule:{seed,commandsPerStep:1+seed%3}}:{})};report.rigs.push(entry);
      const rig=makeRig(gl,bridge,entry,asynchronous);try{await exercise(rig,input);}finally{rig.dispose();}
    }
    if(!fault){const entry={name:'actual pair lifecycle',width:8,schedule:{seed,commandsPerStep:1+seed%3}};report.rigs.push(entry);await lifecycle(gl,bridge,fixtures,entry);}
    report.status='passed';document.querySelector('#status').textContent='Actual paired compiler, flat provoking vertices, builtin coordinates/discard and owned guards passed.';
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;}
  return report;
}
