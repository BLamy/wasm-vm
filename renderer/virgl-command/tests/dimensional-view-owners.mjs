// Native private-range custody and caller state through the public owner API.
import {createStandardDimensionalViewTransferBackend,createStandardDimensionalViewResourceStore,createStandardDimensionalTransferBackend} from '../resources.mjs';
import {fixture,metadata} from '../../../tools/virgl-dimensional-views/fixtures.mjs';
export async function runOwnerAttacks(native,c,report){
 for(const target of ['3D','CUBE','2D_ARRAY']){
  const row={name:'owner/'+target,status:'running',calls:[],refusals:[]};report.ownerAttacks??=[];report.ownerAttacks.push(row);
  const objects=new WeakMap(),methods=new Map(),control={nullFramebuffer:false,incomplete:null};let next=1;
  const encode=v=>ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:[...new Uint8Array(v.buffer,v.byteOffset,v.byteLength)]}:Array.isArray(v)?v.map(encode):v&&typeof v==='object'?(objects.has(v)||objects.set(v,next++),{handle:objects.get(v)}):v;
  const gl=new Proxy(native,{get(t,name){const value=Reflect.get(t,name,t);if(typeof value!=='function')return value;
   if(!methods.has(name))methods.set(name,(...args)=>{const event={sequence:row.calls.length,name,args:args.map(encode)};row.calls.push(event);
    if(name==='createFramebuffer'&&control.nullFramebuffer){control.nullFramebuffer=false;event.injected='allocation-null';return null;}
    const result=value.apply(t,args);event.actual=encode(result);
    if(name==='checkFramebufferStatus'&&args[0]===control.incomplete){control.incomplete=null;event.injected='incomplete-native-status';return 0;}
    return result;});return methods.get(name);
  }});
  const historical=c.ok(createStandardDimensionalTransferBackend(gl),'historical dimensional backend');
  c.bad(createStandardDimensionalViewResourceStore({backend:historical.backend}),'historical backend has no sampler-view authority','invalid-input');historical.backend.dispose();
  const backend=c.ok(createStandardDimensionalViewTransferBackend(gl),'actual selected private-copy backend').backend;
  let failAllocation=false;const selectedBackend={...backend,allocate(m){return failAllocation?null:backend.allocate(m);}};
  const owners=c.ok(createStandardDimensionalViewResourceStore({backend:selectedBackend}),'actual dimensional range owner'),store=owners.store,access=owners.imageAccess;
  const f=fixture({target,firstLevel:1,lastLevel:2,stage:'fragment',opcode:'TXL',slot:7});
  c.ok(store.createContext(1),'original owner context');c.ok(store.createResource(f.source),'original native dimensional allocation');c.ok(store.attachContext(1,6),'original owner membership');
  const lease=c.ok(store.retainStorage(1,6,'view'),'original native view lease').lease;
  const before=store.inspect();failAllocation=true;
  row.refusals.push(c.bad(access.capture(lease,1,2,0,f.lastLayer),'null private allocation fails without custody','backend-error'));failAllocation=false;
  c.same(store.inspect().budgets,before.budgets,'null private allocation cannot charge or retain storage');
  for(const [first,last,a,b]of [[2,1,0,f.lastLayer],[0,3,0,f.lastLayer],[1,2,1,target==='CUBE'?5:target==='3D'?1:f.arraySize]])
    row.refusals.push(c.bad(access.capture(lease,first,last,a,b),'original retained extent refusal','out-of-bounds'));
  const selected=c.ok(access.capture(lease,1,2,target==='2D_ARRAY'?1:0,target==='2D_ARRAY'?3:f.lastLayer),'owned original private range');
  const source=c.ok(owners.bindings.resolve(lease),'actual source storage'),destination=c.ok(access.resolve(selected.token),'actual private storage');
  row.metadata=selected.metadata;row.before=store.inspect();
  const read=gl.createFramebuffer(),draw=gl.createFramebuffer();c.truth(read&&draw,'caller owns distinct native framebuffers');
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);gl.enable(gl.SCISSOR_TEST);gl.scissor(1,2,3,4);
  const state=()=>({read:encode(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)),draw:encode(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),scissor:gl.isEnabled(gl.SCISSOR_TEST),box:[...gl.getParameter(gl.SCISSOR_BOX)]});
  const caller=state();row.caller=caller;
  try{
   row.refreshed=c.ok(access.refresh(selected.token),'actual all-plane private GPU copy');c.same(state(),caller,'complete private copy restores caller FBO/scissor state');
   for(const mode of ['null-framebuffer','read-incomplete','draw-incomplete']){
    if(mode==='null-framebuffer')control.nullFramebuffer=true;else control.incomplete=mode==='read-incomplete'?gl.READ_FRAMEBUFFER:gl.DRAW_FRAMEBUFFER;
    row.refusals.push(c.bad(access.refresh(selected.token),'physical native copy failure/'+mode,'backend-error'));c.same(state(),caller,'failed private copy restores caller FBO/scissor state');
    c.ok(access.refresh(selected.token),'physical native private copy recovers');
   }
   let failure;try{backend.copyTextureRange(source.storage,{...destination.storage,target:gl.TEXTURE_2D},selected.metadata,1,0);}catch(error){failure=error;}
   c.truth(failure&&/matching owned native targets/.test(failure.message),'private copy rejects a mismatched native target before GL');c.same(state(),caller,'target refusal preserves caller state');
   const full=c.ok(access.capture(lease,0,2,0,f.lastLayer),'full-range view shares exact original allocation');
   c.truth(c.ok(access.resolve(full.token),'full native owner').storage===source.storage,'full original range does not allocate a CPU or GPU copy');c.ok(access.refresh(full.token),'full original range refresh is inert');c.ok(access.release(full.token),'release full owner');
  }finally{
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.disable(gl.SCISSOR_TEST);gl.deleteFramebuffer(read);gl.deleteFramebuffer(draw);
   c.ok(access.release(selected.token),'release private range');c.ok(store.releaseStorage(lease),'release source lease');row.after=store.inspect();c.ok(store.dispose(),'dispose native private owners');
   row.cleaned=store.inspect();c.equal(native.getError(),native.NO_ERROR,'native owner attacks leave no GL errors');
  }
  row.status='passed';
 }
 // The new consumer also owns the unchanged normalized 2D copy path.
 const backend=c.ok(createStandardDimensionalViewTransferBackend(native),'selected qualified 2D backend').backend;
 const owners=c.ok(createStandardDimensionalViewResourceStore({backend}),'selected qualified 2D owner'),s=owners.store;
 c.ok(s.createContext(1),'2D owner context');c.ok(s.createResource(metadata(6,2,67,8,4,4,1,1,2)),'qualified native 2D allocation');c.ok(s.attachContext(1,6),'2D membership');
 const lease=c.ok(s.retainStorage(1,6),'2D owner lease').lease,v=c.ok(owners.imageAccess.capture(lease,1,2),'qualified 2D private range');
 c.ok(owners.imageAccess.refresh(v.token),'qualified 2D GPU copy');c.ok(owners.imageAccess.release(v.token),'2D view retirement');c.ok(s.releaseStorage(lease),'2D lease retirement');c.ok(s.dispose(),'2D owner disposal');
}
