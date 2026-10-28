// Browser half of the private E9-T22s diagnostic. The source seek uses the
// original pinned runtime; only the new owner runs the feature-gated observer.
export async function run(input){
  const need=(value,message)=>{if(!value)throw Error('cold block diagnostic: '+message);};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  const unhex=value=>Uint8Array.from(value.match(/../g),part=>parseInt(part,16));
  const independentStateDigest=(state,ramDigest)=>{
    const domain=new TextEncoder().encode('wasm-vm-gpu-guest-state-v1\0');
    const bytes=new Uint8Array(domain.length+8+state.length+32);
    bytes.set(domain);
    new DataView(bytes.buffer).setBigUint64(domain.length,BigInt(state.length),true);
    bytes.set(state,domain.length+8);
    bytes.set(unhex(ramDigest),domain.length+8+state.length);
    return checkpointHash(bytes);
  };
  const pos=value=>Object.fromEntries(['transition','retired','sequence','phase','ordinal']
    .map(key=>[key,value[key]]));
  const {SessionStore}=await import('/session-store.js');
  const {SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js');
  const {checkpointHash,readCheckpointObject}=await import('/session-checkpoints.js');
  const {encodeCheckpointData,decodeCheckpointData}=await import(
    '/renderer/virgl-command/checkpoint-codec.mjs');
  const {isKeyframeDescriptorPrefix,decodeKeyframeDescriptor}=await import('/session-keyframes.js');
  const {decodeGpuExactFrame}=await import('/session-gpu-replay-format.js');
  const {branchOrigin}=await import('/session-branch-format.js');
  const store=await SessionStore.open(input.database);
  let activeWorker=null,localBaseReads=0;
  let nextSeekProgress=13960000000n;
  const result={status:'running',source:{anchorCheckpoint:input.anchorCheckpoint,
    checkpoint:input.targetCheckpoint,
    laterCheckpoints:input.nextCheckpoints,errorReceipt:input.errorReceipt,
    sourceReportSha256:input.sourceReportSha256},
    replay:null,origin:null,intermediateWitnesses:[],coarseFailure:null,
    firstFailure:null,guestError:null,divergence:null,egress:{fetch:0,sockets:0}};
  const request=(worker,type,data={},timeout=30*60*1000,transfer=[],options={})=>new Promise((resolve,reject)=>{
    const requestId=data.requestId??++input.nextRequest;let done=false;
    const expected=type==='seek'?'ready':type==='inspect-selected'?'selected-inspection'
      :type==='capture-branch'?'branch-captured':'result';
    const cleanup=()=>{done=true;clearTimeout(timer);worker.removeEventListener('message',message);
      worker.removeEventListener('error',error);};
    const fail=value=>{if(done)return;cleanup();reject(value);};
    const message=event=>{const value=event.data;if(value.requestId!==requestId)return;
      if(value.type==='need-base'){
        if(options.denyBase){
          worker.postMessage({type:'base-error',requestId,token:value.token,
            message:'deliberate unavailable offline base chunk'});
          return;
        }
        (async()=>{
          need(Number.isInteger(value.token)&&value.token>0,'offline base request token');
          const base64=await globalThis.readOfflineBase(value.ref);
          const binary=atob(base64),bytes=new Uint8Array(binary.length);
          for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
          need(String(bytes.length)===value.ref.length
            &&checkpointHash(bytes)===value.ref.sha256,'offline base IPC bytes changed');
          worker.postMessage({type:'base-reply',requestId,token:value.token,
            ref:value.ref,bytes},[bytes.buffer]);
        })().catch(error=>worker.postMessage({type:'base-error',requestId,
          token:value.token,message:String(error.stack??error)}));
        return;
      }
      if(value.type==='progress'){
        if(type==='seek'&&value.position
          &&BigInt(value.position.transition)>=nextSeekProgress){
          nextSeekProgress=BigInt(value.position.transition)+10000000n;
          void globalThis.frontierProgress({stage:'pre-error-delta-seek',
            transition:value.position.transition});
        }
        return;
      }
      if(value.type==='error'||value.type==='inspection-error'||value.type==='branch-error'){
        const failure=Error(value.stack??value.message);failure.detail=value;fail(failure);return;
      }
      if(value.type===expected){cleanup();resolve(value);}
    };
    const error=event=>fail(Error(event.message||'diagnostic worker crashed'));
    const timer=setTimeout(()=>fail(Error(type+' deadline exceeded')),timeout);
    worker.addEventListener('message',message);worker.addEventListener('error',error);
    try{worker.postMessage({type,requestId,...data},transfer);}catch(cause){fail(cause);}
  });
  const initialized=worker=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('worker initialization deadline')),30000);
    worker.addEventListener('message',function ready(event){
      if(event.data?.type!=='initialized')return;
      clearTimeout(timer);worker.removeEventListener('message',ready);resolve();
    });worker.addEventListener('error',reject,{once:true});
  });
  try{
    const opened=await store.openSession(input.id);
    need(opened&&checkpointHash(opened.manifest)===input.manifestSha256,
      'cloned manifest differs from authenticated source');
    const statistics=await store.statistics();
    need(same(statistics,input.statistics),'retention counters changed');
    await globalThis.frontierProgress({stage:'source-store-opened',
      manifestSha256:input.manifestSha256});
    const manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    const metadata=await SessionGpuHistoryReader.withOpen(store,input.id,{},
      async reader=>reader.metadata);
    need(metadata.storageAuthenticated&&metadata.checkpoints.length===435
      &&metadata.session.manifestSha256===input.manifestSha256,
      'source witness graph authentication failed');
    await globalThis.frontierProgress({stage:'source-history-authenticated',
      checkpoints:metadata.checkpoints.length});
    const anchor=manifest.checkpoints.find(point=>
      point.position.transition===input.anchorCheckpoint.transition);
    const target=manifest.checkpoints.find(point=>
      point.position.transition===input.targetCheckpoint.transition);
    need(anchor&&target&&anchor.position.transition==='13950000000'
      &&target.position.transition==='14350000000'
      &&same(pos(anchor.position),pos(input.anchorCheckpoint))
      &&same(pos(target.position),pos(input.targetCheckpoint)),
      'unexpected pre-error anchor or target checkpoint');
    const anchorObject=await readCheckpointObject(store,anchor.machine,256*1048576);
    need(!isKeyframeDescriptorPrefix(anchorObject.subarray(0,8))
      &&decodeGpuExactFrame(anchorObject).meta.stateSha256===input.anchorCheckpoint.digest,
      'authenticated full checkpoint anchor changed');
    const machineObject=await readCheckpointObject(store,target.machine,256*1048576);
    const frameRef=isKeyframeDescriptorPrefix(machineObject.subarray(0,8))
      ?decodeKeyframeDescriptor(machineObject).frame:null;
    const frame=decodeGpuExactFrame(frameRef
      ?await readCheckpointObject(store,frameRef,256*1048576):machineObject);
    need(frame.meta.stateSha256===input.targetCheckpoint.digest
      &&frame.meta.rendererSha256===target.gpu.sha256,
      'pre-error frame witness differs from source report');
    const savedRenderer=await readCheckpointObject(store,target.gpu,256*1048576);
    const anchorRenderer=await readCheckpointObject(store,anchor.gpu,256*1048576);
    need(checkpointHash(savedRenderer)===target.gpu.sha256,
      'saved source renderer bytes changed');
    need(checkpointHash(anchorRenderer)===anchor.gpu.sha256,
      'saved full-anchor renderer bytes changed');
    const replayWorker=new Worker('/session-gpu-replay-worker.js',{type:'module'});
    let replayed,inspection,captured,savedPhysical,normalizedLogical;
    let sourceFrames,anchorFrames,rebaseFrame,changedLogicalFields,replayFramesNormalized;
    let rawFrameChainMatches,epochNormalizations;
    const physicalHash=value=>checkpointHash(encodeCheckpointData(value));
    try{
      await initialized(replayWorker);
      replayed=await request(replayWorker,'seek',{database:input.database,sessionId:input.id,
        checkpointId:anchor.id,target:pos(target.position),quantum:4096},60*60*1000);
      need(replayed.digest===input.targetCheckpoint.digest
        &&same(pos(replayed.position),pos(target.position))
        &&replayed.replay?.paged===true&&replayed.replay.windows>=1
        &&replayed.replay.wholeChain===false&&replayed.continuationReady===true,
        'authenticated full-checkpoint source selection differs');
      await globalThis.frontierProgress({stage:'pre-error-delta-selected',
        anchor:anchor.position.transition,transition:replayed.position.transition,
        digest:replayed.digest,windows:replayed.replay.windows});
      inspection=await request(replayWorker,'inspect-selected',
        {requestId:replayed.requestId,inspectionId:1},30*60*1000);
      const frontier=JSON.parse(inspection.frontier);
      const cursor=value=>value===null||/^[0-9]+$/.test(value);
      need(inspection.requestId===replayed.requestId&&inspection.inspectionId===1
        &&same(pos(inspection.position),pos(target.position))
        &&inspection.rendererStatus?.ok===true
        &&same(Object.keys(frontier).sort(),[
          'version','position','stateSha256','eventCursor','sourceCursor',
          'sourceLastLoaded','deviceCursor','networkCursor','gpuCursor',
          'rendererDigest','pending','output'].sort())
        &&frontier.version===1
        &&same(pos(frontier.position),pos(target.position))
        &&frontier.stateSha256===input.targetCheckpoint.digest
        &&frontier.pending.length===String(inspection.queues.pending.length)
        &&frontier.pending.sha256===checkpointHash(inspection.queues.pending)
        &&frontier.output.length===String(inspection.queues.output.length)
        &&frontier.output.sha256===checkpointHash(inspection.queues.output)
        &&/^[0-9]+$/.test(frontier.eventCursor)
        &&/^[0-9]+$/.test(frontier.sourceCursor)
        &&cursor(frontier.deviceCursor)&&cursor(frontier.networkCursor)
        &&cursor(frontier.gpuCursor)
        &&(frontier.sourceLastLoaded===null
          ||Object.values(pos(frontier.sourceLastLoaded)).every(value=>value!==undefined))
        &&frontier.rendererDigest===anchor.gpu.sha256,
        'selected replay inspection or frontier differs from source');
      const independentDigest=independentStateDigest(
        inspection.state,input.targetCheckpoint.ramDigest);
      need(independentDigest===input.targetCheckpoint.digest,
        'independent raw state witness changed: '+independentDigest);
      need(inspection.renderer
        &&checkpointHash(inspection.renderer.bytes)===inspection.renderer.sha256,
        'rebased replay renderer bytes changed');
      savedPhysical=decodeCheckpointData(savedRenderer.subarray(16,-32));
      const anchorPhysical=decodeCheckpointData(anchorRenderer.subarray(16,-32));
      const replayPhysical=decodeCheckpointData(inspection.renderer.bytes.subarray(16,-32));
      const logicalKeys=Object.keys(savedPhysical.logical);
      changedLogicalFields=logicalKeys.filter(key=>
        physicalHash(savedPhysical.logical[key])!==physicalHash(replayPhysical.logical[key]));
      normalizedLogical=structuredClone(replayPhysical.logical);
      need(savedPhysical.logical.scanout&&normalizedLogical.scanout,
        'saved or replayed physical scanout is missing');
      normalizedLogical.epoch=savedPhysical.logical.epoch;
      normalizedLogical.scanout.epoch=savedPhysical.logical.scanout.epoch;
      sourceFrames=savedPhysical.frames.length;
      anchorFrames=anchorPhysical.frames.length;
      rebaseFrame=replayPhysical.frames.length===sourceFrames+1
        ?decodeCheckpointData(replayPhysical.frames[anchorFrames]):null;
      const unrebasedFrames=[...replayPhysical.frames.slice(0,anchorFrames),
        ...replayPhysical.frames.slice(anchorFrames+1)];
      rawFrameChainMatches=physicalHash(savedPhysical.frames)===physicalHash(unrebasedFrames);
      epochNormalizations=0;
      const normalizeOwnerEpoch=bytes=>{
        const value=decodeCheckpointData(bytes);
        if(value.op==='event'){
          need(value.event?.epoch===replayPhysical.logical.epoch,
            'replayed physical event has an unexpected owner epoch');
          value.event.epoch=savedPhysical.logical.epoch;
        }else if(value.op==='complete'||value.op==='gatherInput'){
          need(value.args?.[0]===replayPhysical.logical.epoch,
            'replayed physical operation has an unexpected owner epoch');
          value.args[0]=savedPhysical.logical.epoch;
        }else need(false,'unrecognized post-anchor physical renderer frame');
        epochNormalizations++;
        return encodeCheckpointData(value);
      };
      replayFramesNormalized=[...replayPhysical.frames.slice(0,anchorFrames),
        ...replayPhysical.frames.slice(anchorFrames+1).map(normalizeOwnerEpoch)];
      const physicalChecks={
        logicalKeys:same(logicalKeys,Object.keys(replayPhysical.logical)),
        sourceEpoch:savedPhysical.logical.epoch===frame.meta.rendererEpoch,
        anchorEpoch:anchorPhysical.logical.epoch===savedPhysical.logical.epoch,
        anchorFrameCount:anchorFrames<=sourceFrames,
        anchorFramePrefix:physicalHash(anchorPhysical.frames)===
          physicalHash(savedPhysical.frames.slice(0,anchorFrames)),
        replayEpoch:replayPhysical.logical.epoch===inspection.renderer.epoch,
        scanoutEpoch:replayPhysical.logical.scanout.epoch===inspection.renderer.epoch,
        profile:physicalHash(savedPhysical.profile)===physicalHash(replayPhysical.profile),
        contents:physicalHash(savedPhysical.contents)===physicalHash(replayPhysical.contents),
        changedFields:changedLogicalFields.every(key=>['epoch','scanout'].includes(key)),
        logical:physicalHash(savedPhysical.logical)===physicalHash(normalizedLogical),
        noQueries:savedPhysical.logical.queries.length===0
          &&replayPhysical.logical.queries.length===0,
        oneRebaseFrame:replayPhysical.frames.length===sourceFrames+1,
        normalizedSuffixCount:epochNormalizations===sourceFrames-anchorFrames,
        frameChain:physicalHash(savedPhysical.frames)===physicalHash(replayFramesNormalized),
        rebaseOperation:rebaseFrame?.op==='rebase',
        rebaseFromAnchor:rebaseFrame?.expected===anchorPhysical.logical.epoch,
        rebaseToReplay:rebaseFrame?.next===replayPhysical.logical.epoch};
      await globalThis.frontierProgress({stage:'physical-renderer-comparison',
        sourceSha256:target.gpu.sha256,replaySha256:inspection.renderer.sha256,
        anchorFrames,sourceFrames,replayedFrames:replayPhysical.frames.length,
        rawFrameChainMatches,epochNormalizations,rebaseFrame,checks:physicalChecks});
      need(Object.values(physicalChecks).every(Boolean),
        'replayed physical renderer differs from authenticated saved renderer beyond epoch rebase');
      captured=await request(replayWorker,'capture-branch',
        {requestId:replayed.requestId,captureId:1},30*60*1000);
      need(captured.requestId===replayed.requestId&&captured.captureId===1
        &&hex(captured.capture.sourceDigest)===input.targetCheckpoint.digest
        &&same(pos(captured.position),pos(target.position))
        &&checkpointHash(captured.renderer.bytes)===captured.renderer.sha256
        &&captured.renderer.sha256===inspection.renderer.sha256
        &&captured.renderer.epoch===inspection.renderer.epoch,
        'private branch capture differs from the source checkpoint');
      await globalThis.frontierProgress({stage:'console-capture-comparison',
        selectedConsoleSha256:checkpointHash(new TextEncoder().encode(replayed.console)),
        capturedConsoleSha256:checkpointHash(new TextEncoder().encode(captured.console)),
        capturedPrefixSha256:checkpointHash(captured.consolePrefix),
        capturedPrefixBytes:captured.consolePrefix.length,
        sealedPrefixSha256:input.sourceConsolePrefixSha256,
        sealedPrefixBytes:input.sourceConsolePrefix.length});
      need(captured.console===replayed.console
        // The pinned paged replay has no branch origin and retains receipts
        // in windows rather than selected.read. Its capture API therefore
        // returns an empty prefix and an empty selected.console for this
        // no-receipt interval. Supply the prefix reconstructed from
        // the sealed source receipts below, never this empty capture field.
        &&captured.consolePrefix.length===0
        &&checkpointHash(Uint8Array.from(input.sourceConsolePrefix))
          ===input.sourceConsolePrefixSha256
        &&!new TextDecoder().decode(Uint8Array.from(input.sourceConsolePrefix))
          .includes('I/O error, dev vda'),
        'paged selection or sealed pre-error console prefix changed');
      await globalThis.frontierProgress({stage:'original-runtime-captured',
        transition:captured.position.transition});
    }finally{replayWorker.terminate();}
    result.replay={position:pos(replayed.position),digest:replayed.digest,
      windows:replayed.replay.windows,rawStateSha256:checkpointHash(inspection.state),
      rendererSha256:checkpointHash(inspection.renderer.bytes),
      physicalComparedToSaved:{sourceSha256:target.gpu.sha256,
        replayedSha256:inspection.renderer.sha256,
        profileSha256:physicalHash(savedPhysical.profile),
        contentsSha256:physicalHash(savedPhysical.contents),
        logicalSha256:physicalHash(savedPhysical.logical),
        normalizedReplayLogicalSha256:physicalHash(normalizedLogical),
        anchorFrames,sourceFrames,replayedFrames:sourceFrames+1,
        sourceFramePrefixSha256:physicalHash(savedPhysical.frames),
        normalizedReplayFramesSha256:physicalHash(replayFramesNormalized),
        rawFrameChainMatches,epochNormalizations,changedLogicalFields,
        rebaseIndex:anchorFrames,rebase:rebaseFrame}};
    const captureReceipts=Object.fromEntries(['native','pending','output','disk']
      .map(name=>[name+'Sha256',checkpointHash(captured.capture[name])]));
    captureReceipts.rendererSha256=checkpointHash(captured.renderer.bytes);
    captureReceipts.sourceSavedRendererSha256=checkpointHash(savedRenderer);
    captureReceipts.captureConsolePrefixSha256=checkpointHash(captured.consolePrefix);
    captureReceipts.sealedConsolePrefixSha256=input.sourceConsolePrefixSha256;
    const selectedQueues=inspection.queues;
    need(captureReceipts.pendingSha256===checkpointHash(frame.pending)
      &&captureReceipts.pendingSha256===checkpointHash(selectedQueues.pending)
      &&captureReceipts.outputSha256===checkpointHash(frame.output)
      &&captureReceipts.outputSha256===checkpointHash(selectedQueues.output),
      'captured queues differ from authenticated saved frame or original-runtime inspection');
    const diskRef=await store.objectReference(target.disk_root);
    const diskRootBytes=await readCheckpointObject(store,diskRef,12*1048576);
    need(checkpointHash(diskRootBytes)===target.disk_root,
      'checkpoint disk root changed before branch capture');
    const diskRoot=JSON.parse(new TextDecoder().decode(diskRootBytes));
    const diskBytes=captured.capture.disk,diskView=new DataView(
      diskBytes.buffer,diskBytes.byteOffset,diskBytes.byteLength);
    need(diskBytes.length===61
      &&new TextDecoder().decode(diskBytes.subarray(0,5))==='WVOD1'
      &&diskView.getUint32(5,true)===4096
      &&diskView.getBigUint64(9,true).toString()===diskRoot.image_len
      &&hex(diskBytes.subarray(17,49))===diskRoot.base
      &&diskView.getBigUint64(49,true).toString()===diskRoot.generation
      &&diskView.getUint32(57,true)===0&&diskRoot.blocks.length===0,
      'captured disk base binding differs from authenticated empty checkpoint root');
    captureReceipts.diskRootSha256=checkpointHash(diskRootBytes);
    captureReceipts.savedNativeSha256=checkpointHash(frame.native);
    need(captureReceipts.rendererSha256===result.replay.rendererSha256,
      'captured branch renderer differs from inspected original runtime');
    result.source.captureReceipts=captureReceipts;
    const configuration=structuredClone(metadata.configuration);
    need(checkpointHash(new TextEncoder().encode(configuration.imageManifest))
      ===input.baseManifestSha256,'source image differs from offline base');
    configuration.branchOrigin=branchOrigin({parentId:input.id,
      parentManifestSha256:input.manifestSha256,
      sourceDigestSha256:input.targetCheckpoint.digest,
      position:target.position,consolePrefix:Uint8Array.from(input.sourceConsolePrefix)});
    const retainedWasm=manifest.assets.find(row=>row.role==='wasm')?.content;
    const retainedKernel=manifest.assets.find(row=>row.role==='kernel')?.content;
    need(retainedWasm&&retainedKernel,'source runtime assets missing');
    const originalWasm=await readCheckpointObject(store,retainedWasm,64*1048576);
    const kernel=await readCheckpointObject(store,retainedKernel,64*1048576);
    need(String(originalWasm.length)===configuration.wasm.length
      &&checkpointHash(originalWasm)===configuration.wasm.sha256,
      'source runtime asset identity changed');
    const privateWasm=new Uint8Array(await(await fetch(
      '/__verify__/e9-t22s-pkg/wasm_vm_wasm_bg.wasm')).arrayBuffer());
    need(checkpointHash(privateWasm)===input.diagnosticWasmSha256
      &&checkpointHash(privateWasm)!==configuration.wasm.sha256,
      'private diagnostic wasm bundle changed');
    result.source.originalWasmSha256=checkpointHash(originalWasm);
    result.source.diagnosticWasmSha256=checkpointHash(privateWasm);
    const createOwner=async mode=>{
      const worker=new Worker(input.diagnosticWorker,{type:'module'});
      await initialized(worker);
      const ownedKernel=kernel.slice(),ownedWasm=(mode==='original'
        ?originalWasm:privateWasm).slice();
      const renderer={...captured.renderer,bytes:captured.renderer.bytes.slice()};
      const capture=Object.fromEntries(Object.entries(captured.capture).map(([key,value])=>
        [key,value instanceof Uint8Array?value.slice():value]));
      const transfer=[ownedKernel,ownedWasm,renderer.bytes,
        ...Object.values(capture).filter(value=>value instanceof Uint8Array)]
        .map(bytes=>bytes.buffer);
      const prepared=await request(worker,'prepare',{database:input.database,
        configuration:structuredClone(configuration),kernel:ownedKernel,wasm:ownedWasm,
        capture,renderer,retainedObjects:input.retainedObjects,
        diagnosticWasmSha256:input.diagnosticWasmSha256,mode},45*60*1000,
        [...new Set(transfer)]);
      need(same(pos(prepared.origin.position),pos(target.position))
        &&prepared.origin.digest===input.targetCheckpoint.digest
        &&prepared.origin.ramDigest===input.targetCheckpoint.ramDigest
        &&prepared.origin.nativeSha256===captureReceipts.nativeSha256
        &&prepared.origin.pendingSha256===captureReceipts.pendingSha256
        &&prepared.origin.outputSha256===captureReceipts.outputSha256
        &&prepared.origin.diskSha256===captureReceipts.diskSha256
        &&prepared.origin.sourceRendererSha256===captureReceipts.rendererSha256
        &&prepared.origin.sourceRendererEpoch===captured.renderer.epoch
        &&prepared.origin.rendererSha256===prepared.origin.physical.rebasedSha256
        &&prepared.origin.rendererEpoch===prepared.origin.physical.rebasedEpoch
        &&prepared.origin.physical.sourceSha256===captured.renderer.sha256
        &&prepared.origin.physical.sourceEpoch===captured.renderer.epoch
        &&prepared.origin.physical.rebasedFrames===prepared.origin.physical.sourceFrames+1
        &&prepared.origin.physical.rebase?.op==='rebase'
        &&prepared.origin.physical.rebase.expected===captured.renderer.epoch
        &&prepared.origin.physical.rebase.next===prepared.origin.rendererEpoch
        &&prepared.origin.physical.changedLogicalFields.every(key=>
          ['epoch','scanout'].includes(key))
        &&prepared.view.offline===true&&prepared.view.egress.fetch===0
        &&prepared.view.egress.sockets===0,'private branch origin changed');
      const active=await request(worker,'activate',{},30*60*1000);
      need(same(pos(active.view.position),pos(target.position))
        &&active.view.digest===prepared.origin.digest
        &&active.view.firstBlockFailure===null,'passive observer changed source witness');
      return {worker,origin:prepared.origin,view:active.view};
    };
    const checkpoints=input.nextCheckpoints;
    const limit=BigInt(input.limit);
    const savedQueues=new Map();
    for(const row of checkpoints){
      const point=manifest.checkpoints.find(value=>
        value.position.transition===row.transition);
      need(point,'missing original checkpoint for output witness');
      const bytes=await readCheckpointObject(store,point.machine,256*1048576);
      const ref=isKeyframeDescriptorPrefix(bytes.subarray(0,8))
        ?decodeKeyframeDescriptor(bytes).frame:null;
      const saved=decodeGpuExactFrame(ref
        ?await readCheckpointObject(store,ref,256*1048576):bytes);
      need(saved.meta.stateSha256===row.digest,
        'original checkpoint frame differs from its recorded state digest');
      savedQueues.set(row.transition,{pendingSha256:checkpointHash(saved.pending),
        outputSha256:checkpointHash(saved.output)});
    }
    const original=await createOwner('original');activeWorker=original.worker;
    const sourceWitnesses=new Map();let originalView=original.view;
    for(let count=0;BigInt(originalView.position.transition)<limit&&count<512;count++){
      const before=BigInt(originalView.position.transition);
      const upcoming=checkpoints.find(row=>BigInt(row.transition)>before);
      const boundary=upcoming?BigInt(upcoming.transition):limit;
      const steps=Number([1048576n,boundary-before,limit-before]
        .reduce((minimum,value)=>value<minimum?value:minimum));
      need(steps>0,'original-runtime advance lost its bound');
      const response=await request(original.worker,'advance',
        {steps,stopOnFailure:false},10*60*1000);
      if(response.advanced!==steps||response.view.guestHalt){
        const inspected=await request(original.worker,'inspect',{},30000);
        result.status='exact-witness-divergence';
        result.divergence={position:pos(inspected.view.position),actual:inspected.view.digest,
          expectedCheckpoint:upcoming?.digest,
          reason:'original runtime halted or stopped advancing before its saved source checkpoint',
          guestHalt:inspected.view.guestHalt};
        return result;
      }
      originalView=response.view;
      if(upcoming&&originalView.position.transition===upcoming.transition){
        const witnessed=await request(original.worker,'inspect',{},30000);
        originalView=witnessed.view;
        const queues=savedQueues.get(upcoming.transition);
        const recordedRows=input.sourceReceipts.filter(row=>
          BigInt(row.position.sequence)<=BigInt(upcoming.sequence));
        if(originalView.digest!==upcoming.digest
          ||originalView.pendingSha256!==queues.pendingSha256
          ||originalView.outputSha256!==queues.outputSha256
          ||!same(originalView.eventRows,recordedRows)){
          result.status='exact-witness-divergence';
          result.divergence={position:pos(originalView.position),actual:originalView.digest,
            expected:upcoming.digest,actualPendingSha256:originalView.pendingSha256,
            expectedPendingSha256:queues.pendingSha256,
            actualOutputSha256:originalView.outputSha256,
            expectedOutputSha256:queues.outputSha256,
            actualEventRows:originalView.eventRows,
            expectedEventRows:recordedRows,
            reason:'original runtime differs from the saved state, queue or receipt witness'};
          return result;
        }
        const outputSha256=originalView.consoleSha256;
        const sourceOutput=input.sourceConsoleWitnesses.find(row=>
          row.transition===upcoming.transition);
        if(!sourceOutput||originalView.consoleSha256!==sourceOutput.sha256
          ||originalView.consoleBytes!==sourceOutput.bytes){
          result.status='exact-witness-divergence';
          result.divergence={position:pos(originalView.position),
            actualOutputSha256:originalView.consoleSha256,
            expectedOutputSha256:sourceOutput?.sha256,
            reason:'original runtime output differs from sealed per-receipt serial witness'};
          return result;
        }
        sourceWitnesses.set(upcoming.transition,{console:originalView.console,
          outputSha256,outputBytes:originalView.consoleBytes,digest:originalView.digest,
          eventDigest:originalView.eventDigest,payloadDigest:originalView.payloadDigest,
          eventCount:originalView.eventCount,payloadCount:originalView.payloadCount,
          eventRows:originalView.eventRows});
        await globalThis.frontierProgress({stage:'original-runtime-witness',
          transition:upcoming.transition,digest:originalView.digest,outputSha256,
          eventDigest:originalView.eventDigest,payloadDigest:originalView.payloadDigest});
      }
    }
    need(BigInt(originalView.position.transition)===limit
      &&sourceWitnesses.size===checkpoints.length,
      'original runtime did not traverse both saved source checkpoints');
    need(originalView.offline===true&&originalView.egress.fetch===0
      &&originalView.egress.sockets===0,'original owner attempted live egress');
    if(originalView.consoleSha256!==input.sourceConsoleSha256
      ||originalView.console!==input.sourceConsole
      ||!originalView.console.includes(input.sourceErrorLine)
      ||!originalView.console.includes(input.sourceExt4Line)){
      result.status='exact-witness-divergence';
      result.divergence={position:pos(originalView.position),
        actualOutputSha256:originalView.consoleSha256,
        sealedOutputSha256:checkpointHash(new TextEncoder().encode(input.sourceConsole)),
        originalConsoleTail:originalView.console.slice(-2048),
        reason:'original-runtime serial suffix differs from the sealed recording'};
      return result;
    }
    result.originalRuntime={origin:original.origin,
      witnesses:[...sourceWitnesses].map(([transition,value])=>({transition,
        digest:value.digest,outputSha256:value.outputSha256,
        outputBytes:value.outputBytes,eventDigest:value.eventDigest,
        payloadDigest:value.payloadDigest,eventCount:value.eventCount,
        payloadCount:value.payloadCount})),
      consoleTail:originalView.console.slice(-2048),egress:originalView.egress};
    const naturalBaseRequests=originalView.localBaseReads;
    localBaseReads+=originalView.localBaseReads;
    original.worker.terminate();activeWorker=null;
    // Only a naturally requested missing image chunk can test a parked guest
    // descriptor without modifying the original image or workload. The
    // separate preflight always attacks an absent image chunk before boot.
    if(naturalBaseRequests){
      const unavailable=await createOwner('diagnostic');activeWorker=unavailable.worker;
      let unavailableView=unavailable.view,baseFailure=null;
      for(let count=0;count<512&&BigInt(unavailableView.position.transition)<limit;count++){
        const steps=Number([1048576n,limit-BigInt(unavailableView.position.transition)]
          .reduce((minimum,value)=>value<minimum?value:minimum));
        try{
          const response=await request(unavailable.worker,'advance',
            {steps,stopOnFailure:false},10*60*1000,[],{denyBase:true});
          need(response.advanced===steps&&!response.view.guestHalt,
            'base-sabotage owner stopped before its first unretained chunk');
          unavailableView=response.view;
        }catch(error){
          baseFailure=error.detail?.missingLocalBlock;
          need(baseFailure?.code==='BaseSupplyFailure',
            'base-sabotage owner failed for a reason other than offline base refusal');
          break;
        }
      }
      const parked=baseFailure?.before?.parkedBlocks?.filter(row=>
        row.reason.kind==='chunk'&&row.usedShadowIndex===row.usedGuestIndex);
      need(baseFailure?.before&&baseFailure?.after
        &&same(baseFailure.before,baseFailure.after)
        &&baseFailure.before.firstBlockFailure===null
        &&baseFailure.matchingParked?.length>0
        &&baseFailure.matchingParked.every(row=>parked.some(value=>same(value,row)))
        &&parked?.length>0
        &&parked.every(row=>Number.isInteger(row.statusByte)
          &&row.statusByte>=0&&row.statusByte<=255
          &&/^[0-9]+$/.test(row.statusAddress))
        &&baseFailure.before.outstanding.some(row=>row.id===baseFailure.id
          &&row.kind==='block')
        &&baseFailure.sourceGraphMembership===false
        &&baseFailure.baseImageMembership===true,
        'unavailable base chunk changed a parked descriptor or block-error latch');
      const sabotaged=await request(unavailable.worker,'inspect',{},30000);
      need(same(pos(sabotaged.view.position),pos(baseFailure.after.position))
        &&sabotaged.view.digest===baseFailure.after.digest
        &&sabotaged.view.firstBlockFailure===null
        &&sabotaged.view.outstanding.some(row=>row.id===baseFailure.id),
        'failed base IPC resumed guest execution or completed the parked request');
      result.unavailableBase={status:'naturally-requested-chunk-denied',
        ...baseFailure,observedAt:pos(sabotaged.view.position)};
      unavailable.worker.terminate();activeWorker=null;
    }else result.unavailableBase={status:'no-unretained-chunk-request-in-sealed-interval',
      originalRuntimeLocalBaseReads:0,
      preflightAttack:'unavailable-unrequested-base-chunk'};
    const coarse=await createOwner('diagnostic');activeWorker=coarse.worker;result.origin=coarse.origin;
    let latest=coarse.view,coarseBracket=null,coarseFailure=null,nextProgress=14360000000n;
    for(let count=0;BigInt(latest.position.transition)<limit&&count<512;count++){
      const position=BigInt(latest.position.transition);
      const upcoming=checkpoints.find(row=>BigInt(row.transition)>position);
      const boundary=upcoming?BigInt(upcoming.transition):limit;
      const steps=Number([1048576n,boundary-position,limit-position]
        .reduce((minimum,value)=>value<minimum?value:minimum));
      need(steps>0,'coarse advance lost its bound');
      const response=await request(coarse.worker,'advance',
        {steps,stopOnFailure:coarseBracket===null},10*60*1000);
      need(response.advanced===Number(BigInt(response.view.position.transition)-position)
        &&response.advanced>=0&&response.advanced<=steps,
        'coarse advancement differs from exact position');
      need(!response.view.guestHalt,'guest halted before the authenticated source frontier');
      latest=response.view;
      if(latest.firstBlockFailure&&!coarseBracket){
        coarseBracket=response.failureBracketStart;
        need(coarseBracket&&BigInt(coarseBracket.transition)<=BigInt(latest.position.transition)
          &&BigInt(latest.position.transition)-BigInt(coarseBracket.transition)<=1048576n,
          'first error lacked a bounded instruction bracket');
        coarseFailure={bracketStart:coarseBracket,observedAt:pos(latest.position),
          failure:latest.firstBlockFailure};
      }
      need(response.advanced>0||coarseBracket!==null,
        'coarse run stalled without a block-error event');
      if(upcoming&&latest.position.transition===upcoming.transition){
        const witnessed=await request(coarse.worker,'inspect',{},30000);
        latest=witnessed.view;
        const originalWitness=sourceWitnesses.get(upcoming.transition);
        const diagnosticOutputSha256=latest.consoleSha256;
        result.intermediateWitnesses.push({position:pos(latest.position),
          actual:latest.digest,expected:upcoming.digest,
          originalOutputSha256:originalWitness?.outputSha256,
          diagnosticOutputSha256,
          originalEventDigest:originalWitness?.eventDigest,
          diagnosticEventDigest:latest.eventDigest,
          originalPayloadDigest:originalWitness?.payloadDigest,
          diagnosticPayloadDigest:latest.payloadDigest,
          sourceEventRows:originalWitness?.eventRows,
          diagnosticEventRows:latest.eventRows,
          pendingSha256:latest.pendingSha256,outputQueueSha256:latest.outputSha256});
        if(latest.digest!==upcoming.digest
          ||latest.digest!==originalWitness?.digest
          ||diagnosticOutputSha256!==originalWitness?.outputSha256
          ||latest.eventDigest!==originalWitness?.eventDigest
          ||latest.payloadDigest!==originalWitness?.payloadDigest
          ||latest.eventCount!==originalWitness?.eventCount
          ||latest.payloadCount!==originalWitness?.payloadCount
          ||!same(latest.eventRows,originalWitness?.eventRows)
          ||latest.pendingSha256!==savedQueues.get(upcoming.transition).pendingSha256
          ||latest.outputSha256!==savedQueues.get(upcoming.transition).outputSha256){
          result.status='exact-witness-divergence';
          result.divergence={position:pos(latest.position),actual:latest.digest,
            expected:upcoming.digest,reason:'diagnostic state or serial output differs from original runtime and saved checkpoint'};
          return result;
        }
      }
      if(BigInt(latest.position.transition)>=nextProgress){
        await globalThis.frontierProgress({stage:'coarse-block-observation',
          transition:latest.position.transition,localBaseReads:latest.localBaseReads});
        nextProgress=BigInt(latest.position.transition)+10000000n;
      }
    }
    need(BigInt(latest.position.transition)===limit
      &&result.intermediateWitnesses.length===checkpoints.length,
      'diagnostic owner did not traverse every authenticated source checkpoint');
    need(latest.offline===true&&latest.egress.fetch===0
      &&latest.egress.sockets===0,'diagnostic owner attempted live egress');
    const sourceConsoleSha256=checkpointHash(new TextEncoder().encode(input.sourceConsole));
    need(sourceConsoleSha256===input.sourceConsoleSha256,
      'sealed source console changed in browser transport');
    const diagnosticConsoleSha256=latest.consoleSha256;
    const originalConsoleSha256=sourceWitnesses.get(checkpoints.at(-1).transition).outputSha256;
    result.source.outputAtFrontier={sealedFullSourceSha256:sourceConsoleSha256,
      originalRuntimeSha256:originalConsoleSha256,
      diagnosticSha256:diagnosticConsoleSha256,
      sourceBytes:new TextEncoder().encode(input.sourceConsole).length,
      diagnosticBytes:latest.consoleBytes};
    if(diagnosticConsoleSha256!==originalConsoleSha256){
      result.status='exact-witness-divergence';
      result.divergence={position:pos(latest.position),actual:diagnosticConsoleSha256,
        expected:originalConsoleSha256,reason:'diagnostic guest output differs from original runtime at the sealed frontier'};
      return result;
    }
    if(!latest.firstBlockFailure){
      result.status='exact-witness-divergence';
      result.divergence={position:pos(latest.position),
        actual:latest.digest,expected:checkpoints.at(-1).digest,
        outputSha256:latest.consoleSha256,
        reason:'the source vda/EXT4 error reproduced without a completed first S_IOERR'};
      return result;
    }
    need(coarseFailure&&same(coarseFailure.failure,latest.firstBlockFailure),
      'first error changed while advancing to the authenticated frontier');
    result.coarseFailure=coarseFailure;
    localBaseReads+=latest.localBaseReads;
    coarse.worker.terminate();activeWorker=null;
    const repeat=await createOwner('diagnostic');activeWorker=repeat.worker;
    let repeated=repeat.view;
    for(let count=0;count<32&&!repeated.firstBlockFailure;count++){
      const remaining=limit-BigInt(repeated.position.transition);
      need(remaining>0n,'repeat owner missed the sealed error interval');
      const steps=Number(remaining<1048576n?remaining:1048576n);
      const response=await request(repeat.worker,'advance',
        {steps,stopOnFailure:true},10*60*1000);
      need((response.advanced>0||response.view.firstBlockFailure)
        &&response.advanced<=steps&&!response.view.guestHalt,
        'repeat owner halted or failed to advance before first block rejection');
      repeated=response.view;
    }
    const exact=await request(repeat.worker,'inspect',{},30000);
    need(repeated.firstBlockFailure
      &&same(pos(exact.view.position),pos(repeated.position))
      &&same(exact.view.firstBlockFailure,latest.firstBlockFailure)
      &&exact.view.firstBlockFailure.statusDmaWritten===true
      &&exact.view.firstBlockFailure.usedRingCommitted===true
      &&/^[0-9a-f]{64}$/.test(exact.view.firstBlockFailure.guestWitnessDigest)
      &&/^[0-9a-f]{64}$/.test(exact.view.firstBlockFailure.ramDigest)
      &&BigInt(exact.view.firstBlockFailure.eventPosition.transition)
        >=BigInt(input.targetCheckpoint.transition)
      &&BigInt(exact.view.firstBlockFailure.eventPosition.transition)
        <=BigInt(exact.view.position.transition),
      'repeat owner changed the first completed block-error witness');
    need(BigInt(exact.view.firstBlockFailure.eventPosition.transition)
        <BigInt(input.errorReceipt.transition)
      &&exact.view.firstBlockFailure.type===1,
      'first completed rejection is not a pre-serial-error block write');
    need(same(pos(exact.view.position),coarseFailure.observedAt),
      'repeat failure was observed at a different host poll boundary');
    localBaseReads+=exact.view.localBaseReads;
    repeat.worker.terminate();activeWorker=null;
    const control=await createOwner('original');activeWorker=control.worker;
    let controlView=control.view;
    while(BigInt(controlView.position.transition)
      <BigInt(coarseFailure.observedAt.transition)){
      const remaining=BigInt(coarseFailure.observedAt.transition)
        -BigInt(controlView.position.transition);
      const steps=Number(remaining<1048576n?remaining:1048576n);
      const response=await request(control.worker,'advance',
        {steps,stopOnFailure:false},10*60*1000);
      need(response.advanced===steps&&!response.view.guestHalt,
        'original failure-boundary control owner stopped early');
      controlView=response.view;
    }
    const controlled=await request(control.worker,'inspect',{},30000);
    controlView=controlled.view;
    const sourceAtFailure=input.sourceReceipts.filter(row=>
      BigInt(row.position.sequence)<=BigInt(controlView.position.sequence));
    need(same(pos(controlView.position),pos(exact.view.position))
      &&controlView.digest===exact.view.digest
      &&controlView.pendingSha256===exact.view.pendingSha256
      &&controlView.outputSha256===exact.view.outputSha256
      &&controlView.consoleSha256===exact.view.consoleSha256
      &&controlView.eventDigest===exact.view.eventDigest
      &&controlView.payloadDigest===exact.view.payloadDigest
      &&same(controlView.eventRows,sourceAtFailure)
      &&same(controlView.eventRows,exact.view.eventRows),
      'original and diagnostic owners differ at the first failure host boundary');
    const boundaryOperand=view=>({position:pos(view.position),digest:view.digest,
      pendingSha256:view.pendingSha256,outputSha256:view.outputSha256,
      consoleSha256:view.consoleSha256,consoleBytes:view.consoleBytes,
      eventDigest:view.eventDigest,payloadDigest:view.payloadDigest,
      eventCount:view.eventCount,payloadCount:view.payloadCount,
      eventRows:view.eventRows});
    result.failureControl={position:pos(controlView.position),
      eventRamSha256:exact.view.firstBlockFailure.ramDigest,
      sourceEventRows:sourceAtFailure,
      originalRuntime:boundaryOperand(controlView),
      diagnostic:boundaryOperand(exact.view)};
    localBaseReads+=controlView.localBaseReads;
    control.worker.terminate();activeWorker=null;
    result.firstFailure={position:pos(exact.view.firstBlockFailure.eventPosition),
      digest:exact.view.firstBlockFailure.guestWitnessDigest,
      observedAfter:{position:pos(exact.view.position),digest:exact.view.digest},
      request:exact.view.firstBlockFailure,
      bracketStart:coarseBracket,repeatOwnerDigest:exact.view.digest};
    const rejected=result.firstFailure.request;
    need(rejected.stage==='TransferShape'
      &&BigInt(rejected.requestedBytes)>BigInt(rejected.maxTransferBytes)
      &&rejected.range?.status==='in-range'
      &&rejected.backendError===null
      &&rejected.overlayBefore===rejected.overlayAfter,
      'first completed rejection is not the observed pre-backend transfer-cap refusal');
    result.classification={path:'virtio-blk-pre-backend-transfer-cap',
      requestedBytes:rejected.requestedBytes,maxTransferBytes:rejected.maxTransferBytes,
      excessBytes:(BigInt(rejected.requestedBytes)
        -BigInt(rejected.maxTransferBytes)).toString(),
      backendCalled:false,diskRange:rejected.range,
      cowSectorsBefore:rejected.overlayBefore,cowSectorsAfter:rejected.overlayAfter};
    const after=latest;
    const match=after.console.match(/I\/O error, dev vda, sector ([0-9]+) op 0x([0-9a-f]+):\(([^)]+)\)/);
    need(match,'the first rejected descriptor did not yield a bounded kernel vda error');
    const ext4=after.console.match(/EXT4-fs warning \(device vda\):[^\r\n]*I\/O error[^\r\n]*/);
    need(ext4&&after.console.indexOf(match[0])<after.console.indexOf(ext4[0]),
      'first vda error lacks a following EXT4 write-error witness');
    const errorRow=after.eventRows.find(row=>
      row.channel===21&&row.sha256===input.errorReceipt.sha256);
    need(errorRow&&errorRow.position.transition===input.errorReceipt.transition
      &&errorRow.bytesLength===input.errorReceipt.bytesLength,
      'guest vda/EXT4 lines lack the sealed exact serial receipt');
    result.guestError={position:pos(errorRow.position),
      receiptSha256:errorRow.sha256,observedAt:pos(after.position),
      observedDigest:after.digest,
      sector:match[1],operation:match[3],line:match[0],ext4:ext4[0],
      consoleTail:after.console.slice(-2048)};
    need(result.guestError.sector===result.firstFailure.request.sector
      &&result.guestError.sector===input.sourceErrorSector
      &&result.guestError.operation==='WRITE'
      &&result.guestError.line===input.sourceErrorLine
      &&result.guestError.ext4===input.sourceExt4Line,
      'first block rejection does not match the original kernel error sector');
    need(after.offline===true&&after.egress.fetch===0&&after.egress.sockets===0,
      'private owner attempted live egress');
    result.egress=after.egress;
    result.status='block-error-attributed';
    return result;
  }finally{
    if(activeWorker){
      try{const last=await request(activeWorker,'inspect',{},30000);
        localBaseReads+=last.view.localBaseReads;
        result.egress=last.view.egress;}
      catch{}activeWorker.terminate();
    }
    result.localBaseReads=localBaseReads;
    await store.close();
  }
}
