// Synthetic freshness guard attacks against the AS-only capture correction.
// The old real image remains a visual failure, even when synthetic counters pass.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { auditInputKernelResponse } = await import(pathToFileURL(`${process.cwd()}/tools/verify/omarchy-input-kernel-response-audit.mjs`));
const file = 'evidence/omarchy-profile/input-kernel-response-r1/desktop/report.json';
const raw = await fs.readFile(file), original = JSON.parse(raw);
const control = structuredClone(original);
const completed = Date.parse(control.keyboard.completedAt);
control.trial.postNoncePresentationBaseline = structuredClone(control.trial.presentationAfter);
control.trial.postNoncePresentationBaselineAt = new Date(completed).toISOString();
control.trial.captureStartedAt = new Date(completed).toISOString();
control.trial.captureDeadlineAt = new Date(completed + 20000).toISOString();
control.trial.responseImageCapturedAt = new Date(completed + 1).toISOString();
control.trial.presentationAfter.framesReceived++;
control.trial.presentationAfter.successfulPresents++;
const result = auditInputKernelResponse(control, control.trial.head);
assert.equal(result.input.machineAcceptance, true);
assert.equal(result.visualInspectionRequired, true);
const cases = [];
function reject(name, bad, pattern) {
  let error;
  try { auditInputKernelResponse(bad, bad.trial.head); } catch (e) { error = String(e); }
  assert.ok(error, `${name} was accepted`);
  if (pattern) assert.match(error, pattern);
  cases.push({ name, rejected: true, error });
}
reject('the genuine r1 pre-nonce capture cannot satisfy the new guard', original);
const stale = structuredClone(control);
stale.trial.presentationAfter = structuredClone(stale.trial.postNoncePresentationBaseline);
reject('same frame as the post-nonce baseline', stale, /response image predates nonce execution/);
const notPresented = structuredClone(control);
notPresented.trial.presentationAfter.successfulPresents = notPresented.trial.postNoncePresentationBaseline.successfulPresents;
reject('received but not presented after nonce', notPresented, /not presented after nonce execution/);
const early = structuredClone(control);
early.trial.postNoncePresentationBaselineAt = new Date(completed - 1).toISOString();
reject('baseline timestamp precedes nonce completion', early);
const late = structuredClone(control);
late.trial.responseImageCapturedAt = new Date(completed + 20001).toISOString();
reject('image timestamp exceeds original20s capture budget', late);
const auditBytes = await fs.readFile('tools/verify/omarchy-input-kernel-response-audit.mjs');
console.log(JSON.stringify({ purpose: 'synthetic capture-guard proof; no image/product acceptance', passed: true,
  recordedReport: { file, sha256: createHash('sha256').update(raw).digest('hex') },
  auditSha256: createHash('sha256').update(auditBytes).digest('hex'),
  syntheticControlAccepted: true, manualVisualInspectionStillRequired: result.visualInspectionRequired, cases }, null, 2));
