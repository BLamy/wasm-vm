import { createResourceStore, createWebGL2TransferBackend } from '/renderer/virgl-command/resources.mjs';
import { createVirglDrawRenderer, createVirglStateRenderer } from '/renderer/virgl-command/state.mjs';
import { createVirglShaderBridge } from '/renderer/virgl-shader/index.mjs';
const colors = [[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]],[[255,0,0,255],[0,128,0,255],[0,0,0,255],[255,128,0,255]],[[64,0,191,255],[0,64,191,255],[0,0,255,255],[64,64,191,255]]];
const packet=(op,type,words)=>{const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((x,i)=>v.setUint32(4+i*4,x,true));return b;};
const join=(...arrays)=>{const b=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let n=0;for(const a of arrays){b.set(a,n);n+=a.length;}return b;};
const word=(b,o,n)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(o,n,true);
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function runIndependentDrawAttacks(fixtures){
 let assertions=0,pixels=0;const records=[];
 const eq=(a,b,label)=>{assertions++;if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));};
 const ok=(r,l)=>{eq(r.ok,true,l+' '+JSON.stringify(r.error));return r;};
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false}),bridge=await createVirglShaderBridge();
 const raw=(event,f=fixtures)=>Uint8Array.from(f.commands.submissions.find(s=>s.event===event).data);
 const first=raw(161),draw=first.slice(5684),clear=first.slice(4848,4884),uploadIndex=first.slice(56,112),vb=first.slice(5656,5684);
 const pixel=(bytes,phase,label)=>{eq(bytes.length,4096,label+' image length');for(let q=0;q<4;q++)for(let y=4+16*(q>>1);y<12+16*(q>>1);y++)for(let x=4+16*(q&1);x<12+16*(q&1);x++){eq([...bytes.slice((y*32+x)*4,(y*32+x)*4+4)],colors[phase][q],label+' literal pixel '+x+','+y);pixels++;}};
 function rig(f=fixtures,drawLimits){
  const backend=ok(createWebGL2TransferBackend(gl),'real backend').backend,alloc=new Map(),live=new Set(),calls=[];
  const wrappedBackend={...backend,allocate(meta){const s=backend.allocate(meta);alloc.set(meta.id,s);live.add(s);return s;},destroy(s){backend.destroy(s);live.delete(s);}};
  const {store,bindings}=ok(createResourceStore({backend:wrappedBackend}),'real store');
  const wrappedGL=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);return typeof v==='function'?((...a)=>{if(k==='drawElements')calls.push([...a]);return v.apply(t,a);}):v;}});
  const config={gl:wrappedGL,resources:store,bindings,shaderBridge:bridge,...(drawLimits?{drawLimits}:{})};
  const renderer=ok(createVirglDrawRenderer(config),'draw factory').renderer;
  for(const a of f.initialization){if(a.type==='context_create'){ok(store.createContext(a.contextId),'public context');ok(renderer.createContext(a.contextId),'state context');}else if(a.type==='resource_create')ok(store.createResource(a.metadata),'create');else if(a.type==='resource_attach_iov')ok(store.attachBacking(a.resourceId,a.iovLengths.map(n=>new Uint8Array(n))),'zero original attach');else ok(store.attachContext(a.contextId,a.resourceId),'context attach');}
  for(const b of f.backing)for(const r of b.ranges)ok(store.writeBacking(b.resourceId,r.offset,Uint8Array.from(r.data)),'original CPU input');
  const run=(b,l,ctx=2)=>ok(renderer.executeSubmission(ctx,b),l);
  const cleanup=()=>{ok(renderer.dispose(),'renderer cleanup');ok(store.dispose(),'resource cleanup');for(const o of [renderer,store])for(const [k,v]of Object.entries(o.inspect().budgets))eq(v,0,'cleanup '+k);eq(live.size,0,'all allocations released');eq(gl.getError(),0,'cleanup GL error');};
  return{store,bindings,renderer,alloc,calls,run,cleanup,config};
 }
 async function fullReplay(f,label){
  const r=rig(f),frames=[];let packets=0;
  try{for(const s of f.commands.submissions){if(s.event===249)for(const a of f.lifecycle.filter(a=>a.event<249)){if(a.type==='ctx_detach_resource')ok(r.store.detachContext(a.contextId,a.resourceId),'detach');else if(a.type==='resource_detach_iov')ok(r.store.detachBacking(a.resourceId),'detach backing');else ok(r.store.unref(a.resourceId),'public unref');}
   const result=r.run(Uint8Array.from(s.data),label+' event '+s.event);packets+=result.appliedCommands;
   const phase=[173,197,221].indexOf(s.event);if(phase>=0){const image=ok(r.store.readBacking(7,[64,4160,8256][phase],4096),'staging').bytes;pixel(image,phase,label);frames.push(await sha(image));}
  }
  const finalEvents=[];for(const a of f.lifecycle.filter(a=>a.event>249)){if(a.type==='ctx_detach_resource')ok(r.store.detachContext(a.contextId,a.resourceId),'ordered final detach');else if(a.type==='resource_detach_iov')ok(r.store.detachBacking(a.resourceId),'ordered final backing detach');else if(a.type==='resource_unref')ok(r.store.unref(a.resourceId),'ordered final public unref');else{ok(r.renderer.destroyContext(a.contextId),'ordered state context destroy');ok(r.store.destroyContext(a.contextId),'ordered resource context destroy');}finalEvents.push(a.event);}
  eq(packets,210,label+' all original packets');eq(r.calls.length,3,label+' actual draws');return{label,frames,packets,draws:r.calls.length,finalEvents};}finally{r.cleanup();}
 }
 const primary=await fullReplay(fixtures,'original');records.push(primary);
 const poison=structuredClone(fixtures);for(const s of poison.referenceOutputSnapshots)s.data.fill(0xa7);const poisoned=await fullReplay(poison,'poison reference outputs');eq(poisoned.frames,primary.frames,'poison outputs do not influence actual image');records.push(poisoned);
 // Independent input mutations vary fields/locations from the worker controls.
 for(const seed of [0x9e3779b9,0x243f6a88,0xb7e15162])for(const kind of ['vertex','index','texel','constant','blend','readback-offset']){
  const f=structuredClone(fixtures);let provenance;
  if(['vertex','index','texel'].includes(kind)){
   const id=kind==='vertex'?3:kind==='index'?4:7,b=f.backing.find(s=>s.resourceId===id),data=Uint8Array.from(b.ranges[0].data),v=new DataView(data.buffer);
   if(kind==='vertex'){v.setFloat32(56,0,true);v.setFloat32(60,0,true);provenance={event:b.event,offset:56,changed:'last vertex UV becomes bottom-left'};}
   else if(kind==='index'){const offset=2*(seed%6);v.setUint16(offset,4+(seed%31),true);provenance={event:b.event,offset,value:4+(seed%31)};}
   else{data[13]=seed&127;provenance={event:b.event,offset:13,value:data[13]};}b.ranges[0].data=[...data];
  }else{const event=kind==='constant'?185:kind==='blend'?209:197,s=f.commands.submissions.find(s=>s.event===event),b=Uint8Array.from(s.data),v=new DataView(b.buffer);let offset,value;
   if(kind==='constant'){offset=4156;value=0x3f800000;}else if(kind==='blend'){offset=4156;const before=v.getUint32(offset,true);value=(before&~(31<<4))|(1<<4);}else{offset=4156;value=16384+(seed&255)*4;}
   word(b,offset,value);s.data=[...b];provenance={event,offset,value};}
  let failed;try{await fullReplay(f,'input mutation '+kind);}catch(e){failed=e.message;}
  eq(typeof failed,'string',kind+' must fail');eq(kind==='index'?failed.includes('out-of-bounds'):failed.includes('literal pixel'),true,kind+' fails appropriate bounds/pixel oracle ('+failed+')');records.push({kind,seed,provenance,detected:failed});
 }
 const r=rig();r.run(first,'initial novel draw');
 const reject=(b,code,label)=>{const calls=r.calls.length,budgets=r.store.inspect().budgets,result=r.renderer.executeSubmission(2,b);eq(result.ok,false,label+' rejected');eq(result.error.code,code,label+' rejection code');eq(result.draws,[],label+' no summary');eq(r.calls.length,calls,label+' no actual draw');eq(r.store.inspect().budgets,budgets,label+' no budget leak');eq(gl.getError(),0,label+' no GL error');};
 const read=(label)=>{r.run(raw(173),'readback '+label);pixel(ok(r.store.readBacking(7,64,4096),'read result').bytes,0,label);};
 const recover=(label)=>{r.run(clear,'clear '+label);r.run(draw,'recovery '+label);read(label);};
 const originalIndex=Uint8Array.from(fixtures.backing.find(b=>b.resourceId===4).ranges[0].data);
 for(const seed of [0x9e3779b9,0x243f6a88,0xb7e15162])for(let n=0;n<12;n++){
  const slot=(n+seed)%6,value=4+((Math.imul(seed,n+1)>>>0)%60000),badIndex=originalIndex.slice();new DataView(badIndex.buffer).setUint16(slot*2,value,true);
  gl.bindBuffer(gl.COPY_WRITE_BUFFER,r.alloc.get(4).buffer);gl.bufferSubData(gl.COPY_WRITE_BUFFER,0,badIndex);eq(gl.getError(),0,'actual GPU index mutation');
  eq([...ok(r.store.readBacking(4,0,12),'unchanged CPU index backing').bytes],[...originalIndex],'GPU and CPU diverge deliberately');
  const hinted=draw.slice();word(hinted,44,0);reject(hinted,'out-of-bounds','actual GPU index defeats zero max hint');
  r.run(uploadIndex,'repair actual GPU from unchanged original backing');recover('GPU index mutation recovery');
  r.run(packet(6,0,[16,0,3,16,12+4*(n%2),3]),'UV binding exceeds separate fetch extent');reject(draw,'out-of-bounds','UV fetch exceeds while position fits');r.run(vb,'restore exact-fit UV');recover('UV extent recovery');
  records.push({kind:'GPU index and UV recovery',seed,n,slot,value});
 }
 // A CPU-only poison must not alter the already uploaded actual indices.
 const cpuOnly=originalIndex.slice();new DataView(cpuOnly.buffer).setUint16(0,65535,true);ok(r.store.writeBacking(4,0,cpuOnly),'CPU-only index poison');recover('CPU-only poison leaves GPU valid');ok(r.store.writeBacking(4,0,originalIndex),'CPU repair');
 for(const [offset,value,code,label]of[[4,7,'unsupported-draw','nonzero start'],[8,7,'out-of-bounds','count exceeds storage'],[8,0,'unsupported-draw','empty draw']]){const b=draw.slice();word(b,offset,value);reject(b,code,label);recover(label);}
 const restart=originalIndex.slice();new DataView(restart.buffer).setUint16(4,65535,true);gl.bindBuffer(gl.COPY_WRITE_BUFFER,r.alloc.get(4).buffer);gl.bufferSubData(gl.COPY_WRITE_BUFFER,0,restart);reject(draw,'unsupported-draw','fixed restart value');r.run(uploadIndex,'repair restart');
 r.run(packet(6,0,[0,0,3,16,8,3]),'zero stride');reject(draw,'unsupported-draw','zero stride is not packed');r.run(vb,'restore stride');
 reject(join(draw,packet(255,0,[])),'unsupported-command','bad tail prevents valid draw prefix');recover('tail recovery');
 // Readback guards prove the destination offset is used, including legal relocation.
 const destination=16384,guard=new Uint8Array(4098).fill(0x6d);ok(r.store.writeBacking(7,destination-1,guard),'readback destination sentinels');const relocated=raw(173);word(relocated,4156,destination);r.run(relocated,'legal relocated GPU readback');const guarded=ok(r.store.readBacking(7,destination-1,4098),'actual guarded backing').bytes;eq([guarded[0],guarded[4097]],[0x6d,0x6d],'readback preserves guards');pixel(guarded.slice(1,-1),0,'relocated readback');
 // Same-context subcontext name reuse and restoration on real draws.
 r.run(packet(29,0,[9]),'new subcontext9');r.run(first.slice(4112),'reused object handles in sub9');r.run(packet(28,0,[1]),'select original sub1');gl.useProgram(null);gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.colorMask(false,false,false,false);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);recover('subcontext and host poison');r.run(packet(30,0,[9]),'destroy reused subcontext');
 // Retain index generation over public name removal and reuse.
 const old=r.alloc.get(4);ok(r.store.unref(4),'public old index removed');ok(r.store.createResource(fixtures.resources.find(x=>x.id===4)),'reuse public index ID');ok(r.store.attachContext(2,4),'attach new public index ID');recover('retained original index generation');eq(gl.isBuffer(old.buffer),true,'old index allocation held by binding');r.run(packet(11,0,[0]),'unbind old index');eq(gl.isBuffer(old.buffer),false,'old allocation collected after unbind');
 const stateOnly=ok(createVirglStateRenderer(r.config),'state-only remains independent').renderer;ok(stateOnly.createContext(2),'state-only context');const legacy=stateOnly.executeSubmission(2,draw);eq(legacy.error.code,'unsupported-draw','state-only explicit stop');eq(Object.hasOwn(legacy,'draws'),false,'state-only original result shape');ok(stateOnly.dispose(),'state-only cleanup');r.cleanup();
 const quota=rig(fixtures,{drawsPerSubmission:2});quota.run(first.slice(0,5684),'quota state');const limited=quota.renderer.executeSubmission(2,join(draw,draw,draw));eq([limited.ok,limited.error.code,limited.appliedCommands,limited.draws.length,quota.calls.length],[false,'limit-exceeded',2,2,2],'exact successful draw prefix quota');quota.run(draw,'quota resets per submission');quota.cleanup();
 eq(gl.getError(),0,'final GL error');return{status:'passed',assertions,pixels,records,primary,novelRounds:36,inputMutations:18,finalBudgets:'zero',synchronousActualGpuIndices:true};
}
