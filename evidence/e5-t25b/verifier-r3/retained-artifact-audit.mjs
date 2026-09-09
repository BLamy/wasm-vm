import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { once } from "node:events";

import { aggregateDragRuns } from "../../../web/bench/desktop-perf.js";

const artifactHead = "a14bf5453a6799a67b5f66e85b4167223580e541";
const jsonPath = "evidence/e5-t25b/browser/drag-fps.json";
const pngPath = "evidence/e5-t25b/browser/drag-fps.png";
const expectedJsonHash = "8cd005bf639b7638548c18b38a0bb32938b2494b179797aa875ddc5bd70060f7";
const expectedPngHash = "d81ba53cbe4146e0be05be40bbbd6c53d9f082910bb7595d32958301b718a059";

const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function hashFile(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}
function near(actual, expected, label) {
  assert.equal(Number.isFinite(actual), true, `${label}: finite`);
  assert.equal(Number.isFinite(expected), true, `${label}: expected finite`);
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-12),
    `${label}: ${actual} != ${expected}`);
}
function safeNonnegative(value, label) {
  assert.equal(Number.isSafeInteger(value), true, `${label}: safe integer`);
  assert.ok(value >= 0, `${label}: nonnegative`);
}
function finiteNonnegative(value, label) {
  assert.equal(Number.isFinite(value), true, `${label}: finite`);
  assert.ok(value >= 0, `${label}: nonnegative`);
}

const jsonBytes = readFileSync(jsonPath);
const pngBytes = readFileSync(pngPath);
const evidence = JSON.parse(jsonBytes);
assert.equal(hashBytes(jsonBytes), expectedJsonHash);
assert.equal(hashBytes(pngBytes), expectedPngHash);
assert.equal(evidence.screenshotSha256, expectedPngHash);
assert.equal(pngBytes.readUInt32BE(16), 1440);
assert.equal(pngBytes.readUInt32BE(20), 1050);
assert.equal(evidence.head, artifactHead);
assert.equal(evidence.browser, "152.0.7977.76");
assert.equal(evidence.headed, true);
assert.deepEqual(evidence.viewport, { width: 1440, height: 1050 });
assert.equal(evidence.deviceScaleFactor, 1);
assert.deepEqual(evidence.errors, []);
assert.deepEqual(evidence.httpErrors, []);
assert.deepEqual(evidence.nullSinkAttack,
  { drawnPresents: 0, accepted: false, reason: "no-drawn-presents" });
assert.equal(evidence.runs.length, 5);
assert.deepEqual(evidence.aggregate.runs, evidence.runs);

const manifestBytes = readFileSync(`${evidence.image.assetRoot}/manifest.json`);
assert.equal(hashBytes(manifestBytes), evidence.image.manifestSha256);
assert.equal(evidence.image.manifestSha256,
  "935a9fe2bf6022b01ac6147665b9ca59736930b6e265e33069318e4d9cc2ccaa");
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.layout, "split");
assert.equal(manifest.image_len, 1_073_741_824);
assert.equal(manifest.chunks.length, 8192);

const imageInfo = JSON.parse(readFileSync("target/e5-t22c/desktop-image-solid-v7/desktop-info.json"));
assert.equal(imageInfo.image.size, statSync(imageInfo.image.path).size);
assert.equal(imageInfo.image.sha256, evidence.image.imageSha256);
assert.equal(await hashFile(imageInfo.image.path), evidence.image.imageSha256);

let previousGlobalSequence = -1;
let previousGlobalTimestamp = -Infinity;
const runAudit = [];
for (const [runIndex, run] of evidence.runs.entries()) {
  const label = `drag-${String(runIndex + 1).padStart(2, "0")}`;
  assert.equal(run.runId, label);
  assert.equal(run.expectedMoves, 300);
  assert.equal(run.requestedMoves, 300);
  safeNonnegative(run.pointerFramesBefore, `${label}.pointerFramesBefore`);
  safeNonnegative(run.pointerFramesDelta, `${label}.pointerFramesDelta`);
  safeNonnegative(run.pointerFrames, `${label}.pointerFrames`);
  assert.equal(run.pointerFramesBefore + run.pointerFramesDelta, run.pointerFrames);
  assert.ok(run.pointerFramesDelta >= 300);
  assert.ok(run.records.length > 0);

  let drawn = 0;
  let undrawn = 0;
  let bytes = 0;
  let instructions = 0;
  let previousSequence = -1;
  let previousTimestamp = -Infinity;
  let previousGuestTotal = null;
  const damageX = [];
  const damageRects = new Set();
  for (const [recordIndex, record] of run.records.entries()) {
    const point = `${label}.records[${recordIndex}]`;
    safeNonnegative(record.sequence, `${point}.sequence`);
    assert.ok(record.sequence > previousSequence && record.sequence > previousGlobalSequence,
      `${point}: monotone sequence`);
    previousSequence = previousGlobalSequence = record.sequence;
    finiteNonnegative(record.timestamp, `${point}.timestamp`);
    assert.ok(record.timestamp > previousTimestamp && record.timestamp > previousGlobalTimestamp,
      `${point}: monotone timestamp`);
    previousTimestamp = previousGlobalTimestamp = record.timestamp;
    assert.equal(typeof record.drawn, "boolean");
    assert.equal(typeof record.replay, "boolean");
    assert.equal(record.backend, "canvas2d");
    for (const key of ["x", "y", "width", "height"]) safeNonnegative(record.rect[key], `${point}.rect.${key}`);
    assert.ok(record.rect.width > 0 && record.rect.height > 0);
    assert.ok(record.rect.x + record.rect.width <= record.resourceWidth);
    assert.ok(record.rect.y + record.rect.height <= record.resourceHeight);
    safeNonnegative(record.bytes, `${point}.bytes`);
    assert.equal(record.bytes, record.rect.width * record.rect.height * 4);
    safeNonnegative(record.guestInstructions, `${point}.guestInstructions`);
    safeNonnegative(record.guestInstructionsTotal, `${point}.guestInstructionsTotal`);
    if (previousGuestTotal !== null) {
      assert.ok(record.guestInstructionsTotal >= previousGuestTotal);
      assert.equal(record.guestInstructionsTotal - previousGuestTotal, record.guestInstructions);
    }
    previousGuestTotal = record.guestInstructionsTotal;
    damageX.push(record.rect.x);
    damageRects.add(`${record.rect.x},${record.rect.y},${record.rect.width},${record.rect.height}`);
    if (record.drawn) {
      drawn += 1;
      assert.ok(record.bytes > 0 && record.guestInstructions > 0);
      bytes += record.bytes;
      instructions += record.guestInstructions;
    } else {
      undrawn += 1;
    }
  }

  assert.equal(drawn, run.drawnPresents);
  assert.equal(undrawn, run.acknowledgedUndrawnPresents);
  assert.equal(bytes, run.bytesUploaded);
  assert.equal(instructions, run.guestInstructions);
  near(run.fps, drawn / (run.wallMs / 1000), `${label}.fps`);
  near(run.bytesPerFrame, bytes / drawn, `${label}.bytesPerFrame`);
  near(run.instructionsPerFrame, instructions / drawn, `${label}.instructionsPerFrame`);
  assert.equal(run.presentDurationsMs.length, drawn);
  const presentMs = run.presentDurationsMs.reduce((sum, duration, index) => {
    finiteNonnegative(duration, `${label}.presentDurationsMs[${index}]`);
    return sum + duration;
  }, 0);
  near(run.durationsMs.present, presentMs, `${label}.durationsMs.present`);
  for (const field of ["retiredInstructions", "requestedInstructions", "slices"]) {
    safeNonnegative(run.schedulerBefore[field], `${label}.before.${field}`);
    safeNonnegative(run.schedulerAfter[field], `${label}.after.${field}`);
    assert.ok(run.schedulerAfter[field] >= run.schedulerBefore[field]);
  }
  for (const field of ["totalSliceMs", "fetchWaitTotalMs"]) {
    finiteNonnegative(run.schedulerBefore[field], `${label}.before.${field}`);
    finiteNonnegative(run.schedulerAfter[field], `${label}.after.${field}`);
    assert.ok(run.schedulerAfter[field] >= run.schedulerBefore[field]);
  }
  near(run.durationsMs.guest,
    run.schedulerAfter.totalSliceMs - run.schedulerBefore.totalSliceMs, `${label}.guestMs`);
  near(run.durationsMs.transfer,
    run.schedulerAfter.fetchWaitTotalMs - run.schedulerBefore.fetchWaitTotalMs, `${label}.transferMs`);
  assert.ok(damageRects.size > 1);
  const damageMovementPx = Math.max(...damageX) - Math.min(...damageX);
  assert.ok(damageMovementPx >= 250, `${label}: changing horizontal damage`);
  assert.ok(run.wallMs >= run.records.at(-1).timestamp - run.records[0].timestamp);
  runAudit.push({
    runId: label,
    pointers: `${run.pointerFramesBefore}+${run.pointerFramesDelta}=${run.pointerFrames}`,
    records: run.records.length,
    drawn,
    damageMovementPx,
    presentSamples: run.presentDurationsMs.length,
    fps: run.fps,
  });
}

const recomputed = aggregateDragRuns(evidence.runs);
for (const field of [
  "fpsP50", "fpsP95", "meanFps", "standardDeviationFps", "coefficientOfVariationPercent",
]) near(evidence.aggregate[field], recomputed[field], `aggregate.${field}`);
assert.equal(evidence.aggregate.repeatabilityHeld, true);
assert.ok(evidence.aggregate.coefficientOfVariationPercent < 15);

const producerDifference = execFileSync("git", ["diff", "--name-only", `${artifactHead}..HEAD`],
  { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const runtimeDifference = producerDifference.filter((file) => [
  "tools/verify/e5-t25b-browser.mjs",
  "tools/verify/e5-t25b-release-audit.mjs",
  "web/bench/desktop-perf.js",
  "web/dist/bench/desktop-perf.js",
  "web/tests/e5-t25b-desktop-perf.test.mjs",
].includes(file));
assert.deepEqual(runtimeDifference, [
  "tools/verify/e5-t25b-browser.mjs",
  "tools/verify/e5-t25b-release-audit.mjs",
  "web/bench/desktop-perf.js",
  "web/dist/bench/desktop-perf.js",
  "web/tests/e5-t25b-desktop-perf.test.mjs",
]);
const unexpectedDifference = producerDifference.filter((file) =>
  !runtimeDifference.includes(file)
  && file !== "tasks/QUEUE.md"
  && file !== "tasks/epic-5-the-window/E5-T25b-drag-fps-harness.md"
  && !file.startsWith("evidence/e5-t25b/verifier-r2/"));
assert.deepEqual(unexpectedDifference, []);

console.log(JSON.stringify({
  artifact: {
    jsonSha256: expectedJsonHash,
    pngSha256: expectedPngHash,
    head: evidence.head,
    currentHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    browser: evidence.browser,
    viewport: evidence.viewport,
    deviceScaleFactor: evidence.deviceScaleFactor,
    imageSha256: evidence.image.imageSha256,
    manifestSha256: evidence.image.manifestSha256,
  },
  runAudit,
  aggregate: {
    fpsP50: evidence.aggregate.fpsP50,
    fpsP95: evidence.aggregate.fpsP95,
    meanFps: evidence.aggregate.meanFps,
    coefficientOfVariationPercent: evidence.aggregate.coefficientOfVariationPercent,
    repeatabilityHeld: evidence.aggregate.repeatabilityHeld,
  },
  producerDifference,
  runtimeDifference,
  producerClassification: "valid for unchanged raw producer/analyzer invariants; predates and cannot execute the geometry assertion or readiness change",
}, null, 2));
