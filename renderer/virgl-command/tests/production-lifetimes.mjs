// Original production work limits and a divisor attack across the expanded boundary.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join,shader,word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join(''),copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const allocation=(id,target,format,bind,width,height)=>{const b=header(0x204,0,72);[id,target,format,bind,width,height,1,1,0,0,0,0].forEach((v,i)=>put(b,24+4*i,v));return b;};
const draw=(count=1,instances=1)=>packet(8,0,[0,count,0,0,instances,0,0,0,0,0,0xffffffff,0]);
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n',fragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,0,0,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
function traced(native,row){return new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{const e={sequence:row.native.length,name,args:args.map(v=>ArrayBuffer.isView(v)?[...v]:Array.isArray(v)?v:v&&typeof v==='object'?v.constructor.name:v)};row.native.push(e);return method.apply(target,args);};}});}
async function one(Wasm,profile,native,compiler,schedule,mode){
 const c=checker(),row={name:mode+'/schedule'+schedule,mode,schedule,native:[],outcomes:[],predictions:mode==='divisor'?{instances:'99,999 instances with original divisor100,000 select only element0; element1 must not draw'}:{draws:'ceiling draws execute and one beyond rejects with the exact valid prefix fenced',indices:'ceiling work executes and one beyond rejects before native drawing',tightening:'host options may reduce ceilings but never increase them'}};
 const selected=class{constructor(callback){return Wasm.qualified(callback,profile.hostWords,profile.formatRoles,profile.renderer);}},config=mode==='tightened'?{drawLimits:{drawsPerSubmission:2,indicesPerSubmission:8},jobLimits:{transferBytes:16}}:{};
 const rig=makeRig(selected,opts=>createVirglProductionBridge({...opts,...config,presenter:createWorkerScanoutPresenter(()=>{})}),traced(native,row),compiler,c,schedule,true,false,true),address=rig.q.base+0x210000n,output=rig.q.base+0x220000n;
 const nativeDraws=()=>row.native.filter(r=>/^draw(?:Arrays|Elements)(?:Instanced)?$/.test(r.name));
 window.__productionCriticActive=()=>({row,host:copy(rig.host.bridge.inspect()),guest:copy(rig.q.vm.inspect())});
 try{
  row.initial=copy(rig.host.bridge.inspect());c.same(row.initial.renderer.drawLimits,mode==='tightened'?{drawsPerSubmission:2,indicesPerSubmission:8}:{drawsPerSubmission:256,indicesPerSubmission:262144},'selected actual draw ceilings');c.equal(row.initial.renderer.jobLimits.transferBytes,mode==='tightened'?16:33554432,'selected actual transfer ceiling');
  await rig.expect('original context',context(1));
  const side=mode==='divisor'?2:1,vertexBytes=mode==='divisor'?32:32;
  for(const [id,target,format,bind,width,height,at,n]of [[1,2,67,2,side,side,output,4096],[3,0,64,16,vertexBytes,1,address,vertexBytes]]){await rig.expect('original allocation'+id,allocation(id,target,format,bind,width,height));await rig.expect('original backing'+id,backing(id,[[at,n]]));await rig.expect('original membership'+id,idCommand(0x202,1,id));}
  rig.q.write(address,new Uint8Array(new Float32Array(mode==='divisor'?[-.5,-.5,0,1,.5,.5,0,1]:[0,0,0,1,0,0,0,1]).buffer));
  await rig.expect('original vertex upload at tight boundary',transfer(1,3,1,[0,0,0,mode==='tightened'?16:32,1,1]));
  if(mode==='tightened'){const before=row.native.length;row.outcomes.push(await rig.expect('original transfer one byte beyond tight ceiling',transfer(1,3,1,[0,0,0,17,1,1]),0x1201));c.truth(!row.native.slice(before).some(e=>e.name==='bufferSubData'),'oversize tight transfer performs no GPU upload');}
  await rig.expect('original render state',submission(1,join(shader(10,0,vertex),shader(11,1,fragment),packet(1,5,[12,0,mode==='divisor'?100000:0,0,31]),packet(2,5,[12]),packet(6,0,[mode==='divisor'?16:0,0,3]),packet(1,8,[20,1,67,0,0]),packet(5,0,[1,0,20]),packet(4,0,[0,...[side/2,side/2,.5,side/2,side/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),packet(7,0,[4,0,0,0,0,0,0,0]))));
  if(mode==='lifetime') {
    const before=nativeDraws().length, entries=[];
    for(let i=0;i<100;i++)entries.push(rig.q.enqueue('queued fenced physical draw'+i,submission(1,draw(),BigInt(i))));
    entries.push(rig.q.enqueue('destroy after100fenced draws',header(0x201,1,24)));
    rig.q.kick();rig.q.run();c.equal(rig.q.usedIndex(),entries[0].number,'original head remains pending');
    let steps=0;while(rig.q.usedIndex()<rig.q.next){c.truth(++steps<5000,'bounded queued retirement');rig.q.run();if(rig.q.usedIndex()<rig.q.next)await rig.step();}
    entries.forEach(entry=>rig.q.collect(entry));c.equal(nativeDraws().length-before,100,'all100native draws before teardown');c.equal(rig.host.bridge.inspect().contexts.length,0,'context destroyed after all completions');
    await rig.expect('recreated context original',context(1));
    await rig.expect('reattach original vertex owner',idCommand(0x202,1,3));
    const upload=rig.q.enqueue('queued upload',transfer(1,3,1,[0,0,0,16,1,1],0n,0,0,1001n));
    const detach=rig.q.enqueue('ordered backing detach',idCommand(0x107,0,3));
    const attach=rig.q.enqueue('ordered backing attach',backing(3,[[address,vertexBytes]]));
    const duplicate=rig.q.enqueue('duplicate backing attach',backing(3,[[address,vertexBytes]]),0x1205);
    rig.q.kick();rig.q.run();steps=0;while(rig.q.usedIndex()<rig.q.next){c.truth(++steps<5000,'bounded backing retirement');rig.q.run();if(rig.q.usedIndex()<rig.q.next)await rig.step();}
    [upload,detach,attach,duplicate].forEach(entry=>rig.q.collect(entry));
    c.equal(rig.q.vm.submitInspect().active,null,'mailbox quiescent');
  } else if(mode==='divisor'){
   const before=nativeDraws().length;row.outcomes.push(await rig.expect('original large divisor instances',submission(1,draw(1,99999),0x20000000000001n)));c.equal(nativeDraws().length-before,1,'one physical instanced draw');
   rig.q.write(output,new Uint8Array(4096).fill(0x6f));const at=rig.exchanges.length;row.outcomes.push(await rig.expect('original divisor pixel206',transfer(1,1,2,[0,0,0,2,2,1],5n,11,0,0x20000000000003n)));const wanted=new Uint8Array(16);wanted.set([255,0,0,255],0);row.pixels={actual:rig.exchanges[at].bytes,expected:hex(wanted)};c.equal(row.pixels.actual,row.pixels.expected,'original100000 divisor forbids element1 pixel');
  }else{
   const ceiling=mode==='tightened'?2:256,indexCeiling=mode==='tightened'?8:262144;
   for(const n of [ceiling,ceiling+1]){const commands=join(...Array.from({length:n},()=>draw())),before=nativeDraws().length;row.outcomes.push(await rig.expect('original draw batch'+n,submission(1,commands,0x20000000000001n),n===ceiling?0x1100:0x1201));c.equal(nativeDraws().length-before,ceiling,'ceiling or rejected batch executes exact valid prefix');c.equal(rig.completions.at(-1).args[4],true,'draw prefix retires a real native fence');c.equal(rig.completions.at(-1).args[6],ceiling,'completion draw count records valid prefix');}
   for(const n of [indexCeiling,indexCeiling+1]){const before=nativeDraws().length;row.outcomes.push(await rig.expect('original count work'+n,submission(1,draw(n),0x20000000000005n),n===indexCeiling?0x1100:0x1201));c.equal(nativeDraws().length-before,n===indexCeiling?1:0,'index work boundary produces exact native draw count');if(n===indexCeiling)c.equal(nativeDraws().at(-1).args[2],n,'native array draw count matches original ceiling');}
  }
  c.equal(native.getError(),native.NO_ERROR,'zero actual WebGL errors');row.status='passed';
 }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
 finally{row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.beforeDispose=copy(rig.host.bridge.inspect());row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=rig.trace.snapshot();row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}window.__productionCriticActive=null;}
 return row;
}
export async function runProductionLifetimes({WasmVirglSubmitProof,schedules=[0,1,2]}){
 const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});if(!native)throw Error('Hardware WebGL2 unavailable');const qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',qualification:copy(qualification),rows:[],hostOptionAttacks:[],actualLinuxGuest:false,productionConstructor:true};window.__productionCriticReport=report;
 const transport=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(k=>[k,()=>{throw Error('Invalid host limits may not touch DMA');}]));
 for(const [name,extra]of [['draws',{drawLimits:{drawsPerSubmission:257}}],['indices',{drawLimits:{indicesPerSubmission:262145}}],['transfer',{jobLimits:{transferBytes:33554433}}]]){const result=createVirglProductionBridge({gl:native,shaderBridge:compiler,transport,presenter:createWorkerScanoutPresenter(()=>{}),...extra});if(result.ok){result.bridge.dispose();throw Error('Production ceiling can be raised: '+name);}report.hostOptionAttacks.push({name,result:copy(result)});}
 for(const schedule of schedules)for(const mode of ['lifetime']){const row=await one(WasmVirglSubmitProof,qualification,native,compiler,schedule,mode),index=report.rows.length;report.rows.push({...await window.__recordProductionCriticRun(index,JSON.stringify(row)),name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
 report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed').map(r=>({name:r.name,failure:r.failure})),hardware:qualification.identity};return report;
}

// Repeated original SG addresses let the 4MiB fixture own a real 32MiB
// logical backing. It remains actual DMA; both native transfer buffers and
// every input/output byte are digested independently after completion.
