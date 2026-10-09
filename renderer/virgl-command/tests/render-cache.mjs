// Independent raw packets, native counters and physical pixels for bounded caches.
import {createKeyCache, hashKey} from '../cache.mjs';
import {createResourceStore, createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer, createVirglAsyncRenderer, CACHE_LIMITS} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

function checks() {
  const rows=[];
  const same=(observed,expected,prediction)=>{
    const held=JSON.stringify(observed)===JSON.stringify(expected);
    rows.push({prediction,expected,observed,held});
    if(!held)throw new Error(prediction+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(observed));
  };
  const ok=(r,label)=>{same(r?.ok,true,label+' '+(r?.error?.code??''));return r;};
  const bad=(r,label,code)=>{same(r?.ok,false,label+' rejects');if(code)same(r.error.code,code,label+' code');return r;};
  return{same,ok,bad,rows};
}
export function runNativeCacheAcceptance() {
  const c=checks(),a={},b={},released=[];
  const cache=createKeyCache({entries:3,bytes:1200,release:(value,owner)=>released.push({value,owner:owner===a?'a':'b'})});
  c.same(hashKey('costarring')===hashKey('liquid'),true,'literal unequal FNV32 keys collide');
  c.same(cache.put(a,'costarring','A',400),true,'collision A admission');
  c.same(cache.put(a,'liquid','B',400),true,'collision B admission');
  c.same(cache.get(a,'costarring'),'A','collision retains exact A');
  c.same(cache.get(a,'liquid'),'B','collision retains exact B');
  c.same(cache.get(b,'costarring'),null,'foreign owner cannot hit an equal key');
  c.same(cache.put(b,'costarring','foreign',400),true,'equal key separate owner admission');
  c.same(cache.get(b,'costarring'),'foreign','foreign owner retains its own value');
  c.same(cache.get(a,'costarring'),'A','original owner still resolves A');
  const frozen=cache.inspect();
  c.same(Object.isFrozen(frozen)&&Object.isFrozen(frozen.limits),true,'inspection is immutable');
  c.same(cache.put(a,'pressure','P',500),true,'byte pressure admission');
  c.same(cache.get(a,'liquid'),null,'byte pressure evicts least recent B');
  c.same(cache.get(b,'costarring'),null,'byte pressure evicts next least recent foreign value');
  c.same(cache.get(a,'costarring'),'A','recent A survives byte pressure');
  c.same(cache.inspect().bytes,900,'two surviving entries have exact900 charge');
  c.same(frozen.bytes,1200,'old inspection cannot change');
  c.same(cache.put(a,'oversized','X',1201),false,'oversized entry bypasses without eviction');
  c.same(cache.inspect().bytes,900,'oversized admission changes no residency');
  c.same(cache.remove(a,'absent'),false,'absent removal is harmless');
  c.same(cache.remove(a,'costarring'),true,'exact removal releases A');
  cache.removeOwner(b);cache.removeOwner(a);cache.clear();
  c.same(cache.inspect().entries,0,'owner removal and clear release every entry');
  c.same(cache.inspect().bytes,0,'owner removal releases byte charge');
  c.same(released.map(r=>r.value),['B','foreign','A','P'],'each value released exactly once');
  c.same(cache.evict(),false,'empty eviction terminates');
  const zero=createKeyCache({entries:0,bytes:1000});
  c.same(zero.put(a,'zero','Z',300),false,'zero entry capacity is an explicit bypass');
  for(const options of [{entries:-1,bytes:1},{entries:1,bytes:Infinity},{entries:1,bytes:1,release:3}]){
    let rejected=false;try{createKeyCache(options);}catch(e){rejected=e instanceof TypeError;}c.same(rejected,true,'invalid bounded cache options');
  }
  for(const args of [[a,3,'X',400],[a,'short','X',1]]){
    let rejected=false;try{cache.put(...args);}catch(e){rejected=e instanceof TypeError;}c.same(rejected,true,'invalid key/charge admission');
  }
  const s=cache.inspect();c.same(s.requests,s.hits+s.misses,'lookup denominator is hits plus misses');
  c.same(s.evictions,2,'only capacity removals count as evictions');c.same(s.collisions>0,true,'real collision comparisons were executed');
  return{status:'passed',assertions:c.rows,stats:s};
}

function packet(op,type,words){const b=new Uint8Array((words.length+1)*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
function join(...parts){const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;}
function fw(n){const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,n,true);return v.getUint32(0,true);}
function shader(id,stage,text){const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
const VS='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const FS='FRAG\nDCL OUT[0], COLOR\nDCL CONST[0..0]\n0: MOV OUT[0], CONST[0]\n1: END\n';
const fixedFS=color=>'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 { '+color.join(', ')+' }\n0: MOV OUT[0], IMM[0]\n1: END\n';
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
const uniform=color=>packet(12,0,[1,0,...color.map(fw)]);
const clear=()=>packet(7,0,[4,0,0,fw(1),fw(1),0,0x3ff00000,0]);
const viewport=()=>packet(4,0,[0,...[8,8,.5,8,8,.5].map(fw)]);
const bindBlend=on=>packet(2,1,[on?9:8]);
function blend(id,on){const factors=on?1|(3<<4)|(19<<9)|(1<<17)|(19<<22):0;return packet(1,1,[id,0,0,((15<<27)|factors)>>>0,0,0,0,0,0,0,0]);}
const upload=()=>packet(43,0,[3,0,0,0,0,0,0,0,144,1,1,0,1]);
const setup=()=>join(shader(1,0,VS),shader(2,1,FS),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
  packet(1,5,[5,0,0,0,29]),packet(2,5,[5]),packet(6,0,[8,0,3]),blend(8,false),blend(9,true),bindBlend(false),
  packet(31,0,[1,0]),packet(31,0,[2,1]),viewport(),uniform([1,0,0,.25]));
function geometry(){const b=new Uint8Array(144),f=new Float32Array(b.buffer);f.set([-1,-1,-1,1,1,-1,1,1]);for(let i=0;i<4;i++)f.set([[-1,-1],[-1,1],[1,-1],[1,1]][i],9+i*4);f.set([-1,-1,0,-1,1,0,1,-1,0,1,1,0],24);return b;}
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const base64=b=>{const parts=[];for(let i=0;i<b.length;i+=32768)parts.push(String.fromCharCode(...b.subarray(i,i+32768)));return btoa(parts.join(''));};
async function sha(b){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');}

function rig(gl,bridge,c,{limits={},cacheLimits={},async=false,delay=0}={}){
  const live=new Map(['Texture','Buffer','Shader','Program','Sampler','VertexArray','Framebuffer','Sync'].map(k=>[k,new Set()])),allocations=new Map(),programIds=new Map(),calls=[],emissions=[];
  const counts={translations:0,pairTranslations:0,links:0,compiles:0,draws:0};let nextProgram=1,remaining=0;
  const wrappedBridge={...bridge,translate(r){counts.translations++;return bridge.translate(r);},translatePair(r){counts.pairTranslations++;return bridge.translatePair(r);}};
  const methods=new Map(),traced=new Proxy(gl,{get(t,k){const f=Reflect.get(t,k,t);if(typeof f!=='function')return f;if(methods.has(k))return methods.get(k);
    const method=(...args)=>{
      if(k==='clientWaitSync'&&remaining>0){remaining--;return gl.TIMEOUT_EXPIRED;}
      if(k==='linkProgram')counts.links++;if(k==='compileShader')counts.compiles++;
      if(k==='drawArrays'||k==='drawElements'){
        const p=gl.getParameter(gl.CURRENT_PROGRAM),id=programIds.get(p);counts.draws++;
        calls.push({op:k,args:[...args],program:id,blend:gl.isEnabled(gl.BLEND)});
        if(!emissions.some(e=>e.program===id))emissions.push({program:id,stages:gl.getAttachedShaders(p).map(s=>({type:gl.getShaderParameter(s,gl.SHADER_TYPE),text:gl.getShaderSource(s)}))});
      }
      const out=f.apply(t,args);
      if(k==='createProgram'&&out)programIds.set(out,nextProgram++);
      if(k.startsWith('create')){const kind=k.slice(6);if(live.has(kind)&&out)live.get(kind).add(out);}
      else if(k.startsWith('delete')){const kind=k.slice(6);if(live.has(kind))live.get(kind).delete(args[0]);}
      if(k==='fenceSync'){live.get('Sync').add(out);remaining=delay;}
      return out;
    };methods.set(k,method);return method;
  }});
  const native=c.ok(createWebGL2TransferBackend(traced),'cache physical backend').backend;
  const owner=c.ok(createResourceStore({backend:{...native,allocate(m){const s=native.allocate(m);allocations.set(m.id,s);return s;}}}),'cache owned store');
  const renderer=c.ok((async?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:traced,resources:owner.store,bindings:owner.bindings,shaderBridge:wrappedBridge,
    limits,cacheLimits,...(async?{asyncAccess:owner.asyncAccess,jobLimits:{commandsPerStep:1}}:{})}),'cache renderer').renderer;
  const reader=gl.createFramebuffer();
  const r={...owner,renderer,gl,traced,live,allocations,counts,calls,emissions,reader};
  c.ok(owner.store.createContext(1),'cache resource context');c.ok(renderer.createContext(1),'cache state context');
  for(const m of [meta(1,2,67,2,16,16),meta(3,0,64,16,144),meta(11,2,2,2,16,16),meta(12,2,233,2,16,16)]){
    c.ok(owner.store.createResource(m),'cache resource '+m.id);c.ok(owner.store.attachContext(1,m.id),'cache membership '+m.id);
  }
  c.ok(owner.store.attachBacking(3,[geometry()]),'cache original CPU vertices');
  return r;
}
const run=(r,c,bytes,label,ctx=1)=>c.ok(r.renderer.executeSubmission(ctx,bytes),label);
function read(r,id=1,format=67){const gl=r.gl;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,r.reader);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations.get(id).texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);const out=format===233?new Uint32Array(256):new Uint8Array(1024);gl.readPixels(0,0,16,16,gl.RGBA,format===233?gl.UNSIGNED_INT_2_10_10_10_REV:gl.UNSIGNED_BYTE,out);return out;}
function pixels(r,c,expected,label,id=1,format=67){const b=read(r,id,format),errors=[];for(let i=0;i<256;i++){
  const actual=format===233?b[i]:[...b.subarray(i*4,i*4+4)];if(JSON.stringify(actual)!==JSON.stringify(expected))errors.push({pixel:i,actual,expected});
}c.same(errors.slice(0,3),[],label+' literal physical pixels');return new Uint8Array(b.buffer,b.byteOffset,b.byteLength);}
function poison(gl){for(const cap of [gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.RASTERIZER_DISCARD])gl.enable(cap);gl.disable(gl.BLEND);gl.colorMask(false,false,false,false);gl.depthMask(false);gl.scissor(0,0,0,0);gl.viewport(1,2,3,4);gl.useProgram(null);gl.bindVertexArray(null);}
function accounting(r,c,label){const s=c.ok(r.renderer.inspect(),label+' inspect');
  for(const name of ['translation','program','state']){const p=s.caches[name];c.same(p.requests,p.hits+p.misses,label+' '+name+' denominator');c.same(p.entries<=p.limits.entries&&p.bytes<=p.limits.bytes,true,label+' '+name+' bounded residency');}
  c.same(s.work.translations,r.counts.translations,label+' real stage translation calls');c.same(s.work.pairTranslations,r.counts.pairTranslations,label+' real pair translation calls');
  c.same(s.work.programLinks,r.counts.links,label+' real link calls');c.same(s.work.shaderCompiles,r.counts.compiles,label+' real compile calls');c.same(s.work.drawCalls,r.counts.draws,label+' real draw calls');
  c.same(s.work.draws,r.counts.draws,label+' all draws completed without GL errors');
  c.same(s.budgets.programs,r.live.get('Program').size,label+' real live native programs');
  c.same(s.budgets.uniformBytes,s.budgets.programs*656,label+' actual656 byte system blocks');
  c.same(s.budgets.cacheBytes,s.caches.translation.bytes+s.caches.program.bytes+s.caches.state.bytes,label+' charged cache sum');return s;
}
function dispose(r,c,label){r.gl.deleteFramebuffer(r.reader);c.ok(r.renderer.dispose(),label+' renderer disposal');c.ok(r.store.dispose(),label+' store disposal');
  for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' disposed inspection').budgets))c.same(v,0,label+' zero budget '+k);
  for(const[k,v]of r.live)c.same(v.size,0,label+' deleted native '+k);c.same(r.gl.getError(),r.gl.NO_ERROR,label+' no GL errors');
}

async function toggles(gl,bridge,c){const r=rig(gl,bridge,c);run(r,c,join(setup(),upload()),'10k setup');const baseline=accounting(r,c,'10k baseline');
  const raw=new Uint8Array(10000*1024),callStart=r.calls.length,off=join(bindBlend(false),clear(),draw()),on=join(bindBlend(true),clear(),draw());
  for(let i=0;i<10000;i++){
    if(i%113===0)poison(gl);run(r,c,i%2?on:off,'blend toggle '+i);
    const frame=pixels(r,c,i%2?[64,0,191,255]:[255,0,0,64],'blend toggle '+i);raw.set(frame,i*1024);
    if(i%200===0){c.same(gl.getError(),gl.NO_ERROR,'toggle checkpoint GL '+i);await new Promise(resolve=>setTimeout(resolve,0));}
  }
  const final=accounting(r,c,'10k final');c.same(r.calls.length-callStart,10000,'10k actual native draw calls');
  c.same(final.work.programLinks,baseline.work.programLinks,'10k toggles need no relink');c.same(final.work.translations,baseline.work.translations,'10k toggles need no translation');
  c.same(final.caches.state.hits>10000,true,'actual repeated render states hit');
  const result={draws:10000,checkedPixels:2560000,rawPixelsBase64:base64(raw),rawSha256:await sha(raw),rawBytes:raw.length,
    calls:r.calls.slice(callStart),baseline,final};dispose(r,c,'10k');return result;
}

async function pressure(gl,bridge,c){const r=rig(gl,bridge,c,{limits:{programs:2,uniformBytes:1312},cacheLimits:{translations:2,states:8,stateBytes:65536}});
  run(r,c,join(setup(),upload()),'pressure setup');const observations=[];
  const colors=[[0,1,0,1],[0,0,1,1],[1,1,0,1],[1,0,1,1]];
  for(let i=0;i<colors.length;i++)run(r,c,shader(20+i,1,fixedFS(colors[i])),'pressure shader create '+i);
  for(let i=0;i<16;i++){const at=i%4;run(r,c,join(packet(31,0,[20+at,1]),clear(),draw()),'pressure select '+i);pixels(r,c,colors[at].map(x=>x*255),'pressure shader '+i);
    const s=accounting(r,c,'pressure '+i);c.same(s.caches.program.entries<=2,true,'two program residency '+i);c.same(s.caches.state.entries<=8,true,'eight state residency '+i);observations.push(s);
  }
  c.same(observations.at(-1).caches.program.evictions>8,true,'program pressure evicts actual native allocations');
  c.same(observations.at(-1).caches.translation.evictions>0,true,'translation pressure evicts owned values');
  c.same(observations.at(-1).caches.state.evictions>0,true,'state pressure evicts pure plans');
  run(r,c,packet(31,0,[20,1]),'bind shader before name reuse');const before=r.renderer.inspect().contexts[0].subContexts[0].bindings.fragmentShader;
  run(r,c,join(packet(3,4,[20]),shader(20,1,fixedFS([0,0,1,1])),clear(),draw()),'public selector name reuse retains old binding');pixels(r,c,[0,255,0,255],'name reuse old retained shader');
  run(r,c,join(packet(31,0,[20,1]),clear(),draw()),'bind new selector generation');pixels(r,c,[0,0,255,255],'name reuse new shader');
  const after=r.renderer.inspect().contexts[0].subContexts[0].bindings.fragmentShader;c.same(after.handle,before.handle,'name reused exactly');c.same(after.generation>before.generation,true,'name reuse changes owned selector identity');
  // Recreate a recently translated source after dropping its selector; it must hit translation.
  run(r,c,packet(3,4,[20]),'drop bound selector name');const translations=r.counts.translations;
  run(r,c,shader(90,1,fixedFS([0,0,1,1])),'recreate identical source');c.same(r.counts.translations,translations,'exact source recreation reuses translation');
  const frames=[];c.ok(r.renderer.beginFrame(42),'frame42 begin');const original=join(packet(31,0,[90,1]),clear(),draw());const expectedHex=hex(original);run(r,c,original,'frame42 original command bytes');original.fill(255);
  pixels(r,c,[0,0,255,255],'frame42 blue');const dump=c.ok(r.renderer.endFrame(42),'frame42 end').dump;
  c.same(dump.complete,true,'frame42 full bounded capture');c.same(dump.submissions[0].hex,expectedHex,'frame42 owns original raw command bytes');c.same(dump.draws.length,1,'frame42 reports actual rendered work');
  c.same(dump.end.work.draws-dump.start.work.draws,1,'frame42 draw counter delta');c.same(dump.programs.length,1,'frame42 actual emitted program');
  const emitted=r.emissions.find(e=>e.program===r.calls.at(-1).program);const actualVS=emitted.stages.find(s=>s.type===gl.VERTEX_SHADER).text,actualFS=emitted.stages.find(s=>s.type===gl.FRAGMENT_SHADER).text;
  c.same(dump.programs[0].vertexESSL300,actualVS,'dump vertex source is actual linked native ESSL');c.same(dump.programs[0].fragmentESSL300,actualFS,'dump fragment source is actual linked native ESSL');
  c.same(dump.draws[0].programKey,dump.programs[0].key,'dump bindings use recorded program key');c.same(JSON.parse(dump.draws[0].stateKey).targets[0].metadata.format,67,'dump state key includes actual target format');
  c.same(c.ok(r.renderer.frameDump(),'frame42 read').dump,dump,'frame dump remains immutable');c.bad(r.renderer.beginFrame(42),'repeated host frame','invalid-frame');c.bad(r.renderer.endFrame(41),'foreign frame end','invalid-frame');frames.push(dump);
  // Same program, changed target formats and vertex layouts must restore distinct complete state.
  c.ok(r.renderer.beginFrame(43),'frame43 begin');
  for(const[id,format]of [[11,2],[12,233]]){run(r,c,join(packet(1,8,[100+id,id,format,0,0]),packet(5,0,[1,0,100+id]),clear(),draw()),'target format '+format);pixels(r,c,format===233?0xfff00000:[0,0,255,255],'target format '+format,id,format);}
  run(r,c,join(packet(5,0,[1,0,4]),packet(1,5,[40,0,0,0,30]),packet(2,5,[40]),packet(6,0,[12,96,3]),clear(),draw()),'RGB layout');pixels(r,c,[0,0,255,255],'RGB layout');
  run(r,c,join(packet(1,5,[41,4,0,0,29]),packet(2,5,[41]),packet(6,0,[16,32,3]),clear(),draw()),'offset padded layout');pixels(r,c,[0,0,255,255],'offset padded layout');
  const layouts=c.ok(r.renderer.endFrame(43),'frame43 end').dump;c.same(layouts.draws.length,4,'format/layout frame reports four actual draws');
  c.same(new Set(layouts.draws.map(d=>d.stateKey)).size,4,'format and layout state keys are distinct');c.same(new Set(layouts.draws.map(d=>d.programKey)).size,1,'dynamic formats/layout do not change emitted ESSL');frames.push(layouts);
  const beforeReset=accounting(r,c,'before reset');c.ok(r.renderer.resetCaches(),'explicit cache reset');const empty=r.renderer.inspect();
  c.same([empty.caches.translation.entries,empty.caches.program.entries,empty.caches.state.entries,empty.budgets.cacheBytes,empty.budgets.uniformBytes,empty.budgets.debugBytes],[0,0,0,0,0,0],'reset releases all caches and dump allocations');
  run(r,c,join(clear(),draw()),'reset recreates bound program');pixels(r,c,[0,0,255,255],'reset program recreation');c.same(r.counts.links>beforeReset.work.programLinks,true,'reset requires real relink');
  const final=accounting(r,c,'pressure final'),result={observations,frames,final,calls:r.calls,emissions:r.emissions};dispose(r,c,'pressure');return result;
}

async function ownership(gl,bridge,c){const r=rig(gl,bridge,c,{limits:{programs:2}});run(r,c,join(setup(),upload(),clear(),draw()),'owner A setup');const old=r.renderer.inspect().contexts[0].generation;
  c.ok(r.store.createContext(2),'owner B resource context');c.ok(r.renderer.createContext(2),'owner B state context');for(const id of [1,3,11,12])c.ok(r.store.attachContext(2,id),'owner B membership '+id);
  const before=r.counts.translations;run(r,c,join(setup(),uniform([0,1,0,1]),clear(),draw()),'owner B exact same sources',2);pixels(r,c,[0,255,0,255],'owner B own state');c.same(r.counts.translations,before+2,'equal sources in another context do not share translation authority');
  const aProgram=r.calls[0].program,bProgram=r.calls.at(-1).program;c.same(aProgram===bProgram,false,'native programs are context-owned');run(r,c,join(clear(),draw()),'owner A restored');pixels(r,c,[255,0,0,64],'A/B/A cache restoration');
  c.ok(r.store.destroyContext(1),'remove A resource context');c.ok(r.store.createContext(1),'recreate A resource identity');const calls=r.calls.length;c.bad(r.renderer.executeSubmission(1,draw()),'stale cached context','stale-context');c.same(r.calls.length,calls,'stale context cannot issue cached draw');
  c.ok(r.renderer.destroyContext(1),'release old cached A');
  const cycles=[];for(let i=0;i<20;i++){
    for(const id of [1,3,11,12])c.ok(r.store.attachContext(1,id),'cycle membership '+i+'/'+id);c.ok(r.renderer.createContext(1),'cycle state '+i);
    run(r,c,join(setup(),clear(),draw()),'recreated context '+i);pixels(r,c,[255,0,0,64],'recreated context '+i);
    const s=accounting(r,c,'cycle '+i);c.same(s.contexts.find(x=>x.id===1).generation>old,true,'cycle identity increases '+i);cycles.push(s);
    c.ok(r.renderer.destroyContext(1),'cycle state destroy '+i);c.ok(r.store.destroyContext(1),'cycle resource destroy '+i);if(i<19)c.ok(r.store.createContext(1),'cycle next resource identity '+i);
  }
  c.ok(r.renderer.destroyContext(2),'owner B state destruction');c.ok(r.store.destroyContext(2),'owner B resource destruction');
  const final=accounting(r,c,'no owners');c.same([final.budgets.objects,final.budgets.programs,final.budgets.shaderBytes,final.budgets.uniformBytes,final.budgets.cacheBytes,final.budgets.leases],[0,0,0,0,0,0],'context destruction releases all cached/native allocations');
  const result={cycles,final,calls:r.calls};dispose(r,c,'ownership');return result;
}

async function diagnostics(gl,bridge,c){const r=rig(gl,bridge,c,{cacheLimits:{debugBytes:16384,states:0,translations:0}});run(r,c,join(setup(),upload()),'disabled optional caches setup');c.ok(r.renderer.beginFrame(100),'bounded small dump begin');c.bad(r.renderer.beginFrame(101),'second active frame','busy');
  for(let i=0;i<100;i++)run(r,c,join(clear(),draw()),'bounded dump work '+i);pixels(r,c,[255,0,0,64],'bounded dump still renders');const dump=c.ok(r.renderer.endFrame(100),'bounded small dump end').dump;
  c.same(dump.complete,false,'dump overflow is explicit');c.same(Object.values(dump.dropped).some(n=>n>0),true,'dump reports dropped instrumentation entries');c.same(dump.end.work.draws-dump.start.work.draws,100,'dump counters never hide uncaptured real draws');
  const s=accounting(r,c,'disabled optional caches');c.same([s.caches.translation.entries,s.caches.state.entries],[0,0],'zero optional caches are explicit bypass');c.same(s.caches.state.bypasses>0,true,'state bypasses are counted');c.same(s.budgets.debugBytes<=16384,true,'debug serialization charge stays bounded');
  const result={dump,final:s};dispose(r,c,'diagnostics');
  const small=rig(gl,bridge,c,{cacheLimits:{programBytes:1,debugBytes:0}});c.bad(small.renderer.executeSubmission(1,setup()),'program entry too large','limit-exceeded');c.bad(small.renderer.beginFrame(1),'disabled dump','limit-exceeded');
  const failed=accounting(small,c,'failed oversized program');c.same([failed.budgets.programs,failed.budgets.uniformBytes],[0,0],'oversized program publication rolls back native allocations');dispose(small,c,'oversized program');
  for(const invalid of [{states:CACHE_LIMITS.states+1},{translationBytes:-1},{states:NaN}])c.bad(createVirglDrawRenderer({gl,resources:r.store,bindings:r.bindings,shaderBridge:bridge,cacheLimits:invalid}),'invalid cache limits','invalid-input');
  return result;
}

async function jobs(gl,bridge,c,delay){const r=rig(gl,bridge,c,{async:true,delay,limits:{programs:1},cacheLimits:{states:8}});
  async function pump(bytes,label,mutate=false){const token=c.ok(r.renderer.beginSubmission(1,bytes),label+' begin').job;if(mutate)bytes.fill(255);let done;
    for(let i=0;i<2000;i++){const step=c.ok(r.renderer.step(token),label+' step');if(step.status==='needs-input')c.ok(r.renderer.provideInput(token,step.request.token,geometry()),label+' input');else if(step.status==='done'){done=c.ok(step.result,label+' completion');break;}await new Promise(resolve=>setTimeout(resolve,(i+delay)%3));}
    c.same(Boolean(done),true,label+' bounded completion');c.same(done.gpuComplete,true,label+' real completion fence');return done;
  }
  await pump(join(setup(),upload()),'cache job setup '+delay);c.ok(r.renderer.beginFrame(7),'async host frame begin');
  const original=join(bindBlend(false),clear(),draw(),bindBlend(true),clear(),draw()),originalHex=hex(original);const token=c.ok(r.renderer.beginSubmission(1,original),'owned cache job begin').job;original.fill(255);
  c.bad(r.renderer.resetCaches(),'active cache reset','busy');c.bad(r.renderer.destroyContext(1),'active cached owner destruction','busy');c.bad(r.renderer.endFrame(7),'active frame retirement','busy');
  let completed;for(let i=0;i<2000;i++){const step=c.ok(r.renderer.step(token),'owned cache job step');if(step.status==='done'){completed=c.ok(step.result,'owned cache job completion');break;}await new Promise(resolve=>setTimeout(resolve,(i+delay)%3));}
  c.same(completed?.gpuComplete,true,'owned cached draw job retires real fence');pixels(r,c,[64,0,191,255],'owned cached async job '+delay);const dump=c.ok(r.renderer.endFrame(7),'async frame end').dump;
  c.same(dump.submissions[0].hex,originalHex,'async dump owns pre-mutation commands');c.same(dump.draws.length,2,'async dump reports two real draws');c.same(dump.outcomes[0].gpuComplete,true,'async dump separates actual GPU completion');
  const s=accounting(r,c,'async '+delay);c.same(s.work.submissions,s.work.completedSubmissions+s.work.failedSubmissions,'finished async submission denominator');
  // Forced disposal of an unfinished accepted job remains a counted failure.
  c.ok(r.renderer.beginSubmission(1,draw()),'pending job before disposal');c.ok(r.renderer.dispose(),'pending job explicit disposal');const closed=r.renderer.inspect();
  c.same(closed.work.submissions,closed.work.completedSubmissions+closed.work.failedSubmissions,'disposal cannot drop an accepted job from counters');
  const result={delay,dump,final:s,closed,calls:r.calls};dispose(r,c,'async '+delay);return result;
}

export async function runBrowserCacheAcceptance({expectCollision=false}={}){
  const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw new Error('physical WebGL2 unavailable');
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER);c.same(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu),false,'physical cache GPU');
  const bridge=await createVirglShaderBridge(),toggleResult=await toggles(gl,bridge,c),pressureResult=await pressure(gl,bridge,c),ownerResult=await ownership(gl,bridge,c),diagnosticResult=await diagnostics(gl,bridge,c),jobResults=[];
  for(const delay of [0,1,3])jobResults.push(await jobs(gl,bridge,c,delay));
  if(expectCollision)c.same(toggleResult.final.caches.program.collisions+pressureResult.final.caches.program.collisions>0,true,'deliberate physical program buckets collide without aliasing');
  c.same(gl.getError(),gl.NO_ERROR,'final cache GL errors');return{status:'passed',guestExecution:false,productionNegotiation:false,gpu,toggles:toggleResult,pressure:pressureResult,ownership:ownerResult,diagnostics:diagnosticResult,jobs:jobResults,assertions:c.rows};
}
