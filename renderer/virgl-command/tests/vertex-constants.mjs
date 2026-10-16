// Authored VirGL wire witnesses; expected colors are literal independent oracles.
import {decodeSubmission} from '../decoder.mjs';
import {parseConstantDomain} from '../constant-domain.mjs';
import {createResourceStore, createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer, createVirglAsyncRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

export const PROFILE = 'virgl-webgl2-straight-line-v6';
export const FRAGMENT = 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
export function vertex(op='MOV', declarations='DCL CONST[0..127]') {
  const operands={MOV:'CONST[127]',ADD:'CONST[120], CONST[127]',MUL:'CONST[124], CONST[127]',MAD:'CONST[120], CONST[124], CONST[127]'};
  return `VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n${declarations}\n0: MOV OUT[0], IN[0]\n1: ${op} OUT[1], ${operands[op]}\n2: END\n`;
}
const scalar=(stage,index,declarations=`DCL CONST[${index}]`,op=`MOV OUT[0], CONST[${index}]`)=>
  `${stage===0?'VERT':'FRAG'}\n${declarations}\nDCL OUT[0], ${stage===0?'POSITION':'COLOR'}\n0: ${op}\n1: END\n`;
export const COMPILER_CASES = [
  ...['MOV','ADD','MUL','MAD'].flatMap(op=>[
    {name:op+' highest ordinary vertex',kind:0,text:vertex(op),ok:true,profile:PROFILE,count:128},
    {name:op+' complete pair',kind:2,text:vertex(op),fragment:FRAGMENT,ok:true,profile:PROFILE,count:128},
  ]),
  {name:'hole highest only',kind:0,text:scalar(0,127),ok:true,profile:PROFILE,count:128},
  {name:'reordered final CONST0 suffix',kind:2,text:vertex('MAD','DCL CONST[127]\nDCL CONST[124]\nDCL CONST[120]\nDCL CONST[0]'),fragment:FRAGMENT,ok:true,profile:PROFILE,count:129},
  {name:'old inaccessible suffix',kind:0,text:scalar(0,45,'DCL CONST[45]\nDCL CONST[0]'),ok:true,profile:'virgl-webgl2-straight-line-v5',count:47},
  {name:'first wider register',kind:0,text:scalar(0,46),ok:true,profile:PROFILE,count:47},
  {name:'fragment old maximum',kind:1,text:scalar(1,45),ok:true,profile:'virgl-webgl2-straight-line-v5',count:46},
  {name:'vertex index128',kind:0,text:scalar(0,128),ok:false},
  {name:'vertex crossing range',kind:0,text:scalar(0,127,'DCL CONST[0..128]'),ok:false},
  {name:'fragment index46',kind:1,text:scalar(1,46),ok:false},
  {name:'fragment index127',kind:1,text:scalar(1,127),ok:false},
  {name:'undeclared high hole',kind:0,text:scalar(0,126,'DCL CONST[127]'),ok:false},
  {name:'duplicate last CONST0',kind:0,text:scalar(0,127,'DCL CONST[127]\nDCL CONST[0]\nDCL CONST[0]'),ok:false},
  {name:'overlapping high ranges',kind:0,text:scalar(0,127,'DCL CONST[120..127]\nDCL CONST[124..127]'),ok:false},
  {name:'aliased declaration mask',kind:0,text:scalar(0,127,'DCL CONST[127].xx'),ok:false},
  {name:'partial constant declaration',kind:0,text:scalar(0,127,'DCL CONST[127].xy'),ok:false},
  {name:'high canonical leading zero',kind:0,text:scalar(0,'0127'),ok:false},
  ...['DP3','UADD','ADD_PRECISE','POW'].map(op=>({name:'raw high '+op,kind:0,text:scalar(0,127,undefined,`${op} OUT[0], CONST[127], CONST[127]`),ok:false})),
  {name:'raw source negation',kind:0,text:scalar(0,127,undefined,'ADD OUT[0], -CONST[127], CONST[127]'),ok:false},
  {name:'private high exact tuple',kind:3,text:scalar(0,127),ok:false},
];

function checks() {
  const rows=[];
  const same=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(prediction+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(observed));};
  const ok=(r,label)=>{same(r?.ok,true,label+' '+(r?.error?.code??''));return r;};
  const bad=(r,label,code)=>{same(r?.ok,false,label+' rejects');if(code)same(r.error.code,code,label+' code');return r;};
  return {same,ok,bad,rows};
}
export function runCompilerAcceptance(bridge) {
  const c=checks(),results=[];
  for(const test of COMPILER_CASES){
    const result=test.kind===2?bridge.translatePair({vertexText:test.text,fragmentText:test.fragment}):test.kind===3?
      bridge.translateExact({stage:'vertex',text:test.text,components:[{register:127,component:0,word:0}]}):
      bridge.translate({stage:test.kind===1?'fragment':'vertex',text:test.text});
    c.same(result.ok,test.ok,test.name+' admission');
    if(test.ok){const shader=test.kind===2?result.vertex:result;
      c.same(shader.metadata.profile,test.profile,test.name+' profile');c.same(shader.metadata.uniforms[0].count,test.count,test.name+' declared bank');
      c.ok(parseConstantDomain(shader.metadata,test.kind===1?'fragment':'vertex'),test.name+' recognized metadata');
      c.same(Object.hasOwn(shader.metadata,'constantExactDomains'),false,test.name+' no private exact authority');
      c.same(shader.glsl.startsWith('#version 300 es'),true,test.name+' ESSL300');
    }else c.same(typeof result.error?.code,'string',test.name+' complete typed error');
    results.push({name:test.name,result});
  }
  return {status:'passed',assertions:c.rows,results};
}

function packet(op,type,words){const b=new Uint8Array((words.length+1)*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
const fw=n=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,n,true);return v.getUint32(0,true);};
function shader(id,stage,text){const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
const constants=words=>packet(12,0,[0,0,...words]);
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const A={120:[.25,0,.5,.5],124:[.5,.5,.5,.5],127:[.25,.5,.25,.5]};
const B={120:[.5,.25,0,.5],124:[.5,.25,1,.5],127:[0,.5,.25,.25]};
export const EXPECTED_COLORS={MOV:[[64,128,64,128],[0,128,64,64]],ADD:[[128,128,191,255],[128,191,64,191]],MUL:[[32,64,32,64],[0,32,64,32]],MAD:[[96,128,128,191],[64,143,64,128]]};
const bank=values=>{const words=Array(512).fill(0);for(const[index,lanes]of Object.entries(values))words.splice(Number(index)*4,4,...lanes.map(fw));return words;};
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const base64=b=>btoa(String.fromCharCode(...b));
async function digest(b){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');}

function rig(gl,bridge,c,{async=false,delay=0,hostLimit=null,suffix=false,forge=null}={}){
  const allocations=new Map(),calls=[],uploads=[],programs=new Set(),live=new Map(['Texture','Buffer','Shader','Program','Sampler','VertexArray','Framebuffer','Sync'].map(k=>[k,new Set()]));
  let waits=0,fences=0,remaining=0;
  const methods=new Map(),traced=new Proxy(gl,{get(t,k){if(typeof t[k]!=='function')return Reflect.get(t,k,t);if(methods.has(k))return methods.get(k);
    const f=(...args)=>{if(k==='getParameter'&&args[0]===gl.MAX_VERTEX_UNIFORM_COMPONENTS&&hostLimit!==null)return hostLimit;
      if(k==='getActiveUniforms'&&args[2]===gl.UNIFORM_SIZE&&suffix)return [129];
      if(k==='clientWaitSync'){waits++;if(remaining>0){remaining--;return gl.TIMEOUT_EXPIRED;}}
      if(k==='drawArrays'||k==='drawElements')calls.push({op:k,args:[...args]});
      if(k==='uniform4uiv')uploads.push({words:[...args[1]],programIndex:[...programs].indexOf(gl.getParameter(gl.CURRENT_PROGRAM))});
      const out=t[k].apply(t,args);
      if(k==='createProgram'&&out)programs.add(out);
      if(k.startsWith('create')){const kind=k.slice(6);if(live.has(kind)&&out)live.get(kind).add(out);}
      if(k.startsWith('delete')){const kind=k.slice(6);if(live.has(kind))live.get(kind).delete(args[0]);}
      if(k==='fenceSync'){fences++;remaining=delay;}return out;};methods.set(k,f);return f;
  }});
  const wrapped={...bridge,translate(r){const result=bridge.translate(r);if(!result.ok||!forge)return result;const owned=structuredClone(result);forge(owned.metadata,r);return owned;}};
  const backend=c.ok(createWebGL2TransferBackend(traced),'wide physical backend').backend;
  const owned=c.ok(createResourceStore({backend:{...backend,allocate(m){const out=backend.allocate(m);allocations.set(m.id,out);return out;}}}),'wide owned resources');
  const renderer=c.ok((async?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:traced,resources:owned.store,bindings:owned.bindings,shaderBridge:wrapped,
    limits:{programs:2,uniformBytes:1312},cacheLimits:{translations:2,states:4},...(async?{asyncAccess:owned.asyncAccess,jobLimits:{commandsPerStep:1}}:{})}),'wide renderer').renderer;
  for(const ctx of [1,2]){c.ok(owned.store.createContext(ctx),'wide resource context '+ctx);c.ok(renderer.createContext(ctx),'wide renderer context '+ctx);}
  for(const m of [meta(1,2,67,2,16,16),meta(3,0,64,16,32)]){c.ok(owned.store.createResource(m),'wide resource '+m.id);for(const ctx of[1,2])c.ok(owned.store.attachContext(ctx,m.id),'wide attach '+ctx+'/'+m.id);}
  const geometry=new Uint8Array(32);new Float32Array(geometry.buffer).set([-1,-1,-1,1,1,-1,1,1]);c.ok(owned.store.attachBacking(3,[geometry]),'wide CPU vertices');
  const reader=gl.createFramebuffer();return{...owned,renderer,gl,traced,allocations,calls,uploads,live,reader,waits:()=>waits,fences:()=>fences};
}
function setup(text,id=10){return join(shader(id,0,text),shader(2,1,FRAGMENT),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
  packet(1,5,[5,0,0,0,29]),packet(2,5,[5]),packet(6,0,[8,0,3]),packet(4,0,[0,...[8,8,.5,8,8,.5].map(fw)]),
  packet(31,0,[id,0]),packet(31,0,[2,1]),packet(43,0,[3,0,0,0,0,0,0,0,32,1,1,0,1]));}
const run=(r,c,b,label,ctx=1)=>c.ok(r.renderer.executeSubmission(ctx,b),label);
function read(r,c,expected,label){const gl=r.gl;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,r.reader);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations.get(1).texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const p of[gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  const bytes=new Uint8Array(1024);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,bytes);const errors=[];for(let i=0;i<256;i++)if(JSON.stringify([...bytes.subarray(i*4,i*4+4)])!==JSON.stringify(expected))errors.push({pixel:i,actual:[...bytes.subarray(i*4,i*4+4)],expected});c.same(errors.slice(0,3),[],label+' literal physical pixels');return bytes;}
function dispose(r,c,label){r.gl.deleteFramebuffer(r.reader);c.ok(r.renderer.dispose(),label+' renderer disposal');c.ok(r.store.dispose(),label+' store disposal');for(const owner of[r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' final accounting').budgets))c.same(v,0,label+' budget '+k);for(const[k,v]of r.live)c.same(v.size,0,label+' native '+k);c.same(r.gl.getError(),r.gl.NO_ERROR,label+' no GL errors');}
function rejectDraw(r,c,bytes,label,code){const before=r.calls.length;c.bad(r.renderer.executeSubmission(1,bytes),label,code);c.same(r.calls.length,before,label+' zero native draws');}

export async function runBrowserVertexAcceptance(){
  const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,alpha:false});c.same(Boolean(gl),true,'physical WebGL2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');const gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};c.same(/SwiftShader|llvmpipe|softpipe|lavapipe/i.test(gpu.renderer),false,'physical renderer identity');
  const bridge=await createVirglShaderBridge(),compiler=runCompilerAcceptance(bridge),frames=[],records=[];
  const r=rig(gl,bridge,c);run(r,c,setup(vertex()),'wide setup A');run(r,c,setup(vertex('MAD')), 'wide setup B',2);
  for(const[opIndex,op]of['MOV','ADD','MUL','MAD'].entries()){
    if(opIndex)run(r,c,join(shader(10+opIndex,0,vertex(op)),packet(31,0,[10+opIndex,0])),'wide '+op+' bind');
    for(const phase of[0,1,0]){const words=bank(phase?B:A);const bytes=join(constants(words),draw());run(r,c,bytes,op+' bank '+phase);const pixels=read(r,c,EXPECTED_COLORS[op][phase],op+' bank '+phase);frames.push(pixels);records.push({name:op+'-'+phase,expected:EXPECTED_COLORS[op][phase],packetHex:hex(bytes),words,pixelSha256:await digest(pixels)});
      const reflection=r.renderer.inspect().contexts[0].subContexts[0].programs.find(p=>p.vertexHandle===10+opIndex)?.reflection;
      c.same(reflection.uniforms[0].activeCount,128,op+' complete native active prefix');c.same(reflection.uniforms[0].uploadCount,128,op+' complete upload prefix');c.same(r.uploads.at(-1).words,words,op+' owned exact high bank');
    }
    run(r,c,join(constants(bank(B)),draw()),op+' intervening context B',2);read(r,c,EXPECTED_COLORS.MAD[1],op+' context B');
    run(r,c,draw(),op+' return context A');read(r,c,EXPECTED_COLORS[op][0],op+' return A');
  }
  const warm=r.renderer.inspect();c.same(warm.caches.program.evictions>0,true,'wide actual two-program pressure');c.same(warm.caches.translation.evictions>0,true,'wide translation pressure');c.same(warm.caches.state.evictions>0,true,'wide bank-state pressure');
  rejectDraw(r,c,join(constants(bank(A).slice(0,508)),draw()),'short highest active vec4','incomplete-draw');
  const nonfinite=bank(A);nonfinite[127*4+3]=0x7f800000;rejectDraw(r,c,join(constants(nonfinite),draw()),'high infinity','invalid-value');
  nonfinite[127*4+3]=0x7fc00001;rejectDraw(r,c,join(constants(nonfinite),draw()),'high NaN','invalid-value');
  const poison=bank(A);poison[4]=0x7fc00001;rejectDraw(r,c,join(constants(poison),draw()),'unread hole NaN','invalid-value');
  rejectDraw(r,c,join(constants([...bank(A),0,0,0,0]),draw()),'packet beyond vertex128','limit-exceeded');
  rejectDraw(r,c,join(packet(12,0,[1,0,...Array(188).fill(0)]),draw()),'fragment packet beyond46','limit-exceeded');
  rejectDraw(r,c,join(constants(bank(A).slice(0,511)),draw()),'incomplete final vector','payload-length');
  run(r,c,join(constants(bank(B)),draw()),'complete high recovery');read(r,c,EXPECTED_COLORS.MAD[1],'complete high recovery');dispose(r,c,'ordinary wide');
  const suffix=rig(gl,bridge,c,{suffix:true});const suffixText=vertex('MAD','DCL CONST[127]\nDCL CONST[124]\nDCL CONST[120]\nDCL CONST[0]');run(suffix,c,join(setup(suffixText),constants(bank(A)),draw()),'retained suffix physical draw');read(suffix,c,EXPECTED_COLORS.MAD[0],'retained suffix');const suffixReflection=suffix.renderer.inspect().contexts[0].subContexts[0].programs[0].reflection.uniforms[0];c.same(suffixReflection.count,129,'reordered declaration inaccessible extra element');c.same(suffixReflection.activeCount,129,'driver-retained suffix exercised');c.same(suffixReflection.uploadCount,128,'suffix never admits guest128');c.same(suffix.uploads.at(-1).words.length,512,'suffix uploads only512 guest words');dispose(suffix,c,'suffix');
  const low=rig(gl,bridge,c,{hostLimit:511});rejectDraw(low,c,join(setup(vertex()),constants(bank(A)),draw()),'reduced native host limit','shader-reflection-error');dispose(low,c,'host bound');
  for(const[name,forge]of[
    ['oversized metadata',(m,q)=>{if(q.stage==='vertex')m.uniforms[0].count=130;}],
    ['old profile high extent',(m,q)=>{if(q.stage==='vertex')m.profile='virgl-webgl2-straight-line-v5';}],
    ['raw profile high extent',(m,q)=>{if(q.stage==='vertex')m.profile='virgl-webgl2-raw-bits-v1';}],
    ['wide fragment metadata',(m,q)=>{if(q.stage==='fragment')m.profile=PROFILE;}],
  ]){const fake=rig(gl,bridge,c,{forge});rejectDraw(fake,c,join(setup(vertex()),constants(bank(A)),draw()),name);dispose(fake,c,name);}
  const jobs=[];
  for(const delay of[0,1,3]){const a=rig(gl,bridge,c,{async:true,delay});
    async function pump(bytes,label,mutate=false){const token=c.ok(a.renderer.beginSubmission(1,bytes),label+' begin').job;if(mutate)bytes.fill(255);let result,polls=0;
      for(;polls<1000;polls++){const step=c.ok(a.renderer.step(token),label+' step');if(step.status==='needs-input'){const geometry=new Uint8Array(32);new Float32Array(geometry.buffer).set([-1,-1,-1,1,1,-1,1,1]);c.ok(a.renderer.provideInput(token,step.request.token,geometry),label+' owned input');}else if(step.status==='done'){result=c.ok(step.result,label+' result');break;}await new Promise(resolve=>setTimeout(resolve,0));}
      c.same(Boolean(result),true,label+' bounded actual retirement');return {result,polls};}
    await pump(setup(vertex('MAD')),'async wide setup');const initialFences=a.fences(),initialWaits=a.waits();
    const original=join(constants(bank(B)),draw()),saved=hex(original),{result,polls}=await pump(original,'owned wide job',true);c.same(result.gpuComplete,true,'real high-bank GPU retirement');c.same(a.fences()-initialFences,1,'real high-bank fence');c.same(a.waits()-initialWaits>=delay+1,true,'delayed real fence wait');c.same(a.calls.length,1,'async one actual draw');const pixels=read(a,c,EXPECTED_COLORS.MAD[1],'owned async high bank');frames.push(pixels);records.push({name:'async-'+delay,expected:EXPECTED_COLORS.MAD[1],packetHex:saved,words:bank(B),pixelSha256:await digest(pixels)});jobs.push({delay,polls,waits:a.waits(),fences:a.fences(),gpuComplete:result.gpuComplete});dispose(a,c,'async '+delay);}
  const raw=new Uint8Array(frames.length*1024);frames.forEach((f,i)=>raw.set(f,i*1024));
  const decoded=c.ok(decodeSubmission(constants(bank(A))),'ordinary512-word independent decoder');c.same(decoded.commands[0].fields.words,bank(A),'decoder owns every high raw word');
  return {status:'passed',guestExecution:false,productionNegotiation:false,gpu,compiler,assertions:c.rows,records,jobs,warm,suffixReflection,rawPixelsBase64:base64(raw),rawBytes:raw.length,rawSha256:await digest(raw)};
}
