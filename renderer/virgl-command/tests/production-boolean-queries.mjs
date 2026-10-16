import {checker, makeRig, context, idCommand, header, backing, transfer, submission} from './submit-acceptance.mjs';
import {packet, join, shader, word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost, createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeProductionSubmission, decodeStandardStreamOutputSubmission} from '../decoder.mjs';

const copy = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString() : v));
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const vertex = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment = 'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0,1,0,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
function allocation(id, target, format, bind, width, height = 1) {
  const bytes = header(0x204, 0, 72);
  [id,target,format,bind,width,height,1,1,0,0,0,0].forEach((v,i)=>put(bytes,24+4*i,v));return bytes;
}
const query = (handle, type, resource, offset=0) => packet(1,9,[handle,type,offset,resource]);
const begin = handle => packet(19,0,[handle]), end = handle => packet(20,0,[handle]);
const get = (handle, wait=0) => packet(21,0,[handle,wait]);
const draw = () => packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);

async function one(Wasm, profile, native, compiler, schedule, type) {
  const c=checker(), row={name:`boolean${type}/schedule${schedule}`,native:[],reads:[],
    predictions:{visible:'The full quad produces true on both targets.',strictOcclusion:'Depth NEVER produces false on strict ANY_SAMPLES_PASSED.',
      empty:'A native empty query is available false, distinct from pending state2.',owner:'Virtual contexts/subcontexts retain separate original query objects.'}};
  let holdAvailability=false;
  const gl=new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
    return (...args)=>{const actual=method.apply(target,args), delivered=name==='getQueryParameter'&&args[1]===native.QUERY_RESULT_AVAILABLE&&holdAvailability?false:actual;
      row.native.push({name,args:args.map(v=>ArrayBuffer.isView(v)?[...v]:typeof v==='object'?v?.constructor.name:v),...(name==='getQueryParameter'?{actual,delivered}:{})});return delivered;};}});
  const Selected=class{constructor(callback){return Wasm.qualified(callback,profile.hostWords,profile.formatRoles,profile.renderer);}};
  const rig=makeRig(Selected,options=>createVirglProductionBridge({...options,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,schedule,true,false,true);
  const addresses=new Map(), bases={color:rig.q.base+0x210000n,vertex:rig.q.base+0x220000n,depth:rig.q.base+0x230000n};
  const send=(label,bytes,ctx=1,expected=0x1100)=>rig.expect(label,submission(ctx,bytes),expected);
  const read=async(id,expectedState,expectedValue)=>{
    const address=addresses.get(id);rig.q.write(address,new Uint8Array(64).fill(0xa7));
    await rig.expect('original query result transfer'+id,transfer(1,id,2,[0,0,0,32,1,1],5));
    const bytes=rig.q.read(address,64),expected=new Uint8Array(64).fill(0xa7);
    const state=new Uint8Array(32).fill(0x5b);put(state,0,expectedState);
    if(expectedState===1){put(state,4,4);put(state,8,expectedValue);put(state,12,0);}
    else {put(state,4,0);put(state,8,0);put(state,12,0);}
    expected.set(state,5);c.same([...bytes],[...expected],'all original query state and poisoned padding bytes');
    row.reads.push({id,state:expectedState,value:expectedValue,bytes:[...bytes]});
  };
  try {
    await rig.expect('context1',context(1));await rig.expect('context2',context(2));
    for(const [id,target,format,bind,width,height,address,size]of [[1,2,67,2,4,4,bases.color,64],[2,0,64,16,64,1,bases.vertex,64],[3,2,16,1,4,4,bases.depth,32]]) {
      await rig.expect('allocation'+id,allocation(id,target,format,bind,width,height));await rig.expect('backing'+id,backing(id,[[address,size]]));await rig.expect('membership'+id,idCommand(0x202,1,id));
    }
    for(let id=10;id<16;id++) {
      const address=rig.q.base+0x240000n+BigInt(id-10)*0x1000n;addresses.set(id,address);
      await rig.expect('query allocation'+id,allocation(id,0,64,131072,32));
      const initial=new Uint8Array(64).fill(0x5b);initial.fill(0,0,16);rig.q.write(address,initial);
      await rig.expect('query backing'+id,backing(id,[[address,64]]));
      await rig.expect('query membership1 '+id,idCommand(0x202,1,id));await rig.expect('query membership2 '+id,idCommand(0x202,2,id));
      await rig.expect('query poison upload'+id,transfer(1,id,1,[0,0,0,32,1,1]));
    }
    rig.q.write(bases.vertex,new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,1,0,1]).buffer));
    await rig.expect('vertex upload',transfer(1,2,1,[0,0,0,64,1,1]));
    await send('original shaders/state',join(shader(10,0,vertex),shader(11,1,fragment),packet(31,0,[10,0]),packet(31,0,[11,1]),
      packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,2]),packet(1,8,[20,1,67,0,0]),packet(1,8,[21,3,16,0,0]),
      packet(5,0,[1,21,20]),packet(4,0,[0,...[2,2,.5,2,2,.5].map(word)]),
      packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),query(90,type,10,0xffffffff),query(91,type,11)));
    await send('visible native query',join(begin(90),draw(),draw(),end(90),get(90)));
    await read(10,1,1);await send('repeat ready query',get(90,1));await read(10,1,1);
    // Hold availability only after reading the real native value. No fake result.
    holdAvailability=true;
    await send('empty unavailable query',join(begin(91),end(91),get(91)));
    await read(11,2,0);
    c.truth(row.native.some(e=>e.name==='getQueryParameter'&&e.actual===true&&e.delivered===false),'actual availability observed and withheld');
    holdAvailability=false;await send('empty ready query',get(91));await read(11,1,0);
    await send('depth never query',join(packet(1,3,[50,1,0,0,0]),packet(2,3,[50]),begin(90),draw(),end(90),get(90)));
    if(type===1)await read(10,1,0);
    else {await rig.expect('conservative native result transfer',transfer(1,10,2,[0,0,0,16,1,1]));const b=rig.q.read(addresses.get(10),16),v=new DataView(b.buffer);c.equal(v.getUint32(0,true),1,'conservative ready');c.truth([0,1].includes(v.getUint32(8,true)),'conservative preserves actual boolean');row.reads.push({id:10,conservative:[...b]});}
    await send('virtual query1 active',begin(90));
    await send('context2 same query handle',join(query(90,type,12),begin(90),end(90),get(90)),2);
    await read(12,1,0);
    await send('different subcontext same query handle',join(packet(29,0,[7]),packet(28,0,[7]),query(90,type,13),begin(90),end(90),get(90),packet(28,0,[0])));
    await read(13,1,0);await send('original subcontext query end',join(end(90),get(90)));await read(10,1,0);
    await send('end inactive refuses',end(90),1,0x1205);await send('get active refuses',join(begin(90),get(90)),1,0x1205);
    await send('overlap aliases refuses',begin(91),1,0x1205);await send('end original after refusal',join(end(90),get(90)));
    for(const unsupported of [0,2,3,4,5,7,8,9,10,12,0xffff])c.bad(decodeProductionSubmission(query(200,unsupported,14)),'unsupported query'+unsupported,'unsupported-query');
    c.bad(decodeProductionSubmission(query(200,type|(1<<16),14)),'query index1','unsupported-query');
    c.bad(decodeProductionSubmission(get(90,2)),'invalid wait','invalid-value');
    c.bad(decodeStandardStreamOutputSubmission(query(200,type,14)),'private query admission','unsupported-object');
    c.bad(decodeStandardStreamOutputSubmission(begin(90)),'private query command','unsupported-command');
    await send('destroy active',join(begin(91),packet(3,9,[91])));
    await send('query resource14',query(92,type,14));await rig.expect('detach query resource',idCommand(0x203,1,14));
    await send('detached query refuses before native effect',begin(92),1,0x1205);await send('collect detached query',packet(3,9,[92]));
    await rig.expect('small query buffer',allocation(16,0,64,131072,15));await rig.expect('small query membership',idCommand(0x202,1,16));
    await send('small result span refuses',query(96,type,16),1,0x1205);
    await send('wrong result binding refuses',query(96,type,2),1,0x1205);
    holdAvailability=true;await send('pending old resource generation',join(query(94,type,15),begin(94),end(94),get(94)));
    await rig.expect('unref pending old query buffer',idCommand(0x102,0,15));
    await rig.expect('reused query buffer id',allocation(15,0,64,131072,32));
    const replacement=new Uint8Array(64).fill(0x5b);replacement.fill(0,0,16);rig.q.write(addresses.get(15),replacement);
    await rig.expect('replacement backing',backing(15,[[addresses.get(15),64]]));await rig.expect('replacement membership',idCommand(0x202,1,15));
    await rig.expect('replacement upload',transfer(1,15,1,[0,0,0,32,1,1]));holdAvailability=false;
    await send('old generation result refuses',get(94),1,0x1205);await send('destroy cancelled old query',packet(3,9,[94]));
    await send('new generation query result',join(query(95,type,15),begin(95),end(95),get(95)));await read(15,1,0);
    await rig.expect('context2 destroy',header(0x201,2,24));await rig.expect('context1 destroy',header(0x201,1,24));
    c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'all native query parts retired');
    await rig.expect('context after destruction',context(1));await rig.expect('query membership after destruction',idCommand(0x202,1,10));
    await send('active query before actual device reset',join(query(90,type,10),begin(90)));rig.q.reset();
    c.equal(rig.host.bridge.inspect().renderer.budgets.queries.nativeParts,0,'device reset clears query parts');
    c.equal(rig.host.bridge.inspect().renderer.budgets.queries.objects,0,'device reset clears virtual queries');
    c.equal(native.getError(),native.NO_ERROR,'no native errors');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.beforeDispose=copy(rig.host.bridge.inspect());row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=copy(rig.trace.snapshot());row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}}
  return row;
}
export async function loss(Wasm,profile,compiler,type=1) {
  const c=checker(),canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;document.body.append(canvas);
  const native=canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),row={name:'physical-context-loss-pending-query'+type,predictions:{loss:'Pending actual query cannot publish DONE or mutate guest result after native context loss.'}};
  const Selected=class{constructor(callback){return Wasm.qualified(callback,profile.hostWords,profile.formatRoles,profile.renderer);}};
  const rig=makeRig(Selected,options=>createVirglProductionBridge({...options,presenter:createWorkerScanoutPresenter(()=>{})}),native,compiler,c,31337,true,false,true),address=rig.q.base+0x240000n;
  try{
    await rig.expect('loss context',context(1));await rig.expect('loss query resource',allocation(1,0,64,131072,32));
    rig.q.write(address,new Uint8Array(64).fill(0x6d));await rig.expect('loss query backing',backing(1,[[address,64]]));await rig.expect('loss query membership',idCommand(0x202,1,1));
    const entry=rig.q.enqueue('physical loss original query',submission(1,join(query(90,type,1),begin(90),end(90),get(90)),101n),0x1200);
    rig.q.kick();rig.q.run();await rig.step();c.equal(rig.q.usedIndex(),entry.number,'query original response remains pending');
    row.beforeLoss=copy(rig.host.bridge.inspect());c.truth(rig.trace.syncs.size>0,'actual native query completion fence pending');c.equal(row.beforeLoss.renderer.budgets.queries.nativeParts,1,'one actual empty query retained');
    canvas.addEventListener('webglcontextlost',e=>e.preventDefault(),{once:true});native.getExtension('WEBGL_lose_context').loseContext();
    for(let i=0;i<100&&!native.isContextLost();i++)await new Promise(resolve=>setTimeout(resolve,1));c.equal(native.isContextLost(),true,'physical WebGL context lost');
    await new Promise(resolve=>setTimeout(resolve,0));rig.trace.nextTurn();row.afterLossPump=copy(rig.host.bridge.pump());rig.q.run();rig.q.collect(entry);
    c.equal(rig.completions.at(-1).args[4],false,'lost query reports uncertain GPU completion');
    c.same([...rig.q.read(address,64)],[...new Uint8Array(64).fill(0x6d)],'loss never publishes a fabricated guest result');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=copy(rig.trace.snapshot());row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native query loss owners leaked';}}
  return row;
}
export async function runProductionBooleanQueries({WasmVirglSubmitProof,schedules=[0,1,2]}) {
  const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
  const qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',qualification:copy(qualification),rows:[]};window.__productionCriticReport=report;
  for(const schedule of schedules)for(const type of [1,11]){const row=await one(WasmVirglSubmitProof,qualification,native,compiler,schedule,type),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
  {const row=await loss(WasmVirglSubmitProof,qualification,compiler),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
  report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed'),hardware:qualification.identity};return report;
}
