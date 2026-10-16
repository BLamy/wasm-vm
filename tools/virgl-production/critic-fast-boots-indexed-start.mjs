// Independent original-queue hint/offset/restart attack. No transport replacement.
import {checker, makeRig, context, idCommand, header, backing, transfer, submission} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {packet, join, shader, word} from '../virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge, createVirglStandardStreamOutputSubmitBridge} from '../../renderer/virgl-command/control-bridge.mjs';
import {qualifyVirglHost, createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';

const copy = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString() : v));
const hex = bytes => [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const vertex = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment = 'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,0,1,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
function allocate(id, target, format, bind, width, height = 1) {
  const bytes = header(0x204, 0, 72);
  [id,target,format,bind,width,height,1,1,0,0,0,0].forEach((v,i) => put(bytes,24+i*4,v));
  return bytes;
}

async function one(Wasm, qualified, gl, compiler, schedule, production) {
  const c = checker(), row = {name: 'ignored-start-u32-restart-offset12-schedule' + schedule + (production ? '-production' : '-private'),
    production, schedule, predictions: {
      reference: 'VirGL1.3.0 ca50e008 vrend_renderer.c6139-6157 uses ib.offset only for indexed calls.',
      indices: 'Retained byte offset12 selects exactly seven u32 values0,1,2,MAX,2,1,3; poisoned prefix/suffix remain unselected.',
      pixels: 'Both complementary strip segments fill all16 pixels magenta; start0/1/u32MAX cannot change them.',
      refusals: 'Count extending into suffix reaches actual vertex bound; signed array start uses restart disabled; both refuse before native draw.',
      private: 'Historical private profile retains nonzero indexed-start refusal.'}};
  const nativeReads=[];
  const observedGl=new Proxy(gl,{get(target,name){
    const method=Reflect.get(target,name,target);
    if(typeof method!=='function')return method;
    return (...args)=>{
      const result=method.apply(target,args);
      if(name==='getBufferSubData')nativeReads.push({target:args[0],offset:args[1],bytes:hex(new Uint8Array(args[2].buffer,args[2].byteOffset,args[2].byteLength))});
      return result;
    };
  }});
  const Selected = class {constructor(callback) {return Wasm.qualified(callback,qualified.hostWords,qualified.formatRoles,qualified.renderer);}};
  const rig = makeRig(Selected, options => production
    ? createVirglProductionBridge({...options, presenter: createWorkerScanoutPresenter(() => {})})
    : createVirglStandardStreamOutputSubmitBridge(options), observedGl, compiler, c, schedule, true, false, true);
  const vertexAddress = rig.q.base + 0x210000n, indexAddress = rig.q.base + 0x220000n, colorAddress = rig.q.base + 0x230000n;
  const indexWords = [99,99,99,0,1,2,0xffffffff,2,1,3,99,99,99];
  const indexBytes = new Uint8Array(indexWords.length * 4);
  indexWords.forEach((v,i) => put(indexBytes,i*4,v));
  const vertices = new Uint8Array(new Float32Array([-1,-1,0,1, 1,-1,0,1, -1,1,0,1, 1,1,0,1]).buffer);
  const draw = (start,count=7) => packet(8,0,[start,count,5,1,1,0,0,1,0xffffffff,2,2,0]);
  const drawCalls = () => rig.trace.calls.length;
  try {
    await rig.expect('novel original context',context(1));
    for (const [id,target,format,bind,width,height,address,length] of [
      [1,2,67,2,4,4,colorAddress,64], [2,0,64,16,64,1,vertexAddress,64],
      [3,0,64,32,indexBytes.length,1,indexAddress,indexBytes.length],
    ]) {
      await rig.expect('novel actual resource'+id,allocate(id,target,format,bind,width,height));
      await rig.expect('novel original membership'+id,idCommand(0x202,1,id));
      await rig.expect('novel original backing'+id,backing(id,[[address,length]]));
    }
    rig.q.write(vertexAddress,vertices);rig.q.write(indexAddress,indexBytes);
    await rig.expect('novel original vertex upload',transfer(1,2,1,[0,0,0,64,1,1]));
    await rig.expect('novel original poisoned index upload',transfer(1,3,1,[0,0,0,indexBytes.length,1,1]));
    const uploaded=rig.exchanges.filter(x=>x.kind==='input'&&x.args[3]===3);
    c.equal(uploaded.length,1,'one original poisoned index upload');
    c.equal(uploaded[0].bytes,hex(indexBytes),'original upload authenticates the entire poisoned input');
    await rig.expect('novel original shaders/state',submission(1,join(
      shader(10,0,vertex),shader(11,1,fragment),packet(31,0,[10,0]),packet(31,0,[11,1]),
      packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,2]),
      packet(1,8,[20,1,67,0,0]),packet(5,0,[1,0,20]),packet(4,0,[0,...[2,2,.5,2,2,.5].map(word)]),
      packet(11,0,[3,4,12]),packet(1,1,[30,0,0,15<<27,0,0,0,0,0,0,0]),packet(2,1,[30]),
      packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),
    )));
    row.frames=[];
    for (const start of production ? [0,1,0xffffffff] : [0,1]) {
      const before = drawCalls(), nativeStart=nativeReads.length, eventStart=rig.trace.events.length;
      const refusal = !production && start !== 0;
      await rig.expect('novel indexed start'+start,submission(1,draw(start),BigInt(start)+40n),refusal ? 0x1205 : 0x1100);
      c.equal(drawCalls()-before,refusal ? 0 : 1,'exact original indexed native draw count');
      if (refusal) continue;
      const retainedCopies=rig.trace.events.slice(eventStart).filter(x=>x.name==='copyBufferSubData'&&x.bytes===28);
      const retainedReads=nativeReads.slice(nativeStart).filter(x=>x.bytes.length===56);
      c.equal(retainedCopies.length,1,'one retained index staging copy');
      c.equal(retainedCopies[0].sourceOffset,12,'binding byte offset independent of start');
      c.equal(retainedCopies[0].destinationOffset,0,'private staging begins at zero');
      c.equal(retainedReads.length,1,'one actual retained index read');
      c.equal(retainedReads[0].bytes,hex(indexBytes.slice(12,40)),'literal exact seven indices, no poison');
      const selected=rig.host.bridge.inspect().lastRendererResult.draws[0];
      c.equal(selected.actualMinIndex,0,'minimum comes from actual bytes, not hint2');
      c.equal(selected.actualMaxIndex,3,'maximum comes from actual bytes, not hint2');
      c.equal(selected.restartCount,1,'one actual fixed restart');
      await rig.expect('novel original magenta readback',transfer(1,1,2,[0,0,0,4,4,1]));
      const pixels=rig.q.read(colorAddress,64);
      for(let at=0;at<pixels.length;at+=4)c.same([...pixels.slice(at,at+4)],[255,0,255,255],'independent magenta quad pixel'+at/4);
      c.equal(hex(rig.q.read(indexAddress,indexBytes.length)),hex(indexBytes),'entire original poisoned index backing unchanged');
      row.frames.push({start,retainedCopies,retainedReads,selected,pixels:hex(pixels)});
    }
    const beforeBad=drawCalls();
    await rig.expect('novel suffix actual vertex fetch refusal',submission(1,draw(0,8)),0x1205);
    await rig.expect('novel count beyond storage refusal',submission(1,draw(0,11)),0x1205);
    const arrayWire=packet(8,0,[0x7fffffff,7,5,0,1,0,0,0,0,0,0xffffffff,0]);
    await rig.expect('novel valid packet signed array guard',submission(1,arrayWire),0x1205);
    c.equal(drawCalls(),beforeBad,'all negative cases refuse before native draw');
    c.equal(gl.getError(),gl.NO_ERROR,'no native API error');
    row.status='passed';
  } catch(error) {row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally {
    row.records=copy(rig.q.records);row.events=copy(rig.events);row.nativeEvents=copy(rig.trace.events);row.nativeReads=copy(nativeReads);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);
    row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());
    row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=rig.trace.snapshot();row.assertions=c.assertions;
    if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}
  }
  return row;
}

export async function runProductionIndexedStartCritic({WasmVirglSubmitProof,schedules=[173205,987654]}) {
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});
  const qualified=await qualifyVirglHost(gl),compiler=await createVirglStandardStreamOutputShaderBridge();
  const report={status:'running',rows:[],hardware:qualified.identity};window.__productionCriticReport=report;
  for(const schedule of schedules)for(const production of [true,false]) {
    const row=await one(WasmVirglSubmitProof,qualified,gl,compiler,schedule,production);
    const pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));
    report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});
  }
  report.status=report.rows.every(x=>x.status==='passed')?'passed':'failed';
  report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(x=>x.status!=='passed'),hardware:qualified.identity};
  return report;
}
