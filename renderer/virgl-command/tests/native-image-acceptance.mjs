// Original public image words through native mip validation and actual hardware DMA.
import { createVirglStandardShadowTextureShaderBridge } from '../../virgl-shader/standard.mjs';
import { checker, makeRig, context, idCommand, header, backing, transfer,
  orderedDma, uncertainGpuFailure } from './submit-acceptance.mjs';
import { Selected, acceptedOwners } from './desktop-submit-acceptance.mjs';
import { specimen, costs, originalRecord } from '../../../tools/virgl-native-image/fixtures.mjs';
const OK=0x1100, BAD=0x1205, OOM=0x1201;
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>x instanceof Uint8Array?[...x]:typeof x==='bigint'?x.toString(16):x));
const hex=v=>[...v].map(x=>x.toString(16).padStart(2,'0')).join('');
const set32=(v,at,x)=>new DataView(v.buffer,v.byteOffset,v.byteLength).setUint32(at,x,true);
const META=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
function packet(m) { const raw=header(0x204,0,72);META.forEach((k,i)=>set32(raw,24+i*4,m[k]));return raw; }
function mipTransfer(p,direction,fence=0xffffffffffffffffn) {
  const raw=transfer(1,6,direction,[0,0,0,p.width,p.height,1],BigInt(p.offset),p.stride,0,fence);
  set32(raw,60,p.level);return raw;
}
function active(rig) {
  window.__desktopActive=()=>({records:rig.q.records,events:rig.events,native:copy(rig.q.vm.inspect()),
    submit:copy(rig.q.vm.submitState()),host:copy(rig.host.bridge.inspect()),exchanges:rig.exchanges});
}
function model(rig,layout,m,c,label) {
  const n=rig.q.vm.inspect(),h=rig.host.bridge.inspect(),expected=costs(layout,m);
  c.same(n.resources.map(v=>v.identity.id),[6],label+' one original owner');
  c.same(n.resources[0].metadata,m,label+' immutable original metadata');
  c.same(h.resources[0].transport,n.resources[0].identity,label+' same native/host generation');
  c.equal(n.logicalBytes,expected.publicBytes,label+' literal public cost');
  c.equal(n.gpuBytes,expected.gpuBytes,label+' literal owned GPU cost');
  c.equal(h.store.budgets.gpuBytes,expected.gpuBytes,label+' host owned GPU cost');
  return {native:copy(n),host:copy(h),expected};
}
async function imageRun(Wasm,factory,gl,shaderBridge,c,layout,seed) {
  const rig=makeRig(Wasm,factory,gl,shaderBridge,c,seed),{q}=rig,src=specimen(layout,seed),states=[],planes=[];
  const collect=q.collect.bind(q);
  q.collect=entry=>{const result=collect(entry);result.responseGuard=hex(q.read(entry.responseAddress+24n,40));return result;};
  active(rig);
  await rig.expect('image context',context(1));
  await rig.expect('image create '+layout.format,packet(src.metadata));
  states.push(model(rig,layout,src.metadata,c,'created'));
  const split=17,entries=[[q.base+0x210000n,split],[q.base+0x220000n,src.backing.length-split]];
  for(const [addr,length] of entries)q.write(addr-8n,new Uint8Array(length+16).fill(0xa3));
  await rig.expect('image attach original split SG',backing(6,entries));
  await rig.expect('image membership',idCommand(0x202,1,6));
  states.push(model(rig,layout,src.metadata,c,'attached'));
  const write=data=>{let at=0;for(const [addr,length] of entries){q.write(addr,data.subarray(at,at+length));at+=length;}c.equal(at,data.length,'complete original SG write');};
  const read=()=>{const out=new Uint8Array(src.backing.length);let at=0;for(const [addr,length] of entries){out.set(q.read(addr,length),at);at+=length;}return out;};
  const guards=()=>entries.map(([addr,length])=>{const prefix=hex(q.read(addr-8n,8)),suffix=hex(q.read(addr+BigInt(length),8));
    c.equal(prefix,'a3'.repeat(8),'SG prefix');c.equal(suffix,'a3'.repeat(8),'SG suffix');return {address:addr.toString(16),length,prefix,suffix};});
  // The backing callback captured A3. Only later live guest RAM contains these words.
  write(src.backing);guards();
  for(const p of src.planes) {
    const start=rig.exchanges.length,raw=mipTransfer(p,1,BigInt(seed)+BigInt(p.level));
    const up=q.enqueue('image mip upload '+p.level,raw);q.kick();q.run();
    c.equal(q.usedIndex(),up.number,'native mip upload admission withholds used');
    const accepted=copy(rig.events.at(-1));c.equal(accepted.type,'beginJob','real mip callback');
    c.same(accepted.resources[0].metadata,src.metadata,'accepted original complete chain');
    await rig.drain();q.collect(up);q.vm.writeMmio(0x64,1);
    const input=rig.exchanges.slice(start).find(v=>v.kind==='input');
    c.truth(input,'actual live gather');c.equal(input.bytes,hex(p.input),'native gathers exact public mip rows');guards();
    planes.push({level:p.level,width:p.width,height:p.height,upload:copy(up),accepted,input});
  }
  const poisoned=new Uint8Array(src.backing.length).fill(0xc7),expected=poisoned.slice();write(poisoned);
  for(let i=0;i<src.planes.length;i++) {
    const p=src.planes[i],start=rig.exchanges.length,down=q.enqueue('image mip read '+p.level,mipTransfer(p,2));
    q.kick();q.run();c.equal(q.usedIndex(),down.number,'native mip read admission withholds used');
    await rig.drain();q.collect(down);q.vm.writeMmio(0x64,1);
    const output=rig.exchanges.slice(start).find(v=>v.kind==='output');c.truth(output,'hardware full-plane output');
    c.equal(output.bytes,hex(src.expected[i]),'independent original public mip inverse');
    const row=p.width*layout.publicPixelBytes;
    for(let y=0;y<p.height;y++)expected.set(src.expected[i].subarray(y*row,(y+1)*row),p.offset+y*p.stride);
    c.equal(hex(read()),hex(expected),'full SG preserves every padding byte and prior level');guards();
    Object.assign(planes[i],{output,backingAfter:hex(read()),guards:guards()});
  }
  states.push(model(rig,layout,src.metadata,c,'read back'));
  const beforeReset=copy(q.vm.inspect()),pending=q.enqueue('image pending reset mip',mipTransfer(src.planes.at(-1),2));
  q.kick();q.run();c.equal(q.usedIndex(),pending.number,'reset target is admitted pending work');
  const staleExchange=rig.exchanges.findLast(v=>v.kind==='output');q.reset();
  c.equal(q.vm.inspect().resources.length,0,'reset clears native owners');
  c.equal(rig.host.bridge.inspect().resources.length,0,'reset clears host owners');
  c.throws(()=>q.vm.gatherInput(...staleExchange.args),'reset revoked well-formed old exchange gather');
  c.throws(()=>q.vm.scatterOutput(...staleExchange.args,src.expected.at(-1)),'reset revoked well-formed old exchange scatter');
  c.equal(hex(read()),hex(expected),'cancelled read publishes no stale guest DMA');guards();
  await rig.expect('image same ID fresh epoch',packet(src.metadata));
  const recreated=model(rig,layout,src.metadata,c,'recreated');
  c.truth(recreated.native.epoch!==beforeReset.epoch,'new epoch on reused image ID');
  await rig.expect('image release',idCommand(0x102,0,6));
  c.equal(q.vm.inspect().logicalBytes,0,'release all public costs');
  c.equal(q.vm.inspect().gpuBytes,0,'release all native GPU costs');
  c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,0,'release all host GPU costs');
  const result={format:layout.format,seed,original:originalRecord(src,layout),states,planes,recreated,
    entries:entries.map(([addr,length])=>({address:addr.toString(16),length})),records:q.records,
    events:rig.events,exchanges:rig.exchanges,completions:rig.completions,snapshot:rig.trace.snapshot(),commandTrace:q.vm.commandTrace(),
    memoryCheckpoint:layout.format===409?{memory:hex(q.read(q.base,q.vm.layout().ramBytes)),sha256:q.vm.machineDigest()}:null};
  window.__desktopActive=null;rig.dispose();return result;
}
async function boundaries(Wasm,Legacy,factory,oldFactory,gl,shaderBridge,c,layouts) {
  const rig=makeRig(Wasm,factory,gl,shaderBridge,c),{q}=rig,rows=[];active(rig);
  const valid=specimen(layouts.find(l=>l.format===67),0).metadata;
  async function refusal(name,m,type=BAD) {
    const before={native:copy(q.vm.inspect()),host:copy(rig.host.bridge.inspect()),objects:rig.trace.objects.size,events:rig.events.length};
    const record=await rig.expect(name,packet(m),type);
    c.same(q.vm.inspect(),before.native,name+' complete native rollback');c.same(rig.host.bridge.inspect(),before.host,name+' complete host rollback');
    c.equal(rig.trace.objects.size,before.objects,name+' no GPU allocation');c.equal(rig.events.length,before.events,name+' no callback');
    rows.push({name,metadata:m,type,before,record});
  }
  for(const [key,value] of [['target',3],['target',4],['format',17],['format',0xffffffff],['bind',0],['bind',1],['bind',0x8000000a],['width',0],['width',16385],['height',0],['height',16385],['depth',2],['arraySize',2],['lastLevel',4],['lastLevel',32],['lastLevel',0xffffffff],['nrSamples',1],['flags',1]])
    await refusal('image invalid '+key+' '+value,{...valid,[key]:value});
  for(const m of [{...valid,width:1025,height:1024,lastLevel:0},{...valid,format:30,width:513,height:512,lastLevel:0},
    {...valid,format:126,bind:9,width:513,height:512,lastLevel:0},{...valid,width:1024,height:1024,lastLevel:1}])
    await refusal('image native whole-resource cost',m,OOM);
  // Exact role classes and both original creation hints allocate real host objects.
  const roles=[];
  for(const [format,binds] of [[65,[2,8,10,262146,262152,262154,1048578,1048584,1048586,1310722,1310728,1310730]],
    [76,[8,262152,1048584,1310728]],[125,[8]],[126,[1,8,9]]]) {
    const layout=layouts.find(l=>l.format===format),m={...specimen(layout,0,3,2,1).metadata};
    for(const bind of binds){m.bind=bind;await rig.expect('image literal role '+format+' '+bind,packet(m));roles.push(model(rig,layout,m,c,'role'));await rig.expect('image role release',idCommand(0x102,0,6));}
  }
  const gpuBudget=[];
  for(let id=1;id<=8;id++) {await rig.expect('image exact aggregate GPU '+id,packet({...valid,id,format:126,bind:9,width:512,height:512,lastLevel:0}));gpuBudget.push(copy(q.vm.inspect()));}
  c.equal(q.vm.inspect().gpuBytes,32*1024*1024,'exact native aggregate GPU budget');
  c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,32*1024*1024,'exact host aggregate GPU budget');
  await refusal('image aggregate GPU plus pixel',{...valid,id:9,format:126,bind:9,width:1,height:1,lastLevel:0},OOM);
  q.reset();
  // Real queue transfers must refuse before callback and preserve all ownership.
  const layout=layouts.find(l=>l.format===30),src=specimen(layout,0);
  await rig.expect('image invalid-transfer context',context(1));await rig.expect('image invalid-transfer create',packet(src.metadata));
  await rig.expect('image invalid-transfer backing',backing(6,[[q.base+0x210000n,4096]]));await rig.expect('image invalid-transfer member',idCommand(0x202,1,6));
  const transfers=[];
  for(const [level,box,offset,stride,layer] of [[4,[0,0,0,1,1,1],0n,0,0],[1,[4,0,0,1,1,1],0n,0,0],
    [1,[0,2,0,1,1,1],0n,0,0],[1,[0,0,1,1,1,1],0n,0,0],[1,[0,0,0,0,1,1],0n,0,0],
    [1,[0,0,0,4,2,1],0n,47,0],[1,[0,0,0,4,2,1],0n,48,95],
    [0,[0,0,0,9,5,1],4096n,0,0],[1,[0,0,0,4,2,1],0xffffffffffffffffn,0,0]]) {
    const raw=transfer(1,6,1,box,offset,stride,layer,0xffffffffffffffffn);set32(raw,60,level);
    const before={native:copy(q.vm.inspect()),submit:copy(q.vm.submitState()),host:copy(rig.host.bridge.inspect()),events:rig.events.length};
    const record=await rig.expect('image malformed transfer '+transfers.length,raw,BAD);
    c.same(q.vm.inspect(),before.native,'invalid transfer native owners unchanged');c.same(q.vm.submitState(),before.submit,'invalid transfer scheduler unchanged');
    c.same(rig.host.bridge.inspect(),before.host,'invalid transfer host unchanged');c.equal(rig.events.length,before.events,'invalid transfer no callback');
    transfers.push({level,box,offset:offset.toString(),stride,layer,before,record});
  }
  const result={rows,roles,gpuBudget,transfers,records:q.records,events:rig.events,commandTrace:q.vm.commandTrace()};window.__desktopActive=null;rig.dispose();
  const old=makeRig(Legacy,oldFactory,gl,shaderBridge,c);
  for(const [m,type] of [[{...valid,lastLevel:0},OK],[valid,BAD],[{...valid,format:65,lastLevel:0},BAD]]) {
    await old.expect('historical native image profile',packet(m),type);if(type===OK)await old.expect('historical image release',idCommand(0x102,0,6));
  }
  result.historical={records:old.q.records,events:old.events};old.dispose();return result;
}
export async function runNativeImageAcceptance({WasmVirglSubmitProof,createVirglStandardDesktopSubmitBridge,createVirglSubmitBridge,layouts,seeds=[0x37a1,0x82cd,0xe419]}) {
  const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(gl,'hardware WebGL2');
  const nativeCalls=[],objects=new WeakMap();let nextObject=1;
  const describe=v=>{if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;
    if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
    if(!objects.has(v))objects.set(v,nextObject++);return {object:objects.get(v),type:v.constructor?.name??'object'};};
  const recordedGl=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{
    const before=args.map(describe),value=v.apply(t,args);nativeCalls.push({sequence:nativeCalls.length,name:k,before,after:args.map(describe),result:describe(value)});return value;};}});
  const info=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);c.truth(gpu.includes('Metal'),'hardware Metal');
  const shaderBridge=await createVirglStandardShadowTextureShaderBridge(),Wasm=Selected(WasmVirglSubmitProof),factory=createVirglStandardDesktopSubmitBridge;
  c.equal(layouts.length,81,'finite literal original image layouts');
  const result={gpu,nativeCalls,guestExecution:false,productionNegotiation:false,runs:[]};window.__desktopProof=result;
  for(const seed of seeds)for(const layout of layouts)result.runs.push(await imageRun(Wasm,factory,recordedGl,shaderBridge,c,layout,seed));
  result.boundaries=await boundaries(Wasm,WasmVirglSubmitProof,factory,createVirglSubmitBridge,recordedGl,shaderBridge,c,layouts);
  result.owners=await acceptedOwners(Wasm,factory,WasmVirglSubmitProof,createVirglSubmitBridge,recordedGl,shaderBridge,c);
  result.orderedDma=await orderedDma(Wasm,factory,recordedGl,shaderBridge,c);
  result.failure=await uncertainGpuFailure(Wasm,factory,recordedGl,shaderBridge,c);
  c.equal(gl.getError(),gl.NO_ERROR,'zero final native GPU error');result.assertions=c.assertions;result.attacks=c.attacks;result.status='passed';
  result.summary={status:result.status,gpu,assertions:c.assertions,formats:layouts.map(v=>v.format),schedules:seeds,
    mipPlanes:result.runs.reduce((n,r)=>n+r.planes.length,0),fullPlanePixels:result.runs.reduce((n,r)=>n+r.original.costs.pixels,0),nativeCalls:nativeCalls.length};return result;
}
