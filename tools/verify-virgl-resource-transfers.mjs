#!/usr/bin/env node
// Pure resource validation in Node plus real hardware WebGL2 storage/transfer proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, sha256 } from './virgl-command/fixtures.mjs';
import { loadResourceFixtures } from './virgl-command/resource-fixtures.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--output', '--chrome', '--sabotage', '--node-only'].includes(args[i]), `unknown ${args[i]}`);
  assert.ok(args[i + 1], `${args[i]} requires a value`);
  options[args[i].slice(2)] = args[i + 1];
}
assert.ok(options.output, 'usage: --output DIR [--sabotage texture-texel] [--node-only true]');
assert.ok(options.sabotage === undefined || ['texture-texel', 'index-byte'].includes(options.sabotage));
assert.ok(options['node-only'] === undefined || options['node-only'] === 'true');
const output = path.resolve(options.output);
await fs.mkdir(output, { recursive: true });
const codePaths = [
  'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/float-images.mjs', 'renderer/virgl-command/packed-float-images.mjs',
  'renderer/virgl-command/resources-README.md', 'renderer/virgl-command/tests/resources-acceptance.mjs',
  'tools/virgl-command/fixtures.mjs', 'tools/virgl-command/resource-fixtures.mjs',
  'tools/verify-virgl-resource-transfers.mjs', 'tools/verify-virgl-resource-transfers.sh',
  'tools/virgl-command/resources-receipt.py', 'tools/virgl-command/resources-cold.py',
  'tools/virgl-command/resources-coverage.py',
  'renderer/virgl-shader/vendor/src/virgl_protocol.h',
  'renderer/virgl-shader/vendor/src/virgl_hw.h',
  'Makefile',
 'renderer/virgl-command/color-images.mjs'];
const html = `<!doctype html><meta charset="utf-8"><title>VirGL GPU transfer proof</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px;max-width:1100px}h1{font-size:27px}p{line-height:1.5}pre{white-space:pre-wrap;background:#1b2533;padding:20px;border:1px solid #435167;border-radius:8px;font-size:14px}</style>
<h1>VirGL GPU resource transfers</h1><p>Original guest geometry and texture uploads · WebGL2 storage and readback · isolated transfer proof, no desktop acceleration claim</p>
<p id="status">Checking GPU transfers, ownership and hostile inputs…</p><canvas id="gpu" width="64" height="64"></canvas><main id="draws"></main><pre id="results"></pre>`;
const report = {
  schema: 1, task: 'E6-T12b', status: 'running', guestExecution: false,
  boundary: 'isolated resource allocation and GPU transfers; no command draw replay',
  startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['status', '--porcelain', '--', ...codePaths], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
  sources: [], inputs: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] },
};
let browser, page, server;
const served = new Map();
try {
  const loaded = await loadResourceFixtures();
  report.inputs = loaded.sources;
  const fixtureBytes = Buffer.from(JSON.stringify(loaded.fixtures));
  report.fixtureTransport = { bytes: fixtureBytes.length, sha256: sha256(fixtureBytes),
    semantics: 'Original commands/resource metadata; 92 selected initial CPU input bytes with recorded backing lengths; separately labelled comparison-only reference readback ranges' };
  const sources = new Map();
  for (const file of codePaths) {
    const bytes = await fs.readFile(path.join(repo, file));
    report.sources.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
    sources.set(file, bytes);
  }
  const { runNativeAcceptance } = await import(pathToFileURL(path.join(repo, 'renderer/virgl-command/tests/resources-acceptance.mjs')));
  const begin = performance.now();
  report.nodeHeapBefore = process.memoryUsage();
  report.node = runNativeAcceptance(loaded.fixtures);
  report.nodeHeapAfter = process.memoryUsage();
  report.nodePeakRssKiB = process.resourceUsage().maxRSS;
  report.nodeMs = performance.now() - begin;
  report.nodeSha256 = sha256(JSON.stringify(report.node));
  assert.equal(report.node.status, 'passed');
  console.log(`Node resource acceptance passed (${report.nodeMs.toFixed(0)} ms)`);
  if (!options['node-only']) {
    const modulePaths = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs',
      'renderer/virgl-command/tests/resources-acceptance.mjs', 'renderer/virgl-command/color-images.mjs'];
    let servedFixtures = fixtureBytes;
    if (options.sabotage) {
      const corrupted = structuredClone(loaded.fixtures);
      const resourceId = options.sabotage === 'texture-texel' ? 7 : 4;
      const bytes = corrupted.backing.find((b) => b.resourceId === resourceId).ranges[0].data;
      const before = bytes[0]; bytes[0] ^= 1;
      servedFixtures = Buffer.from(JSON.stringify(corrupted));
      report.sabotage = { mode: options.sabotage, resourceId, byteOffset: 0, before, after: bytes[0],
        originalSha256: sha256(fixtureBytes), servedSha256: sha256(servedFixtures) };
    }
    const endpoints = new Map([
      ['/', { bytes: Buffer.from(html), type: 'text/html' }],
      ['/fixtures.json', { bytes: servedFixtures, type: 'application/json' }],
      ...modulePaths.map((filename) => [`/${filename}`, { bytes: sources.get(filename), type: 'text/javascript' }]),
    ]);
    server = createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      const item = endpoints.get(pathname);
      if (!item) { response.writeHead(404).end('not found'); return; }
      served.set(pathname, { path: pathname, bytes: item.bytes.length, sha256: sha256(item.bytes) });
      response.writeHead(200, { 'Content-Type': item.type, 'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(item.bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const chrome = options.chrome || process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
    browser = await chromium.launch({ executablePath: chrome, headless: false, args: ['--enable-gpu'] });
    const session = await browser.newBrowserCDPSession();
    const system = await session.send('SystemInfo.getInfo');
    const commandLine = await session.send('Browser.getBrowserCommandLine');
    const webglFeature = Object.hasOwn(system.gpu.featureStatus, 'webgl2') ? 'webgl2' : 'webgl';
    assert.equal(system.gpu.featureStatus[webglFeature], 'enabled', 'hardware WebGL required');
    assert.ok(!commandLine.arguments.some((arg) => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(arg)));
    report.browser = { executable: chrome, sha256: sha256(await fs.readFile(chrome)), version: browser.version(),
      headless: false, gpu: system.gpu, commandLine: commandLine.arguments, webglFeature };
    const context = await browser.newContext({ viewport: { width: 1120, height: 920 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') report.browserErrors.console.push(m.text()); });
    page.on('pageerror', (e) => report.browserErrors.page.push(e.message));
    page.on('requestfailed', (r) => report.browserErrors.requests.push({ url: r.url(), error: r.failure()?.errorText }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    const coverageSession = await context.newCDPSession(page);
    await coverageSession.send('Profiler.enable');
    await coverageSession.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const browserBegin = performance.now();
    let timer;
    try {
      report.browserResult = await Promise.race([
        page.evaluate(async () => {
          try {
            const fixtures = await (await fetch('/fixtures.json')).json();
            const { runBrowserAcceptance } = await import('/renderer/virgl-command/tests/resources-acceptance.mjs');
            const result = await runBrowserAcceptance(fixtures);
            document.querySelector('#status').textContent = 'Passed: original GPU uploads, readbacks and resource lifetime checks';
            const compact = { status: result.status, guestExecution: result.guestExecution,
              native: result.native ? { ...result.native, cases: result.native.cases?.length } : undefined,
              gpu: { ...result.gpu, readbacks: result.gpu.readbacks.map(({bytes, ...entry}) => ({...entry, bytes: bytes.length})),
                originalUploads: Object.fromEntries(Object.entries(result.gpu.originalUploads).map(([key, bytes]) => [key, {bytes: bytes.length}])),
              },
            };
            document.querySelector('#results').textContent = JSON.stringify(compact, null, 2);
            window.resourceProof = { status: 'passed', result };
          } catch (error) {
            window.resourceProof = { status: 'failed', error: { message: error.message, stack: error.stack } };
            document.querySelector('#status').textContent = 'Failed: ' + error.message;
            document.querySelector('#results').textContent = error.stack;
          }
          return window.resourceProof;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('browser resource proof exceeded 120 seconds')), 120000); }),
      ]);
    } finally { clearTimeout(timer); }
    report.browserMs = performance.now() - browserBegin;
    const coverage = await coverageSession.send('Profiler.takePreciseCoverage');
    const resourceCoverage = coverage.result.filter((script) => script.url.endsWith('/renderer/virgl-command/resources.mjs'));
    assert.equal(resourceCoverage.length, 1, 'resource coverage must name the served runtime');
    const coverageBytes = Buffer.from(JSON.stringify({ schema: 1, source: 'renderer/virgl-command/resources.mjs',
      sha256: sha256(sources.get('renderer/virgl-command/resources.mjs')), coverage: resourceCoverage[0] }, null, 2) + '\n');
    await fs.writeFile(path.join(output, 'browser-coverage.json'), coverageBytes);
    report.browserCoverage = { path: 'browser-coverage.json', sha256: sha256(coverageBytes) };
    await coverageSession.send('Profiler.stopPreciseCoverage');
    report.browserResultSha256 = sha256(JSON.stringify(report.browserResult));
    assert.equal(report.browserResult.status, 'passed', report.browserResult.error?.message);
    assert.deepEqual(report.browserResult.result.native, report.node, 'Node/browser native resource results differ');
    assert.equal(report.browserResult.result.guestExecution, false);
    assert.equal(report.browserResult.result.status, 'passed');
    assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] });
    await page.screenshot({ path: path.join(output, 'browser.png'), fullPage: true });
    report.screenshot = { path: 'browser.png', sha256: sha256(await fs.readFile(path.join(output, 'browser.png'))) };
    console.log(`Hardware resource acceptance passed (${report.browserMs.toFixed(0)} ms)`);
  }
  for (const source of [...report.sources, ...report.inputs]) {
    assert.equal(sha256(await fs.readFile(path.join(repo, source.path))), source.sha256, `input changed during proof ${source.path}`);
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { message: error.message, stack: error.stack };
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 3000 }).then(async () => {
      report.failureScreenshot = { path: 'failure.png', sha256: sha256(await fs.readFile(path.join(output, 'failure.png'))) };
    }).catch(() => {});
  }
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  report.servedFiles = [...served.values()];
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
