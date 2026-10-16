// Original lifetime replay and physical GPU count/lifetime boundaries.
import * as current from '../resources.mjs';
const same=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(message+': '+JSON.stringify({expected:b,observed:a}).slice(0,320));};
const need=(x,message)=>{if(!x)throw new Error(message);};
const ok=(x,message)=>{need(x?.ok,message+': '+JSON.stringify(x));return x;};
const metadata=(id,width=128)=>({id,target:0,format:64,bind:16,width,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const zero=store=>{const state=store.inspect();for(const [key,value]of Object.entries(state.budgets))same(value,0,'final budget '+key);return state;};
const originalMeta=e=>({id:e.resourceId,...Object.fromEntries(['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'].map(k=>[k,e[k]]))});
function rig(gl,m=current,limits,failAllocation=false){
 const made=ok(m.createStandardPackedDepthTransferBackend(gl),'qualified native backend'),allocations=[];
 let calls=0,destroyed=0;
 const backend={...made.backend,allocate(meta){calls++;if(failAllocation)throw new Error('recorded host allocation failure');const storage=made.backend.allocate(meta);allocations.push({metadata:meta,storage});return storage;},destroy(storage){destroyed++;return made.backend.destroy(storage);}};
 const create=m.createStandardDesktopResourceStore??m.createStandardPackedDepthResourceStore;
 const madeStore=ok(create({backend,...(limits===undefined?{}:{limits})}),'selected resource store');
 return{...madeStore,backend,allocations,counts:()=>({calls,destroyed}),dispose(){ok(madeStore.store.dispose(),'store disposal');return zero(madeStore.store);}};
}
async function fence(gl,label,report){
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(sync,'actual native fence');gl.flush();const polls=[];
 for(let i=0;i<1000;i++){const observed=gl.clientWaitSync(sync,0,0);polls.push(observed);if(observed===gl.ALREADY_SIGNALED||observed===gl.CONDITION_SATISFIED){gl.deleteSync(sync);const row={sequence:report.fences.length+1,label,polls,completed:true};report.fences.push(row);same(gl.getError(),0,'native fence GL error');return row;}
  need(observed===gl.TIMEOUT_EXPIRED,'native wait failed');await new Promise(resolve=>setTimeout(resolve,1));}
 gl.deleteSync(sync);throw new Error('native fence did not complete');
}
function physical(gl,r,entry,bytes){
 need(entry.storage.kind==='buffer','physical count specimen must be a native buffer');gl.bindBuffer(gl.COPY_WRITE_BUFFER,entry.storage.buffer);same(gl.getBufferParameter(gl.COPY_WRITE_BUFFER,gl.BUFFER_SIZE),entry.metadata.byteLength,'native allocation length');gl.bufferSubData(gl.COPY_WRITE_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_WRITE_BUFFER,null);same(gl.getError(),0,'physical upload GL error');
}
function nativeBytes(gl,entry){const out=new Uint8Array(entry.metadata.byteLength);gl.bindBuffer(gl.COPY_READ_BUFFER,entry.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,out);gl.bindBuffer(gl.COPY_READ_BUFFER,null);same(gl.getError(),0,'physical read GL error');return [...out];}
function byteOracle(report,rows){for(const row of rows){same(row.observed,row.input,'independent original native bytes for resource '+row.id);}report.byteOracle={rows:rows.length,bytes:rows.reduce((n,r)=>n+r.input.length,0),passed:true};}
function shuffle(values,seed){let x=seed>>>0;const out=[...values];for(let i=out.length-1;i>0;i--){x^=x<<13;x^=x>>>17;x^=x<<5;const j=(x>>>0)%(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}

async function replay(gl,inputs,report){
 for(const workload of inputs.workloads){
  for(const historical of [false,true]){
   const r=rig(gl,historical?{...current,createStandardDesktopResourceStore:current.createStandardPackedDepthResourceStore}:current),live=new Map(),row={workload:workload.name,historical,bootstrap2D:workload.bootstrap2D,operations:[],peak:0,failure:null};report.runs.push(row);
   try{for(const c of workload.calls){const e=c.enter;if(e.resourceId===2)continue;const before=r.store.inspect(),beforeCalls=r.counts().calls;let result;
     if(e.type==='resource_create'){const meta=originalMeta(e);result=r.store.createResource(meta);if(result.ok){need(!live.has(meta.id),'duplicate original ID');live.set(meta.id,result.resource);row.peak=Math.max(row.peak,live.size);}}
     else{result=r.store.unref(e.resourceId);if(result.ok)need(live.delete(e.resourceId),'unref must target actual live original ID');}
     const after=r.store.inspect();row.operations.push({enter:e,returned:c.returned,result,before,after,allocationCallsBefore:beforeCalls,allocationCallsAfter:r.counts().calls});
     same(after.budgets.resources,live.size,'independent original resource count');same(after.budgets.gpuBytes,[...live.values()].reduce((sum,m)=>sum+(m.kind==='staging'?0:m.gpuByteLength??m.byteLength),0),'independent original GPU bytes');same(gl.getError(),0,'original allocation GL errors');
     if(!result.ok){row.failure=row.operations.at(-1);break;}}
    if(historical&&workload.name!=='kmscube'){same(row.failure?.enter.seq,workload.name==='compositor'?454:463,'held original count overflow event');same(row.failure.result.error.message,'Live/retained resource count limit exceeded.','original count error');same(row.failure.allocationCallsAfter,row.failure.allocationCallsBefore,'overflow precedes backend');}
    else if(workload.name==='glmark2-es2'){
     same(row.failure?.enter.seq,3025,'later original depth-format boundary remains explicit');same(row.failure.enter.format,17,'original Z32 format remains unqualified');same(row.failure.result.error.code,'unsupported-resource','no unrelated format admission');same(row.peak,25,'actual original resources beyond the old count bound');same(row.failure.allocationCallsAfter,row.failure.allocationCallsBefore,'unsupported original format precedes allocation');
    }
    else{same(row.failure,null,'all original compositor/kmscube Mesa lifetimes admitted');same(row.peak,workload.expectedPeak,'original peak live count');}
    row.fence=await fence(gl,'replay/'+workload.name+'/'+historical,report);
   }finally{row.counts=r.counts();row.final=r.dispose();}
  }
 }
}

async function limits(gl,report){
 same(current.STANDARD_DESKTOP_RESOURCE_LIMITS,{...current.RESOURCE_LIMITS,resources:64},'selected immutable defaults');need(Object.isFrozen(current.STANDARD_DESKTOP_RESOURCE_LIMITS)&&Object.isFrozen(current.RESOURCE_LIMITS),'defaults immutable');
 report.publicLayout=ok(current.computeStandardPackedDepthTransferLayout(metadata(1),{resourceHandle:1,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:4,height:1,depth:1},dataWords:[0x11223344]},4),'historical public layout keeps its default baseline');
 for(const ceiling of [0,1,16,63,64]){
  const r=rig(gl,current,{resources:ceiling}),row={ceiling,operations:[]};report.runs.push(row);
  try{same(r.store.inspect().limits.resources,ceiling,'tightened ceiling');for(let n=0;n<=ceiling;n++){const before=r.counts(),result=r.store.createResource(metadata(1+n));row.operations.push({input:metadata(1+n),result,before,after:r.counts()});same(result.ok,n<ceiling,'exact tightened count');if(n===ceiling){same(result.error.code,'limit-exceeded','count refusal code');same(r.counts(),before,'count overflow does not call backend');}}}
  finally{row.final=r.dispose();}
 }
 let getters=0;const cases=[['65',{resources:65}],['negative',{resources:-1}],['fractional',{resources:1.5}],['infinite',{resources:Infinity}],['NaN',{resources:NaN}],['unknown',{unknown:64}],['array',new Array(1)],['sparse-value',{resources:new Array(64)}],['accessor',Object.defineProperty({},'resources',{get(){getters++;return 64;},enumerable:true})],['symbol',{[Symbol('resources')]:64}]];
 for(const [name,value]of cases){const {backend}=ok(current.createStandardPackedDepthTransferBackend(gl),'limits backend');const result=current.createStandardDesktopResourceStore({backend,limits:value});report.runs.push({kind:'invalid-limit',name,result});same(result.ok,false,'bad selected limit refused '+name);same(result.error.code,'invalid-input','selected invalid limit error');backend.dispose();}
 same(getters,0,'accessor getter never invoked');report.getters=getters;
 for(const [name,override,input]of [
  ['dimensions',{textureSize:2},{...metadata(1),target:2,format:67,bind:10,width:3,height:2}],
  ['resource-bytes',{resourceBytes:127},metadata(1,128)],
  ['gpu-bytes',{gpuBytes:127},metadata(1,128)],
  ['unchanged-format',{}, {...metadata(1),format:0}],
  ['unchanged-3D',{}, {...metadata(1),target:3}],
  ['unchanged-flags',{}, {...metadata(1),flags:1}],
 ]){const r=rig(gl,current,override);const before=r.counts(),result=r.store.createResource(input);report.runs.push({kind:'inherited-refusal',name,input,result,before,after:r.counts()});same(result.ok,false,name+' remains bounded');same(r.counts(),before,name+' before native allocation');r.dispose();}
 for(const name of ['cpuBytes','gpuBytes','resourceBytes','transferBytes','scratchBytes','contexts','segments','tickets','leases','textureSize']){const {backend}=ok(current.createStandardPackedDepthTransferBackend(gl),'old-budget backend');const result=current.createStandardDesktopResourceStore({backend,limits:{[name]:current.RESOURCE_LIMITS[name]+1}});report.runs.push({kind:'old-ceiling',name,result});same(result.ok,false,'non-count ceiling unchanged '+name);backend.dispose();}
 const fail=rig(gl,current,undefined,true),before=fail.store.inspect(),result=fail.store.createResource(metadata(1));report.runs.push({kind:'allocation-failure',result,before,after:fail.store.inspect(),calls:fail.counts()});same(result.error.code,'backend-error','host failure surfaced');same(fail.store.inspect(),before,'host failure rolls back allocation and identity');same(fail.counts().calls,1,'actual injected backend allocation called');fail.dispose();
 const bounded=rig(gl,current,{contexts:1,cpuBytes:127,tickets:0,leases:0});ok(bounded.store.createResource(metadata(1)),'bounded resource');ok(bounded.store.createContext(1),'bounded context');ok(bounded.store.attachContext(1,1),'bounded attachment');const refusals={context:bounded.store.createContext(2),backing:bounded.store.attachBacking(1,[new Uint8Array(128)]),lease:bounded.store.retainStorage(1,1,'vertex'),ticket:bounded.store.prepareTransfer(1,{opcode:9,fields:{resourceHandle:1,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:4,height:1,depth:1},dataWords:[0x11223344]}})};report.runs.push({kind:'inherited-accounting',refusals,state:bounded.store.inspect()});for(const x of Object.values(refusals))same(x.error.code,'limit-exceeded','inherited budget refusal');bounded.dispose();
 await fence(gl,'limit-boundaries',report);
}

async function historical(gl,report){
 const predecessor=await import('/predecessor/renderer/virgl-command/resources.mjs');
 const names=Object.keys(predecessor).filter(k=>/^create.*ResourceStore$/.test(k));same(names.length,15,'all historical public store factories');
 for(const name of names){const pair=[];
  for(const m of [predecessor,current]){const {backend}=ok(m.createStandardPackedDepthTransferBackend(gl),'historical native backend'),r=ok(m[name]({backend}),'historical factory '+name),out={name,defaults:r.store.inspect(),operations:[]};
   try{for(let i=0;i<17;i++)out.operations.push(r.store.createResource(metadata(i+1)));out.tightenRefusal=m[name]({backend,limits:{resources:17}});out.unknown=m[name]({backend,limits:{unknown:0}});out.invalid=r.store.createResource({...metadata(19),format:0});out.dispose=r.store.dispose();out.final=r.store.inspect();pair.push(out);}
   finally{r.store.dispose();}}
  same(pair[1],pair[0],'authentic predecessor factory output '+name);report.runs.push({kind:'historical',name,predecessor:pair[0],current:pair[1]});
 }
 await fence(gl,'all historical native factories',report);
}

async function lifetime(gl,report,seed,byteFault=false,module=current){
 const r=rig(gl,module),row={kind:'lifetime',seed,operations:[],planes:[],fences:[],fault:byteFault?'bytes':null};report.runs.push(row);const holds=[];
 try{
  ok(r.store.createContext(1),'physical context');
  for(let i=0;i<64;i++){const id=1000+i,input=Array.from({length:128},(_,j)=>(id*17+j*29+(seed>>>8))&255),result=ok(r.store.createResource(metadata(id)),'physical allocation');ok(r.store.attachContext(1,id),'physical attachment');const held=ok(r.store.retainStorage(1,id,'vertex'),'physical native lease'),entry=ok(r.bindings.resolve(held.lease),'resolve physical lease');physical(gl,r,{metadata:entry.metadata,storage:entry.storage},new Uint8Array(input));holds.push({id,input,generation:result.resource.generation,lease:held.lease,entry});}
  row.fences.push(await fence(gl,'baseline64/'+seed,report));
  for(const h of holds)row.planes.push({id:h.id,generation:h.generation,input:h.input,observed:nativeBytes(gl,{metadata:h.entry.metadata,storage:h.entry.storage})});byteOracle(report,row.planes);row.baselinePassed=true;
  const before=r.counts(),overflow=r.store.createResource(metadata(2000));row.overflow={input:metadata(2000),result:overflow,before,after:r.counts(),state:r.store.inspect()};same(overflow.ok,false,'resource65 refused');same(overflow.error.code,'limit-exceeded','resource65 count error');same(r.counts(),before,'resource65 precedes backend');
  if(byteFault){const h=holds[32],corrupt=new Uint8Array(h.input);corrupt[17]^=0x80;physical(gl,r,{metadata:h.entry.metadata,storage:h.entry.storage},corrupt);row.fault={id:h.id,offset:17,xor:128,corrupt:[...corrupt]};row.fences.push(await fence(gl,'physical-byte-corruption/'+seed,report));row.corruptPlanes=holds.map(h=>({id:h.id,input:h.input,observed:nativeBytes(gl,{metadata:h.entry.metadata,storage:h.entry.storage})}));byteOracle(report,row.corruptPlanes);throw new Error('physical corruption escaped independent bytes');}
  const order=shuffle(holds.map(h=>h.id),seed);row.unrefOrder=order;
  const first=holds[order[0]-1000],read=ok(r.asyncAccess.beginStorageRead(first.lease,{x:0,y:0,z:0,width:128,height:1,depth:1}),'native held asynchronous read');row.read={resource:first.id,layout:read.layout,polls:[]};
  for(const id of order)ok(r.store.unref(id),'unref retains exact leased allocation');same(r.store.inspect().budgets.resources,64,'hidden retained resources still count');const hidden=r.store.createResource(metadata(3000));row.hidden={result:hidden,state:r.store.inspect()};same(hidden.ok,false,'retained count cannot be evaded');
  ok(r.store.releaseStorage(first.lease),'release first lease with native read retaining allocation');const still=r.store.createResource(metadata(first.id));row.readRetained={result:still,state:r.store.inspect()};same(still.ok,false,'pending read still counts after lease release');
  for(let n=0;n<1000;n++){const poll=ok(r.asyncAccess.poll(read.ticket,true),'discard poll original native read');row.read.polls.push(poll);if(poll.status==='ready')break;await new Promise(resolve=>setTimeout(resolve,1));}
  same(row.read.polls.at(-1).status,'ready','actual held read completes');ok(r.asyncAccess.release(read.ticket),'cancel completed read releases final native hold');
  const reused=ok(r.store.createResource(metadata(first.id)),'one replacement after final release');need(reused.resource.generation!==first.generation,'reused ID has new generation');row.reused={oldGeneration:first.generation,newResource:reused.resource,state:r.store.inspect()};same(r.store.inspect().budgets.resources,64,'exactly one count slot reclaimed');same(r.store.releaseStorage(first.lease).ok,false,'old token cannot target replacement');
  const second=holds[order[1]-1000],outstanding=ok(r.asyncAccess.beginStorageRead(second.lease,{x:0,y:0,z:0,width:128,height:1,depth:1}),'dispose with real outstanding read');row.outstanding={resource:second.id,layout:outstanding.layout};
  const remaining=holds.filter(h=>h!==first).map(h=>({id:h.id,input:h.input,observed:nativeBytes(gl,{metadata:h.entry.metadata,storage:h.entry.storage})}));row.remaining=remaining;byteOracle(report,remaining);
  row.beforeDispose=r.store.inspect();row.final=r.dispose();row.revokedRelease=r.asyncAccess.release(outstanding.ticket);ok(row.revokedRelease,'disposed native read has one bounded tombstone');same(r.asyncAccess.release(outstanding.ticket).ok,false,'revoked token consumed exactly once');
 }finally{row.nativeCalls=r.counts();row.final=r.dispose();}
}

export async function runAcceptance({mode='replay',seed=0x501bc239}={}){
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});need(gl,'native WebGL2');const ext=gl.getExtension('WEBGL_debug_renderer_info'),report={schema:'original-resource-capacity-native-v1',mode,seed,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionAuthority:false,runs:[],fences:[]};window.__resourceCapacityEvidence=report;
 need(!/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu),'hardware identity');
 if(mode==='replay')await replay(gl,await(await fetch('/inputs.json')).json(),report);
 else if(mode==='limits')await limits(gl,report);
 else if(mode==='historical')await historical(gl,report);
 else if(mode==='lifetime'||mode==='fault-bytes')await lifetime(gl,report,seed,mode==='fault-bytes');
 else if(mode==='fault-count'){await lifetime(gl,report,seed);report.baselinePassed=true;const injected=await import('/fault/renderer/virgl-command/resources.mjs');await lifetime(gl,report,seed,false,injected);}
 else throw new Error('unknown acceptance mode');
 same(gl.getError(),0,'final native GL error');report.status='passed';return report;
}
