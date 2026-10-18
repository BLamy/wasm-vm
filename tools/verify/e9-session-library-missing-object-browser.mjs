#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root = execFileSync('git',['rev-parse','--show-toplevel'],{cwd:process.cwd(),encoding:'utf8'}).trim();
const argument = name => {const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
for(const name of ['--recording-report','--web-dir','--output']) assert.ok(argument(name),'Missing '+name);
const output = path.resolve(argument('--output')), web=path.resolve(argument('--web-dir'));
const recordingReport=path.resolve(argument('--recording-report')), remote=argument('--url');
if(remote)assert.equal(remote,'https://wasm-vm.pages.dev/');
const originalBytes=await fs.readFile(recordingReport),original=JSON.parse(originalBytes);
assert.equal(original.task,'E9-T06');assert.equal(original.status,'passed');assert.deepEqual(original.errors,[]);
const originalProfile=path.join(path.dirname(recordingReport),'chromium-profile'),profile=path.join(output,'chromium-profile');
const origin=remote?new URL(remote).origin:new URL(original.url).origin;
if(!remote)assert.match(origin,/^http:\/\/127\.0\.0\.1:[0-9]+$/,'Use --url when the recording profile belongs to production');
const alpha=original.checks.alpha.id,alphaPoint=original.checks.alpha.point,beta=original.checks.beta.id;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const head=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
function clean(){assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'','source tree must be clean');}
const report={task:'E9-T06',attack:'N1 stale compatible preview loses durable point before keyboard Open',head:head(),
  prediction:'Admission rejects before owner replacement; active controller and raw tuple remain unchanged; 390px error text has no horizontal overflow',
  recordingReport,recordingReportSha256:sha(originalBytes),recordingHead:original.head,web,remote,
  started:new Date().toISOString(),status:'running',errors:[],keyboard:[],served:[],selectionSetup:'Native picker API; Open reached with Tab and activated with Enter'};
const sourceNames=['app.html','main.js','session-library.js','session-library.css','session-checkpoints.js','session-store.js','session-disk-roots.js',
  'gpu-checkpoint-build.js','linux-worker-host.js','loader.js','session-software-fixture.json','session-alpine-image.json',
  'pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm'];
async function inventory(directory){
 const files=[];
 async function visit(base){for(const item of await fs.readdir(base,{withFileTypes:true})){const p=path.join(base,item.name);
  if(item.isDirectory())await visit(p);else if(item.isFile()){const bytes=await fs.readFile(p);files.push({path:path.relative(directory,p),bytes:bytes.length,sha256:sha(bytes)});}}}
 await visit(directory);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
clean();await fs.mkdir(output,{recursive:false});
report.source_sha256={};for(const name of sourceNames)report.source_sha256[name]=sha(await fs.readFile(path.join(web,name)));
report.driver={path:fileURLToPath(import.meta.url),sha256:sha(await fs.readFile(fileURLToPath(import.meta.url)))};
const originalProfileInventory=await inventory(originalProfile);
await fs.cp(originalProfile,profile,{recursive:true,errorOnExist:true,force:false,dereference:false});
assert.deepEqual(await inventory(profile),originalProfileInventory,'profile copy differs from original');
for(const name of ['SingletonLock','SingletonCookie','SingletonSocket'])await fs.unlink(path.join(profile,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
report.profileCopy={source:originalProfile,copy:profile,files:originalProfileInventory.length,inventorySha256:sha(Buffer.from(JSON.stringify(originalProfileInventory)))};
const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')).href);
const fallback = new Map();
for (const name of ['artifacts-alpine.json', 'artifacts-omarchy-virgl.json']) {
  for (const asset of Object.values(JSON.parse(await fs.readFile(path.join(web, name), 'utf8')).artifacts)) {
    const pathname = '/' + asset.url.replace(/^\.\//, '');
    fallback.set(pathname, {hash: asset.sha256, url: 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/' + asset.sha256 + pathname});
  }
}
const types = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.wasm':'application/wasm', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png'};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    const base = pathname.startsWith('/releases/') ? root : web;
    const file = path.resolve(base, '.' + decodeURIComponent(pathname));
    assert.ok(file.startsWith(base + path.sep));
    let bytes;
    try {bytes = await fs.readFile(file);} catch (error) {
      if (error.code === 'ENOENT' && fallback.has(pathname)) {response.writeHead(302, {Location: fallback.get(pathname).url}).end(); return;}
      throw error;
    }
    if (fallback.has(pathname)) assert.equal(sha(bytes), fallback.get(pathname).hash);
    report.served.push({path: pathname, sha256: sha(bytes), bytes: bytes.length});
    response.writeHead(200, {'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store',
      'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  } catch (error) {response.writeHead(404).end();}
});
let context, page;
const control = name => page.locator('[data-session="' + name + '"]');
const idle = () => page.waitForFunction(() => window.__sessionLibrary && !__sessionLibrary.busy && __sessionLibrary.root.dataset.state !== 'loading', null, {timeout:240000});
async function tabTo(name) {
  await page.locator('#session-library summary').focus();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => ({tag: document.activeElement.tagName, control: document.activeElement.dataset.session ?? '',
      outline: getComputedStyle(document.activeElement).outlineStyle}));
    report.keyboard.push(focused);
    if (focused.control === name) {assert.equal(focused.outline, 'solid'); return;}
  }
  throw Error('Keyboard Tab failed to reach ' + name);
}
async function choose(name, value) {
  await tabTo(name);
  const values = await control(name).locator('option').evaluateAll(options => options.map(x => x.value));
  const index = values.indexOf(value); assert.ok(index >= 0);
  await control(name).selectOption(value); await idle();
  assert.equal(await control(name).inputValue(), value);
}
async function active(name) {
  return page.evaluate(async name => {
    const frame = await __linuxCtl.captureSoftwareCheckpoint();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', frame)), b => b.toString(16).padStart(2, '0')).join('');
    const compressed = await new Response(new Blob([frame]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    await fetch('./__verifier-proof/' + name + '.checkpoint.gz', {method:'POST', body:compressed});
    return {sha256:digest, bytes:frame.length, paused:await __linuxCtl.isPaused(), scheduler:await __linuxCtl.schedulerStats(),
      active:__sessionLibrary.active?.id, point:__sessionLibrary.active?.point};
  }, name);
}
try {
  if(!remote)await new Promise(resolve=>server.listen(Number(new URL(origin).port),'127.0.0.1',resolve));
  context = await chromium.launchPersistentContext(profile, {
    headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'], viewport:{width:390,height:844}, serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page = context.pages()[0] ?? await context.newPage();
  page.on('console',msg=>{if(msg.type()==='error'&&!(/favicon\.ico$/.test(msg.location().url)&&/\b404\b/.test(msg.text())))report.errors.push(msg.text());});
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/__verifier-proof/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1); assert.match(name, /^[a-z-]+\.checkpoint\.gz$/);
    await fs.writeFile(path.join(output, name), route.request().postDataBuffer()); await route.fulfill({status:204,body:''});
  });
  await page.addInitScript(() => {
    window.__verifierTransitions = [];
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.querySelector('#session-library');
      new MutationObserver(() => window.__verifierTransitions.push({state:root.dataset.state,busy:root.getAttribute('aria-busy'),
        status:root.querySelector('[data-session="status"]').textContent,
        active:root.querySelector('[data-session="active"]').dataset.id,
        disabled:[...root.querySelectorAll('button,select,input')].filter(x=>x.disabled).map(x=>x.dataset.session)}))
        .observe(root, {attributes:true,childList:true,subtree:true,attributeFilter:['data-state','aria-busy']});
    }, {once:true});
  });
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.goto(origin + '/app.html?noAutoBoot&testHooks=1&workerHeartbeatTimeoutMs=10000', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__ready === true); await idle();
  console.log('Copied persisted library is ready');
  report.initialRows=await control('sessions').locator('option').evaluateAll(options=>options.map(x=>({id:x.value,name:x.textContent})));
  assert.ok(report.initialRows.some(x=>x.id===alpha)&&report.initialRows.some(x=>x.id===beta));
  if(remote&&process.argv.includes('--check-public-assets')){
    report.publicBytes=[];for(const name of sourceNames){const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200,name);
      const bytes=await response.body();assert.equal(sha(bytes),report.source_sha256[name],name);report.publicBytes.push({name,bytes:bytes.length,sha256:sha(bytes)});}
  }
  await choose('sessions', alpha); await choose('points', alphaPoint);
  console.log('Keyboard selected exact Alpha point');
  await tabTo('open'); await page.keyboard.press('Enter'); await idle();
  assert.equal(await page.locator('#session-library').getAttribute('data-state'), 'ready');
  report.activeBefore = await active('before-admission'); assert.equal(report.activeBefore.sha256, original.checks.alpha.frameHash);
  console.log('Exact Alpha active tuple authenticated');
  await page.evaluate(() => {window.__verifierOwner = __linuxCtl;});
  await choose('sessions', beta);
  report.preview = await page.evaluate(() => ({id:__sessionLibrary.preview.id,compatible:__sessionLibrary.preview.compatible,point:__sessionLibrary.controls.points.value,
    state:__sessionLibrary.root.dataset.state,details:__sessionLibrary.controls.details.innerText}));
  assert.equal(report.preview.id, beta); assert.equal(report.preview.compatible, true); assert.equal(report.preview.state, 'ready');
  await page.locator('#session-library').screenshot({path:path.join(output,'before-open.png')});
  report.deleted = await page.evaluate(async beta => {
    const opened = await __sessionLibrary.store.openSession(beta), manifest = JSON.parse(new TextDecoder().decode(opened.manifest));
    const point = manifest.checkpoints.find(x=>x.id===__sessionLibrary.controls.points.value);
    const db = await new Promise((resolve,reject) => {const r=indexedDB.open('wasm-vm-sessions-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const prior = await new Promise((resolve,reject) => {const tx=db.transaction('objects','readwrite',{durability:'strict'}),store=tx.objectStore('objects');let previous;
      const request=store.get(point.machine.sha256);request.onsuccess=()=>{previous=request.result;if(!previous){tx.abort();return;}store.delete(point.machine.sha256);};
      tx.oncomplete=()=>resolve(previous);tx.onabort=()=>reject(tx.error||Error('target descriptor did not exist'));});
    const present = await new Promise((resolve,reject) => {const request=db.transaction('objects').objectStore('objects').getKey(point.machine.sha256);request.onsuccess=()=>resolve(request.result!==undefined);request.onerror=()=>reject(request.error);});db.close();
    if(present)throw Error('target descriptor survived deletion');
    return {id:beta,point:point.id,object:point.machine,priorParts:prior.parts.length,descriptorPresentAfter:present};
  }, beta);
  await tabTo('open'); await page.keyboard.press('Enter'); await idle();
  console.log('Stale compatible Beta admission completed');
  report.afterUi = await page.evaluate(() => ({sameOwner:__linuxCtl===window.__verifierOwner,state:__sessionLibrary.root.dataset.state,
    active:__sessionLibrary.controls.active.dataset.id,point:__sessionLibrary.controls.active.dataset.point,status:__sessionLibrary.controls.status.textContent}));
  assert.equal(report.afterUi.sameOwner, true); assert.equal(report.afterUi.state, 'incomplete'); assert.equal(report.afterUi.active, alpha); assert.equal(report.afterUi.point, alphaPoint);
  report.activeAfter = await active('after-admission'); assert.equal(report.activeAfter.sha256, report.activeBefore.sha256);
  assert.equal(report.activeAfter.paused, true); assert.equal(report.activeAfter.scheduler.retiredInstructions, 0);
  report.transitions = await page.evaluate(() => window.__verifierTransitions);
  assert.ok(report.transitions.some(x=>x.state==='restoring'&&x.busy==='true'&&x.disabled.includes('open')&&x.disabled.includes('sessions')));
  await page.locator('#session-library').screenshot({path:path.join(output,'after-error.png')});
  report.layout = await page.locator('#session-library').evaluate(el=>({right:el.getBoundingClientRect().right,viewport:innerWidth,scroll:el.scrollWidth,client:el.clientWidth}));
  assert.ok(report.layout.right<=report.layout.viewport+1&&report.layout.scroll<=report.layout.client+1);
  // Coverage tail: real Start/capture cleanup over this same paused Alpha controller.
  // Inject one boundary failure, then restore the actual checkpoint writer before success.
  await page.evaluate(()=>{
    const library=__sessionLibrary,actual=library.checkpoints.save;
    window.__verifierInitialFailure={calls:0,restore:()=>{library.checkpoints.save=actual;}};
    library.checkpoints.save=async function(...args){
      __verifierInitialFailure.calls++;
      if(__verifierInitialFailure.calls===1)throw new DOMException('verifier initial capture quota','QuotaExceededError');
      return actual.apply(this,args);
    };
  });
  await control('start').click();await idle();
  report.initialFailure=await page.evaluate(async()=>{
    const library=__sessionLibrary,id=library.selected,meta=library.metadata.get(id),opened=await library.store.openSession(id);
    const result={id,calls:__verifierInitialFailure.calls,state:library.root.dataset.state,metadata:meta,
      committed:opened!==null,recording:library.recording!==null,active:library.active?.id};
    __verifierInitialFailure.restore();
    // Initial-capture cleanup awaits release acknowledgement, so this acquisition must be immediate.
    const writer=await library.store.writer(id);result.reacquired=writer.id;await writer.release();
    return result;
  });
  assert.equal(report.initialFailure.calls,1);assert.equal(report.initialFailure.state,'storage-error');
  assert.equal(report.initialFailure.metadata.draft,true);assert.deepEqual(report.initialFailure.metadata.points,[]);
  assert.equal(report.initialFailure.committed,false);assert.equal(report.initialFailure.recording,false);
  assert.equal(report.initialFailure.reacquired,report.initialFailure.id);assert.equal(report.initialFailure.active,alpha);
  report.afterInitialFailure=await active('after-initial-failure');assert.equal(report.afterInitialFailure.sha256,report.activeBefore.sha256);
  await control('start').click();await idle();
  report.prefixBeforeOwnerLoss=await page.evaluate(async()=>{
    const library=__sessionLibrary,id=library.recording.id,opened=await library.store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',opened.manifest)),b=>b.toString(16).padStart(2,'0')).join('');
    return {id,revision:opened.revision,manifestSha256:hash,points:manifest.checkpoints.map(x=>({id:x.id,machine:x.machine})),events:manifest.events.length};
  });
  assert.equal(report.prefixBeforeOwnerLoss.points.length,1);assert.equal(report.prefixBeforeOwnerLoss.events,0);
  assert.equal(report.prefixBeforeOwnerLoss.points[0].machine.sha256,report.activeBefore.sha256);
  assert.equal(await page.evaluate(()=>window.__retireLinuxControllerForTest()),true);
  // Observe the LockManager acknowledgement without releasing the product's writer ourselves.
  // If ownerChanged omitted release, this wait fails instead of masking that bug with our cleanup.
  await page.waitForFunction(async id=>{
    const state=await navigator.locks.query(),name='wasm-vm-session-wasm-vm-sessions-v1-'+id;
    return !state.held.some(x=>x.name===name)&&!state.pending.some(x=>x.name===name);
  },report.prefixBeforeOwnerLoss.id,{timeout:30000});
  report.ownerLoss=await page.evaluate(async id=>{
    const library=__sessionLibrary,opened=await library.store.openSession(id),manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',opened.manifest)),b=>b.toString(16).padStart(2,'0')).join('');
    const result={recording:library.recording!==null,active:library.controls.active.dataset.id,guestUp:wvmDemo.isGuestUp(),
      state:library.root.dataset.state,status:library.controls.status.textContent,revision:opened.revision,manifestSha256:hash,
      points:manifest.checkpoints.map(x=>({id:x.id,machine:x.machine})),checkpointDisabled:library.controls.checkpoint.disabled,stopDisabled:library.controls.stop.disabled};
    const writer=await library.store.writer(id);result.reacquired=writer.id;await writer.release();return result;
  },report.prefixBeforeOwnerLoss.id);
  assert.equal(report.ownerLoss.recording,false);assert.equal(report.ownerLoss.active,'');assert.equal(report.ownerLoss.guestUp,false);
  assert.equal(report.ownerLoss.state,'ready');assert.match(report.ownerLoss.status,/Recording ended because its guest stopped/);
  assert.equal(report.ownerLoss.reacquired,report.prefixBeforeOwnerLoss.id);assert.equal(report.ownerLoss.revision,report.prefixBeforeOwnerLoss.revision);
  assert.equal(report.ownerLoss.manifestSha256,report.prefixBeforeOwnerLoss.manifestSha256);
  assert.deepEqual(report.ownerLoss.points,report.prefixBeforeOwnerLoss.points);
  assert.equal(report.ownerLoss.checkpointDisabled,true);assert.equal(report.ownerLoss.stopDisabled,true);
  await page.locator('#session-library').screenshot({path:path.join(output,'after-cleanup.png')});
  assert.deepEqual(report.errors, []); report.status='passed';
} catch (error) {
  report.status='failed'; report.failure={message:error.message,stack:error.stack}; process.exitCode=1;
  if (page) await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
} finally {
  if (page) {
    try{await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));}
    catch(error){report.coverageFailure=error.message;report.status='failed';process.exitCode=1;}
  }
  if (context) {await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{}); await context.close();}
  if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  try{clean();assert.equal(head(),report.head);for(const name of sourceNames)assert.equal(sha(await fs.readFile(path.join(web,name))),report.source_sha256[name],name);
    assert.deepEqual(await inventory(originalProfile),originalProfileInventory,'original recording profile was mutated');}
  catch(error){report.integrityFailure=error.message;report.status='failed';process.exitCode=1;}
  report.files=await inventory(output);report.finished=new Date().toISOString();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,failure:report.failure,activeBefore:report.activeBefore?.sha256,activeAfter:report.activeAfter?.sha256,afterUi:report.afterUi},null,2));
}
