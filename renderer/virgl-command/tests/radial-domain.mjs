// Real compiler results are recorded and returned unchanged to the shared renderer.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
import { ORIGINAL_INPUTS } from '../../virgl-shader/tests/components.mjs';
import { digest } from '../../virgl-shader/tests/browser.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglDrawRenderer, createVirglAsyncRenderer } from '../state.mjs';
import { admitted, proof, thresholdWord, hardwareBank, interpretColor } from '../../../tools/virgl-radial-domain/oracle.mjs';

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
const drawPacket = count => packet(8, 0, [0, count, 4, 1, 1, 0, 0, 0, 0, 0, 4095, 0]);
const POISONS = [[16, -8, 4, -2]].map(values => values.map(bits));
function shaderPacket(handle, stage, text) {
  const result = packet(1, 4, [handle, stage, text.length + 1, 256, 0, ...Array(Math.ceil((text.length + 1) / 4)).fill(0)]);
  result.set(new TextEncoder().encode(text), 24); return result;
}
function currentSub(snapshot, id) { const ctx = snapshot.contexts.find(value => value.id === id); return ctx.subContexts.find(value => value.id === ctx.currentSubContext); }
const clone=value=>JSON.parse(JSON.stringify(value));
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
  return {gl:proxy,control,events,id,finish(){equal(live.size,0,'all native objects deleted');for(const o of objects)equal(gl['is'+o.kind](o.object),false,'native object actually collected');report.glObjects={created:objects.length,live:live.size};}};
}
function makeRig(gl,bridge,report,asynchronous=false){
  const watch=instrument(gl,report),allocations=new Map(),actualBackend=ok(createWebGL2TransferBackend(watch.gl),'actual backend').backend;
  const backend={...actualBackend,allocate(meta){const value=actualBackend.allocate(meta);allocations.set(meta.id,value);return value;}};
  const {store,bindings,asyncAccess}=ok(createResourceStore({backend}),'actual resource store');
  Object.assign(report,{translations:[],submissions:[],draws:[],atlases:[],attacks:[],lifecycle:[],yieldAttacks:[],poison:[]});
  const rig={gl,watch,store,allocations,report,asynchronous,width:64};
  const capability={translate(request){const result=bridge.translate(request);report.translations.push({kind:'single',request:clone(request),result:clone(result)});return result;},translatePair(request){const result=bridge.translatePair(request);report.translations.push({kind:'pair',request:clone(request),result:clone(result)});return result;}};
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
function wordsBytes(words){const bytes=new Uint8Array(words.length*4),view=new DataView(bytes.buffer);words.forEach((word,i)=>view.setUint32(i*4,word,true));return bytes;}
function geometry(rows=null){
 const positions=[],selectorWords=[],inputWords=[],otherWords=[],indices=[];
 const quad=(x,y,width,height,bit=0,page=0)=>{const first=positions.length/2;for(const [dx,dy]of[[0,0],[1,0],[1,1],[0,1]]){positions.push(x+dx*width,y+dy*height);selectorWords.push((96+bit)*8388608+4194304,(96+page)*8388608+4194304);inputWords.push(0x3e800000,0x3f400000);otherWords.push(0x3f000017,0x3e000000);}indices.push(first,first+1,first+2,first,first+2,first+3);};
 if(rows===null)quad(-1,-1,2,2);else for(let page=0;page<rows;page++)for(let bit=0;bit<32;bit++)quad(-1+bit/16,-1+page/16,1/16,1/16,bit,page);
 const positionWords=positions.map(bits),words=[];for(let i=0;i<positions.length/2;i++)words.push(...positionWords.slice(i*2,i*2+2),...selectorWords.slice(i*2,i*2+2),...inputWords.slice(i*2,i*2+2),...otherWords.slice(i*2,i*2+2));
 return {rows,width:64,height:64,stride:32,positionWords,selectorWords,inputWords,otherWords,vertexWords:words,indexWords:indices};
}
function resources(rig,rows){
 const mesh=geometry(rows),vertices=wordsBytes(mesh.vertexWords),indices=new Uint8Array(new Uint16Array(mesh.indexWords).buffer),definitions=[
  {id:101,target:0,format:64,bind:16,width:vertices.length,height:1,bytes:vertices},
  {id:102,target:0,format:64,bind:32,width:indices.length,height:1,bytes:indices},
  {id:103,target:2,format:67,bind:10,width:64,height:64,bytes:new Uint8Array(64*64*4)}];
 rig.report.geometry=mesh;rig.report.resourceInputs=[];
 for(const item of definitions){const{id,target,format,bind,width,height,bytes}=item;ok(rig.store.createResource({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'real resource');ok(rig.store.attachBacking(id,[bytes]),'resource bytes');rig.report.resourceInputs.push({id,target,format,bind,width,height,bytes:[...bytes]});}
 ok(rig.store.createContext(1),'resource context');ok(rig.renderer.createContext(1),'renderer context');
 for(const item of definitions){ok(rig.store.attachContext(1,item.id),'resource membership');if(item.id===103)continue;const ticket=ok(rig.store.prepareTransfer(1,{opcode:43,fields:{resourceHandle:item.id,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:item.width,height:item.height,depth:1},dataOffset:0,direction:1}}),'real resource upload preparation').ticket;ok(rig.store.executeTransfer(ticket),'real resource upload');}
 rig.report.textureReadbacks=[];rig.report.bufferReadbacks=[];for(const id of[101,102]){const input=definitions.find(x=>x.id===id),bytes=new Uint8Array(input.bytes.length),gl=rig.gl,storage=rig.allocations.get(id);gl.bindBuffer(gl.COPY_READ_BUFFER,storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_READ_BUFFER,null);equal([...bytes],[...input.bytes],'actual native input bytes');rig.report.bufferReadbacks.push({resourceId:id,nativeId:rig.watch.id(storage.buffer),bytes:[...bytes]});}equal(rig.gl.getError(),rig.gl.NO_ERROR,'native buffer input readback');rig.draw=()=>drawPacket(mesh.indexWords.length);
}
function setup(fixture,pairName){const pair=fixture.pairs.find(p=>p.name===pairName),vs=fixture.shaders.find(x=>x.name===pair.vertex),fs=fixture.shaders.find(x=>x.name===pair.fragment);require(vs&&fs,'authored pair');return join(shaderPacket(1,0,vs.text),shaderPacket(2,1,fs.text),packet(1,8,[10,103,67,0,0]),packet(5,0,[1,0,10]),packet(1,5,[11,0,0,0,29,8,0,0,29,16,0,0,29,24,0,0,29]),packet(2,5,[11]),packet(6,0,[32,0,101]),packet(11,0,[102,2,0]),packet(4,0,[0,bits(32),bits(32),bits(.5),bits(32),bits(32),bits(.5)]),bind(1,0));}
async function prepare(rig,fixture,pairName,words){await rig.must(1,setup(fixture,pairName),'setup '+pairName);await upload(rig,words,'initial banks');await rig.must(1,link(),'native pair link');await rig.must(1,bind(2,1),'select fragment');}
async function upload(rig,words,label){await rig.must(1,join(constants(0,words[0]),constants(1,words[1])),label);}
function readPixels(rig){const gl=rig.gl,old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),fb=rig.watch.gl.createFramebuffer();try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,rig.allocations.get(103).texture,0);equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'independent framebuffer');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);const bytes=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'actual framebuffer readback');return bytes;}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);rig.watch.gl.deleteFramebuffer(fb);}}
function uniforms(rig,program){const gl=rig.gl,native=gl.getParameter(gl.CURRENT_PROGRAM);return program.reflection.uniforms.map(uniform=>{const words=[],base=uniform.name.replace(/\[0\]$/,'');for(let i=0;i<uniform.activeCount;i++){const location=gl.getUniformLocation(native,`${base}[${i}]`);require(location,'reflected uniform location');words.push(...gl.getUniform(native,location));}return {...uniform,words};});}
async function capture(rig,result,label){const snapshot=rig.snapshot(),sub=currentSub(snapshot,1),program=sub.programs.find(p=>p.vertexGeneration===sub.bindings.vertexShader.generation&&p.fragmentGeneration===sub.bindings.fragmentShader.generation);require(program,'selected native program');const bytes=readPixels(rig);return {label,submissionIndex:rig.report.submissions.length-1,contextId:1,subContextId:sub.id,subContextGeneration:sub.generation,bindings:sub.bindings,program,nativeProgramId:rig.watch.id(rig.gl.getParameter(rig.gl.CURRENT_PROGRAM)),uniforms:uniforms(rig,program),rgbaBytes:[...bytes],rgbaSha256:await digest(bytes),draw:result.draws[0]};}
function tile(bytes,name){if(document.querySelector('#draws').children.length>=12)return;const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const flipped=new Uint8ClampedArray(bytes.length);for(let y=0;y<64;y++)flipped.set(bytes.slice(y*256,(y+1)*256),(63-y)*256);canvas.getContext('2d').putImageData(new ImageData(flipped,64,64),0,0);const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=canvas.toDataURL();image.alt=name;caption.textContent=name;figure.append(image,caption);document.querySelector('#draws').append(figure);}
async function rejectDraw(rig,label,code){const before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],start=rig.watch.events.length,result=await rig.run(1,rig.draw(),label),after=rig.snapshot(),events=rig.watch.events.slice(start),pixelsAfter=[...readPixels(rig)];const entry={name:label,before,after,pixelsBefore,pixelsAfter,result,events};rig.report.attacks.push(entry);equal(result.ok,false,'invalid current bank draw rejected');equal(result.error.code,code,'current bank exact error');equal(result.appliedCommands,0,'no draw command applied');equal(pixelsAfter,pixelsBefore,'rejected draw leaves full framebuffer');require(events.every(e=>rig.asynchronous&&['fenceSync','fenceSchedule','clientWaitSync','deleteSync'].includes(e.call)),'rejected before draw allocation/upload/index access/dispatch');equal(after,before,'rejected draw preserves complete owned state');}
function poison(rig,label){const gl=rig.gl,native=gl.getParameter(gl.CURRENT_PROGRAM),entries=[];for(const prefix of['vs','fs'])for(const index of[0,44,45]){const location=gl.getUniformLocation(native,`${prefix}const0[${index}]`);if(location){gl.uniform4uiv(location,new Uint32Array(POISONS[0]));entries.push({name:`${prefix}const0[${index}]`,words:POISONS[0],observed:[...gl.getUniform(native,location)]});}}gl.useProgram(null);gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,1,1);gl.colorMask(false,false,false,false);const item={label,nativeProgramId:rig.watch.id(native),entries,after:{programNull:gl.getParameter(gl.CURRENT_PROGRAM)===null,framebufferNull:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null,vertexArrayNull:gl.getParameter(gl.VERTEX_ARRAY_BINDING)===null,viewport:[...gl.getParameter(gl.VIEWPORT)],colorMask:[...gl.getParameter(gl.COLOR_WRITEMASK)]}};rig.report.poison.push(item);equal(gl.getError(),gl.NO_ERROR,'external native poisoning');return item;}

async function colorDraw(rig, fixture, kernel, coefficient, label, color, options={}) {
 const input=fixture.shaders.find(s=>s.name===kernel.case),words=hardwareBank(kernel,coefficient,color);
 const oracle=interpretColor(input,kernel,words); // Checked before any draw reaches the real GPU.
 await upload(rig,[words,words],label+' banks');await rig.must(1,CLEAR.slice(),label+' clear');
 const result=await rig.must(1,rig.draw(),label,options),record=await capture(rig,result,label);
 Object.assign(record,{kernel:clone(kernel),coefficient,bank:words,oracle,checkedPixels:4096});rig.report.draws.push(record);
 for(let i=0;i<4096;i++)equal(record.rgbaBytes.slice(i*4,i*4+4),oracle.color,'literal admitted color');
 if(!rig.asynchronous)tile(record.rgbaBytes,label);
 return record;
}
async function invalidCoefficients(rig,kernel,stage){
 for(const coefficient of[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,thresholdWord-1,(thresholdWord-1)|0x80000000,0x35800000]){
  const word=coefficient>>>0,values=hardwareBank(kernel,0x3f800000);values[16]=word;
  const before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],start=rig.watch.events.length;
  const result=await rig.must(1,constants(stage,values),'replace unsafe coefficient '+stage+'/'+word),after=rig.snapshot(),events=rig.watch.events.slice(start);
  rig.report.lifecycle.push({name:'unsafe coefficient stored',stage,word,before,after,pixelsBefore,pixelsAfter:[...readPixels(rig)],result,events});
  equal(after.contexts[0].subContexts[0].bindings.constants[stage],values,'exact owned raw coefficient retained');
  require(!events.some(e=>e.call==='uniform4uiv'&&e.name===(stage?'fsconst0[0]':'vsconst0[0]')),'unsafe replaced bank never uploaded');
  await rejectDraw(rig,'radial coefficient '+stage+'/'+word,'constant-radial-domain-error');
  await upload(rig,[hardwareBank(kernel,0x3f800000),hardwareBank(kernel,0x3f800000)],'restore safe coefficient');
 }
}
async function invalidWireBanks(rig,kernel,stage){
 for(const word of[0x7f800000,0xff800000,0x7fc01234,0xffc01234]){
  const values=hardwareBank(kernel,word),bytes=constants(stage,values),packetBytes=[...bytes],before=rig.snapshot(),pixelsBefore=[...readPixels(rig)],start=rig.watch.events.length;
  const result=await rig.run(1,bytes,'nonfinite coefficient '+stage+'/'+word),after=rig.snapshot(),events=rig.watch.events.slice(start);
  rig.report.attacks.push({name:'nonfinite wire bank',stage,word,packetBytes,before,after,pixelsBefore,pixelsAfter:[...readPixels(rig)],result,events});
  equal(result.ok,false,'wire finite contract rejects');equal(result.error.code,'invalid-value','nonfinite wire code');equal(result.appliedCommands,0,'no nonfinite bank applied');equal(before,after,'no nonfinite bank change');equal(events,[],'nonfinite decode before native effects');
 }
}
async function lifecycle(rig,fixture,kind){
 const kernel=fixture.kernels.find(k=>k.case===kind+'-vertex');resources(rig,null);
 await prepare(rig,fixture,kind+'-pair',[hardwareBank(kernel,0x3f800000),hardwareBank(kernel,0x3f800000)]);
 await colorDraw(rig,fixture,kernel,0x3f800000,'initial admitted '+kind);
 for(const stage of[0,1]){
  await invalidCoefficients(rig,kernel,stage);await invalidWireBanks(rig,kernel,stage);
  await rig.must(1,constants(stage,hardwareBank(kernel,0x3f800000).slice(0,-4)),'shortened bank '+stage);
  await rejectDraw(rig,'missing complete prefix '+stage,'incomplete-draw');
  await upload(rig,[hardwareBank(kernel,0x3f800000),hardwareBank(kernel,0x3f800000)],'restore complete banks');
  if(kind==='loop'){
   const values=hardwareBank(kernel,0x3f800000,undefined,19),start=rig.watch.events.length;
   await rig.must(1,constants(stage,values),'count nineteen '+stage);
   require(!rig.watch.events.slice(start).some(e=>e.call==='uniform4uiv'&&e.name===(stage?'fsconst0[0]':'vsconst0[0]')),'invalid simultaneous count never uploaded');
   await rejectDraw(rig,'combined count '+stage,'constant-constraint-error');
   await upload(rig,[hardwareBank(kernel,0x3f800000),hardwareBank(kernel,0x3f800000)],'restore count two');
  }
 }
 for(const [i,color]of [[0,[0x3f000000,0x3e800000,0x3f000000,0x3f800000]],[1,[0x3e800000,0x3f000000,0x3e800000,0x3f800000]]])
  await colorDraw(rig,fixture,kernel,i?0xbf800000:thresholdWord,'safe bank replacement '+i,color);
 for(const stage of[0,1]){
  const input=fixture.shaders.find(x=>x.name===kind+'-'+(stage?'fragment':'vertex')),before=rig.snapshot();
  await rig.must(1,packet(3,4,[stage+1]),'retire public shader '+stage);
  await rig.must(1,shaderPacket(stage+1,stage,input.text),'shader generation replacement '+stage);
  const after=rig.snapshot();rig.report.lifecycle.push({name:'shader replacement',stage,before,after});
  await rig.must(1,bind(stage+1,stage),'select replacement '+stage);await rig.must(1,link(),'relink replacement');
  await colorDraw(rig,fixture,kernel,0x3f800000,'replacement generation '+stage);
 }
 poison(rig,'before explicit restoration');const beforeRestore=rig.snapshot(),restored=rig.renderer.restoreContext(1);
 ok(restored,'explicit restoration');rig.report.lifecycle.push({name:'explicit restoration',before:beforeRestore,after:rig.snapshot(),result:restored});
 let yielded=false;
 await colorDraw(rig,fixture,kernel,0x3f800000,'restored current approval',undefined,rig.asynchronous?{onYield:async()=>{
  if(yielded||rig.snapshot().jobs.status!=='waiting-index')return;yielded=true;const before=rig.snapshot();
  const attempts=[['begin',rig.renderer.beginSubmission(1,constants(0,hardwareBank(kernel,0)))],['restore',rig.renderer.restoreContext(1)],['destroy',rig.renderer.destroyContext(1)]];
  for(const[name,result]of attempts){equal(result.ok,false,'busy '+name);equal(result.error.code,'busy','blocked current approval mutation');}
  const nativePoison=poison(rig,'during waiting-index');rig.report.yieldAttacks.push({before,after:rig.snapshot(),attempts:attempts.map(([name,result])=>({name,result})),nativePoison});
 }}:{mutate:true});if(rig.asynchronous)require(yielded,'real async waiting-index interference');
}
export async function runAcceptance(){
 const report={schema:'radial-domain-gpu-v1',status:'running',guestExecution:false,currentGuest3dAdvertisement:false,rigs:[],domainProof:proof()};window.__virglRadialDomainReport=report;
 try{
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=64;
  const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(gl instanceof WebGL2RenderingContext,'actual WebGL2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'actual GPU identity');report.renderer={vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)};
  require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer),'real hardware GPU');
  const bridge=await createVirglShaderBridge(),fetchJSON=async path=>{const response=await fetch('/'+path);require(response.ok,'fixture');const bytes=new Uint8Array(await response.arrayBuffer());return {value:JSON.parse(new TextDecoder().decode(bytes)),binding:{path,bytes:bytes.length,sha256:await digest(bytes)}};};
  const authored=await fetchJSON('renderer/virgl-shader/tests/radial-domain-cases.json'),partners=await fetchJSON('renderer/virgl-command/tests/bounded-loops-shaders.json');report.fixture=authored.binding;report.partners=partners.binding;
  const fixture={...authored.value,shaders:authored.value.cases.filter(x=>x.ok)};
  for(const kernel of fixture.kernels){
   const entry={name:kernel.case,kernel:clone(kernel)},rig=makeRig(gl,bridge,entry);report.rigs.push(entry);
   try{resources(rig,null);await prepare(rig,fixture,'gpu-'+kernel.case+'-pair',[hardwareBank(kernel,0x3f800000),hardwareBank(kernel,0x3f800000)]);
    for(const coefficient of kernel.kind==='mini'?[thresholdWord,thresholdWord+1,thresholdWord|0x80000000,(thresholdWord+1)|0x80000000,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff]:[0x3f800000,0xbf800000])
     await colorDraw(rig,fixture,kernel,coefficient>>>0,'admitted '+kernel.case+'/'+(coefficient>>>0));
   }finally{rig.dispose();}
  }
  for(const kind of['plain','indirect','loop'])for(const schedule of[null,{seed:0x6a194fb3,commandsPerStep:1},{seed:0xb35280d7,commandsPerStep:3}]){
   const entry={name:'lifecycle-'+kind+(schedule?'-'+schedule.seed.toString(16):'-sync'),kind,...(schedule?{schedule}:{})},rig=makeRig(gl,bridge,entry,Boolean(schedule));report.rigs.push(entry);
   try{await lifecycle(rig,fixture,kind);}finally{rig.dispose();}
  }
  report.drawCount=report.rigs.reduce((n,r)=>n+r.draws.length,0);report.checkedPixels=report.drawCount*4096;report.status='passed';
  document.querySelector('#status').textContent=`${report.drawCount} admitted draws · ${report.checkedPixels} checked pixels · radial domain before GPU effects`;
  document.querySelector('#renderer').textContent=report.renderer.renderer;return report;
 }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;throw error;}
}
