// Independent recorded-byte, physical-only input and timing checks. No image
// acceptance is inferred here; a verifier must inspect the actual PNG separately.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { auditSerial } = await import(pathToFileURL(`${process.cwd()}/tools/verify/omarchy-latency-receipt.mjs`));
const dir = process.argv[2];
const expectedHead = process.argv[3];
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/u, 'pass independently frozen full head');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const recordBytes = await fs.readFile(path.join(dir, 'desktop/report.json'));
const report = JSON.parse(recordBytes);
const receipt = JSON.parse(await fs.readFile(path.join(dir, 'run.json')));
assert.equal(hash(recordBytes), receipt.reportSha256);
assert.equal(receipt.head, expectedHead);
assert.equal(report.trial.head, receipt.head);
assert.equal(report.trial.scopedStatus, '');
assert.equal(report.inputObserver, undefined);
assert.equal(report.workerCost, undefined);
assert.equal(report.failureCheckpoint, undefined);
assert.equal(report.trial.profilingRequested, false);
assert.equal(report.trial.admissionProbeRequested, false);
const expectedWasm = execFileSync('git', ['show', `${expectedHead}:web/dist/pkg/wasm_vm_wasm_bg.wasm`], { maxBuffer: 5000000 });
assert.equal(receipt.wasmSha256, hash(expectedWasm));
assert.equal(receipt.gpuRuntime.task, 'E5.5-T03at');
const fixed = {
  kernel: [24208896, '3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d'],
  bootSnapshot: [205400326, '265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8'],
  overlayDelta: [1285559, '1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c'],
};
for (const [role, [size, sha256]] of Object.entries(fixed)) {
  assert.equal(receipt.pairIdentities[role].size, size, role);
  assert.equal(receipt.pairIdentities[role].sha256, sha256, role);
}
const helpers = [];
for (const [file, identity] of Object.entries(report.trial.helpers)) {
  const bytes = execFileSync('git', ['show', `${receipt.head}:${file}`], { maxBuffer: 4000000 });
  assert.equal(bytes.length, identity.size, file); assert.equal(hash(bytes), identity.sha256, file);
  helpers.push(file);
}
const gitCache = new Map();
const resources = [];
for (const row of report.resourceIdentities) {
  assert.equal(row.method, 'GET'); assert.equal(row.status, 200);
  if (row.repoPath?.startsWith('web/')) {
    if (!gitCache.has(row.repoPath)) gitCache.set(row.repoPath,
      execFileSync('git', ['show', `${receipt.head}:${row.repoPath}`], { maxBuffer: 10000000 }));
    const bytes = gitCache.get(row.repoPath);
    assert.equal(bytes.length, row.size, row.pathname); assert.equal(hash(bytes), row.sha256, row.pathname);
  }
  resources.push(row.pathname);
}
for (const [role, route] of [['kernel', '/candidate/kernel'], ['bootSnapshot', '/candidate/boot-snapshot'],
  ['overlayDelta', '/candidate/overlay-delta']]) {
  const expected = receipt.pairIdentities[role];
  assert.equal(report.candidate.source[role].sha256, expected.sha256);
  assert.equal(report.candidate.source[role].size, expected.size);
  const served = report.resourceIdentities.filter(row => row.pathname === route);
  assert.ok(served.length, route);
  for (const row of served) {
    assert.equal(row.sha256, expected.sha256); assert.equal(row.size, expected.size);
  }
}
const notes = 'sha256sum /sys/kernel/notes';
const properties = report.preparedDirect.command;
const read = `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi`;
const layers = 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers';
const serial = auditSerial(report.workerTraffic, [notes, properties, read]);
assert.ok(serial.every(row => [notes, properties, read, layers].includes(row.command)));
assert.ok(report.serialCommands.every(row => [notes, properties, read, layers].includes(row.command)));
const actualNotes = serial.filter(row => row.command === notes);
assert.equal(actualNotes.length, 1);
assert.equal(actualNotes[0].response.exit, 0);
assert.match(actualNotes[0].response.stdout, /^7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f +\/sys\/kernel\/notes\s*$/);
const commands = report.inputEvents.filter(row => row.type === 'keydown' && row.key.length === 1).map(row => row.key).join('');
assert.equal(commands, `printf '${report.keyboard.nonce}' > ${report.keyboard.guestFile}`);
assert.ok(!report.keyboard.guestFile.includes(report.keyboard.nonce));
for (const row of report.inputEvents) {
  assert.equal(row.trusted, true); assert.equal(row.target, 'ide-display-canvas');
  assert.equal(row.activeElement, 'ide-display-canvas');
}
const methods = new Set(['setDisplay', 'keyboardLedState', 'jitStats', 'sendTabletEvent', 'syncTablet',
  'inputDeviceStats', 'schedulerStats', 'guestClockState', 'sendKeyboardEvent', 'syncKeyboard']);
const keyCalls = report.workerTraffic.filter(row => row.type === 'worker-call' && ['sendKeyboardEvent', 'syncKeyboard'].includes(row.method));
for (const row of report.workerTraffic.filter(row => row.type === 'worker-call')) {
  assert.ok(methods.has(row.method), `unapproved actual worker method: ${row.method}`);
  assert.equal(row.worker, 1); assert.equal(row.sent, true);
}
assert.equal(keyCalls.length, report.inputEvents.length * 2);
for (const [i, row] of keyCalls.entries()) {
  assert.equal(row.method, i % 2 ? 'syncKeyboard' : 'sendKeyboardEvent');
  const replies = report.workerTraffic.filter(r => r.type === 'input-result' && r.worker === row.worker && r.id === row.id && r.method === row.method);
  assert.equal(replies.length, 1); assert.equal(replies[0].result, true); assert.equal(replies[0].error, null);
}
const reads = serial.filter(row => row.command === read);
const nonceReplies = reads.filter(row => row.response?.exit === 0 && row.response.stdout.trim() === report.keyboard.nonce);
assert.ok(nonceReplies.some(row => Date.parse(row.completedAt) <= report.keyboard.enteredAtMs + 120000));
assert.ok(nonceReplies.every(row => Date.parse(row.completedAt) > report.keyboard.enteredAtMs));
assert.equal(Date.parse(report.keyboard.deadlineAt) - report.keyboard.enteredAtMs, 120000);
assert.equal(Date.parse(report.startup.deadlineAt) - Date.parse(report.startup.startedAt), 300000);
assert.ok(report.startup.elapsedMs <= 300000); assert.ok(report.keyboard.typingMs <= 60000);
assert.deepEqual(report.errors, []); assert.equal(report.cleanup.closed, true);
assert.equal(receipt.exit.closed, true); assert.equal(receipt.exit.watchdog, null);
assert.ok(Date.parse(report.finishedAt) - Date.parse(report.cleanup.startedAt) <= 30000);
const baseline = report.trial.postNoncePresentationBaseline;
const after = report.trial.presentationAfter;
assert.ok(Date.parse(report.trial.postNoncePresentationBaselineAt) >= Date.parse(report.keyboard.completedAt));
assert.ok(after.framesReceived > baseline.framesReceived);
assert.ok(after.successfulPresents > baseline.successfulPresents);
assert.equal(Date.parse(report.trial.captureDeadlineAt) - Date.parse(report.trial.captureStartedAt), 20000);
assert.ok(Date.parse(report.trial.captureStartedAt) >= Date.parse(report.keyboard.completedAt));
assert.ok(Date.parse(report.trial.responseImageCapturedAt) >= Date.parse(report.trial.postNoncePresentationBaselineAt));
assert.ok(Date.parse(report.trial.responseImageCapturedAt) <= Date.parse(report.trial.captureDeadlineAt));
const images = [];
for (const [file, identity] of Object.entries(receipt.images)) {
  const bytes = await fs.readFile(path.join(dir, 'desktop', file));
  assert.equal(bytes.length, identity.size); assert.equal(hash(bytes), identity.sha256);
  const observation = report.observations.find(row => row.screenshot?.endsWith(`/${file}`));
  assert.equal(observation.sha256, identity.sha256);
  images.push({ file, ...identity, capturedAt: observation.timestamp });
}
console.log(JSON.stringify({ passed: true, purpose: 'physical/byte evidence only; image inspection remains required',
  reportSha256: hash(recordBytes), head: receipt.head, helpersChecked: helpers.length,
  wasmSha256: hash(expectedWasm), captureMs: Date.parse(report.trial.responseImageCapturedAt) - Date.parse(report.trial.captureStartedAt),
  postNonceFrames: [baseline.framesReceived, after.framesReceived],
  servedRows: resources.length, gitResourcesChecked: gitCache.size, trustedKeyEvents: report.inputEvents.length,
  acknowledgedKeyAndSyncCalls: keyCalls.length, serialCommands: serial.map(row => ({ ...row })),
  completedReads: reads.filter(row => row.response).length, pendingReads: reads.filter(row => !row.response).length,
  nonceReplies: nonceReplies.length, nonceLatencyMs: Date.parse(nonceReplies[0].completedAt) - report.keyboard.enteredAtMs,
  cleanupMs: Date.parse(report.finishedAt) - Date.parse(report.cleanup.startedAt), images }, null, 2));
