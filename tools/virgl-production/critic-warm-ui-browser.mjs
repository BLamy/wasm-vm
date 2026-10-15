#!/usr/bin/env node
// Owned localhost failure variants of the actual default GPU app. No guest values are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {WARM_UI_FAILURES, warmUiDigest as sha, staleWarmPair, assertWarmFailureUi} from './critic-warm-ui-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2]);
const web = path.resolve(process.env.CRITIC_WARM_UI_WEB_ROOT || path.join(repo, 'web'));
const releaseCache = path.resolve(process.env.CRITIC_WARM_UI_RELEASE_CACHE || path.join(repo, 'releases'));
const pairFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
await fs.mkdir(output, {recursive: false});
const report = {scope: 'actual default GPU app failure policy under explicit owned artifact/SW variants; no successful guest boot claim', status: 'running',
  head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(), web, pairFile, rows: [], assets: [], sources: [], responses: []};
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const sources = new Map();
async function freeze(relative) {
  const absolute = path.join(web, relative), stat = await fs.stat(absolute).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(absolute, {withFileTypes: true})) if (!entry.isSymbolicLink()) await freeze(path.posix.join(relative, entry.name));
    return;
  }
  if (!/\.(?:m?js|json|html|css|wasm|svg|png|woff2?|elf)$/.test(relative)) return;
  const bytes = await fs.readFile(absolute), destination = path.join(output, 'source', relative);
  await fs.mkdir(path.dirname(destination), {recursive: true}); await fs.writeFile(destination, bytes);
  const identity = {path: relative, bytes: bytes.length, sha256: sha(bytes)};
  sources.set('/' + relative, {...identity, bytes}); report.sources.push(identity);
}
for (const entry of await fs.readdir(web, {withFileTypes: true})) if (entry.isFile()) await freeze(entry.name);
for (const name of ['src', 'renderer', 'pkg', 'vendor']) await freeze(name);
await freeze('assets/hello.elf');
for (const name of ['@xterm/xterm/lib/xterm.js', '@xterm/xterm/css/xterm.css', '@xterm/addon-fit/lib/addon-fit.js']) await freeze('node_modules/' + name);
const shell = sources.get('/app.html') || sources.get('/index.html'); assert.ok(shell);
const originalDescriptor = JSON.parse(sources.get('/artifacts-omarchy-virgl.json').bytes);
const cases = (process.env.CRITIC_WARM_UI_CASES || (pairFile || originalDescriptor.artifacts.gpuCheckpoint
  ? Object.keys(WARM_UI_FAILURES).join(',') : 'missing-artifact,digest-mismatch')).split(',');
assert.ok(cases.every(mode => Object.hasOwn(WARM_UI_FAILURES, mode)));
assert.ok(pairFile || originalDescriptor.artifacts.gpuCheckpoint ||
  cases.every(mode => ['missing-artifact', 'digest-mismatch'].includes(mode)), 'real source pair required for stale/envelope cases');
const pinMap = new Map();
for (const [name, item] of sources) if (/^\/artifacts[^/]*\.json$/.test(name)) {
  const descriptor = JSON.parse(item.bytes);
  if (descriptor.chunkedImage) {
    const pin = descriptor.chunkedImage; pinMap.set('/' + pin.key.replace(/^releases\//, ''), pin);
    if (name === '/artifacts-omarchy.json') pinMap.set('/chunked-omarchy/manifest.json', pin);
  }
}
const assetCache = new Map();
async function asset(url, pin) {
  const key = pin.sha256;
  if (assetCache.has(key)) return assetCache.get(key);
  const wanted = new URL(url, 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/');
  const relative = wanted.pathname.replace(/^\/sha256\/[a-f0-9]{64}/, '').replace(/^\//, '');
  const candidates = [path.join(repo, relative), path.join(releaseCache, relative.replace(/^releases\//, ''))];
  let bytes, source;
  for (const candidate of candidates) {
    const value = await fs.readFile(candidate).catch(() => null);
    if (value?.length === pin.size && sha(value) === pin.sha256) { bytes = value; source = candidate; break; }
  }
  if (!bytes) {
    const base = 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev';
    const routes = wanted.pathname.startsWith('/sha256/') ? [wanted.href] : [base + '/sha256/' + pin.sha256 + '/' + relative, base + '/' + relative.replace(/^releases\/(?=chunked-)/, '')];
    for (const route of routes) {
      const response = await fetch(route, {signal: AbortSignal.timeout(180000)});
      const receipt = {url: route, status: response.status}; report.assets.push(receipt);
      if (response.status === 404 && route !== routes.at(-1)) { await response.body?.cancel(); continue; }
      assert.equal(response.status, 200, 'original pinned asset status'); bytes = Buffer.from(await response.arrayBuffer()); source = route;
      Object.assign(receipt, {bytes: bytes.length, sha256: sha(bytes)}); break;
    }
  }
  assert.equal(bytes?.length, pin.size); assert.equal(sha(bytes), pin.sha256);
  report.assets.push({source, bytes: bytes.length, sha256: sha(bytes)}); assetCache.set(key, bytes); return bytes;
}
const kernel = await asset(originalDescriptor.artifacts.kernel.url, originalDescriptor.artifacts.kernel);
let pair, stale, corrupt;
if (pairFile || originalDescriptor.artifacts.gpuCheckpoint) {
  pair = pairFile ? await fs.readFile(pairFile) : await asset(originalDescriptor.artifacts.gpuCheckpoint.url, originalDescriptor.artifacts.gpuCheckpoint);
  const codec = await import(pathToFileURL(path.join(output, 'source/renderer/virgl-command/checkpoint-codec.mjs')));
  stale = staleWarmPair(pair, codec); corrupt = Buffer.from(pair); corrupt[16] ^= 1;
  report.pair = {bytes: pair.length, sha256: sha(pair), staleBytes: stale.bytes.length, staleSha256: sha(stale.bytes),
    oldBuildId: stale.oldBuildId, staleBuildId: stale.staleBuildId, corruptSha256: sha(corrupt)};
}
await fs.writeFile(path.join(output, 'pre-data-predictions.json'), JSON.stringify({beforeBrowser: true, sources: report.sources,
  predictions: cases.map(mode => ({mode, failure: WARM_UI_FAILURES[mode].source, ready: false, controller: false, restored: false,
    workersPerExplicitAttempt: 1, everyWorker: {virgl: true, bootSnapshot: true, persist: false}, choices: ['retry GPU', 'explicit cold GPU', 'explicit software'],
    noAutomaticFallback: true, extra: mode === 'stale-service-worker' ? 'actual preinstalled SW returns stale bytes' : mode === 'stale-cache' ? 'original cache verification evicts bad expected-digest entry then refuses bad network' : null}))}, null, 2) + '\n');

let active, browser, context;
const requests = [];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const row = {mode: active?.mode, pathname, method: request.method, time: Date.now()}; requests.push(row);
  try {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-store');
    let bytes, type = 'application/octet-stream';
    if (pathname === '/favicon.ico') { row.status = 204; response.writeHead(204).end(); return; }
    if (pathname === '/__critic_setup') { bytes = Buffer.from('<!doctype html><title>Owned stale artifact setup</title>'); type = 'text/html'; }
    else if (pathname === '/__critic_kernel') bytes = kernel;
    else if (pathname === '/__critic_pair') bytes = active.bytes;
    else if (pathname === '/__critic_stale_pair') bytes = stale.bytes;
    else if (pathname === '/__critic_stale_sw.js') {
      bytes = Buffer.from("self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('critic-stale-gpu-artifact');await c.put('/__critic_pair',await fetch('/__critic_stale_pair'));await self.skipWaiting();})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/__critic_pair')e.respondWith(caches.open('critic-stale-gpu-artifact').then(c=>c.match('/__critic_pair')));});");
      type = 'text/javascript';
    } else if (pathname === '/artifacts-omarchy-virgl.json') { bytes = active.descriptor; type = 'application/json'; }
    else if (pinMap.has(pathname)) { bytes = await asset(pathname, pinMap.get(pathname)); type = 'application/json'; }
    else {
      const item = pathname === '/app' ? shell : sources.get(pathname);
      assert.ok(item, 'unexpected source/chunk request ' + pathname); bytes = item.bytes;
      type = /\.wasm$/.test(item.path) ? 'application/wasm' : /\.m?js$/.test(item.path) ? 'text/javascript' : /\.html$/.test(item.path) ? 'text/html' : /\.json$/.test(item.path) ? 'application/json' : /\.css$/.test(item.path) ? 'text/css' : 'application/octet-stream';
    }
    Object.assign(row, {status: 200, bytes: bytes.length, sha256: sha(bytes)});
    response.writeHead(200, {'Content-Type': type, 'Content-Length': bytes.length}).end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) { Object.assign(row, {status: 404, error: String(error)}); response.writeHead(404).end(String(error)); }
});
function observe() {
  globalThis.__criticWarmUi = {boots: [], errors: [], desktopReady: [], states: []};
  for (const [type, name] of [['wvm:guest-error', 'errors'], ['wvm:desktop-ready', 'desktopReady'], ['wvm:guest-state', 'states']])
    addEventListener(type, event => globalThis.__criticWarmUi[name].push(event.detail));
  const original = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(message, ...rest) {
    if (message?.type === 'boot') globalThis.__criticWarmUi.boots.push(message.opts);
    return original.call(this, message, ...rest);
  };
}
async function state(page, pageErrors) {
  const value = await page.evaluate(() => {
    const action = selector => {
      const el = document.querySelector(selector), ancestors = [];
      for (let a = el; a && ancestors.length < 12; a = a.parentElement) ancestors.push({tag: a.tagName, id: a.id,
        hidden: a.hidden, display: getComputedStyle(a).display, visibility: getComputedStyle(a).visibility, rects: a.getClientRects().length});
      const rect = el?.getClientRects()[0];
      const point = rect ? {x: (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2,
        y: (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2} : null;
      return {ancestors, href: el?.href ?? null, disabled: el?.disabled ?? false, point,
        hitTestable: Boolean(point && el.contains(document.elementFromPoint(point.x, point.y))),
        visible: Boolean(el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'), text: el?.textContent};
    };
    return {...globalThis.__criticWarmUi, isolated: crossOriginIsolated, ready: Boolean(wvmDemo?.isGuestReady?.()), up: Boolean(wvmDemo?.isGuestUp?.()),
      restored: Boolean(wvmDemo?.restoredFromBootSnapshot?.()), graphics: document.querySelector('#desktop-graphics')?.value,
      message: document.querySelector('#gpu-status')?.textContent, actions: {software: action('#gpu-retry'), cold: action('#gpu-cold-retry'), retry: action('[data-os="omarchy"]')},
      serviceWorker: navigator.serviceWorker.controller?.scriptURL ?? null};
  });
  return {...value, pageErrors: [...pageErrors]};
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
  const {chromium} = await import(pathToFileURL(path.join(process.env.CRITIC_BROWSER_DEPENDENCIES || path.join(repo, 'web/node_modules'), 'playwright/index.mjs')));
  // Never take focus from a human using the separately owned desktop guest.
  browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-gpu', '--use-gl=angle', '--use-angle=metal']});
  const hardwareSession = await browser.newBrowserCDPSession();
  report.hardware = await hardwareSession.send('SystemInfo.getInfo');
  report.commandLine = await hardwareSession.send('Browser.getBrowserCommandLine');
  assert.equal(report.hardware.gpu.featureStatus.webgl2 ?? report.hardware.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!report.commandLine.arguments.some(value => /swiftshader|llvmpipe|softpipe|--disable-gpu(?:$|=)/i.test(value)));
  for (const mode of cases) {
    const directory = path.join(output, mode); await fs.mkdir(directory);
    const descriptor = JSON.parse(JSON.stringify(originalDescriptor)); descriptor.artifacts.kernel.url = '/__critic_kernel';
    let bytes = mode === 'digest-mismatch' ? Buffer.alloc(64, 0x57) : mode === 'stale-identity' ? stale.bytes : mode === 'corrupt-envelope' ? corrupt : mode === 'stale-cache' ? stale.bytes : pair;
    if (mode === 'missing-artifact') delete descriptor.artifacts.gpuCheckpoint;
    else descriptor.artifacts.gpuCheckpoint = {url: '/__critic_pair', size: bytes.length, sha256: mode === 'digest-mismatch' ? '0'.repeat(64) : ['stale-service-worker', 'stale-cache'].includes(mode) ? sha(pair) : sha(bytes)};
    active = {mode, bytes, descriptor: Buffer.from(JSON.stringify(descriptor, null, 2) + '\n')};
    const row = {mode, status: 'running', descriptorSha256: sha(active.descriptor)}; report.rows.push(row);
    await fs.writeFile(path.join(directory, 'descriptor.json'), active.descriptor); await save();
    context = await browser.newContext({viewport: {width: 1280, height: 850}, serviceWorkers: 'allow'});
    // Read each unchanged original response before forwarding it. A failed
    // worker can terminate before Chrome retains its CDP response-body handle.
    // Artifact/SW/cache failure variants still use their original fetch paths.
    const forwardedSources = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const expected = url.pathname === '/app' ? shell.bytes : url.pathname === '/artifacts-omarchy-virgl.json'
        ? active.descriptor : sources.get(url.pathname)?.bytes;
      if (url.origin !== origin || !expected) return route.continue();
      const original = await route.fetch(); assert.equal(original.status(), 200);
      const body = await original.body(); assert.equal(sha(body), sha(expected), 'original source body before forwarding');
      await route.fulfill({response: original, body});
      forwardedSources.push({pathname: url.pathname, bytes: body.length, sha256: sha(body), forwardedUnchanged: true});
    });
    await context.addInitScript(observe); const page = await context.newPage(), pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && !/favicon/.test(message.location().url ?? '')) pageErrors.push(message.text()); });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== origin) return;
      const event = {mode, pathname: url.pathname, status: response.status(), serviceWorker: response.fromServiceWorker()}; report.responses.push(event);
    });
    if (['stale-service-worker', 'stale-cache'].includes(mode)) {
      await page.goto(origin + '/__critic_setup');
      row.setup = await page.evaluate(async ({mode, sha256}) => {
        if (mode === 'stale-service-worker') {
          await navigator.serviceWorker.register('/__critic_stale_sw.js', {scope: '/'}); await navigator.serviceWorker.ready;
          return {worker: (await navigator.serviceWorker.ready).active.scriptURL};
        }
        const key = location.origin + '/__wasm-vm-boot-assets-v1/' + sha256;
        await (await caches.open('wasm-vm-boot-assets-v1')).put(key, await fetch('/__critic_stale_pair'));
        return {cache: 'wasm-vm-boot-assets-v1', key};
      }, {mode, sha256: sha(pair)});
    }
    const url = origin + '/app?' + new URLSearchParams({guest: 'omarchy', desktop: '1', nosw: '1', assetBase: origin, omarchyAssetBase: origin}) + '#ide';
    row.url = url; assert.equal(new URL(url).searchParams.has('gpu'), false);
    await page.goto(url);
    let precedingErrors = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.waitForFunction(({count, precedingErrors}) => (globalThis.__criticWarmUi?.errors.length ?? 0) > precedingErrors &&
        globalThis.__criticWarmUi.boots.length >= count, {count: attempt, precedingErrors}, {timeout: 120000});
      await page.waitForTimeout(500);
      const actual = await state(page, pageErrors); row['attempt' + attempt] = actual;
      await fs.writeFile(path.join(directory, 'attempt' + attempt + '.json'), JSON.stringify(actual, null, 2) + '\n');
      await page.screenshot({path: path.join(directory, 'attempt' + attempt + '.png'), fullPage: true}); await save();
      assertWarmFailureUi(actual, mode, attempt);
      if (mode === 'stale-service-worker') assert.ok(actual.serviceWorker?.endsWith('/__critic_stale_sw.js'));
      precedingErrors = actual.errors.length;
      if (attempt === 1) await page.locator('[data-os="omarchy"]').click();
    }
    if (mode === 'stale-cache') {
      row.badCacheEntryRemains = await page.evaluate(async key => Boolean(await (await caches.open('wasm-vm-boot-assets-v1')).match(key)), row.setup.key);
      assert.equal(row.badCacheEntryRemains, false, 'original verifier removed the bad cache entry');
    }
    row.forwardedSources = forwardedSources;
    for (const response of report.responses.filter(response => response.mode === mode &&
      response.status === 200 && (response.pathname === '/app' || sources.has(response.pathname)))) {
      assert.ok(forwardedSources.some(item => item.pathname === response.pathname), 'recorded original source response ' + response.pathname);
    }
    if (mode === 'stale-service-worker') assert.ok(report.responses.some(response => response.mode === mode && response.pathname === '/__critic_pair' && response.serviceWorker));
    row.status = 'passed'; await context.close(); context = null; await save();
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack || String(error); }
finally {
  report.requests = requests;
  await context?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); await save();
}
console.log(JSON.stringify({status: report.status, rows: report.rows.map(row => ({mode: row.mode, status: row.status})), error: report.error}));
if (report.status !== 'passed') process.exitCode = 1;
