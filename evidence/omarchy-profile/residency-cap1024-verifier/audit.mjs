import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { auditInputKernelResponse } from '../../../tools/verify/omarchy-input-kernel-response-audit.mjs';
import { inputTrialOptions, inputTrialUrl } from '../../../tools/verify/omarchy-input-trial.mjs';

const root = process.cwd(), worker = path.join(root, 'evidence/omarchy-profile/residency-cap1024-r2');
const head = '96a4c890e5d01b4110f2ea65ff28f3012a93056e';
const wasm = '7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf';
const stale = '431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({ size: bytes.length, sha256: sha(bytes) });
const at = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n)); return n; };
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' } });
const read = name => fs.readFile(path.join(worker, name));
const reportBytes = await read('response/desktop/report.json'), receiptBytes = await read('response/run.json');
const report = JSON.parse(reportBytes), receipt = JSON.parse(receiptBytes);
const baselineBytes = await fs.readFile('evidence/omarchy-profile/display-late-response-r1/response/desktop/report.json');
const baseline = JSON.parse(baselineBytes);
assert.equal(sha(baselineBytes), '365b017269a72cfc2f047f786e2ecd2b50543790247e0b6193866fae0dfdaeb7');
assert.equal(report.trial.head, head); assert.equal(receipt.head, head);
assert.equal(receipt.reportSha256, sha(reportBytes)); assert.equal(report.trial.scopedStatus, '');
assert.equal(receipt.machineAcceptance, true); assert.equal(receipt.desktopAcceptance, false);
assert.equal(receipt.visualInspectionRequired, true); assert.equal(receipt.diagnosticOnly, false);
assert.equal(receipt.experiment, 'prepared-cap-1024');
assert.deepEqual(receipt.exit, { code: 0, signal: null, closed: true, watchdog: null });
const audit = r => auditInputKernelResponse(r, head, { wasmSha256: wasm, experiment: 'prepared-cap-1024' });
const shared = audit(report); assert.equal(shared.input.machineAcceptance, true);

const pins = {
  kernel: { size: 24208896, sha256: '3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d' },
  bootSnapshot: { size: 205400326, sha256: '265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8' },
  overlayDelta: { size: 1285559, sha256: '1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c' },
  chunkManifest: { size: 1097812, sha256: '5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44' },
};
for (const [role, pin] of Object.entries(pins)) {
  const source = report.candidate.source[role];
  assert.deepEqual({ size: source.size, sha256: source.sha256 }, pin);
  assert.deepEqual(receipt.pairIdentities[role], pin);
  assert.ok(source.filename.startsWith(root + '/target/'));
  assert.deepEqual(identity(await fs.readFile(source.filename)), pin);
}
assert.equal(receipt.wasmSha256, wasm);
assert.equal(sha(await fs.readFile(receipt.preparedRecord.filename)), '577f33d7ecc5b29b161c436dbfcc1be11e3676ff1293bf45b71738f2954f4180');
const sources = [];
for (const [file, pin] of Object.entries(report.trial.helpers)) {
  assert.deepEqual(identity(git('show', `${head}:${file}`)), pin);
  assert.deepEqual(identity(await fs.readFile(file)), pin);
  sources.push({ file, ...pin });
}
for (const [file, pin] of Object.entries(receipt.gpuRuntime.files)) {
  assert.deepEqual(identity(git('show', `${head}:${file}`)), pin);
  assert.deepEqual(identity(await fs.readFile(file)), pin);
  assert.deepEqual(identity(git('show', `3055f67a:${file}`)), pin);
}
assert.deepEqual(receipt.gpuRuntime.files['web/dist/pkg/wasm_vm_wasm_bg.wasm'], { size: 1602266, sha256: wasm });
const served = new Map(); let gitResources = 0;
for (const row of report.resourceIdentities) {
  assert.equal(row.method, 'GET'); assert.equal(row.status, 200);
  const key = row.repoPath ?? row.pathname;
  if (!served.has(key)) {
    const bytes = row.repoPath ? await fs.readFile(path.join(root, row.repoPath))
      : row.pathname === '/' + report.candidate.manifest.chunkedImage.key
        ? await fs.readFile(report.candidate.source.chunkManifest.filename)
        : Buffer.from(JSON.stringify(report.candidate.manifest));
    served.set(key, identity(bytes));
    if (row.repoPath?.startsWith('web/dist/')) {
      assert.deepEqual(identity(git('show', `${head}:${row.repoPath}`)), identity(bytes)); gitResources++;
    }
  }
  assert.deepEqual(served.get(key), { size: row.size, sha256: row.sha256 });
}

const normalUrl = value => {
  const url = new URL(value); assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/app.html'); assert.equal(url.hash, '#ide');
  assert.equal(url.searchParams.get('omarchyAssetBase'), url.origin);
  url.searchParams.delete('omarchyAssetBase'); url.port = '1'; return url;
};
const actualUrl = normalUrl(report.url), priorUrl = normalUrl(baseline.url);
assert.equal(actualUrl.searchParams.get('jitResidency'), 'cap-1024');
assert.equal(priorUrl.searchParams.get('jitResidency'), 'cap-256');
const originalUrl = actualUrl.href;
actualUrl.searchParams.set('jitResidency', 'cap-256'); assert.equal(actualUrl.href, priorUrl.href);
const baseUrl = 'http://127.0.0.1:1/app.html?guest=omarchy&desktop=1#ide';
const options = experiment => inputTrialOptions({ urlArg: 'local', pair: 'pin', chunks: 'pin', arm: 'candidate', renderer: null, lp: null, experiment });
assert.equal(inputTrialUrl(baseUrl, options('prepared-cap-1024')).href, originalUrl);
assert.equal(inputTrialUrl(baseUrl, options('prepared-recycling')).href, priorUrl.href);
for (const key of ['displayLateProbe', 'displayPixelProbe', 'workerCost', 'inputObserver', 'failureCheckpoint',
  'displayLateProbeRequested', 'displayPixelProbeRequested', 'renderBudgetRequested', 'compositorModeRequested']) assert.equal(report[key], undefined);
assert.equal(report.trial.profilingRequested, false); assert.equal(report.trial.admissionProbeRequested, false);
const runtimes = report.observations.filter(x => x.runtime).map(x => x.runtime);
assert.equal(runtimes.length, 2);
for (const r of runtimes) {
  assert.equal(r.jit.jitResidencyPolicy, 'cap-1024'); assert.equal(r.jit.jitResidencyCap, 1024);
  assert.equal(r.jit.coldCounterRecycling.enabled, true); assert.equal(r.jit.decodedCacheEntries, 4096);
  assert.equal(r.jit.admissionProbe, false); assert.equal(r.jit.entryCost.timingEnabled, false);
  assert.equal(r.clock.mode, 'icount'); assert.equal(r.clock.clockDiv, 64);
  assert.equal(r.presentation.width, 1280); assert.equal(r.presentation.height, 800);
  assert.equal(r.scheduler.quantum, 500000); assert.equal(r.jit.jitRegionChaining, true); assert.equal(r.jit.jitDynamicChaining, true);
}

const keys = report.inputEvents, traffic = report.workerTraffic, keyboard = report.keyboard;
assert.equal(keys.length, 128);
assert.ok(keys.every(row => row.trusted && !row.repeat && row.target === 'ide-display-canvas' && row.activeElement === 'ide-display-canvas'));
const typed = keys.filter(row => row.type === 'keydown' && row.key.length === 1).map(row => row.key).join('');
assert.equal(typed, `printf '${keyboard.nonce}' > ${keyboard.guestFile}`);
assert.deepEqual(keys.slice(-2).map(row => [row.type, row.code]), [['keydown', 'Enter'], ['keyup', 'Enter']]);
const boots = traffic.filter(row => row.type === 'worker-boot'); assert.equal(boots.length, 1); assert.equal(boots[0].sent, true);
assert.ok(traffic.every(row => row.worker === 1));
const readers = new Set(['keyboardLedState', 'jitStats', 'guestClockState', 'inputDeviceStats', 'schedulerStats']);
for (const row of traffic.filter(row => row.type === 'worker-call')) {
  assert.equal(row.sent, true);
  if (readers.has(row.method)) assert.deepEqual(row.args, []);
  else if (['sendKeyboardEvent', 'syncKeyboard'].includes(row.method)) assert.ok(at(row.timestamp) <= keyboard.enteredAtMs);
  else if (['sendTabletEvent', 'syncTablet'].includes(row.method)) assert.ok(at(row.timestamp) < at(keyboard.startedAt));
  else if (row.method === 'setDisplay') { assert.deepEqual(row.args, [1280, 800]); assert.ok(at(row.timestamp) < at(keyboard.startedAt)); }
  else assert.fail(`unexpected input method: ${row.method}`);
}
const ack = traffic.filter(row => row.type === 'input-result' && ['sendKeyboardEvent', 'syncKeyboard'].includes(row.method));
assert.equal(ack.length, 256); assert.ok(ack.every(row => row.result === true && row.error === null));
const serialIn = traffic.filter(row => row.type === 'serial-input').map(row => Buffer.from(row.bytes).toString('ascii')).join('');
assert.ok(!serialIn.includes(keyboard.nonce));
let serialOut = ''; const spans = [];
for (const [index, row] of traffic.entries()) if (row.type === 'serial-output') {
  spans.push({ start: serialOut.length, end: serialOut.length + row.text.length, index, timestamp: row.timestamp }); serialOut += row.text;
}
const replies = [...serialOut.matchAll(/__WVBEGIN_([a-z0-9]+)\r?\n([\s\S]*?)\r?\n__WVEND_\1_(\d+)\r?\n/g)]
  .filter(match => match[2].trim() === keyboard.nonce && match[3] === '0');
assert.equal(replies.length, 1);
const reply = replies[0], endOffset = reply.index + reply[0].length - 1;
const completion = spans.find(row => row.start <= endOffset && row.end > endOffset);
const command = `if [ -f '${keyboard.guestFile}' ]; then cat '${keyboard.guestFile}'; else (exit 75); fi`;
const inputLine = serialIn.split('\r').find(line => line.includes(`__WVBEGIN_${reply[1]}`)); assert.ok(inputLine.includes(command));
// serial.log is the visible guest-output stream; quiet RPC replies are retained
// in report.workerTraffic instead. The raw worker fence is authoritative here.
const serialLog = await read('response/desktop/serial.log');
assert.ok(!serialLog.toString().includes(keyboard.nonce));
assert.ok(at(completion.timestamp) >= keyboard.enteredAtMs && at(completion.timestamp) <= keyboard.enteredAtMs + 120000);
assert.ok(at(keyboard.completedAt) >= at(completion.timestamp) && at(keyboard.completedAt) <= at(keyboard.deadlineAt));
assert.equal(at(keyboard.deadlineAt) - keyboard.enteredAtMs, 120000);
assert.equal(at(report.startup.deadlineAt) - at(report.startup.startedAt), 300000);
assert.ok(at(report.startup.readyProvenAt) <= at(report.startup.deadlineAt)); assert.ok(keyboard.typingMs <= 60000);
assert.equal(at(report.trial.captureDeadlineAt) - at(report.trial.captureStartedAt), 20000);
assert.ok(at(report.trial.responseImageCapturedAt) <= at(report.trial.captureDeadlineAt));
assert.equal(report.cleanup.timeoutMs, 30000); assert.ok(at(report.finishedAt) - at(report.cleanup.startedAt) <= 30000);
assert.deepEqual(report.errors, []);
const png = await read('response/desktop/desktop-keyboard.png'); assert.equal(sha(png), stale);
assert.deepEqual(identity(png), receipt.images['desktop-keyboard.png']);
assert.deepEqual(png, await fs.readFile('evidence/omarchy-profile/display-late-response-r1/response/desktop/desktop-keyboard.png'));

const attacks = [];
for (const [name, mutate] of [
  ['metadata-cap1024-but-runtime-cap256', r => { for (const row of r.observations.filter(x => x.runtime)) { row.runtime.jit.jitResidencyPolicy = 'cap-256'; row.runtime.jit.jitResidencyCap = 256; } }],
  ['late-runtime-cap-drift', r => { r.observations.filter(x => x.runtime).at(-1).runtime.jit.jitResidencyCap = 24; }],
  ['recycling-disabled', r => { r.observations.find(x => x.runtime).runtime.jit.coldCounterRecycling.enabled = false; }],
  ['clock-divider-drift', r => { r.observations.find(x => x.runtime).runtime.clock.clockDiv = 1; }],
  ['untrusted-physical-event', r => { r.inputEvents[0].trusted = false; }],
  ['receipt-nonce-only-forged', r => { r.keyboard.nonce = '0'.repeat(16); }],
  ['raw-success-nonce-replaced', r => { for (const row of r.workerTraffic) if (row.type === 'serial-output') row.text = row.text.replaceAll(r.keyboard.nonce, '0'.repeat(16)); }],
  ['late-nonce-claim', r => { r.keyboard.completedAt = new Date(at(r.keyboard.deadlineAt) + 1).toISOString(); }],
  ['late-screenshot-claim', r => { r.trial.responseImageCapturedAt = new Date(at(r.trial.captureDeadlineAt) + 1).toISOString(); }],
  ['readiness-probe-route', r => { r.displayLateProbeRequested = true; }],
]) {
  const forged = structuredClone(report); mutate(forged); let error = null;
  try { audit(forged); } catch (e) { error = String(e); }
  assert.ok(error, `forgery accepted: ${name}`); attacks.push({ name, rejected: true, error });
}
const forgedReceipt = { ...receipt, desktopAcceptance: true };
let imageRejection;
try {
  assert.equal(forgedReceipt.machineAcceptance, true);
  if (forgedReceipt.desktopAcceptance) assert.notEqual(sha(png), stale, 'claimed visible response is exactly the independently inspected empty-prompt baseline');
} catch (error) { imageRejection = String(error); }
assert.ok(imageRejection); attacks.push({ name: 'machine-pass-promoted-to-visible-success', rejected: true,
  gate: 'independent visual evidence check; shared audit intentionally proves machine acceptance only', error: imageRejection });

const files = {};
async function seal(folder, prefix = '') {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) await seal(path.join(folder, entry.name), rel + '/');
    else if (entry.isFile()) files[rel] = identity(await fs.readFile(path.join(folder, entry.name)));
    else assert.fail('unexpected non-regular evidence');
  }
}
await seal(worker);
const preflightPath = path.join(root, 'evidence/omarchy-profile/residency-cap1024-r1/response');
const preflightReceiptBytes = await fs.readFile(path.join(preflightPath, 'run.json'));
const preflightLogBytes = await fs.readFile(path.join(preflightPath, 'desktop.log'));
const preflight = JSON.parse(preflightReceiptBytes);
assert.equal(preflight.exit.code, 1);
assert.match(preflightLogBytes.toString(), /input-trial requires a frozen committed runtime and recorder/);
assert.match(preflightLogBytes.toString(), /omarchy-desktop-live\.mjs:524:10/);
assert.equal(preflight.result, undefined);
const result = { passed: true, head, workerSubmission: 'fc9f242e86a1a7f45a17612baf2a9ab52a76343d',
  report: identity(reportBytes), receipt: identity(receiptBytes), provenance: pins, sources,
  resources: { rows: report.resourceIdentities.length, unique: served.size, gitResources },
  url: report.url, priorUrl: baseline.url, onlyUrlPolicyChange: 'cap-256 -> cap-1024',
  actualRuntime: runtimes.map(r => ({ at: r.timestamp, cap: r.jit.jitResidencyCap, policy: r.jit.jitResidencyPolicy,
    recycling: r.jit.coldCounterRecycling, guestRetired: r.jit.guestRetired,
    evictions: r.jit.jitCacheEvictions, retranslations: r.jit.jitCacheRetranslations,
    backpressure: r.jit.compileQueue.droppedBackpressure, frames: r.presentation.framesReceived })),
  physical: { typed, nonce: keyboard.nonce, guestFile: keyboard.guestFile, trustedEvents: keys.length, trueAcks: ack.length,
    fence: reply[1], rawCompletion: completion, rawNonceMsAfterEnter: at(completion.timestamp) - keyboard.enteredAtMs,
    recordedNonceMsAfterEnter: at(keyboard.completedAt) - keyboard.enteredAtMs, serialInputNonceAbsent: true,
    successfulReadCommand: inputLine, rawSuccessfulFence: reply[0], oneWorker: true, noPostEnterInput: true,
    visibleSerialLog: { ...identity(serialLog), containsNonce: false,
      reason: 'Quiet RPC replies are in report.workerTraffic, not the visible guest-output serial.log.' } },
  timing: { startupMs: report.startup.elapsedMs, typingMs: keyboard.typingMs,
    imageAt: report.trial.responseImageCapturedAt, imageMsAfterEnter: at(report.trial.responseImageCapturedAt) - keyboard.enteredAtMs,
    imageMsAfterNonce: at(report.trial.responseImageCapturedAt) - at(keyboard.completedAt),
    cleanupMs: at(report.finishedAt) - at(report.cleanup.startedAt), noDiagnosticContinuation: true },
  image: { ...identity(png), equalToVerifiedStaleBaseline: true, personallyInspected: true, visibleResponse: false },
  machineAcceptance: true, desktopAcceptance: false, attacks, workerEvidenceFiles: files,
  earlierPreflight: { head: preflight.head, receipt: identity(preflightReceiptBytes), log: identity(preflightLogBytes),
    explanation: 'r1 stopped at dirty-source assertion line 524 before browser launch; no physical trial or retry occurred.' } };
await fs.writeFile(new URL('./audit.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, sources: result.sources.length, workerEvidenceFiles: Object.keys(files).length }, null, 2));
