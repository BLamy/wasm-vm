import {checker,Queue,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {packet,join,shader,word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {createJournalledProductionBridge,restoreProductionRenderer} from '../checkpoint.mjs';
import {clear} from '../../../tools/virgl-dimensional-depth-surfaces/fixtures.mjs';
import {entry,layout} from '../../../tools/virgl-stream-output-shaders/fixtures.mjs';

const put=(bytes,at,n)=>new DataView(bytes.buffer).setUint32(at,n,true);
const copy=value=>JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function allocation(id,target,format,bind,width,height=1,arraySize=1,lastLevel=0) {
  const bytes=header(0x204,0,72);[id,target,format,bind,width,height,1,arraySize,lastLevel,0,0].forEach((n,i)=>put(bytes,24+4*i,n));return bytes;
}
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment=color=>'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {'+color+'}\n0: MOV OUT[0], IMM[0]\n1: END\n';
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
function feedbackShader(handle,text) {
  const words=layout([4,0,0,0],[entry(1,0,4,0,0)]),extra=words.slice(1);
  const bytes=packet(1,4,[handle,0,text.length+1,8192,words[0],...extra,...Array(Math.ceil((text.length+1)/4)).fill(0)]);
  bytes.set(new TextEncoder().encode(text),24+extra.length*4);return bytes;
}
function observed(gl,events,control={}) {
  const ids=new WeakMap();control.objects=new Set();let next=1;
  const encode=v=>ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:[...new Uint8Array(v.buffer,v.byteOffset,v.byteLength)]}:v&&typeof v==='object'?(ids.has(v)?ids.get(v):(ids.set(v,next),next++)):v;
  return new Proxy(gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{
    const row={name,args:args.map(encode)};events.push(row);const value=method.apply(target,args);row.result=encode(value);
    if((/^create/.test(name)||name==='fenceSync') && value && typeof value==='object')control.objects.add(value);if(/^delete/.test(name))control.objects.delete(args[0]);
    const delivered=name==='getQueryParameter' && args[1]===target.QUERY_RESULT_AVAILABLE && control.holdAvailability?false:value;
    if(delivered!==value)row.delivered=delivered;
    if(name==='getQueryParameter' && args[1]===target.QUERY_RESULT_AVAILABLE && value===true && control.releaseAfterReady && !control.releaseScheduled){control.releaseScheduled=true;setTimeout(()=>{control.holdAvailability=false;},20);}
    if(name==='getBufferSubData')row.output=args.map(encode);return delivered;
  };}});
}
export async function runProductionCheckpoint({WasmVirglSubmitProof}) {
  const c=checker(),row={name:'fresh-production-context/original-wire',native:[[],[]],frames:[],predictions:{gpu:'Green draw differs from poisoned guest backing; fresh context reproduces exact physical bytes. Next original shader/draw produces red.',replay:'No live-native gather/scatter/completion or guest mutation during reconstruction.'}};
  const canvases=[document.querySelector('#gpu'),document.createElement('canvas')];canvases[1].width=canvases[1].height=4;
  const native=canvases.map(canvas=>canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}));
  c.truth(native[0]!==native[1],'genuinely different physical WebGL contexts');
  const profiles=await Promise.all(native.map(gl=>qualifyVirglHost(gl))),compiler=await createVirglStandardStreamOutputShaderBridge();
  const controls=[{},{}],gl=native.map((gl,index)=>observed(gl,row.native[index],controls[index]));let q,current,calls=0;
  const transport=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name=>[name,(...args)=>{calls++;return q.vm[name](...args);} ]));
  const presenter=()=>{let p;p=createWorkerScanoutPresenter(frame=>{if(frame.pixels)row.frames.push({rect:frame.rect,pixels:[...frame.pixels]});if(frame.presentationToken)queueMicrotask(()=>p.acknowledge(frame.presentationToken,'superseded'));});return p;};
  current=c.ok(createJournalledProductionBridge({gl:gl[0],profile:profiles[0],shaderBridge:compiler,transport,presenter:presenter()}),'journal owner').bridge;
  const source=current,Selected=class{constructor(callback){return WasmVirglSubmitProof.qualified(callback,profiles[0].hostWords,profiles[0].formatRoles,profiles[0].renderer);}};
  q=new Queue(Selected,event=>current.apply(event),c);
  const expect=async(label,bytes)=>{const entry=q.enqueue(label,bytes);q.kick();let turns=0;while(q.usedIndex()<q.next){c.truth(++turns<20000,'bounded original device completion');q.run();if(q.usedIndex()<q.next)c.ok(current.pump(),'physical pump');await turn();}const result=q.collect(entry);q.vm.writeMmio(0x64,1);return result;};
  const base=q.base+0x210000n;
  try {
    await expect('original context',context(1));
    for(const [id,target,format,bind,w,h,offset,length]of [[1,2,67,2,4,4,0n,64],[2,0,64,16,64,1,0x1000n,64],[3,2,20,1,4,4,0x2000n,64]]) {
      await expect('allocation'+id,allocation(id,target,format,bind,w,h));await expect('backing'+id,backing(id,[[base+offset,length]]));await expect('membership'+id,idCommand(0x202,1,id));
    }
    q.write(base,new Uint8Array(64).fill(0x5b));
    q.write(base+0x1000n,new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,1,0,1]).buffer));
    await expect('vertex upload',transfer(1,2,1,[0,0,0,64,1,1]));
    await expect('dimensional depth stencil allocation',allocation(4,7,20,9,4,4,3,1));
    await expect('dimensional backing',backing(4,[[base+0x3000n,256]]));await expect('dimensional membership',idCommand(0x202,1,4));
    const depth=new Uint8Array(256);for(let i=0;i<64;i++)put(depth,i*4,0xbfffff11);q.write(base+0x3000n,depth);
    await expect('original all depth stencil base layers',transfer(1,4,1,[0,0,0,4,4,3]));
    const level1=transfer(1,4,1,[0,0,0,2,2,3],192n);put(level1,60,1);await expect('original all depth stencil mip layers',level1);
    await expect('GPU writes one depth stencil mip layer',submission(1,join(packet(1,8,[22,4,20,1,1|1<<16]),packet(5,0,[0,22]),clear(3,0x5a,.25,[0,0,0,0]))));
    q.write(base+0x3000n,new Uint8Array(256).fill(0x6d));
    await expect('shaders state and physical green draw',submission(1,join(shader(10,0,vertex),shader(11,1,fragment('0,1,0,1')),packet(31,0,[10,0]),packet(31,0,[11,1]),
      packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,2]),packet(1,8,[20,1,67,0,0]),packet(1,8,[21,3,20,0,0]),packet(5,0,[1,21,20]),packet(4,0,[0,...[2,2,.5,2,2,.5].map(word)]),draw()),0x20000000000071n));
    c.same([...q.read(base,64)],Array(64).fill(0x5b),'draw never wrote poisoned guest backing');
    // A real private mip allocation and the old public generation survive ID reuse.
    await expect('old sampler image',allocation(8,2,67,8,4,4,1,1));
    await expect('old sampler backing',backing(8,[[base+0x6000n,80]]));await expect('old sampler member',idCommand(0x202,1,8));
    q.write(base+0x6000n,Uint8Array.from([...Array.from({length:16},()=>[0,255,0,255]).flat(),...Array.from({length:4},()=>[0,0,255,255]).flat()]));
    await expect('old sampler base upload',transfer(1,8,1,[0,0,0,4,4,1]));
    const mip=transfer(1,8,1,[0,0,0,2,2,1],64n);put(mip,60,1);await expect('old sampler blue mip upload',mip);
    const sampled='FRAG\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.25,0.25,0,0}\n0: TEX OUT[0], IMM[0], SAMP[0], 2D\n1: END\n';
    const sampleState=()=>join(packet(25,0,[0]),packet(31,0,[10,0]),packet(31,0,[72,1]));
    await expect('materialize and sample private blue mip',submission(1,join(shader(72,1,sampled),packet(1,6,[71,8,67|2<<24,0,1|1<<8,0x688]),packet(10,0,[1,0,71]),packet(1,7,[70,2|(2<<3)|(2<<6)|(2<<11),0,0,0x447a0000,0,0,0,0]),packet(18,0,[1,0,70]),sampleState(),draw())));
    await expect('original private blue output',transfer(1,1,2,[0,0,0,4,4,1]));c.same([...q.read(base,64)],Array.from({length:16},()=>[0,0,255,255]).flat(),'private mip actually sampled literal blue');
    row.retainedBefore=copy(current.inspect().store);
    await expect('unref old public sampler ID',idCommand(0x102,0,8));
    await expect('different same-name sampler generation',allocation(8,2,67,8,2,2));await expect('replacement backing',backing(8,[[base+0x7000n,16]]));await expect('replacement member',idCommand(0x202,1,8));
    q.write(base+0x7000n,Uint8Array.from(Array.from({length:4},()=>[0,255,255,255]).flat()));await expect('replacement cyan upload',transfer(1,8,1,[0,0,0,2,2,1]));
    row.retainedAfter=copy(current.inspect().store);c.equal(row.retainedAfter.resources.filter(r=>r.id===8).length,2,'old retained and replacement public generations coexist');
    await expect('cached old generation still samples blue',submission(1,draw()));await expect('old generation blue output',transfer(1,1,2,[0,0,0,4,4,1]));c.same([...q.read(base,64)],Array.from({length:16},()=>[0,0,255,255]).flat(),'same-name replacement cannot redirect old view');
    await expect('green before checkpoint',submission(1,join(packet(31,0,[11,1]),draw())));
    for(const [id,bind,size,offset]of [[6,2160,256,0x4000n],[7,131072,32,0x5000n]]) {
      await expect('feedback/query resource'+id,allocation(id,0,64,bind,size));await expect('feedback/query backing'+id,backing(id,[[base+offset,size]]));await expect('feedback/query member'+id,idCommand(0x202,1,id));
      q.write(base+offset,new Uint8Array(size).fill(id===6?0xa7:0));await expect('feedback/query upload'+id,transfer(1,id,1,[0,0,0,size,1,1]));
    }
    const soVertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[0]\n2: END\n';
    await expect('original feedback and query writes',submission(1,join(feedbackShader(64,soVertex),packet(31,0,[64,0]),
      packet(1,2,[61,2|8|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[61]),packet(1,10,[60,6,0,256]),packet(25,0,[0,60]),
      packet(1,9,[62,6,0,7]),packet(19,0,[62]),draw(),packet(20,0,[62]))));
    await source.saveCheckpoint().then(()=>{throw Error('ended native query was accepted');},error=>{row.busyQueryRefusal=error.message;});
    controls[0].holdAvailability=true;
    await expect('legally delayed actual feedback query',submission(1,packet(21,0,[62,0])));
    await expect('original WAIT_HOST query result',transfer(1,7,2,[0,0,0,16,1,1]));
    c.same([...q.read(base+0x5000n,16)],[2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],'original guest observes WAIT_HOST before actual ready publication');
    c.truth(row.native[0].some(e=>e.name==='getQueryParameter' && e.result===true && e.delivered===false),'only physically ready availability was delayed');
    controls[0].holdAvailability=false;
    await expect('drained actual feedback query',submission(1,packet(21,0,[62,1])));
    await expect('actual feedback query result',transfer(1,7,2,[0,0,0,16,1,1]));
    c.same([...q.read(base+0x5000n,16)],[1,0,0,0,4,0,0,0,2,0,0,0,0,0,0,0],'actual query counted two original triangles');
    q.write(base+0x4000n,new Uint8Array(256).fill(0x6d));
    const scanout=header(0x103,0,48);[0,0,4,4,0,1].forEach((n,i)=>put(scanout,24+4*i,n));await expect('original scanout binding',scanout);
    const flush=header(0x104,0,48);[0,0,4,4,1,0].forEach((n,i)=>put(flush,24+4*i,n));await expect('original physical scanout FLUSH',flush);await turn();c.equal(current.inspect().scanout.presenter.retainedFrames,0,'source physical presenter receipt drained');c.equal(row.frames.length,1,'source physical scanout published once');
    const capturing=source.saveCheckpoint();const overlapping=source.saveCheckpoint().then(()=>({accepted:true}),error=>({accepted:false,message:error.message}));
    row.checkpoint=await capturing;c.equal((await overlapping).accepted,false,'overlapping capture refuses without invalidating first capture');row.checkpoint={...row.checkpoint,bytes:Array.from(row.checkpoint.bytes)};
    const before={calls,used:q.usedIndex(),digest:q.vm.machineDigest(),ram:[...q.read(q.base,4096)]};
    c.ok(source.dispose(),'old context owners disposed');
    const saved=Uint8Array.from(row.checkpoint.bytes);
    row.refusals=[];for(const [label,bytes,profile]of [['truncated',saved.subarray(0,-1),profiles[1]],['digest',saved.map((v,i)=>i===20?v^1:v),profiles[1]],['profile',saved,{...profiles[1],renderer:'incompatible renderer'}]]) {
      const count=row.native[1].length;await restoreProductionRenderer(bytes,{gl:gl[1],profile,shaderBridge:compiler,transport,presenter:presenter()}).then(()=>{throw Error(label+' was accepted');},error=>row.refusals.push({label,message:error.message}));c.equal(row.native[1].length,count,label+' refuses before physical allocations');
    }
    controls[1].holdAvailability=true;controls[1].releaseAfterReady=true;
    const restored=await restoreProductionRenderer(saved,{gl:gl[1],profile:profiles[1],shaderBridge:compiler,transport,presenter:presenter()});
    c.equal(calls,before.calls,'reconstruction invoked no live-native DMA or completion');c.equal(q.usedIndex(),before.used,'reconstruction preserves original used ring');c.same(q.vm.machineDigest(),before.digest,'reconstruction preserves complete native digest');c.same([...q.read(q.base,4096)],before.ram,'reconstruction leaves native RAM untouched');
    c.truth(controls[1].releaseScheduled && row.native[1].some(e=>e.name==='getQueryParameter' && e.result===true && e.delivered===false),'fresh physical readiness was legally delayed before replay continued');
    c.equal(row.frames.length,1,'historical replay never posts a live presenter frame');
    current=restored.bridge;c.ok(await current.activate(),'fresh physical scanout repair');await turn();
    row.restore=copy({...restored,bridge:undefined});
    const depthRead=transfer(1,4,2,[0,0,0,2,2,3],192n);put(depthRead,60,1);await expect('restored dimensional depth stencil bytes',depthRead);
    const depthWords=new DataView(q.read(base+0x3000n+192n,48).buffer);
    c.same(Array.from({length:12},(_,i)=>depthWords.getUint32(i*4,true)),[...Array(4).fill(0xbfffff11),...Array(4).fill(0x4000005a),...Array(4).fill(0xbfffff11)],'all mip layers include literal GPU-written depth and stencil');
    await expect('NEW feedback capture with preserved cursor',submission(1,join(packet(19,0,[62]),draw(),packet(20,0,[62]))));
    await expect('NEW drained feedback query',submission(1,packet(21,0,[62,1])));
    await expect('NEW actual query result',transfer(1,7,2,[0,0,0,16,1,1]));
    c.same([...q.read(base+0x5000n,16)],[1,0,0,0,4,0,0,0,2,0,0,0,0,0,0,0],'fresh physical query counted two NEW triangles');
    await expect('all restored plus appended feedback bytes',transfer(1,6,2,[0,0,0,256,1,1]));
    const vertices=[[-1,-1,0,1],[1,-1,0,1],[-1,1,0,1],[1,1,0,1]],captured=new Uint8Array(new Float32Array([0,1,2,2,1,3].flatMap(i=>vertices[i])).buffer),expectedCapture=new Uint8Array(256).fill(0xa7);
    expectedCapture.set(captured);expectedCapture.set(captured,96);c.same([...q.read(base+0x4000n,256)],[...expectedCapture],'GPU-written bytes and original stream-output cursor survived reconstruction');
    await expect('resume original color pipeline',submission(1,join(packet(25,0,[0]),packet(31,0,[10,0]),packet(1,2,[66,2|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[66]))));
    await expect('restored original green read',transfer(1,1,2,[0,0,0,4,4,1]));c.same([...q.read(base,64)],Array.from({length:16},()=>[0,255,0,255]).flat(),'all fresh-context green pixels');
    await expect('fresh old private range sample',submission(1,join(sampleState(),draw())));await expect('fresh private blue output',transfer(1,1,2,[0,0,0,4,4,1]));c.same([...q.read(base,64)],Array.from({length:16},()=>[0,0,255,255]).flat(),'retained private allocation samples old blue after fresh reconstruction');
    await expect('fresh public replacement output',transfer(1,8,2,[0,0,0,2,2,1]));c.same([...q.read(base+0x7000n,16)],Array.from({length:4},()=>[0,255,255,255]).flat(),'different public replacement remains cyan');
    await expect('new original red shader and draw',submission(1,join(shader(13,1,fragment('1,0,0,1')),packet(31,0,[13,1]),draw()),0x20000000000073n));
    await expect('new original red read',transfer(1,1,2,[0,0,0,4,4,1]));c.same([...q.read(base,64)],Array.from({length:16},()=>[255,0,0,255]).flat(),'all NEW original red pixels');
    c.truth(row.native[1].some(e=>e.name==='drawArrays'),'fresh context performed real physical draws');
    const msaa=allocation(9,2,67,2,4,4);put(msaa,60,4);await expect('real unresolved MSAA allocation',msaa);await expect('real unresolved MSAA membership',idCommand(0x202,1,9));
    await current.saveCheckpoint().then(()=>{throw Error('MSAA checkpoint was accepted');},error=>{row.msaaRefusal=error.message;});await expect('retire unsupported checkpoint MSAA owner',idCommand(0x102,0,9));await current.saveCheckpoint();
    c.equal(current.apply({type:'invalid-checkpoint-control'}).ok,false,'failed original event refuses');await current.saveCheckpoint().then(()=>{throw Error('failed-prefix checkpoint was accepted');},error=>{row.failedPrefixRefusal=error.message;});
    row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{row.guest=copy(q.vm.inspect());row.trace=q.vm.commandTrace();row.digest=q.vm.machineDigest();row.beforeDispose=copy(current.inspect());row.disposed=copy(current.dispose());if(row.status==='passed')for(let i=0;i<controls.length;i++)c.equal(controls[i].objects.size,0,'all physical objects and syncs released in context'+i);q.vm.free();row.assertions=c.assertions;}
  await window.__recordProductionCriticRun(0,JSON.stringify(row));
  return {status:row.status,summary:{status:row.status,runs:1,...(row.failure?{failure:row.failure}:{})},row};
}

export async function runCheckpointBudgetRefusals({WasmVirglSubmitProof},startIndex=1) {
  const compiler=await createVirglStandardStreamOutputShaderBridge(),rows=[];
  for(const journalLimits of [{bytes:0},{frames:0}]) {
    const c=checker(),row={name:'bounded-journal-rendering-continues/'+Object.keys(journalLimits)[0],journalLimits,native:[]},control={};rows.push(row);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=4;const native=canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),profile=await qualifyVirglHost(native),gl=observed(native,row.native,control);
    let q;const transport=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name=>[name,(...args)=>q.vm[name](...args)]));
    const owner=c.ok(createJournalledProductionBridge({gl,profile,shaderBridge:compiler,transport,presenter:createWorkerScanoutPresenter(()=>{}),journalLimits}),'bounded journal owner').bridge;
    const Selected=class{constructor(callback){return WasmVirglSubmitProof.qualified(callback,profile.hostWords,profile.formatRoles,profile.renderer);}};q=new Queue(Selected,event=>owner.apply(event),c);
    const expect=async(label,bytes)=>{const entry=q.enqueue(label,bytes);q.kick();let turns=0;while(q.usedIndex()<q.next){c.truth(++turns<20000,'bounded original completion');q.run();if(q.usedIndex()<q.next)c.ok(owner.pump(),'actual GPU pump');await turn();}const result=q.collect(entry);q.vm.writeMmio(0x64,1);return result;};
    try {
      await expect('original context',context(1));c.equal(owner.inspect().checkpoint.available,false,'journal policy exhausted');
      await expect('original color allocation',allocation(1,2,67,2,4,4));await expect('original color membership',idCommand(0x202,1,1));await expect('original backing',backing(1,[[q.base+0x210000n,64]]));
      q.write(q.base+0x210000n,new Uint8Array(64).fill(0x63));
      await expect('ordinary physical green clear after budget overflow',submission(1,join(packet(1,8,[20,1,67,0,0]),packet(5,0,[1,0,20]),clear(4,0,0,[0,1,0,1].map(word)))));
      await expect('ordinary original GPU read after budget overflow',transfer(1,1,2,[0,0,0,4,4,1]));c.same([...q.read(q.base+0x210000n,64)],Array.from({length:16},()=>[0,255,0,255]).flat(),'all physical green pixels survive journal overflow');
      const before=q.vm.machineDigest();await owner.saveCheckpoint().then(()=>{throw Error('overflow checkpoint accepted');},error=>{row.refusal=error.message;});c.same(q.vm.machineDigest(),before,'checkpoint refusal preserves complete native machine');
      c.ok(owner.dispose(),'release overflow owner');c.equal(control.objects.size,0,'overflow leaves no native objects or fences');row.status='passed';
    }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
    finally {row.trace=q.vm.commandTrace();row.digest=q.vm.machineDigest();row.host=copy(owner.inspect());owner.dispose();q.vm.free();row.assertions=c.assertions;}
    await window.__recordProductionCriticRun(startIndex+rows.length-1,JSON.stringify(row));
  }
  return {status:rows.every(r=>r.status==='passed')?'passed':'failed',summary:{runs:rows.length,failed:rows.filter(r=>r.status!=='passed').map(r=>({name:r.name,failure:r.failure}))}};
}
