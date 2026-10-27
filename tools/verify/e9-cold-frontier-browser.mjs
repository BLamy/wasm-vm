#!/usr/bin/env node
// E9-T22o: calibrate only from the sealed exact cold prefix in an offline owner.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const args=process.argv.slice(2),argument=name=>{
  const at=args.indexOf(name);assert(at>=0&&args[at+1],name);return args[at+1];
};
const root=path.resolve(import.meta.dirname,'../..'),web=path.join(root,'web/dist');
const source=await fs.realpath(path.resolve(argument('--source')));
const requestedOut=path.resolve(argument('--output'));
const out=path.join(await fs.realpath(path.dirname(requestedOut)),path.basename(requestedOut));
const limit=argument('--limit');
assert(/^[1-9][0-9]*$/.test(limit)&&BigInt(limit)>21700000000n&&BigInt(limit)<=23000000000n);
assert(out!==source&&!out.startsWith(source+path.sep),'source and output must be separate');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const treeDigest=async directory=>{
  const whole=createHash('sha256');
  const visit=async(relative='')=>{
    for(const name of (await fs.readdir(path.join(directory,relative))).sort()){
      const next=path.join(relative,name),full=path.join(directory,next),stat=await fs.lstat(full);
      if(stat.isDirectory()){whole.update('d\0'+next+'\0');await visit(next);}
      else if(stat.isSymbolicLink())whole.update('l\0'+next+'\0'+await fs.readlink(full)+'\0');
      else{assert(stat.isFile(),'unexpected source evidence type '+next);
        const file=createHash('sha256');for await(const part of createReadStream(full))file.update(part);
        whole.update('f\0'+next+'\0'+String(stat.size)+'\0'+file.digest('hex')+'\0');}
    }
  };
  await visit();return whole.digest('hex');
};
const freeBytes=async directory=>{
  const stat=await fs.statfs(directory);
  return String(BigInt(stat.bavail)*BigInt(stat.bsize));
};
const git=(...values)=>execFileSync('git',values,{cwd:root,encoding:'utf8'}).trim();
const PIN={
  report:'0d2d37842f96a7d9b203a420d6debec108f982322a562838605c56d2b74ab17f',
  recovery:'a5f79826020bf0858cae9211204338ed481aae15e7eff3a7de60f3aeed00e7d8',
  storage:'3f6b6d4282023372d3b7c7f5bf59d5eed7828e4d36d952eff79dd9ab63872035',
  closure:'81fbecf6c138652d5cf533cd32fbe576c1f4133562864e395664f76cf28f6677',
  byteOracle:'bf77383a441d5c0edf5d3959852126c99b266ae9eaf5cc713d1cf7c67caaf3c5',
};
const readPinned=async(file,digest)=>{
  const bytes=await fs.readFile(path.join(source,file));
  assert.equal(sha(bytes),digest,'changed cold graph input '+file);return bytes;
};
const sourceReport=JSON.parse(await readPinned('report.json',PIN.report));
const recovery=JSON.parse(await readPinned('recovery-report.json',PIN.recovery));
const archive=JSON.parse(await readPinned('saved/storage.json',PIN.storage));
const priorClosure=JSON.parse(await readPinned('retained-closure/report.json',PIN.closure));
const priorOracle=JSON.parse(await readPinned('cold-prefix-byte-oracle/report.json',PIN.byteOracle));
assert.equal(sourceReport.status,'cold-prefix-frontier');
assert.equal(sourceReport.result.final.transition,'21700000000');
assert.equal(sourceReport.result.frontier.reason,'host-space-admission');
assert.equal(recovery.status,'recovered-prefix-passed');
assert.equal(recovery.source.head,'720f53afe0153a2425e4f01a607ab16c5705fa6b');
assert.equal(recovery.source.treeSha256Before,recovery.source.treeSha256After);
assert.equal(priorClosure.status,'retained-closure-passed');
assert.equal(priorOracle.status,'exact-v3-prefix-passed');
assert.equal(archive.stores.sessions.length,1);
assert.equal(git('status','--porcelain'),'','freeze exact calibration harness');
const sourceTreeBefore=await treeDigest(source);
await fs.mkdir(out,{recursive:false});
const report={task:'E9-T22o',status:'running',scope:'Offline exact 21.7B cold desktop diagnostic continuation; no qualification or timing claim',
  source:{directory:source,pins:PIN,sourceHead:recovery.source.head,
    recoveredHead:recovery.head,failedAt:recovery.source.failedAt,
    originalTreeSha256:recovery.source.treeSha256Before,
    recoveredTreeSha256Before:sourceTreeBefore},
  sourceGuestAtFrontier:{serialShell:sourceReport.result.serialShell,
    networkService:sourceReport.result.networkServiceBefore,
    serviceOrdering:sourceReport.result.serviceOrdering,
    desktopCandidates:sourceReport.result.desktopCandidates,
    guestConsoleTail:sourceReport.result.frontier.consoleTail},
  head:git('rev-parse','HEAD'),limit,started:new Date().toISOString(),
  browser:{origin:recovery.browser.origin,version:null,sourceVersion:recovery.browser.version,
    staticRequests:[],blockedRequests:[],blockedSockets:[],pageErrors:[]},
  preflight:{},progress:[],result:null};
let context,page,traceStarted=false,server;
try{
  report.hostFreeBytesBefore=await freeBytes(out);
  // The two independent accepted oracles run against symlinked, read-only
  // source inputs. Their new proof directories live only in this output.
  const view=path.join(out,'input-view');await fs.mkdir(view);
  for(const name of ['report.json','saved','initial.state','final.state',
    'replay-window-0.state','replay-window-1.state'])
    await fs.symlink(path.join(source,name),path.join(view,name));
  const oracle=(command,values)=>execFileSync(command,values,{cwd:root,encoding:'utf8',
    stdio:['ignore','pipe','pipe'],timeout:45*60*1000});
  report.preflight.closure=oracle('node',['tools/verify/e9-workload-retained-closure.mjs',
    '--directory',view,'--prefix']).trim();
  report.preflight.byteOracle=oracle('python3',['-B','tools/verify/e9-cold-prefix-files.py',
    '--directory',view]).trim();
  const freshClosure=JSON.parse(await fs.readFile(path.join(view,'retained-closure/report.json')));
  const freshOracle=JSON.parse(await fs.readFile(path.join(view,'cold-prefix-byte-oracle/report.json')));
  assert.equal(freshClosure.status,'retained-closure-passed');
  assert.equal(freshClosure.objects,3523);assert.equal(freshClosure.chunks,13177);
  assert.equal(freshClosure.browserSha256,PIN.report);
  assert.equal(freshOracle.status,'exact-v3-prefix-passed');
  assert.equal(freshOracle.checkpoints,435);
  assert.equal(freshOracle.finalWitness,sourceReport.result.final.digest);
  report.preflight.closureSha256=sha(await fs.readFile(path.join(view,'retained-closure/report.json')));
  report.preflight.byteOracleSha256=sha(await fs.readFile(path.join(view,'cold-prefix-byte-oracle/report.json')));
  const pins=new Map();
  for(const row of [...sourceReport.served,...sourceReport.replayStaticAssets]){
    if(pins.has(row.name))assert.equal(pins.get(row.name),row.sha256,'changed source asset pin');
    pins.set(row.name,row.sha256);
  }
  const diagnostic='/__verify__/e9-cold-frontier-worker.mjs';
  const workerSource=await fs.readFile(path.join(root,'tools/verify/e9-cold-frontier-worker.mjs'));
  pins.set(diagnostic,sha(workerSource));report.diagnosticWorkerSha256=sha(workerSource);
  for(const [name,digest]of pins){
    assert(name.startsWith('/')&&!name.includes('..'));
    if(name===diagnostic)continue;
    assert.equal(sha(await fs.readFile(path.join(web,'.'+name))),digest,
      'recovered replay runtime changed '+name);
  }
  const origin=new URL(recovery.browser.origin);
  assert.equal(origin.hostname,'127.0.0.1');
  const mime=new Map([['.js','text/javascript'],['.mjs','text/javascript'],
    ['.wasm','application/wasm'],['.json','application/json'],['.css','text/css']]);
  server=createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,origin).pathname;
      assert.equal(req.method,'GET');
      if(name==='/'){
        res.writeHead(200,{'Content-Type':'text/html','Cross-Origin-Opener-Policy':'same-origin',
          'Cross-Origin-Embedder-Policy':'require-corp'}).end('<!doctype html><title>Offline cold frontier</title><link rel="icon" href="data:,">');
        return;
      }
      assert(pins.has(name),'unsealed diagnostic asset '+name);
      const bytes=name===diagnostic?workerSource:await fs.readFile(path.join(web,'.'+name));
      assert.equal(sha(bytes),pins.get(name),'diagnostic asset changed '+name);
      res.writeHead(200,{'Content-Type':mime.get(path.extname(name))??'application/octet-stream',
        'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin',
        'Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch(error){res.writeHead(500).end(String(error));}
  });
  await new Promise((resolve,reject)=>server.once('error',reject)
    .listen(Number(origin.port),origin.hostname,resolve));
  const profile=path.join(out,'chrome-profile');
  execFileSync('cp',['-cR',path.join(source,'chrome-profile'),profile],
    {stdio:['ignore','pipe','pipe']});
  context=await chromium.launchPersistentContext(profile,{headless:true,
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],serviceWorkers:'block',
    viewport:{width:1200,height:900}});
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin.origin||request.method()!=='GET'||url.search
      ||url.pathname!=='/'&&!pins.has(url.pathname)){
      report.browser.blockedRequests.push({url:url.href,method:request.method()});
      return route.abort();
    }
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
  const version=await(await context.newCDPSession(page)).send('Browser.getVersion');
  report.browser.version=version.product.slice('Chrome/'.length);
  await page.exposeFunction('frontierProgress',async value=>{
    report.progress.push(value);if(report.progress.length>128)report.progress.shift();
    await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(value,null,2)+'\n');
    console.log(JSON.stringify(value));
  });
  await page.goto(origin.origin+'/');
  report.result=await page.evaluate(async input=>{
    const need=(value,message)=>{if(!value)throw Error('cold frontier: '+message);};
    const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const pos=value=>Object.fromEntries(['transition','retired','sequence','phase','ordinal'].map(key=>[key,value[key]]));
    const {SessionStore}=await import('/session-store.js');
    const {SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js');
    const {checkpointHash,readCheckpointObject}=await import('/session-checkpoints.js');
    const {decodeGpuExactFrame}=await import('/session-gpu-replay-format.js');
    const {isKeyframeDescriptorPrefix,decodeKeyframeDescriptor}=await import('/session-keyframes.js');
    const {branchOrigin}=await import('/session-branch-format.js');
    const {PresentationController}=await import('/src/sink/presentation.js');
    const store=await SessionStore.open(input.database);
    const opened=await store.openSession(input.id);
    need(opened&&checkpointHash(opened.manifest)===input.manifestSha256,
      'cloned profile manifest differs from authenticated export');
    const statistics=await store.statistics();
    need(same(statistics,input.statistics),'cloned profile retention counters differ');
    const manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    const metadata=await SessionGpuHistoryReader.withOpen(store,input.id,{},async reader=>reader.metadata);
    need(metadata.storageAuthenticated&&metadata.checkpoints.length===435
      &&metadata.session.manifestSha256===input.manifestSha256,
      'complete saved witness graph failed authentication');
    const anchor=manifest.checkpoints.at(-3),last=manifest.checkpoints.at(-1);
    need(anchor.id==='cold-431'&&anchor.position.transition==='21600000000'
      &&last.id==='cold-433'&&last.position.transition==='21700000000',
      'chosen exact replay source and target');
    const bytes=await readCheckpointObject(store,last.machine,256*1048576);
    const ref=isKeyframeDescriptorPrefix(bytes.subarray(0,8))?decodeKeyframeDescriptor(bytes).frame:null;
    const frame=decodeGpuExactFrame(ref?await readCheckpointObject(store,ref,256*1048576):bytes);
    need(frame.meta.stateSha256===input.finalDigest&&frame.meta.position.transition==='21700000000'
      &&frame.meta.rendererSha256===last.gpu.sha256,'last witness and renderer binding');
    const request=(worker,type,data={},timeout=30*60*1000,transfer=[])=>new Promise((resolve,reject)=>{
      // The replay worker binds inspect/capture to the original seek owner;
      // only the diagnostic worker allocates a new ID for each action.
      const requestId=data.requestId??++input.nextRequest;let done=false;
      const expected=type==='seek'?'ready':type==='inspect-selected'?'selected-inspection'
        :type==='capture-branch'?'branch-captured':'result';
      const cleanup=()=>{done=true;clearTimeout(timer);worker.removeEventListener('message',message);
        worker.removeEventListener('error',error);};
      const fail=value=>{if(done)return;cleanup();reject(value);};
      const message=event=>{const value=event.data;if(value.requestId!==requestId)return;
        if(value.type==='progress')return;
        if(value.type==='error'||value.type==='inspection-error'||value.type==='branch-error'){
          const failure=Error(value.stack??value.message);failure.detail=value;fail(failure);return;}
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
    const replayWorker=new Worker('/session-gpu-replay-worker.js',{type:'module'});
    let captured,replayed,inspection;
    try{
      await initialized(replayWorker);
      replayed=await request(replayWorker,'seek',{database:input.database,sessionId:input.id,
        checkpointId:anchor.id,target:pos(last.position),quantum:4096},60*60*1000);
      need(replayed.digest===input.finalDigest&&same(pos(replayed.position),pos(last.position))
        &&replayed.replay?.paged===true&&replayed.replay.windows===2
        &&replayed.replay.wholeChain===true,'21.7B two-window replay differs');
      inspection=await request(replayWorker,'inspect-selected',
        {requestId:replayed.requestId,inspectionId:1},30*60*1000);
      need(checkpointHash(inspection.state)===input.replayedStateSha256
        &&checkpointHash(inspection.renderer.bytes)===input.replayedRendererSha256,
        'selected raw CPU/device or renderer state changed');
      captured=await request(replayWorker,'capture-branch',
        {requestId:replayed.requestId,captureId:1},30*60*1000);
      need(same(pos(captured.position),pos(last.position))
        &&hex(captured.capture.sourceDigest)===input.finalDigest
        &&checkpointHash(captured.renderer.bytes)===hex(captured.renderer.sha256),
        'captured private branch differs from authenticated replay');
    }finally{replayWorker.terminate();}
    const configuration=structuredClone(metadata.configuration);
    configuration.branchOrigin=branchOrigin({parentId:input.id,
      parentManifestSha256:input.manifestSha256,sourceDigestSha256:input.finalDigest,
      position:last.position,consolePrefix:captured.consolePrefix});
    const assets={};
    for(const role of ['kernel','wasm']){
      const ref=manifest.assets.find(row=>row.role===role)?.content;
      need(ref,'retained '+role+' missing');
      assets[role]=await readCheckpointObject(store,ref,64*1048576);
    }
    const inputHashes={native:checkpointHash(captured.capture.native),
      pending:checkpointHash(captured.capture.pending),output:checkpointHash(captured.capture.output),
      disk:checkpointHash(captured.capture.disk),renderer:checkpointHash(captured.renderer.bytes)};
    const continuation=new Worker(input.diagnosticWorker,{type:'module'});
    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
    canvas.setAttribute('aria-label','Offline Omarchy frontier');document.body.append(canvas);
    let presentation=new PresentationController(canvas,{scheduleFrames:false});
    const pixels=await import('/omarchy-desktop-readiness.js');
    const result={status:'running',sourcePosition:pos(last.position),sourceDigest:input.finalDigest,
      authenticated:{manifestSha256:input.manifestSha256,statistics,objects:input.objects,
        chunks:input.chunks,witnesses:metadata.witnesses,receipts:metadata.receipts},
      replay:{position:pos(replayed.position),digest:replayed.digest,windows:replayed.replay.windows,
        wholeChain:replayed.replay.wholeChain,rawStateSha256:checkpointHash(inspection.state),
        rendererSha256:checkpointHash(inspection.renderer.bytes)},
      capture:inputHashes,origin:null,frameCandidate:null,frame:null,frontier:null,progress:[],
      diagnosticInput:null,egress:{fetch:0,sockets:0}};
    const paint=frame=>{
      const before=presentation.snapshot().drawnPresents;
      need(presentation.present(frame)
        &&presentation.snapshot().drawnPresents>before,
      'physical continuation frame could not be painted');
    };
    const sample=view=>{
      if(view.firstCandidate)paint(view.firstCandidate);
      else if(view.frameChanged&&view.frame)paint(view.frame);
      else if(view.frameChanged&&!view.frame){
        presentation.dispose();canvas.width=1;canvas.height=1;
        presentation=new PresentationController(canvas,{scheduleFrames:false});
      }
      if(!view.firstCandidate&&(!view.frameChanged||!view.frame))return false;
      const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
      if(!pixels.hasDesktopPixels(image.data)){
        need(!view.firstCandidate,'raw first-frame candidate failed physical presentation');
        return false;
      }
      const shown=view.firstCandidate??view.frame;
      need(shown?.observedAt&&shown?.bracketStart
        &&BigInt(shown.bracketStart.transition)<=BigInt(shown.observedAt.transition)
        &&BigInt(shown.observedAt.transition)<=BigInt(view.position.transition),
        'physical frame position is outside its advance');
      result.frameCandidate={positionUpperBound:pos(shown.observedAt),
        positionLowerBound:pos(shown.bracketStart),observedAt:pos(view.position),
        coordinatePrecision:'presentation observed after at most 4096 guest transitions; not an exact event coordinate',
        width:canvas.width,height:canvas.height,
        rgbaSha256:checkpointHash(image.data),presentation:presentation.snapshot(),
        gpu:view.gpu,consoleTail:view.console.slice(-4096)};
      return true;
    };
    try{
      await initialized(continuation);
      const kernel=assets.kernel.slice(),wasm=assets.wasm.slice();
      const sourceRenderer=captured.renderer,sourceCapture=captured.capture;
      const transfer=[kernel,wasm,sourceRenderer.bytes,
        ...Object.values(sourceCapture).filter(value=>value instanceof Uint8Array)]
        .map(bytes=>bytes.buffer);
      const prepared=await request(continuation,'prepare',{database:input.database,
        configuration,kernel,wasm,capture:sourceCapture,renderer:sourceRenderer,
        retainedObjects:input.retainedObjects},
      45*60*1000,[...new Set(transfer)]);
      need(same(prepared.origin.position,pos(last.position))
        &&prepared.origin.digest===input.finalDigest
        &&prepared.origin.nativeSha256===inputHashes.native
        &&prepared.origin.rendererSha256===inputHashes.renderer
        &&prepared.origin.pendingSha256===inputHashes.pending
        &&prepared.origin.outputSha256===inputHashes.output
        &&prepared.origin.diskSha256===inputHashes.disk
        &&prepared.view.offline===true
        &&prepared.view.egress.fetch===0&&prepared.view.egress.sockets===0,
        'private branch origin changed');
      result.origin=prepared.origin;
      if(sample(prepared.view))result.status='candidate-needs-guest-proof';
      const active=await request(continuation,'activate',{},30*60*1000);
      need(same(pos(active.view.position),prepared.origin.position)
        &&active.view.digest===prepared.origin.digest
        &&active.view.offline===true&&active.view.egress.fetch===0
        &&active.view.egress.sockets===0,'diagnostic network policy changed');
      if(sample(active.view))result.status='candidate-needs-guest-proof';
      let previous=BigInt(last.position.transition),nextProgress=previous+10000000n;
      const started=Date.now(),maxWallMs=2*60*60*1000;
      let lastView=active.view,wallLimited=false;
      while(previous<BigInt(input.limit)&&result.status==='running'){
        const remaining=maxWallMs-(Date.now()-started);
        if(remaining<=10*60*1000+30000){wallLimited=true;break;}
        const steps=Number((BigInt(input.limit)-previous)<1048576n
          ?BigInt(input.limit)-previous:1048576n);
        let response;
        try{response=await request(continuation,'advance',{steps},Math.min(10*60*1000,remaining));}
        catch(error){
          if(!error.detail?.missingLocalBlock)throw error;
          const stopped=await request(continuation,'inspect',{},30*60*1000);
          need(stopped.view.egress.fetch===0&&stopped.view.egress.sockets===0,
            'offline guest attempted network egress');
          need(stopped.view.digest&&stopped.missingLocalBlock?.code==='MissingObject',
            'missing base object must have an exact witness and storage code');
          result.status='exact-failure-frontier';
          result.frontier={reason:'unretained-disk-chunk',
            message:error.message,missingLocalBlock:error.detail?.missingLocalBlock??stopped.missingLocalBlock,
            position:pos(stopped.view.position),digest:stopped.view.digest,
            consoleTail:stopped.view.console.slice(-8192),
            gpu:stopped.view.gpu,outstanding:stopped.view.outstanding,
            presentation:presentation.snapshot()};
          break;
        }
        const current=BigInt(response.view.position.transition);
        need(current>=previous&&current<=BigInt(input.limit),'bounded monotonic continuation');
        need(response.view.offline===true&&response.view.egress.fetch===0
          &&response.view.egress.sockets===0,'offline guest attempted network egress');
        previous=current;lastView=response.view;
        if(sample(response.view)){
          result.status='candidate-needs-guest-proof';break;
        }
        if(response.view.guestHalt){
          const halted=await request(continuation,'inspect',{},30*60*1000);
          need(halted.view.digest&&same(pos(halted.view.position),pos(response.view.position)),
            'guest halt lacks same-position witness');
          result.status='exact-failure-frontier';
          result.frontier={reason:'guest-halt',position:pos(response.view.position),
            digest:halted.view.digest,guestHalt:response.view.guestHalt,
            consoleTail:response.view.console.slice(-8192),
            gpu:response.view.gpu,outstanding:response.view.outstanding,
            presentation:presentation.snapshot()};
          break;
        }
        if(current>=nextProgress){
          const progress={transition:String(current),elapsedMs:Date.now()-started,
            gpu:response.view.gpu,presentation:presentation.snapshot(),
            consoleTail:response.view.console.slice(-1024),batch:response.batch};
          result.progress.push(progress);await globalThis.frontierProgress(progress);
          nextProgress=current+10000000n;
        }
      }
      if(result.status==='running'){
        const ended=await request(continuation,'inspect',{},30*60*1000);
        result.status='bounded-no-frame';
        need(same(pos(ended.view.position),pos(lastView.position)),
          'diagnostic owner advanced after last accepted view');
        result.frontier={reason:wallLimited?'finite-wall-limit':'finite-transition-limit',
          position:pos(ended.view.position),
          digest:ended.view.digest,consoleTail:ended.view.console.slice(-8192),
          gpu:ended.view.gpu,outstanding:ended.view.outstanding,
          presentation:presentation.snapshot()};
        lastView=ended.view;
      }
      result.egress=lastView.egress;
      const retained=await store.statistics();
      need(same(retained,statistics),'diagnostic continuation changed saved parent');
      result.authenticated.retentionAfter=retained;
      const end=result.frameCandidate?.positionUpperBound.transition
        ??result.frontier?.position.transition;
      result.measured={start:last.position.transition,end,
        guestTransitions:(BigInt(end)
          -BigInt(last.position.transition)).toString(),wallMs:Date.now()-started};
    }finally{continuation.terminate();presentation.dispose();await store.close();}
    return result;
  },{database:sourceReport.result.database,id:sourceReport.result.sessionId,
    manifestSha256:sourceReport.result.authenticatedHistory.manifestSha256,
    statistics:sourceReport.result.retentionAtEnd,finalDigest:sourceReport.result.final.digest,
    replayedStateSha256:sourceReport.result.replay.windows[1].stateArtifact.sha256,
    replayedRendererSha256:recovery.artifacts.find(row=>row.file==='replay-window-1.renderer').sha256,
    objects:3523,chunks:13177,retainedObjects:archive.stores.objects.map(row=>row.key),
    limit,diagnosticWorker:diagnostic,nextRequest:0});
  assert(['exact-failure-frontier','bounded-no-frame'].includes(report.result.status),
    'nonblank pixels require guest SDDM/Hyprland session proof before desktop classification');
  assert.equal(report.browser.blockedRequests.length,0,'no blocked continuation requests');
  assert.equal(report.browser.blockedSockets.length,0,'no attempted continuation sockets');
  assert.equal(report.browser.pageErrors.length,0,'no browser page errors');
  report.status=report.result.status;
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
  try{if(page)await page.screenshot({path:path.join(out,'screen.png'),fullPage:true});}
  catch(error){report.screenshotError=String(error.message);}
  if(traceStarted)try{await context.tracing.stop({path:path.join(out,'browser-trace.zip')});}
    catch(error){report.traceError=String(error.message);}
  await context?.close().catch(error=>{report.contextCloseError=String(error.message);});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.hostFreeBytesAfter=await freeBytes(out);
  report.source.recoveredTreeSha256After=await treeDigest(source);
  if(report.source.recoveredTreeSha256After!==sourceTreeBefore){
    report.status='failed';report.sourceChanged=true;process.exitCode=1;
  }
  report.finished=new Date().toISOString();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,output:out,failure:report.failure,
    frontier:report.result?.frontier?.reason,frame:report.result?.frame?.position}));
}
