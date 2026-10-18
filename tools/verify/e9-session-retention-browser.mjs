#!/usr/bin/env node
// Drive visible T06 controls against real persisted guest checkpoints, never a model VM.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {retentionFixture,checkRetentionStorage,checkLegacyStoreBoundary,checkMigration,checkMaintenanceSchedules,checkCleanupCrashes} from './e9-session-retention-storage.mjs';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argument=flag=>{const at=process.argv.indexOf(flag);return at<0?null:process.argv[at+1];};
const output=path.resolve(argument('--output')),development=process.argv.includes('--development');
const remote=argument('--url'),web=path.join(root,'web/dist'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.ok(argument('--output'));if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const report={task:'E9-T07',status:'running',development,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  started:new Date().toISOString(),checks:{},errors:[]};
await fs.mkdir(output,{recursive:true});
let server,context,page;
const coverage=[];
async function collectCoverage(){
  const entries=await page.coverage.stopJSCoverage(),name=`javascript-coverage-segment-${(report.coverageSegments??[]).length+1}.json`;
  coverage.push(...entries);await fs.writeFile(path.join(output,name),JSON.stringify(entries));
  (report.coverageSegments??=[]).push({name,entries:entries.length});
}
async function navigate(operation){
  // Playwright may replace same-URL script entries after a navigation even with reset disabled.
  // Seal the old document first; start before navigating so new module initialization is covered.
  await collectCoverage();await page.coverage.startJSCoverage({resetOnNavigation:false});
  await operation();
}
const control=name=>page.locator(`[data-session="${name}"]`);
async function idle(){await page.waitForFunction(()=>window.__sessionLibrary&&!__sessionLibrary.busy&&__sessionLibrary.root.dataset.state!=='loading',null,{timeout:240000});}
async function click(name){await control(name).click();await idle();}
async function command(text){
  const value=await page.evaluate(text=>wvmDemo.exec(text,180000,{quiet:true}),text);
  assert.equal(value.exit,0,JSON.stringify(value));return value.stdout;
}
async function details(id,point=null){return page.evaluate(async({id,point})=>{
  const {readCheckpointObject,checkpointHash}=await import('./session-checkpoints.js');
  const store=__sessionLibrary.store,opened=await store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
  const selected=manifest.checkpoints.find(item=>item.id===point)||manifest.checkpoints.at(-1);
  const frame=await readCheckpointObject(store,selected.machine),compressed=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const name=`${id}-${selected.id}.checkpoint.gz`;await fetch('./__e9-library-proof/'+name,{method:'POST',body:compressed});
  return {id,revision:opened.revision,manifest,point:selected.id,frameHash:checkpointHash(frame),bytes:frame.length,evidence:name};
},{id,point});}
async function activeFrame(name){return page.evaluate(async name=>{
  const {checkpointHash}=await import('./session-checkpoints.js');
  const frame=await __linuxCtl.captureSoftwareCheckpoint(),compressed=new Uint8Array(await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  await fetch('./__e9-library-proof/'+name,{method:'POST',body:compressed});
  return {hash:checkpointHash(frame),bytes:frame.length,paused:await __linuxCtl.isPaused(),scheduler:await __linuxCtl.schedulerStats(),
    active:document.querySelector('[data-session="active"]').dataset.id,point:document.querySelector('[data-session="active"]').dataset.point};
},name);}
try {
  if(!development)assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'');
  if(!remote){
    const fallback=new Map();
    for(const name of ['artifacts-alpine.json','artifacts-omarchy-virgl.json'])for(const asset of Object.values(JSON.parse(await fs.readFile(path.join(web,name),'utf8')).artifacts)){
      const pathname='/'+asset.url.replace(/^\.\//,'');fallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
    }
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{try{
      const pathname=new URL(request.url,'http://localhost').pathname;
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      const base=pathname.startsWith('/releases/')?root:web,file=path.resolve(base,'.'+decodeURIComponent(pathname));
      if(!file.startsWith(base+path.sep)){response.writeHead(404).end();return;}
      let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT'&&fallback.has(pathname)){response.writeHead(302,{Location:fallback.get(pathname)}).end();return;}throw error;}
      response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
        'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch{response.writeHead(404).end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
  report.url=new URL('app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000&enableMic=1&slirpNet&slirpProvider=websocket&slirpWebsocket=wss://invalid.example',remote||`http://127.0.0.1:${server.address().port}/`).href;
  context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=context.pages()[0]??await context.newPage();
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.route('**/__e9-library-proof/*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);assert.match(name,/^[a-z0-9-]+\.checkpoint\.gz$/);assert.equal(route.request().method(),'POST');
    await fs.writeFile(path.join(output,name),route.request().postDataBuffer());await route.fulfill({status:204,body:''});
  });
  page.on('console',message=>{if(message.type()==='error'&&!(/favicon\.ico$/.test(message.location().url)&&/\b404\b/.test(message.text())))report.errors.push(message.text());});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(report.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready===true);await idle();
  console.log('Built page ready; running live compliance suite');
  if(remote){report.checks.publicBytes=[];for(const name of ['app.html','main.js','session-library.js','session-library.css','session-checkpoints.js','session-store.js','session-disk-roots.js',
    'gpu-checkpoint-build.js','gpu-runtime-worker.js','linux-worker-host.js','loader.js','roadmap.js','tasks.json','session-software-fixture.json','session-alpine-image.json',
    'pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']){
    const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200);
    const bytes=await response.body(),expected=sha(await fs.readFile(path.join(web,name)));assert.equal(sha(bytes),expected,name);
    report.checks.publicBytes.push({name,sha256:expected,bytes:bytes.length});
  }}
  await page.locator('#suite-run').click();await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.checks.suite,{passed:127,failed:0});
  report.checks.roadmap=await page.locator('.cap',{hasText:'Storage limits and shared-data deletion'}).locator('.cap-pip').getAttribute('class');
  assert.match(report.checks.roadmap,/\b(?:in-progress|verified)\b/);
  await page.locator('#panel-tests').screenshot({path:path.join(output,'suite.png')});
  console.log('Checking authenticated storage limits, shared references and prior store attacks');
  const fixture=await retentionFixture(root), namespace='wasm-vm-sessions-v1-retention-proof';
  report.checks.storage=await checkRetentionStorage(page,{namespace,fixture});
  report.checks.legacy=await checkLegacyStoreBoundary(page,root,namespace);
  report.checks.migration=await checkMigration(page,{namespace:namespace+'-migration',fixture});
  report.checks.schedules=await checkMaintenanceSchedules(context,page,report.url,{namespace:namespace+'-schedules',fixture});
  report.checks.crashes=await checkCleanupCrashes(context,page,report.url,{namespace,fixture});
  console.log('Starting actual offline guest through library control');
  await click('new');
  const progress=setInterval(()=>console.log('Waiting for real guest shell'),20000);
  try{await page.waitForFunction(()=>wvmDemo.isGuestReady()||!wvmDemo.isGuestUp(),null,{timeout:900000});
    assert.equal(await page.evaluate(()=>wvmDemo.isGuestReady()),true,await page.locator('#status').textContent());
  }finally{clearInterval(progress);}
  await command("mkdir -p /root/e9-retention; printf 'shared-prefix\\n' > /root/e9-retention/state; e9_label=shared-memory; sync");
  await click('start');const parent=await control('sessions').inputValue();
  report.checks.prefix=await details(parent);
  await control('name').fill('Retention parent');await control('name').press('Enter');await idle();
  const sibling='retention-actual-sibling';
  await page.evaluate(async({parent,sibling})=>{
    const store=__sessionLibrary.store,opened=await store.openSession(parent),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    manifest.id=sibling;const writer=await store.writer(sibling);
    try{await writer.publish(new TextEncoder().encode(JSON.stringify(manifest)));}finally{await writer.release();}
  },{parent,sibling});
  report.checks.siblingOriginal=await details(sibling);
  await command("printf 'private-later\\n' > /root/e9-retention/state; e9_label=private-memory; sync");
  const cdp=await context.newCDPSession(page),origin=new URL(report.url).origin;
  report.checks.quotaBefore=await cdp.send('Storage.getUsageAndQuota',{origin});
  await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:1});
  report.checks.quotaOverride=await cdp.send('Storage.getUsageAndQuota',{origin});
  assert.equal(report.checks.quotaOverride.overrideActive,true);assert.equal(report.checks.quotaOverride.quota,1);
  // Chromium caches an IDB bucket space allowance for 30 seconds. Let that real
  // reservation expire so the next append reaches its actual quota manager.
  await page.waitForTimeout(31000);
  await click('checkpoint');
  report.checks.quota={state:await page.locator('#session-library').getAttribute('data-state'),message:await control('status').innerText(),
    context:await page.evaluate(async()=>({paused:await __linuxCtl.isPaused(),recording:Boolean(__sessionLibrary.recording),retry:__sessionLibrary.pausedRecording&&{id:__sessionLibrary.pausedRecording.id,revision:__sessionLibrary.pausedRecording.revision,prefixHash:__sessionLibrary.pausedRecording.prefixHash},
      locks:(await navigator.locks.query()).held.map(lock=>({name:lock.name,mode:lock.mode})),active:__sessionLibrary.active&&{id:__sessionLibrary.active.id,unsaved:__sessionLibrary.active.unsaved}}))};
  // Controller objects are not serialized as evidence; the identity is checked in-page below.
  assert.equal(report.checks.quota.state,'storage-error');assert.match(report.checks.quota.message,/Recording paused/);
  assert.equal(report.checks.quota.context.paused,true);assert.equal(report.checks.quota.context.recording,false);assert.equal(report.checks.quota.context.active.unsaved,true);
  assert.ok(report.checks.quota.context.retry?.id===parent);
  assert.ok(!report.checks.quota.context.locks.some(lock=>lock.name==='wasm-vm-session-wasm-vm-sessions-v1-'+parent));
  report.checks.prefixAfterQuota=await details(parent);
  assert.equal(report.checks.prefixAfterQuota.revision,report.checks.prefix.revision);assert.deepEqual(report.checks.prefixAfterQuota.manifest,report.checks.prefix.manifest);
  await page.locator('#session-library').screenshot({path:path.join(output,'quota-paused.png')});
  await cdp.send('Storage.overrideQuotaForOrigin',{origin});
  await click('cleanup');assert.match(await control('status').innerText(),/Cleanup completed/);
  await control('limit-bytes').fill('2048');await control('limit-points').fill('4');await click('limits-save');
  await click('retry');assert.match(await control('status').innerText(),/Checkpoint committed/);
  report.checks.retried=await details(parent);assert.equal(report.checks.retried.revision,'2');
  assert.deepEqual(report.checks.retried.manifest.checkpoints[0],report.checks.prefix.manifest.checkpoints[0]);
  assert.notEqual(report.checks.retried.manifest.checkpoints[1].disk_root,report.checks.prefix.manifest.checkpoints[0].disk_root);
  await click('stop');
  report.checks.parentFinal=await details(parent);
  const beforeDelete=await page.evaluate(()=>__sessionLibrary.store.statistics());
  await control('sessions').selectOption(parent);await idle();
  page.once('dialog',dialog=>dialog.dismiss());await click('delete');assert.equal((await details(parent)).revision,report.checks.parentFinal.revision);
  page.once('dialog',dialog=>dialog.accept());await click('delete');assert.match(await control('status').innerText(),/Saved session deleted/);
  report.checks.deleted={before:beforeDelete,after:await page.evaluate(()=>__sessionLibrary.store.statistics()),active:await control('active').innerText()};
  assert.ok(report.checks.deleted.after.payloadBytes<beforeDelete.payloadBytes);assert.match(report.checks.deleted.active,/current memory is unsaved/);
  await control('sessions').selectOption(sibling);await idle();
  report.checks.siblingAfterDelete=await details(sibling);assert.deepEqual(report.checks.siblingAfterDelete.manifest,report.checks.siblingOriginal.manifest);
  await click('open');report.checks.siblingRestored=await activeFrame('sibling-restored.checkpoint.gz');
  assert.equal(report.checks.siblingRestored.hash,report.checks.siblingOriginal.frameHash);assert.equal(report.checks.siblingRestored.paused,true);
  await click('resume');report.checks.siblingFile=(await command('cat /root/e9-retention/state')).trim();
  report.checks.siblingMemory=(await command('printf "%s" "$e9_label"')).trim();
  assert.equal(report.checks.siblingFile,'shared-prefix');assert.equal(report.checks.siblingMemory,'shared-memory');
  console.log('Quota pause/retry and real shared checkpoint restore passed');
  // A second pause cannot resurrect history another tab explicitly deleted while its writer was released.
  await click('start');const stale=await control('sessions').inputValue();
  await control('limit-points').fill('1');await click('limits-save');await click('checkpoint');
  assert.match(await control('status').innerText(),/Recording paused/);assert.equal(await control('retry').isDisabled(),false);
  const other=await context.newPage();await other.goto(report.url,{waitUntil:'domcontentloaded'});await other.waitForFunction(()=>window.__ready===true);
  report.checks.otherDeleted=await other.evaluate(async stale=>{const {SessionStore}=await import('./session-store.js');const store=await SessionStore.open();
    try{return await store.deleteSession(stale);}finally{await store.close();}},stale);await other.close();
  const staleFrame=await activeFrame('before-stale-retry.checkpoint.gz');
  await click('retry');assert.match(await control('status').innerText(),/Saved history changed/);
  assert.equal((await activeFrame('after-stale-retry.checkpoint.gz')).hash,staleFrame.hash);
  assert.equal(await page.evaluate(stale=>__sessionLibrary.store.openSession(stale),stale),null);
  await click('refresh');await control('sessions').selectOption(stale);await idle();
  report.checks.eviction={state:await page.locator('#session-library').getAttribute('data-state'),name:await control('sessions').locator('option:checked').innerText(),openDisabled:await control('open').isDisabled()};
  assert.equal(report.checks.eviction.state,'incomplete');assert.match(report.checks.eviction.name,/incomplete/);assert.equal(report.checks.eviction.openDisabled,true);
  page.once('dialog',dialog=>dialog.accept());await click('delete');
  assert.equal(await control('sessions').locator(`option[value="${stale}"]`).count(),0);
  await click('persist');report.checks.persistence={message:await control('status').innerText(),summary:await control('storage').innerText()};
  assert.match(report.checks.persistence.message,/Persistent storage (?:granted|denied)|Persistent-storage requests are unavailable/);
  report.checks.persistenceVariants=await page.evaluate(async()=>{
    const storage=navigator.storage,prototype=Object.getPrototypeOf(storage),descriptors=Object.fromEntries(['persist','persisted','estimate'].map(key=>[key,Object.getOwnPropertyDescriptor(prototype,key)]));
    const library=__sessionLibrary,result=[];
    try{
      Object.defineProperty(prototype,'persist',{configurable:true,value:async()=>true});
      Object.defineProperty(prototype,'persisted',{configurable:true,value:async()=>true});
      await library.requestPersistence();result.push({injected:'granted API result',message:library.controls.status.textContent,summary:library.controls.storage.textContent});
      Object.defineProperty(prototype,'persist',{configurable:true,value:undefined});
      Object.defineProperty(prototype,'persisted',{configurable:true,value:async()=>{throw Error('bounded status unavailable');}});
      Object.defineProperty(prototype,'estimate',{configurable:true,value:async()=>{throw Error('bounded estimate unavailable');}});
      await library.requestPersistence();result.push({injected:'unavailable API result',message:library.controls.status.textContent,summary:library.controls.storage.textContent});
    }finally{for(const [key,descriptor]of Object.entries(descriptors))Object.defineProperty(prototype,key,descriptor);}
    await library.storageSummary();return result;
  });
  assert.match(report.checks.persistenceVariants[0].message,/Persistent storage granted/);assert.match(report.checks.persistenceVariants[0].summary,/Persistent storage granted/);
  assert.match(report.checks.persistenceVariants[1].message,/requests are unavailable/);assert.match(report.checks.persistenceVariants[1].summary,/Origin usage and quota unavailable/);
  await control('limit-points').fill('4096');await click('limits-save');
  await navigate(()=>page.reload({waitUntil:'domcontentloaded'}));await page.waitForFunction(()=>window.__ready===true);await idle();
  assert.equal(await control('sessions').locator('option').count(),1);await control('sessions').selectOption(sibling);await idle();
  await click('open');assert.equal((await activeFrame('sibling-reopened.checkpoint.gz')).hash,report.checks.siblingOriginal.frameHash);
  await page.locator('#session-library').screenshot({path:path.join(output,'retention-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  report.checks.mobile=await page.locator('#session-library').evaluate(el=>({right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth,viewport:innerWidth}));
  assert.ok(report.checks.mobile.right<=391&&report.checks.mobile.scroll<=report.checks.mobile.client+1,JSON.stringify(report.checks.mobile));
  await page.locator('#session-library').screenshot({path:path.join(output,'retention-mobile.png')});
  // Generic initial-save failures release the writer without changing the paused owner.
  const beforeInitialFailure=await activeFrame('before-initial-failure.checkpoint.gz');
  await page.evaluate(()=>{const library=__sessionLibrary,actual=library.checkpoints.save;
    window.__initialFailure={actual,calls:0};library.checkpoints.save=async()=>{__initialFailure.calls++;throw Error('bounded initial save failure');};});
  await click('start');
  report.checks.initialFailure=await page.evaluate(async()=>{const library=__sessionLibrary,id=library.selected;
    library.checkpoints.save=__initialFailure.actual;const writer=await library.store.writer(id);await writer.release();
    return {calls:__initialFailure.calls,id,recording:Boolean(library.recording),paused:Boolean(library.pausedRecording),saved:await library.store.openSession(id),reacquired:true};});
  assert.equal(report.checks.initialFailure.calls,1);assert.equal(report.checks.initialFailure.saved,null);assert.equal(report.checks.initialFailure.recording,false);assert.equal(report.checks.initialFailure.paused,false);
  assert.equal((await activeFrame('after-initial-failure.checkpoint.gz')).hash,beforeInitialFailure.hash);
  // A display-label quota after durable publication must retain the new exact point and cursor.
  await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='wasm-vm.session-library.v1'&&JSON.parse(value).rows.some(row=>row.draft===false&&row.points.length))throw new DOMException('bounded label quota','QuotaExceededError');return __originalSetItem.call(this,key,value);};});
  await click('start');
  report.checks.committedLabelQuota=await page.evaluate(async()=>{const library=__sessionLibrary,id=library.pausedRecording?.id,opened=await library.store.openSession(id);
    Storage.prototype.setItem=__originalSetItem;delete window.__originalSetItem;
    return {id,revision:opened.revision,manifest:JSON.parse(new TextDecoder().decode(opened.manifest)),unsaved:library.active.unsaved,paused:await __linuxCtl.isPaused(),retry:Boolean(library.pausedRecording)};});
  assert.equal(report.checks.committedLabelQuota.revision,'1');assert.equal(report.checks.committedLabelQuota.unsaved,false);assert.equal(report.checks.committedLabelQuota.paused,true);assert.equal(report.checks.committedLabelQuota.retry,true);
  await click('stop');assert.match(await control('status').innerText(),/stopped at its committed prefix/);
  // Initial quota before publication offers a retry, then actual owner retirement clears it.
  await page.evaluate(()=>{const library=__sessionLibrary,actual=library.checkpoints.save;
    window.__initialQuotaActual=actual;library.checkpoints.save=async()=>{throw new DOMException('bounded initial quota','QuotaExceededError');};});
  await click('start');
  report.checks.initialQuota=await page.evaluate(async()=>{const library=__sessionLibrary;library.checkpoints.save=__initialQuotaActual;delete window.__initialQuotaActual;
    const id=library.pausedRecording.id,writer=await library.store.writer(id);await writer.release();
    return {id,revision:library.pausedRecording.revision,prefixHash:library.pausedRecording.prefixHash,saved:await library.store.openSession(id),unsaved:library.active.unsaved,paused:await __linuxCtl.isPaused()};});
  assert.equal(report.checks.initialQuota.saved,null);assert.equal(report.checks.initialQuota.revision,null);assert.equal(report.checks.initialQuota.prefixHash,null);assert.equal(report.checks.initialQuota.unsaved,true);
  assert.equal(await page.evaluate(()=>__retireLinuxControllerForTest()),true);
  report.checks.ownerLoss=await page.evaluate(()=>({recording:Boolean(__sessionLibrary.recording),paused:Boolean(__sessionLibrary.pausedRecording),active:__sessionLibrary.controls.active.dataset.id,message:__sessionLibrary.controls.status.textContent}));
  assert.equal(report.checks.ownerLoss.paused,false);assert.equal(report.checks.ownerLoss.recording,false);assert.equal(report.checks.ownerLoss.active,'');assert.match(report.checks.ownerLoss.message,/guest stopped/);
  for(const name of (await fs.readdir(output)).filter(name=>name.endsWith('.checkpoint.gz'))){const bytes=gunzipSync(await fs.readFile(path.join(output,name)));(report.checks.rawTuples??=[]).push({name,bytes:bytes.length,sha256:sha(bytes)});}
  await cdp.detach();await page.unroute('**/__e9-library-proof/*');
  if(!development){
    await page.setViewportSize({width:1440,height:1000});
    await navigate(()=>page.goto(new URL('app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000',report.url).href,{waitUntil:'domcontentloaded'}));await page.waitForFunction(()=>window.__ready===true);await idle();
    await page.locator('#desktop-graphics').selectOption('gpu');assert.equal((await page.evaluate(()=>wvmDemo.bootOmarchy())).ok,true);
    await page.waitForFunction(()=>wvmDemo.isGuestReady()&&__linux.restoredFromBootSnapshot(),null,{timeout:600000});
    const gpu=await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()}));
    report.checks.gpu={qualified:gpu.gpu.qualified,lost:gpu.gpu.lost,poisoned:gpu.gpu.poisoned,epoch:gpu.gpu.epoch,retired:gpu.scheduler.retiredInstructions,
      drawn:gpu.gpu.scanout.retirements.filter(r=>r.epoch===gpu.gpu.epoch&&r.status==='drawn')};
    assert.ok(report.checks.gpu.qualified&&!report.checks.gpu.lost&&!report.checks.gpu.poisoned&&report.checks.gpu.retired>0&&report.checks.gpu.drawn.length);
    await page.screenshot({path:path.join(output,'gpu-factory-ready.png')});
  }
  await fs.writeFile(path.join(output,'retention-witnesses.json'),JSON.stringify(report.checks,null,2)+'\n');
  report.checks.base=execFileSync('python3',['tools/verify/e9-disk-roots-files.py','prepare','--output',output],{cwd:root,encoding:'utf8'}).trim();
  report.checks.oracle=execFileSync('python3',['tools/verify/e9-session-retention-files.py','--output',output],{cwd:root,encoding:'utf8'}).trim();
  assert.deepEqual(report.errors,[]);report.status='passed';console.log('Retention: actual quota pause/retry, shared restore, crash recovery, varied leases and honest eviction passed.');
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  if(page&&!page.isClosed()){
    try{report.finalUi=await page.locator('#session-library').evaluate(el=>({state:el.dataset.state,text:el.innerText}));}catch{}
    try{await collectCoverage();await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(coverage));}
    catch(error){report.coverageFailure=error.message;if(report.status==='passed'){report.status='failed';process.exitCode=1;}}
    if(report.status==='failed')await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  }
  if(context){await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});await context.close().catch(()=>{});}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.source_sha256={};
  for(const name of ['web/session-store.js','web/session-library.js','web/session-library.css','web/loader.js','web/roadmap.js','web/index.html',
    'web/session-checkpoints.js','web/session-disk-roots.js','web/gpu-checkpoint-build.js','tools/verify/e9-session-retention-browser.mjs','tools/verify/e9-session-retention-storage.mjs','tools/verify/e9-session-retention-files.py','tools/verify/e9-disk-roots-files.py']) report.source_sha256[name]=sha(await fs.readFile(path.join(root,name)));
  report.files=[];
  async function inventory(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);
    if(entry.isDirectory())await inventory(file);else if(entry.isFile()&&file!==path.join(output,'report.json')){const bytes=await fs.readFile(file);report.files.push({path:path.relative(output,file),bytes:bytes.length,sha256:sha(bytes)});}}}
  await inventory(output);
  report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
