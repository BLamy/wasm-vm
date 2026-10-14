#!/usr/bin/env node
// Independent acceptance: unchanged shipped pairs, real app UI, workers and Wasm.
// Local assets are hash-bound originals; missing disk chunks are fetched from the
// production R2 origin and verified before serving. No guest output is fabricated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2]);
const web = path.resolve(process.env.CRITIC_FAST_BOOT_WEB_ROOT || path.join(repo, 'web'));
// This optional cache is an optimization. A pristine clone may omit every asset.
const releaseCache = path.resolve(process.env.CRITIC_FAST_BOOT_CACHE_DIRECTORY || path.join(repo,'releases'));
const r2 = 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const guests = (process.env.CRITIC_FAST_BOOT_GUESTS || 'busybox,alpine,node-alpine,omarchy').split(',');
const coldGpu = process.env.CRITIC_FAST_BOOT_GPU === '1';
const candidateDirectory = process.env.CRITIC_FAST_BOOT_IMAGE_DIRECTORY
  ? path.resolve(process.env.CRITIC_FAST_BOOT_IMAGE_DIRECTORY) : null;
const snapshotPersistence = process.env.CRITIC_FAST_BOOT_PERSISTENCE !== '0';
const saveOnRepeat = process.env.CRITIC_FAST_BOOT_SAVE_ON_REPEAT === '1';
const gpuTrace = process.env.CRITIC_FAST_BOOT_GPU_TRACE === '1';
let gpuRecording = Promise.resolve();
await fs.mkdir(output, {recursive:false});
const report = {status:'running', scope:'actual production UI fast boots and repeat launches',
  webRoot:web, releaseCache, saveOnRepeat, gpuTrace, phases:[], requests:[], sourceHashes:{}, errors:[]};
let browser, server, activePage, phase = 'inventory';
const sourcePaths = ['index.html','main.js','loader.js','linux-worker.js','linux-worker-protocol.js',
  'linux-worker-host.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','src/sink/presentation.js',
  'artifacts.json','artifacts-alpine.json','artifacts-node-alpine.json','artifacts-omarchy.json'];
if (web.endsWith('/dist')) sourcePaths[0]='app.html';
if(coldGpu)sourcePaths.push('artifacts-omarchy-virgl.json');
for (const filename of sourcePaths) report.sourceHashes[filename] = hash(await fs.readFile(path.join(web,filename)));
let candidateManifestBytes, candidateDescriptorBytes, candidateManifestHash;
const candidateChunks = new Set();
if(candidateDirectory){
  assert.ok(coldGpu, 'local accelerated image requires the explicit cold GPU route');
  candidateManifestBytes=await fs.readFile(path.join(candidateDirectory,'manifest.json'));
  candidateManifestHash=hash(candidateManifestBytes);
  const manifest=JSON.parse(candidateManifestBytes);
  assert.equal(manifest.version,1);assert.equal(manifest.layout,'split');
  assert.ok(Number.isSafeInteger(manifest.image_len)&&manifest.image_len>0);
  assert.ok(Number.isSafeInteger(manifest.chunk_size)&&manifest.chunk_size>0);
  assert.equal(manifest.chunks.length,Math.ceil(manifest.image_len/manifest.chunk_size));
  assert.equal((await fs.stat(path.join(candidateDirectory,'guest.ext4'))).size,manifest.image_len);
  for(const digest of manifest.chunks){assert.match(digest,/^[a-f0-9]{64}$/);candidateChunks.add(digest);}
  const descriptor=JSON.parse(await fs.readFile(path.join(web,'artifacts-omarchy-virgl.json'),'utf8'));
  descriptor.chunkedImage={key:'chunked-omarchy/manifest-'+candidateManifestHash+'.json',
    sha256:candidateManifestHash,size:candidateManifestBytes.length};
  candidateDescriptorBytes=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');
  report.candidate={directory:candidateDirectory,manifestSha256:candidateManifestHash,
    descriptorSha256:hash(candidateDescriptorBytes),imageBytes:manifest.image_len,
    chunkBytes:manifest.chunk_size,uniqueChunks:candidateChunks.size,
    scope:'local immutable candidate, not publication evidence'};
  await fs.writeFile(path.join(output,'candidate-manifest.json'),candidateManifestBytes);
  await fs.writeFile(path.join(output,'candidate-artifacts.json'),candidateDescriptorBytes);
}
const releasePins = new Map();
// Original shipped disk-manifest identities, independently checked against R2
// before the production change. These bind the mutable legacy manifest URLs.
const manifestPins = new Map([
  ['/chunked-alpine/manifest.json',{size:411731,sha256:'b288ee4afb03a58d89156df2494f32b1b312cb190ee4076b83a01e712d341f11'}],
  ['/chunked-node-alpine/manifest.json',{size:51540,sha256:'7443bf7a53e016f8097f47c54ed7f1e9e8562307dbaaaa4b8ccb647b8727d918'}],
]);
for (const filename of sourcePaths.filter(f=>f.startsWith('artifacts'))) {
  const manifest = JSON.parse(await fs.readFile(path.join(web,filename),'utf8'));
  for (const [role, pin] of Object.entries(manifest.artifacts)) {
    const pathname=new URL(pin.url,r2+'/').pathname;
    assert.match(pin.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(pin.size)&&pin.size>0);
    releasePins.set(pathname,{role,...pin});
  }
  if(manifest.chunkedImage){
    const pin=manifest.chunkedImage, pathname='/'+pin.key;
    manifestPins.set(pathname,{size:pin.size,sha256:pin.sha256});
    if(filename==='artifacts-omarchy.json')manifestPins.set('/chunked-omarchy/manifest.json',{size:pin.size,sha256:pin.sha256});
  }
}
report.manifestPins=Object.fromEntries(manifestPins);
const verifiedReleaseFiles = new Set();
const remoteChunks = new Map();
const remoteAssets = new Map();
async function fetchOriginal(pathname) {
  if(!remoteAssets.has(pathname))remoteAssets.set(pathname,(async()=>{
    const remote=await fetch(r2+pathname,{signal:AbortSignal.timeout(180000)});
    assert.equal(remote.status,200,pathname+' original R2 status');
    return Buffer.from(await remote.arrayBuffer());
  })());
  return remoteAssets.get(pathname);
}
function checkPin(bytes,pin,pathname) {
  assert.equal(bytes.length,pin.size,pathname+' original extent');
  assert.equal(hash(bytes),pin.sha256,pathname+' original digest');
}
async function serveFile(response, filename, pathname) {
  const stat = await fs.stat(filename);
  assert.ok(stat.isFile());
  const pin = releasePins.get(pathname);
  if (pin && !verifiedReleaseFiles.has(filename)) {
    const bytes = await fs.readFile(filename);
    assert.equal(bytes.length,pin.size,pathname+' size');
    assert.equal(hash(bytes),pin.sha256,pathname+' digest');
    verifiedReleaseFiles.add(filename);
  }
  response.writeHead(200, {'Content-Length':stat.size,
    'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
      '.json':'application/json','.wasm':'application/wasm','.css':'text/css'})[path.extname(filename)]||'application/octet-stream',
    'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin',
    'Cross-Origin-Embedder-Policy':'require-corp'});
  createReadStream(filename).pipe(response);
}
server=createServer(async (request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const record={phase,method:request.method,pathname,time:Date.now()}; report.requests.push(record);
  try {
    if(pathname==='/favicon.ico'){response.writeHead(204).end();record.status=204;return;}
    if(candidateDirectory&&pathname==='/artifacts-omarchy-virgl.json'){
      record.status=200;record.source='local-immutable-candidate-descriptor';
      record.sha256=hash(candidateDescriptorBytes);record.size=candidateDescriptorBytes.length;
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(candidateDescriptorBytes);return;
    }
    const chunk=pathname.match(/^\/(chunked-(?:alpine|node-alpine|omarchy))\/chunks\/([a-f0-9]{64})\.bin$/);
    if(chunk){
      const isCandidate=chunk[1]==='chunked-omarchy'&&candidateChunks.has(chunk[2]);
      const filename=isCandidate?path.join(candidateDirectory,'chunks',chunk[2]+'.bin')
        :path.join(releaseCache,chunk[1],'chunks',chunk[2]+'.bin');
      let bytes=await fs.readFile(filename).catch(()=>null);
      if(isCandidate)assert.ok(bytes,pathname+' immutable candidate chunk exists');
      if(!bytes){
        record.source='production-r2';
        if(!remoteChunks.has(pathname))remoteChunks.set(pathname,(async()=>{
          const remote=await fetch(r2+pathname,{signal:AbortSignal.timeout(60000)});
          assert.equal(remote.status,200,pathname+' production status');
          const value=Buffer.from(await remote.arrayBuffer());assert.equal(hash(value),chunk[2]);return value;
        })());
        bytes=await remoteChunks.get(pathname);
      }else record.source=isCandidate?'pinned-local-candidate-chunk':'pinned-local-production-chunk';
      assert.equal(hash(bytes),chunk[2],pathname+' chunk digest');
      record.status=200;record.size=bytes.length;record.sha256=chunk[2];
      response.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}).end(bytes);return;
    }
    const manifest=pathname.match(/^\/(chunked-(?:alpine|node-alpine|omarchy))\/manifest(?:-([a-f0-9]{64}))?\.json$/);
    if(manifest){
      if(candidateDirectory&&manifest[1]==='chunked-omarchy'&&manifest[2]===candidateManifestHash){
        record.status=200;record.source='local-immutable-candidate-manifest';
        record.sha256=candidateManifestHash;record.size=candidateManifestBytes.length;
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(candidateManifestBytes);return;
      }
      const pin=manifestPins.get(pathname);assert.ok(pin,pathname+' original manifest identity');
      if(manifest[2])assert.equal(pin.sha256,manifest[2]);
      let bytes=await fs.readFile(path.join(releaseCache,manifest[1],'manifest.json')).catch(()=>null);
      if(!bytes||bytes.length!==pin.size||hash(bytes)!==pin.sha256){
        bytes=await fetchOriginal(pathname);record.source='production-r2';
      }else record.source='pinned-local-production-manifest';
      checkPin(bytes,pin,pathname);
      record.status=200;record.size=bytes.length;record.sha256=hash(bytes);
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(bytes);return;
    }
    if(pathname.startsWith('/releases/')){
      const pin=releasePins.get(pathname);assert.ok(pin,pathname+' original release identity');
      let bytes=await fs.readFile(path.join(releaseCache,pathname.slice('/releases/'.length))).catch(()=>null);
      if(!bytes){bytes=await fetchOriginal(pathname);record.source='production-r2';}
      else record.source='pinned-local-production-release';
      checkPin(bytes,pin,pathname);record.status=200;record.size=bytes.length;record.sha256=pin.sha256;
      response.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}).end(bytes);return;
    }
    let filename;
    filename=path.join(web,pathname==='/app'||pathname==='/app.html'
      ? web.endsWith('/dist')?'app.html':'index.html' : pathname==='/index.html'?'index.html':pathname);
    assert.ok(filename.startsWith(repo+'/'), 'asset outside workspace');
    await serveFile(response,filename,pathname);record.status=200;
  }catch(error){record.status=404;record.error=String(error);response.writeHead(404).end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
function observeOriginalWorker(){
  globalThis.__fastBootCritic={events:[],serial:'',workerBoots:[],errors:[],wire:[],timerGaps:[],wireTotals:{}};
  const note = (direction, message) => {
    const data = globalThis.__fastBootCritic, type = message?.type || 'unknown';
    const key = direction + ':' + type; data.wireTotals[key] = (data.wireTotals[key] || 0) + 1;
    data.wire.push({time:performance.now(),direction,type,id:message?.id,method:message?.method,
      infoType:message?.info?.type,frameType:message?.frame?.type});
    if (data.wire.length > 4096) data.wire.splice(0,1024);
  };
  let previousTimer = performance.now();
  setInterval(() => {
    const current = performance.now(), gap = current - previousTimer; previousTimer = current;
    if (gap > 1000) {
      const data = globalThis.__fastBootCritic; data.timerGaps.push({time:current,gap,hidden:document.hidden});
      if (data.timerGaps.length > 128) data.timerGaps.shift();
    }
  },250);
  const evidence=globalThis.__fastBootCritic;
  for(const type of ['wvm:guest-state','wvm:guest-progress','wvm:desktop-ready','wvm:guest-error'])
    globalThis.addEventListener(type,event=>evidence.events.push({type,detail:event.detail,time:performance.now()}));
  const original=Worker.prototype.postMessage,seen=new WeakSet();
  Worker.prototype.postMessage=function(message,...rest){
    if(!seen.has(this)){
      seen.add(this);const decoder=new TextDecoder();
      this.addEventListener('message',event=>{
        note('receive',event.data);
        if(event.data?.type==='output')evidence.serial+=decoder.decode(new Uint8Array(event.data.buffer),{stream:true});
        if(['fatal','error'].includes(event.data?.type))evidence.errors.push(String(event.data.error));
        if(event.data?.type==='gpu-event'&&globalThis.__recordFastBootGpuEvent)
          void globalThis.__recordFastBootGpuEvent(event.data.info);
      });
    }
    note('send',message);
    if(message?.type==='boot')evidence.workerBoots.push({time:performance.now(),options:message.opts});
    return original.call(this,message,...rest);
  };
}
async function snapshot(page){
  await fs.writeFile(path.join(output,'passive-worker-timing.json'),JSON.stringify(await page.evaluate(()=>({wire:__fastBootCritic.wire,wireTotals:__fastBootCritic.wireTotals,timerGaps:__fastBootCritic.timerGaps,time:performance.now(),hidden:document.hidden})),null,2));
  return await page.evaluate(async()=>({
    restored:Boolean(window.__linux?.restoredFromBootSnapshot?.()),ready:Boolean(window.wvmDemo?.isGuestReady?.()),
    paused:await window.__linux?.isPaused?.(),events:__fastBootCritic.events,serial:__fastBootCritic.serial,
    workers:__fastBootCritic.workerBoots,workerErrors:__fastBootCritic.errors,
    wire:__fastBootCritic.wire,wireTotals:__fastBootCritic.wireTotals,timerGaps:__fastBootCritic.timerGaps,
    manifest:document.documentElement.dataset.linuxManifest,
    bootState:window.__linuxBootStateForTest?.()||null,
    display:window.__presentation?.state?.(),cursor:window.__cursor?.snapshot?.()||null,
    gpu:await window.wvmDemo?.gpuStats?.(),fetch:await window.__chunkedStats?.(),
    desktopStatus:document.querySelector('#omarchy-desktop-status')?.textContent,
    overlayHidden:document.querySelector('#omarchy-boot-overlay')?.hidden,
    databases:await indexedDB.databases(),caches:await caches.keys(),
  }));
}
// Diagnostic requests are handled only at idle capture boundaries. In particular,
// no serial RPC can overlap the trusted keyboard test. They use the same owned
// page and original public controller; no worker or guest output is substituted.
async function serviceOwnedControl(page) {
  const filename = path.join(output, 'control-request.json');
  const bytes = await fs.readFile(filename).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!bytes) return false;
  const request = JSON.parse(bytes);
  assert.match(request.id, /^[a-z0-9-]+$/);
  await fs.rename(filename, path.join(output, 'control-request-' + request.id + '.json'));
  const response = {scope: 'critic-owned original public controller', request, started: Date.now()};
  try {
    if (request.kind === 'guest-command') {
      assert.equal(typeof request.command, 'string');
      response.result = await guestCommand(page, request.command, request.timeout || 300000);
    } else if (request.kind === 'snapshot') {
      response.result = await snapshot(page);
      await page.screenshot({path: path.join(output, 'control-' + request.id + '.png'), fullPage: true});
    } else if (request.kind === 'retry-input') {
      const {verifyPublicDesktopInput} = await import('./critic-fast-boots-input.mjs');
      response.result = await verifyPublicDesktopInput(page, guestCommand, output,
        {...request.options, name: 'control-input-' + request.id});
    } else {
      assert.equal(request.kind, 'release');
      response.result = {release: true};
    }
  } catch (error) {
    response.error = error.stack || String(error);
  }
  response.finished = Date.now();
  await fs.writeFile(path.join(output, 'control-response-' + request.id + '.json'), JSON.stringify(response, null, 2));
  return request.kind === 'release';
}
async function holdOwnedFailure(page) {
  if (process.env.CRITIC_FAST_BOOT_HOLD_FAILURE !== '1') return;
  const deadline = Date.now() + 1800000;
  await fs.writeFile(path.join(output, 'control-state.json'), JSON.stringify({state: 'held-failure', deadline}));
  while (Date.now() < deadline) {
    if (await fs.stat(path.join(output, 'abort')).then(() => true, () => false)) break;
    if (await serviceOwnedControl(page)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
async function waitActualReady(page,guest,started){
  const deadline=Date.now()+(coldGpu?1800000:guest==='omarchy'?600000:300000);
  let observedAt=0;
  while(Date.now()<deadline){
    if(await fs.stat(path.join(output,'abort')).then(()=>true,()=>false))throw Error('Owned capture stopped by its abort file');
    const state=await page.evaluate(()=>({ready:window.wvmDemo?.isGuestReady?.(),
      restored:window.__linux?.restoredFromBootSnapshot?.(),errors:__fastBootCritic?.errors,
      desktop:__fastBootCritic?.events.some(e=>e.type==='wvm:desktop-ready'),
      workerBoots:__fastBootCritic?.workerBoots.length,
      serialTail:__fastBootCritic?.serial.slice(-600),
      uiStatus:document.querySelector('#status')?.textContent,
      guestError:document.querySelector('#os-launcher-status')?.textContent,
      coreReady:window.__ready,gpuQualified:document.documentElement.dataset.gpuQualified}));
    assert.deepEqual(state.errors||[],[],guest+' worker failure');
    if(/linux worker fatal|cannot boot:/i.test(state.uiStatus||''))throw Error(state.uiStatus);
    if(coldGpu&&state.ready&&await serviceOwnedControl(page))throw Error('Owned capture released during startup');
    if(state.ready&&(coldGpu?state.gpuQualified==='true':state.restored)&&(guest!=='omarchy'||state.desktop))return;
    if(coldGpu&&Date.now()-observedAt>30000){
      observedAt=Date.now();const full=await snapshot(page);
      await fs.writeFile(path.join(output,'heartbeat.json'),JSON.stringify({phase,elapsedMs:Date.now()-started,state:full},null,2));
      await page.screenshot({path:path.join(output,'progress.png'),fullPage:true});
      if(full.gpu?.lost||(full.gpu?.counters?.failed??0)>0)throw Error('Actual accelerated guest renderer failed: '+JSON.stringify(full.gpu));
    }
    await new Promise(r=>setTimeout(r,1000));
    if((Date.now()-started)%15000<1000)console.log(JSON.stringify({phase,elapsedMs:Date.now()-started,...state}));
  }
  throw Error(guest+' actual '+(coldGpu?'cold GPU launch':'fast-boot')+'/desktop readiness deadline exceeded');
}
async function guestCommand(page,command,timeout=120000){
  return await page.evaluate(async({command,timeout})=>window.wvmDemo.run(command,timeout),{command,timeout});
}
try{
  browser=await chromium.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu']});
  if(coldGpu){const hardware=await(await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
    await fs.writeFile(path.join(output,'hardware.json'),JSON.stringify(hardware,null,2));}
  for(const guest of guests){
    assert.ok(['busybox','alpine','node-alpine','omarchy'].includes(guest));
    const context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'allow'});
    await context.addInitScript(observeOriginalWorker);
    const page=activePage=await context.newPage();
    if(gpuTrace)await page.exposeFunction('__recordFastBootGpuEvent',event=>{
      const body=JSON.stringify(event)+'\n';
      gpuRecording=gpuRecording.then(()=>fs.appendFile(path.join(output,'gpu.ndjson'),body));
      return gpuRecording;
    });
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));
    page.on('console',message=>{if(message.type()==='error'&&!/favicon\.ico/.test(message.location().url||''))pageErrors.push(message.text());});
    if(coldGpu)assert.equal(guest,'omarchy');
    const query=new URLSearchParams({guest,gpu:coldGpu?'1':'0',assetBase:origin,omarchyAssetBase:origin});
    if(gpuTrace){query.set('testHooks','1');query.set('gpuTrace','1');query.set('workerHeartbeatTimeoutMs','10000');}
    if(guest==='omarchy')query.set('desktop','1');
    const url=origin+'/app?'+query+'#ide';
    for(const round of coldGpu?['initial']:['initial','repeat']){
      phase=guest+'-'+round;let started=Date.now();
      let repeatCheckpoint;
      if(round==='initial')await page.goto(url);
      else {
        if(saveOnRepeat&&['alpine','node-alpine'].includes(guest)) {
          // Guest reads can dirty atime/history and advance the durable disk.
          // Save the live RAM/disk pair through the public paused/flush boundary
          // instead of trying the old shipped RAM against a changed overlay.
          await page.evaluate(()=>window.__linux.pause());
          repeatCheckpoint=await page.evaluate(()=>window.wvmDemo.snapshotSave());
          repeatCheckpoint.decision=await page.evaluate(()=>window.__snapshotDecision());
          repeatCheckpoint.generation=await page.evaluate(()=>window.__snapshotGeneration());
          repeatCheckpoint.paused=await page.evaluate(()=>window.__linux.isPaused());
          await fs.writeFile(path.join(output,phase+'-checkpoint.json'),JSON.stringify(repeatCheckpoint,null,2));
          assert.equal(repeatCheckpoint.ok,true,phase+' public coherent snapshot save');
          assert.equal(repeatCheckpoint.decision,'resume');
          assert.equal(repeatCheckpoint.paused,true,phase+' saved pair frozen until reload');
        }
        started=Date.now();
        await page.reload();
      }
      await waitActualReady(page,guest,started);
      const restoredMs=Date.now()-started;
      const command=guest==='node-alpine'
        ? `node -e 'console.log("FAST_NODE_"+(6*7)+"_PASS");console.log(process.version)'`
        : `printf 'FAST_${guest.toUpperCase().replaceAll('-','_')}_%s_PASS\n' "$((6*7))"; uname -m`;
      const result=await guestCommand(page,command,guest==='omarchy'?300000:120000);
      assert.equal(result.exit,0,phase+' live guest command');
      assert.match(result.stdout,guest==='node-alpine'?/FAST_NODE_42_PASS/:/FAST_.*_42_PASS/);
      const state=await snapshot(page);
      assert.equal(state.restored,!coldGpu,phase+' selected cold/warm path');
      assert.ok(state.workers.length>=1,phase+' actual worker');
      assert.deepEqual(state.workerErrors,[]);
      assert.deepEqual(pageErrors,[],phase+' browser errors');
      if(guest==='omarchy'){
        assert.ok(state.display?.successfulPresents>0,phase+' actual guest scanout');
        assert.equal(state.overlayHidden,true,phase+' desktop ready surface');
        assert.equal(state.gpu?.qualified??false,coldGpu,phase+' selected graphics route');
        if(coldGpu){
          assert.ok(state.gpu.counters?.completed>0,phase+' actual GPU completion');
          assert.ok(state.gpu.counters?.draws>0,phase+' actual GPU draws');
          const egl=await guestCommand(page,'/opt/virgl-proof/eglinfo -B -p gbm -a gles',300000);
          assert.equal(egl.exit,0);assert.match(egl.stdout,/virgl\s*\(/);assert.doesNotMatch(egl.stdout,/llvmpipe|softpipe/i);
          report.gpuEgl=egl;
          const {verifyPublicDesktopInput}=await import('./critic-fast-boots-input.mjs');
          report.publicDesktopInput=await verifyPublicDesktopInput(page,guestCommand,output);
        }
      }
      const screenshot=phase+'.png';await page.screenshot({path:path.join(output,screenshot),fullPage:true});
      report.phases.push({phase,guest,round,url,restoredMs,liveCommandMs:Date.now()-started-restoredMs,result,state,screenshot,repeatCheckpoint});
      await fs.writeFile(path.join(output,phase+'.json'),JSON.stringify(report.phases.at(-1),null,2));
      console.log(JSON.stringify({phase,restoredMs,result,display:state.display?.successfulPresents,databases:state.databases}));
    }
    if(snapshotPersistence&&['alpine','node-alpine'].includes(guest)){
      phase=guest+'-persistence';const marker='/root/critic-fast-boot-'+guest;
      const write=await guestCommand(page,`printf 'DURABLE_${guest}_42_PASS' > ${marker}; sync`,180000);
      assert.equal(write.exit,0);
      await page.evaluate(()=>window.__linux.pause());
      const checkpoint=await page.evaluate(()=>window.wvmDemo.snapshotSave());
      assert.equal(checkpoint.ok,true,phase+' public durable snapshot save');
      const before=await page.evaluate(()=>window.__snapshotGeneration());
      assert.equal(await page.evaluate(()=>window.__snapshotDecision()),'resume');
      const started=Date.now();await page.reload();await waitActualReady(page,guest,started);
      const read=await guestCommand(page,`cat ${marker}`,180000);
      assert.equal(read.exit,0);assert.equal(read.stdout.trim(),'DURABLE_'+guest+'_42_PASS');
      const generation=await page.evaluate(()=>window.__snapshotGeneration());
      assert.equal(generation,before,phase+' durable generation preserved');
      const state=await snapshot(page);
      report.phases.push({phase,restoredMs:Date.now()-started,write,read,before,generation,state,checkpoint});
      await fs.writeFile(path.join(output,phase+'.json'),JSON.stringify(report.phases.at(-1),null,2));
      console.log(JSON.stringify({phase,restoredMs:Date.now()-started,before,generation,read}));
    }
    await page.evaluate(()=>window.__linuxCtl?.stop?.()).catch(()=>{});
    await context.close();activePage=null;
  }
  for(const [filename,digest]of Object.entries(report.sourceHashes))
    assert.equal(hash(await fs.readFile(path.join(web,filename))),digest,'source changed during capture: '+filename);
  if(candidateDirectory)assert.equal(hash(await fs.readFile(path.join(candidateDirectory,'manifest.json'))),
    candidateManifestHash,'candidate image manifest changed during capture');
  report.status='passed';
}catch(error){
  report.status='failed';report.failedPhase=phase;report.errors.push(error.stack||String(error));process.exitCode=1;
  if(activePage){report.failureState=await snapshot(activePage).catch(error=>({error:String(error)}));await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}
  console.error(error.stack);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if(activePage)await holdOwnedFailure(activePage);
}finally{
  await browser?.close();
  await gpuRecording;
  if(gpuTrace){
    const file=path.join(output,'gpu.ndjson'),digest=createHash('sha256');
    for await(const bytes of createReadStream(file))digest.update(bytes);
    report.gpuRecording={path:'gpu.ndjson',bytes:(await fs.stat(file)).size,sha256:digest.digest('hex')};
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
