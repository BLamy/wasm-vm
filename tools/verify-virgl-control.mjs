#!/usr/bin/env node
// Real Wasm virtqueue control callbacks to hardware WebGL2 resource/state owners.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, sha256 } from './virgl-command/fixtures.mjs';
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--output', '--chrome', '--sabotage'].includes(args[i]) && args[i + 1], 'usage: --output DIR [--chrome PATH]');
  options[args[i].slice(2)] = args[i + 1];
}
assert.ok(options.output, '--output required');
assert.ok(options.sabotage === undefined || options.sabotage === 'skip-context', 'Unknown sabotage');
const output = path.resolve(options.output);
await fs.mkdir(output, { recursive: true });
const codePaths = [
  'Cargo.lock', 'Cargo.toml', 'crates/core/Cargo.toml', 'crates/wasm/Cargo.toml',
  'crates/core/src/lib.rs', 'crates/core/src/desktop_restore.rs',
  'crates/core/src/dev/virtio/gpu/mod.rs', 'crates/core/src/dev/virtio/gpu/protocol.rs',
  'crates/core/src/dev/virtio/gpu/snapshot.rs', 'crates/core/src/dev/virtio/gpu/control3d.rs',
  'crates/core/tests/virtio_gpu_control3d.rs',
  'crates/wasm/src/lib.rs', 'crates/wasm/src/virgl_control_proof.rs',
  'renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/control-README.md',
  'crates/core/src/dev/virtio/gpu/scanout3d.rs',
  'crates/wasm/src/virgl_control_proof/scanout.rs',
  'renderer/virgl-command/scanout.mjs',
  'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/state.mjs', 'renderer/virgl-command/decoder.mjs',
  'renderer/virgl-command/tests/control-acceptance.mjs', 'renderer/virgl-shader/index.mjs',
  'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
  'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/UPSTREAM.json',
  'renderer/virgl-shader/build.sh', 'renderer/virgl-shader/verify_sources.py', 'tools/setup-virgl-emsdk.sh',
  'tools/virgl-command/fixtures.mjs', 'tools/verify-virgl-control.mjs', 'tools/verify-virgl-control.sh',
  'tools/verify-virgl-default-demo.mjs', 'web/dist/pkg/wasm_vm_wasm_bg.wasm', 'web/dist/sw.js',
  'tools/virgl-command/control-receipt.py', 'tools/virgl-command/control-cold.py', 'Makefile',
];
async function collect(directory) {
  for (const entry of await fs.readdir(path.join(repo, directory), { withFileTypes: true })) {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(filename);
    else if (/\.(js|wasm)$/.test(entry.name)) codePaths.push(filename);
  }
}
await collect('target/virgl-control/pkg');
const html = `<!doctype html><meta charset="utf-8"><title>VirtIO 3D control proof</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px;max-width:1050px}h1{font-size:27px}p{line-height:1.5}pre{white-space:pre-wrap;background:#1b2533;padding:20px;border:1px solid #435167;border-radius:8px;font-size:14px}</style>
<h1>VirtIO 3D context and resource control</h1><p>Real Wasm guest queues → synchronous host bridge → hardware WebGL2 storage</p>
<p>Isolated proof fixture; production VIRGL and capsets remain disabled.</p><p id="status">Running packet, ownership and failure checks…</p><canvas id="gpu" width="64" height="64"></canvas><pre id="results"></pre>`;
const report = { schema: 1, task: 'E6-T11a', status: 'running', liveGuest3d: false,
  boundary: 'actual Wasm control queue and hardware resource lifecycle; no SUBMIT, scanout or production acceleration',
  startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['status', '--porcelain', '--', ...codePaths], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
  sources: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] } };
const sources = new Map(), served = new Map();
let browser, page, server;
try {
  for (const filename of codePaths) {
    const bytes = await fs.readFile(path.join(repo, filename));
    sources.set(filename, bytes); report.sources.push({ path: filename, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const servedSources = new Map(sources);
  if (options.sabotage) {
    const filename = 'renderer/virgl-command/control-bridge.mjs';
    const before = sources.get(filename).toString(), target = 'try { unwrap(renderer.createContext(context.id)); }';
    assert.equal(before.split(target).length, 2, 'Unique context creation sabotage anchor');
    const after = Buffer.from(before.replace(target, 'try { /* sabotage: skip renderer context */ }'));
    servedSources.set(filename, after);
    report.sabotage = { mode: options.sabotage, path: filename, originalSha256: sha256(sources.get(filename)), servedSha256: sha256(after) };
  }
  const endpoints = new Map([['/', { bytes: Buffer.from(html), type: 'text/html' }],
    ...codePaths.filter((file) => /\.(m?js|wasm)$/.test(file)).map((filename) => [`/${filename}`,
      { bytes: servedSources.get(filename), type: filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' }])]);
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
  const system = await session.send('SystemInfo.getInfo'), commandLine = await session.send('Browser.getBrowserCommandLine');
  const feature = Object.hasOwn(system.gpu.featureStatus, 'webgl2') ? 'webgl2' : 'webgl';
  assert.equal(system.gpu.featureStatus[feature], 'enabled', 'hardware WebGL required');
  assert.ok(!commandLine.arguments.some((arg) => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(arg)));
  report.browser = { executable: chrome, sha256: sha256(await fs.readFile(chrome)), version: browser.version(),
    headless: false, gpu: system.gpu, commandLine: commandLine.arguments, webglFeature: feature };
  const context = await browser.newContext({ viewport: { width: 1120, height: 920 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.browserErrors.console.push(m.text()); });
  page.on('pageerror', (e) => report.browserErrors.page.push(e.message));
  page.on('requestfailed', (r) => report.browserErrors.requests.push({ url: r.url(), error: r.failure()?.errorText }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  const coverageSession = await context.newCDPSession(page);
  await coverageSession.send('Profiler.enable');
  await coverageSession.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const begin = performance.now();
  let timer;
  try {
    report.browserResult = await Promise.race([page.evaluate(async () => {
      try {
        const wasm = await import('/target/virgl-control/pkg/wasm_vm_wasm.js'); await wasm.default();
        const { createVirglControlBridge } = await import('/renderer/virgl-command/control-bridge.mjs');
        const { runBrowserAcceptance } = await import('/renderer/virgl-command/tests/control-acceptance.mjs');
        const result = await runBrowserAcceptance({ WasmVirglControlProof: wasm.WasmVirglControlProof, createVirglControlBridge });
        document.querySelector('#status').textContent = 'Passed: guest queue responses, actual GPU allocation, ownership and rollback';
        document.querySelector('#results').textContent = JSON.stringify(result.summary ?? result, null, 2);
        return { status: 'passed', result };
      } catch (error) {
        document.querySelector('#status').textContent = 'Failed: ' + error.message;
        document.querySelector('#results').textContent = error.stack;
        return { status: 'failed', error: { message: error.message, stack: error.stack } };
      }
    }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('browser control proof exceeded 180 seconds')), 180000); })]);
  } finally { clearTimeout(timer); }
  report.browserMs = performance.now() - begin;
  const coverage = await coverageSession.send('Profiler.takePreciseCoverage');
  const scripts = ['renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/state.mjs'].map((filename) => {
    const matches = coverage.result.filter((script) => script.url.endsWith('/' + filename));
    assert.equal(matches.length, 1, `coverage must name served runtime ${filename}`);
    return { source: filename, sha256: sha256(servedSources.get(filename)), coverage: matches[0] };
  });
  // Preserve callback marshaller coverage from wasm-bindgen inline-JS snippets as well.
  for (const filename of codePaths.filter((file) => file.startsWith('target/virgl-control/pkg/snippets/') && file.endsWith('.js'))) {
    const matches = coverage.result.filter((script) => script.url.endsWith('/' + filename));
    if (matches.length) scripts.push({ source: filename, sha256: sha256(servedSources.get(filename)), coverage: matches[0] });
  }
  const coverageBytes = Buffer.from(JSON.stringify({ schema: 1, scripts }, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'browser-coverage.json'), coverageBytes);
  report.browserCoverage = { path: 'browser-coverage.json', sha256: sha256(coverageBytes) };
  await coverageSession.send('Profiler.stopPreciseCoverage');
  report.browserResultSha256 = sha256(JSON.stringify(report.browserResult));
  assert.equal(report.browserResult.status, 'passed', report.browserResult.error?.message);
  assert.equal(report.browserResult.result.status, 'passed');
  assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] });
  await page.screenshot({ path: path.join(output, 'browser.png'), fullPage: true });
  report.screenshot = { path: 'browser.png', sha256: sha256(await fs.readFile(path.join(output, 'browser.png'))) };
  for (const source of report.sources) assert.equal(sha256(await fs.readFile(path.join(repo, source.path))), source.sha256, `source changed during proof ${source.path}`);
  report.status = 'passed';
  console.log(`Hardware Wasm control proof passed (${report.browserMs.toFixed(0)} ms)`);
} catch (error) {
  report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  console.error(error.stack);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 3000 }).then(async () => {
    report.failureScreenshot = { path: 'failure.png', sha256: sha256(await fs.readFile(path.join(output, 'failure.png'))) };
  }).catch(() => {});
} finally {
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
