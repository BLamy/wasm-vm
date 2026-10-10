import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeStandardSubmission} from '../decoder.mjs';
import {checks,packet,join,hex,blob,clear,meta,add,dispose} from './standard-instanced-draws.mjs';
import {compactSpec,compactSetup,compactRig,compactSubmit,compactDraw} from './standard-compact-vertex-fetch.mjs';
import {criticModel,criticCompare,criticFormat} from '../../../tools/virgl-command/standard-compact-adversarial-oracle.mjs';

const SEED=0x6b82d1f3;
export async function runAcceptance({smoke=false,mutation}={}) {
 const c=checks(),report={schema:'standard-compact-critic-seeded-v1',seed:SEED,status:'running',frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableNaNPayload:false};
 window.__standardCompactEvidence=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('critic requires actual WebGL2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('critic requires hardware');
 const bridge=await createVirglStandardShaderBridge();let seed=SEED;
 const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 const make=s=>{const schedule=next(),r=compactRig(gl,bridge,c,s,{step:1+next()%3,delay:({ordinal})=>(schedule>>>((ordinal%8)*4))&7});r.blobs=report.blobs;r.frames=report.frames;return r;};
 const prediction=(r,s,bytes,ctx=1)=>criticModel([...r.history,{ctx,hex:hex(bytes)}],s.data,r.range);
 const assertWords=(a,b,nan,label)=>{c.same(a.length,b.length,label+' word count');a.forEach((w,i)=>c.same(nan[i]?(w&0x7f800000)===0x7f800000&&(w&0x7fffff)!==0:w===b[i],true,label+' lane'+i));};
 async function frame(r,record,expected) {
  c.ok(record.result,'critic actual native draw completed');c.same(record.result.gpuComplete,true,'critic actual final fence');
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  for(const n of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[n],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(fb);
  const draw=record.result.draws.at(-1),native=[],normalized=[];
  for(const [id,original]of r.bufferBytes){const generation=id===6?draw.indexResourceGeneration:draw.vertexFetches.find(f=>f.resourceId===id).resourceGeneration,a=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),raw=new Uint8Array(original.length);
   gl.bindBuffer(gl.COPY_READ_BUFFER,a.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,null);c.same(hex(raw),hex(original),'critic original full native upload '+id);native.push({resourceId:id,generation,nativeBuffer:r.trace.id(a.storage.buffer),blob:await blob(r,raw)});}
  for(const n of r.normalized.filter(n=>n.label===record.label)){c.same(n.deleted,true,'critic private indices released');c.same(hex(n.raw),hex(expected.normalized),'critic original restart conversion');normalized.push({nativeBuffer:n.nativeBuffer,blob:await blob(r,n.raw)});}
  const audit=criticCompare(pixels,expected,r.width,r.height),state=r.nativeState.filter(s=>s.label===record.label),calls=r.trace.calls.filter(a=>a.label===record.label).map(({program,...a})=>a),f={label:record.label,width:r.width,height:r.height,range:r.range,history:r.history.map(h=>({...h})),inputs:r.exchanges.map(e=>({...e})),native:{buffers:native,normalized,state,calls},prediction:{fetches:expected.fetches,ids:expected.ids,vertices:expected.vertices},audit,pixels:await blob(r,pixels)};
  report.frames.push(f);
  // Pixel comparison comes first so a real served conversion sabotage must
  // complete its draw/fence and be caught by this promoted TGSI oracle.
  c.same(audit.misses,[],record.label+' critic original TGSI pixels');
  c.same(calls.length,1,'critic native draw count');const instanced=expected.draw.instances>1;
  c.same(calls[0].name,(expected.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'critic original native draw entry');
  c.same(calls[0].args,expected.draw.indexed?[0,expected.draw.count,{1:5121,2:5123,4:5125}[expected.nativeSize],expected.nativeOffset,...(instanced?[expected.draw.instances]:[])]:[0,expected.draw.start,expected.draw.count,...(instanced?[expected.draw.instances]:[])],'critic literal native draw arguments');
  const physical=state.at(-1);c.same(physical.pointSize,expected.pointUniform,'critic native point uniform');
  for(const fetch of expected.fetches){const a=physical.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),actual=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex),source=native.find(b=>b.resourceId===fetch.resourceId);
   for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])c.same(actual[key],fetch[key],'critic literal fetch '+key);
   c.same([a.enabled,a.integer,a.divisor],[!fetch.constant,false,fetch.nativeDivisor],'critic native input/divisor');c.same(actual.resourceGeneration,source.generation,'critic retained source generation');
   if(fetch.constant){const all=[...new Uint32Array(new Float32Array(fetch.genericValues).buffer)];assertWords(actual.componentWords,fetch.componentWords,fetch.nan,'critic supplied generic');assertWords(a.genericWords,all,fetch.nan,'critic actual generic');
    const raw=r.bufferBytes.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes),events=r.trace.events.filter(e=>e.label===record.label);c.same(events.some(e=>e.name==='getBufferSubData'&&e.bytes===fetch.elementBytes&&e.hex===hex(raw)),true,'critic exact retained source bytes');c.same(events.some(e=>e.name==='copyBufferSubData'&&e.source===source.nativeBuffer&&e.args[2]===fetch.offset&&e.args[4]===fetch.elementBytes),true,'critic retained original source range');
   }else c.same([a.buffer,a.type,a.normalized,a.components,a.stride,a.offset],[source.nativeBuffer,fetch.nativeType,fetch.normalized,fetch.components,fetch.stride,fetch.offset],'critic actual native pointer');}
  c.same(gl.getError(),gl.NO_ERROR,'critic GPU capture');return f;
 }
 function done(r){const inspect=c.ok(r.renderer.inspect(),'critic ownership');for(const k of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspect.jobs[k],0,'critic zero '+k);report.runs.push({inspection:inspect,history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a)});dispose(r);}
 async function draw(options,label){const s=compactSpec(options),r=make(s),bytes=join(compactSetup(r,s),compactDraw(s)),expected=prediction(r,s,bytes);await frame(r,await compactSubmit(r,1,bytes,label),expected);done(r);}
 if(smoke){await draw({format:67,shared:true,ids:[2,5,11],values:[[17,65,193,255],[255,1,125,33],[0,99,237,248]],...(mutation==='constant-unpack'?{stride:0}:{})},'critic-sabotage-'+mutation);report.status='passed';return report;}
 for(const base of [48,56,64,74,91])for(let lane=0;lane<4;lane++)for(const constant of [false,true]){
  const format=base+lane,spec=criticFormat(format),ids=[2+next()%3,9+next()%3,15+next()%5],signed=base===56||base===74,top=spec.bytes===1?(signed?127:255):(signed?32767:65535);
  const values=Array.from({length:3},(_,i)=>Array.from({length:lane+1},(_,j)=>signed&&i===0?(spec.bytes===1?-128:-32768):i===1?top:((next()%top)+j)%top));
  const positionOffset=next()%2?1:3;
  await draw({format,seed:next(),shared:true,ids,stride:constant?0:(lane+1)*spec.bytes+(next()%2)*spec.bytes,divisor:constant?0xffffffff:next()%2?2:0,instances:3,
   positionOffset,positionSourceOffset:4-positionOffset,values,halfBits:[[0x0001,0x03ff,0x0400,0x3c01],[0x8000,0x83ff,0x8400,0xbc01],[0x3555,0xb555,0x7bff,0xfbff]],wordLane:base===91?next()%(lane+1):null},'critic-seeded-'+format+'-'+constant);
 }
 // A shared buffer holds both float32 position and compact color. Poison every
 // relevant native state and restore A/B/A from original upload packets.
 {
  const a=compactSpec({format:77,shared:true,ids:[3,8,13],values:[[-128,-127,-1,127],[0,37,63,127],[127,-64,5,-128]]}),b=compactSpec({format:94,shared:true,stride:0,ids:[3,8,13],halfBits:[[0x03ff,0x0400,0x8000,0x3c00]],wordLane:1}),r=make(a);
  const av=join(compactSetup(r,a),compactDraw(a)),ae=prediction(r,a,av);await frame(r,await compactSubmit(r,1,av,'critic-restore-A1'),ae);
  const vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer(),poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(512),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,1,gl.UNSIGNED_BYTE,false,5,1);gl.vertexAttribDivisor(i,17);gl.vertexAttrib4f(i,.2,.4,.6,.8);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([3,3,3]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'critic legal poison');};
  poison();const bv=join(compactSetup(r,b,{create:false}),compactDraw(b)),bp=prediction(r,b,bv,2);await frame(r,await compactSubmit(r,2,bv,'critic-restore-B'),bp);
  poison();r.bufferBytes=a.data;for(const [id,raw]of a.data)c.ok(r.store.writeBacking(id,0,raw),'critic original A backing');const restore=join(...[...a.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),clear([0,0,0,0]),compactDraw(a)),ap=prediction(r,a,restore);await frame(r,await compactSubmit(r,1,restore,'critic-restore-A2'),ap);gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
 }
 for(const options of [{format:77,shortColor:true},{format:94,stride:0,shortColor:true},{format:92,stride:3},{format:93,bufferOffset:0,sourceOffset:1},{format:59,shortIndex:true}]){
  const s=compactSpec(options),r=make(s),bytes=join(compactSetup(r,s),compactDraw(s));let rejected=false;try{prediction(r,s,bytes);}catch{rejected=true;}c.same(rejected,true,'critic predicts original bounds/alignment failure');const rec=await compactSubmit(r,1,bytes,'critic-short-'+JSON.stringify(options));c.same(rec.result.ok,false,'critic short/alignment rejects');c.same(r.trace.calls.length,0,'critic rejected input never draws');report.rejections.push({record:rec,events:r.trace.events});done(r);
 }
 for(const action of ['revision','cancel','reuse','dispose']){
  const s=compactSpec({format:59,shared:true,stride:0,ids:[3,10,17],values:[[-32768,-32767,1365,32767]]}),r=make(s);await compactSubmit(r,1,compactSetup(r,s),'critic-pending-setup-'+action);
  const old=r.allocations.find(a=>a.metadata.id===3).generation,bytes=join(clear([0,0,0,0]),compactDraw(s)),expected=prediction(r,s,bytes);let fired=false,before;
  if(action==='dispose'){
   r.trace.label('critic-dispose');r.currentLabel='critic-dispose';const token=c.ok(r.renderer.beginSubmission(1,bytes),'critic active disposal').job;
   for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'critic disposal step');const inspection=r.renderer.inspect();if(inspection.jobs.status==='waiting-attributes'){fired=true;before=inspection;break;}}
   c.same(fired,true,'critic delayed scalar batch reached');c.ok(r.renderer.dispose(),'critic dispose entire batch');c.same(r.renderer.step(token).ok,false,'critic disposed token stale');report.ownership.push({before,after:r.asyncAccess.inspect(),events:r.trace.events});done(r);continue;
  }
  const rec=await compactSubmit(r,1,bytes,'critic-pending-'+action,(_step,token)=>{const inspection=r.renderer.inspect();if(fired||inspection.jobs.status!=='waiting-attributes')return;fired=true;before=inspection;
   if(action==='cancel')c.ok(r.renderer.cancel(token),'critic cancel whole shared batch');
   else if(action==='reuse'){c.ok(r.store.unref(3),'critic public shared source reuse');add(r,meta(3,0,64,16,s.data.get(3).length),new Uint8Array(s.data.get(3).length));}
   else {const raw=s.data.get(3).slice();raw.fill(157);c.ok(r.store.writeBacking(3,0,raw),'critic source revision');const command=c.ok(decodeStandardSubmission(packet(43,0,[3,0,0,0,0,0,0,0,raw.length,1,1,0,1])),'critic literal revision command').commands[0],ticket=c.ok(r.store.prepareTransfer(1,command),'critic revision ownership').ticket;c.ok(r.store.executeTransfer(ticket),'critic actual GPU source revision');}
  });c.same(fired,true,'critic delayed shared source reached');c.same(rec.result.gpuComplete,true,'critic source failure or reuse drained');
  if(action==='reuse'){await frame(r,rec,expected);c.same(rec.result.draws[0].vertexFetches.map(f=>f.resourceGeneration),[old,old],'critic both shared bindings retain old generation');}
  else {c.same(rec.result.ok,false,'critic stale shared source rejects');c.same(r.trace.calls.length,0,'critic stale source never draws');}
  report.suspensions.push({action,before,record:rec,events:r.trace.events});done(r);
 }
 report.status='passed';return report;
}
