// Original production BIND_SHADER must tolerate transient stage replacements.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join,shader,word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const draw=()=>packet(8,0,[0,1,0,0,1,0,0,0,0,0,0xffffffff,0]);
const allocation=(id,target,format,bind,width,height)=>{const b=header(0x204,0,72);[id,target,format,bind,width,height,1,1,0,0,0,0].forEach((v,i)=>put(b,24+i*4,v));return b;};
const vertex=(semantic,color)=>`VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[${semantic}]\nIMM[0] FLT32 {${color.join(',')}}\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IMM[0]\n2: END\n`;
const fragment=semantic=>`FRAG\nDCL IN[0], GENERIC[${semantic}], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n`;
async function runCase(Wasm,qprofile,native,compiler,schedule,order){
  const c=checker(),row={name:'separate-'+order+'-first/schedule'+schedule,schedule,order,predictions:{transient:'single stage binds returnOK without linking mismatched old/new interfaces',matchedDraw:'the final matched pair issues exactlyone native draw and yields greenRGBA',mismatchedDraw:'final mismatched pairDRAW returnsINVALID_PARAMETER before a native draw',explicitLink:'explicit LINK_SHADER mismatch returnsINVALID_PARAMETER before a native draw'},native:[],outputs:[]};
  const trace=new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{const entry={sequence:row.native.length,name,args:args.map(v=>ArrayBuffer.isView(v)?[...v]:Array.isArray(v)?v:v&&typeof v==='object'?v.constructor.name:v)};row.native.push(entry);const answer=method.apply(target,args);if(name==='getBufferSubData')entry.after=args.map(v=>ArrayBuffer.isView(v)?[...v]:null);return answer;};}});
  const Selected=class{constructor(callback){return Wasm.qualified(callback,qprofile.hostWords,qprofile.formatRoles,qprofile.renderer);}};
  const rig=makeRig(Selected,opts=>createVirglProductionBridge({...opts,presenter:createWorkerScanoutPresenter(()=>{})}),trace,compiler,c,schedule,true,false,true),image=rig.q.base+0x210000n,positions=rig.q.base+0x220000n;
  const gpuDraws=()=>row.native.filter(r=>/^draw(?:Arrays|Elements)(?:Instanced)?$/.test(r.name)).length;
  window.__productionCriticActive=()=>({row,host:copy(rig.host.bridge.inspect()),guest:copy(rig.q.vm.inspect())});
  try{
    await rig.expect('original context',context(1));
    for(const [id,target,format,bind,width,height,address,length]of [[1,2,67,2,1,1,image,4096],[3,0,64,16,16,1,positions,16]]){
      await rig.expect('original allocation '+id,allocation(id,target,format,bind,width,height));await rig.expect('original backing '+id,backing(id,[[address,length]]));await rig.expect('original membership '+id,idCommand(0x202,1,id));
    }
    rig.q.write(positions,new Uint8Array(new Float32Array([0,0,0,1]).buffer));await rig.expect('original position205',transfer(1,3,1,[0,0,0,16,1,1]));
    const texts={oldVertex:vertex(0,[1,0,0,1]),oldFragment:fragment(0),newVertex:vertex(1,[0,1,0,1]),newFragment:fragment(1)};row.tgsi=texts;
    await rig.expect('original old pair and state',submission(1,join(shader(10,0,texts.oldVertex),shader(11,1,texts.oldFragment),shader(12,0,texts.newVertex),shader(13,1,texts.newFragment),packet(1,5,[14,0,0,0,31]),packet(2,5,[14]),packet(6,0,[16,0,3]),packet(1,8,[20,1,67,0,0]),packet(5,0,[1,0,20]),packet(4,0,[0,...[.5,.5,.5,.5,.5,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]))));
    const output=async(label,color)=>{const before=gpuDraws();await rig.expect(label+' originalDRAW',submission(1,draw(),0x20000000000001n));c.equal(gpuDraws()-before,1,label+' exactlyone physicaldraw');rig.q.write(image,new Uint8Array(4096).fill(0x6f));const at=rig.exchanges.length;const record=await rig.expect(label+' original206',transfer(1,1,2,[0,0,0,1,1,1],5n,11,0,0x20000000000003n)),actual=rig.q.read(image,4096),expected=new Uint8Array(4096).fill(0x6f);expected.set(color,5);c.equal(rig.exchanges[at].bytes,hex(Uint8Array.from(color)),label+' literalRGBA output');c.equal(hex(actual),hex(expected),label+' complete originalRAM/padding');row.outputs.push({label,actual:hex(actual),expected:hex(expected),record});};
    await output('old-matched',[255,0,0,255]);
    const transientBefore=gpuDraws(),first=order==='fragment'?[13,1]:[12,0],second=order==='fragment'?[12,0]:[13,1];
    row.transient=await rig.expect('original transient '+order+' BIND_SHADER',submission(1,packet(31,0,first),0x20000000000005n));c.equal(gpuDraws(),transientBefore,'transient bind performs no draw');
    row.matching=await rig.expect('original matching second BIND_SHADER',submission(1,packet(31,0,second),0x20000000000007n));c.equal(gpuDraws(),transientBefore,'second bind performs no draw');await output('new-matched',[0,255,0,255]);
    row.mismatchedBind=await rig.expect('original final mismatch binding',submission(1,packet(31,0,[10,0]),0x20000000000009n));
    const failureBefore=gpuDraws();row.mismatchedDraw=await rig.expect('original mismatched DRAW rejects',submission(1,draw(),0x2000000000000bn),0x1205);c.equal(gpuDraws(),failureBefore,'mismatched DRAW emits no native draw');
    row.explicitLink=await rig.expect('original explicit mismatched LINK_SHADER rejects',submission(1,packet(52,0,[10,13,0,0,0,0]),0x2000000000000dn),0x1205);c.equal(gpuDraws(),failureBefore,'explicit mismatch emits no native draw');
    await rig.expect('original explicit matching LINK_SHADER',submission(1,packet(52,0,[12,13,0,0,0,0]),0x2000000000000fn));
    await rig.expect('original repair matching vertex',submission(1,packet(31,0,[12,0])));await output('recovered-matched',[0,255,0,255]);c.equal(native.getError(),native.NO_ERROR,'zero actualWebGL errors');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=rig.trace.snapshot();row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}window.__productionCriticActive=null;}
  return row;
}
export async function runProductionShaderBindingCritic({WasmVirglSubmitProof,schedules=[0,1,2]}){
  const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});if(!native)throw Error('HardwareWebGL2 unavailable');
  const qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',qualification:copy(qualification),rows:[],actualLinuxGuest:false,productionConstructor:true};window.__productionCriticReport=report;
  for(const schedule of schedules)for(const order of ['fragment','vertex']){const row=await runCase(WasmVirglSubmitProof,qualification,native,compiler,schedule,order),index=report.rows.length;report.rows.push({...await window.__recordProductionCriticRun(index,JSON.stringify(row)),name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
  report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed').map(r=>({name:r.name,failure:r.failure})),hardware:qualification.identity};return report;
}
