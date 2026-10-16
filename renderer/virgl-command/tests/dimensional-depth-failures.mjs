// Faults mutate one real driver argument, never replace successful image bytes.
import {createStandardDimensionalDepthResourceStore,createStandardDimensionalDepthTransferBackend} from '../resources.mjs';
import {decodeStandardDimensionalViewSubmission} from '../decoder.mjs';
import {shapes,formats,plane,whole,wire,hex} from '../../../tools/virgl-dimensional-depth/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:x));
const decode=raw=>{const result=decodeStandardDimensionalViewSubmission(raw);if(!result.ok)throw Error(result.error.message);return result.commands[0];};
export function runFailures({recorded,c,seed,assertPublic}){
 const faults=[],lifetimes=[],gl=recorded.gl;
 for(const shape of shapes)for(const format of formats){
  const backend=c.ok(createStandardDimensionalDepthTransferBackend(gl),'failure selected backend').backend;
  const owner=c.ok(createStandardDimensionalDepthResourceStore({backend}),'failure selected owner'),store=owner.store;
  recorded.setBudgets(()=>store.inspect().budgets);c.ok(store.createContext(1),'failure context');
  const meta={id:6,target:shape.target,format,bind:9,width:shape.width,height:shape.height,depth:1,arraySize:shape.arraySize,lastLevel:2,nrSamples:0,flags:0};
  const failAllocation=(name,fault)=>{
   const before=copy(store.inspect()),objects=recorded.live.size,start=recorded.calls.length;recorded.arm(fault);
   const result=store.createResource(meta);recorded.assertConsumed(c);c.equal(result.ok,false,name+' fails at driver');
   c.same(store.inspect(),before,name+' has no published owner');c.equal(recorded.live.size,objects,name+' deletes partial allocation');c.equal(gl.getError(),gl.NO_ERROR,name+' consumes native error');
   faults.push({name,metadata:meta,before,result:copy(result),after:copy(store.inspect()),nativeCallsStart:start,nativeCallsEnd:recorded.calls.length});
  };
  failAllocation('immutable-depth-allocation',{method:shape.target===4?'texStorage2D':'texStorage3D',index:3,value:0});
  if(format===126)failAllocation('owned-depth-upload-PBO',{method:'bufferData',index:1,value:-1});
  c.ok(store.createResource(meta),'healthy allocation after driver failure');c.ok(store.attachContext(1,6),'failure membership');c.ok(store.attachBacking(6,[new Uint8Array(4096)]),'failure backing');
  const box=whole(shape.levels[0]),input=plane(seed,format,shape.target,0,shape.levels[0],57),upload=decode(wire(6,0,box)),read=decode(wire(6,0,box,{direction:2}));
  c.ok(store.writeBacking(6,0,input),'failure input');
  const t=c.ok(store.prepareTransfer(1,upload),'driver upload ticket'),start=recorded.calls.length;
  recorded.arm({method:shape.target===4?'texSubImage2D':'texSubImage3D',index:1,value:99});const badUpload=store.executeTransfer(t.ticket);recorded.assertConsumed(c);
  c.equal(badUpload.ok,false,'invalid native mip upload fails');c.equal(store.inspect().budgets.tickets,0,'failed upload retires ticket');c.equal(store.inspect().budgets.scratchBytes,0,'failed upload releases CPU scratch');c.equal(gl.getError(),gl.NO_ERROR,'failed upload consumes driver error');
  faults.push({name:'native-upload-level',metadata:meta,result:copy(badUpload),after:copy(store.inspect()),nativeCallsStart:start,nativeCallsEnd:recorded.calls.length});
  c.ok(store.executeTransfer(c.ok(store.prepareTransfer(1,upload),'healthy upload ticket').ticket),'healthy upload');
  // Prime cached packer programs before comparing transient object ownership.
  c.ok(store.executeTransfer(c.ok(store.prepareTransfer(1,read),'prime conversion ticket').ticket),'prime physical inverse');
  for(const asynchronous of [false,true])for(const [name,fault]of [
   ['conversion-stage',{method:'texStorage2D',index:3,value:0}],
   ['conversion-packer',{method:'texStorage2D',index:3,value:0,skip:1}],
   ['source-layer-attachment',{method:shape.target===4?'framebufferTexture2D':'framebufferTextureLayer',index:shape.target===4?4:3,value:99}],
   ...(asynchronous?[['readback-PBO',{method:'bufferData',index:1,value:-1}]]:[]),
  ]){
   const access=asynchronous?owner.asyncAccess:store,prepared=c.ok(access.prepareTransfer(1,read),'fault inverse ticket'),before=copy(store.inspect()),objects=recorded.live.size,first=recorded.calls.length;
   recorded.arm(fault);const result=asynchronous?access.beginTransferRead(prepared.ticket):store.executeTransfer(prepared.ticket);recorded.assertConsumed(c);c.equal(result.ok,false,name+' physical inverse fails');
   if(asynchronous)c.ok(access.release(prepared.ticket),'failed asynchronous inverse release');
   c.equal(recorded.live.size,objects,name+' deletes all partial native conversion objects');c.equal(store.inspect().budgets.gpuBytes,before.budgets.gpuBytes,name+' GPU budget restored');c.equal(store.inspect().budgets.scratchBytes,0,name+' scratch released');c.equal(store.inspect().budgets.tickets,0,name+' ticket released');
   const errors=[];for(let error=gl.getError();error!==gl.NO_ERROR;error=gl.getError())errors.push(error);c.same(errors,name==='source-layer-attachment'?[gl.INVALID_VALUE]:[],name+' records the original driver fault');
   faults.push({name,asynchronous,metadata:meta,before,result:copy(result),errors,after:copy(store.inspect()),nativeCallsStart:first,nativeCallsEnd:recorded.calls.length});
  }
  const lease=c.ok(store.retainStorage(1,6,'readback'),'retain exact depth allocation').lease,generation=store.inspect().resources[0].generation;
  // Revoke backing and membership while a physical layered read is pending.
  for(const revoke of ['backing','context']){
   const entry=c.ok(owner.asyncAccess.prepareTransfer(1,read),'pending revoked read');c.ok(owner.asyncAccess.beginTransferRead(entry.ticket),'physical pending revoked read');
   const before=copy(store.inspect()),first=recorded.calls.length;
   c.ok(revoke==='backing'?store.detachBacking(6):store.detachContext(1,6),'revoke '+revoke);
   c.equal(owner.asyncAccess.validate(entry.ticket).ok,false,'revoked '+revoke+' invalidates pending DMA');c.equal(owner.asyncAccess.poll(entry.ticket).ok,false,'revoked '+revoke+' never collects');c.ok(owner.asyncAccess.release(entry.ticket),'release revoked read');
   if(revoke==='backing')c.ok(store.attachBacking(6,[new Uint8Array(4096)]),'replacement backing');else c.ok(store.attachContext(1,6),'replacement membership');
   c.equal(store.inspect().budgets.gpuBytes,before.budgets.gpuBytes-entry.layout.stagingBytes,'revocation frees layered staging');
   lifetimes.push({name:'pending-'+revoke,metadata:meta,before,after:copy(store.inspect()),nativeCallsStart:first,nativeCallsEnd:recorded.calls.length});
  }
  c.ok(store.unref(6),'retire old public depth ID');
  const replacement={...meta,format:format===126?16:126};c.ok(store.createResource(replacement),'reuse ID with unequal depth format');c.ok(store.attachContext(1,6),'replacement member');c.ok(store.attachBacking(6,[new Uint8Array(4096)]),'replacement RAM');
  c.truth(store.inspect().resources.find(v=>v.public).generation!==generation,'ID reuse has new allocation generation');
  const retained=c.ok(store.readStorage(lease,box),'old retained physical depth inverse');
  c.equal(retained.bytes.length,input.length,'retained format preserves original public stride');
  assertPublic(c,format,input,retained.bytes,'retained allocation survives unequal-format ID reuse');
  c.ok(store.releaseStorage(lease),'release old physical allocation');
  const replacementRead=decode(wire(6,0,box,{direction:2})),a=c.ok(owner.asyncAccess.prepareTransfer(1,replacementRead),'pending disposal transfer');c.ok(owner.asyncAccess.beginTransferRead(a.ticket),'pending disposal real fence');
  const newLease=c.ok(store.retainStorage(1,6,'readback'),'pending disposal storage lease').lease,b=c.ok(owner.asyncAccess.beginStorageRead(newLease,box),'pending retained real fence');
  const before=copy(store.inspect());c.ok(store.dispose(),'dispose pending transfers and retained storage');
  c.ok(owner.asyncAccess.release(a.ticket),'disposed transfer releases once');c.ok(owner.asyncAccess.release(b.ticket),'disposed retained read releases once');c.equal(owner.asyncAccess.release(a.ticket).ok,false,'disposed token cannot replay');
  const after=copy(store.inspect());for(const key of ['gpuBytes','scratchBytes','resources','leases','tickets','backingBytes'])c.equal(after.budgets[key],0,'disposed '+key+' zero');
  recorded.setBudgets(()=>null);c.equal(recorded.live.size,0,'all failure/lifetime native objects retired');c.equal(gl.getError(),gl.NO_ERROR,'terminal failure native error');lifetimes.push({name:'pending-dispose',metadata:replacement,before,after});
 }
 return{faults,lifetimes};
}
