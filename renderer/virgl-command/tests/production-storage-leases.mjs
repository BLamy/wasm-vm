import {createProductionTransferBackend,createProductionResourceStore,
  createStandardStreamOutputResourceStore,PRODUCTION_RESOURCE_LIMITS,RESOURCE_LIMITS} from '../resources.mjs';
import {createRetainedScanout} from '../scanout.mjs';
import {createWorkerScanoutPresenter} from '../production.mjs';

export async function runProductionStorageLeases() {
  let assertions=0;
  const need=(condition,message)=>{assertions++;if(!condition)throw Error(message);};
  const ok=(value,message)=>{need(value?.ok,message+': '+JSON.stringify(value?.error));return value;};
  const same=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
  need(gl&&!gl.isContextLost(),'actual WebGL2 context');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const hardware=String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER));
  need(!/swiftshader|llvmpipe|softpipe|lavapipe/i.test(hardware),'hardware renderer');
  const report={status:'running',hardware,assertions:0,rows:[]};
  const metadata=(id,width=1,height=1)=>({id,target:2,format:67,bind:10,width,height,
    depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
  function owner(factory=createProductionResourceStore,limits) {
    const made=ok(createProductionTransferBackend(gl),'production native backend');
    let allocated=0,destroyed=0;
    const backend={...made.backend,
      allocate(meta){const storage=made.backend.allocate(meta);allocated++;return storage;},
      destroy(storage){destroyed++;return made.backend.destroy(storage);}};
    const owned=ok(factory({backend,...(limits?{limits}:{})}),'selected resource owner');
    return {...owned,counts:()=>({allocated,destroyed}),dispose(){
      ok(owned.store.dispose(),'dispose resource owner');
      same(allocated,destroyed,'all physical texture allocations destroyed');
      for(const value of Object.values(owned.store.inspect().budgets))same(value,0,'all ownership budgets return to zero');
    }};
  }
  // Only the host-selected production token count changes. The historical
  // profile, transfer reservations and every byte ceiling retain their bounds.
  same(RESOURCE_LIMITS.leases,64,'historical lease ceiling');
  same(PRODUCTION_RESOURCE_LIMITS.leases,512,'production lease ceiling');
  same(Object.fromEntries(['resourceBytes','transferBytes','cpuBytes','gpuBytes','scratchBytes','tickets']
    .map(key=>[key,PRODUCTION_RESOURCE_LIMITS[key]])),
  {resourceBytes:33554432,transferBytes:33554432,cpuBytes:201326592,gpuBytes:134217728,scratchBytes:67108864,tickets:64},'unchanged byte and ticket ceilings');
  for(const [name,factory,maximum] of [['historical',createStandardStreamOutputResourceStore,64],
    ['production',createProductionResourceStore,512]]) {
    const r=owner(factory),leases=[];
    try {
      ok(r.store.createContext(1),'real context');ok(r.store.createResource(metadata(1)),'real texture');
      ok(r.store.attachContext(1,1),'texture membership');
      for(let i=0;i<maximum;i++)leases.push(ok(r.store.retainStorage(1,1,'view'),'retained texture '+i).lease);
      const before=r.store.inspect(),counts=r.counts();
      const overflow=r.store.retainStorage(1,1,'view');
      need(!overflow.ok&&overflow.error.code==='limit-exceeded','one beyond token ceiling rejects');
      same(r.store.inspect(),before,'token refusal preserves all state');same(r.counts(),counts,'token refusal allocates no native storage');
      need(!r.store.releaseStorage({}).ok,'foreign token rejects');
      const released=leases.pop();ok(r.store.releaseStorage(released),'release exact token');
      need(!r.store.releaseStorage(released).ok,'released token cannot release twice');
      leases.push(ok(r.store.retainStorage(1,1,'surface'),'exact freed slot can be reused').lease);
      ok(r.store.unref(1),'remove public name while leases retain storage');
      same(r.store.inspect().budgets.resources,1,'unpublished retained resource remains charged');
      same(r.counts().destroyed,0,'retained texture remains physically alive');
      for(const lease of leases.reverse())ok(r.store.releaseStorage(lease),'release exact retained owner');
      same(r.store.inspect().budgets.resources,0,'last release collects unpublished storage');
      report.rows.push({name,maximum,overflow:overflow.error,before:before.budgets,counts:r.counts()});
    } finally {r.dispose();}
  }
  {
    const r=owner(),views=[];
    try {
      ok(r.store.createContext(1),'view context');ok(r.store.createResource(metadata(1)),'view source');
      ok(r.store.attachContext(1,1),'view source membership');
      const lease=ok(r.store.retainStorage(1,1,'view'),'view source lease').lease;
      for(let i=0;i<512;i++)views.push(ok(r.imageAccess.capture(lease,0,0),'native image view '+i).token);
      const before=r.store.inspect(),overflow=r.imageAccess.capture(lease,0,0);
      need(!overflow.ok&&overflow.error.code==='limit-exceeded','image view513 rejects');
      same(r.store.inspect(),before,'image view refusal preserves accounting');
      ok(r.store.unref(1),'unpublish original image');
      const original=ok(r.bindings.resolve(lease),'retained original image');
      const replacement=ok(r.store.createResource(metadata(1)),'reuse original public image ID');
      need(replacement.resource.generation!==original.generation,'reused image has distinct generation');
      for(const token of views){
        same(ok(r.imageAccess.resolve(token),'retained original view').generation,original.generation,'view cannot follow reused ID');
        ok(r.imageAccess.release(token),'release original view');
      }
      ok(r.store.releaseStorage(lease),'release original allocation');
      same(r.store.inspect().budgets.resources,1,'only replacement allocation remains');
      report.rows.push({name:'image-views',maximum:512,overflow:overflow.error,retained:before.budgets,counts:r.counts()});
    } finally {r.dispose();}
  }
  {
    const r=owner(),held=[],messages=[];
    const metas=[metadata(1,1280,800),metadata(2,1280,800)],allocations=new Map();
    const presenter=createWorkerScanoutPresenter(message=>messages.push(message));
    let fault=null;
    const scanout=createRetainedScanout({getOwners:()=>r,resolveResource:identity=>{
      const entry=allocations.get(identity.id);need(entry&&identity.generation===entry.transport,'exact transport identity');
      return {metadata:entry.metadata,storageGeneration:entry.generation};
    },presenter,onFault:error=>{fault=String(error);},production:true});
    let generation=0;
    const event=id=>({type:'bindScanout',epoch:'0000000000000001',binding:{
      generation:(++generation).toString(16).padStart(16,'0'),rect:{x:0,y:0,width:1280,height:800},
      target:{kind:'renderer',resource:{id,generation:allocations.get(id).transport},metadata:metas[id-1]}}});
    try {
      ok(r.store.createContext(1),'scanout context');
      for(const meta of metas){const created=ok(r.store.createResource(meta),'literal1280x800 allocation');
        allocations.set(meta.id,{metadata:meta,generation:created.resource.generation,transport:BigInt(meta.id).toString(16).padStart(16,'0')});
        ok(r.store.attachContext(1,meta.id),'scanout membership');}
      for(let i=0;i<64;i++)held.push(ok(r.store.retainStorage(1,1,'surface'),'simultaneous real renderer owner').lease);
      ok(scanout.bind(event(1)),'scanout binds beyond historical64 tokens');
      for(let i=0;i<1000;i++){
        ok(scanout.bind(event(i%2+1)),'repeated scanout ownership replacement');
        same(r.store.inspect().budgets.leases,65,'rebind retains one scanout owner');
      }
      while(r.store.inspect().budgets.leases<512)held.push(ok(r.store.retainStorage(1,1,'view'),'fill remaining token slots').lease);
      const before=scanout.inspect(),budget=r.store.inspect().budgets;
      const refused=scanout.bind(event(1));
      need(!refused.ok&&refused.error.code==='out-of-memory','replacement at full token ceiling rejects');
      same(scanout.inspect(),before,'failed replacement preserves old display and its exact binding');
      same(r.store.inspect().budgets,budget,'failed replacement preserves ownership counts');
      ok(r.store.releaseStorage(held.pop()),'free one token for transactional replacement');
      ok(scanout.bind(event(1)),'replacement succeeds with one free transient token');
      same(r.store.inspect().budgets.leases,511,'old binding token released after replacement');
      const lease=held[0],texture=ok(r.bindings.resolve(lease),'physical source texture').storage.texture;
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1280,800,gl.RGBA,gl.UNSIGNED_BYTE,
        new Uint8Array(1280*800*4).map((_,i)=>i%4===0||i%4===3?255:0));gl.bindTexture(gl.TEXTURE_2D,null);
      const binding=scanout.inspect().binding;
      const job=ok(scanout.begin({type:'beginScanout',epoch:binding.epoch,sequence:'0000000000000001',binding}),'actual retained GPU readback').job;
      let step;
      for(let i=0;i<1000;i++){step=ok(scanout.step(job),'native GPU readback step');if(step.status==='done')break;await new Promise(resolve=>setTimeout(resolve,1));}
      need(step?.status==='done'&&step.result.ok,'actual native scanout read completes');
      const frame=messages.findLast(message=>message.pixels);
      need(frame&&frame.pixels.length===1280*800,'whole literal scanout returned');
      need(frame.pixels.every(pixel=>pixel===0xffff0000),'every actual GPU pixel matches independent red BGRA oracle');
      need(presenter.acknowledge(frame.presentationToken,'drawn',{source:'test-native-pixel-oracle'}),'retire exact original frame');
      same(scanout.inspect().retainedFrames,0,'presentation releases its readback ticket');
      same(fault,null,'no uncertain ownership fault');
      report.rows.push({name:'scanout-replacement',replacements:1002,refused:refused.error,scanout:scanout.inspect(),budgets:r.store.inspect().budgets,pixelCount:frame.pixels.length,pixel:frame.pixels[0]});
    } finally {ok(scanout.dispose(),'dispose scanout');for(const lease of held)ok(r.store.releaseStorage(lease),'release explicit scanout-test owner');r.dispose();}
  }
  {
    const r=owner();
    const backend=ok(createProductionTransferBackend(gl),'invalid-limit backend').backend;
    try {const result=createProductionResourceStore({backend,limits:{leases:513}});
      need(!result.ok&&result.error.code==='invalid-input','host cannot raise production token ceiling');
      report.rows.push({name:'host-ceiling',result});
    } finally {backend.dispose();r.dispose();}
  }
  same(gl.getError(),gl.NO_ERROR,'zero native WebGL errors');
  report.status='passed';report.assertions=assertions;return report;
}
