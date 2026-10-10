#!/usr/bin/env node
// Original guest command replay on real hardware WebGL2; no live guest transport.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, sha256 } from './virgl-command/fixtures.mjs';
import { loadDrawFixtures } from './virgl-command/draw-fixtures.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--output', '--chrome', '--sabotage'].includes(args[i]), `unknown ${args[i]}`);
  assert.ok(args[i + 1], `${args[i]} requires a value`);
  options[args[i].slice(2)] = args[i + 1];
}
assert.ok(options.output, 'usage: --output DIR [--sabotage vertex|index|texel|constant|blend|readback-offset]');
assert.ok(options.sabotage === undefined || ['vertex', 'index', 'texel', 'constant', 'blend', 'readback-offset'].includes(options.sabotage));
const output = path.resolve(options.output);
await fs.mkdir(output, { recursive: true });
const codePaths = [
  'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs',
  'renderer/virgl-command/resources-README.md',
  'renderer/virgl-command/constant-domain.mjs', 'renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs', 'renderer/virgl-command/state-README.md', 'renderer/virgl-command/draw-README.md',
  'renderer/virgl-command/tests/draw-acceptance.mjs', 'renderer/virgl-shader/index.mjs',
  'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
  'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/UPSTREAM.json',
  'renderer/virgl-shader/build.sh', 'renderer/virgl-shader/verify_sources.py', 'tools/setup-virgl-emsdk.sh',
  'tools/virgl-command/fixtures.mjs', 'tools/virgl-command/resource-fixtures.mjs', 'tools/virgl-command/state-fixtures.mjs', 'tools/virgl-command/draw-fixtures.mjs',
  'tools/verify-virgl-draw-replay.mjs', 'tools/verify-virgl-draw-replay.sh',
  'tools/virgl-command/draw-receipt.py', 'tools/virgl-command/draw-cold.py',
  'renderer/virgl-shader/vendor/src/virgl_protocol.h', 'renderer/virgl-shader/vendor/src/virgl_hw.h',
  'tools/virgl-capture/workloads/textured-scene.c', 'Makefile',
];
const html = `<!doctype html><meta charset="utf-8"><title>VirGL original draw replay</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px;max-width:1100px}h1{font-size:27px}p{line-height:1.5}pre{white-space:pre-wrap;background:#1b2533;padding:20px;border:1px solid #435167;border-radius:8px;font-size:14px}</style>
<h1>VirGL captured guest draws</h1><p>Eight original submissions · three hardware WebGL2 draws · original staging readbacks · no live guest transport</p>
<p id="status">Replaying original commands, shaders, geometry and readbacks…</p><canvas id="gpu" width="64" height="64"></canvas><main id="draws"></main><pre id="results"></pre>`;
const report = {
  schema: 1, task: 'E6-T12d', status: 'running', guestExecution: false,
  boundary: 'isolated original captured draw replay; no guest transport or production acceleration',
  startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['status', '--porcelain', '--', ...codePaths], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
  sources: [], inputs: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] },
};
let browser, page, server;
const served = new Map();
try {
  const loaded = await loadDrawFixtures();
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
  {
    const modulePaths = codePaths.filter((filename) => filename.startsWith('renderer/') && (filename.endsWith('.mjs') || filename.endsWith('.wasm')));
    let servedFixtures = fixtureBytes;
    if (options.sabotage) {
      const corrupted = structuredClone(loaded.fixtures);
      let mutation;
      if (['vertex', 'index', 'texel'].includes(options.sabotage)) {
        const resourceId = { vertex: 3, index: 4, texel: 7 }[options.sabotage];
        const backing = corrupted.backing.find((entry) => entry.resourceId === resourceId);
        const range = backing.ranges[0], raw = new Uint8Array(range.data), view = new DataView(raw.buffer);
        if (options.sabotage === 'vertex') {
          assert.equal(view.getFloat32(0, true), -1); view.setFloat32(0, 1, true);
          mutation = { event: backing.event, resourceId, byteOffset: 0, before: -1, after: 1, encoding: 'float32-le' };
        } else if (options.sabotage === 'index') {
          assert.equal(view.getUint16(0, true), 0); view.setUint16(0, 4, true);
          mutation = { event: backing.event, resourceId, byteOffset: 0, before: 0, after: 4, encoding: 'uint16-le' };
        } else {
          assert.equal(raw[0], 255); raw[0] = 0;
          mutation = { event: backing.event, resourceId, byteOffset: 0, before: 255, after: 0, encoding: 'uint8' };
        }
        range.data = [...raw];
      } else {
        const event = { constant: 161, blend: 209, 'readback-offset': 173 }[options.sabotage];
        const byteOffset = { constant: 5348, blend: 4156, 'readback-offset': 4156 }[options.sabotage];
        const submission = corrupted.commands.submissions.find((entry) => entry.event === event);
        const raw = new Uint8Array(submission.data), view = new DataView(raw.buffer), before = view.getUint32(byteOffset, true);
        let after;
        if (options.sabotage === 'constant') { assert.equal(before, 0x3f800000); after = 0x3f000000; }
        else if (options.sabotage === 'blend') {
          assert.equal((before >>> 4) & 31, 3); after = ((before & ~(31 << 4)) | (1 << 4)) >>> 0;
        } else { assert.equal(before, 64); after = 4160; }
        view.setUint32(byteOffset, after, true); submission.data = [...raw];
        mutation = { event, byteOffset, before, after, encoding: 'uint32-le' };
      }
      servedFixtures = Buffer.from(JSON.stringify(corrupted));
      report.sabotage = { mode: options.sabotage, ...mutation,
        originalSha256: sha256(fixtureBytes), servedSha256: sha256(servedFixtures) };
    }
    const endpoints = new Map([
      ['/', { bytes: Buffer.from(html), type: 'text/html' }],
      ['/fixtures.json', { bytes: servedFixtures, type: 'application/json' }],
      ...modulePaths.map((filename) => [`/${filename}`, { bytes: sources.get(filename), type: filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' }]),
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
            const { runBrowserAcceptance } = await import('/renderer/virgl-command/tests/draw-acceptance.mjs');
            const result = await runBrowserAcceptance(fixtures);
            document.querySelector('#status').textContent = 'Passed: three original hardware draws, pixel readbacks and lifecycle cleanup';
            const compact = result.summary ?? result;
            document.querySelector('#results').textContent = JSON.stringify(compact, null, 2);
            window.drawProof = { status: 'passed', result };
          } catch (error) {
            window.drawProof = { status: 'failed', error: { message: error.message, stack: error.stack } };
            document.querySelector('#status').textContent = 'Failed: ' + error.message;
            document.querySelector('#results').textContent = error.stack;
          }
          return window.drawProof;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('browser draw replay exceeded 120 seconds')), 120000); }),
      ]);
    } finally { clearTimeout(timer); }
    report.browserMs = performance.now() - browserBegin;
    const coverage = await coverageSession.send('Profiler.takePreciseCoverage');
    const runtimePaths = ['renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs', 'renderer/virgl-command/resources.mjs'];
    const scripts = runtimePaths.map((filename) => {
      const matches = coverage.result.filter((script) => script.url.endsWith('/' + filename));
      assert.equal(matches.length, 1, `coverage must name the served runtime ${filename}`);
      return { source: filename, sha256: sha256(sources.get(filename)), coverage: matches[0] };
    });
    const coverageBytes = Buffer.from(JSON.stringify({ schema: 1, scripts }, null, 2) + '\n');
    await fs.writeFile(path.join(output, 'browser-coverage.json'), coverageBytes);
    report.browserCoverage = { path: 'browser-coverage.json', sha256: sha256(coverageBytes) };
    await coverageSession.send('Profiler.stopPreciseCoverage');
    report.browserResultSha256 = sha256(JSON.stringify(report.browserResult));
    assert.equal(report.browserResult.status, 'passed', report.browserResult.error?.message);
    assert.equal(report.browserResult.result.guestExecution, false);
    assert.equal(report.browserResult.result.status, 'passed');
    assert.equal(report.browserResult.result.primaryDrawReplay, true);
    assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] });
    await page.screenshot({ path: path.join(output, 'browser.png'), fullPage: true });
    report.screenshot = { path: 'browser.png', sha256: sha256(await fs.readFile(path.join(output, 'browser.png'))) };
    console.log(`Hardware draw replay passed (${report.browserMs.toFixed(0)} ms)`);
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
