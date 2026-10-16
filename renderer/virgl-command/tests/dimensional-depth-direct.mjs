// Synchronous physical inverse complements the actual Wasm asynchronous proof.
import {createStandardDimensionalDepthResourceStore,createStandardDimensionalDepthTransferBackend,createStandardDimensionalViewResourceStore,createStandardDimensionalViewTransferBackend} from '../resources.mjs';
import {decodeStandardDimensionalViewSubmission} from '../decoder.mjs';
import {shapes,formats,plane,pixelBytes,whole,publicLayout,scatter,hex} from '../../../tools/virgl-dimensional-depth/fixtures.mjs';
import {runFailures} from './dimensional-depth-failures.mjs';
import {runBudgets} from './dimensional-depth-budgets.mjs';
import {runOwnership} from './dimensional-depth-ownership.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:x));
export async function runDirect({recorded,c,seed,assertPublic,assertBacking}){
 const rows=[],boundaries=[];
 const legacy=c.ok(createStandardDimensionalViewTransferBackend(recorded.gl),'historical native backend').backend;
 c.equal(createStandardDimensionalDepthResourceStore({backend:legacy}).ok,false,'new depth owner requires selected backend');legacy.dispose();
 c.equal(recorded.live.size,0,'historical qualification helpers retired');
 const directShapes=[...shapes,{name:'qualified-2D-control',target:2,width:5,height:3,depth:1,arraySize:1,lastLevel:2,levels:[[5,3,1],[2,1,1],[1,1,1]]}];
 for(const shape of directShapes)for(const fmt of formats){
  const backend=c.ok(createStandardDimensionalDepthTransferBackend(recorded.gl),'direct selected native backend').backend;
  const owner=c.ok(createStandardDimensionalDepthResourceStore({backend}),'direct selected depth owner'),store=owner.store;
  recorded.setBudgets(()=>store.inspect().budgets);c.ok(store.createContext(1),'direct original context');
  const meta={id:100,target:shape.target,format:fmt,bind:9,width:shape.width,height:shape.height,depth:1,arraySize:shape.arraySize,lastLevel:2,nrSamples:0,flags:0};
  const created=c.ok(store.createResource(meta),'direct original depth allocation');c.ok(store.attachContext(1,meta.id),'direct original membership');
  const a=new Uint8Array(31).fill(0xa3),b=new Uint8Array(4096-17+23).fill(0xa3),views=[a.subarray(7,24),b.subarray(9,9+4096-17)];
  c.ok(store.attachBacking(meta.id,views),'direct split SG');
  const row={metadata:meta,created:copy(created),planes:[],nativeCallsStart:recorded.calls.length};rows.push(row);
  for(let level=0;level<shape.levels.length;level++){
   const extent=shape.levels[level],box=whole(extent),size=pixelBytes(fmt),fields={offset:5,stride:extent[0]*size+7,layerStride:(extent[0]*size+7)*extent[1]+11},layout=publicLayout(extent,box,fmt,fields);
   const input=plane(seed,fmt,shape.target,level,extent,37),source=scatter(input,box,layout,new Uint8Array(4096).fill(0x8d));c.ok(store.writeBacking(meta.id,0,source),'direct post-attach original source');
   const words=[(13<<16)|43,meta.id,level,0,fields.stride,fields.layerStride,0,0,0,...extent,fields.offset,1],raw=new Uint8Array(words.length*4),v=new DataView(raw.buffer);words.forEach((word,i)=>v.setUint32(i*4,word,true));
   const command=c.ok(decodeStandardDimensionalViewSubmission(raw),'direct original wire').commands[0];
   const uploaded=c.ok(store.prepareTransfer(1,command),'direct upload ticket');c.ok(store.executeTransfer(uploaded.ticket),'direct physical upload');
   v.setUint32(raw.length-4,2,true);const inverse=c.ok(decodeStandardDimensionalViewSubmission(raw),'direct inverse wire').commands[0],sentinel=new Uint8Array(4096).fill(0xc7);c.ok(store.writeBacking(meta.id,0,sentinel),'direct poison source');
   const prepared=c.ok(store.prepareTransfer(1,inverse),'direct inverse ticket'),start=recorded.calls.length;c.ok(store.executeTransfer(prepared.ticket),'direct synchronous GPU conversion');
   const output=c.ok(store.readBacking(meta.id,0,4096),'direct complete output').bytes;assertBacking(c,fmt,input,output,sentinel,box,layout,'direct sync original fields');
   row.planes.push({level,extent,fields,layout,input:hex(input),source:hex(source),wire:hex(raw),prepared:copy(prepared),output:hex(output),nativeCallsStart:start,nativeCallsEnd:recorded.calls.length,budgets:copy(store.inspect().budgets)});
   c.equal(store.inspect().budgets.scratchBytes,0,'direct CPU conversion retired');
  }
  for(const [name,mutate]of [['depth-volume',{target:3,arraySize:1,depth:6}],['unknown-depth-format',{format:19}],['color-depth-role',{bind:10}],['depth-hint',{bind:9|(1<<18)}],['high-mip',{lastLevel:0xffffffff}],['multisample',{nrSamples:1}],['flags',{flags:1}],['zero-layer',{arraySize:0}],['non-unit-depth',{depth:2}],...(shape.target===4?[['incomplete-cube',{arraySize:5}],['non-square-cube',{width:6}]]:[])]){
   const bad={...meta,id:200,...mutate},before=copy(store.inspect()),start=recorded.calls.length,result=store.createResource(bad);c.equal(result.ok,false,'direct '+name+' refuses');c.same(store.inspect(),before,'direct '+name+' no state mutation');c.equal(recorded.calls.length,start,'direct '+name+' no GL calls');boundaries.push({name,metadata:bad,before,result:copy(result),nativeCallsEnd:start});
  }
  if(shape.target!==2){
   const view=store.retainStorage(1,meta.id,'view');c.equal(view.ok,false,'unqualified dimensional depth view stays closed');boundaries.push({name:'depth-view-closed',metadata:meta,result:copy(view)});
   const historicalBackend=c.ok(createStandardDimensionalViewTransferBackend(recorded.gl),'independent historical native backend').backend;
   const historical=c.ok(createStandardDimensionalViewResourceStore({backend:historicalBackend}),'historical selected store');c.equal(historical.store.createResource(meta).ok,false,'historical dimensional owner refuses depth');c.ok(historical.store.dispose(),'dispose independent historical store');
  }
  c.ok(store.dispose(),'direct exact owner disposal');recorded.setBudgets(()=>null);c.equal(recorded.live.size,0,'direct native owners retired');c.equal(recorded.gl.getError(),recorded.gl.NO_ERROR,'direct terminal native error');
  row.final=copy(store.inspect());row.nativeCallsEnd=recorded.calls.length;
  c.equal(hex(a.subarray(0,7)),'a3'.repeat(7),'direct prefix guard');c.equal(hex(a.subarray(24)),'a3'.repeat(7),'direct suffix guard');c.equal(hex(b.subarray(0,9)),'a3'.repeat(9),'direct second prefix');c.equal(hex(b.subarray(9+4096-17)),'a3'.repeat(14),'direct second suffix');
 }
 return{rows,boundaries,...runFailures({recorded,c,seed,assertPublic}),budgets:runBudgets({recorded,c}),ownership:runOwnership({recorded,c})};
}
