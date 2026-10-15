#!/usr/bin/env node
// One load of the committed ordinary app: the proof-only module must not be exported.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repo, sha256 } from './virgl-command/fixtures.mjs';
assert.equal(process.argv[2], '--output'); assert.ok(process.argv[3]);
const options = {};
for (let i = 4; i < process.argv.length; i += 2) {
  assert.ok(['--task', '--url'].includes(process.argv[i]) && process.argv[i + 1]);
  assert.equal(options[process.argv[i]], undefined, 'duplicate option');
  options[process.argv[i]] = process.argv[i + 1];
}
const task = options['--task'] ?? 'E6-T11a';
const remoteUrl = options['--url'];
if (remoteUrl) {
  const url = new URL(remoteUrl);
  assert.equal(url.protocol, 'https:'); assert.equal(url.pathname, '/');
  assert.equal(url.search + url.hash + url.username + url.password, '');
}
assert.ok(['E0-T27', 'E6-T11a', 'E6-T11b2', 'E6-T11c', 'E6-T11d51', 'E6-T11d52', 'E6-T11d53', 'E6-T11d54', 'E6-T11d55', 'E6-T11d56', 'E6-T11d57', 'E6-T11d58', 'E6-T11d59', 'E6-T11d60', 'E6-T11d61', 'E6-T11d62', 'E6-T11d63', 'E6-T11d64', 'E6-T11d65', 'E6-T11d66', 'E6-T11d67', 'E6-T11d68', 'E6-T11d69a','E6-T11d69b', 'E6-T11d70', 'E6-T11d71', 'E6-T11d72', 'E6-T11d73', 'E6-T11d74a', 'E6-T11d74b', 'E6-T11d', 'E6-T11e'].includes(task));
const output = path.resolve(process.argv[3]), root = path.join(repo, 'web/dist');
await fs.mkdir(output, { recursive: true });
const report = { schema: 1, task, status: 'running',
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  command: [process.execPath, ...process.argv.slice(1)], startedAt: new Date().toISOString(), errors: [], served: [] };
const served = new Map(); let browser, server, page;
const liveReads = [];
try {
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
  if (!remoteUrl) server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      const file = path.resolve(root, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
      const bytes = await fs.readFile(file);
      served.set(pathname, { path: path.relative(repo, file), bytes: bytes.length, sha256: sha256(bytes) });
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  if (server) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
  browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  page = await context.newPage();
  page.on('console', (message) => { if (message.type() !== 'error') return; const location=message.location().url; if (remoteUrl && location===new URL('favicon.ico',remoteUrl).href && /404/.test(message.text())) (report.allowedFavicon404??=[]).push({url:location,message:message.text()}); else report.errors.push(message.text()); });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('requestfailed', (request) => report.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  if (remoteUrl) page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== new URL(remoteUrl).origin || !/\.(?:m?js|wasm|json|html|css)$/.test(url.pathname) && url.pathname!=='/app') return;
    liveReads.push((async () => {
      try {
        if (response.status()===308 && url.pathname.endsWith('.html')) {
          const location=new URL((await response.allHeaders()).location,response.url());
          assert.equal(location.origin,url.origin);assert.equal(location.pathname,url.pathname.slice(0,-5));assert.equal(location.search,url.search);assert.equal(location.hash,'');
          (report.canonicalRedirects??=[]).push({url:response.url(),status:308,location:location.href});return;
        }
        assert.equal(response.status(), 200, 'published source status ' + url.pathname);
        const bytes = await response.body(), relative = url.pathname==='/app'?'app.html':url.pathname.slice(1);
        assert.equal(sha256(bytes), sha256(await fs.readFile(path.join(root, relative))), 'published source drift ' + relative);
        const bodyPath = path.join('served', relative);
        await fs.mkdir(path.dirname(path.join(output, bodyPath)), {recursive:true});
        await fs.writeFile(path.join(output, bodyPath), bytes);
        served.set(url.pathname, {path:'web/dist/' + relative, bodyPath, bytes:bytes.length, sha256:sha256(bytes), url:response.url()});
      } catch (error) { report.errors.push(String(error)); }
    })());
  });
  report.url = remoteUrl ? new URL('app.html?noAutoBoot&testHooks=1', remoteUrl).href : `http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  report.proofExportAbsent = await page.evaluate(async () => {
    const module = await import('./pkg/wasm_vm_wasm.js');
    return !Object.hasOwn(module, 'WasmVirglControlProof') && !Object.hasOwn(module, 'WasmVirglSubmitProof')
      && !Object.hasOwn(module, 'WasmVirglScanoutProof');
  });
  assert.equal(report.proofExportAbsent, true, 'ordinary build must omit proof surface');
  await page.locator('#suite-run').click();
  await page.waitForFunction(() => document.querySelector('#metric-done')?.textContent === '127', null, { timeout: 600000 });
  report.passed = Number(await page.locator('#metric-pass').textContent());
  report.failed = Number(await page.locator('#metric-fail').textContent());
  report.suiteStatus = await page.locator('#suite-status').textContent();
  assert.equal(report.passed, 127); assert.equal(report.failed, 0); assert.match(report.suiteStatus, /complete/);
  const capability = page.locator('.cap', { hasText: 'Scalar memory across virtual-page boundaries' });
  report.roadmapPip = await capability.locator('.cap-pip').getAttribute('class');
  assert.match(report.roadmapPip, /\blive\b/);
  const graphics = page.locator('.cap', { hasText: 'Guest GPU offload' });
  report.graphicsRoadmapPip = await graphics.locator('.cap-pip').getAttribute('class');
  assert.match(report.graphicsRoadmapPip, /\bpartial\b/);
  if (['E6-T11d67','E6-T11d68','E6-T11d69a','E6-T11d69b','E6-T11d70','E6-T11d71','E6-T11d72','E6-T11d73','E6-T11d74a', 'E6-T11d74b','E6-T11d','E6-T11e'].includes(task)) assert.match(await graphics.textContent(), /qualified GPU cold boots/);
  else assert.match(await graphics.textContent(), /production acceleration disabled/);
  if (task === 'E6-T11d73') assert.match(await page.locator('.cap', {hasText: 'Host-paced guest idle'}).textContent(), /E6-T11d73/);
  if (task === 'E6-T11d72') assert.match(await page.locator('.cap', {hasText: 'Interactive desktop time'}).textContent(), /E6-T11d72/);
  if (task === 'E6-T11d70') assert.match(await page.locator('.cap', {hasText: 'Original fragmented GPU backing'}).textContent(), /16384/);
  if (task === 'E6-T11d68') assert.match(await page.locator('.cap', {hasText: 'Original indexed draw hints'}).textContent(), /E6-T11d68/);
  if (task === 'E6-T11d69a' || task === 'E6-T11d69b') assert.match(await page.locator('.cap', {hasText: 'Original GLES queries'}).textContent(), /E6-T11d69a/);
  if(task==='E6-T11d58') assert.match(await graphics.textContent(), /E6-T11d58/);
  if(task==='E6-T11d59') assert.match(await graphics.textContent(), /E6-T11d59/);
  if(task==='E6-T11d60') assert.match(await graphics.textContent(), /E6-T11d60/);
  if(task==='E6-T11d61') assert.match(await graphics.textContent(), /E6-T11d61/);
  if(task==='E6-T11d62') assert.match(await graphics.textContent(), /E6-T11d62/);
  if(task==='E6-T11d63') assert.match(await graphics.textContent(), /E6-T11d63/);
  if(task==='E6-T11d64') assert.match(await graphics.textContent(), /E6-T11d64/);
  if(task==='E6-T11d65') assert.match(await graphics.textContent(), /E6-T11d65/);
  if(task==='E6-T11d67') assert.match(await page.locator('.cap', {hasText:/^Native multisample resolve/}).textContent(), /E6-T11d67/);
  if(task==='E6-T11d66') assert.match(await graphics.textContent(), /E6-T11d66/);
  await Promise.all(liveReads); assert.deepEqual(report.errors, []);
  report.servedWasmSha256 = served.get('/pkg/wasm_vm_wasm_bg.wasm')?.sha256;
  assert.equal(report.servedWasmSha256, sha256(await fs.readFile(path.join(root, 'pkg/wasm_vm_wasm_bg.wasm'))));
  await page.locator('#panel-tests').screenshot({ path: path.join(output, 'browser.png') });
  report.screenshot = { path: 'browser.png', sha256: sha256(await fs.readFile(path.join(output, 'browser.png'))) };
  report.status = 'passed'; console.log('Ordinary built demo:127 passed,0 failed; proof export absent; zero errors.');
} catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack); }
finally {
  report.served = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close().catch(() => {}); if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
