#!/usr/bin/env node
// Independent acceptance: unchanged shipped pairs, real app UI, workers and Wasm.
// Local assets are hash-bound originals; missing disk chunks are fetched from the
// production R2 origin and verified before serving. No guest output is fabricated.
import assert from 'node:assert/strict';
import {assertPublicDesktopFinal} from './critic-fast-boots-final.mjs';
import {verifyWarmGpuPixels} from './critic-warm-pixels.mjs';
import {expectedPublishedSource} from './published-source.mjs';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
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
const warmGpu = process.env.CRITIC_FAST_BOOT_GPU === 'warm';
const acceleratedGpu = coldGpu || warmGpu;
const localGpuPairFile = process.env.CRITIC_FAST_BOOT_GPU_PAIR_FILE;
const candidateDirectory = process.env.CRITIC_FAST_BOOT_IMAGE_DIRECTORY
  ? path.resolve(process.env.CRITIC_FAST_BOOT_IMAGE_DIRECTORY) : null;
const snapshotPersistence = process.env.CRITIC_FAST_BOOT_PERSISTENCE !== '0';
const saveOnRepeat = process.env.CRITIC_FAST_BOOT_SAVE_ON_REPEAT === '1';
const gpuTrace = process.env.CRITIC_FAST_BOOT_GPU_TRACE === '1';
const captureGpuPair = process.env.CRITIC_FAST_BOOT_CAPTURE_GPU_PAIR === '1';
const applicationWorkload = process.env.CRITIC_FAST_BOOT_APPLICATIONS === '1';
const remoteUrl = process.env.CRITIC_FAST_BOOT_URL;
if(captureGpuPair||localGpuPairFile)assert.ok(acceleratedGpu&&!remoteUrl,'GPU factory capture requires the owned local accelerated session');
if (remoteUrl) {
  const url = new URL(remoteUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/');
  assert.equal(url.search + url.hash + url.username + url.password, '');
  assert.equal(candidateDirectory, null, 'live acceptance uses the published image');
}
let gpuRecording = Promise.resolve();
await fs.mkdir(output, {recursive:false});
if(gpuTrace)await fs.writeFile(path.join(output,'gpu.ndjson'),'');
const report = {status:'running', scope:'actual production UI fast boots and repeat launches',
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  webRoot:web, releaseCache, saveOnRepeat, gpuTrace, remoteUrl, warmGpu, phases:[], requests:[], remoteFetches:[], liveSources:[], sourceHashes:{}, harnessHashes:{}, errors:[]};
for(const filename of ['critic-fast-boots.mjs','critic-fast-boots-input.mjs','critic-fast-boots-bar-content.mjs','critic-fast-boots-final.mjs','critic-desktop-actions.mjs','critic-warm-pixels.mjs','published-source.mjs']){
  const bytes=await fs.readFile(path.join(repo,'tools/virgl-production',filename));
  report.harnessHashes[filename]=hash(bytes);
  await fs.mkdir(path.join(output,'executed-harness'),{recursive:true});
  await fs.writeFile(path.join(output,'executed-harness',filename),bytes);
}
const applicationExecutables={};
if(applicationWorkload){
  assert.ok(acceleratedGpu,'native application acceptance uses the qualified GPU route');
  const bytes=await fs.readFile(path.join(repo,'tools/virgl-production/omarchy-applications.mjs'));
  report.harnessHashes['omarchy-applications.mjs']=hash(bytes);
  await fs.writeFile(path.join(output,'executed-harness/omarchy-applications.mjs'),bytes);
  const inventoryFile=path.resolve(process.env.CRITIC_FAST_BOOT_APPLICATION_INVENTORY||path.join(repo,'target/evidence/omarchy-native-app-image-final01/runtime-elf.json'));
  const inventoryBytes=await fs.readFile(inventoryFile),inventory=JSON.parse(inventoryBytes);
  for(const filename of ['usr/lib/chromium/chromium','usr/lib/libreoffice/program/soffice.bin','usr/bin/node']){
    const entries=inventory.filter(row=>row.path===filename);assert.equal(entries.length,1);
    const entry=entries[0];assert.equal(entry.machine,243);assert.match(entry.sha256,/^[0-9a-f]{64}$/);
    applicationExecutables['/'+filename]=entry.sha256;
  }
  report.applicationImageInventory={path:inventoryFile,sha256:hash(inventoryBytes),executables:applicationExecutables};
  await fs.writeFile(path.join(output,'input-runtime-elf.json'),inventoryBytes);
}
let browser, server, activePage, phase = 'inventory';
const sourcePaths = ['index.html','main.js','loader.js','linux-worker.js','linux-worker-protocol.js',
  'linux-worker-host.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','src/sink/presentation.js',
  'artifacts.json','artifacts-alpine.json','artifacts-node-alpine.json','artifacts-omarchy.json'];
if (web.endsWith('/dist')) sourcePaths[0]='app.html';
if(acceleratedGpu)sourcePaths.push('artifacts-omarchy-virgl.json');
for (const filename of sourcePaths){
  const bytes=await fs.readFile(path.join(web,filename));
  report.sourceHashes[filename]=hash(bytes);
  await fs.mkdir(path.dirname(path.join(output,'executed-source',filename)),{recursive:true});
  await fs.writeFile(path.join(output,'executed-source',filename),bytes);
}
let candidateManifestBytes, candidateDescriptorBytes, candidateManifestHash;
const candidateChunks = new Set();
if(candidateDirectory){
  assert.ok(acceleratedGpu, 'local accelerated image requires the GPU route');
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
let localGpuPair;
if(localGpuPairFile){
  localGpuPair=await fs.readFile(path.resolve(localGpuPairFile));
  const descriptor=JSON.parse(candidateDescriptorBytes??await fs.readFile(path.join(web,'artifacts-omarchy-virgl.json')));
  descriptor.artifacts.gpuCheckpoint={url:'/__bootstrap-gpu-pair',size:localGpuPair.length,sha256:hash(localGpuPair)};
  candidateDescriptorBytes=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');
  report.localGpuPair={file:path.resolve(localGpuPairFile),bytes:localGpuPair.length,sha256:hash(localGpuPair),scope:'owned source for ready-factory capture; not final publication'};
  await fs.writeFile(path.join(output,'bootstrap-artifacts.json'),candidateDescriptorBytes);
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
let factoryUpload=null;
const remoteChunks = new Map();
const remoteAssets = new Map();
async function fetchOriginal(pathname) {
  if(!remoteAssets.has(pathname))remoteAssets.set(pathname,(async()=>{
    const pin=releasePins.get(pathname);
    // Deployment publishes large releases at content-addressed keys. A clean
    // checkout has no ignored snapshot cache and must resolve those same bytes.
    // Small historical assets can still exist only at their legacy URL; either
    // path remains subject to the original manifest's exact size/hash check.
    const routes=pin?['/sha256/'+pin.sha256+pathname,pathname]:[pathname];
    for(const route of routes){
      const remote=await fetch(r2+route,{signal:AbortSignal.timeout(180000)});
      const receipt={pathname,url:r2+route,status:remote.status};report.remoteFetches.push(receipt);
      if(remote.status===404&&route!==routes.at(-1)){await remote.body?.cancel();continue;}
      assert.equal(remote.status,200,route+' original R2 status');
      const bytes=Buffer.from(await remote.arrayBuffer());
      if(pin)checkPin(bytes,pin,pathname);
      Object.assign(receipt,{bytes:bytes.length,sha256:hash(bytes)});
      return bytes;
    }
    throw Error('No original R2 asset for '+pathname);
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
if (!remoteUrl) server=createServer(async (request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const record={phase,method:request.method,pathname,time:Date.now()}; report.requests.push(record);
  try {
    if(pathname==='/favicon.ico'){response.writeHead(204).end();record.status=204;return;}
    const upload=pathname.match(/^\/__factory-gpu-pair\/(\d+)\/(\d+)$/);
    if(captureGpuPair&&request.method==='POST'&&upload){
      const offset=Number(upload[1]),total=Number(upload[2]);
      assert.ok(Number.isSafeInteger(total)&&total>0&&total<=512*1024*1024,'factory pair budget');
      if(!factoryUpload){assert.equal(offset,0);factoryUpload={file:await fs.open(path.join(output,'factory.wvgpair'),'wx'),hash:createHash('sha256'),written:0,total};}
      assert.equal(total,factoryUpload.total);assert.equal(offset,factoryUpload.written);assert.ok(factoryUpload.file,'factory already complete');
      const parts=[];let size=0;for await(const part of request){size+=part.length;assert.ok(size<=1024*1024,'bounded recorder request');parts.push(part);}
      assert.ok(size>0&&size<=total-offset);const bytes=Buffer.concat(parts);await factoryUpload.file.writeFile(bytes);factoryUpload.hash.update(bytes);factoryUpload.written+=size;
      let pin={written:factoryUpload.written,total,complete:false};
      if(factoryUpload.written===total){await factoryUpload.file.close();factoryUpload.file=null;pin={path:'factory.wvgpair',bytes:total,sha256:factoryUpload.hash.digest('hex'),complete:true};await fs.writeFile(path.join(output,'factory-upload.json'),JSON.stringify(pin,null,2)+'\n');}
      record.status=200;record.uploadBytes=size;record.written=factoryUpload.written;
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(pin));return;
    }
    if(localGpuPair&&pathname==='/__bootstrap-gpu-pair'){record.status=200;record.size=localGpuPair.length;response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':localGpuPair.length}).end(localGpuPair);return;}
    if(candidateDescriptorBytes&&pathname==='/artifacts-omarchy-virgl.json'){
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
      record.status=200;record.size=bytes.length;record.sha256=chunk[2];record.elapsedMs=Date.now()-record.time;
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
if (server) await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=remoteUrl ? new URL(remoteUrl).origin : 'http://127.0.0.1:'+server.address().port;
let expectedGpuPair;
async function readExpectedGpuPair() {
  if (!warmGpu) return;
  const descriptor = JSON.parse(candidateDescriptorBytes ?? await fs.readFile(path.join(web, 'artifacts-omarchy-virgl.json')));
  const pin = descriptor.artifacts.gpuCheckpoint;
  assert.ok(pin, 'warm acceptance requires the pinned actual GPU pair');
  const pathname = new URL(pin.url, r2 + '/').pathname;
  const relative = pathname.replace(/^\/sha256\/[a-f0-9]{64}/, '').replace(/^\/releases\//, '');
  let bytes = localGpuPair ?? await fs.readFile(path.join(releaseCache, relative)).catch(() => null);
  if (!bytes) bytes = await fetchOriginal(pathname);
  checkPin(bytes, pin, pathname);
  assert.equal(bytes.subarray(0, 8).toString(), 'WVGPAIR1');
  assert.equal(bytes.readUInt32LE(8), 1);
  assert.equal(bytes.readUInt32LE(12), bytes.length - 48);
  assert.equal(hash(bytes.subarray(0, -32)), bytes.subarray(-32).toString('hex'));
  const {decodeCheckpointData} = await import(pathToFileURL(path.join(web, 'renderer/virgl-command/checkpoint-codec.mjs')));
  const metadata = decodeCheckpointData(new Uint8Array(bytes.subarray(16, -32)));
  const {GPU_CHECKPOINT_BUILD_ID} = await import(pathToFileURL(path.join(web, 'gpu-checkpoint-build.js')));
  assert.equal(metadata.schema, 'production-gpu-pair-v1');
  assert.equal(metadata.identity.buildId, GPU_CHECKPOINT_BUILD_ID);
  assert.ok(['icount', 'paced-icount'].includes(metadata.clockState.mode));
  expectedGpuPair = {pin, identity: metadata.identity, profile: metadata.profile, clockState: metadata.clockState,
    epoch: metadata.epoch, parts: Object.fromEntries(Object.entries(metadata.parts).map(([name, part]) => {
      assert.equal(part.encoding, 'gzip');
      assert.equal(hash(part.bytes), part.compressedSha256, name + ' stored component digest');
      return [name, {encoding: part.encoding, compressedBytes: part.bytes.length, compressedSha256: part.compressedSha256,
        uncompressedBytes: part.length, uncompressedSha256: part.sha256}];
    }))};
  report.expectedGpuPair = expectedGpuPair;
  await fs.writeFile(path.join(output, 'expected-gpu-pair.json'), JSON.stringify(expectedGpuPair, null, 2) + '\n');
}
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
    display:window.__presentation?.state?.(),cursor:window.__cursor?.state?.()||null,
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
    } else if (request.kind === 'desktop-input') {
      assert.ok(Array.isArray(request.actions)&&request.actions.length<=100,'bounded owned-page diagnostic input');
      const {typeGuestText}=await import('./omarchy-applications.mjs');
      for(const action of request.actions){
        if(action.kind==='press'){
          assert.ok(typeof action.key==='string'&&action.key.length<=100);
          await page.keyboard.press(action.key,{delay:100});
        }else if(action.kind==='text'){
          assert.ok(typeof action.text==='string'&&action.text.length<=2048);await typeGuestText(page,action.text);
        }else{
          assert.equal(action.kind,'click');assert.ok(Number.isFinite(action.x)&&Number.isFinite(action.y));
          await page.mouse.click(action.x,action.y,{delay:120});
        }
      }
      response.result={actions:request.actions,scope:'trusted Playwright input in this critic-owned page'};
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
      bootError:window.__linuxBootStateForTest?.()?.lastBootError ?? null,
      guestError:document.querySelector('#os-launcher-status')?.textContent,
      coreReady:window.__ready,gpuQualified:document.documentElement.dataset.gpuQualified}));
    assert.deepEqual(state.errors||[],[],guest+' worker failure');
    if(/linux worker fatal|cannot boot:/i.test(state.uiStatus||''))throw Error(state.uiStatus);
    if(state.bootError)throw Error(state.bootError);
    if(/GPU desktop could not start/i.test((state.uiStatus||'')+' '+(state.guestError||'')))throw Error(state.uiStatus||state.guestError);
    if(coldGpu&&state.ready&&await serviceOwnedControl(page))throw Error('Owned capture released during startup');
    if(state.ready&&(acceleratedGpu?state.gpuQualified==='true'&&state.restored===warmGpu:state.restored)&&(guest!=='omarchy'||state.desktop))return;
    if(acceleratedGpu&&Date.now()-observedAt>30000){
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
function gpuWarmTiming(state,round){
  const progress=state.events.filter(event=>event.type==='wvm:guest-progress'&&event.detail.phase.startsWith('gpuCheckpoint:'));
  const first=progress[0],last=progress.at(-1);
  assert.ok(first&&last,'original checkpoint read progress is recorded');
  assert.equal(last.detail.loaded,last.detail.total,'original checkpoint read finished');
  const sources=[...new Set(progress.map(event=>event.detail.phase.includes('reading cache')?'cache':'network'))];
  assert.deepEqual(sources,[round==='initial'?'network':'cache'],'fresh load downloads and repeat reads verified CacheStorage');
  const restored=state.events.find(event=>event.type==='wvm:guest-state'&&event.detail.state==='restored');
  const desktop=state.events.find(event=>event.type==='wvm:desktop-ready');
  assert.ok(restored&&desktop,'original restore and fresh desktop milestones are recorded');
  assert.ok(first.time<=last.time&&last.time<=restored.time&&restored.time<=desktop.time);
  return {source:sources[0],checkpointBytes:last.detail.total,
    checkpointReadMs:last.time-first.time,afterCheckpointReadToRestoredMs:restored.time-last.time,
    restoredToDesktopMs:desktop.time-restored.time,navigationToDesktopMs:desktop.time,
    scope:'Observed original progress/milestone timestamps; first network read and verified repeat cache are separate'};
}
try{
  await readExpectedGpuPair();
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  if(acceleratedGpu){const session=await browser.newBrowserCDPSession(), hardware=await session.send('SystemInfo.getInfo');
    const commandLine=await session.send('Browser.getBrowserCommandLine');
    assert.equal(hardware.gpu.featureStatus.webgl2??hardware.gpu.featureStatus.webgl,'enabled');
    assert.ok(!commandLine.arguments.some(value=>/swiftshader|llvmpipe|softpipe|--disable-gpu(?:$|=)/i.test(value)));
    await fs.writeFile(path.join(output,'hardware.json'),JSON.stringify({hardware,commandLine},null,2));}
  for(const guest of guests){
    assert.ok(['busybox','alpine','node-alpine','omarchy'].includes(guest));
    const context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'allow'});
    await context.addInitScript(observeOriginalWorker);
    const page=activePage=await context.newPage();
    // Passive document lifecycle evidence. Unexpected reloads remain failures;
    // recording them must never retry, pause, or redirect the running guest.
    const lifecycle = await context.newCDPSession(page);
    const recordLifecycle = (type, event) => {
      const row = {phase, time: Date.now(), type, event};
      (report.pageLifecycle ??= []).push(row);
    };
    await lifecycle.send('Page.enable');
    await lifecycle.send('Network.enable');
    for (const type of ['Page.frameRequestedNavigation', 'Page.frameScheduledNavigation',
      'Page.frameStartedNavigating', 'Page.frameNavigated'])
      lifecycle.on(type, event => recordLifecycle(type, event));
    lifecycle.on('Network.requestWillBeSent', event => {
      if (event.type === 'Document') recordLifecycle('Network.documentRequest', event);
    });
    page.on('crash', () => recordLifecycle('page.crash', {url: page.url()}));
    page.on('close', () => recordLifecycle('page.close', {url: page.url()}));
    page.on('framenavigated', frame => recordLifecycle('page.framenavigated', {
      url: frame.url(), main: frame === page.mainFrame(),
    }));
    const liveReads = [];
    const liveReadErrors = [];
    const workerShellReceipts = [];
    const shellVersion = remoteUrl ? (await fs.readFile(path.join(web, 'sw.js'), 'utf8')).match(/const VERSION = "([a-f0-9]{12})";/)?.[1] : null;
    if (remoteUrl) assert.ok(shellVersion, 'frozen production shell cache version');
    async function captureWorkerShellSources() {
      for (const receipt of workerShellReceipts.filter(item => !item.acquired)) {
        // Chromium cannot expose this dedicated-worker body through page CDP.
        // The observed SW response came from this exact cache-first shell entry.
        const cached = await page.evaluate(async ({cacheName, url}) => {
          if (!(await caches.keys()).includes(cacheName)) return null;
          const response = await (await caches.open(cacheName)).match(url);
          if (!response) return null;
          return {cacheName, url: response.url, status: response.status,
            controller: navigator.serviceWorker.controller?.scriptURL ?? null,
            bytes: Array.from(new Uint8Array(await response.arrayBuffer()))};
        }, {cacheName: 'wasm-vm-shell-' + shellVersion, url: receipt.url});
        assert.ok(cached?.controller, 'original worker response has a controlling service worker');
        assert.equal(cached.status, receipt.status); assert.equal(cached.url, receipt.url);
        const bytes = Buffer.from(cached.bytes), expected = await fs.readFile(path.join(web, receipt.path));
        assert.equal(hash(bytes), hash(expected), 'actual cached worker bootstrap source');
        const bodyPath = path.join('live-source', receipt.path);
        await fs.mkdir(path.dirname(path.join(output, bodyPath)), {recursive: true});
        await fs.writeFile(path.join(output, bodyPath), bytes);
        Object.assign(receipt, {acquired: true, acquisition: 'original-service-worker-cache', cacheName: cached.cacheName,
          controller: cached.controller, bodyPath, bytes: bytes.length, sha256: hash(bytes)});
        report.liveSources.push({...receipt});
      }
    }
    if (remoteUrl) page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== origin || !/\.(?:m?js|json|wasm|html|css)$/.test(url.pathname) && !['/app','/'].includes(url.pathname)) return;
      liveReads.push((async () => {
        const relative = url.pathname === '/app' ? 'app.html' : url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        try {
          if (relative === 'linux-worker.js' && response.fromServiceWorker()) {
            const receipt = {phase, url: response.url(), path: relative, status: response.status(), fromServiceWorker: true};
            assert.equal(receipt.status, 200, 'original worker bootstrap response status');
            workerShellReceipts.push(receipt); (report.originalWorkerResponses ??= []).push(receipt); return;
          }
          assert.equal(response.status(), 200, 'published source status ' + relative);
          const bytes = await response.body();
          const expected = expectedPublishedSource(relative, await fs.readFile(path.join(web, relative)));
          assert.equal(hash(bytes), hash(expected), 'published source drift ' + relative);
          const bodyPath = path.join('live-source', relative);
          await fs.mkdir(path.dirname(path.join(output, bodyPath)), {recursive:true});
          await fs.writeFile(path.join(output, bodyPath), bytes);
          report.liveSources.push({url:response.url(), path:relative, bodyPath, bytes:bytes.length, sha256:hash(bytes), fromServiceWorker:response.fromServiceWorker()});
        } catch (error) { liveReadErrors.push(relative + ': ' + String(error)); }
      })());
    });
    if(gpuTrace)await page.exposeFunction('__recordFastBootGpuEvent',event=>{
      const body=JSON.stringify(event)+'\n';
      gpuRecording=gpuRecording.then(()=>fs.appendFile(path.join(output,'gpu.ndjson'),body));
      return gpuRecording;
    });
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));
    page.on('console',message=>{if(message.type()==='error'&&!/favicon\.ico/.test(message.location().url||''))pageErrors.push(message.text());});
    if(acceleratedGpu)assert.equal(guest,'omarchy');
    const query=new URLSearchParams({guest});
    if(!warmGpu)query.set('gpu',coldGpu?'1':'0');
    if(coldGpu)query.set('noSnapshot','1');
    if (!remoteUrl) { query.set('assetBase',origin); query.set('omarchyAssetBase',origin); }
    if(gpuTrace){query.set('testHooks','1');query.set('gpuTrace','1');query.set('workerHeartbeatTimeoutMs','10000');}
    if(guest==='omarchy')query.set('desktop','1');
    const url=origin+'/app?'+query+'#ide';
    for(const round of coldGpu||captureGpuPair?['initial']:['initial','repeat']){
      phase=guest+'-'+round;let started=Date.now();
      let repeatCheckpoint,phaseEgl,publicDesktopInput,publicDesktopFinal,warmPixels,warmTiming,postWorkloadInput;
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
      // The first Node exec streams original executable/library disk pages from
      // R2. Keep restore timing separate from this bounded live-command budget.
      const commandTimeoutMs=['omarchy','node-alpine'].includes(guest)?300000:120000;
      const result=await guestCommand(page,command,commandTimeoutMs);
      assert.equal(result.exit,0,phase+' live guest command');
      assert.match(result.stdout,guest==='node-alpine'?/FAST_NODE_42_PASS/:/FAST_.*_42_PASS/);
      const state=await snapshot(page);
      if(warmGpu&&!captureGpuPair)warmTiming=gpuWarmTiming(state,round);
      assert.equal(state.restored,!coldGpu,phase+' selected cold/warm path');
      assert.ok(state.workers.length>=1,phase+' actual worker');
      assert.deepEqual(state.workerErrors,[]);
      assert.deepEqual(pageErrors,[],phase+' browser errors');
      if(guest==='omarchy'){
        assert.ok(state.display?.successfulPresents>0,phase+' actual guest scanout');
        assert.equal(state.overlayHidden,true,phase+' desktop ready surface');
        assert.equal(state.gpu?.qualified??false,acceleratedGpu,phase+' selected graphics route');
        if(acceleratedGpu){
          assert.ok(state.gpu.counters?.completed>0,phase+' actual GPU completion');
          assert.ok(state.gpu.counters?.draws>0,phase+' actual GPU draws');
          const egl=await guestCommand(page,'/opt/virgl-proof/eglinfo -B -p gbm -a gles',300000);
          assert.equal(egl.exit,0);assert.match(egl.stdout,/virgl\s*\(/);assert.doesNotMatch(egl.stdout,/llvmpipe|softpipe/i);
          report.gpuEgl=egl;
          phaseEgl=egl;
          if(applicationWorkload){
            const {verifyOmarchyApplications}=await import('./omarchy-applications.mjs');
            report.applications=await verifyOmarchyApplications(page,guestCommand,output,{name:phase+'-native-applications',executables:applicationExecutables});
          }
          const {verifyPublicDesktopInput}=await import('./critic-fast-boots-input.mjs');
          const captureFactory=captureGpuPair?async({foot,barContent})=>{
            const active=await guestCommand(page,'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow',300000);assert.equal(active.exit,0);assert.equal(JSON.parse(active.stdout).pid,foot.pid,'factory captures actual Foot, not the screensaver');
            report.factoryCapture=await page.evaluate(async()=>{
              const c=window.__linuxCtl;await c.pause();
              const before={clock:await c.guestClockState(),scheduler:await c.schedulerStats(),gpu:await c.gpuStats()};
              const pair=await c.saveGpuCheckpoint();
              const after={clock:await c.guestClockState(),scheduler:await c.schedulerStats(),gpu:await c.gpuStats()};
              let pin;
              for(let at=0;at<pair.length;at+=1024*1024){
                const response=await fetch('/__factory-gpu-pair/'+at+'/'+pair.length,{method:'POST',body:pair.subarray(at,Math.min(pair.length,at+1024*1024))});if(!response.ok)throw Error('factory pair publication failed');pin=await response.json();
              }
              if(!pin?.complete)throw Error('factory pair is incomplete');await c.resume();return {before,after,pin};
            });
            assert.deepEqual(report.factoryCapture.after.clock,report.factoryCapture.before.clock);
            assert.equal(report.factoryCapture.after.scheduler.retiredInstructions,report.factoryCapture.before.scheduler.retiredInstructions);
            await page.screenshot({path:path.join(output,'factory-source.png'),fullPage:true});
            report.factoryCapture.activeWindow=JSON.parse(active.stdout);report.factoryCapture.barContent=barContent;
            await fs.writeFile(path.join(output,'factory-capture.json'),JSON.stringify(report.factoryCapture,null,2)+'\n');
            console.log(JSON.stringify({phase:'factory-captured',pin:report.factoryCapture.pin}));
          }:undefined;
          report.publicDesktopInput=await verifyPublicDesktopInput(page,guestCommand,output,{name:phase+'-public-desktop-input',initialClockMode:applicationWorkload?'paced-icount':expectedGpuPair?.clockState.mode||'icount',prepareFactory:captureGpuPair});
          if(captureFactory){
            const cleanup=await guestCommand(page,'rm -- /tmp/gpukeyboard42touch',300000);assert.equal(cleanup.exit,0);
            await captureFactory(report.publicDesktopInput);
          }
          publicDesktopInput=report.publicDesktopInput;
          if(warmGpu&&!captureGpuPair){
            warmPixels=await verifyWarmGpuPixels(page,{outputDir:output,label:phase+'-literal-pixels'});
            postWorkloadInput=await verifyPublicDesktopInput(page,guestCommand,output,{name:phase+'-post-workload-input',
              initialClockMode:'paced-icount',barActions:false,text:'touch /tmp/gpukeyboard84touch',
              markerAbsent:'test ! -e /tmp/gpukeyboard84touch',markerRead:'test -f /tmp/gpukeyboard84touch && echo TRUSTED_TOUCH_84',expected:'TRUSTED_TOUCH_84'});
          }
          report.publicDesktopFinal=await snapshot(page);
          publicDesktopFinal=report.publicDesktopFinal;
          report.publicDesktopFinal.pageErrors=[...pageErrors];
          await fs.writeFile(path.join(output,phase+'-public-desktop-final.json'),JSON.stringify(report.publicDesktopFinal,null,2)+'\n');
          assertPublicDesktopFinal(report.publicDesktopFinal);

        }
      }
      const screenshot=phase+'.png';await page.screenshot({path:path.join(output,screenshot),fullPage:true});
      await Promise.all(liveReads); await captureWorkerShellSources(); assert.deepEqual(liveReadErrors, [], 'published original source bodies');
      report.phases.push({phase,guest,round,url,restoredMs,commandTimeoutMs,liveCommandMs:Date.now()-started-restoredMs,result,state,screenshot,repeatCheckpoint,phaseEgl,publicDesktopInput,publicDesktopFinal,warmPixels,warmTiming,postWorkloadInput});
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
    await Promise.all(liveReads); await captureWorkerShellSources(); assert.deepEqual(liveReadErrors, [], 'published original source bodies');
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
  await factoryUpload?.file?.close();
  await gpuRecording;
  if(gpuTrace){
    const file=path.join(output,'gpu.ndjson'),digest=createHash('sha256');
    for await(const bytes of createReadStream(file))digest.update(bytes);
    report.gpuRecording={path:'gpu.ndjson',bytes:(await fs.stat(file)).size,sha256:digest.digest('hex')};
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if (server) { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
