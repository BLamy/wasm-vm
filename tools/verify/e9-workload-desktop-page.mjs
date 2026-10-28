// The pinned cold Omarchy guest, not a warm checkpoint or a bare-MMIO fixture.
import init,{WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {SessionSha256} from '/session-pkg/wasm_vm_session.js';
import {SessionStore} from '/session-store.js';
import {SessionGpuJournal} from '/session-gpu-journal.js';
import {SessionGpuHistoryReader} from '/session-gpu-history-reader.js';
import {openGpuTimelineReplay} from '/session-gpu-replay.js';
import {gpuEventParts} from '/session-gpu-replay-format.js';
import {readCheckpointObject,checkpointHash,checkpointReference,checkpointChunks} from '/session-checkpoints.js';
import {attachProductionVirgl,createWorkerScanoutPresenter} from '/renderer/virgl-command/production.mjs';
import {decodeCheckpointData,encodeCheckpointData} from '/renderer/virgl-command/checkpoint-codec.mjs';
import {PresentationController} from '/src/sink/presentation.js';
import {hasDesktopPixels} from '/omarchy-desktop-readiness.js';
import {createLinuxTerminal} from '/terminal.js';
import {createFencedRpc,formatRpcCommand,stripConsole} from '/guest-rpc.js';
import {frozenWorkloadSchedule,scheduledTransition,verifyFrozenWorkloadOffers,verifyUartActivityLedger,verifyFullUartOffer,verifyGuestInputMarkers} from '/e9-workload-schedule.mjs';
import {desktopWallOpen,QUALIFIED_DESKTOP_WALL_MS} from '/e9-workload-wall.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder(),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const need=(ok,detail)=>{if(!ok)throw Error('full desktop qualification: '+detail);};
const pos=p=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,p[key]]));
const hex=bytes=>[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=bytes=>checkpointHash(bytes);
const shape=bytes=>({bytes:bytes.length,sha256:digest(bytes)});
const sameData=(a,b)=>{const x=encodeCheckpointData(a),y=encodeCheckpointData(b);return x.length===y.length&&x.every((value,i)=>value===y[i]);};
const sameRebasedRendererLogical=(source,actual)=>sameData({
  ...actual,epoch:source.epoch,
  scanout:source.scanout&&actual.scanout
    ?{...actual.scanout,epoch:source.scanout.epoch}:actual.scanout,
},source);
const sameRendererFramesAfterRebase=(source,actual,savedEpoch,freshEpoch)=>{
  if(actual.length!==source.length+1)return false;
  for(let index=0;index<actual.length;index++){
    const frame=decodeCheckpointData(actual[index]);
    if(frame.op==='rebase'&&frame.expected===savedEpoch&&frame.next===freshEpoch
      &&sameData([...actual.slice(0,index),...actual.slice(index+1)],source))return true;
  }
  return false;
};
const logicalLatches=bytes=>{const marker=encoder.encode('WVGPULG2');let at=-1;
  for(let i=0;i+marker.length+3<=bytes.length;i++)if(marker.every((value,j)=>bytes[i+j]===value)){at=i;break;}
  need(at>=0&&[bytes[at+9],bytes[at+10]].every(value=>value===0||value===1),
    'logical GPU QueueNotify latch witness missing');
  return [bytes[at+9],bytes[at+10]];};
const independentGpuWitness=(raw,ramDigest)=>{
  const ram=typeof ramDigest==='string'
    ?Uint8Array.from(ramDigest.match(/../g)??[],part=>parseInt(part,16)):ramDigest;
  need(ram?.length===32,'independent GPU witness RAM digest');
  const size=new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0,BigInt(raw.length),true);
  const hash=new SessionSha256();
  try{
    hash.update(encoder.encode('wasm-vm-gpu-guest-state-v1\0'));
    hash.update(size);hash.update(raw);hash.update(ram);
    return hash.finish();
  }finally{hash.free();}
};
const capturedLogicalWitness=(frame,raw,ramDigest=frame.ramDigest)=>{
  const independentDigest=independentGpuWitness(raw,ramDigest);
  need(independentDigest===hex(frame.digest),'live logical GPU witness differs from keyframe');
  return {logicalLatches:logicalLatches(raw),independentDigest};
};
const software=/software|SwiftShader|llvmpipe|softpipe|lavapipe/i;
const guestLibraryPins={
  'libEGL.so.1':'686d69940e99357eabbea48b5cccea1ae513c43773e033d48debfd83cddac897',
  'libGLESv2.so.2':'9d57a842bdb448f7896bbaab81c3e438f123ff65eb2f222cf3ebab1a5dbed204'};

class PrefixBoundary extends Error {
  constructor(reason){super(reason);this.name='PrefixBoundary';this.reason=reason;}
}

export async function qualifyDesktopWorkload(contract,qualification,options={}){
  const prefix=options.prefix??null;
  const correctedObserver=prefix?.task==='E9-T22u'
    ?await import('/e9-corrected-cold-observation.mjs'):null;
  if(prefix)need(['E9-T22r','E9-T22u'].includes(prefix.task)&&Number.isSafeInteger(prefix.wallMs)&&prefix.wallMs>0
    &&typeof prefix.transitionCap==='string'&&/^[1-9][0-9]*$/.test(prefix.transitionCap)
    &&BigInt(prefix.transitionCap)%50000000n===0n
    &&Number.isSafeInteger(prefix.payloadStopBytes)&&prefix.payloadStopBytes>1024**3,
    'finite cold-prefix policy');
  await init();
  const fixture=contract.fixtures.find(row=>row.id==='desktop-gpu-candidate-v1');
  need(fixture&&contract.workload?.desktop?.probe_sha256==='822b258f329ee2d16d7f25fa676684e02227531dbdf8bf5edbf7dc8b45868155','frozen desktop contract');
  const auxiliary=qualification?.auxiliaryDesktopTool;
  need(qualification?.version===11&&qualification.desktopHostWallMs===QUALIFIED_DESKTOP_WALL_MS
    &&qualification.browserContext?.mode==='fresh-persistent-user-data-dir'
    &&qualification.retention?.defaultMaxBytes===2*1024**3
    &&qualification.retention?.maxBytes===16*1024**3&&qualification.retention?.maxCheckpoints===4096
    &&qualification.capacityPreflight?.reserveBytes===1024**3
    &&qualification.capacityPreflight?.fullColdRunCopies===2
    &&qualification.desktopBootstrap?.bootargs==='root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0 init=/bin/bash -- -i'
    &&qualification.desktopBootstrap?.gettyPath==='/etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf'
    &&qualification.desktopBootstrap?.gettyOverride==='[Service]\nExecStart=\nExecStart=-/usr/bin/agetty --autologin root --noclear --keep-baud 115200,38400,9600 - $TERM\n'
    &&qualification.desktopBootstrap?.gettyMode==='0644'
    &&qualification.desktopSerialShell?.gettyOverride==='[Service]\nExecStart=\nExecStart=-/bin/bash --noprofile --norc -i\nWorkingDirectory=/root\nEnvironment=HOME=/root USER=root LOGNAME=root SHELL=/bin/bash PATH=/usr/local/sbin:/usr/local/bin:/usr/bin TERM=vt100\n'
    &&qualification.desktopSerialShell?.gettyOverrideBytes===205
    &&qualification.desktopSerialShell?.gettyOverrideSha256===digest(encoder.encode(qualification.desktopSerialShell.gettyOverride))
    &&qualification.desktopSerialShell?.mode==='0644'
    &&qualification.desktopNetworkReadiness?.dropinPath==='/etc/systemd/system/NetworkManager.service.d/e9-qualification.conf'
    &&qualification.desktopNetworkReadiness?.dropin==='[Service]\nType=simple\n'
    &&qualification.desktopNetworkReadiness?.mode==='0644'
    &&JSON.stringify(qualification.desktopPlymouthOrdering?.units)===JSON.stringify([
      {sourcePath:'/usr/lib/systemd/system/serial-getty@.service',sourceSha256:'ee46ca7068724107df49ee3bdda25a9cf01ceced1e08cca36ab3085bcf6f167d',copyPath:'/etc/systemd/system/serial-getty@ttyS0.service',removeAfterToken:' plymouth-quit-wait.service',copySha256:'151ae951a44e98cacbfa47470b48978608b18d9fa252d0cbd34afc11d03cc5db',copyBytes:1475,mode:'0644'},
      {sourcePath:'/usr/lib/systemd/system/getty@.service',sourceSha256:'1ad6c472588f703549caa35f3fd51076e30c49492497aecb8f8a8b19026965d1',copyPath:'/etc/systemd/system/getty@tty1.service',removeAfterToken:' plymouth-quit-wait.service',copySha256:'d55625aece69be919b841126af75cd315a926f3a668f7aa62cfdfe7da614a8f4',copyBytes:1934,mode:'0644'},
      {sourcePath:'/usr/lib/systemd/system/sddm.service',sourceSha256:'23e5a90063dcba8791c78afd8ddfd1b4d3cc7526185d619e97d497d46a91d385',copyPath:'/etc/systemd/system/sddm.service',removeAfterToken:' plymouth-quit.service',copySha256:'a32de2991d6c1344dd5269cf6602685659441d3d5e085b3d0355bc360f4cdfde',copyBytes:359,mode:'0644'}])
    &&auxiliary?.sourceSha256==='9958179c84ee901615fef183214b90ec2306b5579d0640f520790105f4d79f30'
    &&auxiliary?.transportSha256==='dac2c1dd4ebc37266d5152eae3160f662f587f7e9deb91a35aa6f3d7c75f4679'
    &&auxiliary?.guestPath==='/usr/local/bin/busybox','explicit original desktop tool profile');
  const plan=frozenWorkloadSchedule(contract);
  const [kernel,imageManifest,wasm,stamp,probe,busyboxTransport]=await Promise.all([
    fetch('/kernel.bin').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),
    fetch('/image.json').then(r=>r.text()),
    fetch('/pkg/wasm_vm_wasm_bg.wasm').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),
    fetch('/gpu-checkpoint-build.js').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),
    fetch('/probe.elf').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)),
    fetch('/busybox.gz').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b))]);
  need(digest(kernel)===fixture.artifacts.kernel.sha256,'original Omarchy kernel');
  need(digest(encoder.encode(imageManifest))===fixture.chunked_image.sha256,'original 12 GiB manifest');
  need(probe[0]===127&&probe[1]===69&&probe[2]===76&&probe[3]===70,'RV64 probe ELF');
  need(busyboxTransport.length===auxiliary.transportBytes&&digest(busyboxTransport)===auxiliary.transportSha256
    &&auxiliary.transportPaddedBytes%4096===0&&auxiliary.transportPaddedBytes>=busyboxTransport.length,'pinned static RV64 tool transport');
  const state={task:prefix?.task??'E9-T22c',scope:prefix?'Original cold Omarchy first-frame prefix or bounded frontier; no timing claim':'Original cold full Omarchy, hardware GPU probe and whole replay; no timing claim',
    status:'running',phase:'boot',database:'wasm-vm-sessions-v1-'+(prefix?'t22r-prefix':'t22c-desktop')+'-'+crypto.randomUUID(),console:'',
    receipts:0,channels:{},blocks:[],checkpoints:[],capacityChecks:[],ledger:[],payloads:[],viewports:[],bodyResults:[],
    probeInput:shape(probe),toolInput:shape(busyboxTransport),assetInputs:{kernel:shape(kernel),manifest:shape(encoder.encode(imageManifest)),wasm:shape(wasm),renderer:shape(stamp)}};
  if(prefix)state.prefixPolicy=prefix;
  globalThis.desktopWorkload=state;
  const canvas=document.querySelector('canvas'),presentation=new PresentationController(canvas,{scheduleFrames:false});
  let presenter;presenter=createWorkerScanoutPresenter(frame=>{
    if(frame.type==='clear'){presentation.clear();return;}
    if(frame.type==='invalidate'){presentation.invalidate();return;}
    const before=presentation.snapshot().drawnPresents,accepted=presentation.present(frame);
    queueMicrotask(()=>presenter.acknowledge(frame.presentationToken,accepted&&presentation.snapshot().drawnPresents>before?'drawn':'failed'));
  });
  const terminal=createLinuxTerminal(document.querySelector('#terminal'));
  terminal.term.resize(80,24);
  const terminalPending=[];terminal.attachSink(bytes=>terminalPending.push(bytes.slice()));
  let parser,rpcResult,vm,gpu,store,writer,journal,stagedBytes=0,nextCapture=50000000n;
  let lastProgress=0,opened=false,terminalDisposed=false,rawToolTransfer=false,phase='boot',rows=[],uartRows=[],sourceRows=[],offers=[],savedPayloads=new Set();
  const begun=performance.now();
  const bootargs=qualification.desktopBootstrap.bootargs;
  const textView=()=>stripConsole(state.console.slice(-131072));
  const retain=async(name,bytes)=>{const response=await fetch('/__retain__/'+name,{method:'POST',body:bytes});need(response.ok,'raw retention '+name);return response.json();};
  const progress=async()=>{
    if(performance.now()-lastProgress<10000)return;
    lastProgress=performance.now();const p={phase,position:pos(vm.inputPosition()),receipts:state.receipts,
      blocks:state.blocks.length,checkpoints:state.checkpoints.length,scheduled:state.scheduledOffers??0,
      bodies:state.bodyResults.length,tail:textView().slice(-600)};
    document.querySelector('pre').textContent=JSON.stringify(p,null,2);
    const control=await globalThis.workloadProgress(p);
    if(control?.continue===false&&prefix)throw new PrefixBoundary('operator-stop');
    need(control?.continue!==false,'operator stopped development run');
    if(prefix&&(await store.statistics()).payloadBytes>=prefix.payloadStopBytes)
      throw new PrefixBoundary('payload-cap');
  };
  // Every durable write is admitted before it starts. The unchanged failed
  // prefix's largest machine+GPU checkpoint was <197 MiB; 512 MiB also bounds
  // the original image-chunk, event and witness write operations below.
  const guardedWrite=async(stage,write)=>{
    const before=(await store.statistics()).payloadBytes;
    const estimate=await navigator.storage.estimate();
    const receipt=await globalThis.workloadCapacity({stage,phase,position:pos(vm.inputPosition()),
      payloadBytes:before,plannedBytes:512*1024**2,quota:estimate.quota,usage:estimate.usage});
    need(receipt?.browserAvailable>=receipt?.browserRequired&&receipt?.hostFreeBytes>=receipt?.hostRequired,
      'pre-write browser and host capacity');
    const result=await write();
    const after=(await store.statistics()).payloadBytes;
    need(after<=before+512*1024**2,'single original-workload durable write exceeds admitted 512 MiB phase');
    state.capacityChecks.push({stage,beforePayloadBytes:before,afterPayloadBytes:after,...receipt});
    return result;
  };
  const flushJournal=()=>journal.pending?guardedWrite('journal-flush',()=>journal.flush()):journal.flush();
  const collect=async()=>{
    const batch=vm.takeExactGpuBatch();need(batch.events.length||!batch.payloads.length,'orphan GPU body');
    if(!batch.events.length)return;
    for(const row of batch.events){const parts=gpuEventParts(row);
      rows.push({...pos(row),channel:row.channel,ticket:row.ticket,outcome:row.outcome,bytesLength:row.bytes.length,sha256:digest(row.bytes),kind:parts.kind,body:parts.body??null});
      if(row.channel===1)uartRows.push(row);if(row.channel===17||row.channel===18)sourceRows.push(row);
      state.receipts++;state.channels[row.channel]=(state.channels[row.channel]??0)+1;
      if(row.channel===1){const producer=offers.shift();need(producer&&row.transition===producer.transition&&digest(row.bytes)===producer.sha256,'unclassified actual UART offer');
        if(producer.kind==='tool-transfer')verifyFullUartOffer(row.outcome,row.bytes.length);
        state.ledger.push({...pos(row),channel:1,kind:producer.kind,bytes:row.bytes.length,sha256:producer.sha256});}}
    for(const body of batch.payloads){const id=hex(body.sha256);if(!savedPayloads.has(id)){
      state.payloads.push({sha256:id,length:body.length,artifact:await retain('body-'+id+'.bin',body.bytes)});savedPayloads.add(id);}}
    const size=batch.events.reduce((sum,row)=>sum+row.bytes.length,0);
    if(journal.pending+batch.events.length>256||stagedBytes+size>4*1048576){await flushJournal();stagedBytes=0;}
    journal.stage(batch);stagedBytes+=size;
    if(journal.pending>=128||stagedBytes>=2*1048576){await flushJournal();stagedBytes=0;}
  };
  const offer=async(kind,bytes)=>{const owned=typeof bytes==='string'?encoder.encode(bytes):bytes.slice();
    offers.push({kind,transition:vm.inputPosition().transition,sha256:digest(owned)});
    vm.sendInput(owned);await collect();};
  const drainTerminal=async()=>{if(rawToolTransfer)return;for(const bytes of terminalPending.splice(0))await offer('terminal-reply',bytes);};
  const drainBlocks=async()=>{
    for(let round=0;round<1024;round++){
      const requests=vm.exactDeviceRequests();if(!requests.length)return;
      for(const request of requests){
        need(request.intent.kind==='block','unexpected live device '+request.intent.kind);
        const {sha256,length}=request.intent.content,response=await fetch('/__chunk__/'+sha256+'.bin');
        need(response.ok,'original base chunk');const bytes=new Uint8Array(await response.arrayBuffer());
        need(bytes.length===Number(length)&&digest(bytes)===sha256,'base chunk identity');
        await guardedWrite('base-chunk',()=>writer.put(checkpointReference(bytes),checkpointChunks(bytes)));
        const lease=vm.exactLeaseDeviceRequest(request.id);
        try{vm.exactCompleteDeviceRequest(lease,0,0,bytes);}finally{lease.free();}
        state.blocks.push({sha256,bytes:bytes.length,position:pos(vm.inputPosition())});await collect();
      }
    }
    throw Error('original base chunk completion bound');
  };
  const pumpGpu=async()=>{for(let n=0;gpu.inspect().pending&&n<5000;n++){
    const result=gpu.pump();need(result===null||result.ok,'physical GPU pump '+JSON.stringify(result));await collect();await tick();}
    need(!gpu.inspect().pending,'physical GPU job stranded');need(!gpu.inspect().lost,'physical context lost');};
  const pumpHttp=async()=>{
    if(!opened){if(!vm.exactNetworkRequests().length)return;
      vm.openOwnedLocalHttp();opened=true;state.providerOpenedAt=pos(vm.inputPosition());await collect();}
    for(let n=0;n<1024;n++){const result=vm.pumpOwnedLocalHttp();await collect();if(!result.more||result.blocked)return;}
    throw Error('owned HTTP pump work bound');
  };
  const witness=async(label,raw=false)=>{await drainBlocks();await collect();await flushJournal();stagedBytes=0;
    const value=vm.exactGpuSessionWitness();await guardedWrite('witness',()=>journal.observeExactWitness(value));
    const result={...pos(value),digest:hex(value.digest),ramDigest:vm.softwareRamDigest()};
    if(raw)result.state=await retain(label+'.state',vm.exactGpuSessionState());return result;};
  const observeCorrectedBlocks=async()=>{
    if(prefix?.task!=='E9-T22u')return;
    const observation=state.correctedBlockObservation,rows=JSON.parse(vm.drainExactBlockLog());
    if(rows.length){
      const bytes=encoder.encode(JSON.stringify(rows));
      need(observation.logBytes+bytes.length<=correctedObserver.CORRECTED_COLD_LOG_MAX_BYTES,'bounded diagnostic block log');
      const through=pos(vm.inputPosition());
      const artifact=await retain('block-log-'+observation.parts.length+'.json',bytes);
      const matches=correctedObserver.recordCorrectedColdBatch(observation,rows,through,artifact);
      if(matches.length)observation.witness=await witness('corrected-block',true);
    }
    observation.firstFailure=vm.exactFirstBlockFailure()??null;
    need(observation.firstFailure===null,'fresh cold guest observed a block I/O error');
  };
  const noteBodies=async()=>{
    const text=textView();
    for(let index=state.bodyResults.length+1;index<=10;index++){
      const expected=new Uint8Array(1024).fill(17+index),hash=digest(expected);
      if(!text.includes(hash+'  /root/e9-session/http'))break;
      state.bodyResults.push({index,bytes:1024,sha256:hash,position:pos(vm.inputPosition())});
    }
  };
  const step=async(target=null)=>{
    if(prefix){if(!desktopWallOpen(performance.now(),begun,prefix.wallMs))throw new PrefixBoundary('host-wall-cap');}
    else need(desktopWallOpen(performance.now(),begun,qualification.desktopHostWallMs),'desktop qualification wall bound');
    await drainTerminal();await drainBlocks();
    await pumpHttp();await pumpGpu();
    const at=BigInt(vm.inputPosition().transition);
    if(prefix){if(at>=BigInt(prefix.transitionCap))throw new PrefixBoundary('transition-cap');}
    else need(at<20000000000n,'original cold transition bound');
    const scheduled=target!==null&&BigInt(target)<nextCapture?BigInt(target):nextCapture;
    const limit=prefix&&BigInt(prefix.transitionCap)<scheduled?BigInt(prefix.transitionCap):scheduled;
    need(at<=limit,'cooperative target overrun');
    if(at<limit){const distance=limit-at,budget=Number(distance<1048576n?distance:1048576n);
      const result=vm.runChunk(budget);need(!result.done,'Omarchy guest stopped '+JSON.stringify(result));
      await collect();await pumpHttp();await pumpGpu();await drainBlocks();}
    const now=BigInt(vm.inputPosition().transition);need(now<=limit,'exact transition budget overrun');
    await noteBodies();await observeCorrectedBlocks();
    if(now===nextCapture){await drainBlocks();need(gpu.checkpointReady().ok,'50M keyframe boundary unavailable');
      await flushJournal();stagedBytes=0;
      const frame=await guardedWrite('keyframe',()=>journal.captureKeyframe(vm,gpu,'cold-'+state.checkpoints.length));
      const raw=prefix?vm.exactGpuSessionState():null;
      state.checkpoints.push({...pos(frame),digest:hex(frame.digest),ramDigest:hex(frame.ramDigest),full:frame.full,
        ...(raw?capturedLogicalWitness(frame,raw):{})});
      nextCapture=now+50000000n;}
    await progress();await tick();
  };
  const until=async predicate=>{while(!predicate())await step();};
  const command=async(text,id,kind)=>{parser=createFencedRpc(id);rpcResult=null;
    await offer(kind,formatRpcCommand(text,id));await until(()=>!!rpcResult);
    need(rpcResult.exit===0,'guest command '+id+': '+JSON.stringify(rpcResult));return rpcResult;};
  const networkStatus=async id=>{
    const result=await command(`e9_nm_pid=$(systemctl show NetworkManager -p MainPID --value) && `+
      `test "$(systemctl is-active NetworkManager)" = active && test "$e9_nm_pid" -gt 1 && `+
      `kill -0 "$e9_nm_pid" && `+
      `test "$(busctl --system call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s org.freedesktop.NetworkManager)" = 'b true' && `+
      `printf 'E9_NM_PID=%s\\n' "$e9_nm_pid"`,id,'guest-inspection');
    const match=result.stdout.trim().match(/^E9_NM_PID=([1-9][0-9]*)$/);
    need(match,'original NetworkManager active with live PID and D-Bus owner');
    return {...result,pid:Number(match[1])};
  };
  const stageBusybox=async()=>{
    const padded=new Uint8Array(auxiliary.transportPaddedBytes);padded.set(busyboxTransport);
    const source=auxiliary.sourceSha256,guest=auxiliary.guestPath,count=padded.length/4096;
    state.ttyBefore=await command('stty -g','ctooltty','tool-transfer');
    await drainTerminal();
    parser=createFencedRpc('cbusybox');rpcResult=null;
    const script=`e9_tty=$(stty -g); stty raw -echo; printf 'E9_TOOL_READY\\n'; `+
      `dd if=/dev/tty of=/tmp/e9-busybox.gz bs=4096 count=${count} iflag=fullblock status=none; `+
      `e9_dd=$?; stty "$e9_tty"; test "$e9_dd" -eq 0 && `+
      `truncate -s ${busyboxTransport.length} /tmp/e9-busybox.gz && `+
      `gzip -dc /tmp/e9-busybox.gz > ${guest} && chmod 755 ${guest} && `+
      `e9_hash=$(sha256sum ${guest}) && test "$e9_hash" = '${source}  ${guest}' && `+
      `printf 'E9_BUSYBOX_SHA=%s\\n' "$e9_hash" && ${guest} --list | grep -qx wget && `+
      `export PATH=/usr/local/bin:$PATH && test "$(command -v busybox)" = '${guest}'`;
    await offer('tool-transfer',formatRpcCommand(script,'cbusybox'));
    await until(()=>/E9_TOOL_READY\r?\n/.test(textView()));
    const start=pos(vm.inputPosition());rawToolTransfer=true;
    try{for(let at=0;at<padded.length;at+=2048){
      need(!rpcResult,'binary tool transfer completed before all pinned bytes');
      await offer('tool-transfer',padded.subarray(at,at+2048));
      let drained=false;
      for(let slices=0;slices<64;slices++){
        await step();
        if(vm.exactSessionHostQueues().pending.length===0){drained=true;break;}
      }
      need(drained,'binary UART offer did not drain before the next offer');
    }
      await until(()=>!!rpcResult);}finally{rawToolTransfer=false;}
    need(rpcResult?.exit===0&&rpcResult.stdout.includes('E9_BUSYBOX_SHA='+source+'  '+guest),'original static BusyBox executed in Omarchy');
    state.toolTransfer={source:{bytes:auxiliary.sourceBytes,sha256:source},transport:shape(busyboxTransport),
      paddedBytes:padded.length,rawOffers:padded.length/2048,guestPath:guest,start,end:pos(vm.inputPosition()),
      guestReceipt:rpcResult.stdout};
    await drainTerminal();
  };
  let originalState,originalQueues,sourceRenderer,sessionId;
  const completePrefix=async reason=>{
    need(prefix&&vm&&gpu&&store&&writer&&journal,'original cold prefix reached a recordable boundary');
    phase='finalize';await drainBlocks();await pumpHttp();await collect();await pumpGpu();await flushJournal();stagedBytes=0;
    await observeCorrectedBlocks();
    if(prefix?.task==='E9-T22u')state.firstBlockFailureAtEnd=vm.exactFirstBlockFailure()??null;
    const current=pos(vm.inputPosition());
    if(current.transition!==pos(state.checkpoints.at(-1)??state.initial).transition){
      need(gpu.checkpointReady().ok,'prefix terminal keyframe unavailable');
      const frame=await guardedWrite('final-keyframe',()=>journal.captureKeyframe(vm,gpu,'cold-prefix-final'));
      const raw=vm.exactGpuSessionState();
      state.checkpoints.push({...pos(frame),digest:hex(frame.digest),ramDigest:hex(frame.ramDigest),full:frame.full,
        ...capturedLogicalWitness(frame,raw)});
    }
    const end=vm.exactGpuSessionWitness();
    await guardedWrite('final-witness',()=>journal.completeExactPaged(end));
    const finalRaw=vm.exactGpuSessionState(),finalRam=vm.softwareRamDigest();
    need(independentGpuWitness(finalRaw,finalRam)===hex(end.digest),'live final logical GPU witness');
    state.final={...pos(end),digest:hex(end.digest),ramDigest:finalRam,
      state:await retain('final.state',finalRaw)};
    if(prefix?.task==='E9-T22u')state.correctedBlockObservation.through=pos(end);
    const terminalPixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    state.frontier={reason,position:pos(end),consoleTail:textView().slice(-2048),gpu:gpu.inspect(),
      presentation:presentation.snapshot(),pixels:shape(terminalPixels),hasDesktopPixels:hasDesktopPixels(terminalPixels)};
    originalState=vm.exactGpuSessionState();originalQueues=vm.exactSessionHostQueues();
    state.hostQueues=Object.fromEntries(Object.entries(originalQueues).map(([key,bytes])=>[key,shape(bytes)]));
    state.sessionId=writer.id;await writer.release();writer=null;
    const saved=await store.openSession(state.sessionId),manifest=JSON.parse(decoder.decode(saved.manifest));
    sourceRenderer=await readCheckpointObject(store,manifest.checkpoints.at(-1).gpu,256*1048576);
    state.sourceRenderer=shape(sourceRenderer);
    state.authenticatedHistory=await SessionGpuHistoryReader.withOpen(store,state.sessionId,{},async reader=>{
      const metadata=reader.metadata;need(metadata.storageAuthenticated&&metadata.receipts===rows.length,
        'authenticated cold-prefix receipts');
      need(metadata.checkpoints.length===state.checkpoints.length+1,'authenticated cold-prefix keyframes');
      return {receipts:metadata.receipts,witnesses:metadata.witnesses,windows:metadata.receiptWindows,
        receiptDigest:metadata.receiptDigest,manifestSha256:metadata.session.manifestSha256};
    });
    need(manifest.checkpoints.length>=3,'two adjacent prefix replay windows');
    const points=manifest.checkpoints.map(point=>BigInt(point.position.transition));
    need(points[0]===0n&&points.every((point,index)=>index===0||point>points[index-1]
      &&point-points[index-1]<=50000000n),'50M cold-prefix keyframe cadence');
    need(BigInt(manifest.end.transition)===BigInt(state.final.transition)
      &&BigInt(manifest.end.transition)-points.at(-1)<=50000000n,'cold-prefix terminal witness coverage');
    const factoryBefore=WasmLinux.ownedLocalHttpFactoryEntries();
    gpu.dispose();gpu=null;vm.free();vm=null;
    terminal.detachSink();terminal.term.dispose();terminalDisposed=true;
    phase='replay';await globalThis.workloadProgress({phase,position:state.final,receipts:state.receipts,
      blocks:state.blocks.length,checkpoints:state.checkpoints.length,tail:'Cold source freed; replaying final adjacent windows'});
    const nativeFetch=globalThis.fetch,nativeSocket=globalThis.WebSocket;
    state.replayEgress={fetch:0,sockets:0};
    globalThis.fetch=(...args)=>{state.replayEgress.fetch++;throw Error('live page fetch during prefix replay: '+String(args[0]));};
    globalThis.WebSocket=class extends nativeSocket{constructor(...args){state.replayEgress.sockets++;
      throw Error('live socket during prefix replay: '+String(args[0]));}};
    let controller;const windowStates=[];
    try{
      const opened=await openGpuTimelineReplay({store,id:state.sessionId,configuration:state.configuration});
      controller=opened.controller;state.replay={windows:[]};
      const last=manifest.checkpoints.slice(-3);let selectedInspection;
      for(let index=0;index<2;index++){
        const from=last[index],to=last[index+1];
        const result=await controller.seekFromCheckpoint(from.id,to.position);
        need(result.status==='ready','cold-prefix adjacent replay did not publish');
        const expected=state.checkpoints.find(row=>JSON.stringify(pos(row))===JSON.stringify(pos(to.position)))
          ??(JSON.stringify(pos(state.initial))===JSON.stringify(pos(to.position))?state.initial:null);
        need(expected&&result.rendered.digest===expected.digest,'cold-prefix adjacent witness mismatch');
        need(result.rendered.replay?.paged===true&&result.rendered.replay.eventCursor===Number(to.position.sequence),
          'cold-prefix adjacent replay consumed exact receipt window');
        selectedInspection=await controller.inspectSelected();
        windowStates.push(selectedInspection.state.slice());
        state.replay.windows.push({from:from.id,to:to.id,position:pos(result.position),
          digest:result.rendered.digest,expected:expected.digest,replay:result.rendered.replay,
          logicalLatches:logicalLatches(selectedInspection.state),state:shape(selectedInspection.state),
          requestId:result.requestId});
      }
      if(JSON.stringify(pos(last[2].position))!==JSON.stringify(pos(manifest.end))){
        const tail=await controller.seekFromCheckpoint(last[2].id,manifest.end);
        need(tail.status==='ready'&&tail.rendered.digest===state.final.digest,
          'cold-prefix terminal events replayed from final checkpoint');
        selectedInspection=await controller.inspectSelected();
        state.replay.terminal={from:last[2].id,position:pos(tail.position),digest:tail.rendered.digest,
          replay:tail.rendered.replay,logicalLatches:logicalLatches(selectedInspection.state)};
      }
      const selected=controller.selected,inspection=selectedInspection;
      need(selected.rendered.digest===state.final.digest,'cold-prefix final witness mismatch');
      need(digest(inspection.state)===digest(originalState),'cold-prefix exact CPU/device/clock state');
      for(const [key,bytes] of Object.entries(originalQueues))
        need(digest(inspection.queues[key])===digest(bytes),'cold-prefix host queue '+key);
      const source=decodeCheckpointData(sourceRenderer.subarray(16,-32));
      const actual=decodeCheckpointData(inspection.renderer.bytes.subarray(16,-32));
      need(sameData(source.profile,actual.profile),'cold-prefix physical renderer profile');
      need(sameRebasedRendererLogical(source.logical,actual.logical),'cold-prefix logical renderer state');
      need(sameRendererFramesAfterRebase(source.frames,actual.frames,
        source.logical.epoch,actual.logical.epoch),'cold-prefix physical renderer frame chain');
      if(state.desktop){const canvas=selected.rendered.canvas;
        const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        need(hasDesktopPixels(pixels)&&digest(pixels)===state.frontier.pixels.sha256,
          'cold-prefix replay reproduces real nonblank desktop pixels');}
      state.replay.final={position:pos(selected.position),digest:selected.rendered.digest,
        state:shape(inspection.state),renderer:shape(inspection.renderer.bytes),
        pending:shape(inspection.queues.pending),output:shape(inspection.queues.output)};
      state.workerProviderAudit=await globalThis.auditReplayWorker();
      need(state.workerProviderAudit.length===1&&state.workerProviderAudit[0].factoryEntries==='0',
        'cold-prefix worker provider stayed closed');
    }finally{controller?.close();globalThis.fetch=nativeFetch;globalThis.WebSocket=nativeSocket;}
    need(state.replayEgress.fetch===0&&state.replayEgress.sockets===0,
      'zero cold-prefix replay egress');
    need(WasmLinux.ownedLocalHttpFactoryEntries()===factoryBefore,'cold-prefix provider stayed closed');
    phase='post-replay';await globalThis.workloadProgress({phase,position:state.final,
      receipts:state.receipts,blocks:state.blocks.length,checkpoints:state.checkpoints.length,
      tail:'Adjacent replay workers closed; retaining independent state bytes'});
    for(let index=0;index<windowStates.length;index++)
      state.replay.windows[index].stateArtifact=await retain('replay-window-'+index+'.state',windowStates[index]);
    state.status=reason==='first-nonblank-desktop-frame'?'cold-prefix-frame':'cold-prefix-frontier';
  };
  try{
    vm=WasmLinux.newExactGpuSession(kernel,imageManifest,bootargs,bytes=>{
      const text=decoder.decode(bytes,{stream:true});state.console+=text;
      need(state.console.length<=4*1048576,'console bound');terminal.write(bytes.slice());
      if(parser){const value=parser.feed(text);if(value)rpcResult=value;}
    },false);
    if(prefix?.task==='E9-T22u'){
      vm.armExactFirstBlockFailure();vm.armExactBlockLog();
      state.correctedBlockObservation=correctedObserver.createCorrectedColdObservation(pos(vm.inputPosition()));
    }
    gpu=await attachProductionVirgl(vm,{presenter});
    state.physical=gpu.inspect();need(state.physical.qualified&&!state.physical.lost&&!software.test(state.physical.profile.identity),'qualified physical renderer');
    const build=await import('/gpu-checkpoint-build.js');
    const config={version:1,runtime:'rv64-linux-gpu-exact-session-v1',exactGpuSession:1,providersComplete:true,ramMib:1024,
      bootargs,clock:{mode:'icount',divider:64,timebase_hz:'10000000',interactive:null},
      kernel:{url:new URL('/kernel.bin',location).href,sha256:digest(kernel),length:String(kernel.length)},
      wasm:{url:new URL('/pkg/wasm_vm_wasm_bg.wasm',location).href,sha256:digest(wasm),length:String(wasm.length)},
      renderer:{url:new URL('/gpu-checkpoint-build.js',location).href,sha256:digest(stamp),length:String(stamp.length),buildId:build.GPU_CHECKPOINT_BUILD_ID},
      profile:gpu.checkpointProfile(),devices:JSON.parse(vm.exactGpuSessionTopology()),imageManifest,
      timeEntropyPolicy:vm.sessionSourcePolicy(),deviceCompletionPolicy:{version:1,block:'immutable-base-cow-v1',agent:'owned-agent-receive-v1',capture:'owned-s16-capture-v1'},
      networkPolicy:{version:1,transport:'owned-ethernet-v1',replay:'zero-egress'}};
    state.configuration=config;
    store=await SessionStore.open(state.database);
    const beforeRetention=await store.statistics();
    need(beforeRetention.limits.maxBytes===qualification.retention.defaultMaxBytes
      &&beforeRetention.limits.maxCheckpoints===qualification.retention.maxCheckpoints
      &&beforeRetention.payloadBytes===0,'fresh production retention default');
    await store.setRetention({maxBytes:qualification.retention.maxBytes,maxCheckpoints:qualification.retention.maxCheckpoints});
    const afterRetention=await store.statistics();
    need(afterRetention.limits.maxBytes===qualification.retention.maxBytes
      &&afterRetention.limits.maxCheckpoints===qualification.retention.maxCheckpoints
      &&afterRetention.payloadBytes===0,'supported production retention setting');
    state.retention={before:beforeRetention.limits,after:afterRetention.limits};
    writer=await store.writer('full-original-omarchy');
    journal=await SessionGpuJournal.create(store,writer,config,vm,gpu,{witnessPages:true});
    state.initialCapacity=(await store.statistics()).payloadBytes;
    need(state.initialCapacity<=512*1024**2,'initial exact GPU keyframe stays within admitted 512 MiB phase');
    const initial=journal.initialWitness,initialRaw=vm.exactGpuSessionState(),initialRam=vm.softwareRamDigest();
    state.initial={...pos(initial),digest:hex(initial.digest),ramDigest:initialRam,
      ...capturedLogicalWitness(initial,initialRaw,initialRam),state:await retain('initial.state',initialRaw)};
    vm.enableJit(2);
    await until(()=>/(?:^|\n)[^\n]*#\s*$/.test(textView()));
    const getty=qualification.desktopBootstrap.gettyPath;
    const gettyHash=digest(encoder.encode(qualification.desktopSerialShell.gettyOverride));
    const network=qualification.desktopNetworkReadiness.dropinPath;
    const networkHash=digest(encoder.encode(qualification.desktopNetworkReadiness.dropin));
    const [gettyUnit,tty1Unit,sddmUnit]=qualification.desktopPlymouthOrdering.units;
    const cloneUnit=(unit,sed)=>`test "$(sha256sum '${unit.sourcePath}')" = '${unit.sourceSha256}  ${unit.sourcePath}' && `+
      `install -Dm0644 '${unit.sourcePath}' '${unit.copyPath}' && `+
      `sed -i '${sed}' '${unit.copyPath}' && `+
      `test "$(wc -c < '${unit.copyPath}')" -eq ${unit.copyBytes} && `+
      `test "$(stat -c '%u:%a' '${unit.copyPath}')" = '0:644' && `+
      `test "$(sha256sum '${unit.copyPath}')" = '${unit.copySha256}  ${unit.copyPath}' && `;
    state.bootstrap=await command(`test "$(id -u)" = 0 && test -x /sbin/init && `+
      `mkdir -p /etc/systemd/system/serial-getty@ttyS0.service.d && `+
      `printf '%s\\n' '[Service]' 'ExecStart=' 'ExecStart=-/bin/bash --noprofile --norc -i' 'WorkingDirectory=/root' 'Environment=HOME=/root USER=root LOGNAME=root SHELL=/bin/bash PATH=/usr/local/sbin:/usr/local/bin:/usr/bin TERM=vt100' > '${getty}' && `+
      `chmod 0644 '${getty}' && test "$(stat -c '%u:%a' '${getty}')" = '0:644' && `+
      `test "$(wc -c < '${getty}')" -eq 205 && `+
      `test "$(sha256sum '${getty}')" = '${gettyHash}  ${getty}' && `+
      `mkdir -p /etc/systemd/system/NetworkManager.service.d && `+
      `printf '%s\\n' '[Service]' 'Type=simple' > '${network}' && `+
      `chmod 0644 '${network}' && test "$(stat -c '%u:%a' '${network}')" = '0:644' && `+
      `test "$(sha256sum '${network}')" = '${networkHash}  ${network}' && `+
      cloneUnit(gettyUnit,'s/ plymouth-quit-wait\\.service//')+
      cloneUnit(tty1Unit,'s/ plymouth-quit-wait\\.service//')+
      cloneUnit(sddmUnit,'s/ plymouth-quit\\.service//')+
      `sync && printf 'E9_QBOOT_OK\\n'`,'cbootstrap','guest-inspection');
    need(state.bootstrap.stdout.includes('E9_QBOOT_OK'),'recorded COW-only root shell, NetworkManager and Plymouth ordering');
    state.bootstrapHandoff=pos(vm.inputPosition());
    const systemdConsoleAt=state.console.length;
    await offer('guest-inspection','exec /sbin/init\r');
    await until(()=>/(?:^|\n)[^\n]*#\s*$/.test(stripConsole(state.console.slice(systemdConsoleAt))));
    state.serialShell=await command(`printf 'E9_ROOT_DIRECT uid=%s home=%s tty=%s shell=%s\\n' "$(id -u)" "$HOME" "$(tty)" "$0"; `+
      `tr '\\0' ' ' </proc/$$/cmdline; printf '\\n'; `+
      `ps -o pid,ppid,comm,args -p "$$,$PPID"`,'cserialshell','guest-inspection');
    need(/^E9_ROOT_DIRECT uid=0 home=\/root tty=\/dev\/ttyS0 shell=.*bash\n\/bin\/bash --noprofile --norc -i *\n/.test(state.serialShell.stdout)
      &&!/(?:^|\n)[^\n]*\blogin\b/.test(state.serialShell.stdout),'direct ttyS0 root Bash without login or PAM ancestry');
    state.identity=await command(`id -u; printf '%s\\n' "$HOME"; sha256sum '${getty}' '${network}' '${gettyUnit.copyPath}' '${tty1Unit.copyPath}' '${sddmUnit.copyPath}'; stat -c '%u:%a' '${getty}' '${network}' '${gettyUnit.copyPath}' '${tty1Unit.copyPath}' '${sddmUnit.copyPath}'; command -v hyprctl; command -v gzip; command -v dd; command -v stty`,'cidentity','guest-inspection');
    need(state.identity.stdout.startsWith(`0\n/root\n${gettyHash}  ${getty}\n${networkHash}  ${network}\n${gettyUnit.copySha256}  ${gettyUnit.copyPath}\n${tty1Unit.copySha256}  ${tty1Unit.copyPath}\n${sddmUnit.copySha256}  ${sddmUnit.copyPath}\n0:644\n0:644\n0:644\n0:644\n0:644\n`),'root shell and five recorded COW service files for unchanged /root fixture');
    state.serviceOrdering=await command(`printf 'E9_GETTY_FRAGMENT=%s\\n' "$(systemctl show -p FragmentPath --value serial-getty@ttyS0.service)"; `+
      `printf 'E9_GETTY_EXEC=%s\\n' "$(systemctl show -p ExecStart --value serial-getty@ttyS0.service)"; `+
      `printf 'E9_TTY1_FRAGMENT=%s\\n' "$(systemctl show -p FragmentPath --value getty@tty1.service)"; `+
      `printf 'E9_SDDM_FRAGMENT=%s\\n' "$(systemctl show -p FragmentPath --value sddm.service)"; `+
      `printf 'E9_GETTY_AFTER=%s\\n' "$(systemctl show -p After --value serial-getty@ttyS0.service)"; `+
      `printf 'E9_TTY1_AFTER=%s\\n' "$(systemctl show -p After --value getty@tty1.service)"; `+
      `printf 'E9_SDDM_AFTER=%s\\n' "$(systemctl show -p After --value sddm.service)"; `+
      `systemctl list-jobs --no-legend; `+
      `systemctl is-active systemd-logind serial-getty@ttyS0.service`,'cordering','guest-inspection');
    const ordering=state.serviceOrdering.stdout;
    const gettyAfter=ordering.match(/(?:^|\n)E9_GETTY_AFTER=([^\n]*)/)?.[1]??'';
    const tty1After=ordering.match(/(?:^|\n)E9_TTY1_AFTER=([^\n]*)/)?.[1]??'';
    const sddmAfter=ordering.match(/(?:^|\n)E9_SDDM_AFTER=([^\n]*)/)?.[1]??'';
    need(ordering.includes(`E9_GETTY_FRAGMENT=${gettyUnit.copyPath}\n`)
      &&ordering.includes('/bin/bash --noprofile --norc -i')
      &&ordering.includes(`E9_TTY1_FRAGMENT=${tty1Unit.copyPath}\n`)
      &&ordering.includes(`E9_SDDM_FRAGMENT=${sddmUnit.copyPath}\n`)
      &&gettyAfter.includes('systemd-user-sessions.service')&&!gettyAfter.includes('plymouth-quit-wait.service')
      &&tty1After.includes('systemd-user-sessions.service')&&!tty1After.includes('plymouth-quit-wait.service')
      &&sddmAfter.includes('systemd-logind.service')&&sddmAfter.includes('getty@tty1.service')&&!sddmAfter.includes('plymouth-quit.service')
      &&/(?:^|\n|\x1b>)active\nactive\n+$/.test(ordering),'real systemd loaded three amended units with logind/serial getty active');
    state.networkServiceBefore=await networkStatus('cnetwork0');
    await command('stty -echo','cstty','guest-inspection');
    phase='desktop';
    if(prefix){
      let inspectAfter=0n;state.desktopCandidates=[];
      for(;;){
        await until(()=>BigInt(vm.inputPosition().transition)>=inspectAfter
          &&presentation.snapshot().drawnPresents>0
          &&hasDesktopPixels(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
        const candidate={position:pos(vm.inputPosition()),presentation:presentation.snapshot(),gpu:gpu.inspect(),
          pixels:shape(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)};
        const proof=await command(`e9_sddm_pid=$(systemctl show sddm.service -p MainPID --value); `+
          `e9_hypr_pid=$(pgrep -xo Hyprland || true); `+
          `printf 'E9_SDDM_PID=%s\\nE9_HYPR_PID=%s\\n' "$e9_sddm_pid" "$e9_hypr_pid"; `+
          `systemctl show sddm.service -p ActiveState -p MainPID; `+
          `if test -n "$e9_hypr_pid" && kill -0 "$e9_hypr_pid" 2>/dev/null; then `+
          `e9_hypr_uid=$(stat -c %u "/proc/$e9_hypr_pid"); `+
          `printf 'E9_HYPR_UID=%s\\n' "$e9_hypr_uid"; `+
          `printf 'E9_HYPR_USER_STATE=%s\\n' "$(loginctl show-user "$e9_hypr_uid" -p State --value 2>/dev/null || true)"; `+
          `printf 'E9_HYPR_CGROUP=%s\\n' "$(tr '\\n' ';' < "/proc/$e9_hypr_pid/cgroup")"; `+
          `fi; `+
          `printf 'E9_SESSION_COUNT=%s\\n' "$(loginctl list-sessions --no-legend --no-pager 2>/dev/null | wc -l)"; `+
          `ps -eo pid,ppid,comm,args | grep -E '[s]ddm|[H]yprland|[X]org|[X]wayland|[w]ayland' || true`,
          'rsession','guest-inspection');
        const transcript=proof.stdout;
        const sddm=transcript.match(/(?:^|\n)E9_SDDM_PID=([1-9][0-9]*)\n/)?.[1];
        const hypr=transcript.match(/(?:^|\n)E9_HYPR_PID=([1-9][0-9]*)\n/)?.[1];
        const uid=transcript.match(/(?:^|\n)E9_HYPR_UID=([0-9]+)\n/)?.[1];
        const userState=transcript.match(/(?:^|\n)E9_HYPR_USER_STATE=(active|online)\n/)?.[1];
        const sessions=Number(transcript.match(/(?:^|\n)E9_SESSION_COUNT=([0-9]+)\n/)?.[1]??0);
        if(sddm&&hypr&&uid&&userState&&sessions>0&&transcript.includes('ActiveState=active\n')){
          const proofPosition=pos(vm.inputPosition());
          await until(()=>presentation.snapshot().drawnPresents>candidate.presentation.drawnPresents
            &&hasDesktopPixels(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
          const stillAlive=await command(`if test -d /proc/${hypr} && kill -0 ${hypr} && `+
            `test "$(systemctl is-active sddm.service)" = active; then `+
            `printf 'E9_DESKTOP_LIVE=1\\n'; else printf 'E9_DESKTOP_LIVE=0\\n'; fi`,
            'rframealive','guest-inspection');
          if(stillAlive.stdout.includes('E9_DESKTOP_LIVE=1\n')){
            state.desktop={position:pos(vm.inputPosition()),presentation:presentation.snapshot(),gpu:gpu.inspect(),
              pixels:shape(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)};
            state.displayService=proof;state.sessionProof=proof;state.frameAlive=stillAlive;
            state.desktopProcess={sddmPid:Number(sddm),hyprlandPid:Number(hypr),uid:Number(uid),
              userState,sessions,proofPosition,framePosition:pos(vm.inputPosition())};
            throw new PrefixBoundary('first-nonblank-desktop-frame');
          }
        }
        if(state.desktopCandidates.length<32)state.desktopCandidates.push({candidate,proof:transcript.slice(-2048)});
        inspectAfter=BigInt(vm.inputPosition().transition)+50000000n;
      }
    }
    await until(()=>presentation.snapshot().drawnPresents>0&&hasDesktopPixels(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
    state.desktop={position:pos(vm.inputPosition()),presentation:presentation.snapshot(),gpu:gpu.inspect(),
      pixels:shape(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)};
    state.displayService=await command(`test "$(systemctl is-active sddm.service)" = active && `+
      `e9_sddm_pid=$(systemctl show sddm.service -p MainPID --value) && `+
      `test "$e9_sddm_pid" -gt 1 && kill -0 "$e9_sddm_pid" && `+
      `printf 'E9_SDDM_PID=%s\\n' "$e9_sddm_pid"; `+
      `printf 'E9_PLYMOUTH_PROCESSES=%s\\n' "$(pgrep -c plymouth || true)"`,'cdisplay','guest-inspection');
    need(/^E9_SDDM_PID=[1-9][0-9]*\nE9_PLYMOUTH_PROCESSES=[0-9]+\n+$/.test(state.displayService.stdout),
      'real SDDM daemon owns the drawn desktop');
    const firstPresents=presentation.snapshot().drawnPresents;
    need(vm.setDisplay(640,480),'first frozen viewport request');await collect();
    for(let n=0;n<64&&!(canvas.width===640&&canvas.height===480&&presentation.snapshot().drawnPresents>firstPresents);n++)await step();
    state.viewports.push({requested:[640,480],canvas:[canvas.width,canvas.height],position:pos(vm.inputPosition())});
    need(state.viewports[0].canvas.join(',')==='640,480'&&presentation.snapshot().drawnPresents>firstPresents,'first viewport adopted');
    const base64=btoa(String.fromCharCode(...probe));
    await command('rm -f /tmp/e9-gpu-probe.b64 /tmp/e9-gpu-probe','cprobe0','probe-transfer');
    for(let at=0,index=0;at<base64.length;at+=1024,index++){
      await command("printf '%s' '"+base64.slice(at,at+1024)+"' >> /tmp/e9-gpu-probe.b64",'cpb'+index,'probe-transfer');}
    await command('base64 -d /tmp/e9-gpu-probe.b64 > /tmp/e9-gpu-probe; chmod 755 /tmp/e9-gpu-probe','cprobe1','probe-transfer');
    state.probeGuest=await command(`set -e; sha256sum /tmp/e9-gpu-probe; ldd /tmp/e9-gpu-probe; for soname in libEGL.so.1 libGLESv2.so.2; do found="$(ldd /tmp/e9-gpu-probe | awk -v name="$soname" '$1 == name {print $3}')"; test -n "$found"; real="$(readlink -f "$found")"; test -f "$real"; printf 'E9_LIB_%s=%s\\n' "$soname" "$real"; sha256sum "$real"; done`,'cprobelibs','probe-inspection');
    need(state.probeGuest.stdout.includes(state.probeInput.sha256+'  /tmp/e9-gpu-probe'),'transferred original RV64 ELF');
    need(!state.probeGuest.stdout.includes('not found'),'resolved guest dynamic libraries');
    state.guestLibraries={};
    for(const [soname,expected]of Object.entries(guestLibraryPins)){
      const match=state.probeGuest.stdout.match(new RegExp('(?:^|\\n)E9_LIB_'+soname.replaceAll('.','\\.')+'=(/[^\\n]+)\\n([a-f0-9]{64})  \\1(?:\\n|$)'));
      need(match&&match[2]===expected,'original guest library identity '+soname);
      state.guestLibraries[soname]={realpath:match[1],sha256:match[2]};
    }
    state.probe=await command('EGL_PLATFORM=surfaceless /tmp/e9-gpu-probe','cprobeexec','probe-invoke');
    const renderer=state.probe.stdout.match(/(?:^|\n)E9_GPU_RENDERER=([^\n]+)/)?.[1],error=state.probe.stdout.match(/(?:^|\n)E9_GPU_ERROR=(\d+)/)?.[1],rgba=state.probe.stdout.match(/(?:^|\n)E9_GPU_RGBA=([a-f0-9]+)/)?.[1];
    need(renderer&&!software.test(renderer)&&error==='0'&&rgba===contract.workload.desktop.expected_rgba_hex,'original RV64 hardware GPU clear/readback');
    state.probeResult={renderer,error:Number(error),rgba};
    const secondPresents=presentation.snapshot().drawnPresents;
    need(vm.setDisplay(803,603),'second frozen viewport request');await collect();
    for(let n=0;n<200&&!(canvas.width===803&&canvas.height===603&&presentation.snapshot().drawnPresents>secondPresents);n++)await step();
    state.viewports.push({requested:[803,603],canvas:[canvas.width,canvas.height],position:pos(vm.inputPosition())});
    need(state.viewports[1].canvas.join(',')==='803,603'&&presentation.snapshot().drawnPresents>secondPresents,'second viewport adopted');
    state.networkSetup=await command('ip link set eth0 up; ip addr add 10.0.2.15/24 dev eth0; ip addr show eth0','cnetsetup','network-setup');
    need(state.networkSetup.stdout.includes('10.0.2.15/24'),'real guest network interface');
    phase='tool-transfer';await stageBusybox();
    phase='workload';
    parser=createFencedRpc('csetup');rpcResult=null;
    await offer('setup',formatRpcCommand(contract.workload.setup,'csetup'));
    await until(()=>/E9_BEFORE\r?\n/.test(textView()));
    state.before=await witness('before',true);
    await offer('advance',contract.workload.serial_advance);
    await until(()=>!!rpcResult);
    need(rpcResult.exit===0&&/(?:^|\n)E9_AFTER\n/.test(rpcResult.stdout),'unchanged frozen setup');
    state.setup=rpcResult;need(rpcResult.stdout.includes(contract.workload.after_sha256+'  '+contract.workload.guest_path),'setup after hash');
    await command('sync','csetupflush','file-witness');await drainTerminal();
    state.origin=await witness('origin',true);state.workloadOrigin=state.origin.transition;
    state.schedule=plan.map(frame=>({index:frame.index,offset:frame.offset,target:scheduledTransition(state.workloadOrigin,frame.offset),rewriteIndex:frame.rewriteIndex,bytes:frame.bytes.length,sha256:digest(frame.bytes)}));
    for(const frame of plan){const target=scheduledTransition(state.workloadOrigin,frame.offset);
      while(BigInt(vm.inputPosition().transition)<BigInt(target))await step(target);
      need(vm.inputPosition().transition===target,'exact scheduled transition '+frame.index);
      await offer('scheduled',frame.bytes);state.scheduledOffers=frame.index;}
    await until(()=>state.bodyResults.length===10&&/E9_INPUT_100\r?\n/.test(textView()));
    state.inputMarkers=verifyGuestInputMarkers(stripConsole(state.console),contract,state.workloadOrigin,uartRows);
    state.files=await command('sync; od -An -v -tx1 /root/e9-session/state; od -An -v -tx1 /root/e9-session/entropy; od -An -v -tx1 /root/e9-session/http; sha256sum /root/e9-session/state /root/e9-session/entropy /root/e9-session/http','cfilebytes','file-witness');
    need(state.files.stdout.trim().split('\n')[0].replace(/\s/g,'')===contract.workload.after_hex,'literal final guest file');
    state.networkServiceAfter=await networkStatus('cnetwork1');
    need(state.networkServiceAfter.pid===state.networkServiceBefore.pid,'same NetworkManager daemon through original workload');
    let closing=vm.cancelOwnedLocalHttp();await collect();
    for(let n=0;!closing.closed&&n<1024;n++){need(closing.more&&!closing.blocked,'server close stalled');closing=vm.pumpOwnedLocalHttp();await collect();}
    need(closing.closed,'owned server closed');state.server=vm.ownedLocalHttpState();
    need(state.server.server.requests.length===10&&state.server.server.responsesQueued.length===10
      &&state.server.server.bodyBytesQueued.length===10,'exact ten service counters');
    need(state.server.server.requests.every(value=>value===1)&&state.server.server.responsesQueued.every(value=>value===1)
      &&state.server.server.bodyBytesQueued.every(value=>value===1024),'ten real counted HTTP responses');
    await drainTerminal();await collect();await pumpGpu();await flushJournal();stagedBytes=0;
    const finalFrame=await guardedWrite('final-keyframe',()=>journal.captureKeyframe(vm,gpu,'cold-final'));
    state.checkpoints.push({...pos(finalFrame),digest:hex(finalFrame.digest),ramDigest:hex(finalFrame.ramDigest),full:finalFrame.full});
    const end=vm.exactGpuSessionWitness();await guardedWrite('final-witness',()=>journal.completeExactPaged(end));
    state.final={...pos(end),digest:hex(end.digest),ramDigest:vm.softwareRamDigest(),state:await retain('final.state',vm.exactGpuSessionState())};
    originalState=vm.exactGpuSessionState();originalQueues=vm.exactSessionHostQueues();
    state.hostQueues=Object.fromEntries(Object.entries(originalQueues).map(([key,bytes])=>[key,shape(bytes)]));
    state.sourceObservations=sourceRows.map(row=>({...pos(row),channel:row.channel,outcome:row.outcome,bytes:[...row.bytes]}));
    need(state.sourceObservations.some(row=>row.channel===17&&row.bytes.length===8),'actual RTC receipt');
    need(state.sourceObservations.some(row=>row.channel===18&&row.outcome[1]==='6'
      &&row.bytes.length===Number(row.outcome[2])),'actual derived guest entropy receipt');
    const output=state.files.stdout,lines=output.trim().split('\n');
    const hashStart=lines.findIndex(line=>/^[a-f0-9]{64}  \/root\/e9-session\//.test(line));
    need(hashStart>0&&lines.length-hashStart===3,'complete literal guest file transcript');
    const literal=lines.slice(0,hashStart).join('').replace(/\s/g,'');
    need(literal.length===2*(9+32+1024),'all literal file bytes');
    const before=literal.slice(0,18),entropy=literal.slice(18,82),http=literal.slice(82);
    need(before===contract.workload.after_hex&&http==='1b'.repeat(1024),'final literal state and tenth HTTP body');
    const entropyHash=state.setup.stdout.match(/(?:^|\n)([a-f0-9]{64})  \/root\/e9-session\/entropy/)?.[1];
    need(entropyHash&&digest(Uint8Array.from(entropy.match(/../g),v=>parseInt(v,16)))===entropyHash,'literal setup entropy');
    for(const [index,file] of ['state','entropy','http'].entries()){
      const line=lines[hashStart+index],expected=index===0?contract.workload.after_sha256:index===1?entropyHash:digest(new Uint8Array(1024).fill(27));
      need(line===expected+'  /root/e9-session/'+file,'guest file hash '+file);}
    state.literalFiles={stateHex:before,entropyHex:entropy,httpHex:http};
    const saved=await store.openSession(writer.id),manifest=JSON.parse(decoder.decode(saved.manifest));
    sourceRenderer=await readCheckpointObject(store,manifest.checkpoints.at(-1).gpu,256*1048576);
    state.sourceRenderer=shape(sourceRenderer);
    state.scheduleCheck=verifyFrozenWorkloadOffers(contract,state.workloadOrigin,uartRows);
    state.ledgerCheck=verifyUartActivityLedger(contract,state.workloadOrigin,uartRows,state.ledger,digest);
    state.sessionId=writer.id;await writer.release();writer=null;
    state.authenticatedHistory=await SessionGpuHistoryReader.withOpen(store,state.sessionId,{},async reader=>{
      const metadata=reader.metadata;need(metadata.receipts===rows.length&&metadata.storageAuthenticated,'authenticated complete receipt count');
      let cursor=reader.initialEventCursor,index=0,bodyRefs=0;
      while(cursor){const window=await reader.nextReceiptWindow(cursor);
        for(const row of window.receipts){const source=rows[index++],parts=gpuEventParts(row);
          need(source&&JSON.stringify(pos(row))===JSON.stringify(pos(source))&&row.channel===source.channel
            &&row.ticket===source.ticket&&JSON.stringify(row.outcome)===JSON.stringify(source.outcome)
            &&row.bytes.length===source.bytesLength&&digest(row.bytes)===source.sha256,'exact reopened receipt '+(index-1));
          need(source.kind===parts.kind&&JSON.stringify(source.body??null)===JSON.stringify(parts.body??null),'exact reopened typed GPU body '+(index-1));
          if(parts.body)bodyRefs++;}
        cursor=window.nextCursor;}
      need(index===rows.length,'all original receipts reopened');
      need(metadata.checkpoints.length===state.checkpoints.length+1,'all real keyframes authenticated');
      return {receipts:index,witnesses:metadata.witnesses,windows:metadata.receiptWindows,bodyRefs,
        receiptDigest:metadata.receiptDigest,manifestSha256:metadata.session.manifestSha256};
    });
    const points=manifest.checkpoints.map(point=>BigInt(point.position.transition));
    need(points.length===state.checkpoints.length+1&&points[0]===0n,'initial checkpoint and actual count');
    for(let index=1;index<points.length;index++)need(points[index]>points[index-1]&&points[index]-points[index-1]<=50000000n,'50M checkpoint gap '+index);
    need(BigInt(manifest.end.transition)>=points.at(-1)&&BigInt(manifest.end.transition)-points.at(-1)<=50000000n,'final checkpoint coverage');
    need(offers.length===0,'unresolved UART producer');
    const factoryBefore=WasmLinux.ownedLocalHttpFactoryEntries();
    gpu.dispose();gpu=null;vm.free();vm=null;
    terminal.detachSink();terminal.term.dispose();terminalDisposed=true;
    phase='replay';await globalThis.workloadProgress({phase,position:state.final,receipts:state.receipts,
      blocks:state.blocks.length,checkpoints:state.checkpoints.length,tail:'Original live machine freed; reopening whole recorded history'});
    const nativeFetch=globalThis.fetch,nativeSocket=globalThis.WebSocket;
    state.replayEgress={fetch:0,sockets:0};
    globalThis.fetch=(...args)=>{state.replayEgress.fetch++;throw Error('live page fetch during GPU replay: '+String(args[0]));};
    globalThis.WebSocket=class extends nativeSocket{constructor(...args){state.replayEgress.sockets++;throw Error('live socket during GPU replay: '+String(args[0]));}};
    let openedReplay;
    try{openedReplay=await openGpuTimelineReplay({store,id:state.sessionId,configuration:state.configuration});}
    catch(error){globalThis.fetch=nativeFetch;globalThis.WebSocket=nativeSocket;throw error;}
    const controller=openedReplay.controller;
    let replayStateBytes;
    try{
      const selected=await controller.seekPosition(manifest.end);
      need(selected.status==='ready','whole-history replay did not publish');
      const inspection=await controller.inspectSelected();
      need(selected.rendered.replay?.wholeChain===true,'replay skipped initial windows');
      need(selected.rendered.replay.eventCursor===state.receipts,'full replay event cursor');
      need(selected.rendered.digest===state.final.digest,'full original/replay witness');
      need(digest(inspection.state)===digest(originalState),'full CPU/device/disk/clock state');
      for(const [key,bytes] of Object.entries(originalQueues))need(digest(inspection.queues[key])===digest(bytes),'pending/output '+key);
      const source=decodeCheckpointData(sourceRenderer.subarray(16,-32));
      const actual=decodeCheckpointData(inspection.renderer.bytes.subarray(16,-32));
      need(sameData(source.profile,actual.profile),'renderer profile');
      need(sameRebasedRendererLogical(source.logical,actual.logical),'renderer logical checkpoint');
      need(sameRendererFramesAfterRebase(source.frames,actual.frames,
        source.logical.epoch,actual.logical.epoch),'renderer commands after required epoch rebase');
      const replayCanvas=selected.rendered.canvas;
      replayStateBytes=inspection.state.slice();
      state.replay={position:pos(selected.position),digest:selected.rendered.digest,windows:selected.rendered.replay.windows,
        eventCursor:selected.rendered.replay.eventCursor,
        pending:shape(inspection.queues.pending),output:shape(inspection.queues.output),renderer:shape(inspection.renderer.bytes),
        sourceRenderer:state.sourceRenderer,canvas:{width:replayCanvas.width,height:replayCanvas.height,
          sha256:digest(replayCanvas.getContext('2d').getImageData(0,0,replayCanvas.width,replayCanvas.height).data)}};
      state.workerProviderAudit=await globalThis.auditReplayWorker();
      need(state.workerProviderAudit.length===1&&state.workerProviderAudit[0].factoryEntries==='0','worker-local replay provider factory stayed closed');
    }finally{controller.close();globalThis.fetch=nativeFetch;globalThis.WebSocket=nativeSocket;}
    need(state.replayEgress.fetch===0&&state.replayEgress.sockets===0,'zero page replay egress');
    await globalThis.workloadProgress({phase:'post-replay',position:state.replay.position,receipts:state.receipts,
      blocks:state.blocks.length,checkpoints:state.checkpoints.length,tail:'Replay worker audited and closed; retaining result'});
    state.replay.state=await retain('replay.state',replayStateBytes);
    need(WasmLinux.ownedLocalHttpFactoryEntries()===factoryBefore,'no replay-owned provider construction');
    need(state.replay.position.transition===state.final.transition&&state.replay.eventCursor===state.receipts,'full replay endpoint');
    state.status='desktop-full-workload-replay-passed';
  }catch(error){
    if(prefix&&error instanceof PrefixBoundary){try{await completePrefix(error.reason);}
      catch(completion){error=completion;}}
    if(state.status!=='cold-prefix-frame'&&state.status!=='cold-prefix-frontier'){
      state.status='failed';state.error=String(error.stack??error);
    state.failurePosition=vm?pos(vm.inputPosition()):null;
    try{if(vm)state.failureState=await retain('failure.state',vm.exactGpuSessionState());}
    catch(capture){state.failureCaptureError=String(capture);}}
  }finally{
    const cleanup=async(label,action)=>{try{return await action();}catch(error){const detail=label+': '+String(error.stack??error);
      (state.cleanupErrors??=[]).push(detail);if(state.status!=='failed'){state.status='failed';state.error=detail;}return null;}};
    await cleanup('final flush',async()=>{if(vm){await collect();if(journal)await flushJournal();}});
    await cleanup('terminal',()=>{if(!terminalDisposed){terminal.detachSink();terminal.term.dispose();terminalDisposed=true;}});
    await cleanup('renderer',()=>gpu?.dispose());await cleanup('machine',()=>vm?.free());
    await cleanup('writer',()=>writer?.release());
    state.retentionAtEnd=await cleanup('retention statistics',()=>store?.statistics());
    await cleanup('store',()=>store?.close());
    state.receiptFile=await cleanup('receipts sidecar',()=>retain('receipts.json',encoder.encode(JSON.stringify(rows))));
    state.ledgerFile=await cleanup('ledger sidecar',()=>retain('ledger.json',encoder.encode(JSON.stringify(state.ledger))));
  }
  return state;
}
