#!/usr/bin/env node
// Same isolated byte-decoder acceptance in Node and an actual headed browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, sha256, loadFixtures } from './virgl-command/fixtures.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--output', '--chrome', '--sabotage', '--node-only'].includes(args[i]), `unknown ${args[i]}`);
  assert.ok(args[i + 1], `${args[i]} requires a value`);
  options[args[i].slice(2)] = args[i + 1];
}
assert.ok(options.output, 'usage: --output DIR [--sabotage packet-length] [--node-only true]');
assert.ok(options.sabotage === undefined || options.sabotage === 'packet-length');
assert.ok(options['node-only'] === undefined || options['node-only'] === 'true');
const output = path.resolve(options.output);
await fs.mkdir(output, { recursive: true });
const codePaths = [
  'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/README.md',
  'renderer/virgl-command/tests/acceptance.mjs',
  'tools/virgl-command/fixtures.mjs', 'tools/verify-virgl-command-decoder.mjs',
  'tools/verify-virgl-command-decoder.sh', 'tools/virgl-command/receipt.py', 'tools/virgl-command/coverage.py', 'tools/virgl-command/cold.py',
  'renderer/virgl-shader/vendor/src/virgl_protocol.h',
  'docs/gpu-3d-contract.json', 'docs/gpu-3d-decision.md', 'Makefile',
 'renderer/virgl-command/color-images.mjs'];
const html = `<!doctype html><meta charset="utf-8"><title>VirGL command decoding proof</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px;max-width:1100px}h1{font-size:27px}p{line-height:1.5}pre{white-space:pre-wrap;background:#1b2533;padding:20px;border:1px solid #435167;border-radius:8px;font-size:14px}</style>
<h1>VirGL command decoding</h1><p>Original textured-scene capture · bounded byte parsing · no GPU execution or guest acceleration claimed</p>
<p id="status">Checking original packets and hostile inputs…</p><pre id="results"></pre>`;
const report = {
  schema: 1, task: 'E6-T12a', status: 'running', guestExecution: false,
  boundary: 'isolated stateless VirGL command decoder; no rendering',
  startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['status', '--porcelain', '--', ...codePaths], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
  sources: [], inputs: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] },
};
let browser, page, server;
const served = new Map();
try {
  const loaded = await loadFixtures();
  report.inputs = loaded.sources;
  const fixtureBytes = Buffer.from(JSON.stringify(loaded.fixtures));
  report.fixtureTransport = { bytes: fixtureBytes.length, sha256: sha256(fixtureBytes),
    semantics: 'JSON serialization of all original command bytes and separately pinned shader texts; no backing-memory snapshots' };
  const sources = new Map();
  for (const file of codePaths) {
    const bytes = await fs.readFile(path.join(repo, file));
    report.sources.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
    sources.set(file, bytes);
  }
  const { runAcceptance } = await import(pathToFileURL(path.join(repo, 'renderer/virgl-command/tests/acceptance.mjs')));
  const begin = performance.now();
  report.nodeHeapBefore = process.memoryUsage();
  report.node = runAcceptance(loaded.fixtures);
  report.nodeHeapAfter = process.memoryUsage();
  report.nodePeakRssKiB = process.resourceUsage().maxRSS;
  report.nodeMs = performance.now() - begin;
  report.nodeSha256 = sha256(JSON.stringify(report.node));
  assert.equal(report.node.status, 'passed');
  console.log(`Node command acceptance passed (${report.nodeMs.toFixed(0)} ms)`);
  if (!options['node-only']) {
    const modulePaths = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/tests/acceptance.mjs', 'renderer/virgl-command/color-images.mjs'];
    let decoderBytes = sources.get(modulePaths[0]);
    if (options.sabotage) {
      const original = decoderBytes.toString('utf8');
      const needle = 'byteLength: packetByteLength';
      assert.equal(original.split(needle).length, 2, 'sabotage must target exactly one packet length field');
      decoderBytes = Buffer.from(original.replace(needle, 'byteLength: packetByteLength + 4'));
      report.sabotage = { mode: options.sabotage, field: 'command.byteLength', mutation: '+4',
        originalSha256: sha256(sources.get(modulePaths[0])), servedSha256: sha256(decoderBytes) };
    }
    const endpoints = new Map([
      ['/', { bytes: Buffer.from(html), type: 'text/html' }],
      ['/fixtures.json', { bytes: fixtureBytes, type: 'application/json' }],
      [`/${modulePaths[0]}`, { bytes: decoderBytes, type: 'text/javascript' }],
      [`/${modulePaths[1]}`, { bytes: sources.get(modulePaths[1]), type: 'text/javascript' }],
      ['/renderer/virgl-command/color-images.mjs', { bytes: sources.get('renderer/virgl-command/color-images.mjs'), type: 'text/javascript' }],
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
    browser = await chromium.launch({ executablePath: chrome, headless: false });
    report.browser = { executable: chrome, sha256: sha256(await fs.readFile(chrome)), version: browser.version(), headless: false };
    const context = await browser.newContext({ viewport: { width: 1120, height: 920 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') report.browserErrors.console.push(m.text()); });
    page.on('pageerror', (e) => report.browserErrors.page.push(e.message));
    page.on('requestfailed', (r) => report.browserErrors.requests.push({ url: r.url(), error: r.failure()?.errorText }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    const browserBegin = performance.now();
    let timer;
    try {
      report.browserResult = await Promise.race([
        page.evaluate(async () => {
          try {
            const fixtures = await (await fetch('/fixtures.json')).json();
            const { runAcceptance } = await import('/renderer/virgl-command/tests/acceptance.mjs');
            const result = runAcceptance(fixtures);
            document.querySelector('#status').textContent = 'Passed: original packets, hostile inputs and recovery';
            const compact = { ...result,
              decodedSubmissions: result.decodedSubmissions?.map((submission) => ({
                event: submission.event, bytes: submission.byteLength, packets: submission.commands.length,
              })),
              attacks: result.attacks ? { ...result.attacks, named: result.attacks.named?.length } : undefined,
            };
            delete compact.submissions;
            document.querySelector('#results').textContent = JSON.stringify(compact, null, 2);
            window.commandProof = { status: 'passed', result };
          } catch (error) {
            window.commandProof = { status: 'failed', error: { message: error.message, stack: error.stack } };
            document.querySelector('#status').textContent = 'Failed: ' + error.message;
            document.querySelector('#results').textContent = error.stack;
          }
          return window.commandProof;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('browser decoder proof exceeded 120 seconds')), 120000); }),
      ]);
    } finally { clearTimeout(timer); }
    report.browserMs = performance.now() - browserBegin;
    report.browserResultSha256 = sha256(JSON.stringify(report.browserResult));
    assert.equal(report.browserResult.status, 'passed', report.browserResult.error?.message);
    assert.deepEqual(report.browserResult.result, report.node, 'Node/browser canonical decoder results differ');
    assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] });
    await page.screenshot({ path: path.join(output, 'browser.png'), fullPage: true });
    report.screenshot = { path: 'browser.png', sha256: sha256(await fs.readFile(path.join(output, 'browser.png'))) };
    console.log(`Browser parity passed (${report.browserMs.toFixed(0)} ms)`);
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
