#!/usr/bin/env node
// Full-size snapshot allocation regression on the actual built WASM. No guest instructions or input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../web/node_modules/playwright/index.mjs';
import { R3_IDENTITIES, withinTrialDeadline } from './omarchy-input-trial.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.argv[2] || 'evidence/omarchy-profile/snapshot-allocation-r1');
await fs.mkdir(out, { recursive: false });
const root = path.join(repo, 'web/dist');
const inputs = {
  kernel: path.join(repo, 'releases/kernel/6.6.63/Image'),
  chunkManifest: path.join(repo, 'target/omarchy-profile-chunks-sdr-r3-256k/manifest.json'),
  bootSnapshot: path.join(repo, 'target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz'),
  overlayDelta: path.join(repo, 'target/omarchy-sdr-r3-snapshot/omarchy-overlay-delta.bin.gz'),
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function identity(filename) {
  const digest = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(filename)) { digest.update(chunk); size += chunk.length; }
  return { size, sha256: digest.digest('hex') };
}
const report = { purpose: 'full-size snapshot save/restore and durable export; no responsiveness claim',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), inputs: {}, source: {}, logs: [], errors: [], passed: false };
for (const [name, filename] of Object.entries(inputs)) {
  report.inputs[name] = await identity(filename); assert.deepEqual(report.inputs[name], R3_IDENTITIES[name]);
}
for (const name of ['crates/core/src/resume.rs', 'tools/verify/omarchy-snapshot-allocation.mjs',
  'web/dist/pkg/wasm_vm_wasm.js', 'web/dist/pkg/wasm_vm_wasm_bg.wasm', 'web/dist/roadmap.js']) {
  report.source[name] = await identity(path.join(repo, name));
}
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/probe.html') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Snapshot allocation regression</title>'); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  const input = inputs[pathname.slice(1)];
  const filename = input || path.resolve(root, `.${pathname}`);
  if (!input && !filename.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  const stream = createReadStream(filename);
  stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' })[path.extname(filename)] || 'application/octet-stream');
  stream.pipe(res);
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  report.browser = browser.version();
  const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1440, height: 1050 } });
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.text().startsWith('SNAPSHOT_PHASE ')) { report.logs.push(JSON.parse(message.text().slice(15))); console.log(message.text()); }
  });
  page.on('pageerror', error => report.errors.push(String(error)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin + '/probe.html');
  report.snapshot = await withinTrialDeadline(() => page.evaluate(async ids => {
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const mod = await import('/pkg/wasm_vm_wasm.js'); const wasm = await mod.default();
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
    const memory = () => wasm.memory.buffer.byteLength;
    const phase = (name, values = {}) => console.log('SNAPSHOT_PHASE ' + JSON.stringify({ name, timestamp: new Date().toISOString(), memory: memory(), ...values }));
    // Existing load_resume semantics: recreate the agent TX queue shadow and
    // increment its host-session generation. Compare EVERY byte after applying
    // only these specified transitions to the independently pinned input bytes.
    const expectedRestore = async (reference, label) => {
      const view = new DataView(reference.buffer, reference.byteOffset, reference.byteLength);
      let consoleOffset = null;
      for (let offset = 84; offset < reference.length;) {
        const tag = view.getUint32(offset, true), length = view.getUint32(offset + 4, true);
        check(offset + 8 + length <= reference.length, 'complete section framing');
        if (tag === 11) { check(consoleOffset === null && length === 320, 'pinned console layout'); consoleOffset = offset + 8; }
        offset += 8 + length;
      }
      check(consoleOffset !== null, 'console section present');
      const queue = reference[consoleOffset + 302]; check(queue === 0 || queue === 1, 'agent TX queue shadow');
      const before = view.getBigUint64(consoleOffset + 312, true);
      reference[consoleOffset + 302] = 1;
      const after = BigInt.asUintN(64, before + 1n); view.setBigUint64(consoleOffset + 312, after, true);
      const result = { label, consoleOffset, queueBefore: queue, queueAfter: 1,
        generationBefore: before.toString(), generationAfter: after.toString(), sha256: await hash(reference) };
      phase('expected-restore', result); return result;
    };
    const fetchBytes = async (url, compressed = false) => {
      const response = await fetch(url); check(response.ok, `fetch ${url}`);
      const compressedBytes = new Uint8Array(await response.arrayBuffer());
      const key = url.slice(1); check(await hash(compressedBytes) === ids[key].sha256, `${key} served identity`);
      return compressed ? new Uint8Array(await new Response(new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : compressedBytes;
    };
    const manifestBytes = await fetchBytes('/chunkManifest'); const manifest = new TextDecoder().decode(manifestBytes);
    const kernel = await fetchBytes('/kernel'), delta = await fetchBytes('/overlayDelta', true);
    const seed = await hash(new TextEncoder().encode(`${ids.bootSnapshot.sha256}:${ids.overlayDelta.sha256}`));
    check((await indexedDB.databases()).length === 0, 'fresh owned storage');
    check(await mod.seedOverlayDelta(manifest, delta, seed), 'exact overlay seed');
    const vm = await mod.WasmLinux.newChunkedDiskPersistent(1024, kernel, manifest,
      location.origin + '/unused-chunks/', 128, new Uint32Array(), 'console=ttyS0', false, () => {}, seed, false);
    phase('constructed');
    try {
      const original = await fetchBytes('/bootSnapshot', true);
      vm.loadSnapshotBlob(original); const digest = vm.stateDigest(); const generation = vm.overlayGeneration();
      const beforeMemory = memory(); phase('restored', { originalBytes: original.length, digest, generation });
      const expectedFirst = await expectedRestore(original, 'first');
      const first = vm.saveSnapshot(); const firstHash = await hash(first);
      check(first.length === original.length, 'complete original snapshot length');
      check(firstHash === expectedFirst.sha256, 'all original bytes and exact host-session restore transition');
      check(vm.stateDigest() === digest, 'save leaves RAM digest unchanged');
      phase('saved', { bytes: first.length, sha256: firstHash });
      const decision = vm.restoreDecisionCode(first, generation); check(decision === 'resume', 'coherent resume');
      const stale = vm.restoreDecisionCode(first, generation + 1); check(stale === 'stale', 'stale generation refuses');
      first[44] ^= 1;
      const foreign = vm.restoreDecisionCode(first, generation); check(foreign === 'foreign_image', 'foreign base refuses');
      first[44] ^= 1;
      vm.loadSnapshotBlob(first); check(vm.stateDigest() === digest, 'restored RAM digest');
      const expectedSecond = await expectedRestore(first, 'second');
      const second = vm.saveSnapshot(); const secondHash = await hash(second);
      check(second.length === first.length && secondHash === expectedSecond.sha256, 'complete save/load/save bytes and session transition');
      phase('roundtrip', { sha256: secondHash });
      check((await vm.persistPending()) === 0, 'no pending guest writes');
      await vm.persistSnapshot(); phase('persisted');
      const stored = await vm.readStoredSnapshot(); const storedHash = await hash(stored);
      check(stored.length === second.length && storedHash === secondHash, 'complete durable export bytes');
      const storedDecision = await vm.restoreStoredSnapshot(); check(storedDecision === 'resume', 'actual durable restore');
      check(vm.stateDigest() === digest, 'durable restore RAM digest');
      const expectedThird = await expectedRestore(stored, 'durable');
      const third = vm.saveSnapshot(); const thirdHash = await hash(third);
      check(third.length === stored.length && thirdHash === expectedThird.sha256, 'all durable restore bytes and session transition');
      phase('durable-restored', { sha256: storedHash });
      return { ramMiB: 1024, guestInstructionsExecuted: 0, originalBytes: original.length,
        snapshotBytes: first.length, firstHash, secondHash, storedHash, thirdHash, digest, generation,
        expectedFirst, expectedSecond, expectedThird,
        decision, stale, foreign, storedDecision, beforeMemory, afterMemory: memory(),
        overlayName: mod.overlayDbName(manifest, seed) };
    } finally { await vm.relinquishSnapshotWriter(); vm.closeStorage(); vm.free(); }
  }, report.inputs), Date.now() + 180000, 'full-size snapshot save/restore');
  assert.equal(report.snapshot.guestInstructionsExecuted, 0);
  await page.goto(origin + '/app.html?noAutoBoot=1&testHooks=1');
  const { RISCV_TESTS } = await import('../../web/dist/riscv-tests.js');
  await page.waitForFunction(() => document.getElementById('suite-run')?.disabled === false, null, { timeout: 60000 });
  await page.locator('#suite-run').evaluate(button => button.click());
  await page.waitForFunction(total => document.getElementById('metric-done')?.textContent.trim() === total &&
    document.getElementById('suite-run')?.disabled === false, String(RISCV_TESTS.length), { timeout: 120000 });
  report.suite = await page.evaluate(() => Object.fromEntries(['metric-pass', 'metric-fail', 'metric-done'].map(id => [id, document.getElementById(id)?.textContent.trim()])));
  assert.deepEqual(report.suite, { 'metric-pass': String(RISCV_TESTS.length), 'metric-fail': '0', 'metric-done': String(RISCV_TESTS.length) });
  const capability = page.locator('.cap', { hasText: 'Desktop snapshot reload + interaction round-trip' });
  report.capability = await capability.innerText(); assert.match(report.capability, /snapshot/i);
  report.capabilityEvidence = await capability.locator('.cap-ev').innerText();
  assert.match(report.capabilityEvidence, /E5.5-T03al/);
  assert.match(await capability.locator('.cap-pip').getAttribute('class'), /\bin-progress\b/);
  report.suiteScreenshot = sha(await page.locator('#panel-tests').screenshot({ path: path.join(out, 'suite.png') }));
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ passed: true, snapshot: report.snapshot, suite: report.suite }));
} catch (error) { report.failure = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
