// Bound raw-wire attack on the AS audit. Any fabricated control is explicitly
// synthetic and is never offered as guest/application or image evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { auditInputKernelResponse } = await import(pathToFileURL(`${process.cwd()}/tools/verify/omarchy-input-kernel-response-audit.mjs`));
const file = process.argv[2] ?? 'evidence/omarchy-profile/input-kernel-response-r1/desktop/report.json';
const bytes = await fs.readFile(file), original = JSON.parse(bytes);
const originalAudit = auditInputKernelResponse(original, original.trial.head);
assert.ok(original.keyboard?.typedAt, 'attack needs one completed real physical sequence');
const records = originalAudit.input.serial;
const noncePath = original.keyboard.guestFile;
const target = records.find(row => row.command.includes(`cat '${noncePath}'`) && row.response
  && Date.parse(row.completedAt) <= Date.parse(original.keyboard.deadlineAt));
assert.ok(target, 'attack needs one completed in-budget read');
const sample = original.workerTraffic.find(row => row.type === 'serial-output');
const originMs = Date.parse(sample.timestamp) - sample.ms;
const control = structuredClone(original);
control.result = 'input-trial-physical-nonce-and-fresh-presentation';
control.keyboard.verified = true;
control.keyboard.completedAt = target.completedAt;
delete control.keyboard.failedAt; delete control.keyboard.error;
control.trial.outcome = control.result;
control.trial.presentationAfter = structuredClone(control.trial.presentationBaseline);
control.trial.presentationAfter.framesReceived++;
control.trial.presentationAfter.successfulPresents++;
function wireWithNonce(value) {
  const report = structuredClone(control);
  report.workerTraffic = report.workerTraffic.filter(row => row.type !== 'serial-output');
  for (const row of records.filter(row => row.response)) {
    const isTarget = row.rid === target.rid;
    const isOtherRead = !isTarget && row.command.includes(`cat '${noncePath}'`);
    let stdout = isTarget ? `${value}\n` : isOtherRead ? '' : row.response.stdout;
    if (stdout && !stdout.endsWith('\n')) stdout += '\n';
    report.workerTraffic.push({ ...sample, type: 'serial-output',
      ms: Date.parse(row.completedAt) - originMs, timestamp: row.completedAt,
      text: `\n__WVBEGIN_${row.rid}\n${stdout}__WVEND_${row.rid}_${isTarget ? 0 : isOtherRead ? 75 : row.response.exit}\n` });
  }
  report.workerTraffic.sort((a, b) => a.ms - b.ms);
  return report;
}
const good = wireWithNonce(control.keyboard.nonce);
assert.equal(auditInputKernelResponse(good, good.trial.head).input.machineAcceptance, true,
  'synthetic valid control must reach nonce acceptance before attacking it');
const cases = [];
function reject(name, report) {
  let error;
  try { auditInputKernelResponse(report, report.trial.head); } catch (e) { error = String(e); }
  assert.match(error ?? '', /no timely nonce on the raw wire/u, `wrong rejection for ${name}`);
  cases.push({ name, rejected: true, error });
}
const wrong = control.keyboard.nonce === 'ffffffffffffffff' ? '0000000000000000' : 'ffffffffffffffff';
reject('raw zero-exit read returns another 16-hex nonce', wireWithNonce(wrong));
const late = wireWithNonce(control.keyboard.nonce);
const output = late.workerTraffic.find(row => row.type === 'serial-output' && row.text.includes(`__WVBEGIN_${target.rid}\n`));
output.timestamp = new Date(Date.parse(late.keyboard.deadlineAt) + 1).toISOString();
output.ms = Date.parse(output.timestamp) - originMs;
reject('matching raw nonce arrives one millisecond after Enter+120s', late);
console.log(JSON.stringify({ purpose: 'synthetic nonce acceptance attack; no product acceptance',
  recordedReport: { file, sha256: createHash('sha256').update(bytes).digest('hex'), head: original.trial.head,
    actualMachineAcceptance: originalAudit.input.machineAcceptance, actualResult: original.result },
  syntheticControlAccepted: true, syntheticTargetRead: target.rid, cases, passed: true }, null, 2));
