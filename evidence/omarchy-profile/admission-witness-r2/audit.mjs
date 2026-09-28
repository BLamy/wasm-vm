// One-run offline audit. This does not establish responsive input or renderer ownership.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditSerial } from '../../../tools/verify/omarchy-latency-receipt.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(dir, '../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = new Map();
const show = name => { assert.ok(frozen.has(name)); return frozen.get(name); };
const ids = read('identities.json'), wire = read('wire.json'), rows = read('diagnostic.json');
const driver = fs.readFileSync(path.join(dir, '../admission-witness-gates/record-r2.log'), 'utf8')
  .split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
assert.equal(ids.head, execFileSync('git', ['rev-parse', '55b4475f'], { cwd: repo, encoding: 'utf8' }).trim());
// One read-only Git batch avoids launching a separate Git process for every served file.
const paths = [...new Set([...ids.harness.map(x => x.path),
  ...ids.resourceIdentities.filter(x => x.repoPath?.startsWith('web/dist/')).map(x => x.repoPath)])];
for (const name of paths) assert.match(name, /^[a-zA-Z0-9_./-]+$/u);
const blobs = execFileSync('git', ['cat-file', '--batch'], { cwd: repo,
  input: paths.map(name => `${ids.head}:${name}\n`).join(''), maxBuffer: 64000000 });
let offset = 0;
for (const name of paths) {
  const end = blobs.indexOf(10, offset); assert.ok(end >= offset);
  const header = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(blobs.subarray(offset, end).toString('ascii'));
  assert.ok(header); const size = Number(header[2]); assert.ok(Number.isSafeInteger(size));
  offset = end + 1; assert.ok(offset + size < blobs.length);
  frozen.set(name, blobs.subarray(offset, offset + size)); offset += size;
  assert.equal(blobs[offset++], 10);
}
assert.equal(offset, blobs.length);
assert.equal(ids.scopedStatus, ''); assert.equal(ids.headed, true); assert.deepEqual(ids.errors, []);
assert.equal(ids.ready.restoredFromBootSnapshot, true);
assert.deepEqual(ids.ready.storedSnapshotRestoreEvidence, { attempted: false, decision: null, overlayGeneration: null });
for (const item of ids.harness) assert.equal(item.sha256, hash(show(item.path)));
const base = JSON.parse(fs.readFileSync(path.join(dir, '../admission-witness-r1/diagnostic.json')));
assert.deepEqual(rows[0].sourceReceipt, base[0].sourceReceipt);
const source = rows[0].sourceReceipt;
const generatedManifest = Buffer.from(JSON.stringify({
  generated: 'LOCAL-ONLY diagnostic candidate (explicit real input pair; not a release claim)',
  artifacts: Object.fromEntries([['kernel', '/candidate/kernel'], ['bootSnapshot', '/candidate/boot-snapshot'],
    ['overlayDelta', '/candidate/overlay-delta']].map(([name, url]) =>
    [name, { url, sha256: source[name].sha256, size: source[name].size }])),
  chunkedImage: { key: `chunked-omarchy/manifest-${source.chunkManifest.sha256}.json`,
    sha256: source.chunkManifest.sha256, size: source.chunkManifest.size },
}));
for (const item of ids.resourceIdentities) {
  assert.equal(item.status, 200); assert.equal(item.method, 'GET');
  if (item.repoPath) {
    assert.ok(!path.isAbsolute(item.repoPath) && !item.repoPath.split('/').includes('..'));
    const bytes = item.repoPath.startsWith('web/dist/') ? show(item.repoPath) : fs.readFileSync(path.join(repo, item.repoPath));
    assert.equal(item.size, bytes.length); assert.equal(item.sha256, hash(bytes));
  } else {
    assert.equal(item.pathname, '/artifacts-omarchy.json');
    assert.equal(item.size, generatedManifest.length); assert.equal(item.sha256, hash(generatedManifest));
  }
}
const wasm = ids.resourceIdentities.find(x => x.pathname === '/pkg/wasm_vm_wasm_bg.wasm');
assert.equal(wasm.sha256, '2c8e48ff31c510099f719e849b760e878f6c1c0ec568e4a4aac1336af7520777');
assert.deepEqual(wire.inputEvents, []);
assert.ok(!wire.workerTraffic.some(x => ['sendKeyboardEvent', 'syncKeyboard', 'sendPointerEvent', 'syncPointer'].includes(x.method)));
const serial = auditSerial(wire.workerTraffic, []);
for (const row of rows) {
  assert.ok(!row.error); assert.equal(row.admissionProbeRequested, true);
  assert.equal(row.profileRequested, false); assert.equal(row.jitThreshold, null);
  assert.equal(row.jitResidency, null); assert.equal(row.decodedCacheEntries, null);
  assert.ok(row.event === 'ready' || ['stats', 'screenshot'].includes(row.request?.op));
  const query = new URL(row.pageUrl).searchParams;
  assert.equal(query.get('jitAdmissionProbe'), '1'); assert.equal(query.get('jit'), '1');
  assert.equal(query.get('omarchyDivider'), '64');
}
const uint = value => {
  assert.equal(typeof value, 'string'); assert.match(value, /^(0|[1-9][0-9]*)$/u);
  const n = BigInt(value); assert.ok(n <= 0xffffffffffffffffn); return n;
};
const key = row => JSON.stringify([row.generation, row.physPc, row.codeBytes, row.opLens, row.terminator]);
const stats = rows.filter(r => r.request?.op === 'stats');
for (const { clock, jit } of [ids.ready, ...stats.map(r => r.result)]) {
  assert.equal(clock.mode, 'icount'); assert.equal(clock.clockDiv, 64);
  assert.equal(jit.hasExecutor, true); assert.equal(jit.decodedCacheEntries, 4096);
  assert.equal(jit.jitResidencyPolicy, 'repack-off'); assert.equal(jit.jitResidencyCap, 24);
  assert.equal(jit.entryCost.timingEnabled, false); assert.equal(jit.entryCost.timerReads, 0);
  const p = jit.admissionProbe;
  assert.equal(p.enabled, true); assert.equal(p.capacity, 32); assert.ok(p.records.length <= 32);
  assert.equal(p.countsCapacity, 65536); assert.equal(p.threshold, 512);
  assert.equal(p.selection, 'first-seen-full-map-refusals-per-generation');
  assert.equal(p.entryScope, 'interpreted-discovery-entries-only');
  assert.equal(uint(p.invalidBlocks), 0n);
  let retainedRefusals = 0n;
  assert.equal(new Set(p.records.map(key)).size, p.records.length);
  for (const row of p.records) {
    assert.equal(row.generation, p.generation); assert.match(row.physPc, /^0x[0-9a-f]+$/u);
    assert.ok(row.opLens.length > 0 && row.opLens.length <= 128);
    assert.ok(row.opLens.every(n => n === 2 || n === 4)); assert.match(row.codeBytes, /^[0-9a-f]+$/u);
    assert.equal(row.codeBytes.length, 2 * row.opLens.reduce((a, b) => a + b, 0));
    assert.equal(Object.values(row.reasons).reduce((sum, n) => sum + uint(n), 0n), uint(row.entries));
    assert.ok(uint(row.firstEntry) <= uint(row.lastEntry) && uint(row.lastEntry) <= uint(p.observedEntries));
    assert.equal(row.translationEligible, row.translatorSupported && !row.policyExcluded);
    assert.equal(typeof row.discoveryQueued, 'boolean'); assert.equal(typeof row.compileQueued, 'boolean');
    assert.equal(typeof row.executorResidentAtReport, 'boolean');
    assert.equal(row.residencyScope, 'physical-pc-at-report-not-historical-install-or-byte-identity');
    retainedRefusals += uint(row.reasons.countsFull);
  }
  assert.equal(retainedRefusals + uint(p.overflowRefusals), uint(p.fullMapRefusals));
}
const trigger = stats.find(r => uint(r.result.jit.admissionProbe.fullMapRefusals) > 0n);
const start = driver.find(r => r.event === 'measurement-start');
const exit = driver.find(r => r.event === 'exit');
assert.equal(exit.code, 0); assert.equal(exit.finished, true);
let interval = null;
if (trigger) {
  assert.equal(start.reportTime, trigger.time);
  const received = driver.find(r => r.time === trigger.time);
  assert.ok(Date.parse(received.at) < start.warmEnd);
  const ready = driver.find(r => r.ready === 'INPUT_DIAGNOSTIC_READY');
  assert.ok(Date.parse(received.at) - Date.parse(ready.at) <= 300000);
  const final = stats.find(r => r.request.phase === 'final'); assert.ok(final);
  const elapsedMs = Date.parse(final.time) - Date.parse(trigger.time);
  assert.ok(elapsedMs >= 120000 && elapsedMs <= 180000);
  const before = trigger.result.jit.admissionProbe, after = final.result.jit.admissionProbe;
  const comparable = before.generation === after.generation;
  const byKey = new Map(before.records.map(row => [key(row), row]));
  interval = { elapsedMs, comparable, baseline: trigger.time, end: final.time };
  if (comparable) {
    interval.observedEntries = (uint(after.observedEntries) - uint(before.observedEntries)).toString();
    interval.refusals = (uint(after.fullMapRefusals) - uint(before.fullMapRefusals)).toString();
    interval.rows = after.records.map(row => ({ ...row,
      entryDelta: (uint(row.entries) - uint(byKey.get(key(row))?.entries ?? '0')).toString(),
      refusalDelta: (uint(row.reasons.countsFull) - uint(byKey.get(key(row))?.reasons.countsFull ?? '0')).toString() }));
  }
}
const files = ['identities.json', 'wire.json', 'diagnostic.json', ...rows.filter(r => r.request?.op === 'screenshot').map(r => r.request.name)];
console.log(JSON.stringify({ diagnosticOnly: true, desktopAcceptance: false, head: ids.head,
  servedResponses: ids.resourceIdentities.length, interval,
  outcome: exit.outcome, snapshots: stats.map(r => ({ time: r.time, phase: r.request.phase,
    counts: r.result.jit.admissionProbe.countsLen, fullMapRefusals: r.result.jit.admissionProbe.fullMapRefusals,
    generation: r.result.jit.admissionProbe.generation, frames: r.result.display.framesReceived })),
  implicitSerialCommands: serial.map(r => ({ command: r.command, sentAt: r.sentAt, completedAt: r.completedAt })),
  opaqueAgentMessages: wire.workerTraffic.filter(r => r.method === 'sendAgentInput').length,
  digests: Object.fromEntries(files.map(name => [name, hash(fs.readFileSync(path.join(dir, name)))])),
  limitations: ['First-seen 32-entry sample is not a heavy-hitter census.', 'Entry counts are not retired instructions or CPU time.',
    'No physical input was tested.', 'Native validation could overlap; no host-performance claim.',
    'PC-only residency is not exact/historical installation.', 'Opaque agent payloads are not audited.',
    'Screenshots require separate visual inspection.'] }, null, 2));
