// Independent original MMIO query interleaving, exact pending bytes and native ceiling.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {packet,join,shader,word} from '../virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../../renderer/virgl-command/control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString():x));
const put=(b,o,v)=>new DataView(b.buffer).setUint32(o,v,true);
const query=(id,type,resource)=>packet(1,9,[id,type,0x7fffffff,resource]);
const begin=id=>packet(19,0,[id]),end=id=>packet(20,0,[id]),get=id=>packet(21,0,[id,1]);
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
function allocate(id,target,format,bind,width,height=1){const b=header(0x204,0,72);[id,target,format,bind,width,height,1,1,0,0,0,0].forEach((v,i)=>put(b,24+i*4,v));return b;}
function clear(){const d=new ArrayBuffer(8),v=new DataView(d);v.setFloat64(0,.25,true);return packet(7,0,[5,word(0),word(0),word(1),word(1),v.getUint32(0,true),v.getUint32(4,true),0]);}
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,1,0,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';

async function one(Wasm,profile,native,compiler,schedule,mode){
 const c=checker(),row={name:mode+'/schedule'+schedule,predictions:{
  interleave:'A strict greater-depth quad is true; different-context and different-subcontext empty queries with the same handle are independently ready false. Pending preserves the poisoned prior twelve result bytes.',
  budget:'Sixteen original jobs of256 native quad draws retain4096 real query parts; next draw refuses before draw/query allocation; END/GET retires all parts and returns actual true.',
  invalid:'Repeated invalid native result/availability/error delivery must refuse with no result-buffer write; after removal a fresh validated native empty result0 publishes exact DONE/false.',
  framing:'Each original query command refuses short and long payloads before native query or result-write effects; the following valid empty lifecycle remains false.'},native:[],reads:[]};
 const handles=[];let holdFirst=false,invalidResult=false,invalidAvailability=false,nativeResultError=false,pendingError=false;
 const gl=new Proxy(native,{get(target,name){const fn=Reflect.get(target,name,target);if(typeof fn!=='function')return fn;
  return(...args)=>{const actual=fn.apply(target,args);if(name==='createQuery'&&actual)handles.push(actual);
   if(name==='getQueryParameter'&&args[1]===native.QUERY_RESULT&&nativeResultError)pendingError=true;
   let delivered=name==='getQueryParameter'&&args[1]===native.QUERY_RESULT_AVAILABLE&&invalidAvailability?1:
     name==='getQueryParameter'&&args[1]===native.QUERY_RESULT_AVAILABLE&&holdFirst&&args[0]===handles[0]?false:
     name==='getQueryParameter'&&args[1]===native.QUERY_RESULT&&invalidResult?2:actual;
   if(name==='getError'&&pendingError){pendingError=false;delivered=native.INVALID_OPERATION;}
   row.native.push({name,args:args.map(x=>ArrayBuffer.isView(x)?[...x]:typeof x==='object'?x?.constructor.name:x),...(name==='getQueryParameter'||name==='getError'?{actual,delivered}:{})});return delivered;};}});
 const Selected=class{constructor(cb){return Wasm.qualified(cb,profile.hostWords,profile.formatRoles,profile.renderer);}};
 const rig=makeRig(Selected,o=>createVirglProductionBridge({...o,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,schedule,true,false,true);
 const addresses=new Map(),send=(label,bytes,ctx=1,status=0x1100)=>rig.expect(label,submission(ctx,bytes),status);
 const initial=new Uint8Array(32).fill(0x91);put(initial,0,0);put(initial,4,0x33557799);put(initial,8,0x87654321);put(initial,12,0x1234abcd);
 const read=async(id,state,value,ctx=1)=>{
  const a=addresses.get(id);rig.q.write(a,new Uint8Array(64).fill(0xa7));
  await rig.expect('critic original result transfer'+id,transfer(ctx,id,2,[0,0,0,32,1,1],5n));
  const bytes=rig.q.read(a,64),expected=new Uint8Array(64).fill(0xa7),body=new Uint8Array(initial);put(body,0,state);
  if(state===1){put(body,4,4);put(body,8,value);put(body,12,0);}expected.set(body,5);
  row.reads.push({id,context:ctx,state,value,actual:[...bytes],expected:[...expected]});c.same([...bytes],[...expected],'full original32-byte result and all64-byte guard extent');return bytes;
 };
 const nativeCalls=name=>row.native.filter(x=>x.name===name).length;
 try{
  await rig.expect('critic context1',context(1));await rig.expect('critic context2',context(2));
  for(const[id,target,format,bind,width,height,length]of[[1,2,67,2,4,4,64],[2,0,64,16,64,1,64],[3,2,16,1,4,4,32]]){
   const a=rig.q.base+0x210000n+BigInt(id)*0x1000n;addresses.set(id,a);
   await rig.expect('critic allocate'+id,allocate(id,target,format,bind,width,height));await rig.expect('critic backing'+id,backing(id,[[a,length]]));await rig.expect('critic member'+id,idCommand(0x202,1,id));
  }
  for(let id=10;id<=13;id++){
   const a=rig.q.base+0x240000n+BigInt(id)*0x1000n;addresses.set(id,a);rig.q.write(a,new Uint8Array(64).fill(0x91));rig.q.write(a,initial);
   await rig.expect('critic query allocate'+id,allocate(id,0,64,131072,32));await rig.expect('critic query backing'+id,backing(id,[[a,64]]));
   await rig.expect('critic query member1 '+id,idCommand(0x202,1,id));await rig.expect('critic query member2 '+id,idCommand(0x202,2,id));
   await rig.expect('critic original poisoned state upload'+id,transfer(1,id,1,[0,0,0,32,1,1]));
  }
  rig.q.write(addresses.get(2),new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,1,0,1]).buffer));
  await rig.expect('critic original vertex upload',transfer(1,2,1,[0,0,0,64,1,1]));
  await send('critic raster state',join(shader(10,0,vertex),shader(11,1,fragment),packet(31,0,[10,0]),packet(31,0,[11,1]),
   packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,2]),packet(1,8,[20,1,67,0,0]),packet(1,8,[21,3,16,0,0]),packet(5,0,[1,21,20]),
   packet(4,0,[0,...[2,2,.5,2,2,.5].map(word)]),packet(1,1,[30,0,0,15<<27,0,0,0,0,0,0,0]),packet(2,1,[30]),
   packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),packet(1,3,[50,17,0,0,0]),packet(2,3,[50]),clear(),query(300,1,10)));
  if(mode==='framing'){
   const beforeQueries=nativeCalls('createQuery'),beforeWrites=nativeCalls('bufferSubData');
   for(const [label,op,type,fields]of [['short query',1,9,[301,1,0]],['long query',1,9,[301,1,0,10,0]],['short begin',19,0,[]],['long begin',19,0,[300,0]],['short end',20,0,[]],['long end',20,0,[300,0]],['short get',21,0,[300]],['long get',21,0,[300,0,0]]])await send('critic exact original framing '+label,packet(op,type,fields),1,0x1205);
   c.equal(nativeCalls('createQuery'),beforeQueries,'malformed packets have no native query effect');c.equal(nativeCalls('bufferSubData'),beforeWrites,'malformed packets have no native result publication');
   await send('critic valid lifecycle after malformed packets',join(begin(300),end(300),get(300)));await read(10,1,0);
  }else if(mode==='interleave'){
   holdFirst=true;await send('critic A active draw',join(begin(300),draw()));
   await send('critic B empty same handle other context',join(query(300,11,11),begin(300),end(300),get(300)),2);await read(11,1,0,2);
   await send('critic C empty same handle other subcontext',join(packet(29,0,[4]),packet(28,0,[4]),query(300,1,12),begin(300),end(300),get(300),packet(28,0,[0])));await read(12,1,0);
   await send('critic A pending original no-wait',join(end(300),get(300)));await read(10,2);
   c.truth(row.native.some(x=>x.name==='getQueryParameter'&&x.actual===true&&x.delivered===false),'native availability was observed before controlled withholding');
   holdFirst=false;await send('critic A true after native availability',get(300));await read(10,1,1);
   await send('critic depth LESS fails against quarter clear',join(packet(1,3,[51,5,0,0,0]),packet(2,3,[51]),begin(300),draw(),end(300),get(300)));await read(10,1,0);
   await read(11,1,0,2);await read(12,1,0);
   await rig.expect('critic literal yellow quad readback',transfer(1,1,2,[0,0,0,4,4,1]));
   const pixels=rig.q.read(addresses.get(1),64);for(let at=0;at<64;at+=4)c.same([...pixels.slice(at,at+4)],[255,255,0,255],'quarter-depth native yellow pixel'+at/4);
  }else if(mode==='budget'){
   await send('critic query budget begins',begin(300));const batch=join(...Array.from({length:256},draw));
   for(let i=0;i<16;i++)await send('critic actual256-draw batch'+i,batch);
   c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,4096,'global real native query part ceiling reached');
   const beforeDraw=nativeCalls('drawArrays'),beforeQuery=nativeCalls('createQuery');await send('critic native part4097 refuses',draw(),1,0x1201);
   c.equal(nativeCalls('drawArrays'),beforeDraw,'ceiling refusal has no native draw');c.equal(nativeCalls('createQuery'),beforeQuery,'ceiling refusal has no native query allocation');
   await send('critic4096 actual measurements collect',join(end(300),get(300)));await read(10,1,1);
   c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'all4096 native query parts retire');
  }else{
   await send('critic real empty measurement',join(begin(300),end(300)));
   invalidResult=mode==='invalid-result';invalidAvailability=mode==='invalid-availability';nativeResultError=mode==='native-result-error';
   c.truth(invalidResult||invalidAvailability||nativeResultError,'explicit native fault mode selected');
   const beforeWrites=nativeCalls('bufferSubData');
   await send('critic malformed delivered native query read rejects',get(300),1,0x1201);
   await send('critic continuing invalid native read rejects again',get(300),1,0x1201);
   c.equal(nativeCalls('bufferSubData'),beforeWrites,'rejected native reads never write DONE over WAIT');
   c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,1,'rejected native part remains available for actual retry');
   if(invalidResult)c.truth(row.native.some(x=>x.name==='getQueryParameter'&&x.actual===0&&x.delivered===2),'underlying actual native empty result was zero');
   if(invalidAvailability)c.truth(row.native.some(x=>x.name==='getQueryParameter'&&typeof x.actual==='boolean'&&x.delivered===1),'actual boolean availability is observed before invalid type delivery');
   if(nativeResultError)c.truth(row.native.some(x=>x.name==='getError'&&x.actual===native.NO_ERROR&&x.delivered===native.INVALID_OPERATION),'actual native read is observed before error delivery');
   invalidResult=false;invalidAvailability=false;nativeResultError=false;
   const beforeResults=row.native.filter(x=>x.name==='getQueryParameter'&&x.args[1]===native.QUERY_RESULT).length;
   await read(10,1,0);
   c.truth(row.native.filter(x=>x.name==='getQueryParameter'&&x.args[1]===native.QUERY_RESULT).length>beforeResults,'recovery requires a fresh actual result read');
   c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'validated actual false retires the rejected query part');
  }
  c.equal(native.getError(),native.NO_ERROR,'all real native API calls are error-free');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
 finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=copy(rig.trace.snapshot());row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}}
 return row;
}
export async function runProductionBooleanQueriesCritic({WasmVirglSubmitProof,schedules=[161803],modes=['interleave','budget','invalid-result','invalid-availability','native-result-error','framing']}){
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),profile=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge();
 const report={status:'running',rows:[],hardware:profile.identity};window.__productionCriticReport=report;
 for(const schedule of schedules)for(const mode of modes){const row=await one(WasmVirglSubmitProof,profile,native,compiler,schedule,mode),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
 report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed'),hardware:profile.identity};return report;
}
