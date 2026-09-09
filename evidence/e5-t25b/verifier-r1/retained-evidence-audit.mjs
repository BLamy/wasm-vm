import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const evidencePath = new URL("../browser/drag-fps.json", import.meta.url);
const screenshotPath = new URL("../browser/drag-fps.png", import.meta.url);
const evidenceBytes = readFileSync(evidencePath);
const screenshotBytes = readFileSync(screenshotPath);
const evidence = JSON.parse(evidenceBytes);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-12), `${label}: ${actual} != ${expected}`);

assert.equal(sha256(evidenceBytes), "67f4dbf8723451383b56bf5d8565309c8a91c765d36c6587a6a1960a925860dd");
assert.equal(sha256(screenshotBytes), "58b0e53df2ec4c3ef30e8c4d71f349962e0c170b3597849899220ce3655938f1");
assert.equal(evidence.screenshotSha256, sha256(screenshotBytes));
assert.equal(evidence.schema, "wasm-vm.e5-t25b-browser-v1");
assert.equal(evidence.task, "E5-T25b");
assert.equal(evidence.head, null);
assert.equal(evidence.headed, true);
assert.deepEqual(evidence.viewport, { width: 1440, height: 1050 });
assert.equal(evidence.deviceScaleFactor, 1);
assert.equal(evidence.runs.length, 5);
assert.deepEqual(evidence.errors, []);
assert.deepEqual(evidence.httpErrors, []);
assert.deepEqual(evidence.nullSinkAttack, { drawnPresents: 0, accepted: false, reason: "no-drawn-presents" });

const fps = [];
for (const run of evidence.runs) {
  assert.equal(run.expectedMoves, 300);
  assert.equal(run.requestedMoves, 300);
  assert.equal(run.pointerFramesBefore, undefined);
  assert.equal(run.pointerFramesDelta, undefined);
  assert.equal(run.records, undefined);
  assert.ok(run.pointerFrames >= 300);
  assert.ok(run.drawnPresents > 0);
  assert.equal(run.acknowledgedUndrawnPresents, 0);
  assert.ok(run.wallMs > 0);
  near(run.fps, run.drawnPresents / (run.wallMs / 1000), `${run.runId}.fps`);
  near(run.bytesPerFrame, run.bytesUploaded / run.drawnPresents, `${run.runId}.bytesPerFrame`);
  near(run.instructionsPerFrame, run.guestInstructions / run.drawnPresents, `${run.runId}.instructionsPerFrame`);
  assert.ok(run.guestInstructions > 0);
  assert.ok(run.durationsMs.guest > 0);
  assert.ok(run.durationsMs.present > 0);
  assert.ok(run.durationsMs.transfer >= 0);
  assert.equal(run.browser, evidence.browser);
  assert.equal(run.deviceScaleFactor, evidence.deviceScaleFactor);
  assert.deepEqual(run.viewport, evidence.viewport);
  fps.push(run.fps);
}

const sorted = [...fps].sort((a, b) => a - b);
const mean = fps.reduce((sum, value) => sum + value, 0) / fps.length;
const standardDeviation = Math.sqrt(fps.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / fps.length);
near(evidence.aggregate.fpsP50, sorted[2], "aggregate.fpsP50");
near(evidence.aggregate.fpsP95, sorted[4], "aggregate.fpsP95");
near(evidence.aggregate.meanFps, mean, "aggregate.meanFps");
near(evidence.aggregate.standardDeviationFps, standardDeviation, "aggregate.standardDeviationFps");
near(evidence.aggregate.coefficientOfVariationPercent, standardDeviation / mean * 100, "aggregate.cv");
assert.equal(evidence.aggregate.repeatabilityHeld, evidence.aggregate.coefficientOfVariationPercent < 15);

const manifestBytes = readFileSync(`${evidence.image.assetRoot}/manifest.json`);
assert.equal(sha256(manifestBytes), evidence.image.manifestSha256);
const imageInfo = JSON.parse(readFileSync("target/e5-t22c/desktop-image-solid-v7/desktop-info.json"));
assert.equal(imageInfo.image.sha256, evidence.image.imageSha256);

console.log(JSON.stringify({
  currentHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  retainedHead: evidence.head,
  hashesHeld: true,
  summaryMathHeld: true,
  runCount: evidence.runs.length,
  requestedMoves: evidence.runs.map((run) => run.requestedMoves),
  cumulativePointerFrames: evidence.runs.map((run) => run.pointerFrames),
  pointerFrameDeltasRetained: evidence.runs.every((run) => Number.isSafeInteger(run.pointerFramesDelta)),
  fullPresentRecordsRetained: evidence.runs.every((run) => Array.isArray(run.records)),
  drawnPresents: evidence.runs.map((run) => run.drawnPresents),
  cvPercent: evidence.aggregate.coefficientOfVariationPercent,
  nonzeroGuestAndPresentAttribution: evidence.runs.every((run) => run.guestInstructions > 0 && run.durationsMs.guest > 0 && run.durationsMs.present > 0),
  nullSinkRejected: evidence.nullSinkAttack.accepted === false,
  browserErrors: evidence.errors.length,
  httpErrors: evidence.httpErrors.length,
}, null, 2));
