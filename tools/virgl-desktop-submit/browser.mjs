#!/usr/bin/env node
// Real Wasm virtqueue control callbacks to hardware WebGL2 resource/state owners.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDrawFixtures } from '../virgl-command/draw-fixtures.mjs';
import { repo, sha256 } from '../virgl-command/fixtures.mjs';
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--output', '--chrome', '--sabotage', '--suite', '--seeds'].includes(args[i]) && args[i + 1], 'usage: --output DIR [--chrome PATH]');
  options[args[i].slice(2)] = args[i + 1];
}
assert.ok(options.output, '--output required');
assert.ok(options.suite === undefined || ['native-buffer','native-image'].includes(options.suite), 'Unknown suite');
const seeds=options.seeds?.split(',').map(Number);
if(seeds)assert.ok(seeds.length===3&&new Set(seeds).size===3&&seeds.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff),'three distinct u32 seeds required');
assert.ok(options.sabotage === undefined || ['old-job-bound'].includes(options.sabotage), 'Unknown sabotage');
const output = path.resolve(options.output);
await fs.mkdir(output, { recursive: true });
const { fixtures, sources: drawInputs } = await loadDrawFixtures();
const inputs=[];
for (const name of ['compositor','kmscube','glmark2-es2']) {
  const directory='evidence/virgl-corpus/captures/'+name,manifestPath=directory+'/manifest.json';
  const manifestRaw=await fs.readFile(path.join(repo,manifestPath)),manifest=JSON.parse(manifestRaw);
  const eventPath=directory+'/'+manifest.events.path,raw=await fs.readFile(path.join(repo,eventPath));
  assert.equal(sha256(raw),manifest.events.sha256);assert.equal(raw.length,manifest.events.bytes);
  const pending=new Map(),calls=[];
  for(const e of raw.toString().trim().split('\n').map(JSON.parse)) {
    if(!['resource_create','resource_unref'].includes(e.type))continue;
    if(e.phase==='enter'){assert.ok(!pending.has(e.seq));pending.set(e.seq,e);}
    else {const enter=pending.get(e.callSeq);assert.ok(enter&&enter.type===e.type);assert.equal(e.result,0);pending.delete(e.callSeq);calls.push({enter,returned:e});}
  }
  assert.equal(pending.size,0);const excluded=calls.filter(c=>c.enter.resourceId===2);
  assert.equal(excluded.length,1);assert.equal(excluded[0].enter.seq,10);assert.equal(excluded[0].enter.flags,1);
  inputs.push({name,eventPath,eventSha256:sha256(raw),bootstrap2D:excluded[0],calls:calls.filter(c=>c.enter.resourceId!==2)});
}
const codePaths = JSON.parse(await fs.readFile(path.join(repo, 'tools/virgl-desktop-submit/sources.json'), 'utf8'));
const layouts=JSON.parse(await fs.readFile(path.join(repo,'tools/virgl-native-image/original-layouts.json'),'utf8')).rows;
for(const input of drawInputs)if(!codePaths.includes(input.path))codePaths.push(input.path);
async function collect(directory) {
  for (const entry of await fs.readdir(path.join(repo, directory), { withFileTypes: true })) {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(filename);
    else if (/\.(js|wasm)$/.test(entry.name)) codePaths.push(filename);
  }
}
await collect('target/virgl-desktop-submit/pkg');
const html = `<!doctype html><meta charset="utf-8"><title>VirtIO 3D control proof</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px;max-width:1050px}h1{font-size:27px}p{line-height:1.5}pre{white-space:pre-wrap;background:#1b2533;padding:20px;border:1px solid #435167;border-radius:8px;font-size:14px}</style>
<h1>Selected desktop VirtIO submission owners</h1><p>Real Wasm guest queues → asynchronous host bridge → hardware WebGL2 storage</p>
<p>Isolated proof fixture; production VIRGL and capsets remain disabled.</p><p id="status">Running packet, ownership and failure checks…</p><canvas id="gpu" width="64" height="64"></canvas><div id="draws" style="display:flex;flex-wrap:wrap"></div><pre id="results"></pre>`;
const report = { schema: 1, task: options.suite === 'native-image' ? 'E6-T11d54' : options.suite === 'native-buffer' ? 'E6-T11d53' : 'E6-T11d52', status: 'running', liveGuest3d: false,
  boundary: 'actual Wasm control queue and hardware resource lifecycle; guest DMA and fenced submissions; no scanout or production acceleration',
  startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['status', '--porcelain', '--', ...codePaths], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
  inputs, drawInputs, fixturesSha256: sha256(JSON.stringify(fixtures)), sources: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] } };
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
    const before = sources.get(filename).toString();
    const target = 'normalizeJob(input, desktop ? 64 : 16)';
    assert.equal(before.split(target).length, 2, 'Unique selected bound anchor');
    const replacement = 'normalizeJob(input, 16)';
    const after = Buffer.from(before.replace(target, replacement));
    servedSources.set(filename, after);
    report.sabotage = { mode: options.sabotage, path: filename, originalSha256: sha256(sources.get(filename)), servedSha256: sha256(after) };
  }
  const endpoints = new Map([['/', { bytes: Buffer.from(html), type: 'text/html' }], ['/fixtures.json', {bytes: Buffer.from(JSON.stringify(fixtures)),type:'application/json'}], ['/inputs.json', {bytes:Buffer.from(JSON.stringify(inputs)),type:'application/json'}],
    ['/layouts.json',{bytes:Buffer.from(JSON.stringify(layouts)),type:'application/json'}],
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
    report.browserResult = await Promise.race([page.evaluate(async ({suite,seeds}) => {
      try {
        const wasm = await import('/target/virgl-desktop-submit/pkg/wasm_vm_wasm.js'); const exports = await wasm.default();
        const { createVirglControlBridge, createVirglSubmitBridge, createVirglStandardDesktopSubmitBridge } = await import('/renderer/virgl-command/control-bridge.mjs');
        const { runDesktopAcceptance } = await import('/renderer/virgl-command/tests/desktop-submit-acceptance.mjs');
        const run = suite==='native-image' ? (await import('/renderer/virgl-command/tests/native-image-acceptance.mjs')).runNativeImageAcceptance : suite==='native-buffer' ? (await import('/renderer/virgl-command/tests/native-buffer-acceptance.mjs')).runNativeBufferAcceptance : runDesktopAcceptance;
        const result = await run({ seeds, layouts:await fetch('/layouts.json').then(r=>r.json()), WasmVirglSubmitProof: wasm.WasmVirglSubmitProof, createVirglControlBridge, createVirglSubmitBridge, createVirglStandardDesktopSubmitBridge, inputs:await fetch('/inputs.json').then(r=>r.json()), fixtures: await fetch('/fixtures.json').then(r=>r.json()), wasmMemory: exports.memory });
        document.querySelector('#status').textContent = 'Passed: fresh DMA, ordered GPU completion and exact guest responses';
        document.querySelector('#results').textContent = JSON.stringify(result.summary ?? result, null, 2);
        return { status: 'passed', result };
      } catch (error) {
        document.querySelector('#status').textContent = 'Failed: ' + error.message;
        document.querySelector('#results').textContent = error.stack;
        return { status: 'failed', error: { message: error.message, stack: error.stack }, partial:window.__desktopProof??null, point:window.__desktopActive?.()??null };
      }
    }, {suite:options.suite??null,seeds}), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('browser submit proof exceeded 180 seconds')), 180000); })]);
  } finally { clearTimeout(timer); }
  report.browserMs = performance.now() - begin;
  const coverage = await coverageSession.send('Profiler.takePreciseCoverage');
  const scripts = ['renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs'].map((filename) => {
    const matches = coverage.result.filter((script) => script.url.endsWith('/' + filename));
    assert.equal(matches.length, 1, `coverage must name served runtime ${filename}`);
    return { source: filename, sha256: sha256(servedSources.get(filename)), coverage: matches[0] };
  });
  // Preserve callback marshaller coverage from wasm-bindgen inline-JS snippets as well.
  for (const filename of codePaths.filter((file) => file.startsWith('target/virgl-desktop-submit/pkg/snippets/') && file.endsWith('.js'))) {
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
  await page.screenshot({ path: path.join(output, 'browser.png'), fullPage: true, timeout:10000 });
  report.screenshot = { path: 'browser.png', sha256: sha256(await fs.readFile(path.join(output, 'browser.png'))) };
  for (const source of report.sources) assert.equal(sha256(await fs.readFile(path.join(repo, source.path))), source.sha256, `source changed during proof ${source.path}`);
  report.status = 'passed';
  console.log(`Hardware Wasm ordered submit proof passed (${report.browserMs.toFixed(0)} ms)`);
} catch (error) {
  report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  console.error(error.stack);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 3000 }).then(async () => {
    report.failureScreenshot = { path: 'failure.png', sha256: sha256(await fs.readFile(path.join(output, 'failure.png'))) };
  }).catch(() => {});
} finally {
  for(const [filename,bytes] of sources){const destination=path.join(output,'source',filename);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);}
  await fs.writeFile(path.join(output,'fixtures.json'),JSON.stringify(fixtures,null,2)+'\n');
  await fs.writeFile(path.join(output,'inputs.json'),JSON.stringify(inputs,null,2)+'\n');
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
