import assert from "node:assert/strict";
import { auditInputReport } from "./omarchy-input-audit.mjs";
import { auditPreparedDirect, PREPARED_DIRECT_COMMAND } from "./omarchy-prepared-direct-state.mjs";
import { INPUT_BUFFER_PREPARED_FOOT, INPUT_BUFFER_RESPONSE_WASM } from "./omarchy-input-kernel-response-state.mjs";
import { assertInputKernelNotes, INPUT_BUFFER_NOTES_COMMAND } from "./omarchy-input-kernel-state.mjs";
import { assertOriginalInputGeometry } from "./omarchy-compositor-input-capture.mjs";

export function auditInputKernelResponse(report, head, { wasmSha256 = INPUT_BUFFER_RESPONSE_WASM, displayPixelProbe = false } = {}) {
  assert.match(wasmSha256, /^[a-f0-9]{64}$/u);
  assert.equal(report.displayPixelProbeRequested === true, displayPixelProbe);
  const input = auditInputReport(report, { head, wasmSha256, inputKernelWasmSha256: wasmSha256, arm: "candidate",
    preparedDirect: true, preparedRecycling: true, inputKernelPrepared: true,
    startupCommands: [INPUT_BUFFER_NOTES_COMMAND, PREPARED_DIRECT_COMMAND] });
  assert.equal(report.inputObserver, undefined); assert.equal(report.workerCost, undefined);
  assert.equal(report.failureCheckpoint, undefined);
  assert.equal(report.trial.profilingRequested, false); assert.equal(report.trial.admissionProbeRequested, false);
  for (const row of report.observations.filter(row => row.runtime)) assertOriginalInputGeometry(row.runtime.presentation);
  const configuration = auditPreparedDirect(report, { expectedFoot: INPUT_BUFFER_PREPARED_FOOT,
    startupCommands: [INPUT_BUFFER_NOTES_COMMAND] });
  const notes = input.serial.filter(row => row.command === INPUT_BUFFER_NOTES_COMMAND);
  const properties = input.serial.filter(row => row.command === PREPARED_DIRECT_COMMAND);
  assert.ok(notes.length <= 1);
  if (report.keyboard) {
    assert.equal(notes.length, 1); assert.equal(properties.length, 1);
    assertInputKernelNotes(notes[0].response);
    assert.equal(report.inputKernelIdentity.status, "verified");
    assert.deepEqual(report.inputKernelIdentity.response, notes[0].response);
    assert.ok(Date.parse(notes[0].completedAt) <= Date.parse(properties[0].sentAt));
    assert.ok(Date.parse(report.keyboard.startedAt) >= Date.parse(properties[0].completedAt));
  }
  if (report.keyboard?.typedAt) {
    const fence = report.preparedDirectInputFence;
    assert.equal(fence.method, "Input.setIgnoreInputEvents"); assert.equal(fence.ignore, true);
    assert.ok(Date.parse(fence.startedAt) >= report.keyboard.enteredAtMs);
    assert.ok(Date.parse(fence.acknowledgedAt) >= Date.parse(fence.startedAt));
    assert.ok(Date.parse(fence.acknowledgedAt) < Date.parse(report.keyboard.deadlineAt));
    assert.ok(report.inputEvents.every(row => Date.parse(row.timestamp) <= Date.parse(fence.startedAt)));
  }
  if (input.machineAcceptance) {
    const baseline = report.trial.postNoncePresentationBaseline, after = report.trial.presentationAfter;
    assert.ok(Date.parse(report.trial.postNoncePresentationBaselineAt) >= Date.parse(report.keyboard.completedAt));
    assert.ok(after.framesReceived > baseline.framesReceived, "response image predates nonce execution");
    assert.ok(after.successfulPresents > baseline.successfulPresents, "response image was not presented after nonce execution");
    assert.equal(Date.parse(report.trial.captureDeadlineAt) - Date.parse(report.trial.captureStartedAt), 20000);
    assert.ok(Date.parse(report.trial.captureStartedAt) >= Date.parse(report.keyboard.completedAt));
    assert.ok(Date.parse(report.trial.responseImageCapturedAt) >= Date.parse(report.trial.postNoncePresentationBaselineAt));
    assert.ok(Date.parse(report.trial.responseImageCapturedAt) <= Date.parse(report.trial.captureDeadlineAt));
  }
  return { input, configuration, visualInspectionRequired: true };
}
