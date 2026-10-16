// Real sync/async draw consumers. Literal F2I source equations predict pixels;
// the independent intercept refuses unsafe uploads/draws before native effects.
import {createResourceStore,createWebGL2TransferBackend} from '../../virgl-command/resources.mjs';
import {createVirglDrawRenderer,createVirglAsyncRenderer} from '../../virgl-command/state.mjs';
import {f2i,defined} from '../../../tools/virgl-signed-conversions/cases.mjs';
import {digest} from './browser.mjs';
const require=(v,label)=>{if(!v)throw new Error(label);};
const equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
const ok=(r,label)=>{require(r?.ok===true,label+': '+JSON.stringify(r));return r;};
const bits=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
const packet=(op,type,words)=>{const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op+type*256+words.length*65536,true);words.forEach((w,i)=>v.setUint32(4+4*i,w,true));return b;};
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
function shaderPacket(handle,stage,text){const b=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
const draw=()=>packet(8,0,[0,6,4,1,1,0,0,0,0,0,4095,0]);
const clear=()=>packet(7,0,[4,bits(.25),bits(.5),bits(.75),bits(1),0,0,0]);
function sources(stage){
  const imm='IMM[0] UINT32 {0,1,1065353216,0}';
  const vertex=['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',...(stage===0?['DCL TEMP[0]','DCL CONST[0..45]']:[]),stage===0?imm:'IMM[0] FLT32 {0,0,0,0}',
    ...(stage===0?['MOV TEMP[0], IMM[0].wwww','F2I TEMP[0].xz, CONST[45].wzyx','AND TEMP[0], TEMP[0], IMM[0].yyyy','UCMP OUT[1], TEMP[0], IMM[0].zzzz, IMM[0].wwww']:['MOV OUT[1], IMM[0].wwww']),
    'MOV OUT[0], IN[0]','END',''].join('\n');
  const fragment=['FRAG','DCL OUT[0], COLOR',...(stage===1?['DCL TEMP[0]','DCL CONST[0..45]',imm]:['DCL IN[0], GENERIC[0], PERSPECTIVE']),
    ...(stage===1?['MOV TEMP[0], IMM[0].wwww','F2I TEMP[0].yw, CONST[0].wzyx','AND TEMP[0], TEMP[0], IMM[0].yyyy','UCMP OUT[0], TEMP[0], IMM[0].zzzz, IMM[0].wwww']:['MOV OUT[0], IN[0]']),'END',''].join('\n');
  return {vertex,fragment};
}
function rangeComponents(stage){return {register:stage===0?45:0,mask:stage===0?10:5};}
export async function conversionBankProbe(gl,bridge,stage,asynchronous,report,{seed,stateModule}={}){
  const record={stage,asynchronous,sources:sources(stage),components:rangeComponents(stage),events:[],submissions:[],draws:[],attacks:[],oracleStops:[],restorations:[],yieldAttacks:[]};report.bankDraws.push(record);
  const locations=new WeakMap(),control={label:'setup',words:Array(184).fill(0)};
  const invalid=words=>{const {register,mask}=record.components;for(let lane=0;lane<4;lane++)if(mask&(1<<lane)){
    const index=register*4+lane;if(index<words.length&&!defined(words[index]))return {index,word:words[index]};
  }return null;};
  const watched=new Proxy(gl,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return(...args)=>{
    if(key==='uniform4uiv'&&locations.get(args[0])?.startsWith(stage===0?'vs':'fs')||key==='drawElements'){
      const bad=invalid(key==='drawElements'?control.words:[...args[1]]);
      if(bad){const point={label:control.label,call:key,...bad,unsafeGpuCalled:false};record.oracleStops.push(point);throw new Error('Independent conversion range oracle stopped unsafe GPU effect: '+JSON.stringify(point));}
    }
    const result=fn.apply(target,args);
    if(key==='getUniformLocation'&&result)locations.set(result,args[1]);
    if(['uniform4uiv','drawElements','getBufferSubData','copyBufferSubData','fenceSync','clientWaitSync','deleteSync'].includes(key))record.events.push({label:control.label,call:key,...(key==='uniform4uiv'?{name:locations.get(args[0]),words:[...args[1]]}:{})});
    return result;
  };}});
  const allocations=new Map(),backend=ok(createWebGL2TransferBackend(watched),'physical conversion backend').backend;
  const ownedBackend={...backend,allocate(meta){const storage=backend.allocate(meta);allocations.set(meta.id,storage);return storage;}};
  const {store,bindings,asyncAccess}=ok(createResourceStore({backend:ownedBackend}),'physical conversion store');
  const factory=stateModule?await import(stateModule):{createVirglDrawRenderer,createVirglAsyncRenderer};
  const renderer=ok((asynchronous?factory.createVirglAsyncRenderer:factory.createVirglDrawRenderer)({gl:watched,resources:store,bindings,shaderBridge:bridge,
    ...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:1+(seed%3)}}:{})}),'actual conversion draw renderer').renderer;
  const snapshot=()=>ok(renderer.inspect(),'conversion state snapshot');
  const submit=async(bytes,label,onYield)=>{
    control.label=label;const entry={label,before:[...bytes],states:[],eventsStart:record.events.length};record.submissions.push(entry);let result;
    if(!asynchronous){result=renderer.executeSubmission(1,bytes);bytes.fill(0xff);}
    else {const begin=renderer.beginSubmission(1,bytes);entry.begin=begin;bytes.fill(0xff);
      if(!begin.ok)result=begin;else for(let step=0;step<1000;step++){
        const state=ok(renderer.step(begin.job),'conversion async step');entry.states.push(state);if(state.status==='done'){result=state.result;break;}
        if(onYield)await onYield(state,begin.job);await new Promise(resolve=>setTimeout(resolve,step%3));
      }
    }
    require(result,'bounded conversion submission completion');entry.after=[...bytes];entry.result=result;entry.eventsEnd=record.events.length;return result;
  };
  const constants=words=>packet(12,0,[stage,0,...words]);
  const read=()=>{const fb=gl.getParameter(gl.FRAMEBUFFER_BINDING),b=new Uint8Array(64);require(fb,'conversion surface selected');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,b);equal(gl.getError(),gl.NO_ERROR,'conversion physical pixel read');return [...b];};
  const bank=(values,unused=false)=>{const words=Array(184).fill(0),{register,mask}=record.components;words.splice(register*4,4,...values);
    if(unused)for(let lane=0;lane<4;lane++)if(!(mask&(1<<lane)))words[register*4+lane]=0x4f000000;return words;};
  const physicalWords=()=>{const native=gl.getParameter(gl.CURRENT_PROGRAM),name=(stage===0?'vs':'fs')+'const0',at=gl.getUniformLocation(native,name+'['+record.components.register+']');require(at,'conversion retained source uniform');return [...gl.getUniform(native,at)];};
  const drawAndCapture=async(words,label,onYield)=>{
    control.words=words.slice();ok(await submit(constants(words),label+' SET'),'safe owned conversion bank');ok(await submit(clear(),label+' CLEAR'),'clear safe conversion scene');
    const result=ok(await submit(draw(),label+' DRAW',onYield),'safe real conversion draw'),raw=read(),source=words.slice(record.components.register*4,record.components.register*4+4),converted=source.map((w,i)=>record.components.mask&(1<<i)?f2i(w):0);
    const expected=stage===0?[converted[3]&1,0,converted[1]&1,0]:[0,converted[2]&1,0,converted[0]&1];
    const rgba=expected.map(w=>w*255);equal(raw,Array.from({length:16},()=>rgba).flat(),'independent exact conversion draw pixels');equal(physicalWords(),source,'physical conversion uniform words');
    record.draws.push({label,words:words.slice(),source,rgbaBytes:raw,sha256:await digest(Uint8Array.from(raw)),expectedRGBA:rgba,uniformWords:physicalWords(),result,snapshot:snapshot(),checkedPixels:16});
  };
  try {
    const vertexBytes=new Uint8Array(new Float32Array([-1,-1,1,-1,1,1,-1,1]).buffer),indexBytes=new Uint8Array(new Uint16Array([0,1,2,0,2,3]).buffer);
    const inputs=[{id:101,target:0,format:64,bind:16,width:vertexBytes.length,height:1,bytes:vertexBytes},{id:102,target:0,format:64,bind:32,width:indexBytes.length,height:1,bytes:indexBytes},
      {id:103,target:2,format:67,bind:10,width:4,height:4,bytes:new Uint8Array(64)}];record.resourceInputs=inputs.map(x=>({...x,bytes:[...x.bytes]}));
    for(const item of inputs){const {bytes,...metadata}=item;ok(store.createResource({...metadata,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'conversion resource');ok(store.attachBacking(item.id,[bytes]),'conversion backing');}
    ok(store.createContext(1),'conversion resource context');ok(renderer.createContext(1),'conversion renderer context');
    for(const item of inputs){ok(store.attachContext(1,item.id),'conversion resource membership');if(item.id===103)continue;
      const ticket=ok(store.prepareTransfer(1,{opcode:43,fields:{resourceHandle:item.id,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:item.width,height:1,depth:1},dataOffset:0,direction:1}}),'conversion transfer preparation').ticket;ok(store.executeTransfer(ticket),'conversion transfer');
      const bytes=new Uint8Array(item.bytes.length);gl.bindBuffer(gl.COPY_READ_BUFFER,allocations.get(item.id).buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);equal([...bytes],[...item.bytes],'physical conversion geometry bytes');
    }gl.bindBuffer(gl.COPY_READ_BUFFER,null);
    record.pair=bridge.translatePair({vertexText:record.sources.vertex,fragmentText:record.sources.fragment});ok(record.pair,'actual conversion pair');
    const metadata=(stage===0?record.pair.vertex:record.pair.fragment).metadata;equal(metadata.constantConversionDomains[0].components,[record.components],'exact independent consumed component contract');
    const setup=join(shaderPacket(1,0,record.sources.vertex),shaderPacket(2,1,record.sources.fragment),packet(1,8,[10,103,67,0,0]),packet(5,0,[1,0,10]),
      packet(1,5,[11,0,0,0,29]),packet(2,5,[11]),packet(6,0,[8,0,101]),packet(11,0,[102,2,0]),packet(4,0,[0,bits(2),bits(2),bits(.5),bits(2),bits(2),bits(.5)]),
      packet(31,0,[1,0]),packet(31,0,[2,1]),packet(52,0,[1,2,0,0,0,0]));
    ok(await submit(setup,'actual conversion scene setup'),'conversion scene setup');
    const a=bank([0x3fc00000,0xbfc00000,0x40200000,0xc0200000]),b=bank([0x40400000,0xc0400000,0x40600000,0xc0600000]);
    for(const [label,words] of [['A',a],['B',b],['A restored',a],['unused out-of-domain component',bank([0x3fc00000,0xbfc00000,0x40200000,0xc0200000],true)]])await drawAndCapture(words,label);
    ok(renderer.restoreContext(1),'explicit conversion context restoration');record.restorations.push({snapshot:snapshot(),uniformWords:physicalWords()});
    const {register,mask}=record.components,lane=[0,1,2,3].find(i=>mask&(1<<i));
    for(const poison of [0x4f000000,0x4f000001,0xcf000001,0x7f7fffff,0xff7fffff]){
      const words=a.slice();words[register*4+lane]=poison;control.words=words.slice();const start=record.events.length;
      ok(await submit(constants(words),'unsafe finite replacement '+poison),'finite raw replacement is owned');ok(renderer.restoreContext(1),'unsafe restore skips upload');
      require(!record.events.slice(start).some(e=>e.call==='uniform4uiv'&&e.name.startsWith(stage===0?'vs':'fs')),'unsafe conversion bank never uploaded');
      const before=snapshot(),pixelsBefore=read(),events=record.events.length,result=await submit(draw(),'unsafe bank draw '+poison),after=snapshot();
      equal(result.ok,false,'unsafe conversion draw rejected');equal(result.error.code,'constant-conversion-domain-error','defined range exact rejection');equal(result.appliedCommands,0,'zero draw command effects');equal(after,before,'range rejection preserves state');equal(read(),pixelsBefore,'range rejection preserves all physical pixels');
      require(!record.events.slice(events).some(e=>['uniform4uiv','drawElements','getBufferSubData','copyBufferSubData'].includes(e.call)),'rejected before native upload/index access/draw');
      record.attacks.push({poison,words,before,after,pixelsBefore,pixelsAfter:read(),result,events:record.events.slice(events)});
    }
    const short=a.slice(0,4);control.words=short.slice();ok(await submit(constants(short),'incomplete conversion bank'),'partial owned replacement');const incomplete=await submit(draw(),'incomplete conversion draw');equal(incomplete.ok,false,'complete declared bank required');equal(incomplete.error.code,'incomplete-draw','pruning cannot remove complete prefix guard');record.attacks.push({name:'incomplete bank',words:short,result:incomplete});
    let yielded=false;
    await drawAndCapture(a,'restored after range rejects',asynchronous?async()=>{
      if(yielded||snapshot().jobs.status!=='waiting-index')return;yielded=true;const before=snapshot(),unsafe=a.slice();unsafe[register*4+lane]=0x4f000000;
      const attempts=[renderer.beginSubmission(1,constants(unsafe)),renderer.restoreContext(1),renderer.destroyContext(1)];for(const r of attempts){equal(r.ok,false,'held async bank identity');equal(r.error.code,'busy','busy immutable draw plan');}
      const native=gl.getParameter(gl.CURRENT_PROGRAM),location=gl.getUniformLocation(native,(stage===0?'vs':'fs')+'const0['+register+']');gl.uniform4uiv(location,new Uint32Array([bits(7),bits(7),bits(7),bits(7)]));
      record.yieldAttacks.push({before,after:snapshot(),attempts,externalUniformPoison:[bits(7),bits(7),bits(7),bits(7)]});
    }:null);
    if(asynchronous)require(yielded,'actual conversion async index wait exercised');
    require(record.oracleStops.length===0,'authentic range guard precedes every native effect');
  } finally {
    ok(renderer.dispose(),'conversion renderer disposal');record.finalBudgets=snapshot().budgets;require(Object.values(record.finalBudgets).every(v=>v===0),'zero conversion draw budgets');
    ok(store.dispose(),'conversion resource disposal');record.finalResourceBudgets=ok(store.inspect(),'conversion disposed resources').budgets;require(Object.values(record.finalResourceBudgets).every(v=>v===0),'zero conversion resource budgets');gl.useProgram(null);
  }
}
