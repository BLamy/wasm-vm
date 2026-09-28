// Critic audit of the actual prepared-pair recording; never launches a guest.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";
import { DIRECT_OPAQUE_COMMAND } from "../../../tools/verify/omarchy-direct-opaque-command.mjs";
const root = new URL("../../../", import.meta.url), at = p => new URL(p, root);
const sha = x => createHash("sha256").update(x).digest("hex");
const nativeBytes = await fs.readFile(at("evidence/omarchy-profile/input-kernel-pair-r1/native/run.json"));
const native = JSON.parse(nativeBytes);
const reportBytes = await fs.readFile(at("evidence/omarchy-profile/input-kernel-pair-r1/browser/desktop/report.json"));
const report = JSON.parse(reportBytes);
const runBytes = await fs.readFile(at("evidence/omarchy-profile/input-kernel-pair-r1/browser/run.json"));
const run = JSON.parse(runBytes);
const notesCommand = "sha256sum /sys/kernel/notes";
const notesDigest = "7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f";
assert.equal(sha(reportBytes), run.reportSha256);
assert.equal(run.head, "21b77bb028996ed0a5450e289d4690eb820aab4d");
assert.equal(run.passed, true);
assert.equal(run.keyboardAcceptance, false);
assert.deepEqual(run.exit, { code: 0, signal: null, closed: true, watchdog: null });
assert.equal(report.trial.head, run.head); assert.equal(report.trial.scopedStatus, "");
assert.equal(report.inputKernel.sha256, sha(nativeBytes));
assert.deepEqual(report.inputKernel.provenance, native);
assert.equal(report.restored, true); assert.equal(report.result, "prepared-mode-pair-input-untested");
assert.deepEqual(report.errors, []); assert.equal(report.cleanup.closed, true);
assert.equal(report.keyboard, undefined); assert.deepEqual(report.inputEvents, []);
assert.equal(report.preparationInputFence.ignore, true);
assert.ok(Date.parse(report.preparationInputFence.acknowledgedAt) <= Date.parse(report.browserRequests[0].timestamp));
for (const row of report.workerTraffic) assert.ok(!/^(send(Keyboard|Mouse|Tablet|Agent)|sync(Keyboard|Mouse|Tablet))/u.test(row.method ?? ""));
const allowed = ["XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers", notesCommand, DIRECT_OPAQUE_COMMAND, "sync"];
const serial = auditSerial(report.workerTraffic, allowed);
assert.deepEqual(serial.map(x => x.command), allowed);
assert.ok(serial.every(x => x.response?.exit === 0));
const [layers, notes, properties, sync] = serial;
assert.deepEqual(notes.response.stdout.trim().split(/\s+/u), [notesDigest, "/sys/kernel/notes"]);
assert.deepEqual(notes.response, report.inputKernelIdentity.response);
assert.ok(Date.parse(notes.completedAt) <= Date.parse(properties.sentAt));
const propLines = properties.response.stdout.split(/\r?\n/u).map(x => x.trim()).filter(Boolean);
assert.deepEqual(propLines.slice(0, 8), Array(8).fill("ok"));
assert.deepEqual(propLines.slice(8, 10), ["true", "true"]);
for (const value of propLines.slice(10, 13)) assert.match(value, /^1(\.0+)?$/u);
assert.deepEqual(propLines.slice(13, 16), ["true", "true", "true"]);
const foot = JSON.parse(propLines.slice(16).join("\n"));
assert.equal(foot.pid, 473); assert.equal(foot.class, "foot");
assert.equal(foot.mapped, true); assert.equal(foot.hidden, false); assert.equal(foot.acceptsInput, true);
assert.deepEqual(foot.at, [12, 38]); assert.deepEqual(foot.size, [1256, 750]);
assert.deepEqual(foot, report.modePreparation.foot); assert.deepEqual(foot, report.directOpaque.foot);
const prep = report.modePreparation;
assert.ok(Date.parse(properties.completedAt) <= Date.parse(prep.baselineAt));
assert.ok(Date.parse(prep.visibleAt) < Date.parse(report.startup.deadlineAt));
assert.equal(Date.parse(report.startup.deadlineAt) - Date.parse(report.startup.startedAt), 900000);
assert.equal(Date.parse(prep.exportDeadlineAt) - Date.parse(prep.exportStartedAt), 180000);
assert.ok(Date.parse(sync.sentAt) >= Date.parse(prep.exportStartedAt));
assert.ok(Date.parse(sync.completedAt) <= Date.parse(report.capturePersistence.timestamp));
assert.ok(Date.parse(prep.exportFinishedAt) < Date.parse(prep.exportDeadlineAt));
assert.deepEqual(sync.response, report.inputKernelSync.response);
for (const p of [prep.runtimeBefore.presentation, prep.presentationBaseline, prep.lastPixels.state, prep.runtimeAfter.presentation]) {
  assert.deepEqual([p.width, p.height, p.gpu.width, p.gpu.height], [1280, 800, 1280, 800]);
  assert.equal(p.fixedViewport, true);
  assert.deepEqual([p.latest.resourceWidth, p.latest.resourceHeight], [1280, 832]);
  const d = p.latest.rect;
  assert.ok([d.x, d.y, d.width, d.height].every(Number.isSafeInteger));
  assert.ok(d.x >= 0 && d.y >= 0 && d.width > 0 && d.height > 0 && d.x+d.width <= 1280 && d.y+d.height <= 800);
}
assert.equal(prep.presentationBaseline.framesReceived, 2); assert.equal(prep.lastPixels.state.framesReceived, 3);
assert.equal(prep.presentationBaseline.successfulPresents, 2); assert.equal(prep.lastPixels.state.successfulPresents, 3);
for (const r of [prep.runtimeBefore, prep.runtimeAfter]) {
  assert.equal(r.clock.mode, "icount"); assert.equal(r.clock.clockDiv, 64);
  assert.equal(r.jit.jitResidencyPolicy, "cap-256"); assert.equal(r.jit.jitResidencyCap, 256);
  assert.equal(r.jit.coldCounterRecycling.enabled, false);
  assert.equal(r.jit.entryCost.timingEnabled, false);
}
assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916");
const seed = sha(`${native.artifacts.bootSnapshot.sha256}:${native.artifacts.overlayDelta.sha256}`);
assert.equal(report.captureOverlayStore.seed, seed);
assert.equal(report.captureOverlayStore.name, `wvov-${report.pair.base}-seed-${seed}`);
for (const state of [report.capturePersistence.stats, report.capturePersistence.settled])
  assert.deepEqual(state, { pendingBlocks: 0, pendingBytes: 0, flushWaiting: false, writeWaiting: false });
assert.equal(report.pair.paused, true); assert.equal(report.pair.restoreDecision, "resume");
const imageBytes = await fs.readFile(at("evidence/omarchy-profile/input-kernel-pair-r1/browser/desktop/prepared-desktop.png"));
assert.equal(imageBytes.readUInt32BE(16), 1280); assert.equal(imageBytes.readUInt32BE(20), 800);
console.log(JSON.stringify({ kind: "critic-actual-browser-audit", passed: true,
  reportSha256: sha(reportBytes), runSha256: sha(runBytes), nativeRecordSha256: sha(nativeBytes),
  screenshot: { sha256: sha(imageBytes), size: imageBytes.length, width: 1280, height: 800,
    personallyInspected: true, description: "Readable empty omarchy shell prompt inside full-size dark Foot, desktop bar above, no typed command; preparation only." },
  serial, foot, pair: report.pair, overlay: report.captureOverlayStore,
  clocks: { visibleAfterNavigationMs: Date.parse(prep.visibleAt)-Date.parse(report.startup.startedAt),
    exportMs: Date.parse(prep.exportFinishedAt)-Date.parse(prep.exportStartedAt),
    cleanupMs: Date.parse(report.finishedAt)-Date.parse(report.cleanup.startedAt) },
  inputEvents: report.inputEvents.length, keyboardAcceptance: false,
  frameProgress: [2, 3], inputBufferKernelNotesSha256: notesDigest }, null, 2));
