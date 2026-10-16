// Original dimensional packets across actual Wasm queues, live RAM and Metal GPU.
import {createVirglStandardShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {shapes,plane,patch,whole,publicLayout,scatter,wire,hex} from '../../../tools/virgl-dimensional-storage/fixtures.mjs';
const OK=0x1100,BAD=0x1205,OOM=0x1201;
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const put32=(v,at,x)=>new DataView(v.buffer,v.byteOffset,v.byteLength).setUint32(at,x,true);
const keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
const meta=s=>({id:6,target:s.target,format:67,bind:10,width:s.width,height:s.height,depth:s.depth,arraySize:s.arraySize,lastLevel:s.lastLevel,nrSamples:0,flags:0});
function packet(m){const raw=header(0x204,0,72);keys.forEach((k,i)=>put32(raw,24+i*4,m[k]));return raw;}
const selected=Wasm=>class{constructor(callback){return Wasm.standardDimensional(callback);}};
function rigFor(Wasm,factory,gl,shader,c,seed=0){return makeRig(Wasm,factory,gl,shader,c,seed,true,false,true);}
function active(rig){window.__desktopActive=()=>({records:rig.q.records,events:rig.events,native:copy(rig.q.vm.inspect()),submit:copy(rig.q.vm.submitState()),host:copy(rig.host.bridge.inspect()),exchanges:rig.exchanges});}
function model(rig,s,c){const n=rig.q.vm.inspect(),h=rig.host.bridge.inspect(),m=meta(s),cost=s.levels.reduce((n,[w,y,d])=>n+w*y*d*4,0);
 c.same(n.resources.find(v=>v.identity.id===6).metadata,m,'original native dimensional metadata');
 c.equal(n.logicalBytes,cost,'literal complete native public chain');c.equal(n.gpuBytes,cost,'literal native GPU chain');
 c.equal(h.store.budgets.gpuBytes,cost,'literal host GPU chain');c.same(h.resources.find(v=>v.transport.id===6).transport,n.resources.find(v=>v.identity.id===6).identity,'same accepted transport generation');
 return{native:copy(n),host:copy(h),prediction:{cost,levels:s.levels}};
}
function guestBacking(rig,id,length,c,offset=0x210000n){
 const q=rig.q,cuts=[7,17,53,101,length-178],entries=cuts.map((n,i)=>[q.base+offset+BigInt(i*0x4000),n]);
 entries.forEach(([at,n])=>q.write(at-8n,new Uint8Array(n+16).fill(0xa3)));
 const write=bytes=>{c.equal(bytes.length,length,'full guest backing oracle');let p=0;for(const[at,n]of entries){q.write(at,bytes.subarray(p,p+n));p+=n;}};
 const read=()=>{const out=new Uint8Array(length);let p=0;for(const[at,n]of entries){out.set(q.read(at,n),p);p+=n;}return out;};
 const guards=()=>entries.map(([at,n])=>{const a=hex(q.read(at-8n,8)),b=hex(q.read(at+BigInt(n),8));c.equal(a,'a3'.repeat(8),'SG prefix guard');c.equal(b,'a3'.repeat(8),'SG suffix guard');return{address:at.toString(16),length:n,prefix:a,suffix:b};});
 return{entries,write,read,guards,attach:backing(id,entries)};
}
function outer(level,box,l,direction=1,fence=0xffffffffffffffffn){const raw=transfer(1,6,direction,[box.x,box.y,box.z,box.width,box.height,box.depth],BigInt(l.offset),l.stride??l.rowStride,l.layer??l.layerStride,fence);put32(raw,60,level);return raw;}
async function runShape(Wasm,factory,gl,shader,c,s,seed){
 const rig=rigFor(Wasm,factory,gl,shader,c,seed),q=rig.q;active(rig);
 const result={shape:s,seed,metadata:meta(s),levels:[],partial:[],states:[],argumentAttacks:[]};window.__desktopProof.runs.push(result);
 await rig.expect('dimensional context',context(1));await rig.expect('dimensional create',packet(meta(s)));result.states.push(model(rig,s,c));
 const ram=guestBacking(rig,6,4096,c);await rig.expect('dimensional split backing',ram.attach);await rig.expect('dimensional membership',idCommand(0x202,1,6));
 let tested=false;
 rig.setIntercept(event=>{
  if(event.type==='beginJob'){
   const r=event.resources.find(v=>v.identity.id===6)??event.resources[0];
   if(r?.backing){const args=[event.epoch,event.sequence,'0000000000000001',r.identity.id,r.identity.generation,r.backing.generation,'0000000000000000',4,4,1,4,1];
    c.throws(()=>q.vm.gatherLayeredInput(...args),'synchronous callback cannot reenter layered Machine gather');c.throws(()=>q.vm.scatterLayeredOutput(...args,new Uint8Array(4)),'synchronous callback cannot reenter layered Machine scatter');}
  }
  return rig.host.bridge.apply(event);
 });
 rig.hooks.beforeLayeredGather=args=>{
  if(tested)return;tested=true;const before=copy(q.vm.submitState());
  for(const[at,value]of [[0,'ffffffffffffffff'],[2,'ffffffffffffffff'],[4,'ffffffffffffffff'],[5,'ffffffffffffffff'],[6,'ffffffffffffffff'],[7,0],[8,0],[9,0],[9,16385],[10,1],[11,0],[11,2049]]){
   const bad=args.slice();bad[at]=value;c.throws(()=>q.vm.gatherLayeredInput(...bad),'malformed layered exchange '+at+' '+value);
   c.same(q.vm.submitState(),before,'malformed exchange cannot advance native authority');result.argumentAttacks.push({args:bad,state:before});
  }
 };
 rig.hooks.afterLayeredGather=(args,data)=>{c.throws(()=>q.vm.gatherLayeredInput(...args),'consumed layered input replay');c.throws(()=>q.vm.scatterLayeredOutput(...args,data),'consumed layered input cannot scatter');};
 rig.hooks.afterLayeredScatter=args=>{c.throws(()=>q.vm.scatterLayeredOutput(...args),'consumed layered output replay');};
 async function issue(label,raw){const first=rig.exchanges.length,entry=q.enqueue(label,raw);q.kick();q.run();c.equal(q.usedIndex(),entry.number,'native admission withholds completion');
  const owner=copy(rig.events.at(-1));c.equal(owner.type,'beginJob','original actual callback');await rig.drain();const record=q.collect(entry);q.vm.writeMmio(0x64,1);
  const exchanges=copy(rig.exchanges.slice(first));ram.guards();return{record,owner,exchanges};}
 const expectedPlanes=[];
 for(let level=0;level<s.levels.length;level++){
  const extent=s.levels[level],box=whole(extent),tight=plane(seed,s.target,level,extent),padded=level%2===0;
  const fields={offset:5,stride:padded?extent[0]*4+7:0,layerStride:padded?(extent[0]*4+7)*extent[1]+11:0};
  const l=publicLayout(extent,box,fields),source=scatter(tight,box,l,new Uint8Array(4096).fill(0x8d));ram.write(source);
  const upload=await issue('original outer layered mip '+level,outer(level,box,{...l,stride:fields.stride,layer:fields.layerStride}));
  c.equal(upload.exchanges[0].kind,'layered-input','one atomic layered input exchange');c.equal(upload.exchanges[0].bytes,hex(tight),'literal full mip gather');c.equal(upload.exchanges.length,1,'all layers use one bounded exchange');
  const poisoned=new Uint8Array(4096).fill(0xc7);ram.write(poisoned);
  const readback=await issue('original inner43 mip inverse '+level,submission(1,wire(6,level,box,{...fields,direction:2}),BigInt(seed+level)));
  c.equal(readback.exchanges[0].bytes,hex(tight),'actual fenced GPU original inverse');c.equal(readback.exchanges[0].kind,'layered-output','one atomic layered output exchange');
  c.equal(hex(ram.read()),hex(scatter(tight,box,l,poisoned)),'every original row/layer/SG padding byte');
  result.levels.push({level,extent,layout:l,input:hex(tight),source:hex(source),upload,readback,fullBacking:hex(ram.read()),guards:ram.guards()});expectedPlanes.push(tight);
 }
 // Nonzero origins and the last two original layers, including cube faces4/5.
 const extent=s.levels[0],box={x:1,y:1,z:extent[2]-2,width:2,height:2,depth:2},tight=plane(seed,s.target,19,[2,2,2]);
 const il=publicLayout(extent,box,{offset:0,stride:11,layerStride:27}),inline=scatter(tight,box,il,new Uint8Array(il.footprintBytes).fill(0x59));
 const inlined=await issue('original inline9 last layers',submission(1,wire(6,0,box,{opcode:9,stride:11,layerStride:27,data:inline})));
 c.equal(inlined.exchanges.length,0,'inline upload has original copied words');expectedPlanes[0]=patch(expectedPlanes[0],extent,box,tight);
 const stageMeta={id:200,target:0,format:64,bind:524288,width:4096,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
 await rig.expect('original staging owner',packet(stageMeta));const staging=guestBacking(rig,200,4096,c,0x250000n);await rig.expect('original staging backing',staging.attach);await rig.expect('original staging member',idCommand(0x202,1,200));
 const fields={offset:13,stride:13,layerStride:37},layout=publicLayout(extent,box,fields),copyTight=plane(seed,s.target,23,[2,2,2]);
 const fresh=scatter(copyTight,box,layout,new Uint8Array(4096).fill(0xb9));staging.write(fresh);
 const staged=await issue('original staging45 last layers',submission(1,wire(6,0,box,{opcode:45,stagingId:200,flags:1,...fields})));
 c.equal(staged.exchanges[0].args[3],200,'staging exchange uses actual staging owner');c.equal(staged.exchanges[0].bytes,hex(copyTight),'original live staging layered gather');expectedPlanes[0]=patch(expectedPlanes[0],extent,box,copyTight);
 staging.write(new Uint8Array(4096).fill(0xa7));const reverse=await issue('original staging45 inverse',submission(1,wire(6,0,box,{opcode:45,stagingId:200,flags:3,...fields})));
 c.equal(reverse.exchanges[0].bytes,hex(copyTight),'fenced actual last-layer inverse');c.equal(hex(staging.read()),hex(scatter(copyTight,box,layout,new Uint8Array(4096).fill(0xa7))),'all staging padding/guards');staging.guards();
 const fullBox=whole(extent),fullLayout=publicLayout(extent,fullBox,{offset:5});ram.write(new Uint8Array(4096).fill(0xd3));
 const full=await issue('original outer206 patched full inverse',outer(0,fullBox,{...fullLayout,stride:0,layer:0},2));
 c.equal(full.exchanges[0].bytes,hex(expectedPlanes[0]),'full original image retains untouched pixels and patched layers');c.equal(hex(ram.read()),hex(scatter(expectedPlanes[0],fullBox,fullLayout,new Uint8Array(4096).fill(0xd3))),'complete patched full backing');
 result.partial.push({box,inline:hex(inline),inlined,staged,reverse,full,expectedFullPlane:hex(expectedPlanes[0]),stagingBacking:hex(staging.read()),fullBacking:hex(ram.read())});
 await rig.expect('release staging',idCommand(0x102,0,200));result.states.push(model(rig,s,c));
 const replacement=guestBacking(rig,6,4096,c,0x290000n),newTight=plane(seed,s.target,31,extent),newBacking=scatter(newTight,fullBox,fullLayout,new Uint8Array(4096).fill(0xe9));replacement.write(newBacking);
 const generationBefore=q.vm.inspect().resources.find(v=>v.identity.id===6).backingGeneration;
 const queued=[q.enqueue('queued old layers before detach',outer(0,fullBox,{...fullLayout,stride:0,layer:0},2)),q.enqueue('queued dimensional backing detach',idCommand(0x107,0,6)),q.enqueue('queued dimensional backing reattach',replacement.attach),q.enqueue('queued new dimensional upload',outer(0,fullBox,{...fullLayout,stride:0,layer:0})),q.enqueue('queued new dimensional inverse',outer(0,fullBox,{...fullLayout,stride:0,layer:0},2))];
 const at=rig.exchanges.length;q.kick();q.run();c.equal(q.usedIndex(),queued[0].number,'queued layer detach waits behind actual prior GPU work');await rig.drain();const queuedRecords=queued.map(v=>q.collect(v));q.vm.writeMmio(0x64,1);
 const changes=copy(rig.exchanges.slice(at));c.equal(changes.length,3,'ordered old read/new upload/new read are three exchanges');c.equal(changes[0].bytes,hex(expectedPlanes[0]),'old admitted layer request retains old GPU data');c.equal(changes[1].bytes,hex(newTight),'new request gathers newly attached RAM');c.equal(changes[2].bytes,hex(newTight),'new actual GPU inverse');
 c.truth(q.vm.inspect().resources.find(v=>v.identity.id===6).backingGeneration!==generationBefore,'successful dimensional reattach changes generation');c.truth(changes[0].args[5]!==changes[1].args[5],'layer exchange follows backing generation');c.equal(hex(replacement.read()),hex(newBacking),'new full backing preserves every padding byte');replacement.guards();
 result.lifecycle={records:queuedRecords,exchanges:changes,oldBacking:hex(ram.read()),newBacking:hex(replacement.read()),guards:replacement.guards()};

 const oldEpoch=q.vm.inspect().epoch,stale=rig.exchanges.findLast(v=>v.kind==='layered-output'),before=hex(ram.read());
 const pending=q.enqueue('cancel actual layered read',outer(0,fullBox,{...fullLayout,stride:0,layer:0},2));q.kick();q.run();c.equal(q.usedIndex(),pending.number,'pending reset target');q.reset();
 c.equal(q.vm.inspect().resources.length,0,'reset native owners');c.equal(rig.host.bridge.inspect().resources.length,0,'reset host owners');
 c.throws(()=>q.vm.gatherLayeredInput(...stale.args),'reset revokes old layered exchange');c.throws(()=>q.vm.scatterLayeredOutput(...stale.args,new Uint8Array(extent[0]*extent[1]*extent[2]*4)),'reset revokes old layered scatter');
 c.equal(hex(ram.read()),before,'reset no stale guest publication');
 await rig.expect('reuse original ID after reset',packet(meta(s)));c.truth(q.vm.inspect().epoch!==oldEpoch,'reused ID has new epoch');await rig.expect('release whole chain',idCommand(0x102,0,6));
 c.equal(q.vm.inspect().gpuBytes,0,'release all native GPU cost');c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,0,'release all host GPU cost');
 Object.assign(result,{records:q.records,events:rig.events,exchanges:rig.exchanges,completions:rig.completions,snapshot:rig.trace.snapshot(),commandTrace:q.vm.commandTrace(),machineDigest:q.vm.machineDigest()});
 window.__desktopActive=null;rig.dispose();return result;
}
async function boundaries(Wasm,Legacy,factory,oldFactory,gl,shader,c){
 const rig=rigFor(Wasm,factory,gl,shader,c),q=rig.q;active(rig);const result={metadata:[],transfers:[],historical:[]};
 const valid=meta(shapes[0]);
 for(const[key,value]of [['format',66],['bind',0],['bind',1],['bind',16],['bind',0x8000000a],['width',0],['width',2049],['height',0],['height',2049],['depth',0],['depth',2049],['arraySize',2],['lastLevel',3],['lastLevel',32],['nrSamples',1],['flags',1]]){
  const m={...valid,[key]:value},before={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),events:rig.events.length,objects:rig.trace.objects.size};
  const record=await rig.expect('native dimensional invalid '+key+' '+value,packet(m),BAD);c.same(q.vm.inspect(),before.native,'invalid metadata native rollback');c.same(rig.host.bridge.inspect(),before.host,'invalid metadata host rollback');c.equal(rig.events.length,before.events,'refusal before callbacks');c.equal(rig.trace.objects.size,before.objects,'refusal before GPU allocation');result.metadata.push({m,before,record});
 }
 const exact={...valid,width:1024,height:512,depth:2,lastLevel:0};
 for(let id=1;id<=8;id++)await rig.expect('exact aggregate dimensional GPU '+id,packet({...exact,id}));
 c.equal(q.vm.inspect().gpuBytes,33554432,'exact32MiB aggregate native dimensional');c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,33554432,'exact aggregate hardware dimensional');
 await rig.expect('aggregate plus plane',packet({...exact,id:9}),OOM);q.reset();
 for(const m of [{...exact,width:1025},{...exact,lastLevel:1}])await rig.expect('whole dimensional chain plus budget',packet(m),OOM);
 await rig.expect('invalid transfer context',context(1));await rig.expect('invalid transfer image',packet(valid));const ram=guestBacking(rig,6,4096,c);await rig.expect('invalid transfer backing',ram.attach);await rig.expect('invalid transfer member',idCommand(0x202,1,6));
 for(const[level,box,offset,stride,layer]of [[3,[0,0,0,1,1,1],0n,0,0],[1,[2,0,0,1,1,1],0n,0,0],[1,[0,1,0,1,1,1],0n,0,0],[1,[0,0,3,1,1,1],0n,0,0],[1,[0,0,0,0,1,1],0n,0,0],[1,[0,0,0,1,1,0],0n,0,0],[0,[0,0,0,5,3,7],0n,19,0],[0,[0,0,0,5,3,7],0n,20,59],[0,[0,0,0,5,3,7],4096n,0,0],[0,[0,0,0,5,3,7],0xffffffffffffffffn,0,0],[0,[0,0,0,5,3,7],0n,0xffffffff,0]]){
  const raw=transfer(1,6,1,box,offset,stride,layer,0xffffffffffffffffn);put32(raw,60,level);const before={native:copy(q.vm.inspect()),submit:copy(q.vm.submitState()),host:copy(rig.host.bridge.inspect()),events:rig.events.length,ram:hex(ram.read())};const record=await rig.expect('native dimensional transfer refusal '+result.transfers.length,raw,BAD);
  c.same(q.vm.inspect(),before.native,'transfer refusal preserves owner');c.same(q.vm.submitState(),before.submit,'transfer refusal no scheduler effects');c.same(rig.host.bridge.inspect(),before.host,'transfer refusal no host effects');c.equal(rig.events.length,before.events,'transfer refusal no callback');c.equal(hex(ram.read()),before.ram,'transfer refusal no RAM write');result.transfers.push({before,record});
 }
 // Exact logical backing edge: final dense image byte is420, with odd offset5.
 await rig.expect('detach prior backing',idCommand(0x107,0,6));await rig.expect('one byte short backing',backing(6,[[q.base+0x210000n,424]]));
 await rig.expect('one byte short layered footprint',transfer(1,6,1,[0,0,0,5,3,7],5n,0,0),BAD);
 await rig.expect('detach short backing',idCommand(0x107,0,6));await rig.expect('exact layered footprint backing',backing(6,[[q.base+0x210000n,425]]));
 await rig.expect('exact layered footprint accepted',transfer(1,6,1,[0,0,0,5,3,7],5n,0,0));
 result.records=q.records;result.events=rig.events;result.commandTrace=q.vm.commandTrace();window.__desktopActive=null;rig.dispose();
 const old=makeRig(Legacy,oldFactory,gl,shader,c);
 for(const s of shapes){const record=await old.expect('historical constructor dimensional refusal',packet(meta(s)),BAD);result.historical.push(record);}
 old.dispose();return result;
}
async function layeredFailure(Wasm,factory,gl,shader,c){
 const rig=rigFor(Wasm,factory,gl,shader,c,2),q=rig.q,s=shapes[1];active(rig);
 await rig.expect('failure original context',context(1));await rig.expect('failure cube allocation',packet(meta(s)));
 const ram=guestBacking(rig,6,4096,c);await rig.expect('failure split backing',ram.attach);await rig.expect('failure cube membership',idCommand(0x202,1,6));
 const box=whole(s.levels[0]),layout=publicLayout(s.levels[0],box,{offset:5}),tight=plane(39187,4,0,s.levels[0]);ram.write(scatter(tight,box,layout,new Uint8Array(4096).fill(0x8d)));
 await rig.expect('failure initial actual cube upload',outer(0,box,{...layout,stride:0,layer:0}));
 ram.write(new Uint8Array(4096).fill(0xe7));const before=hex(ram.read()),collections=rig.trace.snapshot().collections;
 const entry=q.enqueue('actual dimensional PBO fence WAIT_FAILED',outer(0,box,{...layout,stride:0,layer:0},2),0x1200);q.kick();q.run();
 let steps=0;while(rig.trace.syncs.size===0){c.truth(++steps<10,'actual dimensional PBO fence appears');await rig.step();}
 c.equal(q.usedIndex(),entry.number,'failure readback remains withheld');c.equal(rig.trace.syncs.size,1,'physical original read owns a real fence');rig.trace.control.waitFailed=true;
 await rig.step();q.run();const record=q.collect(entry);
 c.truth(q.vm.inspect().poisoned,'uncertain actual read poisons native boundary');c.truth(rig.host.bridge.inspect().poisoned,'uncertain actual read poisons host boundary');
 c.equal(hex(ram.read()),before,'failed original layer fence publishes no output');c.equal(rig.trace.snapshot().collections,collections,'failed actual read never collects PBO');c.equal(rig.trace.syncs.size,0,'failed layer fence is released');ram.guards();
 const result={record,events:rig.events,exchanges:rig.exchanges,completions:rig.completions,physical:rig.trace.events,before,after:hex(ram.read()),host:copy(rig.host.bridge.inspect()),native:copy(q.vm.inspect())};
 q.reset();await rig.expect('failed layer reset recovery',packet(meta(s)));await rig.expect('failed layer release',idCommand(0x102,0,6));window.__desktopActive=null;rig.dispose();return result;
}
export async function runNativeDimensionalAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalSubmitBridge,createVirglSubmitBridge,seeds=[14241,33485,58393]}){
 const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(gl,'hardware dimensional WebGL2');
 const nativeCalls=[],objects=new WeakMap();let next=1;
 const describe=v=>{if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;if(ArrayBuffer.isView(v))return{type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(!objects.has(v))objects.set(v,next++);return{object:objects.get(v),type:v.constructor?.name??'object'};};
 const recorded=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{const before=args.map(describe),value=v.apply(t,args);nativeCalls.push({sequence:nativeCalls.length,name:k,before,after:args.map(describe),result:describe(value)});return value;};}});
 const info=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);c.truth(gpu.includes('Metal'),'actual Metal hardware');
 const shader=await createVirglStandardShadowTextureShaderBridge(),Wasm=selected(WasmVirglSubmitProof),factory=createVirglStandardDimensionalSubmitBridge;
 const result={gpu,nativeCalls,actualLinuxGuest:false,productionNegotiation:false,runs:[]};window.__desktopProof=result;
 for(const seed of seeds)for(const s of shapes)await runShape(Wasm,factory,recorded,shader,c,s,seed);
 result.boundaries=await boundaries(Wasm,WasmVirglSubmitProof,factory,createVirglSubmitBridge,recorded,shader,c);
 result.failure=await layeredFailure(Wasm,factory,recorded,shader,c);
 c.equal(gl.getError(),gl.NO_ERROR,'zero final native dimensional GPU error');result.assertions=c.assertions;result.attacks=c.attacks;result.status='passed';
 result.summary={status:'passed',gpu,schedules:seeds,runs:result.runs.length,mips:result.runs.reduce((n,v)=>n+v.levels.length,0),layers:result.runs.reduce((n,v)=>n+v.shape.levels.reduce((s,p)=>s+p[2],0),0),nativeCalls:nativeCalls.length,assertions:c.assertions};return result;
}
