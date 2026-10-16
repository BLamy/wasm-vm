// Independent negative native fault injection; positive hardware and original transport remain real.
import {checker,makeRig,context,header,idCommand} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {qualifyMultisampleStorage} from '../../renderer/virgl-command/multisample.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglProductionBridge} from '../../renderer/virgl-command/control-bridge.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString():x));
const put=(b,o,v)=>new DataView(b.buffer).setUint32(o,v,true);
function allocation(){const b=header(0x204,0,72);[1,2,67,2,12,12,1,1,0,4,0,0].forEach((v,i)=>put(b,24+i*4,v));return b;}
export async function runProductionMultisampleFailureCritic({WasmVirglSubmitProof}){
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
 if(!native)throw Error('Native hardware WebGL2 required');
 const qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge();
 const report={status:'running',qualification:copy(qualification),rows:[],scope:'real native negative fault injection only; no positive output or transport replaced'};
 for(const kind of ['below-four','null-framebuffer','null-renderbuffer','wrong-samples','incomplete-framebuffer','bad-pixels','native-error']){
  const c=checker(),row={name:'qualification-'+kind,status:'running',prediction:'Qualification must throw, restore native state, and delete every partially allocated owner',events:[]},owners=new Map();let fired=false;
  const before={read:native.getParameter(native.READ_FRAMEBUFFER_BINDING),draw:native.getParameter(native.DRAW_FRAMEBUFFER_BINDING),rb:native.getParameter(native.RENDERBUFFER_BINDING),scissor:native.isEnabled(native.SCISSOR_TEST),mask:[...native.getParameter(native.COLOR_WRITEMASK)]};
  const gl=new Proxy(native,{get(t,key){const f=Reflect.get(t,key,t);if(typeof f!=='function')return f;return(...args)=>{
   row.events.push({name:key,args:args.map(x=>ArrayBuffer.isView(x)?[...x]:x&&typeof x==='object'?x.constructor.name:x)});
   if(!fired&&((kind==='below-four'&&key==='getParameter'&&args[0]===t.MAX_SAMPLES)||(kind==='null-framebuffer'&&key==='createFramebuffer')||(kind==='null-renderbuffer'&&key==='createRenderbuffer'))){fired=true;return kind==='below-four'?3:null;}
   const v=f.apply(t,args);if(key.startsWith('create')&&v)owners.set(v,key);if(key.startsWith('delete'))owners.delete(args[0]);
   if(!fired&&kind==='wrong-samples'&&key==='getRenderbufferParameter'){fired=true;return 2;}
   if(!fired&&kind==='incomplete-framebuffer'&&key==='checkFramebufferStatus'){fired=true;return t.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;}
   if(!fired&&kind==='bad-pixels'&&key==='readPixels'){fired=true;args.at(-1)[0]=255;}
   if(!fired&&kind==='native-error'&&key==='getError'){fired=true;return t.INVALID_OPERATION;}
   return v;
  };}});
  try{let message=null;try{qualifyMultisampleStorage(gl);}catch(error){message=error.message;}c.truth(fired,'negative fault actually fired');c.truth(message,'no positive qualifier result');row.refusal=message;c.equal(owners.size,0,'all temporary native owners released');c.equal(native.getParameter(native.READ_FRAMEBUFFER_BINDING),before.read,'read framebuffer restored');c.equal(native.getParameter(native.DRAW_FRAMEBUFFER_BINDING),before.draw,'draw framebuffer restored');c.equal(native.getParameter(native.RENDERBUFFER_BINDING),before.rb,'renderbuffer restored');c.equal(native.isEnabled(native.SCISSOR_TEST),before.scissor,'scissor restored');c.same([...native.getParameter(native.COLOR_WRITEMASK)],before.mask,'color mask restored');c.equal(native.getError(),native.NO_ERROR,'real GL remains error-free');row.status='passed';}catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  row.assertions=c.assertions;row.liveOwners=owners.size;const pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});
 }
 for(const kind of ['unsupported-native-samples','null-native-renderbuffer','throw-after-native-storage']){
  const c=checker(),row={name:'original-allocation-'+kind,status:'running',prediction:'An original qualified CREATE_RESOURCE3D fails atomically, deleting partially allocated storage',events:[]},owners=new Set();let armed=false,fired=false;
  const gl=new Proxy(native,{get(t,key){const f=Reflect.get(t,key,t);if(typeof f!=='function')return f;return(...args)=>{
   row.events.push({name:key,args:args.map(x=>ArrayBuffer.isView(x)?[...x]:x&&typeof x==='object'?x.constructor.name:x)});
   if(armed&&!fired&&kind==='unsupported-native-samples'&&key==='getInternalformatParameter'){fired=true;return new Int32Array();}
   if(armed&&!fired&&kind==='null-native-renderbuffer'&&key==='createRenderbuffer'){fired=true;return null;}
   const v=f.apply(t,args);if(key==='createRenderbuffer'&&v)owners.add(v);if(key==='deleteRenderbuffer')owners.delete(args[0]);
   if(armed&&!fired&&kind==='throw-after-native-storage'&&key==='renderbufferStorageMultisample'){fired=true;throw Error('Independent failure after real native storage allocation');}
   return v;
  };}});
  const Selected=class{constructor(callback){return WasmVirglSubmitProof.qualified(callback,qualification.hostWords,qualification.formatRoles,qualification.renderer);}};
  const rig=makeRig(Selected,opts=>createVirglProductionBridge({...opts,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,173205,true,false,true);
  try{await rig.expect('real context before sample allocation fault',context(1));const before=copy(rig.host.bridge.inspect().store);armed=true;await rig.expect('original sample allocation fault',allocation(),0x1201);armed=false;c.truth(fired,'original native allocation fault actually fired');c.same(rig.host.bridge.inspect().store,before,'refused original allocation preserves metadata and all budgets');c.equal(owners.size,0,'partially allocated sample owner deleted');
   if(kind==='throw-after-native-storage'){
    await rig.expect('original sample allocation after atomic refusal',allocation());await rig.expect('original sample membership',idCommand(0x202,1,1));
    const own=rig.host.probes.owners(),state=copy(own.store.inspect()),generation=state.resources[0].generation;
    c.bad(own.bindings.retainScanout(1,generation),'original sample storage cannot become scanout','unsupported-resource');
    c.bad(own.store.retainStorage(1,1,'view'),'original sample storage cannot become sampler view','unsupported-resource');
    c.same(own.store.inspect(),state,'refused native sampling/scanout leaves no lease or budget effects');
   }
   row.status='passed';}catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{armed=false;row.records=copy(rig.q.records);row.eventsTransport=copy(rig.events);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());rig.dispose();row.cleaned=rig.trace.snapshot();row.assertions=c.assertions;row.liveRenderbuffers=owners.size;}
  const pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});
 }
 report.status=report.rows.every(x=>x.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(x=>x.status!=='passed'),hardware:qualification.identity};return report;
}
