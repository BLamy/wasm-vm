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
assert.ok(process.argv.length === 4 || (process.argv.length === 6 && process.argv[4] === '--task'));
const task = process.argv[5] ?? 'E6-T11a';
assert.ok(['E6-T11a', 'E6-T11b2', 'E6-T11c'].includes(task));
const output = path.resolve(process.argv[3]), root = path.join(repo, 'web/dist');
await fs.mkdir(output, { recursive: true });
const report = { schema: 1, task, status: 'running',
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  command: [process.execPath, ...process.argv.slice(1)], startedAt: new Date().toISOString(), errors: [], served: [] };
const served = new Map(); let browser, server, page;
try {
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
  server = createServer(async (request, response) => {
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
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
  browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('requestfailed', (request) => report.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  report.url = `http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
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
  assert.match(await graphics.textContent(), /production acceleration disabled/);
  assert.deepEqual(report.errors, []);
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
