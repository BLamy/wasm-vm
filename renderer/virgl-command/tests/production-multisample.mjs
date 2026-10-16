import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join,shader,word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
const copy = value => JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const put = (bytes,offset,value) => new DataView(bytes.buffer).setUint32(offset,value,true);
function resource(id,format,bind,samples,width=16,height=16) {
  const bytes=header(0x204,0,72);
  [id,2,format,bind,width,height,1,1,0,samples,0,0].forEach((v,i)=>put(bytes,24+4*i,v));return bytes;
}
const blit = (source,destination,format=67,mask=15,side=16) => packet(16,0,[mask,0,0,destination,0,format,0,0,0,side,side,1,source,0,format,0,0,0,side,side,1]);
const clear = (buffers,color,depth=0) => {
  const values=[buffers,...color.map(word),0,0,0],bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,depth,true);
  values[5]=bits.getUint32(0,true);values[6]=bits.getUint32(4,true);return packet(7,0,values);
};
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,0,0,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
async function one(Wasm,profile,native,compiler,schedule) {
  const nativeOwners=new Set(),c=checker(),row={name:'four-sample/schedule'+schedule,native:[],predictions:{clear:'Every resolved pixel is green',coverage:'Diagonal triangle resolves partial red/blue edge coverage',depth:'Resolved Z16 quarter depth is within one UN16 quantization step of16384',lifetime:'Original unref waits behind the fenced resolve'}};
  const gl=new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{row.native.push({name,args:args.map(v=>ArrayBuffer.isView(v)?[...v]:typeof v==='object'?v?.constructor.name:v)});const value=method.apply(target,args);if(name==='createRenderbuffer'&&value)nativeOwners.add(value);if(name==='deleteRenderbuffer')nativeOwners.delete(args[0]);return value;};}});
  const selected=class {constructor(callback){return Wasm.qualified(callback,profile.hostWords,profile.formatRoles,profile.renderer);}};
  const rig=makeRig(selected,options=>createVirglProductionBridge({...options,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,schedule,true,false,true);
  const output=rig.q.base+0x220000n,address=rig.q.base+0x210000n;
  window.__productionCriticActive=()=>({row,guest:copy(rig.q.vm.inspect()),host:copy(rig.host.bridge.inspect())});
  try {
    await rig.expect('original context',context(1));
    for (const [id,format,bind,samples] of [[1,67,2,4],[2,67,2,0],[3,16,1,4],[4,16,1,0]]) {
      await rig.expect('original sample allocation'+id,resource(id,format,bind,samples));
      await rig.expect('original membership'+id,idCommand(0x202,1,id));
    }
    await rig.expect('resolved color backing',backing(2,[[output,4096]]));
    await rig.expect('resolved depth backing',backing(4,[[output+0x2000n,4096]]));
    const read = async (id,expectedBytes) => {
      const index=rig.exchanges.length;await rig.expect('original resolved readback'+id,transfer(1,id,2,[0,0,0,16,16,1],0n,0,0,11n));
      const exchange=rig.exchanges[index];const data=Uint8Array.from(exchange.bytes.match(/../g).map(v=>parseInt(v,16)));
      c.equal(data.length,expectedBytes,'complete original DMA bytes');return data;
    };
    await rig.expect('actual four-sample clear and original BLIT',submission(1,join(packet(1,8,[20,1,67,0,0]),packet(1,8,[21,3,16,0,0]),packet(5,0,[1,21,20]),clear(5,[0,1,0,1],.25),blit(1,2),blit(3,4,16,16)),7n));
    const green=await read(2,1024);c.truth(green.every((v,i)=>v===(i%4===1||i%4===3?255:0)),'literal green pixels after native resolve');
    const depth=await read(4,512);c.truth(new Uint16Array(depth.buffer).every(v=>Math.abs(v-16384)<=1),'native resolved quarter depth');
    row.clearPixels=[...green];row.depthPixels=[...depth];
    await rig.expect('original vertex allocation',resourceBuffer(5,48));await rig.expect('original vertex membership',idCommand(0x202,1,5));await rig.expect('original vertex backing',backing(5,[[address,48]]));
    rig.q.write(address,new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1]).buffer));await rig.expect('original vertex upload',transfer(1,5,1,[0,0,0,48,1,1]));
    await rig.expect('actual multisample triangle and resolve',submission(1,join(shader(10,0,vertex),shader(11,1,fragment),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,5]),packet(4,0,[0,...[8,8,.5,8,8,.5].map(word)]),packet(5,0,[1,0,20]),clear(4,[0,0,1,1]),packet(1,2,[40,2|1<<29|1<<25,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),packet(8,0,[0,3,4,0,1,0,0,0,0,0,0xffffffff,0]),blit(1,2)),9n));
    const pixels=await read(2,1024);row.edgePixels=[...pixels];
    c.same([...pixels.slice(0,4)],[255,0,0,255],'triangle interior');c.same([...pixels.slice(-4)],[0,0,255,255],'triangle exterior');
    c.truth(Array.from({length:256},(_,i)=>pixels[i*4]).some(v=>v>0&&v<255),'real partial sample coverage survives resolve');
    for(const n of [1,3,5,0xffffffff]) await rig.expect('unsupported sample count'+n,resource(100+n%10,67,2,n),0x1205);
    await rig.expect('native sample budget one beyond',resource(90,67,2,4,2048,2049),0x1201);
    await rig.expect('direct sample DMA refused',transfer(1,1,2,[0,0,0,16,16,1]),0x1205);
    for(const [name,bytes] of [['signed outside',(()=>{const b=blit(1,2);put(b,16*4,-1);return b;})()],['sample stretch',(()=>{const b=blit(1,2);put(b,10*4,15);return b;})()],['format reinterpret',blit(1,2,64)]]) await rig.expect(name,submission(1,bytes,13n),0x1205);
    await rig.expect('mismatched sample attachments',submission(1,join(packet(1,8,[22,4,16,0,0]),packet(5,0,[1,22,20])),15n),0x1205);
    const resolve=rig.q.enqueue('queued original fenced resolve',submission(1,blit(1,2),17n)),unref=rig.q.enqueue('queued original source unref',idCommand(0x102,0,1));
    rig.q.kick();rig.q.run();c.equal(rig.q.usedIndex(),resolve.number,'resolve stays pending until physical fence');
    let steps=0;while(rig.q.usedIndex()<rig.q.next){c.truth(++steps<5000,'bounded resolve retirement');rig.q.run();if(rig.q.usedIndex()<rig.q.next)await rig.step();}
    rig.q.collect(resolve);rig.q.collect(unref);
    c.truth(row.native.some(r=>r.name==='renderbufferStorageMultisample'&&r.args[1]===4),'native four-sample allocation recorded');
    c.truth(row.native.filter(r=>r.name==='blitFramebuffer').length>=4,'native original resolves recorded');
    c.equal(native.getError(),native.NO_ERROR,'no native errors');row.status='passed';
  } catch(error) {row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally {row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.beforeDispose=copy(rig.host.bridge.inspect());row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned={...rig.trace.snapshot(),liveRenderbuffers:nativeOwners.size};row.assertions=c.assertions;if(row.cleaned.liveObjects||row.cleaned.liveSyncs||row.cleaned.liveRenderbuffers){row.status='failed';row.cleanupFailure='Native owners leaked';}window.__productionCriticActive=null;}
  return row;
}
function resourceBuffer(id,width) {const b=resource(id,64,16,0,width,1);put(b,28,0);return b;}
export async function runProductionMultisample({WasmVirglSubmitProof,schedules=[0,1,2]}) {
  const native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),qualification=await qualifyVirglHost(native),compiler=await createVirglStandardStreamOutputShaderBridge();
  const report={status:'running',qualification:copy(qualification),rows:[]};window.__productionCriticReport=report;
  for(const schedule of schedules) {const row=await one(WasmVirglSubmitProof,qualification,native,compiler,schedule),index=report.rows.length;report.rows.push({...await window.__recordProductionCriticRun(index,JSON.stringify(row)),name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
  report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed').map(r=>({name:r.name,failure:r.failure})),hardware:qualification.identity};return report;
}
