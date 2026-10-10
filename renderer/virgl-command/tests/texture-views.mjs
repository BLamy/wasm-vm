import {decodeSubmission} from '../decoder.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer,createVirglStateRenderer,createVirglAsyncRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

const IDENTITY=[0,1,2,3];
const inputs={
  67:{bytes:[40,84,172,12,124,20,60,99,8,200,36,201,92,64,148,17],rgba:[[40,84,172,12],[124,20,60,99],[8,200,36,201],[92,64,148,17]]},
  2:{bytes:[172,84,40,12,60,20,124,99,36,200,8,201,148,64,92,17],rgba:[[40,84,172,255],[124,20,60,255],[8,200,36,255],[92,64,148,255]]},
  // Literal guest B10/G10/R10/X2 words, with independent normalized channels.
  233:{bytes:[170,86,5,0,85,1,240,127,0,252,175,170,255,171,90,213],rgba:[[0,85,170,255],[255,0,85,255],[170,255,0,255],[85,170,255,255]]},
};
function checks(){const rows=[];const equal=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(`${prediction}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed)}`);};const ok=(r,label)=>{equal(r?.ok,true,label+` (${r?.error?.code??''}: ${r?.error?.message??''})`);return r;};const bad=(r,label,code)=>{equal(r?.ok,false,label+' rejects');if(code)equal(r.error.code,code,label+' code');return r;};return{equal,ok,bad,rows};}
function packet(op,type,words){const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
function shader(handle,stage,text){const b=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
function view(handle,format,swizzle=IDENTITY,resource=6){return packet(1,6,[handle,resource,0x02000000|format,0,0,swizzle.reduce((n,v,i)=>n|(v<<(3*i)),0)]);}
const bindView=handle=>packet(10,0,[1,0,handle]);
const sampler=(handle,linear=false)=>packet(1,7,[handle,2|(2<<3)|(2<<6)|(2<<11)|(linear?(1<<9)|(1<<13):0),0,0,0x447a0000,0,0,0,0]);
const bindSampler=handle=>packet(18,0,[1,0,handle]);
function swizzles(){const cases=[IDENTITY,[2,1,0,3],[1,2,3,0],[3,2,1,0],[4,5,4,5],[5,4,5,4]];for(let lane=0;lane<4;lane++)for(let value=0;value<6;value++){const s=[...IDENTITY];s[lane]=value;cases.push(s);}return[...new Map(cases.map(s=>[s.join(','),s])).values()];}
async function sha(data){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');}

export function runNativeViewAcceptance(){
  const c=checks();
  for(const format of [2,67,233])for(const swizzle of swizzles()){const r=c.ok(decodeSubmission(view(1,format,swizzle)),'normalized color view wire');const f=r.commands[0].fields;c.equal([f.format,f.target,f.firstLayer,f.lastLayer,f.firstLevel,f.lastLevel,f.swizzle],[format,2,0,0,0,0,swizzle],'wire preserves immutable view semantics');c.equal(Object.isFrozen(f.swizzle),true,'decoded selectors are immutable');}
  for(const[format,target]of [[16,2],[17,2],[68,2],[134,2],[67,0],[67,1],[67,3],[67,4],[67,5],[67,6],[67,7],[67,8]])c.bad(decodeSubmission(packet(1,6,[1,6,(target<<24)|format,0,0,0x688])),'unproved view format/target','unsupported-feature');
  for(const level of [1,65536,0xffffffff])for(const field of [3,4]){const words=[1,6,0x02000043,0,0,0x688];words[field]=level;c.bad(decodeSubmission(packet(1,6,words)),'unproved layer/mip family','unsupported-feature');}
  for(const invalid of [6,7,1<<12,0xffffffff])c.bad(decodeSubmission(packet(1,6,[1,6,0x02000043,0,0,invalid])),'invalid swizzle enum/reserved bits');
  const base=2|(2<<3)|(2<<6)|(2<<11);
  for(const changed of [(base&~(3<<11)),(base&~(3<<11))|(1<<11),(base&~(3<<11))|(3<<11),base|(1<<15),base|(1<<20),(base&~7), (base&~7)|1])c.bad(decodeSubmission(packet(1,7,[1,changed,0,0,0x447a0000,0,0,0,0])),'isolated unproved mip/compare/aniso/wrap filtering','unsupported-feature');
  for(const[field,value]of [[2,0x3f800000],[3,0x3f800000],[4,0xbf800000],[2,0x7f800000],[4,0x7fc00000],[5,1]]){const words=[1,base,0,0,0x447a0000,0,0,0,0];words[field]=value;c.bad(decodeSubmission(packet(1,7,words)),'isolated invalid LOD/border filtering');}
  return{status:'passed',boundary:'Wire selector/target/filter guards only; hardware evidence is separate.',assertions:c.rows};
}

function rig(gl,bridge,c,{state=false,limits={},intercept}={}){
  const allocations=new Map(),calls=[],objects=new Map(),ids=new Map();let id=0,store,renderer;
  const identity=object=>{if(!ids.has(object))ids.set(object,++id);return ids.get(object);};
  const proxy=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{
    if(k==='shaderSource')calls.push({op:k,id:identity(args[0]),stage:t.getShaderParameter(args[0],t.SHADER_TYPE),text:args[1],bytes:args[1].length,budget:renderer?.inspect().budgets});
    if(k==='attachShader')calls.push({op:k,program:identity(args[0]),shader:identity(args[1])});
    if(k==='samplerParameteri'||k==='samplerParameterf')calls.push({op:k,pname:args[1],value:args[2]});
    if(k==='texStorage2D')calls.push({op:k,format:args[2],width:args[3],height:args[4]});
    if(k==='drawElements')calls.push({op:k,program:identity(t.getParameter(t.CURRENT_PROGRAM)),count:args[1]});
    const r=intercept?intercept(t,k,args,()=>v.apply(t,args)):v.apply(t,args);
    for(const type of ['Shader','Program','Sampler']){if(k==='create'+type&&r)objects.set(r,type);if(k==='delete'+type)objects.delete(args[0]);}return r;
  };}});
  const native=c.ok(createWebGL2TransferBackend(proxy),'view actual backend').backend,backend={...native,allocate(m){const s=native.allocate(m);allocations.set(m.id,s);return s;}};
  const resources=c.ok(createResourceStore({backend}),'view resources');store=resources.store;
  renderer=c.ok((state?createVirglStateRenderer:createVirglDrawRenderer)({gl:proxy,resources:store,bindings:resources.bindings,shaderBridge:bridge,limits}),'view renderer').renderer;
  return{...resources,renderer,allocations,calls,objects,identity,proxy,replaceRenderer(value){renderer=value;this.renderer=value;}};
}
function dispose(r,gl,c,label){c.ok(r.renderer.dispose(),label+' renderer dispose');c.ok(r.store.dispose(),label+' store dispose');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' final budgets').budgets))c.equal(v,0,label+' released '+k);c.equal(r.objects.size,0,label+' all tracked GL shader/program/sampler names deleted');c.equal(gl.getError(),gl.NO_ERROR,label+' no GL errors');}
function execute(r,bytes,c,label){return c.ok(r.renderer.executeSubmission(2,bytes),label);}
function sub(r,c){const s=c.ok(r.renderer.inspect(),'view inspection');return{s,sub:s.contexts[0].subContexts.find(sub=>sub.id===s.contexts[0].currentSubContext)};}
function readNative(gl,texture,width=32,height=32){const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);try{gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('view physical framebuffer incomplete');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);const b=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;}finally{gl.deleteFramebuffer(fb);}}
function pixel(data,x,y){return[...data.subarray((y*32+x)*4,(y*32+x+1)*4)];}
function physical(r,gl,c,format,swizzle,label){const data=readNative(gl,r.allocations.get(5).texture);for(const[i,x,y]of [[0,8,8],[1,24,8],[2,8,24],[3,24,24]]){const p=inputs[format].rgba[i],expected=swizzle.map(lane=>lane===4?0:lane===5?255:p[lane]);c.equal(pixel(data,x,y),expected,label+' physical RGBA '+format+' at '+x+','+y);}return data;}
function initialize(r,fixtures,c,format){
  for(const action of fixtures.initialization){if(action.type==='context_create'){c.ok(r.store.createContext(2),'tiny resource context');c.ok(r.renderer.createContext(2),'tiny renderer context');}else if(action.type==='resource_create')c.ok(r.store.createResource({...action.metadata,...(action.resourceId===6?{format}:{})}),'tiny color view resource');else if(action.type==='ctx_attach_resource')c.ok(r.store.attachContext(2,action.resourceId),'tiny resource membership');else if(action.type==='resource_attach_iov')c.ok(r.store.attachBacking(action.resourceId,action.iovLengths.map(n=>new Uint8Array(n))),'tiny owned backing');else throw new Error('unknown tiny initialization');}
  for(const b of fixtures.backing)for(const range of b.ranges)c.ok(r.store.writeBacking(b.resourceId,range.offset,Uint8Array.from(range.data)),'tiny unchanged CPU input');c.ok(r.store.writeBacking(7,0,Uint8Array.from(inputs[format].bytes)),'literal synthetic guest staging texture bytes');
  const raw=Uint8Array.from(fixtures.commands.submissions.find(s=>s.event===161).data),decoded=c.ok(decodeSubmission(raw),'tiny packet selection');let draw;
  for(const command of decoded.commands){const b=raw.slice(command.byteOffset,command.byteOffset+command.byteLength);if(command.opcode===8){draw=b;continue;}
    if(command.opcode===1&&command.objectType===6&&command.fields.resourceHandle===6)new DataView(b.buffer).setUint32(12,0x02000000|format,true);
    execute(r,b,c,'tiny prerequisite '+command.name);
  }
  if(!draw)throw new Error('tiny original draw absent');execute(r,sampler(90),c,'synthetic nearest sampler');execute(r,bindSampler(90),c,'nearest sampler binding');return draw;
}
function poison(gl){gl.enable(gl.BLEND);gl.blendFunc(gl.ZERO,gl.ZERO);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.NEVER);gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT_AND_BACK);gl.colorMask(false,false,false,false);gl.viewport(0,0,0,0);gl.activeTexture(gl.TEXTURE7);gl.bindSampler(0,null);}

async function formatCases(gl,bridge,fixtures,format,c){
  const r=rig(gl,bridge,c),draw=initialize(r,fixtures,c,format),cases=[];execute(r,draw,c,'default format draw');physical(r,gl,c,format,IDENTITY,'default native view');
  const allocated=r.calls.filter(x=>x.op==='texStorage2D').length,gpu=c.ok(r.store.inspect(),'initial GPU residency').budgets.gpuBytes;
  let handle=100;
  for(const swizzle of swizzles()){
    const h=handle++;execute(r,view(h,format,swizzle),c,'immutable synthetic view');execute(r,bindView(h),c,'view selection');poison(gl);execute(r,draw,c,'actual specialized guest-command draw');const pixels=physical(r,gl,c,format,swizzle,'swizzle '+swizzle.join(','));
    const state=sub(r,c),last=r.calls.filter(x=>x.op==='drawElements').at(-1),program=state.sub.programs.find(p=>r.calls.some(call=>call.op==='attachShader'&&call.program===last.program&&r.calls.some(s=>s.op==='shaderSource'&&s.id===call.shader&&s.stage===gl.FRAGMENT_SHADER))&&p.samplingViews[0]?.swizzle.join(',')===swizzle.join(','));
    c.equal(Boolean(program),true,'logical cached program has the selected immutable selectors');
    const matching=state.sub.programs.filter(p=>p.samplingViews[0]?.format===format&&p.samplingViews[0]?.swizzle.join(',')===swizzle.join(','));c.equal(matching.length,1,'one canonical program per view specialization');
    const p=matching[0];c.equal(p.samplingKey.includes('lower-left'),true,'program key includes fixed origin');if(format!==67||swizzle.some((v,i)=>v!==i))c.equal(p.key.endsWith('|'+p.samplingKey),true,'nondefault view semantics are in executable cache key');
    if(swizzle.some((v,i)=>v!==i))c.equal(p.variantBytes>0,true,'nonidentity view owns charged fragment GLSL');
    cases.push({handle:h,swizzle,programKey:p.key,samplingKey:p.samplingKey,variantBytes:p.variantBytes,nativeProgram:last.program,pixelSha256:await sha(pixels)});
  }
  c.equal(r.calls.filter(x=>x.op==='texStorage2D').length,allocated,'immutable views add no GPU image');c.equal(c.ok(r.store.inspect(),'views GPU residency').budgets.gpuBytes,gpu,'aliases share charged native storage');
  const a=cases.find(x=>x.swizzle.join(',')==='2,1,0,3'),b=cases.find(x=>x.swizzle.join(',')==='4,5,4,5'),links=r.calls.filter(x=>x.op==='attachShader').length;
  for(const entry of [a,b,a]){execute(r,bindView(entry.handle),c,'A/B/A view selection');poison(gl);execute(r,draw,c,'A/B/A actual draw');physical(r,gl,c,format,entry.swizzle,'A/B/A');c.equal(r.calls.filter(x=>x.op==='drawElements').at(-1).program,entry.nativeProgram,'A/B/A reuses its exact native program');}
  c.equal(r.calls.filter(x=>x.op==='attachShader').length,links,'A/B/A links no additional program');c.equal(a.programKey===b.programKey,false,'view swizzle keys cannot collide');
  // Names may disappear while bindings retain their immutable view/storage.
  execute(r,packet(3,6,[a.handle]),c,'bound view public destruction');execute(r,draw,c,'destroyed bound view remains drawable');physical(r,gl,c,format,a.swizzle,'retained destroyed alias');
  execute(r,view(a.handle,format,[1,2,3,0]),c,'same numeric view handle with new semantics');execute(r,bindView(a.handle),c,'reused view handle selection');execute(r,draw,c,'reused handle actual draw');physical(r,gl,c,format,[1,2,3,0],'reused view does not use stale variant');
  const report={format,cases,aliasGpuBytes:gpu,calls:r.calls};dispose(r,gl,c,'format '+format);return report;
}

async function filtersAndFlat(gl,bridge,fixtures,c){
  const r=rig(gl,bridge,c),draw=initialize(r,fixtures,c,67);execute(r,view(100,67),c,'filter identity view');execute(r,bindView(100),c,'filter view binding');execute(r,draw,c,'nearest reference');
  const nearest=readNative(gl,r.allocations.get(5).texture);c.equal(pixel(nearest,16,16),[92,64,148,17],'nearest center chooses upper-right texel');
  execute(r,sampler(91,true),c,'native linear sampler');execute(r,bindSampler(91),c,'linear sampler binding');poison(gl);execute(r,draw,c,'actual linear filtered draw');const linear=readNative(gl,r.allocations.get(5).texture);
  // Pixel center16.5 maps to uv16.5/32; a2-wide texture blends with weight34/64.
  const expected=[68,91,104,82];for(let lane=0;lane<4;lane++)c.equal(Math.abs(pixel(linear,16,16)[lane]-expected[lane])<=1,true,'independent linear center lane '+lane);
  execute(r,bindSampler(90),c,'restore nearest sampler');execute(r,draw,c,'nearest after linear');c.equal(pixel(readNative(gl,r.allocations.get(5).texture),16,16),pixel(nearest,16,16),'sampler A/B/A is native state, not a stale variant');
  const vertices=c.ok(r.store.readBacking(3,0,64),'bounded UV input').bytes,v=new DataView(vertices.buffer);for(let i=0;i<4;i++){v.setFloat32(i*16+8,i%2?2:-1,true);v.setFloat32(i*16+12,i>=2?2:-1,true);}c.ok(r.store.writeBacking(3,0,vertices),'synthetic out-of-range UVs');const transfer={opcode:43,fields:{resourceHandle:3,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:64,height:1,depth:1},dataOffset:0,direction:1}};c.ok(r.store.executeTransfer(c.ok(r.store.prepareTransfer(2,transfer),'UV transfer prepare').ticket),'UV actual upload');execute(r,draw,c,'clamp-edge sampling draw');physical(r,gl,c,67,IDENTITY,'clamp-edge outside texture');
  const text=fixtures.commands.shaders.FRAG.replace('PERSPECTIVE','CONSTANT');c.equal(text!==fixtures.commands.shaders.FRAG,true,'flat fixture changes interpolation only');execute(r,shader(99,1,text),c,'synthetic flat TEX selector');execute(r,view(101,67,[2,1,0,5]),c,'flat nonidentity view');execute(r,bindView(101),c,'flat view binding');execute(r,packet(31,0,[99,1]),c,'flat texture selector binding');execute(r,draw,c,'combined flat/view variant draw');const flat=readNative(gl,r.allocations.get(5).texture);c.equal(pixel(flat,8,8),[36,200,8,255],'flat first provoking vertex and swizzle');c.equal(pixel(flat,24,24),[148,64,92,255],'flat second provoking vertex and swizzle');
  const p=sub(r,c).sub.programs.find(p=>p.fragmentHandle===99&&p.samplingViews[0]?.swizzle.join(',')==='2,1,0,5'),native=r.calls.filter(x=>x.op==='drawElements').at(-1).program,attached=r.calls.filter(x=>x.op==='attachShader'&&x.program===native).map(a=>r.calls.find(s=>s.op==='shaderSource'&&s.id===a.shader));c.equal(attached.length,2,'both real specialized shader stages attached');c.equal(attached.every(s=>s.text.includes('flat')||s.text.includes('wv_view_0')),true,'flat vertex and view fragment are both variants');c.equal(p.variantBytes,attached.reduce((n,s)=>n+s.bytes,0),'combined variant byte charge equals native shader sources');
  const result={nearestCenter:pixel(nearest,16,16),linearCenter:pixel(linear,16,16),flatCorners:[pixel(flat,8,8),pixel(flat,24,24)],combinedVariantBytes:p.variantBytes,calls:r.calls};dispose(r,gl,c,'filters/flat');return result;
}

async function original(gl,bridge,fixtures,c){
  const s=fixtures.original,r=rig(gl,bridge,c,{state:true});c.ok(r.store.createContext(s.contextId),'original sampler context');c.ok(r.store.createResource(s.metadata),'unchanged original view storage');c.ok(r.store.attachContext(s.contextId,s.metadata.id),'original view membership');c.ok(r.renderer.createContext(s.contextId),'original renderer context');c.ok(r.renderer.executeSubmission(s.contextId,packet(29,0,[s.subcontext])),'original subcontext create');c.ok(r.renderer.executeSubmission(s.contextId,packet(28,0,[s.subcontext])),'original subcontext select');
  c.ok(r.renderer.executeSubmission(s.contextId,Uint8Array.from(s.view.packet)),'unchanged original kmscube VIEW');c.ok(r.renderer.executeSubmission(s.contextId,Uint8Array.from(s.sampler.packet)),'unchanged original kmscube SAMPLER');
  const state=c.ok(r.renderer.inspect(),'original immutable objects'),objects=state.contexts[0].subContexts.find(sub=>sub.id===s.subcontext).objects;c.equal(objects.find(o=>o.handle===s.view.handle).fields.swizzle,IDENTITY,'original view uses identity lanes');
  for(const pname of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])c.equal(r.calls.some(x=>x.op==='samplerParameteri'&&x.pname===pname&&x.value===gl.LINEAR),true,'original sampler actual native linear filter');
  const result={metadata:s.metadata,viewCitation:s.view.citation,samplerCitation:s.sampler.citation,state,calls:r.calls};dispose(r,gl,c,'original view');return result;
}

function roleGuards(gl,bridge,fixtures,c){
  const r=rig(gl,bridge,c),draw=initialize(r,fixtures,c,67),attacks=[];
  const metadata={id:80,target:2,format:16,bind:1,width:2,height:2,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
  c.ok(r.store.createResource(metadata),'depth storage for incompatible view attack');c.ok(r.store.attachContext(2,80),'depth membership');
  c.ok(r.store.createResource({...metadata,id:81,format:67,bind:2}),'render-only color storage');c.ok(r.store.attachContext(2,81),'render-only membership');
  for(const[bytes,label]of [[view(100,2),'BGRX cannot reinterpret RGBA'],[view(100,233),'10-bit cannot reinterpret RGBA'],[view(100,67,IDENTITY,3),'buffer cannot become a texture view'],[view(100,67,IDENTITY,80),'depth cannot become a color view'],[view(100,67,IDENTITY,81),'render-only storage cannot become a sampler view'],[view(100,67,IDENTITY,999),'missing sampler storage']]){
    const before=c.ok(r.renderer.inspect(),'role pre-state').budgets,store=c.ok(r.store.inspect(),'role pre-leases').budgets,error=c.bad(r.renderer.executeSubmission(2,bytes),label);c.equal(c.ok(r.renderer.inspect(),'role post-state').budgets,before,label+' publishes no object/charge');c.equal(c.ok(r.store.inspect(),'role post-leases').budgets,store,label+' releases temporary lease');attacks.push({label,error:error.error});
  }
  execute(r,view(101,67,[4,5,4,5]),c,'constant view still owns logical dependencies');execute(r,bindView(101),c,'constant view bound');execute(r,bindView(0),c,'constant sampler view reset');c.bad(r.renderer.executeSubmission(2,draw),'optimized-away sampler still needs logical view','incomplete-draw');execute(r,bindView(101),c,'constant logical view restored');execute(r,bindSampler(0),c,'constant sampler state reset');c.bad(r.renderer.executeSubmission(2,draw),'optimized-away sampler still needs logical state','incomplete-draw');execute(r,bindSampler(90),c,'constant sampler state restored');
  execute(r,view(102,67,[4,5,4,5],5),c,'constant framebuffer alias view');execute(r,bindView(102),c,'constant framebuffer alias bound');c.bad(r.renderer.executeSubmission(2,draw),'constant view cannot bypass framebuffer feedback','framebuffer-feedback');
  dispose(r,gl,c,'roles');return attacks;
}

function multiSlot(gl,bridge,fixtures,c){
  const r=rig(gl,bridge,c),draw=initialize(r,fixtures,c,67);
  const text='FRAG\nDCL IN[0].xy, GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT\nDCL CONST[0]\nDCL TEMP[0..1]\nTEX TEMP[0], IN[0].xyyy, SAMP[0], 2D\nTEX TEMP[1], IN[0].xyyy, SAMP[7], 2D\nUCMP OUT[0], CONST[0], TEMP[0], TEMP[1]\nEND\n';
  execute(r,shader(99,1,text),c,'synthetic two-slot TEX selector');execute(r,view(100,67,[2,1,0,5]),c,'slot0 immutable view');execute(r,view(101,67,[1,0,2,4]),c,'slot7 immutable view');execute(r,bindView(100),c,'slot0 selection');execute(r,packet(10,0,[1,7,101]),c,'slot7 selection');execute(r,packet(18,0,[1,7,90]),c,'slot7 native sampler');execute(r,packet(31,0,[99,1]),c,'two-slot selector binding');
  const draws=[];for(const[words,swizzle]of [[[1,1,1,1],[2,1,0,5]],[[0,0,0,0],[1,0,2,4]],[[1,1,1,1],[2,1,0,5]]]){execute(r,packet(12,0,[1,0,...words]),c,'two-slot raw selector words');poison(gl);execute(r,draw,c,'two-slot actual GPU TEX');physical(r,gl,c,67,swizzle,'independent two-slot pixels');draws.push(r.calls.filter(x=>x.op==='drawElements').at(-1).program);}
  c.equal(new Set(draws).size,1,'constant selection does not alter view program key');const programs=sub(r,c).sub.programs.filter(p=>p.fragmentHandle===99);c.equal(programs.length,1,'two samplers share one canonical combination');c.equal(programs[0].samplingViews.map(v=>v.index),[0,7],'all used sampler slots occur in key');
  const old=draws[0];execute(r,packet(10,0,[1,7,100]),c,'change only slot7 immutable semantics');execute(r,packet(12,0,[1,0,0,0,0,0]),c,'select changed slot7');execute(r,draw,c,'changed slot7 actual draw');physical(r,gl,c,67,[2,1,0,5],'changed slot7 independent pixels');c.equal(r.calls.filter(x=>x.op==='drawElements').at(-1).program!==old,true,'slot7-only change selects distinct native program');execute(r,packet(10,0,[1,7,101]),c,'restore slot7 A');execute(r,draw,c,'restored slot7 draw');physical(r,gl,c,67,[1,0,2,4],'restored slot7 independent pixels');c.equal(r.calls.filter(x=>x.op==='drawElements').at(-1).program,old,'multi-slot A/B/A exact reuse');
  const result={draws,programs:sub(r,c).sub.programs.filter(p=>p.fragmentHandle===99),calls:r.calls};dispose(r,gl,c,'multi-slot');return result;
}

const nativeBudgets = budgets => {const {cacheBytes,...native}=budgets;return native;};

function budgetsAndFailures(gl,bridge,fixtures,c){
  const baseline=rig(gl,bridge,c),draw=initialize(baseline,fixtures,c,67),base=c.ok(baseline.renderer.inspect(),'base selector storage').budgets.shaderBytes;
  execute(baseline,view(100,67,[2,1,0,5]),c,'measured fragment variant view');execute(baseline,bindView(100),c,'measured fragment variant');const extra=c.ok(baseline.renderer.inspect(),'charged fragment variant').budgets.shaderBytes-base;
  const source=baseline.calls.filter(x=>x.op==='shaderSource'&&x.text.includes('wv_view_0')).at(-1);c.equal(extra,source.bytes,'fragment variant charge equals exact native GLSL bytes');c.equal(source.budget.shaderBytes,base+extra,'fragment storage is charged before compile');dispose(baseline,gl,c,'measured variant');
  const pressure=[];for(const short of [0,1]){const r=rig(gl,bridge,c,{limits:{shaderBytes:base+extra-short}}),d=initialize(r,fixtures,c,67);execute(r,view(100,67,[2,1,0,5]),c,'quota view creation');const before=c.ok(r.renderer.inspect(),'quota base state').budgets,objects=r.objects.size,attempt=r.renderer.executeSubmission(2,bindView(100));if(short){c.bad(attempt,'one byte short fragment variant','limit-exceeded');c.equal(c.ok(r.renderer.inspect(),'quota rollback').budgets,before,'quota failure has no partial charge');c.equal(r.objects.size,objects,'quota failure allocates no native name');}else{c.ok(attempt,'exact fragment quota accepts');execute(r,d,c,'exact quota actual draw');physical(r,gl,c,67,[2,1,0,5],'exact quota pixels');c.equal(c.ok(r.renderer.inspect(),'exact charged quota').budgets.shaderBytes,base+extra,'exact aggregate shader budget');}pressure.push({short,budget:base+extra-short,result:attempt});dispose(r,gl,c,'quota '+short);}
  {const r=rig(gl,bridge,c,{limits:{programs:1}}),d=initialize(r,fixtures,c,67);execute(r,view(100,67,[2,1,0,5]),c,'program pressure view');execute(r,bindView(100),c,'new view evicts at program quota');execute(r,d,c,'evicted view actual draw');physical(r,gl,c,67,[2,1,0,5],'one program pressure view');c.equal(c.ok(r.renderer.inspect(),'program pressure').budgets.programs,1,'program count remains bounded after eviction');c.equal(r.renderer.inspect().caches.program.evictions>0,true,'one program pressure deletes old native program');dispose(r,gl,c,'program quota');}
  const failures=[];
  for(const mode of ['fragment-allocate','fragment-compile','program-allocate','program-link','sampler-location','sampler-index','sampler-type','sampler-size','uniform-buffer','uniform-block','gl-error','flat-fragment-compile']){
    let armed=false;const intercept=(t,k,args,run)=>{
      if(armed){
        if(mode==='fragment-allocate'&&k==='createShader'&&args[0]===t.FRAGMENT_SHADER)return null;
        if((mode==='fragment-compile'||mode==='flat-fragment-compile')&&k==='getShaderParameter'&&args[1]===t.COMPILE_STATUS&&t.getShaderParameter(args[0],t.SHADER_TYPE)===t.FRAGMENT_SHADER)return false;
        if(mode==='program-allocate'&&k==='createProgram')return null;
        if(mode==='program-link'&&k==='getProgramParameter'&&args[1]===t.LINK_STATUS)return false;
        if(mode==='sampler-location'&&k==='getUniformLocation'&&args[1]==='fssamp0')return null;
        if(mode==='sampler-index'&&k==='getUniformIndices'&&args[1][0]==='fssamp0')return[t.INVALID_INDEX];
        if((mode==='sampler-type'||mode==='sampler-size')&&k==='getActiveUniforms'&&args[1][0]===t.getUniformIndices(args[0],['fssamp0'])[0]&&args[2]===(mode==='sampler-type'?t.UNIFORM_TYPE:t.UNIFORM_SIZE))return[mode==='sampler-type'?t.FLOAT:2];
        if(mode==='uniform-buffer'&&k==='createBuffer')return null;
        if(mode==='uniform-block'&&k==='getUniformBlockIndex')return t.INVALID_INDEX;
        if(mode==='gl-error'&&k==='getError')return t.OUT_OF_MEMORY;
      }return run();
    };
    const r=rig(gl,bridge,c,{intercept}),d=initialize(r,fixtures,c,67);execute(r,view(100,67,[2,1,0,5]),c,'failure immutable view');let request=bindView(100);
    if(mode==='flat-fragment-compile'){execute(r,shader(99,1,fixtures.commands.shaders.FRAG.replace('PERSPECTIVE','CONSTANT')),c,'failure flat TEX selector');execute(r,bindView(100),c,'failure prebound view');request=packet(31,0,[99,1]);}
    const before=c.ok(r.renderer.inspect(),'failure pre-budget').budgets,names=r.objects.size;armed=true;const error=c.bad(r.renderer.executeSubmission(2,request),'injected '+mode);armed=false;c.equal(nativeBudgets(c.ok(r.renderer.inspect(),'failure rollback').budgets),nativeBudgets(before),'injected '+mode+' exact native charge rollback');c.equal(r.objects.size,names,'injected '+mode+' exact native name rollback');
    c.equal(error.error.message.includes('fragment view')||mode!=='fragment-compile',true,'fault reached fragment view boundary');c.ok(r.renderer.restoreContext(2),'retry after '+mode);execute(r,d,c,'recovered actual draw '+mode);if(mode!=='flat-fragment-compile')physical(r,gl,c,67,[2,1,0,5],'recovery '+mode);failures.push({mode,error:error.error,calls:r.calls});dispose(r,gl,c,'failure '+mode);
  }
  return{base,fragmentBytes:extra,pressure,failures};
}

function checkedOutputGuards(gl,bridge,fixtures,c){
  // These are trusted-host compiler-output injections, never guest-supplied GLSL.
  const rows=[];
  for(const mode of ['lookup','main','length','sampler-name','sampler-type','sampler-index']){
    let armed=false;
    const injected={...bridge,translate(request){const result=bridge.translate(request);if(!armed||!result.ok||request.stage!=='fragment')return result;const out=structuredClone(result);
      if(mode==='lookup')out.glsl=out.glsl.replace(/texture\(fssamp0, [^;]*?\.xy\)/,'texelFetch(fssamp0, ivec2(0), 0)');
      if(mode==='main')out.glsl=out.glsl.replace('\nvoid main(','\nvoid   main(');
      if(mode==='length')out.glsl=out.glsl.padEnd(262145,' ');
      if(mode==='sampler-name')out.metadata.samplers[0].name='fssamp_wrong';
      if(mode==='sampler-type')out.metadata.samplers[0].type='samplerCube';
      if(mode==='sampler-index')out.metadata.samplers[0].index=8;
      return out;
    }};
    const r=rig(gl,injected,c);initialize(r,fixtures,c,67);armed=true;execute(r,shader(99,1,fixtures.commands.shaders.FRAG+'\n'),c,'injected uncached checked output base compiles '+mode);armed=false;execute(r,view(100,67,[2,1,0,5]),c,'checked output nonidentity view');execute(r,bindView(100),c,'checked output original selector specialization');const before=c.ok(r.renderer.inspect(),'checked output pre-charge').budgets,names=r.objects.size;
    const error=c.bad(r.renderer.executeSubmission(2,packet(31,0,[99,1])),'checked output boundary '+mode,mode==='length'?'limit-exceeded':'shader-link-error');c.equal(c.ok(r.renderer.inspect(),'checked output rollback').budgets,before,'checked output '+mode+' no partial charge');c.equal(r.objects.size,names,'checked output '+mode+' no temporary native names');rows.push({mode,error:error.error});dispose(r,gl,c,'checked output '+mode);
  }return rows;
}

async function asyncViews(gl,bridge,fixtures,c){
  const rows=[];
  for(const delay of [0,1,3]){
    const remaining=new Map(),events=[];
    const intercept=(t,k,args,run)=>{const actual=run();if(k==='fenceSync'&&actual)remaining.set(actual,delay);if(k==='clientWaitSync'){
      c.equal(args.slice(1),[0,0],'view job polls without blocking');let delivered=actual;if((actual===t.ALREADY_SIGNALED||actual===t.CONDITION_SATISFIED)&&remaining.get(args[0])>0){remaining.set(args[0],remaining.get(args[0])-1);delivered=t.TIMEOUT_EXPIRED;}events.push({actual,delivered});return delivered;
    }if(k==='deleteSync')remaining.delete(args[0]);return actual;};
    const r=rig(gl,bridge,c,{intercept}),draw=initialize(r,fixtures,c,67);c.ok(r.renderer.dispose(),'async view replaces only state owner');r.replaceRenderer(c.ok(createVirglAsyncRenderer({gl:r.proxy,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,shaderBridge:bridge}),'async view renderer').renderer);c.ok(r.renderer.createContext(2),'async view context');
    async function run(bytes){const job=c.ok(r.renderer.beginSubmission(2,bytes),'async view begin').job;for(let step=0;step<1000;step++){
      const state=c.ok(r.renderer.step(job),'async view step');if(state.status==='done'){c.ok(state.result,'async view completed');c.equal(state.result.gpuComplete,true,'view job completes actual GPU fence');return state.result;}
      if(state.status==='needs-input'){const q=state.request,b=new Uint8Array(q.layout.tightBytes);for(let row=0;row<q.layout.rowCount;row++)b.set(c.ok(r.store.readBacking(q.resource.id,q.layout.offset+row*q.layout.rowStride,q.layout.rowBytes),'async synthetic fresh row').bytes,row*q.layout.rowBytes);c.ok(r.renderer.provideInput(job,q.token,b),'async fresh input handoff');b.fill(0xee);}
      else c.equal(state.status==='ready'||state.status==='waiting-gpu',true,'view job bounded intermediate state');await new Promise(resolve=>setTimeout(resolve,0));
    }throw new Error('async view job did not finish');}
    // The isolated test host supplies the independently authored synthetic rows.
    await run(Uint8Array.from(fixtures.commands.submissions.find(s=>s.event===161).data));
    await run(sampler(90));await run(bindSampler(90));await run(view(100,67,[2,1,0,5]));await run(view(101,67,[4,5,4,5]));const draws=[];
    for(const[h,s]of [[100,[2,1,0,5]],[101,[4,5,4,5]],[100,[2,1,0,5]]]){await run(bindView(h));poison(gl);await run(draw);physical(r,gl,c,67,s,'delayed async view '+delay);draws.push(r.calls.filter(x=>x.op==='drawElements').at(-1).program);}
    c.equal(draws[0],draws[2],'async A/B/A restores exact native program');c.equal(draws[0]!==draws[1],true,'async distinct views use distinct native programs');c.equal(remaining.size,0,'completed view jobs release all fences');rows.push({delay,draws,events,programs:sub(r,c).sub.programs});dispose(r,gl,c,'async views '+delay);
  }return rows;
}

async function retainedFlat(gl,bridge,fixtures,c){
  // Reuse the unchanged affected renderer suite directly. Its separate old
  // compiler-corpus admission count predates later compiler expansion.
  const {runRendererPairs}=await import('./flat-pairs.mjs'),{MIXED_VERTEX,MIXED_FRAGMENT}=await import('../../virgl-shader/tests/pairs.mjs');
  const sources=fixtures.retainedPairs,anchors=[{name:'flat',result:c.ok(bridge.translatePair({vertexText:sources.vertex.text,fragmentText:sources.flat.text}),'retained flat anchor')},{name:'mixed',result:c.ok(bridge.translatePair({vertexText:MIXED_VERTEX,fragmentText:MIXED_FRAGMENT}),'retained mixed anchor')}],report={};
  await runRendererPairs(gl,{bridge,sources,anchors},report,null);c.equal(report.status,'passed','unchanged retained flat renderer suite');c.equal(report.faults.length,12,'retained flat native/pair fault boundaries');c.equal(report.quota.length,2,'retained flat quota boundaries');return report;
}

export async function runBrowserViewAcceptance(fixtures){
  const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});c.equal(Boolean(gl),true,'real view WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);c.equal(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(renderer),false,'hardware view renderer');const bridge=await createVirglShaderBridge();
  const captured=await original(gl,bridge,fixtures,c),formats=[];for(const format of [67,2,233])formats.push(await formatCases(gl,bridge,fixtures.tiny,format,c));const filtering=await filtersAndFlat(gl,bridge,fixtures.tiny,c),roles=roleGuards(gl,bridge,fixtures.tiny,c),multiple=multiSlot(gl,bridge,fixtures.tiny,c),budgets=budgetsAndFailures(gl,bridge,fixtures.tiny,c),checkedOutput=checkedOutputGuards(gl,bridge,fixtures.tiny,c),jobs=await asyncViews(gl,bridge,fixtures.tiny,c),flat=await retainedFlat(gl,bridge,fixtures,c);c.equal(gl.getError(),gl.NO_ERROR,'final view GL errors');
  return{status:'passed',guestExecution:false,boundary:'Original selected RGBA VIEW/SAMPLER plus separate synthetic view/shader/input variants; no full guest offload.',renderer,original:captured,formats,filtering,roles,multiple,budgets,checkedOutput,jobs,flat,assertions:c.rows};
}
