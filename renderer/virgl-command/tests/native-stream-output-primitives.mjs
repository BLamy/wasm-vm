import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join} from './standard-instanced-draws.mjs';
import {captureFixtures,components,outputWords,fragmentText,entry,layout} from '../../../tools/virgl-stream-output-shaders/fixtures.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const word=n=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,n,true);return v.getUint32(0,true);};
function shader(handle,stage,text,words=[0]){const extra=words[0]?words.slice(1):[],bytes=packet(1,4,[handle,stage,text.length+1,8192,words[0],...extra,...Array(Math.ceil((text.length+1)/4)).fill(0)]);bytes.set(new TextEncoder().encode(text),24+extra.length*4);return bytes;}
function resource(id,bind,size){const b=header(0x204,0,72);[id,0,64,bind,size,1,1,1,0,0,0].forEach((w,i)=>new DataView(b.buffer).setUint32(24+i*4,w,true));return b;}
function ram(rig,id,size,index,c){const chunks=[7,17,53,size-77];let cursor=rig.q.base+0x210000n+BigInt(index*(size+128));const entries=chunks.map(n=>{const address=cursor+8n;cursor+=BigInt(n+16);return [address,n];});for(const[a,n]of entries)rig.q.write(a-8n,new Uint8Array(n+16).fill(0xa3));return {attach:backing(id,entries),write(bytes){c.equal(bytes.length,size,'whole original backing');let pos=0;for(const[a,n]of entries){rig.q.write(a,bytes.subarray(pos,pos+n));pos+=n;}},read(){const b=new Uint8Array(size);let pos=0;for(const[a,n]of entries){b.set(rig.q.read(a,n),pos);pos+=n;}return b;},guards(){for(const[a,n]of entries){c.equal(hex(rig.q.read(a-8n,8)),'a3'.repeat(8),'SG prefix');c.equal(hex(rig.q.read(a+BigInt(n),8)),'a3'.repeat(8),'SG suffix');}}};}

function capture(native,control){const ids=new WeakMap(),calls=[];let next=1;const enc=v=>{if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(Array.isArray(v))return v.map(enc);if(v&&typeof v==='object'){if(!ids.has(v))ids.set(v,next++);return {object:ids.get(v),type:v.constructor.name};}return v;};return {calls,gl:new Proxy(native,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return (...a)=>{const delivered=a.slice(),r={number:calls.length,method:k,args:a.map(enc)};calls.push(r);if(control.fault&&k==='copyBufferSubData'&&native.getParameter(native.COPY_READ_BUFFER)===control.packed){delivered[3]+=4;control.hits++;r.fault='valid-destination-word-shift';}const out=v.apply(t,delivered);if(k==='bindBufferBase'&&a[0]===native.TRANSFORM_FEEDBACK_BUFFER&&a[2])control.packed=a[2];r.delivered=delivered.map(enc);r.result=enc(out);if(k==='getBufferSubData')r.after=a.map(enc);return out;};}})};}
const VERTEX = 'VERT\nDCL IN[0]\nDCL IN[1]\nDCL SV[0], VERTEXID\nDCL SV[1], INSTANCEID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\nDCL OUT[4], GENERIC[3]\nIMM[0] FLT32 {0,0,0,1}\n0: MOV OUT[0], IMM[0]\n1: MOV OUT[1], IN[0]\n2: MOV OUT[2], IN[1]\n3: MOV OUT[3].x, SV[0].xxxx\n4: MOV OUT[4].x, SV[1].xxxx\n5: END\n';
const WORDS=layout([12,12,12,12],[entry(1,0,4,0,2),entry(2,0,4,1,3),entry(3,0,1,2,5),entry(4,0,1,3,7)]);
// The oracle lists original primitive identities; it shares no renderer assembly code.
const SPECS=[
 {name:'points',mode:0,source:[1,2,3,4,5,6],order:[1,2,3,4,5,6],primitive:1},
 {name:'incomplete-lines',mode:1,source:[1,2,3,4,5,6,7],order:[1,2,3,4,5,6],primitive:2},
 {name:'loop',mode:2,source:[1,2,3,4],order:[1,2,2,3,3,4,4,1],primitive:2},
 {name:'strip-lines',mode:3,source:[1,2,3,4],order:[1,2,2,3,3,4],primitive:2},
 {name:'incomplete-triangles',mode:4,source:[1,2,3,4,5,6,7],order:[1,2,3,4,5,6],primitive:3},
 {name:'strip-triangles',mode:5,source:[1,2,3,4,5],order:[1,2,3,3,2,4,3,4,5],primitive:3},
 {name:'fan',mode:6,source:[1,2,3,4,5],order:[1,2,3,1,3,4,1,4,5],primitive:3},
 {name:'indexed-restart-strip',mode:5,source:[3,1,4,119,6,2,5,8],order:[3,1,4,6,2,5,5,2,8],primitive:3,indexed:true,restart:119},
 {name:'indexed-restart-loop',mode:2,source:[3,1,4,119,6,2,5,8],order:[3,1,1,4,4,3,6,2,2,5,5,8,8,6],primitive:2,indexed:true,restart:119},
 {name:'literal-count-override',mode:0,source:[0,1,2],order:[0,1,2],primitive:1,countOverride:3},
 {name:'indexed-ignores-count',mode:4,source:[7,3,2],order:[7,3,2],primitive:3,indexed:true,countOverride:99}
];
async function runModes(Wasm,factory,native,compiler,c,seed,report,fault){
 const row={seed,specs:SPECS,phases:[]},control={fault:false,hits:0,packed:null},trace=capture(native,control),Selected=class{constructor(cb){return Wasm.standardStreamOutput(cb);}},rig=makeRig(Selected,factory,trace.gl,compiler,c,seed,true,false,true),memory=new Map(),vertices=Array.from({length:16},(_,i)=>[(0x7fa10000+i+seed%65536)>>>0,0x80000000,(0xff800000+i)>>>0,(0x3f800000+i)>>>0]),instances=Array.from({length:8},(_,i)=>[(0x01230000+i+seed)>>>0,(0x45670000+i)>>>0,(0x89ab0000+i)>>>0,(0xcdef0000+i)>>>0]);report.rows.push(row);window.__captureActive=()=>({row,host:copy(rig.host.bridge.inspect())});
 const upload=async(id,bytes)=>{const b=new Uint8Array(4096).fill(0xa7);b.set(bytes);memory.get(id).write(b);await rig.expect('original complete buffer upload '+id,transfer(1,id,1,[0,0,0,4096,1,1]));};
 try{
  await rig.expect('original context',context(1));
  for(let id=1;id<=7;id++){await rig.expect('original role resource '+id,resource(id,id<=4?2160:112,4096));const m=ram(rig,id,4096,id-1,c);memory.set(id,m);await rig.expect('original SG backing '+id,m.attach);await rig.expect('original member '+id,idCommand(0x202,1,id));await upload(id,new Uint8Array());}
  await upload(5,new Uint8Array(new Uint32Array(vertices.flat()).buffer));await upload(6,new Uint8Array(new Uint32Array(instances.flat()).buffer));
  await rig.expect('original typed inputs and captures',submission(1,join(shader(10,0,VERTEX,WORDS),shader(11,1,fragmentText),packet(1,5,[20,0,0,0,196,0,2,1,196]),packet(2,5,[20]),packet(6,0,[16,0,5,16,0,6]),packet(1,2,[21,2|8|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[21]),packet(31,0,[10,0]),packet(31,0,[11,1]))));
  for(const [specIndex,spec]of SPECS.entries()){
   const handle=40+specIndex*4,capacity=specIndex%2?spec.primitive*4+1:60,expected=Array.from({length:4},()=>new Uint8Array(4096).fill(0xa7));
   for(let id=1;id<=4;id++)await upload(id,new Uint8Array());
   if(spec.indexed)await upload(7,new Uint8Array(new Uint32Array(spec.source).buffer));
   await rig.expect('new original target tuple '+spec.name,submission(1,join(...[0,1,2,3].map(b=>packet(1,10,[handle+b,b+1,16,capacity*48])),packet(25,0,[0,handle,handle+1,handle+2,handle+3]),packet(11,0,spec.indexed?[7,4,0]:[0]))));
   let cursor=0;
   for(let phase=0;phase<3;phase++){
    await rig.expect('mask resumes original tuple '+phase,submission(1,packet(25,0,[phase?15:0,handle,handle+1,handle+2,handle+3])));
    const available=Math.floor((capacity-cursor)/spec.primitive)*spec.primitive,ordered=[];
    for(let instance=0;instance<3;instance++)for(const vertex of spec.order)ordered.push({vertex,instance});
    const captured=ordered.slice(0,available);const at=rig.events.length;
    if(fault&&specIndex===0&&phase===0)control.fault=true;
    const record=await rig.expect('real original primitive draw '+spec.name+'/'+phase,submission(1,packet(8,0,[spec.indexed?0:spec.countOverride?5:spec.source[0],spec.countOverride&&!spec.indexed?1:spec.source.length,spec.mode,spec.indexed?1:0,3,0,0,spec.restart?1:0,spec.restart??0,0,15,spec.countOverride??0]),BigInt(phase+1)));
    control.fault=false;
    for(const [i,{vertex,instance}]of captured.entries())for(let b=0;b<4;b++){const v=new DataView(expected[b].buffer),offset=16+(cursor+i)*48+([2,3,5,7][b])*4,words=b===0?vertices[vertex]:b===1?instances[Math.floor(instance/2)]:[b===2?vertex:instance];words.forEach((w,lane)=>v.setUint32(offset+lane*4,w,true));}
    cursor+=captured.length;
    const output={name:spec.name,phase,capacity,cursor,ordered:captured,record,expected:expected.map(hex),actual:[],submittedEvents:copy(rig.events.slice(at))};row.phases.push(output);
    for(let b=0;b<4;b++){memory.get(b+1).write(new Uint8Array(4096).fill(0x6b));await rig.expect('original206 complete target '+b,transfer(1,b+1,2,[0,0,0,4096,1,1],0n,0,0,99n));output.actual.push(hex(memory.get(b+1).read()));memory.get(b+1).guards();}
    output.completedOriginalReadbacks=4;output.mismatches=output.actual.flatMap((b,i)=>b===output.expected[i]?[]:[i]);c.same(output.mismatches,[],'complete original primitive/instance/cursor/padding oracle after GPU');
    if(phase===0){await rig.expect('pause original tuple',submission(1,packet(25,0,[0])));await rig.expect('resume opaque mask0 tuple',submission(1,packet(25,0,[0,handle,handle+1,handle+2,handle+3])));}
   }
  }
  const collect = async (id, expected, label) => {
    const output={name:label,expected:[hex(expected)],actual:[]};row.phases.push(output);
    memory.get(id).write(new Uint8Array(4096).fill(0x6b));await rig.expect(label+' full original206',transfer(1,id,2,[0,0,0,4096,1,1],0n,0,0,7n));output.actual.push(hex(memory.get(id).read()));output.completedOriginalReadbacks=1;output.mismatches=output.actual[0]===output.expected[0]?[]:[0];c.same(output.mismatches,[],label+' full GPU oracle');memory.get(id).guards();
  };
  for(let id=8;id<=10;id++){await rig.expect('reuse witness resource '+id,resource(id,2160,4096));const m=ram(rig,id,4096,id-1,c);memory.set(id,m);await rig.expect('reuse witness backing '+id,m.attach);await rig.expect('reuse witness attachment '+id,idCommand(0x202,1,id));await upload(id,new Uint8Array());}
  const last=row.phases.at(-1).expected[0],previous=Uint8Array.from(last.match(/../g),v=>parseInt(v,16));
  const vertexReuse=layout([8,0,0,0],[entry(1,0,4,0,1)]);
  await rig.expect('captured storage supplies later vertex role',submission(1,join(packet(25,0,[0]),shader(300,0,VERTEX,vertexReuse),packet(31,0,[300,0]),packet(6,0,[48,24,1,16,0,6]),packet(11,0,[0]),packet(1,10,[301,8,32,256]),packet(25,0,[0,301]),packet(8,0,[0,3,0,0,1,0,0,0,0,0,2,0]))));
  const vertexExpected=new Uint8Array(4096).fill(0xa7);for(let i=0;i<3;i++)vertexExpected.set(previous.subarray(24+i*48,40+i*48),36+i*32);await collect(8,vertexExpected,'captured-to-vertex native reuse');
  await rig.expect('captured storage supplies later index role',submission(1,join(packet(25,0,[0]),shader(302,0,VERTEX,layout([8,0,0,0],[entry(3,0,1,0,1)])),packet(31,0,[302,0]),packet(6,0,[16,0,5,16,0,6]),packet(11,0,[3,4,36]),packet(1,10,[303,9,32,256]),packet(25,0,[0,303]),packet(8,0,[0,1,0,1,1,0,0,0,0,0,15,0]))));
  const indexExpected=new Uint8Array(4096).fill(0xa7);new DataView(indexExpected.buffer).setUint32(36,7,true);await collect(9,indexExpected,'captured-to-index native reuse');
  await rig.expect('capture original words for aligned UBO reuse',submission(1,join(packet(25,0,[0]),shader(304,0,VERTEX,layout([8,0,0,0],[entry(2,0,4,0,0)])),packet(31,0,[304,0]),packet(11,0,[0]),packet(1,10,[305,2,256,256]),packet(25,0,[0,305]),packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0]))));
  const uniformText='VERT\nDCL CONST[1][0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nIMM[0] FLT32 {0,0,0,1}\n0: MOV OUT[0], IMM[0]\n1: MOV OUT[1], CONST[1][0]\n2: END\n';
  await rig.expect('captured storage supplies later original uniform bank',submission(1,join(packet(25,0,[0]),shader(306,0,uniformText,layout([8,0,0,0],[entry(1,0,4,0,1)])),packet(31,0,[306,0]),packet(27,0,[0,1,256,256,2]),packet(1,10,[307,10,32,256]),packet(25,0,[0,307]),packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0]))));
  const uniformExpected=new Uint8Array(4096).fill(0xa7);new Uint32Array(uniformExpected.buffer,36,4).set(instances[0]);await collect(10,uniformExpected,'captured-to-uniform native reuse');
  // A public target name is independent of the retained bound tuple.
  const old=copy(rig.host.bridge.inspect()).renderer.contexts[0].subContexts[0].bindings.streamOutput.targets[0];
  await rig.expect('recycle public target while old tuple stays bound',submission(1,join(packet(3,10,[307]),packet(1,10,[307,8,256,256]),packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0]))));
  const retained=copy(rig.host.bridge.inspect()).renderer.contexts[0].subContexts[0].bindings.streamOutput.targets[0];c.equal(retained.generation,old.generation,'public target reuse preserves old tuple generation');uniformExpected.set(new Uint8Array(new Uint32Array(instances[0]).buffer),68);await collect(10,uniformExpected,'destroyed bound target still captures to retained storage');
  await rig.expect('bind replacement target generation starts original offset',submission(1,join(packet(25,0,[0,307]),packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0]))));vertexExpected.set(new Uint8Array(new Uint32Array(instances[0]).buffer),260);await collect(8,vertexExpected,'replacement target cursor starts original offset');
  // Reject a feedback/input alias before a single capture or native allocation.
  await rig.expect('unbind prior bank',submission(1,packet(27,0,[0,1,0,0,0])));
  await rig.expect('restore typed input shader',submission(1,join(packet(25,0,[0]),packet(31,0,[300,0]),packet(6,0,[48,24,1,16,0,6]),packet(1,10,[308,1,0,256]),packet(25,0,[0,308]))));
  const calls=trace.calls.length,owners=copy(rig.host.bridge.inspect()).store;
  await rig.expect('active original feedback/input conflict is explicit',submission(1,packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0])),0x1205);
  c.same(copy(rig.host.bridge.inspect()).store,owners,'conflict publishes no changed resource owner');c.truth(!trace.calls.slice(calls).some(v=>v.method==='beginTransformFeedback'||v.method==='createBuffer'),'conflict rejected before actual native capture/allocation');
  // Packed allocation failure is recoverable after its real completion fence.
  await rig.expect('restore independent output target',submission(1,packet(25,0,[0,301])));rig.trace.control.nullBuffer=true;
  await rig.expect('packed allocation refusal drains exactly once',submission(1,packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0]),0xffffffffffffffffn),0x1201);
  await rig.expect('same live tuple recovers after allocation refusal',submission(1,packet(8,0,[0,1,0,0,1,0,0,0,0,0,15,0]),8n));
  row.faultHits=control.hits;row.after=copy(rig.host.bridge.inspect());c.equal(row.after.store.budgets.packedCaptures,0,'all capture allocations drained');row.status='passed';
 }catch(e){row.status='failed';row.failure={message:e.message,stack:e.stack};throw e;}
 finally{row.calls=trace.calls;row.events=copy(rig.events);row.records=copy(rig.q.records);row.exchanges=copy(rig.exchanges);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());rig.dispose();row.cleaned=rig.trace.snapshot();if(window.__recordCaptureRun)report.rows[report.rows.length-1]=await window.__recordCaptureRun(report.rows.length-1,JSON.stringify(row));}
}
export async function runCapture({WasmVirglSubmitProof,createVirglStandardStreamOutputSubmitBridge,seeds=[54831,90107,171281],fault=false}){
 const c=checker(),native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),compiler=await createVirglStandardStreamOutputShaderBridge();c.truth(native,'actual hardware WebGL2');const report={rows:[],seeds};window.__captureReport=report;
 try{for(const seed of seeds)await runModes(WasmVirglSubmitProof,createVirglStandardStreamOutputSubmitBridge,native,compiler,c,seed,report,fault);report.status='passed';report.summary={runs:report.rows.length,phases:report.rows.length*33,seeds,assertions:c.assertions};return report;}finally{report.assertions=c.assertions;}
}
