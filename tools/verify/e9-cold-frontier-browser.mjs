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
assert(/^[1-9][0-9]*$/.test(limit)&&BigInt(limit)>21700000000n&&BigInt(limit)<=25200000000n);
const baseReportFile=await fs.realpath(path.resolve(argument('--base-report')));
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
assert.equal(git('status','--porcelain'),'','freeze exact calibration harness');
let offlineBase=null;
{
  const reportBytes=await fs.readFile(baseReportFile),base=JSON.parse(reportBytes);
  assert.equal(base.task,'E9-T22o');
  assert.equal(base.status,'authenticated-complete');
  assert.equal(base.manifestSha256,'8a793846f109a08242688fa32d531f230d7a3e2a7bdb3c694dbfc1abb70367a8');
  assert.equal(base.uniqueChunks,34687);
  const indexBytes=await fs.readFile(path.join(path.dirname(baseReportFile),'index.json'));
  assert.equal(sha(indexBytes),base.indexSha256,'offline base cache index changed');
  const cache=await fs.realpath(base.cache);
  const manifestBytes=await fs.readFile(path.join(root,'target/e9-workload-base-cache',
    'manifest-'+base.manifestSha256+'.json'));
  assert.equal(sha(manifestBytes),base.manifestSha256,'frozen original base manifest changed');
  const image=JSON.parse(manifestBytes);
  assert.equal(image.image_len,12884901888);assert.equal(image.chunk_size,262144);
  const ids=[...new Set(image.chunks)].sort();assert.equal(ids.length,34687);
  const index=JSON.parse(indexBytes);
  assert.equal(index.length,ids.length);
  assert.deepEqual(index.map(row=>row.sha256).sort(),ids,'offline cache does not cover original manifest');
  assert.deepEqual((await fs.readdir(cache)).sort(),ids.map(id=>id+'.bin').sort(),
    'offline cache has missing or extra members');
  const files=new Map();
  for(const row of index){
    assert.equal(row.bytes,262144);
    const file=path.join(cache,row.sha256+'.bin'),stat=await fs.lstat(file);
    assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===262144,
      'offline base member shape '+row.sha256);
    assert.equal(sha(await fs.readFile(file)),row.sha256,
      'offline base member differs from original image '+row.sha256);
    files.set(row.sha256,file);
  }
  offlineBase={files,reportSha256:sha(reportBytes),indexSha256:base.indexSha256,
    manifestSha256:base.manifestSha256,cache,uniqueChunks:ids.length,
    bytes:String(ids.length*262144)};
}
assert.equal(sourceReport.status,'cold-prefix-frontier');
assert.equal(sourceReport.result.final.transition,'21700000000');
assert.equal(sourceReport.result.frontier.reason,'host-space-admission');
assert.equal(recovery.status,'recovered-prefix-passed');
assert.equal(recovery.source.head,'720f53afe0153a2425e4f01a607ab16c5705fa6b');
assert.equal(recovery.source.treeSha256Before,recovery.source.treeSha256After);
assert.equal(priorClosure.status,'retained-closure-passed');
assert.equal(priorOracle.status,'exact-v3-prefix-passed');
assert.equal(archive.stores.sessions.length,1);
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
    staticRequests:[],blockedRequests:[],blockedSockets:[],pageErrors:[],localBaseReads:[]},
  offlineBase:offlineBase?{reportSha256:offlineBase.reportSha256,
    indexSha256:offlineBase.indexSha256,manifestSha256:offlineBase.manifestSha256,
    uniqueChunks:offlineBase.uniqueChunks,bytes:offlineBase.bytes}:null,
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
  await page.exposeFunction('readOfflineBase',async ref=>{
    assert(offlineBase,'offline base cache was not provided');
    assert(/^[0-9a-f]{64}$/.test(ref?.sha256)&&ref?.length==='262144',
      'offline base request shape');
    const file=offlineBase.files.get(ref.sha256);
    assert(file,'offline base request is outside original image');
    const bytes=await fs.readFile(file);
    assert.equal(bytes.length,262144,'offline base length changed');
    assert.equal(sha(bytes),ref.sha256,'offline base bytes changed since preflight');
    report.browser.localBaseReads.push({sha256:ref.sha256,length:bytes.length,
      source:'frozen-image-manifest-verified-local-file'});
    return bytes.toString('base64');
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
    const {createFencedRpc,formatRpcCommand}=await import('/guest-rpc.js');
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
        if(value.type==='need-base'){
          (async()=>{
            need(Number.isInteger(value.token)&&value.token>0,
              'offline base request token');
            const base64=await globalThis.readOfflineBase(value.ref);
            const binary=atob(base64),bytes=new Uint8Array(binary.length);
            for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
            need(String(bytes.length)===value.ref.length
              &&checkpointHash(bytes)===value.ref.sha256,
              'offline base IPC bytes changed');
            worker.postMessage({type:'base-reply',requestId,token:value.token,
              ref:value.ref,bytes},[bytes.buffer]);
          })().catch(error=>worker.postMessage({type:'base-error',requestId,
            token:value.token,message:String(error.stack??error)}));
          return;
        }
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
      await globalThis.frontierProgress({stage:'replay-capture',
        position:pos(captured.position),sourceDigest:hex(captured.capture.sourceDigest),
        rendererSha256:captured.renderer.sha256,
        rendererBytesSha256:checkpointHash(captured.renderer.bytes),
        inspectedRendererSha256:checkpointHash(inspection.renderer.bytes)});
      need(same(pos(captured.position),pos(last.position))
        &&hex(captured.capture.sourceDigest)===input.finalDigest
        &&checkpointHash(captured.renderer.bytes)===captured.renderer.sha256
        &&checkpointHash(captured.renderer.bytes)===checkpointHash(inspection.renderer.bytes),
        'captured private branch differs from authenticated replay');
    }finally{replayWorker.terminate();}
    const configuration=structuredClone(metadata.configuration);
    if(input.baseManifestSha256)
      need(checkpointHash(new TextEncoder().encode(configuration.imageManifest))
        ===input.baseManifestSha256,
      'retained session image differs from offline pinned base manifest');
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
    await globalThis.frontierProgress({stage:'captured-payload-hashes',...inputHashes});
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
    const guestProbe=async(worker,tag,from,deadline,minDraws=0)=>{
      const rid='e9frontier'+tag;
      const command=`e9_sddm_pid=$(systemctl show sddm.service -p MainPID --value 2>/dev/null) || e9_sddm_pid=ERR; `+
        `e9_sddm_active=$(systemctl show sddm.service -p ActiveState --value 2>/dev/null) || e9_sddm_active=ERR; `+
        `e9_hypr_pid=$(pgrep -xo Hyprland 2>/dev/null) || e9_hypr_pid=0; `+
        `e9_hypr_uid=-1; e9_user_state=none; `+
        `if test "$e9_hypr_pid" -gt 0 2>/dev/null; then `+
        `e9_hypr_uid=$(stat -c %u "/proc/$e9_hypr_pid" 2>/dev/null) || e9_hypr_uid=ERR; `+
        `if test "$e9_hypr_uid" != ERR; then `+
        `e9_user_state=$(loginctl show-user "$e9_hypr_uid" -p State --value 2>/dev/null) || e9_user_state=ERR; fi; fi; `+
        `e9_sessions_raw=$(loginctl list-sessions --no-legend --no-pager 2>/dev/null) || e9_sessions_raw=ERR; `+
        `if test "$e9_sessions_raw" = ERR; then e9_sessions=ERR; else `+
        `e9_sessions=$(printf '%s\\n' "$e9_sessions_raw" | awk 'NF{n++} END{print n+0}'); fi; `+
        `printf 'E9_SDDM_PID=%s\\nE9_SDDM_ACTIVE=%s\\nE9_HYPR_PID=%s\\nE9_HYPR_UID=%s\\nE9_HYPR_USER_STATE=%s\\nE9_SESSION_COUNT=%s\\n' `+
        `"$e9_sddm_pid" "$e9_sddm_active" "$e9_hypr_pid" "$e9_hypr_uid" "$e9_user_state" "$e9_sessions"`;
      const bytes=new TextEncoder().encode(formatRpcCommand(command,rid));
      const inputBytes=bytes.length;
      const sent=await request(worker,'input',{bytes},30000,[bytes.buffer]);
      need(sent.view.offline&&sent.view.egress.fetch===0&&sent.view.egress.sockets===0,
        'guest process probe attempted egress');
      const probe={kind:'post-continuation-diagnostic-input',
        sentAt:pos(from.position),bytes:inputBytes,command,steps:0,
        status:'pending',stdout:null,exit:null,position:null};
      let last=sent.view;
      for(let index=0;index<48&&Date.now()<deadline-30000;index++){
        const parsed=createFencedRpc(rid).feed(last.console);
        if(parsed&&probe.status!=='guest-response'){
          probe.status='guest-response';probe.stdout=parsed.stdout;probe.exit=parsed.exit;
        }
        if(probe.status==='guest-response'
          &&presentation.snapshot().drawnPresents>minDraws)break;
        const response=await request(worker,'advance',{steps:1048576},
          Math.min(10*60*1000,deadline-Date.now()-30000));
        probe.steps+=1048576;last=response.view;
        need(last.offline&&last.egress.fetch===0&&last.egress.sockets===0,
          'guest process probe attempted egress');
        if(last.frameChanged||last.firstCandidate)sample(last);
        if(last.guestHalt){probe.status='guest-halt-before-response';break;}
      }
      const witnessed=await request(worker,'inspect',{},30000);
      need(same(pos(witnessed.view.position),pos(last.position))
        &&/^[0-9a-f]{64}$/.test(witnessed.view.digest),
      'guest process observation lacks a same-position exact witness');
      last=witnessed.view;probe.digest=last.digest;
      probe.position=pos(last.position);
      probe.gpu=last.gpu;probe.presentation=presentation.snapshot();
      probe.consoleTail=last.console.slice(-8192);
      if(probe.status==='pending')probe.status='no-response-within-50m-steps';
      if(probe.status==='guest-response'){
        const lines=probe.stdout.trim().split('\n');
        const schema=['E9_SDDM_PID','E9_SDDM_ACTIVE','E9_HYPR_PID',
          'E9_HYPR_UID','E9_HYPR_USER_STATE','E9_SESSION_COUNT'];
        need(probe.exit===0&&lines.length===schema.length,
          'guest process probe missing or extra fields');
        const fields={};
        for(let index=0;index<schema.length;index++){
          const [name,...parts]=lines[index].split('=');
          need(name===schema[index]&&parts.length===1&&parts[0]
            &&parts[0]!=='ERR','guest process probe field '+schema[index]);
          fields[name]=parts[0];
        }
        need(/^(0|[1-9][0-9]*)$/.test(fields.E9_SDDM_PID)
          &&/^[a-z-]+$/.test(fields.E9_SDDM_ACTIVE)
          &&/^(0|[1-9][0-9]*)$/.test(fields.E9_HYPR_PID)
          &&/^(-1|0|[1-9][0-9]*)$/.test(fields.E9_HYPR_UID)
          &&/^[a-z-]+$/.test(fields.E9_HYPR_USER_STATE)
          &&/^(0|[1-9][0-9]*)$/.test(fields.E9_SESSION_COUNT),
        'guest process probe invalid field value');
        need((fields.E9_HYPR_PID==='0')===
          (fields.E9_HYPR_UID==='-1'&&fields.E9_HYPR_USER_STATE==='none'),
        'guest process probe inconsistent Hyprland identity');
        probe.process={sddmPid:Number(fields.E9_SDDM_PID),
          sddmState:fields.E9_SDDM_ACTIVE,
          sddmActive:fields.E9_SDDM_ACTIVE==='active',
          hyprlandPid:Number(fields.E9_HYPR_PID),
          hyprlandUid:Number(fields.E9_HYPR_UID),
          hyprlandUserState:fields.E9_HYPR_USER_STATE,
          sessions:Number(fields.E9_SESSION_COUNT)};
      }
      return {probe,last};
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
      await globalThis.frontierProgress({stage:'prepared-private-branch',
        origin:prepared.origin,offline:prepared.view.offline,egress:prepared.view.egress});
      need(same(pos(prepared.origin.position),pos(last.position)),
        'private branch source position changed');
      need(prepared.origin.digest===input.finalDigest,'private branch logical digest changed');
      need(prepared.origin.nativeSha256===inputHashes.native
        &&prepared.origin.pendingSha256===inputHashes.pending
        &&prepared.origin.outputSha256===inputHashes.output
        &&prepared.origin.diskSha256===inputHashes.disk,
      'private branch captured payload changed');
      need(prepared.origin.sourceRendererSha256===inputHashes.renderer
        &&prepared.origin.sourceRendererEpoch===captured.renderer.epoch
        &&/^[0-9a-f]{64}$/.test(prepared.origin.rendererSha256)
        &&prepared.origin.rendererEpoch!==captured.renderer.epoch
        &&prepared.origin.physical?.sourceSha256===inputHashes.renderer
        &&prepared.origin.physical?.rebasedSha256===prepared.origin.rendererSha256
        &&prepared.origin.physical?.changedLogicalFields.every(key=>
          ['epoch','scanout'].includes(key)),
      'private branch renderer source or rebase changed');
      need(prepared.view.offline===true
        &&prepared.view.egress.fetch===0&&prepared.view.egress.sockets===0,
      'private branch network policy changed');
      result.origin=prepared.origin;
      if(sample(prepared.view))result.status='candidate-needs-guest-proof';
      const active=await request(continuation,'activate',{},30*60*1000);
      need(same(pos(active.view.position),pos(prepared.origin.position))
        &&active.view.digest===prepared.origin.digest
        &&active.view.offline===true&&active.view.egress.fetch===0
        &&active.view.egress.sockets===0,'diagnostic network policy changed');
      if(sample(active.view))result.status='candidate-needs-guest-proof';
      let previous=BigInt(last.position.transition),nextProgress=previous+10000000n;
      const started=Date.now(),maxWallMs=2*60*60*1000,deadline=started+maxWallMs;
      const inspectTimeout=()=>{
        const remaining=deadline-Date.now();
        need(remaining>1000,'diagnostic wall budget cannot fit exact witness inspection');
        return Math.min(30000,remaining-1000);
      };
      let lastView=active.view,wallLimited=false;
      while(previous<BigInt(input.limit)&&result.status==='running'){
        const remaining=deadline-Date.now();
        if(remaining<=10*60*1000+30000){wallLimited=true;break;}
        const steps=Number((BigInt(input.limit)-previous)<1048576n
          ?BigInt(input.limit)-previous:1048576n);
        const response=await request(continuation,'advance',{steps},
          Math.min(10*60*1000,remaining-30000));
        const current=BigInt(response.view.position.transition);
        need(current>=previous&&current<=BigInt(input.limit),'bounded monotonic continuation');
        need(response.view.offline===true&&response.view.egress.fetch===0
          &&response.view.egress.sockets===0,'offline guest attempted network egress');
        previous=current;lastView=response.view;
        if(sample(response.view)){
          result.status='candidate-needs-guest-proof';break;
        }
        if(response.view.guestHalt){
          const halted=await request(continuation,'inspect',{},inspectTimeout());
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
        const ended=await request(continuation,'inspect',{},inspectTimeout());
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
      const unmodifiedWallMs=Date.now()-started;
      if(result.status==='candidate-needs-guest-proof'||result.status==='bounded-no-frame'){
        const candidateBeforeProbe=result.frameCandidate;
        const drawsBeforeProbe=presentation.snapshot().drawnPresents;
        const {probe,last}=await guestProbe(continuation,
          candidateBeforeProbe?'candidate':'limit',lastView,deadline,
          candidateBeforeProbe?drawsBeforeProbe:0);
        result.diagnosticInput=probe;lastView=last;
        if(candidateBeforeProbe){
          result.frameCandidate=candidateBeforeProbe;
          const process=probe.process;
          if(probe.status==='guest-response'&&probe.exit===0
            &&process?.sddmActive&&process.sddmPid>1
            &&process.hyprlandPid>1&&process.hyprlandUid>=0
            &&['active','online'].includes(process.hyprlandUserState)
            &&process.sessions>0
            &&presentation.snapshot().drawnPresents>drawsBeforeProbe){
            const secondFrame={position:pos(lastView.position),
              presentation:presentation.snapshot()};
            const alive=await guestProbe(continuation,'alive',lastView,deadline);
            result.diagnosticInput={session:probe,afterSecondFrame:alive.probe};
            lastView=alive.last;
            const still=alive.probe.process;
            if(alive.probe.status==='guest-response'&&alive.probe.exit===0
              &&still?.sddmActive&&still.sddmPid===process.sddmPid
              &&still.hyprlandPid===process.hyprlandPid
              &&still.hyprlandUid===process.hyprlandUid){
              result.frame={...candidateBeforeProbe,sessionProof:probe,
                secondFrame,stillAlive:alive.probe};
              result.status='first-frame';
            }
          }else{
            result.status='candidate-needs-guest-proof';
          }
          if(result.status!=='first-frame'){
            const inspected=await request(continuation,'inspect',{},inspectTimeout());
            need(same(pos(inspected.view.position),pos(lastView.position)),
              'diagnostic owner advanced after failed candidate inspection');
            result.status='exact-failure-frontier';
            result.frontier={reason:'candidate-lacks-live-desktop-proof',
              position:pos(lastView.position),digest:inspected.view.digest,
              candidate:candidateBeforeProbe,processProbe:result.diagnosticInput,
              gpu:lastView.gpu,presentation:presentation.snapshot(),
              consoleTail:lastView.console.slice(-8192)};
          }
        }else if(probe.status==='guest-response'&&probe.exit===0){
          result.diagnosticCandidateAfterInput=result.frameCandidate;
          result.frameCandidate=null;
          result.frontier.processProbe=probe;
          result.frontier.processStateTiming='observed only after the unmodified '
            +'finite bound and diagnostic serial input; not exact state at the bound';
        }
      }
      result.egress=lastView.egress;
      result.localBaseReads=lastView.localBaseReads;
      const retained=await store.statistics();
      need(same(retained,statistics),'diagnostic continuation changed saved parent');
      result.authenticated.retentionAfter=retained;
      const end=result.frame?.positionUpperBound.transition
        ??result.frontier?.position.transition;
      result.measured={start:last.position.transition,end,
        guestTransitions:(BigInt(end)
          -BigInt(last.position.transition)).toString(),
        unmodifiedWallMs,diagnosticWallMs:Date.now()-started-unmodifiedWallMs};
    }finally{continuation.terminate();presentation.dispose();await store.close();}
    return result;
  },{database:sourceReport.result.database,id:sourceReport.result.sessionId,
    manifestSha256:sourceReport.result.authenticatedHistory.manifestSha256,
    statistics:sourceReport.result.retentionAtEnd,finalDigest:sourceReport.result.final.digest,
    replayedStateSha256:sourceReport.result.replay.windows[1].stateArtifact.sha256,
    replayedRendererSha256:recovery.artifacts.find(row=>row.file==='replay-window-1.renderer').sha256,
    objects:3523,chunks:13177,retainedObjects:archive.stores.objects.map(row=>row.key),
    limit,diagnosticWorker:diagnostic,nextRequest:0,
    baseManifestSha256:offlineBase?.manifestSha256??null});
  assert(['exact-failure-frontier','first-frame'].includes(report.result.status),
    'a color candidate needs guest session proof; a mere numeric cap needs a concrete obstruction');
  assert.equal(report.browser.blockedRequests.length,0,'no blocked continuation requests');
  assert.equal(report.browser.blockedSockets.length,0,'no attempted continuation sockets');
  assert.equal(report.browser.pageErrors.length,0,'no browser page errors');
  assert.equal(report.result?.localBaseReads,report.browser.localBaseReads.length,
    'offline base IPC receipt count changed');
  report.status=report.result.status;
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
  try{if(page)await page.screenshot({path:path.join(out,'screen.png'),fullPage:true});}
  catch(error){report.screenshotError=String(error.message);}
  if(traceStarted)try{await context.tracing.stop({path:path.join(out,'browser-trace.zip')});}
    catch(error){report.traceError=String(error.message);}
  for(const name of ['screen.png','browser-trace.zip']){
    try{const bytes=await fs.readFile(path.join(out,name));
      report.browser[name]={bytes:bytes.length,sha256:sha(bytes)};}
    catch(error){report.browser[name]={error:String(error.message)};}
  }
  await context?.close().catch(error=>{report.contextCloseError=String(error.message);});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.hostFreeBytesAfter=await freeBytes(out);
  report.storage={hostFreeBytesBefore:report.hostFreeBytesBefore,
    hostFreeBytesAfter:report.hostFreeBytesAfter,
    hostUsedBytesDelta:(BigInt(report.hostFreeBytesBefore)
      -BigInt(report.hostFreeBytesAfter)).toString(),
    offlineBaseUniqueBytes:offlineBase?.bytes??'0'};
  report.source.recoveredTreeSha256After=await treeDigest(source);
  if(report.source.recoveredTreeSha256After!==sourceTreeBefore){
    report.status='failed';report.sourceChanged=true;process.exitCode=1;
  }
  report.finished=new Date().toISOString();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,output:out,failure:report.failure,
    frontier:report.result?.frontier?.reason,frame:report.result?.frame?.position}));
}
