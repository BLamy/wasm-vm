import {rig,finish,blob,submit,nativeRead,checks} from './standard-packed-unsigned-consumer-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {createVirglStandardPackedNormalizedImageAsyncRenderer} from '../state.mjs';
import {sampleCases,setupSample,viewsSample,readSample,draw,expectedSample,sampleMisses,originalFormat,positions,textureTransfer,join,packet,shader,imageView,surface,word,sampler} from '../../../tools/virgl-packed-unsigned-consumer/samples.mjs';
import {metadata,clear} from '../../../tools/virgl-packed-unsigned-consumer/fixtures.mjs';
import {nativeMisses,source,clearWords} from '../../../tools/virgl-command/standard-packed-unsigned-fixtures.mjs';
export async function runSamples({smoke=false,boundaries=false,fault=null,seed=0xd8412ac9}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:boundaries?'sample-boundaries':'samples',seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardPackedUnsignedConsumerEvidence=report;
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 const cases=fault?sampleCases({smoke:true,seed}).filter(f=>f.format===253):boundaries?Array.from({length:4},(_,mode)=>sampleCases({smoke:true,seed}).map(f=>({...f,name:f.name+'/terminal-'+mode}))).flat():sampleCases({smoke,seed});
 for(const [ordinal,f]of cases.entries()){
  const r=rig(gl,bridge,c,f,{delay:boundaries?jitter:ordinal%3,step:boundaries?1:ordinal%2?1:64,fault}),row={name:f.name,kind:boundaries?'sample-boundary':'sample',format:f.format,stage:f.stage,opcode:f.opcode,range:[f.firstLevel,f.lastLevel],swizzle:f.swizzle,lod:f.lod,coord:f.coord,parameters:f.parameters,width:f.width,height:f.height,vertex:f.vertex,fragment:f.fragment,source:f.source.metadata,planes:[],frames:[],actions:[]};r.blobs=report.blobs;report.runs.push(row);
  r.add(metadata(1,f.outputFormat,f.width,f.height,2,2),new Uint8Array(r.outputBackingBytes).fill(0x2e));const target=r.allocations.at(-1);row.target=target.metadata;
  r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
  const original=r.add(f.source.metadata,f.source.backing);row.sourceGeneration=original.generation;row.sourceBacking=await blob(report,f.source.backing);row.positions=await blob(report,positions);for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
  if(fault==='sample-plane'){r.add(metadata(9,f.format,17,9,3,10),new Uint8Array(f.source.backing.length).fill(0));}
  let predicted=expectedSample(f);row.expectedSample=predicted;
  async function capture(kind,record,ctx=1){
   c.ok(record.result,'original packed sample transaction');c.same(record.result.gpuComplete,true,'original packed sample native completion');
   const expected=kind==='clear'?f.clearWords:predicted,native=nativeRead(r,target.storage.texture,f.outputFormat,f.width,f.height,0),miss=sampleMisses(native,expected),frame={run:report.runs.length-1,kind,completion:{...r.lastCompletion},historyIndex:r.history.length-1,native:await blob(report,native),expected,bindings:[],outputs:[]};report.frames.push(frame);row.frames.push(report.frames.length-1);
   if(fault&&miss.length)report.sabotage={fault,held:false,completion:{...r.lastCompletion},miss};c.same(miss,[],'complete raw UINT sampled plane');
   for(let level=0;level<=2;level++){const width=Math.max(1,f.width>>level),height=Math.max(1,f.height>>level);frame.outputs.push({level,width,height,native:await blob(report,nativeRead(r,target.storage.texture,f.outputFormat,width,height,level))});}
   if(kind==='draw'){
    const active=gl.getParameter(gl.ACTIVE_TEXTURE),unit=(f.stage==='vertex'?16:0)+f.slot;gl.activeTexture(gl.TEXTURE0+unit);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(a=>a.storage.texture===texture),planes=[];c.same(Boolean(allocation),true,'actual retained packed sample range');
    for(let local=0;local<=f.lastLevel-f.firstLevel;local++){const p=f.source.planes[f.firstLevel+local],raw=nativeRead(r,texture,f.format,p.width,p.height,local);c.same(nativeMisses(f.format,p.input,raw),[],'all native packed sample range components');planes.push({local,original:p.level,width:p.width,height:p.height,native:await blob(report,raw)});}frame.bindings.push({unit,texture:r.trace.id(texture),metadata:allocation.metadata,planes});gl.activeTexture(active);
   }
   const read=await submit(r,ctx,readSample(f),record.label+'/public');c.ok(read.result,'original UINT target public transfer');frame.publicHistory=r.history.length-1;const backing=c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'complete original UINT sampled output backing').bytes;frame.backing=await blob(report,backing);
   const expectedBacking=new Uint8Array(r.outputBackingBytes).fill(0x2e);for(let y=0;y<f.height;y++)expectedBacking.set(native.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));c.same([...backing],[...expectedBacking],'every sampled output and untouched public byte');c.same(gl.getError(),gl.NO_ERROR,'packed sample native diagnostic');
  }
  try{
   await capture('clear',await submit(r,1,setupSample(f),'packed-sample-setup-'+ordinal));
   if(fault==='sample-plane')c.ok((await submit(r,1,join(...f.source.planes.map(p=>textureTransfer(9,p.level,p.width,p.height,p.offset,p.stride))),'packed-sample-decoy-'+ordinal)).result,'actual wrong sample storage upload');
   c.ok((await submit(r,1,viewsSample(f),'packed-sample-views-'+ordinal)).result,'original packed UINT view admission');
   if(fault)r.armFault();
   for(const temperature of ['first','warm']){await capture('draw',await submit(r,1,draw(),'packed-sample-draw-'+ordinal+'-'+temperature));row.cache??=[];row.cache.push(r.renderer.inspect());}
   c.same(row.cache[0].work.programLinks,row.cache[1].work.programLinks,'warm packed UINT program reuse');
   if(boundaries){
    const alias=f.format===225?253:225,before=r.draws.length,nativeBefore=r.events.filter(e=>(/^draw(?:Arrays|Elements)/.test(e.name)||e.name==='blitFramebuffer')).length;
    const wrong=await submit(r,1,imageView(70,6,alias,1,3),'packed-alias-identity-'+ordinal);row.actions.push(wrong);
    c.same(wrong.result.error.code,'incompatible-resource','packed original format identity cannot alias another packing');
    for(const type of ['FLOAT','SINT']){
     const handle=type==='FLOAT'?71:73,refusal=await submit(r,1,join(shader(handle,1,f.fragment.replace('2D, UINT','2D, '+type)),packet(31,0,[handle,1]),draw()),'packed-typed-'+type+'-'+ordinal);row.actions.push(refusal);
     c.same(refusal.result.error.code,'incompatible-resource','FLOAT or SINT sampler cannot borrow packed UINT storage');c.same(r.draws.length,before,'packed type refusal issues no native guest draw');
    }
    c.ok((await submit(r,1,packet(31,0,[11,1]),'packed-restore-UINT-'+ordinal)).result,'restore UINT original sampler');
    for(const [index,key] of ['min','mag','mip'].entries()){
     const handle=74+index;
     const linear=await submit(r,1,join(sampler(handle,{...f.parameters,[key]:1}),packet(18,0,[1,f.slot,handle]),draw()),'packed-linear-'+key+'-'+ordinal);row.actions.push(linear);c.same(linear.result.error.code,'unsupported-sampler','packed UINT filters require nearest');
    }
    c.ok((await submit(r,1,packet(18,0,[1,f.slot,50]),'packed-restore-nearest-'+ordinal)).result,'restore native nearest state');
    c.same(r.draws.length,before,'all refused samplers issue no native guest draw');c.same(r.events.filter(e=>(/^draw(?:Arrays|Elements)/.test(e.name)||e.name==='blitFramebuffer')).length,nativeBefore,'all refused samplers issue no private range copy');
    const selected=r.renderer,old=c.ok(createVirglStandardPackedNormalizedImageAsyncRenderer({gl:r.traced,shaderBridge:r.bridge,resources:r.store,bindings:r.bindings,asyncAccess:r.asyncAccess,uniformAccess:r.uniformAccess,imageAccess:r.imageAccess}),'closed historical packed normalized renderer').renderer;
    try{c.ok(old.createContext(1),'historical context');r.renderer=old;const result=await submit(r,1,imageView(72,6,f.format,1,3),'packed-historical-closed-'+ordinal);row.actions.push(result);c.same(result.result.error.code,'unsupported-feature','historical renderer packed admission remains closed');}
    finally{c.ok(old.dispose(),'historical temporary renderer retires');r.renderer=selected;c.ok(r.renderer.restoreContext(1),'restore selected packed state');}
    c.ok((await submit(r,1,surface(60,6,f.format,1),'packed-retained-source-surface-'+ordinal)).result,'retain original packed mip surface before source ID reuse');
    c.ok((await submit(r,2,join(setupSample(f),viewsSample(f)),'packed-second-context-'+ordinal)).result,'independent packed source context');
    c.ok(r.store.unref(6),'unref original packed source name');const replacement=source(alias,11,7,2,seed),fresh=r.add(replacement.metadata,replacement.backing);row.actions.push({kind:'source-id-reuse',newGeneration:fresh.generation,replacement:replacement.metadata,backing:await blob(report,replacement.backing)});
    c.same(fresh.generation>original.generation,true,'same packed ID owns a distinct generation');
    await capture('draw',await submit(r,1,draw(),'packed-retained-context1-'+ordinal));await capture('draw',await submit(r,2,draw(),'packed-retained-context2-'+ordinal),2);
    c.ok(r.renderer.resetCaches(),'reset packed program cache');c.ok(r.renderer.restoreContext(1),'restore retained packed context');await capture('draw',await submit(r,1,draw(),'packed-retained-restored-'+ordinal));
    const values=[1023,17,683,3],level=1;
    c.ok((await submit(r,1,join(packet(5,0,[1,0,60]),clear(4,values)),'packed-GPU-only-mip-clear-'+ordinal)).result,'original packed GPU-only mip clear');
    const p=f.source.planes[level];p.input=clearWords(f.format,p.width,p.height,values);predicted=expectedSample(f);row.sourceClear={level,values};
    await capture('draw',await submit(r,1,join(packet(5,0,[1,0,20]),draw()),'packed-GPU-only-range-refresh-'+ordinal));
    const unchanged=c.ok(r.store.readBacking(6,0,replacement.backing.length),'replacement packed backing').bytes;c.same([...unchanged],[...replacement.backing],'GPU-only old range refresh preserves every new-generation CPU byte');row.replacementBackingAfter=await blob(report,unchanged);
    const mode=['complete','cancel','renderer-dispose','resource-dispose'][Math.floor(ordinal/2)];row.terminalMode=mode;let point=null;
    c.ok(r.renderer.destroyContext(2),'drop second retained context before queued ownership check');
    const record=await submit(r,1,join(draw(),packet(10,0,[1,f.slot,0]),packet(3,6,[51]),packet(5,0,[0,0]),packet(3,8,[20]),packet(3,8,[60])),'packed-queued-'+mode+'-'+ordinal,async(step,job)=>{
     const state=r.renderer.inspect();if(state.jobs.status!=='finishing'||point)return;
     point={renderer:state,before:r.store.inspect(),images:r.imageAccess.inspect()};c.same(point.before.budgets.imageHolds,2,'old packed sampler range and output held by physical final fence');
     c.ok(r.store.unref(1),'retire queued original UINT output name');const next=r.add(metadata(1,alias,9,3,0,10),new Uint8Array(20000).fill(0x71));c.same(next.generation>target.generation,true,'queued output replacement generation differs');point.targetGeneration=next.generation;row.actions.push({kind:'pending-native-range-and-target',...point});
     if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel packed owned native completion');
     if(mode.endsWith('dispose')){if(mode==='resource-dispose')c.ok(r.store.dispose(),'dispose packed owner at physical completion');c.ok(r.renderer.dispose(),'dispose packed consumer at physical completion');return{disposed:true,appliedCommands:state.jobs.appliedCommands};}
    });row.actions.push(record);c.same(Boolean(point),true,'packed range reaches finishing phase');
    if(mode==='complete')c.ok(record.result,'queued retained packed sample completion');else c.same(record.result.error.code,mode==='cancel'?'cancelled':'disposed','queued packed sample terminal state');
   }
  }finally{await finish(r,report,row);}
  if(boundaries&&['complete','cancel'].includes(row.terminalMode)){
   const retired=row.retiredPlanes.find(p=>p.texture===r.trace.id(target.storage.texture));c.same(Boolean(retired),true,'retired sampled output captured after physical fence before native deletion');
   const historyIndex=row.history.findIndex(h=>h.label==='packed-queued-'+row.terminalMode+'-'+ordinal),frame={run:report.runs.length-1,kind:'draw',retired:true,completion:retired.completion,historyIndex,native:retired.native,bindings:[],outputs:[]};
   report.frames.push(frame);row.frames.push(report.frames.length-1);
  }
 }
 report.status='passed';return report;
}
