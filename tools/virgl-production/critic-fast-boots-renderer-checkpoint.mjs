// Independent literal pixels through original MMIO, immutable DMA and fresh hardware GL.
import {checker,Queue,context,resource,idCommand,header,submission,backing,transfer} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {packet,join,shader,word} from '../virgl-command/standard-image-fixtures.mjs';
import {createJournalledProductionBridge,restoreProductionRenderer} from '../../renderer/virgl-command/checkpoint.mjs';
import {decodeCheckpointData,encodeCheckpointData} from '../../renderer/virgl-command/checkpoint-codec.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString():x));
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,0,1,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
function observer(gl,domain) {
  const objects=new Map(),syncs=new Set(),events=[];let next=1,phase='original';
  const value=v=>ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:v.byteLength}:typeof v==='object'&&v!==null?{native:objects.get(v)??v.constructor.name}:v;
  const observed=new Proxy(gl,{get(target,name){const fn=Reflect.get(target,name,target);if(typeof fn!=='function')return fn;
    return (...args)=>{const result=fn.apply(target,args);if(/^create/.test(name)&&result&&typeof result==='object')objects.set(result,domain+':'+next++);
      if(name==='fenceSync'&&result){objects.set(result,domain+':'+next++);syncs.add(result);}if(/^delete/.test(name)&&args[0]){objects.delete(args[0]);syncs.delete(args[0]);}
      events.push({n:events.length,phase,name,args:args.map(value),...(name==='getError'?{result}:{})});return result;};}});
  return{gl:observed,events,objects,syncs,setPhase:v=>{phase=v;}};
}
async function one(Wasm,compiler,label,attack=false,abort=false,race=null,guard=null) {
  const c=checker(),canvases=[document.createElement('canvas'),document.createElement('canvas')];for(const canvas of canvases)canvas.width=canvas.height=4;
  const native=canvases.map(canvas=>canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}));
  c.truth(native[0]!==native[1],'two different genuine physical GL contexts');
  const profiles=await Promise.all(native.map(gl=>qualifyVirglHost(gl))),observed=native.map((gl,i)=>observer(gl,'physical'+i));
  let q,current,reconstructing=false,calls=0;const exchanges=[],frames=[];
  const transport=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name=>[name,(...args)=>{
    c.equal(reconstructing,false,'reconstruction cannot call live-native '+name);calls++;const result=q.vm[name](...args);
    exchanges.push({n:calls,name,args:args.map(v=>ArrayBuffer.isView(v)?[...v]:v),...(name.startsWith('gather')?{result:[...result]}:{})});return result;
  }]));
  const presenter=()=>{let p;p=createWorkerScanoutPresenter(frame=>{frames.push(copy(frame));if(frame.presentationToken)queueMicrotask(()=>p.acknowledge(frame.presentationToken,'superseded'));});return p;};
  current=c.ok(createJournalledProductionBridge({gl:observed[0].gl,profile:profiles[0],shaderBridge:compiler,transport,presenter:presenter()}),'real journal owner').bridge;const original=current;
  const Selected=class{constructor(callback){return Wasm.qualified(callback,profiles[0].hostWords,profiles[0].formatRoles,profiles[0].renderer);}};
  q=new Queue(Selected,event=>current.apply(event),c);
  const expect=async(label,wire,expected=0x1100)=>{const entry=q.enqueue(label,wire,expected);q.kick();let turns=0;while(q.usedIndex()<q.next){c.truth(++turns<20000,'bounded original queue completion');q.run();if(q.usedIndex()<q.next)c.ok(current.pump(),'real physical completion pump');await turn();}const value=q.collect(entry);q.vm.writeMmio(0x64,1);return value;};
  const base=q.base,addresses={color:base+0x210000n,vertex:base+0x220000n,depth:base+0x230000n};
  const row={name:'immutable-DMA-GPU-only-data-and-cached-state/'+label,predictions:{
    color:'Sixteen GPU pixels are literal magenta while original guest color backing remains0xd3.',
    depth:'Sixteen GPU Z16 values are32768 +/- one UN16 LSB; guest backing remains0xe1.',
    subsequent:'A cached-state draw after capture succeeds. Fresh context reconstructs magenta after live vertex RAM is poisoned, then a NEW half-width draw produces magenta left/blue right.',
    authority:'Replay and scanout repair call no live-native transport method and preserve complete native digest and used/ring/RAM bytes.'}};
  const send=(label,wire)=>expect(label,submission(7,wire));
  const originalRead=async label=>{await expect(label,transfer(7,17,2,[0,0,0,4,4,1]));return q.read(addresses.color,64);};
  const literalColor=rightBlue=>Uint8Array.from(Array.from({length:16},(_,i)=>rightBlue&&i%4>=2?[0,0,255,255]:[255,0,255,255]).flat());
  try {
    await expect('context7 interleaved generation',context(7));
    for(const [id,target,format,bind,width,height,address,length] of [[17,2,67,2,4,4,addresses.color,64],[19,2,16,1,4,4,addresses.depth,32],[23,0,64,16,64,1,addresses.vertex,64]]){
      await expect('resource'+id,resource(id,target,format,bind,width,height));await expect('member'+id,idCommand(0x202,7,id));await expect('backing'+id,backing(id,[[address,length]]));
    }
    q.write(addresses.color,new Uint8Array(64).fill(0xd3));q.write(addresses.depth,new Uint8Array(32).fill(0xe1));
    q.write(addresses.vertex,new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,1,0,1]).buffer));
    await expect('original vertex DMA',transfer(7,23,1,[0,0,0,64,1,1]));
    await send('original shader/state setup and physical draw',join(shader(10,0,vertex),shader(11,1,fragment),packet(31,0,[10,0]),packet(31,0,[11,1]),
      packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,23]),packet(1,8,[20,17,67,0,0]),packet(1,8,[21,19,16,0,0]),
      packet(5,0,[1,21,20]),packet(4,0,[0,...[2,2,.5,2,2,.5].map(word)]),packet(1,1,[30,0,0,15<<27,0,0,0,0,0,0,0]),packet(2,1,[30]),
      packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),packet(1,3,[50,31,0,0,0]),packet(2,3,[50]),draw()));
    c.same([...q.read(addresses.color,64)],[...new Uint8Array(64).fill(0xd3)],'draw preserved CPU color poison');c.same([...q.read(addresses.depth,32)],[...new Uint8Array(32).fill(0xe1)],'draw preserved CPU depth poison');
    if(guard) {
      const rejectCapture=async label=>{const before={used:q.usedIndex(),calls,digest:q.vm.machineDigest()};let error=null;try{await original.saveCheckpoint();}catch(e){error={message:e.message,stack:e.stack};}c.truth(error!==null,label+' capture refuses');c.same({used:q.usedIndex(),calls,digest:q.vm.machineDigest()},before,label+' refusal leaves native state unchanged');row.guardRefusal=error;};
      if(guard==='pending') {
        const entry=q.enqueue('original draw pending at checkpoint',submission(7,draw()));q.kick();q.run();c.truth(current.inspect().pending!==null,'one actual original renderer job pending');
        await rejectCapture('pending original job');let turns=0;while(q.usedIndex()<q.next){c.truth(++turns<20000,'bounded original pending completion');q.run();if(q.usedIndex()<q.next)c.ok(current.pump(),'physical pending job pump');await turn();}q.collect(entry);q.vm.writeMmio(0x64,1);row.afterGuardCheckpoint=copy(await original.saveCheckpoint());
      }else if(guard==='active') {
        const address=base+0x240000n;await expect('original query result buffer',resource(29,0,64,131072,32,1));await expect('original query membership',idCommand(0x202,7,29));await expect('original query backing',backing(29,[[address,32]]));
        await send('original active query',join(packet(1,9,[90,1,0,29]),packet(19,0,[90])));c.equal(current.inspect().renderer.budgets.queries.nativeParts,0,'active query has not measured a draw yet');await rejectCapture('active original query');
        await send('original query ends and drains',join(packet(20,0,[90]),packet(21,0,[90,1])));row.afterGuardCheckpoint=copy(await original.saveCheckpoint());
      }else {
        const bad=packet(8,0,[0,1000,5,0,1,0,0,0,0,0,0xffffffff,0]);await expect('real applied CLEAR prefix then invalid vertex range',submission(7,join(packet(7,0,[4,word(0),word(0),word(1),word(1),0,0,0]),bad)),0x1205);
        row.actualPrefix=copy(current.inspect().lastRendererResult);c.equal(row.actualPrefix.ok,false,'original job actually failed');c.equal(row.actualPrefix.gpuComplete,true,'physical applied prefix settled');c.equal(row.actualPrefix.appliedCommands,1,'one real CLEAR applied before failing DRAW');
        c.equal(current.inspect().checkpoint.available,false,'failed GPU prefix disables journal capture');await rejectCapture('actual applied GPU failure prefix');
        c.same([...await originalRead('physical blue prefix remains readable')],Array.from({length:16},()=>[0,0,255,255]).flat(),'original CLEAR really applied, not merely a printed count');c.equal(current.inspect().poisoned,false,'settled prefix failure allows ordinary rendering');
      }
      row.status='passed';return row;
    }
    if(race) {
      let raced=null;const promise=original.saveCheckpoint().then(value=>({resolved:copy(value)}),error=>({rejected:{message:error.message,stack:error.stack}}));
      if(race==='loss') {
        canvases[0].addEventListener('webglcontextlost',event=>event.preventDefault(),{once:true});
        native[0].getExtension('WEBGL_lose_context').loseContext();c.equal(native[0].isContextLost(),true,'actual physical loss while hashes await');
      }else{
        await expect('original interleaved new context during capture',context(79));
      }
      raced=await promise;
      row.race=raced;c.truth(Boolean(raced.rejected),'concurrent loss or original mutation must refuse capture');
      if(race!=='loss'){await send('original still draws after raced capture refusal',draw());row.afterRacedCheckpoint=copy(await original.saveCheckpoint());}
      row.status='passed';return row;
    }
    const before={used:q.usedIndex(),calls,trace:q.vm.commandTrace(),digest:q.vm.machineDigest()};observed[0].setPhase('checkpoint');const first=await original.saveCheckpoint();observed[0].setPhase('original');
    c.same({used:q.usedIndex(),calls,trace:q.vm.commandTrace(),digest:q.vm.machineDigest()},before,'capture has no native DMA/completion/ring effects');
    const color=first.contents.resources.find(r=>r.metadata.id===17),depth=first.contents.resources.find(r=>r.metadata.id===19);c.truth(color&&depth,'all GPU-only allocations included');
    c.equal(first.contents.allocations[color.storage].levels[0].sha256,await sha(literalColor(false)),'independently constructed magenta physical bytes');
    const depthHashes=[];for(const n of [32767,32768,32769]){const z=new Uint8Array(32),view=new DataView(z.buffer);for(let i=0;i<16;i++)view.setUint16(i*2,n,true);depthHashes.push({n,sha256:await sha(z)});}
    const depthHash=first.contents.allocations[depth.storage].levels[0].sha256;c.truth(depthHashes.some(d=>d.sha256===depthHash),'independent0.5 Z16 physical bytes');row.depthOracle={depthHash,expected:depthHashes};
    await send('immediate same-state original draw after capture',draw());
    const scanout=header(0x103,0,48),sv=new DataView(scanout.buffer);[0,0,4,4,0,17].forEach((n,i)=>sv.setUint32(24+i*4,n,true));await expect('original retained scanout',scanout);
    const flush=header(0x104,0,48),fv=new DataView(flush.buffer);[0,0,4,4,17,0].forEach((n,i)=>fv.setUint32(24+i*4,n,true));await expect('original source physical scanout FLUSH',flush);await turn();
    row.originalPresentationCount=frames.filter(f=>f.pixels).length;c.equal(row.originalPresentationCount,1,'one original source frame actually published');c.equal(original.inspect().scanout.retainedFrames,0,'original presentation receipt really drained');
    const checkpoint=await original.saveCheckpoint();row.checkpoint={...checkpoint,bytes:[...checkpoint.bytes]};
    if(attack) {
      const bytes=new Uint8Array(checkpoint.bytes),payload=decodeCheckpointData(bytes.subarray(16,bytes.length-32));
      if(attack==='incomplete'){const removed=decodeCheckpointData(payload.frames.pop());c.equal(removed.op,'complete','removed exactly last original completion');row.removedCompletion=copy(removed);}
      else {const index=payload.frames.findIndex(b=>{const f=decodeCheckpointData(b);return f.op==='gatherInput'&&f.data?.length===64;});c.truth(index>=0,'one immutable original vertex gather selected');
      const frame=decodeCheckpointData(payload.frames[index]);row.changedInput={index,op:frame.op,args:copy(frame.args),before:[...frame.data]};frame.data[0]^=1;row.changedInput.after=[...frame.data];payload.frames[index]=encodeCheckpointData(frame);}
      const body=encodeCheckpointData(payload),changed=new Uint8Array(body.length+48);changed.set(bytes.subarray(0,12));new DataView(changed.buffer).setUint32(12,body.length,true);changed.set(body,16);changed.set(Uint8Array.from((await sha(changed.subarray(0,-32))).match(/../g),x=>parseInt(x,16)),changed.length-32);
      row.changedArtifact={bytes:[...changed],sha256:await sha(changed)};
      const beforeBad={calls,used:q.usedIndex(),digest:q.vm.machineDigest(),oldOwners:observed[0].objects.size,newOwners:observed[1].objects.size};let error=null;
      reconstructing=true;observed[1].setPhase('corrupt-reconstruction');try{await restoreProductionRenderer(changed,{gl:observed[1].gl,profile:profiles[1],shaderBridge:compiler,transport,presenter:presenter()});}catch(e){error={message:e.message,stack:e.stack};}finally{reconstructing=false;}
      row.corruptRefusal=error;c.truth(error!==null,'rehashed one-byte journal DMA mutation must refuse');c.truth((attack==='incomplete'?/healthy idle renderer/.test(error.message):/physical contents or state differ/.test(error.message)),attack==='incomplete'?'refusal detects the missing completion':'refusal is actual final GPU identity mismatch');
      c.same({calls,used:q.usedIndex(),digest:q.vm.machineDigest(),oldOwners:observed[0].objects.size,newOwners:observed[1].objects.size},beforeBad,'failed isolated candidate cleans every allocation without live-native/source mutation');
      observed[0].setPhase('original-after-refusal');await send('source original still draws after rejected reconstruction',draw());
      // The successful source request advanced the native sequence: recapture the
      // final healthy owner before pairing it with subsequent original requests.
      const after=await original.saveCheckpoint();checkpoint.bytes=after.bytes;checkpoint.sha256=after.sha256;checkpoint.contents=after.contents;row.checkpointAfterRefusal=copy(after);
    }
    q.write(addresses.vertex,new Uint8Array(64).fill(0x7f));q.write(addresses.color,new Uint8Array(64).fill(0xa1));q.write(addresses.depth,new Uint8Array(32).fill(0x13));
    const afterPoison={calls,used:q.usedIndex(),digest:q.vm.machineDigest(),rings:[...q.read(q.used,2056)],vertices:[...q.read(addresses.vertex,64)]};
    c.ok(original.dispose(),'dispose old physical owner');c.equal(observed[0].objects.size,0,'old native allocation owners retired');
    reconstructing=true;observed[1].setPhase('isolated-reconstruction');const restored=await restoreProductionRenderer(checkpoint.bytes,{gl:observed[1].gl,profile:profiles[1],shaderBridge:compiler,transport,presenter:presenter()});
    c.equal(frames.filter(f=>f.pixels).length,row.originalPresentationCount,'historical replay frame is not published to live presenter');
    current=restored.bridge;c.bad(current.apply({}),'staged owner cannot accept live requests','bridge-poisoned');
    if(abort) {
      const promise=current.activate();row.disposeDuringActivation=copy(current.dispose());
      try{row.activationOutcome={resolved:copy(await promise)};}catch(e){row.activationOutcome={rejected:{message:e.message,stack:e.stack}};}
      await turn();row.secondDispose=copy(current.dispose());row.afterAbortedActivation={objects:observed[1].objects.size,syncs:observed[1].syncs.size};
      c.truth(Boolean(row.activationOutcome.rejected),'disposing during pending physical scanout repair must abort activation');
      c.same(row.afterAbortedActivation,{objects:0,syncs:0},'disposing pending activation retires all staged owners');row.status='passed';return row;
    }
    c.ok(await current.activate(),'promote fresh GPU scanout repair');await turn();
    const published=frames.filter(f=>f.pixels);c.equal(published.length,row.originalPresentationCount+1,'only NEW fresh physical repair frame published');c.same(published.at(-1).pixels,Array(16).fill(0xffff00ff),'literal actual fresh scanout pixels');
    c.same({calls,used:q.usedIndex(),digest:q.vm.machineDigest(),rings:[...q.read(q.used,2056)],vertices:[...q.read(addresses.vertex,64)]},afterPoison,'fresh reconstruction/scanout repair has no live-native effects');
    reconstructing=false;observed[1].setPhase('restored-original');row.restored=copy({...restored,bridge:undefined});
    c.same([...await originalRead('fresh reconstructed original color transfer')],[...literalColor(false)],'all sixteen fresh physical pixels, immutable uploaded vertices');
    await send('new asymmetric GPU output',join(packet(7,0,[4,word(0),word(0),word(1),word(1),0,0,0]),packet(4,0,[0,...[1,2,.5,1,2,.5].map(word)]),draw()));
    c.same([...await originalRead('new asymmetric original transfer')],[...literalColor(true)],'all NEW asymmetric pixels');
    row.secondCheckpoint=copy(await current.saveCheckpoint());c.truth(row.secondCheckpoint.sha256!==checkpoint.sha256,'continued owner captures NEW GPU state');
    c.equal(native[0].getError(),native[0].NO_ERROR,'old physical context no error');c.equal(native[1].getError(),native[1].NO_ERROR,'fresh physical context no error');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{row.native=observed.map(o=>o.events);row.frames=frames;row.records=copy(q.records);row.exchanges=copy(exchanges);row.beforeDispose=copy(current.inspect());row.guestTrace=q.vm.commandTrace();row.machineDigest=q.vm.machineDigest();row.disposed=copy(current.dispose());if(current!==original)original.dispose();q.vm.free();row.ownersAfter=observed.map(o=>({objects:o.objects.size,syncs:o.syncs.size}));row.assertions=c.assertions;if(row.ownersAfter.some(o=>o.objects||o.syncs)){row.status='failed';row.cleanupFailure='Native owner leak';}}
  return row;
}
async function oneEpoch(Wasm,compiler) {
  const c=checker(),canvas=document.createElement('canvas');canvas.width=canvas.height=4;
  const native=canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),profile=await qualifyVirglHost(native),tracked=observer(native,'epoch');
  let q;const transport=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name=>[name,(...args)=>q.vm[name](...args)]));
  const bridge=c.ok(createJournalledProductionBridge({gl:tracked.gl,profile,shaderBridge:compiler,transport,presenter:createWorkerScanoutPresenter(()=>{})}),'epoch journal owner').bridge;
  const Selected=class{constructor(callback){return Wasm.qualified(callback,profile.hostWords,profile.formatRoles,profile.renderer);}};
  q=new Queue(Selected,event=>bridge.apply(event),c);const row={name:'stale-expected-epoch-with-no-display',prediction:'After original context establishes epoch1 and valid1->2 rebase, stale expected1->3 must refuse and preserve epoch2 plus all frames/highwaters. There is no display binding to mask this guard.'};
  try {
    const entry=q.enqueue('original context establishes epoch1',context(79));q.kick();q.run();q.collect(entry);
    c.equal(bridge.inspect().epoch,'0000000000000001','original epoch1');c.equal(bridge.inspect().scanout.binding,null,'no retained display binding');
    c.ok(bridge.rebaseCheckpointEpoch('0000000000000001','0000000000000002'),'valid fresh epoch2');const before=copy(bridge.inspect());
    row.before=before;row.stale=copy(bridge.rebaseCheckpointEpoch('0000000000000001','0000000000000003'));
    c.bad(row.stale,'stale expected epoch refuses','invalid-parameter');c.same(copy(bridge.inspect()),before,'stale epoch has no state/journal effects');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{row.after=copy(bridge.inspect());row.records=copy(q.records);row.native=tracked.events;row.digest=q.vm.machineDigest();row.trace=q.vm.commandTrace();row.disposed=copy(bridge.dispose());q.vm.free();row.ownersAfter={objects:tracked.objects.size,syncs:tracked.syncs.size};row.assertions=c.assertions;if(row.ownersAfter.objects||row.ownersAfter.syncs){row.status='failed';row.cleanupFailure='Native owners leaked';}}
  return row;
}
export async function runProductionRendererCheckpointCritic({WasmVirglSubmitProof,mode='all'}){
  const primary=['contents','corrupt','epoch','abort','loss','save-race'],guards=['pending','active','prefix','incomplete'];
  const selectedModes=mode==='all'?primary:mode==='guards'?guards:[mode];if(!selectedModes.every(value=>primary.includes(value)||guards.includes(value)))throw Error('Unknown independent checkpoint mode');
  const compiler=await createVirglStandardStreamOutputShaderBridge(),report={status:'running',rows:[]};window.__productionCriticReport=report;
  for(const selected of selectedModes){
    const row=selected==='epoch'?await oneEpoch(WasmVirglSubmitProof,compiler):await one(WasmVirglSubmitProof,compiler,selected,selected==='incomplete'?'incomplete':selected==='corrupt',selected==='abort',selected==='loss'?'loss':selected==='save-race'?'mutation':null,['pending','active','prefix'].includes(selected)?selected:null);
    const pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});
  }
  report.status=report.rows.every(r=>r.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(r=>r.status!=='passed')};return report;
}
