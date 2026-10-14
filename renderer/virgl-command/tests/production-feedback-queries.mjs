import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join,word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {entry,layout,fragmentText} from '../../../tools/virgl-stream-output-shaders/fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {loss as queryLoss} from './production-boolean-queries.mjs';
import {decodeProductionSubmission,decodeStandardStreamOutputSubmission} from '../decoder.mjs';
const copy=x=>JSON.parse(JSON.stringify(x,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const put=(b,o,v)=>new DataView(b.buffer).setUint32(o,v,true);
function resource(id,bind,size){const b=header(0x204,0,72);[id,0,64,bind,size,1,1,1,0,0,0].forEach((v,i)=>put(b,24+i*4,v));return b;}
function shader(handle,stage,text,words=[0]){const extra=words[0]?words.slice(1):[],b=packet(1,4,[handle,stage,text.length+1,8192,words[0],...extra,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24+extra.length*4);return b;}
const VERTEX='VERT\nDCL IN[0]\nDCL SV[0], VERTEXID\nDCL SV[1], INSTANCEID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\nIMM[0] FLT32 {0,0,0,1}\n0: MOV OUT[0], IMM[0]\n1: MOV OUT[1], IN[0]\n2: MOV OUT[2].x, SV[0].xxxx\n3: MOV OUT[3].x, SV[1].xxxx\n4: END\n';
const WORDS=layout([8,8,8,8],[entry(1,0,4,0,2),entry(2,0,1,1,3),entry(3,0,1,2,4),entry(2,0,1,3,5)]);
const query=(h,r,type=6)=>packet(1,9,[h,type,0xffffffff,r]),begin=h=>packet(19,0,[h]),end=h=>packet(20,0,[h]),get=h=>packet(21,0,[h,0]);
const draw=(spec,instances=3)=>packet(8,0,[spec.indexed?0:spec.source[0]??0,spec.source.length,spec.mode,spec.indexed?1:0,instances,0,0,spec.restart!==undefined?1:0,spec.restart??0,0,15,0]);
// Literal primitive identities are independent of the renderer's assembler.
const SPECS=[
 {name:'points',mode:0,source:[1,2,3,4,5,6],order:[1,2,3,4,5,6],primitive:1},
 {name:'lines-incomplete',mode:1,source:[1,2,3,4,5,6,7],order:[1,2,3,4,5,6],primitive:2},
 {name:'line-loop',mode:2,source:[1,2,3,4],order:[1,2,2,3,3,4,4,1],primitive:2},
 {name:'line-strip',mode:3,source:[1,2,3,4],order:[1,2,2,3,3,4],primitive:2},
 {name:'triangles-incomplete',mode:4,source:[1,2,3,4,5,6,7],order:[1,2,3,4,5,6],primitive:3},
 {name:'triangle-strip',mode:5,source:[1,2,3,4,5],order:[1,2,3,3,2,4,3,4,5],primitive:3},
 {name:'triangle-fan',mode:6,source:[1,2,3,4,5],order:[1,2,3,1,3,4,1,4,5],primitive:3},
 {name:'restart-strip',mode:5,source:[3,1,4,119,6,2,5,8],order:[3,1,4,6,2,5,5,2,8],primitive:3,indexed:true,restart:119},
 {name:'restart-loop',mode:2,source:[3,1,4,119,6,2,5,8],order:[3,1,1,4,4,3,6,2,2,5,5,8,8,6],primitive:2,indexed:true,restart:119},
 {name:'no-complete-triangle',mode:4,source:[1,2],order:[],primitive:3}
];
async function one(Wasm,profile,native,compiler,schedule){
 const c=checker(),row={name:'logical-feedback/schedule'+schedule,native:[],cases:[],predictions:{counts:'Actual POINTS count is divided per original draw; duplicate output passes do not contribute.',bytes:'All four output buffers preserve exact literal primitive/instance identities and padding.',empty:'Empty and capacity-exhausted capture return actual native zero.',pending:'Availability is asynchronous and never fabricates DONE.'}};
 let hold=false,scatterFault=false,scatterFaultHits=0;const ids=new WeakMap();let next=1;const enc=v=>{if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:[...new Uint8Array(v.buffer,v.byteOffset,v.byteLength)]};if(v&&typeof v==='object'){if(!ids.has(v))ids.set(v,next++);return {id:ids.get(v),type:v.constructor.name};}return v;};
 const gl=new Proxy(native,{get(t,k){const method=Reflect.get(t,k,t);if(typeof method!=='function')return method;return(...args)=>{const actual=method.apply(t,args);if(scatterFault&&k==='copyBufferSubData'){native.enable(0xdead);scatterFault=false;scatterFaultHits++;}const delivered=k==='getQueryParameter'&&args[1]===native.QUERY_RESULT_AVAILABLE&&hold?false:actual;row.native.push({name:k,args:args.map(enc),result:enc(actual),...(delivered!==actual?{delivered}:{}),...(k==='getBufferSubData'?{after:args.map(enc)}:{})});return delivered;};}});
 const Selected=class{constructor(cb){return Wasm.qualified(cb,profile.hostWords,profile.formatRoles,profile.renderer);}},rig=makeRig(Selected,o=>createVirglProductionBridge({...o,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,schedule,true,false,true),addresses=new Map();
 const send=(label,bytes,ctx=1,status=0x1100)=>rig.expect(label,submission(ctx,bytes),status);
 const upload=async(id,bytes)=>{const b=new Uint8Array(4096).fill(0xa7);b.set(bytes);rig.q.write(addresses.get(id),b);await rig.expect('original buffer upload'+id,transfer(1,id,1,[0,0,0,4096,1,1]));};
 const readQuery=async(id,state,value,ctx=1)=>{const address=addresses.get(id);rig.q.write(address,new Uint8Array(4096).fill(0x6b));await rig.expect('original16-byte query readback',transfer(ctx,id,2,[0,0,0,16,1,1]));const b=rig.q.read(address,32),expected=new Uint8Array(32).fill(0x6b);put(expected,0,state);put(expected,4,state===1?4:0);put(expected,8,value);put(expected,12,0);c.same([...b],[...expected],'original query state/result_size/count/high0 and poisoned padding');return [...b];};
 const vertices=Array.from({length:16},(_,i)=>[0x3f800000+i,0x80000000,0x01230000+i,0xff800000+i]);
 const setupState=()=>send('original stream-output state',join(shader(20,0,VERTEX,WORDS),shader(21,1,fragmentText),packet(31,0,[20,0]),packet(31,0,[21,1]),packet(1,5,[22,0,0,0,196]),packet(2,5,[22]),packet(6,0,[16,0,5]),packet(1,2,[23,2|8|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[23]),query(90,10),...[1,2,3,4].map(id=>packet(1,10,[40+id,id,16,64*32]))));
 let casesStarted=0;
 const captureCase=async(name,specs,capacity,instances=3)=>{
  if(casesStarted++){await rig.expect('retire previous capture context',header(0x201,1,24));await rig.expect('new bounded capture context',context(1));for(const id of addresses.keys())await rig.expect('new context original membership'+id,idCommand(0x202,1,id));await setupState();}
  for(let id=1;id<=4;id++)await upload(id,new Uint8Array());
  await send('replace original target tuple '+name,join(packet(25,0,[0]),...[1,2,3,4].map(id=>packet(3,10,[40+id])),...[1,2,3,4].map(id=>packet(1,10,[40+id,id,16,capacity[id-1]*32])),packet(25,0,[0,41,42,43,44])));
  const expected=Array.from({length:4},()=>new Uint8Array(4096).fill(0xa7)),oracle=[];let cursor=0,count=0;
  await send('begin feedback '+name,begin(90));
  for(const spec of specs){if(spec.indexed)await upload(6,new Uint8Array(new Uint32Array(spec.source).buffer));await send('original index role '+name,packet(11,0,spec.indexed?[6,4,0]:[0]));
   const available=Math.floor((Math.min(...capacity)-cursor)/spec.primitive)*spec.primitive,ordered=[];for(let instance=0;instance<instances;instance++)for(const vertex of spec.order)ordered.push({vertex,instance});const captured=ordered.slice(0,available);count+=captured.length/spec.primitive;
   for(const [i,{vertex,instance}]of captured.entries())for(let buffer=0;buffer<4;buffer++){const words=buffer===0?vertices[vertex]:[buffer===2?instance:vertex];words.forEach((v,lane)=>put(expected[buffer],16+(cursor+i)*32+[2,3,4,5][buffer]*4+lane*4,v));}
   oracle.push({spec:spec.name,primitive:spec.primitive,captured,logical:captured.length/spec.primitive});cursor+=captured.length;
   await send('actual original feedback draw '+name+'/'+spec.name,draw(spec,instances));
  }
  await send('end/result '+name,join(end(90),get(90)));const result=await readQuery(10,1,count);
  const actual=[];for(let id=1;id<=4;id++){rig.q.write(addresses.get(id),new Uint8Array(4096).fill(0x6b));await rig.expect('full original captured data readback'+id,transfer(1,id,2,[0,0,0,4096,1,1]));const b=rig.q.read(addresses.get(id),4096);c.same([...b],[...expected[id-1]],'all captured native bytes '+name+'/'+id);actual.push([...b]);}
  row.cases.push({name,capacity,instances,oracle,logicalCount:count,result,actual,expected:expected.map(b=>[...b])});await send('ready result repeat '+name,get(90));await readQuery(10,1,count);
 };
 try{
  await rig.expect('context1',context(1));await rig.expect('context2',context(2));
  for(const id of [1,2,3,4,5,6,10,11,12,13]){const address=rig.q.base+0x210000n+BigInt(id)*0x2000n;addresses.set(id,address);await rig.expect('original resource'+id,resource(id,id>=10?131072:id<=4?2160:112,4096));await rig.expect('original backing'+id,backing(id,[[address,4096]]));await rig.expect('original member1 '+id,idCommand(0x202,1,id));if(id>=10)await rig.expect('original member2 '+id,idCommand(0x202,2,id));await upload(id,new Uint8Array(id>=10?16:0));}
  await upload(5,new Uint8Array(new Uint32Array(vertices.flat()).buffer));
  await setupState();
  for(const spec of SPECS){await captureCase(spec.name,[spec],[64,64,64,64]);await captureCase(spec.name+'/truncated',[spec],[spec.primitive*2+1,spec.primitive*2+1,spec.primitive*2+1,spec.primitive*2+1]);}
  await captureCase('mixed-topologies',[SPECS[5],SPECS[3],{...SPECS[0],source:[1,2,3,4,5],order:[1,2,3,4,5]}],[64,64,64,64],1);
  await captureCase('mixed-capacity',[SPECS[5],SPECS[3],{...SPECS[0],source:[1,2,3,4,5],order:[1,2,3,4,5]}],[12,11,12,12],1);
  await captureCase('fully-exhausted',[SPECS[5]],[1,1,1,1]);
  await upload(11,new Uint8Array(16));hold=true;await send('empty held availability',join(query(91,11),begin(91),end(91),get(91)));await readQuery(11,2,0);c.truth(row.native.some(r=>r.name==='getQueryParameter'&&r.result===true&&r.delivered===false),'availability withheld only after actual native read');hold=false;await send('empty actual result retry',get(91));await readQuery(11,1,0);
  await send('feedback and boolean can coexist',join(begin(90),query(92,12,1),begin(92),end(92),get(92),end(90),get(90)));await readQuery(10,1,0);await readQuery(12,1,0);
  await send('owner1 feedback active',begin(90));await send('context2 feedback same handle',join(query(90,13),begin(90),end(90),get(90)),2);await readQuery(13,1,0,2);
  await send('subcontext feedback same handle',join(packet(29,0,[7]),packet(28,0,[7]),query(90,13),begin(90),end(90),get(90),packet(28,0,[0])));await readQuery(13,1,0);await send('end owner1',join(end(90),get(90)));await readQuery(10,1,0);
  await send('feedback overlap refuses',join(begin(90),begin(91)),1,0x1205);await send('get active refuses',get(90),1,0x1205);await send('destroy active feedback',packet(3,9,[90]));await send('recreate handle',join(query(90,10),begin(90),end(90),get(90)));await readQuery(10,1,0);
  for(const type of [0,2,3,4,5,7,8,9,10,12,0xffff])c.bad(decodeProductionSubmission(query(200,10,type)),'unsupported query target','unsupported-query');c.bad(decodeProductionSubmission(query(200,10,6|(1<<16))),'index1','unsupported-query');c.bad(decodeStandardStreamOutputSubmission(query(200,10)),'private profile','unsupported-object');
  await upload(10,new Uint8Array(16));await send('fresh fault capture tuple',join(packet(25,0,[0]),...[1,2,3,4].map(id=>packet(3,10,[40+id])),...[1,2,3,4].map(id=>packet(1,10,[40+id,id,16,64*32])),packet(25,0,[0,41,42,43,44]),begin(90)));
  scatterFault=true;await send('actual native scatter error invalidates feedback',draw(SPECS[5],1),1,0x1201);c.equal(scatterFaultHits,1,'one actual native GL error injected after real scatter');await send('partial capture END refuses',end(90),1,0x1205);await send('partial capture GET refuses',get(90),1,0x1205);await readQuery(10,0,0);c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'failed capture collects native parts');
  await send('healthy empty lifecycle after failure',join(begin(90),end(90),get(90)));await readQuery(10,1,0);
  await rig.expect('context2 destroy',header(0x201,2,24));await rig.expect('context1 destroy',header(0x201,1,24));c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'native query parts retired');
  await rig.expect('reset context',context(1));await rig.expect('reset member',idCommand(0x202,1,10));await send('actual reset active feedback',join(query(90,10),begin(90)));rig.q.reset();c.equal(rig.host.bridge.inspect().renderer.budgets.queries.objects,0,'actual device reset retires query owners');c.equal(native.getError(),native.NO_ERROR,'native GL clean');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
 finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=copy(rig.trace.snapshot());row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}}return row;
}
export async function runProductionFeedbackQueries({WasmVirglSubmitProof,schedules=[0,1,2]}){
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',qualification:copy(qualification),rows:[]};window.__productionCriticReport=report;
 for(const schedule of schedules){const row=await one(WasmVirglSubmitProof,qualification,native,compiler,schedule),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
 {const row=await queryLoss(WasmVirglSubmitProof,qualification,compiler,6),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
 report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed'),hardware:qualification.identity};return report;
}
