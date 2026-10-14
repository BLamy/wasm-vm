// Independently predicted original topology/capacity and native-query measurements.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {packet,join} from '../../renderer/virgl-command/tests/standard-instanced-draws.mjs';
import {layout,entry,fragmentText} from '../../tools/virgl-stream-output-shaders/fixtures.mjs';
import {createVirglProductionBridge} from '../../renderer/virgl-command/control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const copy=x=>JSON.parse(JSON.stringify(x,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const put=(b,o,x)=>new DataView(b.buffer).setUint32(o,x,true),word=x=>{const d=new DataView(new ArrayBuffer(4));d.setFloat32(0,x,true);return d.getUint32(0,true);};
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nIMM[0] FLT32 {0,0,0,1}\nIMM[1] FLT32 {2,3,4,5}\n0: MOV OUT[0], IMM[0]\n1: MOV OUT[1], IN[0]\n2: MUL OUT[2], IN[0], IMM[1]\n3: END\n';
const words=layout([10,12,0,0],[entry(1,0,4,0,2),entry(2,0,4,1,3)]);
function shader(handle,stage,text,words=[0]){const extra=words[0]?words.slice(1):[],b=packet(1,4,[handle,stage,text.length+1,8192,words[0],...extra,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24+extra.length*4);return b;}
function resource(id,bind,size){const b=header(0x204,0,72);[id,0,64,bind,size,1,1,1,0,0,0,0].forEach((x,i)=>put(b,24+4*i,x));return b;}
const query=(id,res)=>packet(1,9,[id,6,0xffffffff,res]),begin=id=>packet(19,0,[id]),end=id=>packet(20,0,[id]),get=id=>packet(21,0,[id,0]);
const draw=(mode,count,indexed=false)=>packet(8,0,[indexed?0xffffffff:0,count,mode,indexed?1:0,1,0,0,indexed?1:0,indexed?0xffffffff:0,0,7,0]);
const SPECS=[
 {name:'mixed-two-output',capacity:[24,24],count:11,phases:[{mode:5,n:5,order:[0,1,2,2,1,3,2,3,4],raw:9},{mode:3,n:4,order:[0,1,1,2,2,3],raw:6},{mode:0,n:5,order:[0,1,2,3,4],raw:5}]},
 {name:'asymmetric-capacity-two-output',capacity:[12,11],count:4,phases:[{mode:5,n:5,order:[0,1,2,2,1,3,2,3,4],raw:9},{mode:3,n:4,order:[0,1],raw:2},{mode:0,n:5,order:[],raw:0}]},
 {name:'restart-asymmetric-capacity',capacity:[14,13],count:5,index:[3,1,4,0xffffffff,6,2,5,7],phases:[{mode:5,n:8,indexed:true,order:[3,1,4,6,2,5,5,2,7],raw:9},{mode:3,n:4,order:[0,1,1,2],raw:4},{mode:0,n:5,order:[],raw:0}]},
 {name:'zero-complete-primitive',capacity:[1,1],count:0,phases:[{mode:4,n:1,order:[],raw:0}]}
];
SPECS.push({...SPECS[0],name:'mixed-without-query',noQuery:true});
for(const fault of ['fractional','nonintegral','out-of-u32','aggregate-overflow'])SPECS.push({...SPECS[0],name:'native-'+fault,fault});
function memory(rig,id,size,c){const lengths=[7,11,19,size-37],segments=[];let at=rig.q.base+0x210000n+BigInt(id)*0x2000n;
 for(const n of lengths){const p=at+8n;rig.q.write(at,new Uint8Array(n+16).fill(0xa3));segments.push([p,n]);at+=BigInt(n+16);}return {attach:backing(id,segments),write(b){c.equal(b.length,size,'original SG extent');let o=0;for(const[p,n]of segments){rig.q.write(p,b.subarray(o,o+n));o+=n;}},read(){const b=new Uint8Array(size);let o=0;for(const[p,n]of segments){b.set(rig.q.read(p,n),o);o+=n;}return b;},guards(){for(const[p,n]of segments){c.same([...rig.q.read(p-8n,8)],Array(8).fill(0xa3),'SG prefix');c.same([...rig.q.read(p+BigInt(n),8)],Array(8).fill(0xa3),'SG suffix');}}};}
async function one(Wasm,profile,native,compiler,schedule,spec){
 const c=checker(),row={name:spec.name+'/schedule'+schedule,spec,predictions:{logical:spec.noQuery?'not requested':spec.count,rawFirstOutput:spec.noQuery?[]:spec.phases.filter(x=>x.raw).map(x=>x.raw),duplicate:'Each second output pass physically captures matching data but contributes no query measurement.',pending:'Unavailable isWAIT2 with prior poisoned words, never DONE/false.'},native:[],outputs:[],reads:[]};
 const identities=new WeakMap(),handles=[];let next=1,holdFirst=false,injectFault=false;const enc=v=>ArrayBuffer.isView(v)?[...v]:v&&typeof v==='object'?(()=>{if(!identities.has(v))identities.set(v,next++);return {object:identities.get(v),type:v.constructor.name};})():v;
 const gl=new Proxy(native,{get(t,k){const f=Reflect.get(t,k,t);if(typeof f!=='function')return f;return(...a)=>{const actual=f.apply(t,a);if(k==='createQuery'&&actual)handles.push(actual);let delivered=k==='getQueryParameter'&&a[1]===native.QUERY_RESULT_AVAILABLE&&holdFirst&&(spec.fault?a[0]!==handles[1]:a[0]===handles[spec.count===0?1:0])?false:actual;
 if(k==='getQueryParameter'&&a[1]===native.QUERY_RESULT&&injectFault&&a[0]!==handles[1]){
  if(spec.fault==='fractional')delivered=actual+.5;
  else if(spec.fault==='nonintegral')delivered=actual+1;
  else if(spec.fault==='out-of-u32')delivered=0x100000000;
  else delivered=actual===6?0xfffffffe:0xffffffff;
 }row.native.push({name:k,args:a.map(enc),result:enc(actual),...(k==='getQueryParameter'?{actual,delivered}:{})});return delivered;};}});
 const Selected=class{constructor(cb){return Wasm.qualified(cb,profile.hostWords,profile.formatRoles,profile.renderer);}},rig=makeRig(Selected,o=>createVirglProductionBridge({...o,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,schedule,true,false,true),ram=new Map();
 const send=(label,b,ctx=1,status=0x1100)=>rig.expect(label,submission(ctx,b),status),initial=new Uint8Array(32).fill(0x91);put(initial,0,0);put(initial,4,0x55667788);put(initial,8,0x11223344);put(initial,12,0xaabbccdd);
 const result=async(id,state,value,ctx=1)=>{ram.get(id).write(new Uint8Array(64).fill(0xc7));await rig.expect('original result SG read'+id,transfer(ctx,id,2,[0,0,0,32,1,1],5n));const actual=ram.get(id).read(),expected=new Uint8Array(64).fill(0xc7),body=new Uint8Array(initial);put(body,0,state);if(state===1){put(body,4,4);put(body,8,value);put(body,12,0);}expected.set(body,5);row.reads.push({id,state,value,actual:[...actual],expected:[...expected]});c.same([...actual],[...expected],'exact original state/count/u64/padding');ram.get(id).guards();};
 try{
  await rig.expect('original context1',context(1));await rig.expect('original context2',context(2));
  for(const[id,bind,size]of [[1,2160,4096],[2,2160,4096],[3,112,4096],[4,112,4096],[10,131072,32],[11,131072,32]]){
   await rig.expect('original resource'+id,resource(id,bind,size));const m=memory(rig,id,id>=10?64:4096,c);ram.set(id,m);await rig.expect('original backing'+id,m.attach);await rig.expect('original member'+id,idCommand(0x202,id===11?2:1,id));const bytes=new Uint8Array(id>=10?64:4096).fill(0xa7);if(id>=10)bytes.set(initial);m.write(bytes);await rig.expect('original upload'+id,transfer(id===11?2:1,id,1,[0,0,0,size,1,1]));
  }
  const input=Array.from({length:8},(_,i)=>[i+1,i+11,i+21,i+31]),source=new Uint8Array(4096).fill(0xa7);source.set(new Uint8Array(new Float32Array(input.flat()).buffer));ram.get(3).write(source);await rig.expect('literal original vertices',transfer(1,3,1,[0,0,0,4096,1,1]));
  if(spec.index){const b=new Uint8Array(4096).fill(0xed);b.set(new Uint8Array(new Uint32Array(spec.index).buffer),8);ram.get(4).write(b);await rig.expect('literal original index words/prefix',transfer(1,4,1,[0,0,0,4096,1,1]));}
  await send('original captures/shader/layout',join(shader(10,0,vertex,words),shader(11,1,fragmentText),packet(1,5,[20,0,0,0,31]),packet(2,5,[20]),packet(6,0,[16,0,3]),packet(1,2,[21,2|8|1<<29,word(1),0,65535,word(1),0,0,0]),packet(2,2,[21]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,10,[40,1,16,spec.capacity[0]*40]),packet(1,10,[41,2,16,spec.capacity[1]*48]),packet(25,0,[0,40,41]),...(spec.noQuery?[]:[query(300,10),begin(300)])));
  const expected=[new Uint8Array(4096).fill(0xa7),new Uint8Array(4096).fill(0xa7)];let cursor=0;holdFirst=!spec.noQuery;
  for(const [i,phase]of spec.phases.entries()){
   await send('original topology'+i,join(packet(11,0,phase.indexed?[4,4,8]:[0]),draw(phase.mode,phase.n,phase.indexed)));
   for(const v of phase.order){for(let b=0;b<2;b++)for(let lane=0;lane<4;lane++)new DataView(expected[b].buffer).setFloat32(16+cursor*(b?48:40)+(b?3:2)*4+lane*4,input[v][lane]*(b?[2,3,4,5][lane]:1),true);cursor++;}
   if(i===0){await send('other context same query handle empty',join(query(300,11),begin(300),end(300),get(300)),2);await result(11,1,0,2);}
  }
  if(!spec.noQuery){await send('original feedback query pending',join(end(300),get(300)));await result(10,2,undefined);
  c.truth(row.native.some(x=>x.name==='getQueryParameter'&&x.actual===true&&x.delivered===false),'actual native availability withheld for first part');}
  else await result(10,0,undefined);
  holdFirst=false;
  if(spec.fault){
   injectFault=true;const writes=row.native.filter(x=>x.name==='bufferSubData').length;
   await send('original invalid counter delivery refuses',get(300),1,0x1201);
   const cancelled=rig.host.bridge.inspect().renderer.budgets.queries.pending===0;
   await send('original continuing counter fault refuses',get(300),1,cancelled?0x1205:0x1201);
   c.equal(row.native.filter(x=>x.name==='bufferSubData').length,writes,'invalid counters never overwrite WAIT with DONE');
   injectFault=false;
   if(spec.fault==='aggregate-overflow'){
    await send('healthy other context remains usable after rejected aggregate',get(300),2);
    await result(11,1,0,2);
    await send('original rejected query can be destroyed',packet(3,9,[300]));
    await send('original same-name fresh empty query recovers',join(query(300,10),begin(300),end(300),get(300)));await result(10,1,0);
   }else{await send('fresh validated native count after removal',get(300));await result(10,1,spec.count);}
  }else if(!spec.noQuery){await send('original logical count after real ready',get(300));await result(10,1,spec.count);}
  await result(11,1,0,2);
  for(let b=0;b<2;b++){ram.get(b+1).write(new Uint8Array(4096).fill(0x6b));await rig.expect('complete native captured output'+b,transfer(1,b+1,2,[0,0,0,4096,1,1]));const actual=ram.get(b+1).read();row.outputs.push({buffer:b,expected:[...expected[b]],actual:[...actual]});c.same([...actual],[...expected[b]],'literal captured values/stride/padding in complete4096-byte output'+b);ram.get(b+1).guards();}
  const raw=row.native.filter(x=>x.name==='getQueryParameter'&&x.args[1]===native.QUERY_RESULT&&x.delivered===x.actual).map(x=>x.actual);row.actualRawResults=raw;
  // Other context's empty query contributes0; every original capture measures first pass only.
  if(!spec.noQuery&&spec.fault!=='aggregate-overflow')c.same(raw.filter(x=>x!==0).sort((a,b)=>a-b),spec.phases.filter(x=>x.raw).map(x=>x.raw).sort((a,b)=>a-b),'actual nonzero native point counts are measured once per original draw');
  if(spec.noQuery){c.same(raw,[0],'only other owner empty measurement, no queried capture parts');c.equal(row.native.filter(x=>x.name==='beginQuery').length,1,'only other owner empty native query');}
  c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'all physical measurements retired');c.equal(native.getError(),native.NO_ERROR,'native feedback/query APIs error-free');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
 finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=copy(rig.trace.snapshot());row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}}return row;
}
export async function runProductionFeedbackQueriesCritic({WasmVirglSubmitProof,schedules=[271828],modes=SPECS.map(x=>x.name)}){
 if(!schedules.length||schedules.some(x=>!Number.isInteger(x)||x<0||x>0xffffffff)||!modes.length||modes.some(name=>!SPECS.some(spec=>spec.name===name)))throw Error('Original feedback critic requires valid schedules and known modes.');
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),profile=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',rows:[],hardware:profile.identity};window.__productionCriticReport=report;
 for(const schedule of schedules)for(const spec of SPECS.filter(x=>modes.includes(x.name))){const row=await one(WasmVirglSubmitProof,profile,native,compiler,schedule,spec),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
 report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed'),hardware:profile.identity};return report;
}
