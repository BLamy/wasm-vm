// Fresh E6-T11d5 critic: literal packets and a CPU oracle independent of renderer
// admission, emitted GLSL, reflection plans, and the worker's pixel fixtures.
import { createVirglStandardAsyncRenderer } from '../state.mjs';
import { createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { createVirglStandardShaderBridge } from '../../virgl-shader/standard.mjs';
import { parseStandardShaderMetadata, parseConstantDomain, normalizeStandardShaderResult,
  normalizeStandardShaderPair, deriveStandardShaderInterface } from '../constant-domain.mjs';
const assert=(value,label)=>{if(!value)throw new Error(label);};
const same=(a,b,label)=>assert(JSON.stringify(a)===JSON.stringify(b),label+' expected '+JSON.stringify(b)+' observed '+JSON.stringify(a));
const ok=(r,label)=>{assert(r?.ok,label+': '+JSON.stringify(r?.error));return r;};
const cp=x=>JSON.parse(JSON.stringify(x));
const bits=n=>{const b=new DataView(new ArrayBuffer(4));b.setFloat32(0,n,true);return b.getUint32(0,true);};
const hex=b=>[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
const quant=x=>Math.round(255*Math.min(1,Math.max(0,x)));
function packet(op,kind,words){const b=new Uint8Array(4+4*words.length),v=new DataView(b.buffer);v.setUint32(0,op|(kind<<8)|(words.length<<16),true);for(let i=0;i<words.length;i++)v.setUint32(4+4*i,words[i],true);return b;}
function join(...b){const out=new Uint8Array(b.reduce((n,x)=>n+x.length,0));let at=0;for(const x of b){out.set(x,at);at+=x.length;}return out;}
const bank=(s,w)=>packet(12,0,[s,0,...w]);
function shader(id,stage,text){const out=packet(1,4,[id,stage,text.length+1,8192,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);out.set(new TextEncoder().encode(text),24);return out;}
const tgsi=(s,d,b)=>(s===0?'VERT':'FRAG')+'\n'+d+'\n'+[...b,'END'].map((x,i)=>i+': '+x+'\n').join('');
const VS=tgsi(0,'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[29], GENERIC[14]\nDCL OUT[31], GENERIC[15]\nDCL CONST[0..2]\nDCL SAMP[3]\nDCL SAMP[15]\nDCL SVIEW[3], 2D, FLOAT\nDCL SVIEW[15], 2D, FLOAT\nDCL TEMP[0..2]\nIMM[0] FLT32 {0.75,0.25,0,1}\nIMM[1] FLT32 {0.25,0.75,0,1}',[
 'MOV OUT[0], IN[0]','TEX TEMP[0], IMM[0], SAMP[3], 2D','TEX TEMP[1], IMM[1], SAMP[15], 2D',
 'ADD TEMP[2], TEMP[0], TEMP[1]','MUL TEMP[2], TEMP[2], CONST[0]','ADD OUT[31], TEMP[2], CONST[2]','MOV OUT[29], CONST[1]']);
const FS=tgsi(1,'DCL IN[28], GENERIC[14], CONSTANT\nDCL IN[31], GENERIC[15], PERSPECTIVE\nDCL OUT[31], COLOR\nDCL CONST[0..2]\nDCL SAMP[2]\nDCL SAMP[15]\nDCL SVIEW[2], 2D, FLOAT\nDCL SVIEW[15], 2D, FLOAT\nDCL TEMP[0..3]\nIMM[0] FLT32 {0.75,0.75,0,1}\nIMM[1] FLT32 {0.25,0.25,0,1}\nIMM[2] FLT32 {0,0,0,0}',[
 'TEX TEMP[0], IMM[0], SAMP[2], 2D','TEX TEMP[1], IMM[1], SAMP[15], 2D','ADD TEMP[2], TEMP[0], TEMP[1]',
 'MUL TEMP[2], TEMP[2], CONST[0]','ADD TEMP[2], TEMP[2], IN[31]','ADD TEMP[2], TEMP[2], CONST[2]',
 'USEQ TEMP[3], IN[28], CONST[1]','UCMP OUT[31], TEMP[3], TEMP[2], IMM[2]']);
const UNUSED=tgsi(1,'DCL OUT[31], COLOR\nDCL SAMP[2]\nDCL SVIEW[2], 2D, FLOAT\nDCL TEMP[0]\nIMM[0] FLT32 {0.75,0.75,0,1}\nIMM[1] FLT32 {0.25,0.125,0.5,1}',
 ['TEX TEMP[0], IMM[0], SAMP[2], 2D','MOV OUT[31], IMM[1]']);
export function specimen(seed){
 const raw=[(0x7fc00000|(seed&0x003fffff))>>>0,0x7f800000,(0xffffffff^seed)>>>0,0x80000000],shift=seed%13;
 const images=Array.from({length:4},(_,image)=>Array.from({length:16},(_,at)=>12+image*5+Math.floor(at/4)*24+(at%4)*9+shift));
 const vb=[...Array(4).fill(.5),...raw,...[.03125,.015625,.0625,.125]],fb=[...Array(4).fill(.25),...raw,...[.015625,.03125,.015625,.03125]];
 return {seed,vertex:VS,fragment:FS,unused:UNUSED,images,views:[[1,3,2,0],[2,1,0,3],[4,0,5,2],[3,2,1,0]],vb,fb};
}
function expected(spec,vb,fb,views=spec.views){
 const texel=[1,2,3,0],sample=(i,l)=>{const sw=views[i][l];return sw===4?0:sw===5?1:spec.images[i][4*texel[i]+sw]/255;};
 return Array.from({length:4},(_,l)=>{
  if((vb[4+l]??0)!==(fb[4+l]??0))return 0;
  return quant((sample(0,l)+sample(1,l))*(vb[l]??0)+(vb[8+l]??0)+
   (sample(2,l)+sample(3,l))*(fb[l]??0)+(fb[8+l]??0));
 });
}
export function predict(seed){const s=specimen(seed),shortV=s.vb.slice(0,8),shortF=s.fb.slice(0,8),b=s.fb.map((n,i)=>i<4?.125:i>=8?.0625:n),changed=s.views.map(x=>x.slice());changed[1]=[4,5,4,5];return {
 seed,frames:[['full',expected(s,s.vb,s.fb)],['short-fs',expected(s,s.vb,shortF)],['short-both',expected(s,shortV,shortF)],
 ['context-B',expected(s,s.vb,b)],['context-A',expected(s,shortV,shortF)],['retained-view',expected(s,shortV,shortF)],
 ['rebound-view',expected(s,shortV,shortF,changed)],['empty-fs',[0,0,0,0]],['empty-vs',[0,0,0,0]],
 ['retained-shader',expected(s,s.vb,s.fb,changed)],['optimized-out',[64,32,128,255]]],specimen:s};}
export function metadataAttacks(bridge){
 const v=ok(bridge.translate({stage:'vertex',text:VS}),'critic vertex'),f=ok(bridge.translate({stage:'fragment',text:FS}),'critic fragment'),p=ok(bridge.translatePair({vertexText:VS,fragmentText:FS}),'critic pair'),rows=[];
 const reject=(label,observed)=>{same(observed.ok,false,label);rows.push({label,code:observed.error.code,held:true});};
 for(const [label,mutate,stage,source] of [
  ['GENERIC16',m=>{m.inputs[0].semanticIndex=16;},'fragment',f],
  ['physical32',m=>{m.inputs[0].index=32;},'fragment',f],
  ['sampler16',m=>{m.samplers[1].index=16;},'fragment',f],
  ['sampler order',m=>{m.samplers.reverse();},'fragment',f],
  ['duplicate sampler',m=>{m.samplers[1]=cp(m.samplers[0]);},'fragment',f],
  ['IO order',m=>{m.inputs.reverse();},'fragment',f],
  ['duplicate semantic',m=>{m.outputs[2]={...m.outputs[1],index:31};},'vertex',v],
  ['input write authority',m=>{m.inputs[0].syntacticWriteMask=15;},'vertex',v],
  ['system byte extent',m=>{m.uniformBlocks[0].byteLength=672;},'vertex',v],
  ['system default',m=>{m.uniformBlocks[0].members[0].default=-1;},'vertex',v],
  ['attribute16',m=>{m.inputs[0].index=16;},'vertex',v],
  ['native exact authority',m=>{m.standardSemantics.exactAuthority=true;},'fragment',f],
  ['COLOR1',m=>{m.outputs[0].semanticIndex=1;},'fragment',f],
  ['513 constants',m=>{m.uniforms[0].count=513;},'fragment',f],
  ['sparse samplers',m=>{delete m.samplers[0];},'fragment',f],
  ['foreign inherited fields',()=>{},'fragment',{metadata:Object.create(f.metadata)}],
 ]){const m=source===f||source===v?cp(source.metadata):source.metadata;mutate(m);reject(label,parseStandardShaderMetadata(m,stage));}
 let getters=0;const m=cp(f.metadata);Object.defineProperty(m.samplers[0],'name',{get(){getters++;return 'fssamp2';}});reject('nested sampler getter',parseStandardShaderMetadata(m,'fragment'));same(getters,0,'no getter execution');
 for(const [label,x] of [['ownKeys proxy',new Proxy(f.metadata,{ownKeys(){throw Error('critic');}})],['descriptor proxy',new Proxy(f.metadata,{getOwnPropertyDescriptor(){throw Error('critic');}})]])reject(label,parseStandardShaderMetadata(x,'fragment'));
 const revoked=Proxy.revocable(f.metadata,{});revoked.revoke();reject('revoked proxy',parseStandardShaderMetadata(revoked.proxy,'fragment'));
 reject('wrong stage',normalizeStandardShaderResult(f,'vertex'));reject('legacy authority',parseConstantDomain(f.metadata,'fragment'));
 const absent=cp(v.metadata);absent.outputs=absent.outputs.filter(x=>x.semanticIndex!==14||x.semantic!=='GENERIC');reject('missing paired generic',deriveStandardShaderInterface(absent,f.metadata));
 const narrow=cp(v.metadata);narrow.outputs.find(x=>x.semantic==='GENERIC'&&x.semanticIndex===14).componentMask=1;narrow.outputs.find(x=>x.semantic==='GENERIC'&&x.semanticIndex===14).syntacticWriteMask=1;reject('paired mask insufficiency',deriveStandardShaderInterface(narrow,f.metadata));
 const altered=cp(p);altered.vertex.metadata.outputs.find(x=>x.semantic==='GENERIC'&&x.semanticIndex===14).componentMask=1;altered.vertex.metadata.outputs.find(x=>x.semantic==='GENERIC'&&x.semanticIndex===14).syntacticWriteMask=1;reject('normalized pair mask insufficiency',normalizeStandardShaderPair(altered));
 const result=ok(normalizeStandardShaderResult(f,'fragment'),'owned critic metadata');f.metadata.samplers[0].index=99;same(result.metadata.samplers[0].index,2,'owned sampler independent');
 same(result.metadata.samplers.map(x=>x.index),[2,15],'multiple sorted sampler acceptance');
 return rows;
}
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const transfer=(id,w,h=1,d=1)=>packet(43,0,[id,0,0,0,0,0,0,0,w,h,1,0,d]);
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0,0]);
const view=(id,resource,sw)=>packet(1,6,[id,resource,67|(2<<24),0,0,sw.reduce((n,x,i)=>n|(x<<(3*i)),0)]);
const bindview=(stage,slot,id)=>join(packet(10,0,[stage,slot,id]),packet(18,0,[stage,slot,8]));
const encoded=w=>w.map((n,i)=>i>=4&&i<8?n:bits(n));
function trace(gl,delay){
 const methods=new Map(),syncs=new Map(),events=[];let turn=0,label='',next=1;
 const proxy=new Proxy(gl,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;if(methods.has(name))return methods.get(name);const fn=(...args)=>{
  assert(name!=='finish','critic no finish');
  if(name==='clientWaitSync'){same(args.slice(1),[0,0],'critic zero-timeout polls');const s=syncs.get(args[0]);assert(s&&turn>s.issued&&s.last!==turn,'critic later-task owned fence');s.last=turn;const actual=value.apply(target,args),ready=actual===gl.ALREADY_SIGNALED||actual===gl.CONDITION_SATISFIED,delivered=ready&&s.left-->0?gl.TIMEOUT_EXPIRED:actual;events.push({name,label,turn,sync:s.id,actual,delivered});return delivered;}
  const result=value.apply(target,args);
  if(name==='fenceSync'&&result){const s={id:next++,issued:turn,last:-1,left:delay};syncs.set(result,s);events.push({name,label,turn,sync:s.id});}
  if(name==='deleteSync')syncs.delete(args[0]);
  if(name==='getBufferSubData')events.push({name,label,turn,bytes:args[2].byteLength});
  if(name==='uniform4uiv')events.push({name,label,turn,words:[...args[1]]});
  if(name==='drawArrays'||name==='drawElements')events.push({name,label,turn,args:[...args]});
  return result;};methods.set(name,fn);return fn;}});
 return {gl:proxy,events,next(labelValue){turn++;label=labelValue;}};
}
function rig(gl,bridge,delay,step,limits){
 const t=trace(gl,delay),allocations=[],backend=ok(createWebGL2TransferBackend(t.gl),'critic native backend').backend;
 const owner=ok(createResourceStore({backend:{...backend,allocate(m){const storage=backend.allocate(m);allocations.push({metadata:m,storage});return storage;}}}),'critic resource owner');
 const renderer=ok(createVirglStandardAsyncRenderer({gl:t.gl,resources:owner.store,bindings:owner.bindings,asyncAccess:owner.asyncAccess,shaderBridge:bridge,jobLimits:{commandsPerStep:step},limits:{programs:2,...limits}}),'critic host standard factory').renderer;
 for(const ctx of [1,2]){ok(owner.store.createContext(ctx),'critic resource context');ok(renderer.createContext(ctx),'critic renderer context');}
 const add=(m,bytes)=>{const resource=ok(owner.store.createResource(m),'critic resource').resource;allocations.at(-1).generation=resource.generation;for(const ctx of [1,2])ok(owner.store.attachContext(ctx,m.id),'critic membership');ok(owner.store.attachBacking(m.id,[bytes]),'critic backing');};
 add(meta(1,2,67,2,8,8),new Uint8Array(256));
 add(meta(3,0,64,16,64),new Uint8Array(new Float32Array([-1,-1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]).buffer));
 return {...owner,renderer,t,allocations,add,frame:0,history:[],exchanges:[],frames:[]};
}
async function submit(r,ctx,bytes,label){
 const original=hex(bytes);r.t.next(label);ok(r.renderer.beginFrame(++r.frame),'critic begin frame');const start=r.renderer.beginSubmission(ctx,bytes);bytes.fill(0xff);let result,output;
 if(!start.ok)result=start;else for(let step=0;step<1000;step++){
  await new Promise(resolve=>setTimeout(resolve,[3,0,2,1][(step+ctx)%4]));r.t.next(label);const state=ok(r.renderer.step(start.job),'critic job step');
  if(state.status==='done'){result=state.result;break;}
  if(state.status==='needs-input'){
   const q=state.request;const rows=[];for(let y=0;y<q.layout.rowCount;y++)rows.push(ok(r.store.readBacking(q.resource.id,q.layout.offset+y*q.layout.rowStride,q.layout.rowBytes),'critic fresh input').bytes);
   const bytes=join(...rows);r.exchanges.push({label,direction:'upload',resource:q.resource,hex:hex(bytes)});
   same(r.renderer.provideInput(start.job,{},bytes).ok,false,'critic foreign input identity');ok(r.renderer.provideInput(start.job,q.token,bytes),'critic input');bytes.fill(0xee);same(r.renderer.provideInput(start.job,q.token,bytes).ok,false,'critic consumed input');
  }else if(state.status==='needs-output'){
   const q=state.request;output=[...q.bytes];r.exchanges.push({label,direction:'download',resource:q.resource,hex:hex(q.bytes)});
   same(r.renderer.acknowledgeOutput(start.job,{}).ok,false,'critic foreign output identity');ok(r.renderer.acknowledgeOutput(start.job,q.token),'critic output');same(r.renderer.acknowledgeOutput(start.job,q.token).ok,false,'critic consumed output');
  }
 }
 assert(result,'critic bounded job');if(start.ok)same(r.renderer.step(start.job).ok,false,'critic consumed job');
 const dump=ok(r.renderer.endFrame(r.frame),'critic end frame').dump;const row={label,ctx,hex:original,result,dump,output};r.history.push(row);return row;
}
function setup(s,vb=s.vb,fb=s.fb){return join(transfer(3,64),shader(1,0,s.vertex),shader(2,1,s.fragment),packet(1,5,[3,0,0,0,31]),packet(2,5,[3]),packet(6,0,[16,0,3]),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[4,4,.5,4,4,.5].map(bits)]),bank(0,encoded(vb)),bank(1,encoded(fb)),packet(1,7,[8,2|(2<<3)|(2<<11),0,0,bits(1),0,0,0,0]),...s.images.map((_,i)=>transfer(5+i,2,2)),...s.views.map((sw,i)=>view(9+i,5+i,sw)),bindview(0,3,9),bindview(0,15,10),bindview(1,2,11),bindview(1,15,12),packet(31,0,[1,0]),packet(31,0,[2,1]));}
function finish(r){ok(r.renderer.dispose(),'critic renderer disposal');ok(r.store.dispose(),'critic store disposal');for(const o of [r.renderer,r.store])for(const [k,v]of Object.entries(ok(o.inspect(),'critic budgets').budgets))same(v,0,'critic zero budget '+k);}
function native(gl,r){
 const program=gl.getParameter(gl.CURRENT_PROGRAM),uniforms=[],samplers=[];assert(program,'critic actual program');
 for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){
  const a=gl.getActiveUniform(program,i);
  if(/^[vf]sconst0\[0\]$/.test(a.name)){same(a.type,gl.UNSIGNED_INT_VEC4,'critic raw reflected type');const name=a.name.slice(0,-3),words=[];for(let n=0;n<a.size;n++)words.push(...gl.getUniform(program,gl.getUniformLocation(program,name+'['+n+']')));uniforms.push({name,count:a.size,words});}
 }
 for(const [stage,slots]of [[0,[3,15]],[1,[2,15]]])for(const slot of slots){const name=(stage===0?'vssamp':'fssamp')+slot,location=gl.getUniformLocation(program,name),unit=stage===0?16+slot:slot;gl.activeTexture(gl.TEXTURE0+unit);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D);samplers.push({stage,slot,unit,value:location===null?null:gl.getUniform(program,location),resource:r.allocations.find(a=>a.storage.texture===texture)?.metadata.id??null});}
 gl.activeTexture(gl.TEXTURE0);return {uniforms,samplers};
}
export async function runAdversarial(plans){
 const report={schema:1,status:'running',plans,metadata:[],runs:[]};window.__criticStandardState=report;
 const gl=document.querySelector('canvas').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});assert(gl,'critic WebGL2');const dbg=gl.getExtension('WEBGL_debug_renderer_info');report.gpu=gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);assert(!/swiftshader|llvmpipe|software/i.test(report.gpu),'critic physical GPU');
 const bridge=await createVirglStandardShaderBridge();report.metadata=metadataAttacks(bridge);
 for(const [schedule,plan]of plans.entries()){
  const {specimen:s,seed}=plan,r=rig(gl,bridge,schedule?7:3,schedule?4:3),base=ok(bridge.translate({stage:'vertex',text:s.vertex}),'critic emitted VS');same(base.metadata.samplers.map(x=>x.index),[3,15],'critic VS multi sampler metadata');
  for(let i=0;i<4;i++)r.add(meta(5+i,2,67,8,2,2),new Uint8Array(s.images[i]));
  let vb=s.vb,fb=s.fb,views=s.views,ctx=1;
  const render=async(label,commands,wanted,optimized=false)=>{
   const rec=await submit(r,ctx,join(commands,draw(),transfer(1,8,8,2)),'critic-'+label+'-'+seed);ok(rec.result,'critic draw result');same(rec.result.gpuComplete,true,'critic completed final fence');const observed=rec.output;assert(observed?.length===256,'critic owned full output');
   const n=native(gl,r);
   for(const u of n.uniforms){const b=u.name==='vsconst0'?encoded(vb):encoded(fb);same(u.count,3,'critic actual reflected three-vector extent');same(u.words,Array.from({length:12},(_,i)=>b[i]??0),'critic actual uploaded words');}
   const mismatches=[];for(let at=0;at<observed.length;at++)if(Math.abs(observed[at]-wanted[at%4])>1&&mismatches.length<4)mismatches.push({pixel:Math.floor(at/4),lane:at%4,expected:wanted[at%4],observed:observed[at]});
   const frame={label:rec.label,expected:wanted,observedFirst:observed.slice(0,4),mismatches,native:n,pixelsHex:hex(new Uint8Array(observed)),dump:rec.dump};r.frames.push(frame);report.lastFrame=frame;
   same(mismatches,[],rec.label+' independent pixel oracle');same(gl.getError(),gl.NO_ERROR,'critic no GL error');
  };
  await render('full',setup(s),plan.frames[0][1]);
  fb=s.fb.slice(0,8);await render('short-fs',bank(1,encoded(fb)),plan.frames[1][1]);
  vb=s.vb.slice(0,8);await render('short-both',bank(0,encoded(vb)),plan.frames[2][1]);
  ctx=2;vb=s.vb;fb=s.fb.map((n,i)=>i<4?.125:i>=8?.0625:n);await render('context-B',setup(s,vb,fb),plan.frames[3][1]);
  gl.enable(gl.BLEND);gl.blendFunc(gl.ZERO,gl.ZERO);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.colorMask(false,false,false,false);gl.useProgram(null);
  ctx=1;vb=s.vb.slice(0,8);fb=s.fb.slice(0,8);await render('context-A',new Uint8Array(),plan.frames[4][1]);
  const changed=views.map(x=>x.slice());changed[1]=[4,5,4,5];
  await render('retained-view',join(packet(3,6,[10]),view(10,6,changed[1])),plan.frames[5][1]);
  views=changed;await render('rebound-view',bindview(0,15,10),plan.frames[6][1]);
  fb=[];await render('empty-fs',bank(1,[]),plan.frames[7][1]);
  vb=[];fb=s.fb;await render('empty-vs',join(bank(0,[]),bank(1,encoded(fb))),plan.frames[8][1]);
  vb=s.vb;await render('retained-shader',join(bank(0,encoded(vb)),packet(3,4,[2]),shader(2,1,s.unused)),plan.frames[9][1]);
  await render('optimized-out',packet(31,0,[2,1]),plan.frames[10][1],true);
  const last=r.frames.at(-1);same(last.native.uniforms.filter(x=>x.name==='fsconst0'),[],'critic undeclared FS bank absent');same(last.native.samplers.filter(x=>x.slot===15).map(x=>x.value),[null,null],'critic all-constant VS view and unused FS slot pruned');
  const info=ok(r.renderer.inspect(),'critic final owned state');assert(info.caches.program.evictions>0,'critic program eviction');
  report.runs.push({seed,delay:schedule?7:3,step:schedule?4:3,frames:r.frames,history:r.history,exchanges:r.exchanges,events:r.t.events,inspection:info});finish(r);
 }
 report.status='passed';return report;
}
export async function runAdmissionAttacks(plans){
 const gl=document.querySelector('canvas').getContext('webgl2'),bridge=await createVirglStandardShaderBridge(),s=plans[0].specimen,rows=[];
 const bv=ok(bridge.translate({stage:'vertex',text:s.vertex}),'quota VS').glsl.length,bf=ok(bridge.translate({stage:'fragment',text:s.fragment}),'quota FS').glsl.length;
 const cases=[['variant bytes',{limits:{shaderBytes:bv+bf+s.vertex.length+s.fragment.length+1}}],['paired smooth spoof',{compiler:{...bridge,translatePair(request){const out=cp(bridge.translatePair(request)),g=out.vertex.metadata.outputs.find(x=>x.semantic==='GENERIC'&&x.semanticIndex===14);g.type='vec4';g.interpolation='smooth';return out;}}}]];
 for(const [label,options]of cases){const r=rig(gl,options.compiler??bridge,1,3,options.limits);for(let i=0;i<4;i++)r.add(meta(5+i,2,67,8,2,2),new Uint8Array(s.images[i]));const rec=await submit(r,1,join(setup(s),draw()),'critic-reject-'+label);same(rec.result.ok,false,'critic '+label+' rejects');if(label==='variant bytes'){same(rec.result.error.opcode,31,'critic variant quota fails at link');same(rec.result.error.code,'limit-exceeded','critic variant quota code');}assert(!r.t.events.some(e=>e.name==='drawArrays'||e.name==='drawElements'),'critic admission before draw');rows.push({label,result:rec.result,events:r.t.events});finish(r);}
 return rows;
}
