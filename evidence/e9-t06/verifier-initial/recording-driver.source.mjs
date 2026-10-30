import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from '../../../web/node_modules/playwright/index.mjs';

const root = process.cwd();
const output = path.join(root, 'target/evidence/e9-t06-verifier/n1-v5');
const web = path.join(root, 'target/e9-t06-frozen-assets/web/dist');
const original = JSON.parse(await fs.readFile(path.join(root, 'target/evidence/e9-t06-worker-final/browser/report.json'), 'utf8'));
const origin = new URL(original.url).origin;
const alpha = original.checks.alpha.id, alphaPoint = original.checks.alpha.point, beta = original.checks.beta.id;
const report = {task: 'E9-T06', attack: 'N1 stale compatible preview loses durable point before keyboard Open',
  implementation: 'b97f739cdb161cb16f7d64ca983fb48fea80df76', prediction: 'Admission rejects before owner replacement; active controller and raw tuple remain unchanged',
  started: new Date().toISOString(), status: 'running', errors: [], keyboard: [], served: []};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output, {recursive: false});
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
  await new Promise(resolve => server.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
  context = await chromium.launchPersistentContext(path.join(root, 'target/evidence/e9-t06-verifier/n1-chromium-profile-v5'), {
    headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'], viewport:{width:390,height:844}, serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page = context.pages()[0] ?? await context.newPage();
  page.on('console', msg => {if (msg.type() === 'error') report.errors.push(msg.text());});
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
  report.initialRows = await control('sessions').locator('option').allTextContents(); assert.equal(report.initialRows.length, 4);
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
  assert.deepEqual(report.errors, []); report.status='passed';
} catch (error) {
  report.status='failed'; report.failure={message:error.message,stack:error.stack}; process.exitCode=1;
  if (page) await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
} finally {
  if (page) {
    try {await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));} catch {}
  }
  if (context) {await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{}); await context.close();}
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  report.finished=new Date().toISOString();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,failure:report.failure,activeBefore:report.activeBefore?.sha256,activeAfter:report.activeAfter?.sha256,afterUi:report.afterUi},null,2));
}
