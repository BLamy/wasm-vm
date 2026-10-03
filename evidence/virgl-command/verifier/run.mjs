import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runIndependent } from './attacks.mjs';
import { runAcceptance } from '../../../renderer/virgl-command/tests/acceptance.mjs';
import { decodeSubmission } from '../../../renderer/virgl-command/decoder.mjs';
import { loadFixtures, repo } from '../../../tools/virgl-command/fixtures.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { seeds: [0x13579bdf, 0x2468ace0, 0xdeadbeef, 0x10293847], count: 8192 };
const report = { gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  decoderSha256: sha(await fs.readFile(path.join(repo, 'renderer/virgl-command/decoder.mjs'))),
  options, status: 'running', errors: [], served: [], startedAt: new Date().toISOString() };
let server, browser;
try {
  const { fixtures } = await loadFixtures();
  const start = performance.now(); report.independent = runIndependent();
  const native = runAcceptance(fixtures, options); report.nativeCanonicalSha256 = sha(JSON.stringify(native));
  report.acceptance = { counts: native.counts, assertions: native.assertions,
    attacks: { ...native.attacks, named: native.attacks.named.length }, maximumCases: native.maximumCases };
  const foreign = vm.runInNewContext('new Uint8Array([28,0,1,0,120,86,52,18])');
  assert.equal(decodeSubmission(foreign).commands[0].fields.subContextId, 0x12345678);
  const shared = vm.runInNewContext('new Uint8Array(new SharedArrayBuffer(8))');
  assert.equal(decodeSubmission(shared).error.code, 'invalid-input');
  report.nativeForeignRealm = 'passed'; report.nodeMs = performance.now() - start;
  const endpoints = new Map();
  endpoints.set('/', Buffer.from('<!doctype html><title>Independent VirGL decoder verification</title><pre id="result">Running</pre>'));
  endpoints.set('/fixtures.json', Buffer.from(JSON.stringify(fixtures)));
  for (const file of ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/tests/acceptance.mjs', 'evidence/virgl-command/verifier/attacks.mjs']) {
    endpoints.set('/' + file, await fs.readFile(path.join(repo, file)));
  }
  const seen = new Set();
  server = createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/favicon.ico') { res.writeHead(204).end(); return; }
    const bytes = endpoints.get(route); if (!bytes) { res.writeHead(404).end(); return; }
    if (!seen.has(route)) report.served.push({ path: route, sha256: sha(bytes) }); seen.add(route);
    res.writeHead(200, { 'content-type': route.endsWith('.mjs') ? 'text/javascript' : route.endsWith('.json') ? 'application/json' : 'text/html',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('requestfailed', req => report.errors.push(req.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async options => {
    const { runIndependent } = await import('/evidence/virgl-command/verifier/attacks.mjs');
    const { runAcceptance } = await import('/renderer/virgl-command/tests/acceptance.mjs');
    const { decodeSubmission } = await import('/renderer/virgl-command/decoder.mjs');
    const independent = runIndependent();
    const acceptance = runAcceptance(await (await fetch('/fixtures.json')).json(), options);
    const frame = document.createElement('iframe'); document.body.append(frame);
    const foreign = new frame.contentWindow.Uint8Array([28,0,1,0,120,86,52,18]);
    if (decodeSubmission(foreign).commands[0].fields.subContextId !== 0x12345678) throw new Error('foreign realm byte view');
    const shared = new frame.contentWindow.Uint8Array(new frame.contentWindow.SharedArrayBuffer(8));
    if (decodeSubmission(shared).error.code !== 'invalid-input') throw new Error('foreign shared byte view');
    frame.remove(); document.querySelector('#result').textContent = JSON.stringify({ independent, counts: acceptance.counts, mutations: acceptance.attacks.mutations, foreignRealm: 'passed' }, null, 2);
    return { independent, acceptance, foreignRealm: 'passed' };
  }, options);
  assert.deepEqual(result.independent, report.independent); assert.deepEqual(result.acceptance, native);
  assert.deepEqual(report.errors, []); report.browserCanonicalSha256 = sha(JSON.stringify(result.acceptance));
  report.browserForeignRealm = result.foreignRealm; report.browserVersion = browser.version();
  await page.screenshot({ path: path.join(root, 'browser.png'), fullPage: true });
  report.screenshotSha256 = sha(await fs.readFile(path.join(root, 'browser.png')));
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ status: report.status, checks: report.independent, error: report.failure, canonical: report.nativeCanonicalSha256 }, null, 2));
