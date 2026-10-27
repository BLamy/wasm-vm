#!/usr/bin/env node
// Finish and interrogate a durably committed original-cold prefix after a
// fail-closed HostSpace admission. Sealing does not step the source VM;
// the subsequent two time-travel replay windows do execute the saved guest.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const args=process.argv.slice(2),flag=name=>{
  const at=args.indexOf(name);assert(at>=0&&args[at+1],name);return path.resolve(args[at+1]);
};
const sourceDir=flag('--source'),out=flag('--output');
assert(!out.startsWith(sourceDir+path.sep),'recovery must not mutate original evidence');
const root=path.resolve(import.meta.dirname,'../..'),web=path.join(root,'web/dist');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const treeDigest=async directory=>{
  const whole=createHash('sha256');
  const visit=async(relative='')=>{
    const entries=(await fs.readdir(path.join(directory,relative))).sort();
    for(const name of entries){const next=path.join(relative,name),full=path.join(directory,next),stat=await fs.lstat(full);
      if(stat.isDirectory()){whole.update('d\0'+next+'\0');await visit(next);}
      else if(stat.isSymbolicLink())whole.update('l\0'+next+'\0'+await fs.readlink(full)+'\0');
      else{assert(stat.isFile(),'unexpected source evidence type '+next);
        const file=createHash('sha256');for await(const chunk of createReadStream(full))file.update(chunk);
        whole.update('f\0'+next+'\0'+String(stat.size)+'\0'+file.digest('hex')+'\0');}
    }
  };
  await visit();return whole.digest('hex');
};
const git=(...values)=>execFileSync('git',values,{cwd:root,encoding:'utf8'}).trim();
const sourceBytes=await fs.readFile(path.join(sourceDir,'report.json')),source=JSON.parse(sourceBytes);
const archiveBytes=await fs.readFile(path.join(sourceDir,'saved/storage.json'));
const archive=JSON.parse(archiveBytes),session=archive.stores.sessions.find(row=>row.key==='full-original-omarchy');
const oldManifestBytes=Buffer.from(session?.value.manifest??[]),oldManifest=JSON.parse(oldManifestBytes);
const last=oldManifest.checkpoints.at(-1),before=oldManifest.checkpoints.at(-2),earlier=oldManifest.checkpoints.at(-3);
const sourceSeal=JSON.parse(await fs.readFile(path.join(sourceDir,'sealed-before-execution.json')));
const origin=new URL(sourceSeal.origin);
assert.equal(origin.hostname,'127.0.0.1');
assert.equal(source.task,'E9-T22r');
assert.equal(source.status,'failed');
assert.equal(source.head,'720f53afe0153a2425e4f01a607ab16c5705fa6b');
assert.match(source.result?.error??'',/CapacityPreflightError: HostSpace:/);
assert.equal(source.result?.failurePosition?.transition,'21750000000');
assert.equal(source.result?.checkpoints?.at(-1)?.transition,last.position.transition);
assert.equal(last.position.transition,'21700000000');
assert.equal(oldManifest.end.transition,last.position.transition);
assert.equal(oldManifest.checkpoints.length,source.result.checkpoints.length+1);
assert.equal(oldManifest.checkpoints.length,435);
assert.equal(source.result.retentionAtEnd.chunks,archive.stores.chunks.length);
assert.equal(source.result.retentionAtEnd.objects,archive.stores.objects.length);
const oldCommitment=JSON.parse(Buffer.from(oldManifest.extensions.find(row=>row.kind==='e9-exact-witness-pages-v2').bytes));
assert.equal(oldCommitment.finished,false);
assert.equal(oldCommitment.count,oldManifest.checkpoints.length);
assert.deepEqual(Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,oldCommitment.last[key]])),last.position);
assert.equal(Buffer.from(oldCommitment.last.digest).toString('hex'),source.result.checkpoints.at(-1).digest);
const oldClosure=JSON.parse(await fs.readFile(path.join(sourceDir,'retained-closure/report.json')));
assert.equal(oldClosure.status,'retained-closure-passed');
assert.equal(oldClosure.browserSha256,sha(sourceBytes));
assert.equal(oldClosure.objects,archive.stores.objects.length);
assert.equal(oldClosure.chunks,archive.stores.chunks.length);
assert.equal(oldClosure.references,archive.stores.objects.length);
assert.equal(oldClosure.witnessPages,oldCommitment.pages);
const sourceTreeBefore=await treeDigest(sourceDir);

const pins=new Map([...source.served,...source.replayStaticAssets].map(row=>[row.name,row.sha256]));
for(const [name,digest]of pins){
  assert(name.startsWith('/')&&!name.includes('..'));
  assert.equal(sha(await fs.readFile(path.join(web,'.'+name))),digest,'source runtime asset changed '+name);
}
assert.equal(git('status','--porcelain'),'','freeze recovery source');
await fs.mkdir(out,{recursive:false});
const report={task:'E9-T22r',status:'running',scope:'Seal a saved original-cold checkpoint, then replay it; no fresh cold boot',
  source:{directory:sourceDir,reportSha256:sha(sourceBytes),storageSha256:sha(archiveBytes),
    manifestSha256:sha(oldManifestBytes),head:source.head,failedAt:source.result.failurePosition,
    error:source.result.error,treeSha256Before:sourceTreeBefore},head:git('rev-parse','HEAD'),started:new Date().toISOString(),
  browser:{origin:origin.origin,version:null,staticRequests:[],blockedRequests:[],blockedSockets:[],pageErrors:[]},
  artifacts:[]};
const mime=new Map([['.js','text/javascript'],['.mjs','text/javascript'],['.wasm','application/wasm'],
  ['.json','application/json'],['.css','text/css']]);
const server=createServer(async(req,res)=>{
  try{
    const name=new URL(req.url,origin).pathname;
    if(name==='/'){res.writeHead(200,{'Content-Type':'text/html','Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp'}).end('<!doctype html><title>Exact cold prefix recovery</title><link rel="icon" href="data:,">');
      return;}
    assert.equal(req.method,'GET');assert(pins.has(name),'unsealed recovery asset '+name);
    const bytes=await fs.readFile(path.join(web,'.'+name));
    assert.equal(sha(bytes),pins.get(name),'changed recovery asset '+name);
    res.writeHead(200,{'Content-Type':mime.get(path.extname(name))??'application/octet-stream',
      'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  }catch(error){res.writeHead(500).end(String(error));}
});
let context,page,answer,recovered,successful=false,traceStarted=false;
try{
  await new Promise((resolve,reject)=>server.once('error',reject).listen(Number(origin.port),origin.hostname,resolve));
  const sourceProfile=path.join(sourceDir,'chrome-profile'),recoveryProfile=path.join(out,'chrome-profile');
  execFileSync('cp',['-cR',sourceProfile,recoveryProfile],{stdio:['ignore','pipe','pipe']});
  context=await chromium.launchPersistentContext(recoveryProfile,{headless:true,
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],serviceWorkers:'block',
    viewport:{width:1200,height:900}});
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin.origin||request.method()!=='GET'||url.search
      ||url.pathname!=='/'&&!pins.has(url.pathname)){
      report.browser.blockedRequests.push({url:url.href,method:request.method()});return route.abort();}
    if(url.pathname!=='/')report.browser.staticRequests.push({name:url.pathname,sha256:pins.get(url.pathname)});
    return route.continue();
  });
  await context.routeWebSocket('**/*',socket=>{
    report.browser.blockedSockets.push(socket.url());socket.close();
  });
  await context.tracing.start({screenshots:true,snapshots:false,sources:true});traceStarted=true;
  page=await context.newPage();page.setDefaultTimeout(0);
  page.on('pageerror',error=>report.browser.pageErrors.push(String(error.stack??error)));
  page.on('console',message=>{if(message.type()==='error')report.browser.pageErrors.push(message.text());});
  const workers=[],closed=new Set();
  page.on('worker',worker=>{
    if(new URL(worker.url()).pathname==='/session-gpu-replay-worker.js'){
      workers.push(worker);worker.on('close',()=>closed.add(worker));}
  });
  await page.exposeFunction('retainRecoveryArtifact',async(name,encoded)=>{
    assert(/^(final|replay-window-[01])\.state$/.test(name));
    assert(typeof encoded==='string'&&encoded.length<=64*1048576);
    const bytes=Buffer.from(encoded,'base64');
    assert.equal(bytes.toString('base64'),encoded);
    await fs.writeFile(path.join(out,name),bytes,{flag:'wx'});
    const row={file:name,bytes:bytes.length,sha256:sha(bytes)};
    report.artifacts.push(row);return row;
  });
  await page.exposeFunction('auditReplayWorker',async()=>{
    const live=workers.filter(worker=>!closed.has(worker));
    return Promise.all(live.map(async worker=>({
      url:worker.url(),factoryEntries:await worker.evaluate(async()=>{
        const {WasmLinux}=await import('/pkg/wasm_vm_wasm.js');
        return WasmLinux.ownedLocalHttpFactoryEntries();
      })})));
  });
  const version=await(await context.newCDPSession(page)).send('Browser.getVersion');
  report.browser.version=version.product.slice('Chrome/'.length);
  report.browser.sourceVersion=source.browser;
  report.browser.versionChanged=report.browser.version!==source.browser;
  await page.goto(origin.origin+'/');
  answer=await page.evaluate(async input=>{
    const need=(value,reason)=>{if(!value)throw Error('cold prefix recovery: '+reason);};
    const pos=value=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,value[key]]));
    const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const encode=value=>new TextEncoder().encode(JSON.stringify(value));
    const b64=bytes=>{let text='';for(let at=0;at<bytes.length;at+=16384)
      text+=String.fromCharCode(...bytes.subarray(at,at+16384));return btoa(text);};
    const {SessionStore}=await import('/session-store.js');
    const {SessionGpuJournal}=await import('/session-gpu-journal.js');
    const {SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js');
    const {openGpuTimelineReplay}=await import('/session-gpu-replay.js');
    const {readCheckpointObject,checkpointHash}=await import('/session-checkpoints.js');
    const {decodeKeyframeDescriptor,isKeyframeDescriptorPrefix}=await import('/session-keyframes.js');
    const {decodeGpuExactFrame}=await import('/session-gpu-replay-format.js');
    const {SessionSha256}=await import('/session-pkg/wasm_vm_session.js');
    const {WasmLinux}=await import('/pkg/wasm_vm_wasm.js');
    const {decodeCheckpointData,encodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs');
    const store=await SessionStore.open(input.database);
    const frameFor=async point=>{
      const machine=await readCheckpointObject(store,point.machine,256*1048576);
      const ref=isKeyframeDescriptorPrefix(machine.subarray(0,8))?decodeKeyframeDescriptor(machine).frame:null;
      return decodeGpuExactFrame(ref?await readCheckpointObject(store,ref,256*1048576):machine);
    };
    const latches=bytes=>{const marker=new TextEncoder().encode('WVGPULG2');
      for(let at=0;at+marker.length+3<=bytes.length;at++)
        if(marker.every((value,index)=>bytes[at+index]===value))
          return [bytes[at+9],bytes[at+10]];
      throw Error('logical GPU notification latches missing');
    };
    const witness=(raw,ramDigest)=>{
      const hash=new SessionSha256(),size=new Uint8Array(8);
      new DataView(size.buffer).setBigUint64(0,BigInt(raw.length),true);
      try{hash.update(new TextEncoder().encode('wasm-vm-gpu-guest-state-v1\0'));
        hash.update(size);hash.update(raw);
        hash.update(Uint8Array.from(ramDigest.match(/../g),part=>parseInt(part,16)));
        return hash.finish();
      }finally{hash.free();}
    };
    const beforeStats=await store.statistics(),opened=await store.openSession(input.id);
    need(opened&&checkpointHash(opened.manifest)===input.oldManifestSha256,'original profile/export manifest identity');
    need(same(beforeStats,input.stats),'original profile/export retention counters');
    const manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    need(same(manifest.checkpoints.slice(-3).map(point=>point.position),input.points),
      'source last adjacent checkpoint positions');
    const commitment=JSON.parse(new TextDecoder().decode(Uint8Array.from(
      manifest.extensions.find(row=>row.kind==='e9-exact-witness-pages-v2').bytes)));
    need(commitment.finished===false&&same(pos(commitment.last),pos(input.points[2])),
      'unfinished last durable witness');
    const finalFrame=await frameFor(manifest.checkpoints.at(-1));
    need(same(pos(finalFrame.meta.position),pos(input.points[2]))
      &&finalFrame.meta.stateSha256===hex(commitment.last.digest)
      &&finalFrame.meta.stateSha256===input.finalDigest
      &&finalFrame.meta.rendererSha256===manifest.checkpoints.at(-1).gpu.sha256,
      'last original live keyframe binds saved witness and renderer');
    need(witness(finalFrame.native,finalFrame.meta.ramSha256)===input.finalDigest,
      'independent saved native-state witness');
    need(same(latches(finalFrame.native),input.finalLatches),'original live notification latches');
    const finalState=await globalThis.retainRecoveryArtifact('final.state',b64(finalFrame.native));
    const writer=await store.writer(input.id);
    try{
      const journal=new SessionGpuJournal(store,writer,manifest,input.configuration);
      await journal.completeExactPaged({...commitment.last,digest:Uint8Array.from(commitment.last.digest)});
    }finally{await writer.release();}
    const post=await store.openSession(input.id),postStats=await store.statistics();
    need(same(postStats,beforeStats),'recovery changed CAS or retention counters');
    const sealed=JSON.parse(new TextDecoder().decode(post.manifest));
    const committed=JSON.parse(new TextDecoder().decode(Uint8Array.from(
      sealed.extensions.find(row=>row.kind==='e9-exact-witness-pages-v2').bytes)));
    need(committed.finished===true&&committed.count===commitment.count
      &&committed.pages===commitment.pages&&same(committed.tail,commitment.tail)
      &&same(committed.first,commitment.first)&&same(committed.last,commitment.last),
      'only witness completion flag changed');
    const expected=structuredClone(manifest);
    expected.extensions.find(row=>row.kind==='e9-exact-witness-pages-v2').bytes=
      [...encode({...commitment,finished:true})];
    need(same(sealed,expected),'recovery changed original history');
    const metadata=await SessionGpuHistoryReader.withOpen(store,input.id,{},async reader=>reader.metadata);
    need(metadata.storageAuthenticated&&metadata.checkpoints.length===manifest.checkpoints.length
      &&metadata.witnesses===commitment.count&&metadata.receipts===input.receipts,
      'finished profile graph authentication');
    const factoryBefore=WasmLinux.ownedLocalHttpFactoryEntries();
    const nativeFetch=globalThis.fetch,nativeSocket=globalThis.WebSocket;
    const egress={fetch:0,sockets:0},windows=[];
    globalThis.fetch=(...values)=>{egress.fetch++;throw Error('live fetch during recovered replay '+String(values[0]));};
    globalThis.WebSocket=class extends nativeSocket{constructor(...values){egress.sockets++;
      throw Error('live socket during recovered replay '+String(values[0]));}};
    let controller,workerAudit,physical;
    try{
      const replay=await openGpuTimelineReplay({store,id:input.id,configuration:metadata.configuration});
      controller=replay.controller;
      const points=manifest.checkpoints.slice(-3);
      for(let index=0;index<2;index++){
        const from=points[index],to=points[index+1];
        const result=await controller.seekFromCheckpoint(from.id,to.position);
        need(result.status==='ready'&&result.rendered.digest===input.digests[index+1]
          &&result.rendered.replay?.paged===true
          &&result.rendered.replay.eventCursor===Number(to.position.sequence),
          'adjacent replay witness/cursor '+index);
        const inspection=await controller.inspectSelected(),sourceFrame=await frameFor(to);
        need(checkpointHash(inspection.state)===checkpointHash(sourceFrame.native)
          &&same(latches(inspection.state),input.latchPairs[index+1]),
          'adjacent replay exact state/latches '+index);
        need(checkpointHash(inspection.queues.pending)===checkpointHash(sourceFrame.pending)
          &&checkpointHash(inspection.queues.output)===checkpointHash(sourceFrame.output),
          'adjacent replay host queues '+index);
        const artifact=await globalThis.retainRecoveryArtifact('replay-window-'+index+'.state',b64(inspection.state));
        windows.push({from:from.id,to:to.id,position:pos(result.position),digest:result.rendered.digest,
          expected:input.digests[index+1],replay:result.rendered.replay,requestId:result.requestId,
          logicalLatches:latches(inspection.state),state:artifact,stateArtifact:artifact,
          renderer:{sha256:checkpointHash(inspection.renderer.bytes),bytes:inspection.renderer.bytes.length}});
        if(index===1){
          const sourceBytes=await readCheckpointObject(store,to.gpu,256*1048576);
          const source=decodeCheckpointData(sourceBytes.subarray(16,-32));
          const actual=decodeCheckpointData(inspection.renderer.bytes.subarray(16,-32));
          const data=value=>encodeCheckpointData(value);
          need(checkpointHash(data(source.profile))===checkpointHash(data(actual.profile)),
            'replay physical renderer profile');
          need(checkpointHash(data(source.logical))===
            checkpointHash(data({...actual.logical,epoch:source.logical.epoch})),
            'replay physical renderer logical state');
          need(checkpointHash(data(source.frames))===checkpointHash(data(actual.frames.slice(1))),
            'replay physical renderer frame chain');
          physical={source:checkpointHash(sourceBytes),replay:checkpointHash(inspection.renderer.bytes),
            epoch:source.logical.epoch,profile:true,logical:true,frames:true};
        }
      }
      workerAudit=await globalThis.auditReplayWorker();
      need(workerAudit.length===1&&workerAudit[0].factoryEntries==='0','replay worker provider closed');
    }finally{controller?.close();globalThis.fetch=nativeFetch;globalThis.WebSocket=nativeSocket;}
    need(egress.fetch===0&&egress.sockets===0,'replay page egress');
    need(WasmLinux.ownedLocalHttpFactoryEntries()===factoryBefore,'replay page provider closed');
    await store.close();
    return {oldManifestSha256:checkpointHash(opened.manifest),
      newManifestSha256:checkpointHash(post.manifest),newManifest:Array.from(post.manifest),
      revision:post.revision,beforeStats,postStats,
      final:{...pos(commitment.last),digest:input.finalDigest,ramDigest:finalFrame.meta.ramSha256,
        logicalLatches:latches(finalFrame.native),state:finalState},
      authenticatedHistory:{storageAuthenticated:metadata.storageAuthenticated,
        receipts:metadata.receipts,witnesses:metadata.witnesses,windows:metadata.receiptWindows,
        receiptDigest:metadata.receiptDigest,manifestSha256:metadata.session.manifestSha256},
      replay:{windows,final:{position:pos(commitment.last),digest:windows.at(-1).digest}},
      replayEgress:egress,workerAudit,physical};
  },{database:source.result.database,id:session.key,oldManifestSha256:sha(oldManifestBytes),
    stats:source.result.retentionAtEnd,points:[earlier.position,before.position,last.position],
    finalDigest:source.result.checkpoints.at(-1).digest,
    finalLatches:source.result.checkpoints.at(-1).logicalLatches,
    digests:source.result.checkpoints.slice(-3).map(row=>row.digest),
    latchPairs:source.result.checkpoints.slice(-3).map(row=>row.logicalLatches),
    receipts:source.result.receipts,configuration:source.result.configuration});
  const newManifest=Buffer.from(answer.newManifest);
  assert.equal(sha(newManifest),answer.newManifestSha256);
  assert.equal(answer.oldManifestSha256,sha(oldManifestBytes));
  const updated=structuredClone(archive);
  updated.stores.sessions[updated.stores.sessions.findIndex(row=>row.key===session.key)].value={
    ...session.value,revision:answer.revision,manifest:[...newManifest]};
  const saved=path.join(out,'saved');await fs.mkdir(saved);
  execFileSync('cp',['-cR',path.join(sourceDir,'saved/chunks'),path.join(saved,'chunks')],
    {stdio:['ignore','pipe','pipe']});
  await fs.writeFile(path.join(saved,'storage.json'),JSON.stringify(updated,null,2)+'\n');
  for(const row of source.raw)execFileSync('cp',['-c',path.join(sourceDir,row.file),path.join(out,row.file)],
    {stdio:['ignore','pipe','pipe']});
  recovered=structuredClone(source);
  recovered.status='cold-prefix-frontier';
  recovered.result.status='cold-prefix-frontier';
  recovered.result.phase='post-replay';
  recovered.result.sessionId=session.key;
  recovered.result.recordingFailure={error:source.result.error,
    position:source.result.failurePosition,state:source.result.failureState};
  delete recovered.result.error;delete recovered.result.failurePosition;delete recovered.result.failureState;
  recovered.result.final=answer.final;
  recovered.result.frontier={reason:'host-space-admission',position:last.position,
    failurePosition:source.result.failurePosition,hasDesktopPixels:false,
    consoleTail:source.result.console.slice(-2048)};
  recovered.result.authenticatedHistory=answer.authenticatedHistory;
  recovered.result.replay=answer.replay;
  recovered.result.replayEgress=answer.replayEgress;
  recovered.result.workerProviderAudit=answer.workerAudit;
  recovered.result.recoveryPhysical=answer.physical;
  recovered.raw=[...source.raw,...report.artifacts];
  recovered.recovery={kind:'seal-last-durable-original-cold-checkpoint',
    sourceReportSha256:sha(sourceBytes),sourceStorageSha256:sha(archiveBytes),
    sourceManifestSha256:sha(oldManifestBytes),sourceHead:source.head,
    recoveryHead:report.head,sourceStatus:'failed',sourceFailure:source.result.error,
    sourceFailurePosition:source.result.failurePosition,frontierPosition:last.position,
    sealingGuestSteps:0,replayGuestExecution:true,noFreshColdBoot:true,sourceProfileCloned:true,
    sourceBrowser:source.browser,recoveryBrowser:report.browser.version,
    browserVersionChanged:report.browser.versionChanged,
    originalObjects:archive.stores.objects.length,originalChunks:archive.stores.chunks.length,
    oldStats:answer.beforeStats,newStats:answer.postStats,
    newManifestSha256:answer.newManifestSha256};
  recovered.failure=undefined;
  recovered.savedClosure=undefined;
  recovered.browserStorageAfter=source.browserStorageAfter;
  recovered.replayBlockedRequests=report.browser.blockedRequests;
  recovered.replayBlockedSockets=report.browser.blockedSockets;
  recovered.recoveryStaticRequests=report.browser.staticRequests;
  assert.deepEqual(report.browser.blockedRequests,[]);
  assert.deepEqual(report.browser.blockedSockets,[]);
  assert.deepEqual(report.browser.pageErrors,[]);
  assert.deepEqual(answer.replayEgress,{fetch:0,sockets:0});
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
  const cleanup=[];
  try{if(traceStarted)await context.tracing.stop({path:path.join(out,'browser-trace.zip')});}
  catch(error){cleanup.push('trace: '+String(error.stack??error));}
  try{await context?.close();}catch(error){cleanup.push('context: '+String(error.stack??error));}
  try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  catch(error){cleanup.push('server: '+String(error.stack??error));}
  try{report.source.treeSha256After=await treeDigest(sourceDir);
    assert.equal(report.source.treeSha256After,sourceTreeBefore,'original cold evidence changed during recovery');}
  catch(error){cleanup.push('source immutability: '+String(error.stack??error));}
  try{
    if(recovered&&!report.error&&!cleanup.length){
      const trace=await fs.readFile(path.join(out,'browser-trace.zip'));
      const traceArtifact={file:'browser-trace.zip',bytes:trace.length,sha256:sha(trace)};
      recovered.recovery.browserTrace=traceArtifact;
      recovered.recovery.sourceTreeSha256Before=sourceTreeBefore;
      recovered.recovery.sourceTreeSha256After=report.source.treeSha256After;
      const pending=path.join(out,'report.json.pending');
      await fs.writeFile(pending,JSON.stringify(recovered,null,2)+'\n');
      await fs.rename(pending,path.join(out,'report.json'));
      report.newManifestSha256=answer.newManifestSha256;
      report.replay=answer.replay;report.physical=answer.physical;
      report.browserTrace=traceArtifact;successful=true;
    }
  }catch(error){cleanup.push('publish: '+String(error.stack??error));}
  if(cleanup.length){report.cleanupErrors=cleanup;report.error=[report.error,...cleanup].filter(Boolean).join('\n');}
  report.status=successful?'recovered-prefix-passed':'failed';
  if(!successful)process.exitCode=1;
  report.finished=new Date().toISOString();
  const pending=path.join(out,'recovery-report.json.pending');
  await fs.writeFile(pending,JSON.stringify(report,null,2)+'\n');
  await fs.rename(pending,path.join(out,'recovery-report.json'));
  if(!successful)console.error(report.error);
  console.log(JSON.stringify({status:report.status,source:sourceDir,output:out,
    manifestSha256:report.newManifestSha256,error:report.error}));
}
