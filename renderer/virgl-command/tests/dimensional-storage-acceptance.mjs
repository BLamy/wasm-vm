import {
 createStandardDimensionalTransferBackend,createStandardDimensionalResourceStore,
 createStandardDesktopResourceStore,createResourceStore,createStandardPackedDepthTransferBackend,
 computeStandardDimensionalTransferLayout
} from '../resources.mjs';
import {decodeStandardDimensionalSubmission,decodeStandardShadowSamplerSubmission} from '../decoder.mjs';
import * as decoders from '../decoder.mjs';
import {checker} from './submit-acceptance.mjs';
import {shapes,hex,copy,random,plane,patch,whole,publicLayout,scatter,wire} from '../../../tools/virgl-dimensional-storage/fixtures.mjs';

export async function runDimensionalStorageAcceptance({seeds=[14241,33485,58393]}={}) {
 const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
 c.truth(gl,'actual hardware WebGL2');
 const nativeCalls=[],ids=new WeakMap(),live=new Map(),runs=[],boundaries=[],faults=[];let next=1,armed=null;
 const describe=value=>{
  if(value===null||typeof value!=='object')return value===undefined?{undefined:true}:value;
  if(ArrayBuffer.isView(value))return{type:value.constructor.name,bytes:hex(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
  if(!ids.has(value))ids.set(value,next++);return{object:ids.get(value),type:value.constructor?.name??'object'};
 };
 const gpu=new Proxy(gl,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
  const requested=args.map(describe),effective=[...args];
  if(armed?.method===key&&armed.count>0){effective[armed.index]=armed.value;armed.count--;}
  const before=effective.map(describe),result=value.apply(target,effective);
  if((key.startsWith('create')||key==='fenceSync')&&result)live.set(result,key==='fenceSync'?'Sync':key.slice(6));if(key.startsWith('delete'))live.delete(effective[0]);
  nativeCalls.push({sequence:nativeCalls.length,name:key,requested,before,after:effective.map(describe),result:describe(result)});return result;
 };}});
 window.__desktopProof={runs,boundaries,faults,nativeCalls,seeds};
 const meta=(shape,id=100)=>{const{levels,...rest}=shape;return{id,format:67,bind:10,nrSamples:0,flags:0,...rest};};
 const make=(limits={})=>{
  const backend=c.ok(createStandardDimensionalTransferBackend(gpu),'selected hardware backend').backend;
  const owner=c.ok(createStandardDimensionalResourceStore({backend,limits}),'selected dimensional store');
  c.ok(owner.store.createContext(1),'context');
  return owner;
 };
 const decode=bytes=>c.ok(decodeStandardDimensionalSubmission(bytes),'literal original transfer packet').commands[0];
 const point=(name,input,owner)=>({name,input:copy(input),state:copy(owner.store.inspect()),nativeCallsEnd:nativeCalls.length});
 const refuse=(name,input,owner,operation)=>{
  const before=point(name,input,owner),calls=nativeCalls.length,result=operation();
  c.equal(result.ok,false,name+' refused');c.same(owner.store.inspect(),before.state,name+' no ownership publication');
  c.equal(nativeCalls.length,calls,name+' no native operation');boundaries.push({...before,result:copy(result),after:copy(owner.store.inspect())});
 };
 const errors=()=>{const values=[];for(let i=0;i<32;i++){const value=gpu.getError();if(value===gl.NO_ERROR)return values;values.push(value);}throw new Error('unbounded native error queue');};
 const backing=(owner,id,length=8192)=>{
  const a=new Uint8Array(17+13).fill(0xa3),b=new Uint8Array(length-17+19).fill(0xa3);
  c.ok(owner.store.attachBacking(id,[a.subarray(7,24),b.subarray(9,9+length-17)]),'split original SG');
  return{physical:[a,b],views:[a.subarray(7,24),b.subarray(9,9+length-17)]};
 };
 const dispose=owner=>{c.ok(owner.store.dispose(),'dispose exact owner');c.equal(live.size,0,'all actual native objects retired');c.equal(gl.getError(),gl.NO_ERROR,'final GPU error zero');};
 const read=async(owner,m,level,dims,expected,schedule,label,options={})=>{
  const box=whole(dims),stride=options.stride??dims[0]*4+7,layerStride=options.layerStride??stride*dims[1]+11,offset=5;
  const layout=publicLayout(dims,box,{offset,stride,layerStride}),sentinel=new Uint8Array(8192).fill(0xc7);
  c.ok(owner.store.writeBacking(m.id,0,sentinel),label+' poison backing');
  const raw=wire(m.id,level,box,{stride,layerStride,offset,direction:2}),command=decode(raw);
  const prepared=c.ok(owner.store.prepareTransfer(1,command),label+' prepare synchronous inverse');
  c.equal(prepared.layout.requiredEnd,layout.requiredEnd,label+' literal exact end');
  c.ok(owner.store.executeTransfer(prepared.ticket),label+' real native synchronous inverse');
  const inverse=c.ok(owner.store.readBacking(m.id,0,sentinel.length),label+' full SG inverse').bytes;
  c.same(hex(inverse),hex(scatter(expected,box,layout,sentinel)),label+' all public rows, layers and padding');
  const pending=c.ok(owner.asyncAccess.prepareTransfer(1,command),label+' prepare fenced inverse');
  c.ok(owner.asyncAccess.beginTransferRead(pending.ticket),label+' actual PBO and fence');
  let result,polls=0,turns=0;for(;polls<1000;polls++){
   const delay=schedule()%3;for(let task=0;task<=delay;task++){await new Promise(r=>setTimeout(r,0));turns++;}
   result=c.ok(owner.asyncAccess.poll(pending.ticket),label+' physical fence poll');if(result.status==='ready')break;
  }
  c.equal(result.status,'ready',label+' bounded native completion');
  window.__desktopActive=()=>({label,metadata:m,level,box,layout,expected:hex(expected),actual:hex(result.bytes),nativeCallsEnd:nativeCalls.length});
  c.same(hex(result.bytes),hex(expected),label+' every physical PBO output byte');
  c.same(hex(c.ok(owner.store.readBacking(m.id,0,sentinel.length),label+' fenced read preserves SG').bytes),hex(inverse),label+' staged read does not publish guest backing');
  c.ok(owner.asyncAccess.release(pending.ticket),label+' retire PBO/fence');
  const observation={label,metadata:m,level,dimensions:dims,wire:hex(raw),layout:copy(prepared.layout),literalLayout:layout,
   expected:hex(expected),actual:hex(result.bytes),backing:hex(inverse),sentinel:hex(sentinel),polls:polls+1,turns,state:copy(owner.store.inspect()),nativeCallsEnd:nativeCalls.length};
  window.__desktopActive=null;return observation;
 };
 for(const seed of seeds)for(const [tag,shape]of shapes.entries()){
  const nativeCallsStart=nativeCalls.length,m=meta(shape,100+tag),owner=make(),{store,asyncAccess,bindings}=owner,rng=random(seed),observations=[];
  const created=c.ok(store.createResource(m),'original dimensional allocation').resource;c.ok(store.attachContext(1,m.id),'original membership');
  c.same(created.levels.map(l=>[l.width,l.height,l.layers]),shape.levels,'literal NPOT dimensional mip table');
  const cost=shape.levels.reduce((n,[w,h,d])=>n+w*h*d*4,0);c.equal(created.byteLength,cost,'complete literal public cost');c.equal(created.gpuByteLength,cost,'complete literal native cost');
  const sg=backing(owner,m.id),initialGuards=sg.physical.map(hex),oldLease=c.ok(store.retainStorage(1,m.id,'readback'),'trusted retained readback allocation').lease;
  const storage=c.ok(bindings.resolve(oldLease),'original native dimensional identity').storage;
  const nativeStorage={texture:describe(storage.texture),target:storage.target};
  c.equal(store.retainStorage(1,m.id,'view').ok,false,'dimensional owner cannot enter old sampler views');
  c.equal(store.retainStorage(1,m.id,'surface').ok,false,'dimensional owner cannot enter old surfaces');
  const stagingId=200+tag;c.ok(store.createResource({id:stagingId,target:0,format:64,bind:524288,width:8192,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'original staging owner');c.ok(store.attachContext(1,stagingId),'staging membership');backing(owner,stagingId);
  const expectedPlanes=[];
  for(let level=0;level<shape.levels.length;level++){
   const dims=shape.levels[level],box=whole(dims),stride=dims[0]*4+7,layerStride=stride*dims[1]+11,offset=5;
   let expected=plane(seed,tag,level,dims),layout=publicLayout(dims,box,{offset,stride,layerStride});
   const source=scatter(expected,box,layout,new Uint8Array(8192).fill(0x97));c.ok(store.writeBacking(m.id,0,source),'dirty SG bytes after attachment');
   const raw=wire(m.id,level,box,{stride,layerStride,offset}),prepared=c.ok(store.prepareTransfer(1,decode(raw)),'prepare original layered upload');
   c.equal(prepared.layout.footprintBytes,layout.footprintBytes,'independent original layer span');c.ok(store.executeTransfer(prepared.ticket),'actual original layered upload');
   observations.push({kind:'upload',metadata:m,level,dimensions:dims,wire:hex(raw),source:hex(source),expected:hex(expected),layout:copy(prepared.layout),literalLayout:layout,nativeCallsEnd:nativeCalls.length});
   observations.push(await read(owner,m,level,dims,expected,rng,'full initial inverse'));
   const small={x:dims[0]>1?1:0,y:dims[1]>1?1:0,z:dims[2]>1?1:0,width:Math.min(2,dims[0]-(dims[0]>1?1:0)),height:1,depth:Math.min(2,dims[2]-(dims[2]>1?1:0))};
   const tight=plane(seed^0x5973,tag+7,level,[small.width,small.height,small.depth]),row=small.width*4+3,layer=row*small.height+5;
   const inlineLayout=publicLayout(dims,small,{offset:0,stride:row,layerStride:layer});
   const inlineBytes=scatter(tight,small,inlineLayout,new Uint8Array(inlineLayout.requiredEnd).fill(0x59));
   const inlineWire=wire(m.id,level,small,{opcode:9,stride:row,layerStride:layer,data:inlineBytes});
   const inline=c.ok(store.prepareTransfer(1,decode(inlineWire)),'prepare original inline partial write');c.ok(store.executeTransfer(inline.ticket),'real layered inline write');expected=patch(expected,dims,small,tight);
   observations.push({kind:'inline',metadata:m,level,dimensions:dims,box:small,wire:hex(inlineWire),source:hex(inlineBytes),tight:hex(tight),expected:hex(expected),layout:copy(inline.layout),nativeCallsEnd:nativeCalls.length});
   observations.push(await read(owner,m,level,dims,expected,rng,'full partial inline inverse'));
   const copyTight=plane(seed^0x31c7,tag+11,level,[small.width,small.height,small.depth]),copyLayout=publicLayout(dims,small,{offset:9,stride:row,layerStride:layer});
   const copyBytes=scatter(copyTight,small,copyLayout,new Uint8Array(8192).fill(0x83));c.ok(store.writeBacking(stagingId,0,copyBytes),'dirty staging SG');
   const copyWire=wire(m.id,level,small,{opcode:45,stagingId,offset:9,stride:row,layerStride:layer,flags:1});
   const upload=c.ok(store.prepareTransfer(1,decode(copyWire)),'prepare original staging upload');c.ok(store.executeTransfer(upload.ticket),'native layered copy upload');expected=patch(expected,dims,small,copyTight);
   const copySentinel=new Uint8Array(8192).fill(0xbd);c.ok(store.writeBacking(stagingId,0,copySentinel),'poison original copy destination');
   const inverseWire=wire(m.id,level,small,{opcode:45,stagingId,offset:9,stride:row,layerStride:layer,flags:3});
   const inverse=c.ok(store.prepareTransfer(1,decode(inverseWire)),'prepare original synchronized copy inverse');c.ok(store.executeTransfer(inverse.ticket),'native original copy inverse');
   const inverseBytes=c.ok(store.readBacking(stagingId,0,8192),'complete original copy inverse').bytes;c.same(hex(inverseBytes),hex(scatter(copyTight,small,copyLayout,copySentinel)),'all copy destination rows and padding');
   observations.push({kind:'copy',metadata:m,level,dimensions:dims,box:small,wire:hex(copyWire),inverseWire:hex(inverseWire),source:hex(copyBytes),tight:hex(copyTight),sentinel:hex(copySentinel),actualBacking:hex(inverseBytes),literalLayout:copyLayout,expected:hex(expected),nativeCallsEnd:nativeCalls.length});
   observations.push(await read(owner,m,level,dims,expected,rng,'full partial copy inverse'));
   const asyncTight=plane(seed^0x7549,tag+19,level,[small.width,small.height,small.depth]);
   const asyncWire=wire(m.id,level,small,{stride:row,layerStride:layer,offset:9});
   const deferred=c.ok(asyncAccess.prepareTransfer(1,decode(asyncWire)),'original deferred layered upload');
   c.ok(asyncAccess.provideInput(deferred.ticket,asyncTight),'exact dense original input for deferred upload');
   c.ok(asyncAccess.upload(deferred.ticket),'physical deferred layered upload');c.ok(asyncAccess.release(deferred.ticket),'release deferred input');
   expected=patch(expected,dims,small,asyncTight);
   observations.push({kind:'async-upload',metadata:m,level,dimensions:dims,box:small,wire:hex(asyncWire),tight:hex(asyncTight),expected:hex(expected),layout:copy(deferred.layout),nativeCallsEnd:nativeCalls.length});
   observations.push(await read(owner,m,level,dims,expected,rng,'full deferred upload inverse'));
   const allocation=c.ok(bindings.resolve(oldLease),'exact trusted native allocation').storage,fb=gpu.createFramebuffer();c.truth(fb,'GPU-only overwrite framebuffer');
   const colors=[];gpu.bindFramebuffer(gl.DRAW_FRAMEBUFFER,fb);gpu.drawBuffers([gl.COLOR_ATTACHMENT0]);gpu.disable(gl.SCISSOR_TEST);gpu.colorMask(true,true,true,true);
   try{
    for(let z=0;z<dims[2];z++){
     if(m.target===4)gpu.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X+z,allocation.texture,level);
     else gpu.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,allocation.texture,level,z);
     c.equal(gpu.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'real dimensional overwrite attachment');
     const color=[(19+z*13)&255,(47+level*23)&255,(91+tag*17)&255,255];colors.push(color);
     gpu.clearBufferfv(gl.COLOR,0,new Float32Array(color.map(v=>v/255)));
     for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++)expected.set(color,((z*dims[1]+y)*dims[0]+x)*4);
    }
   }finally{gpu.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gpu.deleteFramebuffer(fb);}
   c.equal(gpu.getError(),gl.NO_ERROR,'GPU-only overwrite succeeded');
   observations.push({kind:'gpu-only',metadata:m,level,dimensions:dims,colors,expected:hex(expected),nativeCallsEnd:nativeCalls.length});
   observations.push(await read(owner,m,level,dims,expected,rng,'full GPU-only inverse',{stride:0,layerStride:0}));expectedPlanes.push(expected);
  }
  c.same(sg.physical.map(hex),initialGuards,'external SG views and surrounding guards remain unchanged');
  const pending=c.ok(asyncAccess.prepareTransfer(1,decode(wire(m.id,0,whole(shape.levels[0]),{direction:2}))), 'pending layered transfer');
  c.ok(asyncAccess.beginTransferRead(pending.ticket),'pending real native PBO');c.ok(store.detachBacking(m.id),'revoke original backing');
  c.equal(asyncAccess.poll(pending.ticket).ok,false,'stale backing cannot publish old PBO bytes');
  let discarded;for(let i=0;i<1000;i++){await new Promise(r=>setTimeout(r,0));discarded=c.ok(asyncAccess.poll(pending.ticket,true),'physical stale read discard');if(discarded.status==='ready')break;}
  c.equal(discarded.status,'ready','stale native fence physically retires');c.ok(asyncAccess.release(pending.ticket),'release stale original transfer');backing(owner,m.id);
  for(const revoke of ['attachment','context']){
   const raw=wire(m.id,0,whole(shape.levels[0]),{direction:2}),ticket=c.ok(asyncAccess.prepareTransfer(1,decode(raw)),'pending '+revoke+' read');
   c.ok(asyncAccess.beginTransferRead(ticket.ticket),'physical pending '+revoke+' read');const before=copy(store.inspect());
   if(revoke==='attachment'){c.ok(store.detachContext(1,m.id),'revoke member');c.ok(store.attachContext(1,m.id),'replacement member');}
   else{c.ok(store.destroyContext(1),'revoke context');c.ok(store.createContext(1),'reuse context ID');c.ok(store.attachContext(1,m.id),'new image member');c.ok(store.attachContext(1,stagingId),'new staging member');}
   c.equal(asyncAccess.validate(ticket.ticket).ok,false,'reused '+revoke+' cannot validate old work');
   c.equal(asyncAccess.poll(ticket.ticket).ok,false,'reused '+revoke+' cannot publish old work');c.ok(asyncAccess.release(ticket.ticket),'cancel revoked '+revoke+' native work');
   observations.push({kind:'revocation',revoke,wire:hex(raw),before,after:copy(store.inspect()),nativeCallsEnd:nativeCalls.length});
  }
  const beforeReuse=copy(store.inspect());c.ok(store.unref(m.id),'remove public old allocation');const replacement=c.ok(store.createResource(m),'same numeric ID replacement').resource;
  c.truth(replacement.generation!==created.generation,'numeric ID reuse has a distinct generation');
  c.equal(store.inspect().budgets.gpuBytes,cost*2,'old retained and new storage charged together');
  const retained=c.ok(store.readStorage(oldLease,whole(shape.levels[0])),'actual retained old dimensional plane').bytes;c.same(hex(retained),hex(expectedPlanes[0]),'all retained old GPU bytes');
  c.ok(store.releaseStorage(oldLease),'retire old allocation');c.equal(store.inspect().budgets.gpuBytes,cost,'old exact storage charge released');
  c.ok(store.attachContext(1,m.id),'replacement membership');backing(owner,m.id);
  const zero=c.ok(store.retainStorage(1,m.id,'readback'),'replacement trusted readback lease').lease;
  c.same(hex(c.ok(store.readStorage(zero,whole(shape.levels[0])),'fresh native replacement storage').bytes),hex(new Uint8Array(shape.levels[0].reduce((n,v)=>n*v,4))),'fresh native allocation is independently zero');
  c.ok(store.releaseStorage(zero),'release replacement readback lease');c.ok(store.unref(m.id),'remove replacement');c.ok(store.unref(stagingId),'remove original staging');c.ok(store.destroyContext(1),'destroy context');
  const final=copy(store.inspect());c.equal(final.budgets.gpuBytes,0,'terminal GPU budget zero');c.equal(final.budgets.backingBytes,0,'terminal backing budget zero');c.equal(final.budgets.scratchBytes,0,'terminal scratch zero');c.equal(final.budgets.tickets,0,'terminal tickets zero');
  runs.push({seed,metadata:m,literalLevels:shape.levels,cost,observations,beforeReuse,retained:hex(retained),initialGuards,actualGuards:sg.physical.map(hex),nativeStorage,nativeCallsStart,nativeCallsEnd:nativeCalls.length,final});dispose(owner);
 }
 // Creation words, independent whole-chain costs, measured dimension neighbors.
 for(const shape of shapes){
  const owner=make(),m=meta(shape),cost=shape.target===3?448:shape.target===4?720:504;
  for(const bind of [2,8,10])for(const hint of [0,262144,1048576,1310720]){
   const input={...m,bind:bind|hint},begin=nativeCalls.length,created=c.ok(owner.store.createResource(input),'original role and creation hint').resource;
   c.equal(created.byteLength,cost,'literal complete hinted mip cost');c.truth(Object.isFrozen(created)&&Object.isFrozen(created.levels)&&created.levels.every(Object.isFrozen),'immutable original dimensional metadata');
   boundaries.push({name:'role-hint',input,resource:copy(created),nativeCallsStart:begin,nativeCallsEnd:nativeCalls.length});c.ok(owner.store.unref(m.id),'retire hinted allocation');
  }
  const mutations=[['format',{format:64}],['format-other-image',{format:1}],['zero-role',{bind:0}],['vertex-role',{bind:16}],['mixed-role',{bind:11}],['unknown-hint',{bind:10|2097152}],['samples',{nrSamples:2}],['flags',{flags:1}],['high-mip',{lastLevel:0xffffffff}],['impossible-mip',{lastLevel:3}],['zero-width',{width:0}],['fractional-height',{height:1.5}]];
  if(shape.target===3)mutations.push(['volume-array',{arraySize:2}]);
  if(shape.target===4)mutations.push(['cube-depth',{depth:2}],['cube-faces',{arraySize:5}],['cube-square',{height:4}]);
  if(shape.target===7)mutations.push(['array-depth',{depth:2}]);
  for(const[name,change]of mutations)refuse(name,{...m,...change},owner,()=>owner.store.createResource({...m,...change}));
  dispose(owner);
  const exact=make({resourceBytes:cost});c.ok(exact.store.createResource(m),'exact literal whole-chain byte limit');c.ok(exact.store.unref(m.id),'retire exact-chain owner');dispose(exact);
  const short=make({resourceBytes:cost-1});refuse('chain-one-short',m,short,()=>short.store.createResource(m));dispose(short);
  for(const [axis,limit,field]of shape.target===3?[['width',2048,'texture3DSize'],['depth',2048,'texture3DSize']]:shape.target===7?[['width',16384,'textureSize'],['arraySize',2048,'arrayLayers']]:[['width',16384,'cubeTextureSize']]){
   const input={...m,width:1,height:1,depth:1,arraySize:shape.target===4?6:1,lastLevel:0,[axis]:limit};if(shape.target===4)input.height=limit;
   const owner=make(),before=point('actual-limit-neighbor',input,owner),accepted=owner.store.createResource(input);
   if(shape.target===4)c.equal(accepted.ok,false,'actual cube dimension bound independently exceeds byte budget');
   else{c.ok(accepted,'actual hardware dimension bound');c.ok(owner.store.unref(m.id),'retire dimension boundary');}
   boundaries.push({...before,field,limit,result:copy(accepted),after:copy(owner.store.inspect()),nativeCallsEnd:nativeCalls.length});
   const over={...input,[axis]:limit+1};if(shape.target===4)over.height=limit+1;
   refuse('actual-dimension-one-over',over,owner,()=>owner.store.createResource(over));dispose(owner);
  }
  const aggregate=make({gpuBytes:cost*2});for(const id of [100,101])c.ok(aggregate.store.createResource({...m,id}),'exact aggregate two chains');
  refuse('aggregate-one-over',{...m,id:102},aggregate,()=>aggregate.store.createResource({...m,id:102}));dispose(aggregate);
  const constrained=make(shape.target===3?{texture3DSize:6}:shape.target===4?{cubeTextureSize:4}:{arrayLayers:6});
  refuse('tightened-dimensional-limit',m,constrained,()=>constrained.store.createResource(m));dispose(constrained);
 }
 // Layout arithmetic is refused before any native command or ticket publication.
 const owner=make(),m=meta(shapes[0]);c.ok(owner.store.createResource(m),'boundary volume');c.ok(owner.store.attachContext(1,m.id),'boundary member');backing(owner,m.id);
 const base={resourceHandle:m.id,level:0,usage:0,stride:27,layerStride:92,box:whole([5,3,7]),dataOffset:5,direction:1};
 const literal=publicLayout([5,3,7],base.box,{offset:5,stride:27,layerStride:92});
 for(const direction of [1,2]){
  const input={...base,direction},valid=c.ok(computeStandardDimensionalTransferLayout(m,input,literal.requiredEnd),'literal exact backing end').layout;
  c.equal(valid.requiredEnd,631,'literal 631-byte SG end');boundaries.push({name:'exact-layout',metadata:m,input,backingBytes:631,result:copy(valid)});
  c.equal(computeStandardDimensionalTransferLayout(m,input,630).ok,false,'one-short physical backing');
  boundaries.push({name:'short-layout',metadata:m,input,backingBytes:630,result:copy(computeStandardDimensionalTransferLayout(m,input,630))});
 }
 const invalid=[['identity',{resourceHandle:99}],['level',{level:3}],['x-origin',{box:{...base.box,x:6}}],['x-extent',{box:{...base.box,x:1}}],['y-origin',{box:{...base.box,y:4}}],['y-extent',{box:{...base.box,y:1}}],['z-origin',{box:{...base.box,z:8}}],['z-extent',{box:{...base.box,z:1}}],['row-overlap',{stride:19}],['layer-overlap',{layerStride:80}],['default-layer-overflow',{stride:0xffffffff,layerStride:0}],['row-footprint-overflow',{stride:0xffffffff,layerStride:0xffffffff}],['layer-footprint-overflow',{layerStride:0xffffffff}],['combined-footprint-overflow',{box:whole([1,2,2]),stride:0x40000000,layerStride:0xc0000000}],['final-row-overflow',{box:whole([1,1,2]),stride:4,layerStride:0xfffffffd}],['backing-offset',{dataOffset:8193}],['short-backing',{dataOffset:8000}]];
 for(const[name,change]of invalid){const fields={...base,...change};refuse(name,{metadata:m,fields},owner,()=>owner.store.prepareTransfer(1,{opcode:43,fields}));}
 const transferLimited=computeStandardDimensionalTransferLayout(m,base,8192,{transferBytes:625});c.equal(transferLimited.ok,false,'padded footprint one over transfer budget');boundaries.push({name:'transfer-budget',metadata:m,input:base,backingBytes:8192,limits:{transferBytes:625},result:copy(transferLimited)});
 for(const length of [4,633]){
  const raw=wire(m.id,0,base.box,{opcode:9,stride:27,layerStride:92,data:new Uint8Array(length)}),decoded=decodeStandardDimensionalSubmission(raw);
  if(decoded.ok)refuse('inline-size',hex(raw),owner,()=>owner.store.prepareTransfer(1,decoded.commands[0]));else boundaries.push({name:'inline-decode',wire:hex(raw),result:copy(decoded)});
 }
 for(const input of [wire(m.id,0,whole([5,3,7])),wire(m.id,0,whole([1,2,2]),{stride:0xffffffff,layerStride:0xffffffff}),wire(m.id,0,whole([1,1,2]),{offset:0xffffffff,layerStride:4}),wire(m.id,0,whole([1,1,2]),{opcode:45,offset:0xffffffff,layerStride:4})]){
  const historical=decodeStandardShadowSamplerSubmission(input),selected=decodeStandardDimensionalSubmission(input);c.equal(historical.ok,false,'historical command admission remains gated');
  boundaries.push({name:'decoder-boundary',wire:hex(input),historical:copy(historical),selected:copy(selected)});
 }
 c.equal(owner.bindings.retainScanout(m.id,owner.store.inspect().resources[0].generation).ok,false,'dimensional scanout remains gated');dispose(owner);
 const profileNames=[['decodeSubmission','virgl-tiny-commands-v1'],['decodeStandardSubmission','virgl-standard-commands-v1'],['decodeStandardUniformSubmission','virgl-standard-uniform-commands-v1'],['decodeStandardTextureSubmission','virgl-standard-texture-commands-v1'],['decodeStandardImageSubmission','virgl-standard-image-commands-v1'],['decodeStandardColorSubmission','virgl-standard-byte-color-commands-v1'],['decodeStandardFloatImageSubmission','virgl-standard-float-image-commands-v1'],['decodeStandardPackedFloatImageSubmission','virgl-standard-r11g11b10-image-commands-v1'],['decodeStandardSharedExponentImageSubmission','virgl-standard-rgb9e5-image-commands-v1'],['decodeStandardIntegerImageSubmission','virgl-standard-integer-image-commands-v1'],['decodeStandardMultipleColorSubmission','virgl-standard-multiple-color-commands-v1'],['decodeStandardPackedNormalizedImageSubmission','virgl-standard-packed-normalized-image-commands-v1'],['decodeStandardPackedUnsignedImageSubmission','virgl-standard-packed-unsigned-image-commands-v1'],['decodeStandardFloatingDepthImageSubmission','virgl-standard-floating-depth-image-commands-v1'],['decodeStandardUnormDepthImageSubmission','virgl-standard-unorm-depth-image-commands-v1'],['decodeStandardPackedDepthImageSubmission','virgl-standard-packed-depth-image-commands-v1'],['decodeStandardStencilSubmission','virgl-standard-stencil-commands-v1'],['decodeStandardShadowSamplerSubmission','virgl-standard-shadow-sampler-commands-v1']];
 for(const[name,profile]of profileNames){
  const input=wire(100,0,whole([1,1,1])),result=c.ok(decoders[name](input),'historical one-layer admission');c.equal(result.profile,profile,'historical selected profile unchanged');
  const overflow=wire(100,0,whole([1,3,1]),{stride:0xffffffff}),bad=decoders[name](overflow);c.equal(bad.ok,false,'historical row overflow');c.equal(bad.error.message,'Transfer row arithmetic overflows u32.','historical error text unchanged');
  boundaries.push({name:'historical-decoder',decoder:name,wire:hex(input),result:copy(result),overflowWire:hex(overflow),overflow:copy(bad)});
 }
 // Qualification requires this backend and each separate positive scalar limit.
 {
  const backend=c.ok(createStandardDimensionalTransferBackend(gpu),'qualification backend').backend;
  for(const field of ['dimensionalProfile','maxTexture3DSize','maxCubeTextureSize','maxArrayLayers']){
   const candidate={...backend,[field]:field==='dimensionalProfile'?'unqualified':0},result=createStandardDimensionalResourceStore({backend:candidate});c.equal(result.ok,false,'reject backend '+field);boundaries.push({name:'backend-qualification',field,result:copy(result)});
  }
  for(const factory of [createResourceStore,createStandardDesktopResourceStore]){const legacy=c.ok(factory({backend}),'historical store');for(const shape of shapes)c.equal(legacy.store.createResource(meta(shape)).ok,false,'historical dimensional shape remains refused');c.ok(legacy.store.dispose(),'historical dispose');}
  backend.dispose();c.equal(live.size,0,'qualification objects retired');
 }
 // Physical driver errors execute native failure cleanup, retaining no new owner.
 for(const shape of shapes){
  const owner=make(),m=meta(shape),method=shape.target===4?'texStorage2D':'texStorage3D',before=point('allocation-fault',m,owner),liveBefore=live.size;
  armed={method,index:3,value:0,count:1};const result=owner.store.createResource(m);armed=null;c.equal(result.ok,false,'physical immutable allocation fault');c.same(owner.store.inspect(),before.state,'failed allocation publishes nothing');c.equal(live.size,liveBefore,'failed allocation destroys exactly its texture');
  faults.push({...before,phase:'allocate',method,result:copy(result),errors:errors(),after:copy(owner.store.inspect()),nativeCallsEnd:nativeCalls.length});
  c.ok(owner.store.createResource(m),'healthy allocation after physical fault');c.ok(owner.store.attachContext(1,m.id),'fault member');backing(owner,m.id);
  const input=decode(wire(m.id,0,whole(shape.levels[0]))),upload=c.ok(owner.store.prepareTransfer(1,input),'fault upload ticket');
  armed={method:shape.target===4?'texSubImage2D':'texSubImage3D',index:1,value:99,count:1};const uploadResult=owner.store.executeTransfer(upload.ticket);armed=null;c.equal(uploadResult.ok,false,'actual invalid-level upload fails');c.equal(owner.store.inspect().budgets.tickets,0,'upload failure retires ticket');c.equal(owner.store.inspect().budgets.scratchBytes,0,'upload failure releases scratch');
  faults.push({phase:'upload',metadata:m,result:copy(uploadResult),errors:errors(),after:copy(owner.store.inspect()),nativeCallsEnd:nativeCalls.length});
  for(const asynchronous of [false,true]){
   const command=decode(wire(m.id,0,whole(shape.levels[0]),{direction:2})),ticket=c.ok(asynchronous?owner.asyncAccess.prepareTransfer(1,command):owner.store.prepareTransfer(1,command),'fault read ticket'),start=nativeCalls.length,objects=live.size;
   armed={method:shape.target===4?'framebufferTexture2D':'framebufferTextureLayer',index:4,value:99,count:1};
   const result=asynchronous?owner.asyncAccess.beginTransferRead(ticket.ticket):owner.store.executeTransfer(ticket.ticket);armed=null;c.equal(result.ok,false,'actual invalid-mip attachment fails');
   if(asynchronous)c.ok(owner.asyncAccess.release(ticket.ticket),'failed staged read release');c.equal(live.size,objects,'failed read deletes staging objects');c.equal(owner.store.inspect().budgets.scratchBytes,0,'failed read releases scratch');
   faults.push({phase:asynchronous?'pbo-read':'sync-read',metadata:m,result:copy(result),errors:errors(),after:copy(owner.store.inspect()),nativeCallsStart:start,nativeCallsEnd:nativeCalls.length});
  }
  const lease=c.ok(owner.store.retainStorage(1,m.id,'readback'),'disposal hold').lease;
  const a=c.ok(owner.asyncAccess.prepareTransfer(1,decode(wire(m.id,0,whole(shape.levels[0]),{direction:2}))),'pending dispose transfer');c.ok(owner.asyncAccess.beginTransferRead(a.ticket),'real pending dispose fence');
  const b=c.ok(owner.asyncAccess.beginStorageRead(lease,whole(shape.levels[0])),'real pending retained read');const beforeDispose=copy(owner.store.inspect());dispose(owner);
  c.ok(owner.asyncAccess.release(a.ticket),'once-only disposed transfer tombstone');c.ok(owner.asyncAccess.release(b.ticket),'once-only disposed storage tombstone');c.equal(owner.asyncAccess.release(a.ticket).ok,false,'disposed token cannot release twice');
  const final=copy(owner.store.inspect());c.equal(final.budgets.gpuBytes,0,'pending dispose GPU zero');c.equal(final.budgets.scratchBytes,0,'pending dispose scratch zero');
  faults.push({phase:'pending-dispose',metadata:m,before:beforeDispose,after:final,nativeCallsEnd:nativeCalls.length});
 }
 const result={status:'passed',kind:'original-dimensional-rgba8-storage',liveGuest3d:false,productionAuthority:false,
  runs,boundaries,faults,nativeCalls,seeds,assertions:c.assertions};
 result.summary={status:result.status,shapes:runs.length,mipLevels:runs.reduce((n,r)=>n+r.literalLevels.length,0),
  observations:runs.reduce((n,r)=>n+r.observations.length,0),nativeCalls:nativeCalls.length,assertions:c.assertions};return result;
}
