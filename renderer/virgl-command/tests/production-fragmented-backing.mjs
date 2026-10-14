// Original nonoverlapping SG words, physical GPU roundtrip and refusal atomicity.
import {checker,makeRig,context,idCommand,header,backing,transfer} from './submit-acceptance.mjs';
import {createVirglProductionBridge,createVirglStandardStreamOutputSubmitBridge} from '../control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
const copy=x=>JSON.parse(JSON.stringify(x,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const put=(b,o,x)=>new DataView(b.buffer).setUint32(o,x,true);
function resource(id,width){const b=header(0x204,0,72);[id,0,64,16,width,1,1,1,0,0,0,0].forEach((x,i)=>put(b,24+4*i,x));return b;}
async function one(Wasm,profile,native,compiler,schedule,count,mode='valid'){
 const c=checker(),row={name:mode+'/sg'+count+'/schedule'+schedule,prediction:{count,totalBytes:count*4,attach:mode==='valid'||['private','host-private'].includes(mode)&&count===256?0x1100:['budget','tightened'].includes(mode)?0x1201:0x1205,roundtrip:'Complete independently literal per-segment bytes and every original RAM guard'}};
 const Selected=class{constructor(cb){return mode==='private'?Wasm.standardStreamOutput(cb):Wasm.qualified(cb,profile.hostWords,profile.formatRoles,profile.renderer);}};
 const factory=o=>mode==='host-private'?createVirglStandardStreamOutputSubmitBridge(o):createVirglProductionBridge({...o,...(mode==='tightened'?{resourceLimits:{segments:256}}:{}),presenter:createWorkerScanoutPresenter(()=>{})});
 const rig=makeRig(Selected,factory,native,compiler,c,schedule,true,false,true);
 const segments=[],expected=new Uint8Array(count*4);
 for(let i=0;i<count;i++){
  const at=rig.q.base+0x220000n+BigInt(i)*16n,addr=at+4n;
  rig.q.write(at,new Uint8Array(16).fill(0xc7));
  const literal=new Uint8Array([i&255,(i>>>8)&255,0x3f,0x7b]);expected.set(literal,i*4);rig.q.write(addr,literal);segments.push([addr,4]);
 }
 if(mode==='budget')for(const segment of segments)segment[1]=2050;
 let request=backing(1,segments);
 if(mode==='truncated')request=request.subarray(0,request.length-1);
 if(mode==='padding')put(request,32+(count-1)*16+12,1);
 if(mode==='zero-length')put(request,32+(count-1)*16+8,0);
 if(mode==='outside-ram')new DataView(request.buffer).setBigUint64(32+(count-1)*16,rig.q.base+0x3fffffn,true);

 row.originalAttach=[...request];row.originalEntries=segments.map(([a,n])=>({address:a.toString(16),length:n,padding:0}));
 try{
  await rig.expect('original context',context(1));await rig.expect('original vertex buffer',resource(1,Math.max(4,count*4)));
  row.beforeAttach=copy(rig.host.bridge.inspect());
  await rig.expect('original fragmented attachment',request,row.prediction.attach);
  if(row.prediction.attach!==0x1100){
   row.afterRefusal=copy(rig.host.bridge.inspect());c.same(row.afterRefusal.store,row.beforeAttach.store,'refusal leaves all host resource/backing ownership unchanged');
   // The same original resource remains usable after refusal; never reset to hide damage.
   request=backing(1,segments.slice(0,Math.min(256,count)));
   if(count===0)request=backing(1,[[rig.q.base+0x220004n,4]]);
   await rig.expect('valid attachment after original refusal',request);
   c.equal(rig.events.filter(e=>e.type==='attachBacking').at(-1).backingGeneration,'0000000000000001','refusal preserves original backing generation');
  } else {
   const attached=copy(rig.host.bridge.inspect());
   await rig.expect('duplicate attachment refuses',request,0x1205);
   c.same(rig.host.bridge.inspect().store,attached.store,'duplicate attach cannot change original ownership');
   await rig.expect('original context member',idCommand(0x202,1,1));
   await rig.expect('original full SG to GPU',transfer(1,1,1,[0,0,0,count*4,1,1]));
   for(const [a,n]of segments)rig.q.write(a,new Uint8Array(n).fill(0xee));
   await rig.expect('original GPU to full SG',transfer(1,1,2,[0,0,0,count*4,1,1]));
   const actual=new Uint8Array(count*4);let offset=0;
   for(const [a,n]of segments){actual.set(rig.q.read(a,n),offset);offset+=n;c.same([...rig.q.read(a-4n,4)],Array(4).fill(0xc7),'every SG prefix');c.same([...rig.q.read(a+BigInt(n),8)],Array(8).fill(0xc7),'every SG suffix');}
   row.roundtrip={actual:[...actual],expected:[...expected]};c.same([...actual],[...expected],'complete physical buffer data roundtrip');
  }
  c.equal(native.getError(),native.NO_ERROR,'no native GL errors');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
 finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=copy(rig.trace.snapshot());row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}}
 return row;
}
export async function runProductionFragmentedBacking({WasmVirglSubmitProof,schedules=[0,1,2]}){
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),profile=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',actualLinuxGuest:false,rows:[],hardware:profile.identity};window.__productionCriticReport=report;
 const forbidden=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name=>[name,()=>{throw Error('Invalid ceiling may not touch original DMA');}]));
 const raised=createVirglProductionBridge({gl:native,shaderBridge:compiler,transport:forbidden,presenter:createWorkerScanoutPresenter(()=>{}),resourceLimits:{segments:16385}});
 if(raised.ok){raised.bridge.dispose();throw Error('Host cannot raise the production segment ceiling');}
 report.hostCeilingRefusal=copy(raised);
 const cases=[... [256,257,420,16384].map(n=>[n,'valid']),[16385,'excess'],[0,'empty'],[420,'truncated'],[420,'padding'],[420,'zero-length'],[420,'outside-ram'],[16384,'budget'],[256,'private'],[257,'private'],[257,'tightened'],[256,'host-private'],[257,'host-private']];
 for(const schedule of schedules)for(const [count,mode]of cases){const row=await one(WasmVirglSubmitProof,profile,native,compiler,schedule,count,mode),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
 report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed'),hardware:profile.identity};return report;
}
