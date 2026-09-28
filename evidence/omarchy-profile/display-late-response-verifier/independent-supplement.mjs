import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { auditInputKernelResponse } from '../../../tools/verify/omarchy-input-kernel-response-audit.mjs';
import { auditLateDisplay } from '../../../tools/verify/omarchy-display-late-probe.mjs';
import { auditDisplayPixelProbe } from '../../../tools/verify/omarchy-display-pixel-probe.mjs';

const head = '3055f67a5d768ab34f93d7de291bed713cbb5e9f';
const root = 'evidence/omarchy-profile/display-late-response-r1';
const desktop = path.join(root, 'response/desktop');
const reportBytes = await fs.readFile(path.join(desktop, 'report.json'));
const report = JSON.parse(reportBytes);
const proof = JSON.parse(await fs.readFile(path.join(root, 'proof.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 8000000,
  env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' } });
assert.equal(report.trial.head, head); assert.equal(proof.head, head); assert.equal(proof.code, 0);
assert.equal(sha(await fs.readFile(path.join(root, 'acceptance.log'))), proof.logSha256);
const carried = [];
for (const file of [
  'tools/verify/omarchy-display-pixel-probe.mjs', 'tools/verify/omarchy-owned-trial.mjs',
  'tools/verify/omarchy-input-trial.mjs', 'web/dist/pkg/wasm_vm_wasm_bg.wasm',
  'tools/verify/omarchy-gpu-transfer-runtime.json', 'tools/verify/omarchy-input-kernel-response-state.mjs',
  'evidence/omarchy-profile/display-pixel-boundary-verifier/independent-pixels.mjs',
]) {
  const bytes = git('show', head+':'+file);
  assert.deepEqual(git('show', '556d4d3e:'+file), bytes);
  assert.deepEqual(await fs.readFile(file), bytes);
  carried.push({ file, size:bytes.length, sha256:sha(bytes), unchangedFromAu:true });
}
for (const [file, expected] of Object.entries(proof.runtime.files)) {
  const bytes = git('show', head+':'+file);
  assert.deepEqual({size:bytes.length,sha256:sha(bytes)},expected);
}
const options = { wasmSha256:'7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf',
  displayPixelProbe:true, displayLateProbe:true };
const input = auditInputKernelResponse(report,head,options);
assert.equal(input.input.machineAcceptance,true);
assert.throws(() => auditInputKernelResponse(report,head,{...options,displayLateProbe:false}));
const late = await auditLateDisplay(report,desktop);
const pixels = await auditDisplayPixelProbe(report,desktop);
assert.ok(late.checkpoints.every(row => row.latestMatchesCanvas && row.alphaComparisonExact));
assert.equal(late.desktopAcceptance,false); assert.equal(pixels.desktopAcceptance,false);
const originalAt = Date.parse(report.trial.responseImageCapturedAt);
const diagnosticAt = Date.parse(report.displayLateProbe.startedAt);
const postImage = report.workerTraffic.filter(row => Date.parse(row.timestamp)>=originalAt);
const continuation = postImage.filter(row => Date.parse(row.timestamp)>=diagnosticAt);
// Inspect every recorded message kind, including worker-call; input-request
// alone would miss a direct sendKeyboardEvent/sendTabletEvent call.
assert.ok(continuation.every(row => row.type==='worker-call' && row.method==='keyboardLedState'));
const productReads = postImage.filter(row => Date.parse(row.timestamp)<diagnosticAt);
assert.ok(productReads.every(row => row.type==='worker-call' &&
  ['inputDeviceStats','jitStats','schedulerStats','guestClockState','keyboardLedState'].includes(row.method)));
assert.ok(report.inputEvents.every(row => Date.parse(row.timestamp)<originalAt));
assert.ok(report.observations.filter(row => /ready/i.test(String(row.label??row.stage??row.kind??'')))
  .every(row => Date.parse(row.timestamp)<originalAt));
const frames = report.displayPixelProbe.frames.map(row => ({
  sequence:row.sequence,timestamp:row.timestamp,afterEnterMs:Date.parse(row.timestamp)-report.keyboard.enteredAtMs,
  afterNonceMs:Date.parse(row.timestamp)-Date.parse(report.keyboard.completedAt),scanout:row.scanout,
  rawSha256:row.sha256,
}));
const result = { passed:true,head,reportSha256:sha(reportBytes),proofLogSha256:proof.logSha256,carried,
  helpers:Object.keys(report.trial.helpers).length,commonInputAudit:true,lateAudit:true,observerAudit:true,
  continuationMessages:continuation.length,continuationKinds:['worker-call:keyboardLedState'],
  originalCaptureFinalReadOnlyCalls:productReads.map(row=>({method:row.method,timestamp:row.timestamp})),
  noContinuationStimuli:true,originalImageAt:report.trial.responseImageCapturedAt,
  retainedFrames:frames,lateDisplayAcceptance:late.desktopAcceptance };
await fs.writeFile(new URL('./independent-supplement.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
