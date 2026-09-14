// Offline receipt check for this frozen failed pair, not desktop acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertInputTrialSource, assertInputTrialRuntime } from '../../../tools/verify/omarchy-input-trial.mjs';
import { auditSerial } from '../../../tools/verify/omarchy-latency-receipt.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(dir, '../../..');
const bytes = name => fs.readFileSync(path.join(dir, name));
const read = name => JSON.parse(bytes(name));
const hash = value => createHash('sha256').update(value).digest('hex');
const head = '65903012f592d7625c13d632bbd70e9e859b96aa';
const ab = read('ab.json'), reports = ['control', 'candidate'].map(a => read(`${a}/report.json`));
assert.equal(ab.head, head);
assert.deepEqual(ab.arms.map(a => a.arm), ['control', 'candidate']);
assert.ok(Date.parse(ab.arms[0].finishedAt) < Date.parse(ab.arms[1].startedAt));
assert.deepEqual(reports[0].candidate, reports[1].candidate);
const names = [...new Set(reports.flatMap(r => [...Object.keys(r.trial.helpers),
  ...r.resourceIdentities.filter(x => x.repoPath?.startsWith('web/dist/')).map(x => x.repoPath)]))];
for (const name of names) assert.match(name, /^[a-zA-Z0-9_./-]+$/u);
const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: repo,
  input: names.map(name => `${head}:${name}\n`).join(''), maxBuffer: 64000000 });
const frozen = new Map(); let offset = 0;
for (const name of names) {
  const end = batch.indexOf(10, offset);
  const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(batch.subarray(offset, end).toString());
  assert.ok(match); offset = end + 1;
  const size = Number(match[2]); frozen.set(name, batch.subarray(offset, offset + size));
  offset += size; assert.equal(batch[offset++], 10);
}
assert.equal(offset, batch.length);
const results = [];
for (let i = 0; i < reports.length; i++) {
  const r = reports[i], arm = ab.arms[i];
  assert.equal(r.trial.head, head); assert.equal(r.trial.scopedStatus, '');
  assert.equal(r.trial.arm, arm.arm); assert.equal(r.trial.recycling, i === 1);
  for (const [key, expected] of Object.entries({ startupMs: 300000, typingMs: 60000,
    readbackMs: 120000, captureMs: 20000, cleanupMs: 30000 })) assert.equal(r.trial[key], expected);
  assert.equal(r.trial.profilingRequested, false); assert.equal(r.trial.admissionProbeRequested, false);
  assertInputTrialSource(r.candidate.source);
  for (const [name, pin] of Object.entries(r.trial.helpers)) assert.equal(hash(frozen.get(name)), pin.sha256);
  const origin = new URL(r.url).origin, paths = new Set();
  const query = new URL(r.url).searchParams;
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  assert.deepEqual([...query.keys()].sort(), ['desktop', 'guest', 'jit', 'jitColdCounterRecycling', 'omarchyAssetBase', 'omarchyDivider']);
  for (const [key, value] of Object.entries({ guest: 'omarchy', desktop: '1', jit: '1',
    jitColdCounterRecycling: String(i), omarchyDivider: '64', omarchyAssetBase: origin })) assert.equal(query.get(key), value);
  for (const row of r.resourceIdentities) {
    assert.equal(row.method, 'GET'); assert.equal(row.status, 200);
    if (row.repoPath) assert.ok(!path.isAbsolute(row.repoPath) && !row.repoPath.split('/').includes('..'));
    const manifestRoute = `/${r.candidate.manifest.chunkedImage.key}`;
    if (!row.repoPath) assert.ok(['/artifacts-omarchy.json', manifestRoute].includes(row.pathname));
    const data = row.repoPath?.startsWith('web/dist/') ? frozen.get(row.repoPath)
      : row.repoPath ? fs.readFileSync(path.join(repo, row.repoPath))
        : row.pathname === manifestRoute ? fs.readFileSync(r.candidate.source.chunkManifest.filename)
          : Buffer.from(JSON.stringify(r.candidate.manifest));
    assert.equal(row.size, data.length); assert.equal(row.sha256, hash(data)); paths.add(row.pathname);
  }
  for (const row of r.browserRequests) {
    const url = new URL(row.url); assert.equal(url.origin, origin); assert.equal(row.method, 'GET');
    assert.ok(paths.has(url.pathname) || url.pathname === '/favicon.ico');
  }
  assert.equal(r.identities.files['pkg/wasm_vm_wasm_bg.wasm'].sha256, ab.wasmSha256);
  assert.equal(r.restored, true); assert.deepEqual(r.errors, []);
  assert.deepEqual(r.inputEvents, []); assert.equal(r.keyboard, undefined);
  assert.ok(!r.workerTraffic.some(x => /^(sendKeyboardEvent|syncKeyboard|sendTabletEvent|syncTablet|sendMouseEvent|syncMouse)$/u.test(x.method)));
  assert.equal(r.result, 'failed'); assert.equal(r.trial.outcome, 'startup-failed-input-not-tested');
  assert.equal(r.startup.readyProvenAt, undefined);
  assert.equal(Date.parse(r.startup.deadlineAt) - Date.parse(r.startup.startedAt), 300000);
  assert.ok(Date.parse(r.cleanup.startedAt) >= Date.parse(r.startup.deadlineAt));
  assert.ok(Date.parse(r.finishedAt) - Date.parse(r.startup.deadlineAt) < 50000);
  assert.equal(arm.closed, true); assert.equal(arm.watchdog, null); assert.equal(r.cleanup.closed, true);
  const runtime = r.observations.findLast(x => x.runtime)?.runtime;
  assertInputTrialRuntime(runtime, r.trial);
  assert.equal(runtime.presentation.framesReceived, 2); assert.equal(runtime.presentation.successfulPresents, 2);
  const serial = auditSerial(r.workerTraffic, r.serialCommands.map(c => c.command));
  assert.deepEqual(serial.map(c => c.command), ["ls -la '/root'", 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers',
    'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients']);
  assert.equal(serial[0].response.exit, 2); assert.equal(serial[1].response.exit, 0); assert.equal(serial[2].response, null);
  const ready = r.events.find(e => e.type === 'wvm:desktop-ready'); assert.ok(ready.ms < 300000);
  const screenshots = {};
  for (const name of ['desktop.png', 'failure.png']) {
    const row = r.observations.find(x => x.screenshot?.endsWith(`/${name}`)); assert.ok(row);
    const digest = hash(bytes(`${arm.arm}/${name}`)); assert.equal(digest, row.sha256); screenshots[name] = digest;
  }
  results.push({ arm: arm.arm, outcome: r.trial.outcome, desktopReadyMs: ready.ms,
    recycling: runtime.jit.coldCounterRecycling, countsDropped: runtime.jit.discovery.countsDropped,
    guestRetired: runtime.jit.guestRetired, jitRetiredShare: runtime.jit.jitRetiredShare,
    frames: runtime.presentation.framesReceived, serial, opaqueAgentMessages: r.workerTraffic.filter(x => x.method === 'sendAgentInput').length,
    servedResponses: r.resourceIdentities.length, screenshots, reportSha256: hash(bytes(`${arm.arm}/report.json`)) });
}
console.log(JSON.stringify({ head, wasmSha256: ab.wasmSha256, desktopAcceptance: false,
  outcome: 'both-startup-failed-input-efficacy-inconclusive', results,
  limitations: ['No physical key sequence occurred, so neither arm tested the 120-second input acceptance.',
    'Counter effects do not establish input latency, a cause, or a remedy.',
    'Opaque agent payloads are disclosed, not independently decoded.',
    'Main personally viewed both final screenshots; pixels alone do not prove interaction.'] }, null, 2));
