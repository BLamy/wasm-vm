#!/usr/bin/env node
// Browser consumer proof over separately retained, actual production GPU histories.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),args={};
for(let i=2;i<process.argv.length;i++){
  const flag=process.argv[i];
  if(flag==='--development'){args.development=true;continue;}
  if(flag==='--interactions-only'){args.interactionsOnly=true;continue;}
  if(flag==='--physical-only'){args.physicalOnly=true;continue;}
  if(flag==='--zero-egress'){args.zeroEgress=true;continue;}
  assert(['--source','--output','--web-root','--from','--to'].includes(flag)&&!args[flag]&&process.argv[i+1],flag);
  args[flag]=process.argv[++i];
}
assert.equal(args['--from'],'initial');assert.equal(args['--to'],'end');
assert(args.zeroEgress,'--zero-egress required');
assert(!args.interactionsOnly||args.development,'interactions-only is development-only');
assert(!args.physicalOnly||args.development,'physical-only is development-only');
const source=path.resolve(args['--source']??path.join(root,'target/evidence/e9-t22h-fixture-dev-1'));
const out=path.resolve(args['--output']??path.join(root,'target/evidence/e9-t22h-browser-'+Date.now()));
const web=path.join(root,args['--web-root']??'web/dist');
assert(['web','web/dist'].includes(args['--web-root']??'web/dist'));
await fs.mkdir(out,{recursive:false});
const saved=path.join(source,'saved'),sourceReport=JSON.parse(await fs.readFile(path.join(source,'report.json')));
assert.equal(sourceReport.status,'recorded');
const sourceStore=JSON.parse(await fs.readFile(path.join(saved,'storage.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const report={task:'E9-T22h',scope:'Actual browser GPU replay from initial to final witnessed state across every bounded native window',
  head:git('rev-parse','HEAD'),dirty:git('status','--porcelain'),development:!!args.development,
  source:{path:source,reportSha256:sha(await fs.readFile(path.join(source,'report.json'))),
    storeSha256:sha(await fs.readFile(path.join(saved,'storage.json')))},
  started:new Date().toISOString(),status:'running',errors:[],httpErrors:[],external:[],checks:[]};
if(!args.development)assert.equal(report.dirty,'','freeze source before browser acceptance');
for(const row of sourceStore.stores.chunks){const bytes=await fs.readFile(path.join(saved,'chunks',row.key+'.bin'));
  assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.key);}
let browser,context,page;const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname);
  if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  if(name==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end('<!doctype html><title>Whole GPU replay proof</title><main id="proof">Running…</main>');return;}
  const fixture=name.startsWith('/__source__/'),base=fixture?saved:web,relative=fixture?name.slice('/__source__'.length):name;
  const file=path.resolve(base,'.'+relative);assert(file.startsWith(base+path.sep));
  const bytes=await fs.readFile(file);
  res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
}catch(error){report.httpErrors.push({url:req.url,error:String(error)});if(!res.headersSent)res.writeHead(404);res.end();}});
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  report.browser=browser.version();context=await browser.newContext({viewport:{width:1200,height:850},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:false,sources:true});
  page=await context.newPage();page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('pageerror',e=>report.errors.push(e.stack??String(e)));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)report.external.push(request.url());});
  page.on('websocket',socket=>report.external.push(socket.url()));
  await context.route('**/*',route=>{if(/^https?:/.test(route.request().url())&&new URL(route.request().url()).origin!==origin)
    return route.abort();return route.continue();});
  await page.goto(origin+'/');
  report.restore=await page.evaluate(async()=>{
    const saved=await(await fetch('/__source__/storage.json')).json();
    const {SessionStore}=await import('/session-store.js');
    const store=await SessionStore.open('wasm-vm-sessions-v1-e9-t22h-'+crypto.randomUUID());
    const entries={};for(const [name,rows]of Object.entries(saved.stores)){
      entries[name]=[];for(const row of rows){let value=row.value;
        if(name==='chunks')value=new Blob([await(await fetch('/__source__/chunks/'+row.key+'.bin')).arrayBuffer()]);
        else if(name==='sessions')value={...value,manifest:Uint8Array.from(value.manifest)};
        entries[name].push([row.key,value]);
      }
    }
    const db=await new Promise((yes,no)=>{const r=indexedDB.open(store.databaseName);r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
    await new Promise((yes,no)=>{const tx=db.transaction(Object.keys(entries),'readwrite',{durability:'strict'});
      for(const [name,rows]of Object.entries(entries))for(const [key,value]of rows)tx.objectStore(name).put(value,key);
      tx.oncomplete=yes;tx.onabort=()=>no(tx.error);});db.close();
    window.proofStore=store;
    return {database:store.databaseName,rows:Object.fromEntries(Object.entries(entries).map(([key,value])=>[key,value.length]))};
  });
  if(!args.interactionsOnly&&!args.physicalOnly){
  for(const variant of ['count','bytes','physical']){
    const recorded=variant==='physical'?sourceReport.result.physical:sourceReport.result.cases.find(row=>row.variant===variant);
    assert(recorded?.id&&recorded.status==='recorded');
    const value=await page.evaluate(async id=>{
      const store=window.proofStore,opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
      const {readCheckpointObject}=await import('/session-checkpoints.js');
      const {openGpuTimelineReplay}=await import('/session-gpu-replay.js');
      const vm=manifest.assets.find(value=>value.role==='vm');
      const config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(store,vm.content,8*1048576)));
      const openedReplay=await openGpuTimelineReplay({store,id,configuration:config});
      const controller=openedReplay.controller;
      try{
        const result=await controller.seekPosition(manifest.end);
        if(result.status!=='ready')throw Error('GPU replay did not publish: '+result.status);
        const inspection=await controller.inspectSelected();
        const {decodeCheckpointData,encodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs');
        const sourceRenderer=await readCheckpointObject(store,manifest.checkpoints.at(-1).gpu,256*1048576);
        const sourcePayload=decodeCheckpointData(sourceRenderer.subarray(16,-32));
        const actualPayload=inspection.renderer?decodeCheckpointData(inspection.renderer.bytes.subarray(16,-32)):null;
        const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        const canvas=result.rendered.canvas,pixel=canvas.width>32&&canvas.height>32?[...canvas.getContext('2d').getImageData(32,32,1,1).data]:null;
        return {id,position:result.position,digest:result.rendered.digest,replay:result.rendered.replay,
          state:{bytes:inspection.state.length,sha256:await digest(inspection.state)},
          queues:{pending:{bytes:inspection.queues.pending.length,sha256:await digest(inspection.queues.pending)},
            output:{bytes:inspection.queues.output.length,sha256:await digest(inspection.queues.output)}},
          renderer:actualPayload?{available:true,bytes:inspection.renderer.bytes.length,sha256:inspection.renderer.sha256,epoch:inspection.renderer.epoch,
            sourceSha256:manifest.checkpoints.at(-1).gpu.sha256,sourceEpoch:sourcePayload.logical.epoch,
            sameProfile:await digest(encodeCheckpointData(sourcePayload.profile))===await digest(encodeCheckpointData(actualPayload.profile)),
            sameLogical:await digest(encodeCheckpointData(sourcePayload.logical))===await digest(encodeCheckpointData(actualPayload.logical)),
            sameFrames:await digest(encodeCheckpointData(sourcePayload.frames))===await digest(encodeCheckpointData(actualPayload.frames)),
            sameLogicalAfterRebase:await digest(encodeCheckpointData({...actualPayload.logical,epoch:sourcePayload.logical.epoch}))
              ===await digest(encodeCheckpointData(sourcePayload.logical)),
            sameFramesAfterRebase:await digest(encodeCheckpointData(sourcePayload.frames))
              ===await digest(encodeCheckpointData(actualPayload.frames.slice(1))),
            sourceLogical:sourcePayload.logical,actualLogical:actualPayload.logical,
            sourceFrames:sourcePayload.frames.length,actualFrames:actualPayload.frames.length,
            sourceFramePreview:sourcePayload.frames.slice(0,2).map(frame=>decodeCheckpointData(frame)),
            actualFramePreview:actualPayload.frames.slice(0,2).map(frame=>decodeCheckpointData(frame))}
            :{available:false,status:inspection.rendererStatus},
          frontier:JSON.parse(inspection.frontier),canvas:{width:canvas.width,height:canvas.height,pixel},
          finalCheckpoint:manifest.checkpoints.at(-1),eventOptions:openedReplay.events.length,
          console:result.rendered.console};
      }finally{controller.close();}
    },recorded.id);
    report.checks.push({variant,...value});
    assert.deepEqual(value.position,Object.fromEntries(['transition','phase','ordinal','sequence','retired'].map(key=>[key,recorded.final[key]])));
    assert.equal(value.digest,recorded.final.digest);
    assert.equal(value.state.sha256,recorded.logicalState.sha256);
    assert.equal(value.replay?.wholeChain,true);assert(value.replay.windows>=2||variant==='physical');
    assert.equal(value.replay.eventCursor,Number(recorded.final.sequence));
    assert.equal(value.frontier.eventCursor,recorded.final.sequence);
    if(variant!=='physical'){
      assert.deepEqual(value.queues,recorded.hostQueues);
      assert(value.renderer.sameProfile&&value.renderer.sameLogicalAfterRebase&&value.renderer.sameFramesAfterRebase
        &&value.renderer.actualFrames===value.renderer.sourceFrames+1
        &&value.renderer.actualFramePreview[0]?.op==='rebase'
        &&value.renderer.actualFramePreview[0]?.expected===value.renderer.sourceEpoch
        &&value.renderer.actualFramePreview[0]?.next===value.renderer.epoch,
        'renderer checkpoint differs beyond the required fresh-epoch rebase');
    }
    if(variant==='physical')assert.deepEqual(value.canvas.pixel,[0,255,0,255]);
    console.log(JSON.stringify({variant,status:'replayed',windows:value.replay.windows,state:value.state.sha256}));
  }
  report.archives=await page.evaluate(async ids=>{
    const store=window.proofStore;
    const {SessionStore}=await import('/session-store.js');
    const {SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js');
    const {exportSessionBundle,inspectSessionBundle,importSessionBundle}=await import('/session-bundles.js');
    const {encodeBundleHeader,bundlePrefix}=await import('/session-bundle-format.js');
    const {checkpointHash}=await import('/session-checkpoints.js');
    const results=[];
    for(const id of ids){
      const opened=await store.openSession(id),original=checkpointHash(opened.manifest),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
      const exported=await exportSessionBundle(store,id),inspected=await inspectSessionBundle(exported.blob);
      const importedStore=await SessionStore.open('wasm-vm-sessions-v1-e9-t22h-import-'+crypto.randomUUID());
      try{
        const imported=await importSessionBundle(importedStore,exported.blob);
        const beforeGc=await SessionGpuHistoryReader.withOpen(importedStore,id,{},async reader=>{
          let receipts=0,cursor=reader.initialEventCursor;
          while(cursor){const window=await reader.nextReceiptWindow(cursor);receipts+=window.receipts.length;cursor=window.nextCursor;}
          let witnesses=0;cursor=reader.initialWitnessCursor;
          while(cursor){const page=await reader.nextWitnessWindow(cursor);witnesses+=page.rows.length;cursor=page.nextCursor;}
          return {receipts,witnesses,digest:reader.metadata.receiptDigest};
        });
        const gc=await importedStore.collectGarbage(),after=await importedStore.openSession(id);
        if(!after||checkpointHash(after.manifest)!==original)throw Error('GC changed imported GPU source');
        let corruption=null,incompatible=null;
        if(id===ids[0]){
          const bytes=new Uint8Array(await exported.blob.arrayBuffer()),view=new DataView(bytes.buffer),headerLength=view.getUint32(12,true);
          const header=JSON.parse(new TextDecoder().decode(bytes.subarray(16,16+headerLength)));
          const target=manifest.events[Math.floor(manifest.events.length/2)].content.sha256;
          let at=16+headerLength;for(const ref of header.objects){if(ref.sha256===target)break;at+=Number(ref.length);}
          if(at>=bytes.length)throw Error('middle receipt object missing from archive');
          bytes[at+32]^=1;
          try{await importSessionBundle(importedStore,new Blob([bytes]));throw Error('corrupt middle archive accepted');}
          catch(error){corruption=String(error.message);if(corruption==='corrupt middle archive accepted')throw error;}
          const wrong={...header,runtime:{...header.runtime,gpu:'0'.repeat(64)}};
          const encoded=encodeBundleHeader(wrong),wrongBlob=new Blob([bundlePrefix(encoded),encoded,exported.blob.slice(16+headerLength)]);
          try{await importSessionBundle(importedStore,wrongBlob);throw Error('incompatible profile accepted');}
          catch(error){incompatible=String(error.message);if(incompatible==='incompatible profile accepted')throw error;}
          if(checkpointHash((await importedStore.openSession(id)).manifest)!==original)throw Error('rejected archive changed selected source');
        }
        results.push({id,bytes:exported.blob.size,objects:inspected.objects,imported:imported.id,
          beforeGc,gc,manifestSha256:original,corruption,incompatible});
      }finally{await importedStore.close();}
    }
    return results;
  },[sourceReport.result.cases[0].id,sourceReport.result.cases[1].id,sourceReport.result.physical.id]);
  assert.equal(report.archives.length,3);
  assert(report.archives[0].corruption&&report.archives[0].incompatible);
  console.log(JSON.stringify({status:'archives-verified',cases:report.archives.length}));
  }
  if(!args.physicalOnly){
  report.interactions=await page.evaluate(async id=>{
    const store=window.proofStore,opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    const {checkpointHash,readCheckpointObject}=await import('/session-checkpoints.js');
    const {openGpuTimelineReplay}=await import('/session-gpu-replay.js');
    const {SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js');
    const before=checkpointHash(opened.manifest),vm=manifest.assets.find(value=>value.role==='vm');
    const config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(store,vm.content,8*1048576)));
    const openedReplay=await openGpuTimelineReplay({store,id,configuration:config});
    const controller=openedReplay.controller,mid=openedReplay.events.find(row=>row.sequence==='2048');
    if(!mid||mid.phase!=='before'||mid.retired===undefined)throw Error('exact event navigation metadata');
    try{
      const end=await controller.seekPosition(manifest.end);
      if(end.status!=='ready'||!controller.canContinue)throw Error('healthy final state cannot branch');
      const branch=await controller.captureSelectedBranch();
      if(branch.position.sequence!==manifest.end.sequence||branch.parentManifest.id!==id)throw Error('branch capture source');
      const atMid=await controller.seekPosition(mid);
      if(atMid.status!=='ready'||atMid.position.sequence!=='2048'||!controller.canContinue)throw Error('exact event seek');
      const selected=controller.selected;
      const older=controller.seekPosition(manifest.end);
      await new Promise(resolve=>setTimeout(resolve,50));
      if(controller.selected?.requestId!==selected.requestId)throw Error('in-flight seek displaced selected view');
      const newer=controller.seekPosition(mid);
      const cancelled=await older,current=await newer;
      if(cancelled.status!=='cancelled'||current.status!=='ready'||controller.selected?.position.sequence!=='2048')
        throw Error('latest-owner seek cancellation');
      const target=manifest.events[Math.floor(manifest.events.length/2)].content.sha256;
      const db=await new Promise((yes,no)=>{const r=indexedDB.open(store.databaseName);r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
      const get=(table,key)=>new Promise((yes,no)=>{const tx=db.transaction(table),r=tx.objectStore(table).get(key);r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
      const put=(table,key,value)=>new Promise((yes,no)=>{const tx=db.transaction(table,'readwrite',{durability:'strict'});tx.objectStore(table).put(value,key);tx.oncomplete=yes;tx.onabort=()=>no(tx.error);});
      const object=await get('objects',target),part=object.parts[0].sha256,original=await get('chunks',part);
      const bytes=new Uint8Array(await original.arrayBuffer());bytes[Math.floor(bytes.length/2)]^=1;
      let refusal;
      try{
        await put('chunks',part,new Blob([bytes]));
        try{await controller.seekPosition(manifest.end);throw Error('corrupt middle replay accepted');}
        catch(error){refusal=String(error.message);if(refusal==='corrupt middle replay accepted')throw error;}
        if(controller.selected?.requestId!==current.requestId||controller.selected.position.sequence!=='2048'
          ||!controller.canContinue)throw Error('rejected replay displaced the selected source');
      }finally{await put('chunks',part,original);db.close();}
      const restored=await store.openSession(id);
      if(checkpointHash(restored.manifest)!==before)throw Error('failed/cancelled seek changed source history');
      const authenticated=await SessionGpuHistoryReader.withOpen(store,id,{},reader=>({
        receipts:reader.metadata.receipts,receiptDigest:reader.metadata.receiptDigest}));
      return {events:openedReplay.events.length,mid:atMid.position,branchDigest:[...branch.capture.sourceDigest].map(n=>n.toString(16).padStart(2,'0')).join(''),
        cancelled:cancelled.status,newest:current.status,preserved:controller.selected.position,
        refusal,manifestSha256:before,authenticated};
    }finally{controller.close();}
  },sourceReport.result.cases[0].id);
  assert.equal(report.interactions.events,sourceReport.result.cases[0].receipts);
  assert.match(report.interactions.refusal,/Corrupt|Authentication|digest|object/i);
  console.log(JSON.stringify({status:'timeline-interactions-verified',events:report.interactions.events}));
  }
  report.physicalGreen=await page.evaluate(async id=>{
    const store=window.proofStore,opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    const point=manifest.checkpoints.find(value=>value.id==='gpu-green');if(!point)throw Error('physical green checkpoint missing');
    const {readCheckpointObject}=await import('/session-checkpoints.js');
    const {openGpuTimelineReplay}=await import('/session-gpu-replay.js');
    const {encodeCheckpointData,decodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs');
    const vm=manifest.assets.find(value=>value.role==='vm'),config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(store,vm.content,8*1048576)));
    const replay=await openGpuTimelineReplay({store,id,configuration:config}),controller=replay.controller;
    try{
      const selected=await controller.seekPosition(point.position),inspection=await controller.inspectSelected();
      if(selected.status!=='ready'||!inspection.renderer)throw Error('physical green checkpoint unavailable');
      const source=decodeCheckpointData((await readCheckpointObject(store,point.gpu,256*1048576)).subarray(16,-32));
      const actual=decodeCheckpointData(inspection.renderer.bytes.subarray(16,-32));
      const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const same=(a,b)=>digest(encodeCheckpointData(a)).then(x=>digest(encodeCheckpointData(b)).then(y=>x===y));
      const canvas=selected.rendered.canvas;
      const fields={};for(const key of Object.keys(source.logical))fields[key]={
        source:await digest(encodeCheckpointData(source.logical[key])),
        actual:await digest(encodeCheckpointData(actual.logical[key]))};
      const histogram=frames=>Object.fromEntries([...new Set(frames.map(frame=>decodeCheckpointData(frame).op))]
        .map(op=>[op,frames.filter(frame=>decodeCheckpointData(frame).op===op).length]));
      return {position:selected.position,digest:selected.rendered.digest,canContinue:controller.canContinue,
        canvas:{width:canvas.width,height:canvas.height,pixel:[...canvas.getContext('2d').getImageData(32,32,1,1).data]},
        profile:await same(source.profile,actual.profile),logicalRebased:await same(source.logical,{...actual.logical,epoch:source.logical.epoch}),
        framesAfterRebase:await same(source.frames,actual.frames.slice(1)),
        sourceEpoch:source.logical.epoch,actualEpoch:actual.logical.epoch,
        sourceFrames:source.frames.length,actualFrames:actual.frames.length,
        logicalFields:fields,sourceFrameOps:histogram(source.frames),actualFrameOps:histogram(actual.frames),
        sourceScanout:source.logical.scanout,actualScanout:actual.logical.scanout,
        sourceQueries:source.frames.map(frame=>decodeCheckpointData(frame)).filter(frame=>frame.op==='query'),
        actualQueries:actual.frames.map(frame=>decodeCheckpointData(frame)).filter(frame=>frame.op==='query'),
        firstFrame:decodeCheckpointData(actual.frames[0]),sourceSha256:point.gpu.sha256,actualSha256:inspection.renderer.sha256};
    }finally{controller.close();}
  },sourceReport.result.physical.id);
  const green=report.physicalGreen,originalGreen=sourceReport.result.physical.checkpoints.find(point=>point.sequence===green.position.sequence);
  assert(originalGreen);assert.equal(green.digest,originalGreen.digest);assert.equal(green.canContinue,true);
  assert.deepEqual(green.canvas,{width:64,height:64,pixel:[0,255,0,255]});
  assert.equal(green.profile,true);assert.equal(green.actualEpoch!==green.sourceEpoch,true);
  assert.deepEqual(Object.keys(green.logicalFields).filter(key=>green.logicalFields[key].source!==green.logicalFields[key].actual),['epoch','scanout']);
  assert.deepEqual({...green.actualScanout,epoch:green.sourceScanout.epoch},green.sourceScanout);
  for(const [op,count]of Object.entries(green.sourceFrameOps))if(op!=='query')assert.equal(green.actualFrameOps[op],count,op);
  assert.equal(green.actualFrameOps.rebase,1);
  assert.deepEqual(green.actualQueries.filter(query=>query.parameter==='result'||query.value===true),
    green.sourceQueries.filter(query=>query.parameter==='result'||query.value===true));
  assert(green.actualQueries.length<green.sourceQueries.length,'replay omits transient false availability polls');
  console.log(JSON.stringify({status:'physical-green-inspected',renderer:report.physicalGreen.actualSha256}));
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.external,[]);
  report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
  if(page)await page.screenshot({path:path.join(out,'screen.png')}).catch(()=>{});
  if(context)await context.tracing.stop({path:path.join(out,'browser-trace.zip')}).catch(()=>{});
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,failure:report.failure,output:out}));
  process.exit(process.exitCode??0);
}
