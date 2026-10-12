// Independently counted public/native chains and transient allocation neighbors.
import {createStandardDimensionalDepthResourceStore,createStandardDimensionalDepthTransferBackend,computeStandardDimensionalDepthTransferLayout} from '../resources.mjs';
import {decodeStandardDimensionalViewSubmission} from '../decoder.mjs';
import {shapes,formats,pixelBytes,whole,wire} from '../../../tools/virgl-dimensional-depth/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
export function runBudgets({recorded,c}){
 const rows=[],gl=recorded.gl;
 const readPixel={16:4,18:4,20:8,21:4,126:8},conversionPixel={16:6,18:8,20:16,21:8,126:24};
 for(const shape of shapes)for(const format of formats){
  const meta={id:6,target:shape.target,format,bind:9,width:shape.width,height:shape.height,depth:1,arraySize:shape.arraySize,lastLevel:2,nrSamples:0,flags:0};
  const publicCost=(shape.target===4?180:294)*pixelBytes(format),gpuCost=publicCost*(format===126?2:1),pixels=shape.width*shape.height*shape.arraySize,planePixels=shape.width*shape.height;
  const readBytes=pixels*readPixel[format],scratch=pixels*(format===126?16:readPixel[format]),conversion=planePixels*conversionPixel[format],staging=readBytes+conversion,box=whole(shape.levels[0]),fields={resourceHandle:6,level:0,usage:0,stride:0,layerStride:0,box,dataOffset:0,direction:2};
  const exact=c.ok(computeStandardDimensionalDepthTransferLayout(meta,fields,4096),'independent original dimensional depth layout').layout;
  for(const [key,value]of Object.entries({nativeReadBytes:readBytes,scratchBytes:scratch,conversionBytes:conversion,stagingBytes:staging}))c.equal(exact[key],value,'literal layered '+key);
  const ownerFor=limits=>{const backend=c.ok(createStandardDimensionalDepthTransferBackend(gl),'budget backend').backend,owner=c.ok(createStandardDimensionalDepthResourceStore({backend,limits}),'budget owner');recorded.setBudgets(()=>owner.store.inspect().budgets);c.ok(owner.store.createContext(1),'budget context');return owner;};
  for(const [name,limits]of [['resource-native-minus-one',{resourceBytes:gpuCost-1}],['aggregate-native-minus-one',{gpuBytes:gpuCost-1}],['dimension-width-minus-one',{[shape.target===4?'cubeTextureSize':'textureSize']:shape.width-1}],...(shape.target===7?[['array-layer-minus-one',{arrayLayers:shape.arraySize-1}]]:[])]){
   const owner=ownerFor(limits),before=copy(owner.store.inspect()),first=recorded.calls.length,result=owner.store.createResource(meta);c.equal(result.ok,false,name+' refuses');c.same(owner.store.inspect(),before,name+' publishes no state');c.equal(recorded.calls.length,first,name+' refuses before GL');rows.push({name,meta,limits,before,result:copy(result)});c.ok(owner.store.dispose(),'dispose rejected budget owner');recorded.setBudgets(()=>null);c.equal(recorded.live.size,0,'budget reject native objects zero');
  }
  for(const asynchronous of [false,true])for(const delta of [0,-1]){
   const charge=asynchronous?staging:conversion,limits={gpuBytes:gpuCost+charge+delta},owner=ownerFor(limits),store=owner.store;
   c.ok(store.createResource(meta),'exact resource below transient budget');c.ok(store.attachContext(1,6),'budget member');c.ok(store.attachBacking(6,[new Uint8Array(4096)]),'budget backing');
   const command=c.ok(decodeStandardDimensionalViewSubmission(wire(6,0,box,{direction:2})),'budget original command').commands[0],access=asynchronous?owner.asyncAccess:store,prepared=c.ok(access.prepareTransfer(1,command),'budget ticket'),before=copy(store.inspect()),first=recorded.calls.length,result=asynchronous?access.beginTransferRead(prepared.ticket):store.executeTransfer(prepared.ticket);
   c.equal(result.ok,delta===0,'transient native budget '+delta+' result');if(delta===-1)c.equal(recorded.calls.length,first,'transient plus-one refuses before GL');
   if(asynchronous)c.ok(access.release(prepared.ticket),'release budget pending read');c.equal(store.inspect().budgets.gpuBytes,gpuCost,'transient GPU budget restored');c.equal(store.inspect().budgets.scratchBytes,0,'transient scratch restored');rows.push({name:'transient-neighbor',meta,asynchronous,limits,prediction:{publicCost,gpuCost,scratch,conversion,staging},before,result:copy(result),after:copy(store.inspect()),nativeCallsStart:first,nativeCallsEnd:recorded.calls.length});
   c.ok(store.dispose(),'dispose exact budget owner');recorded.setBudgets(()=>null);c.equal(recorded.live.size,0,'transient budget native objects zero');
  }
  for(const [name,limits]of [['scratch-minus-one',{scratchBytes:scratch-1}],['transfer-minus-one',{transferBytes:pixels*pixelBytes(format)-1}]]){
   const result=computeStandardDimensionalDepthTransferLayout(meta,fields,4096,limits);c.equal(result.ok,false,name+' refuses original depth layout');rows.push({name,meta,fields,limits,result:copy(result)});
  }
  for(const [name,limits]of [['cpu-scratch-minus-one',{cpuBytes:4096+scratch-1}],['ticket-limit',{tickets:1}]]){
   const owner=ownerFor(limits),store=owner.store;c.ok(store.createResource(meta),'CPU/ticket allocation');c.ok(store.attachContext(1,6),'CPU/ticket member');c.ok(store.attachBacking(6,[new Uint8Array(4096)]),'CPU/ticket backing');const command=c.ok(decodeStandardDimensionalViewSubmission(wire(6,0,box,{direction:2})),'CPU/ticket original command').commands[0];
   let retained=null;if(name==='ticket-limit')retained=c.ok(owner.asyncAccess.prepareTransfer(1,command),'exact one ticket');const before=copy(store.inspect()),first=recorded.calls.length,result=owner.asyncAccess.prepareTransfer(1,command);c.equal(result.ok,false,name+' refuses');c.same(store.inspect(),before,name+' preserves exact state');c.equal(recorded.calls.length,first,name+' before GL');if(retained)c.ok(owner.asyncAccess.release(retained.ticket),'release exact ticket');rows.push({name,meta,limits,before,result:copy(result)});c.ok(store.dispose(),'dispose CPU/ticket budget');recorded.setBudgets(()=>null);c.equal(recorded.live.size,0,'CPU/ticket native objects zero');
  }
 }
 return rows;
}
