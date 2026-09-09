import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { once } from "node:events";

import { aggregateDragRuns } from "../../../web/bench/desktop-perf.js";

const expectedHead = "a14bf5453a6799a67b5f66e85b4167223580e541";
const jsonPath = "evidence/e5-t25b/browser/drag-fps.json";
const pngPath = "evidence/e5-t25b/browser/drag-fps.png";
const imageInfoPath = "target/e5-t22c/desktop-image-solid-v7/desktop-info.json";
const imagePath = "target/e5-t22c/desktop-image-solid-v7/alpine-rootfs.ext4";
const expectedAssetRoot = "/Users/blamy/Documents/Codex/wasm-vm/target/e5-t22c/chunks/desktop-solid-v7";

const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function hashFile(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}
function near(actual, expected, label) {
  assert.equal(typeof actual, "number", `${label}: number`);
  assert.equal(Number.isFinite(actual), true, `${label}: finite`);
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-12);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}
function safeNonnegative(value, label) {
  assert.equal(Number.isSafeInteger(value), true, `${label}: safe integer`);
  assert.ok(value >= 0, `${label}: nonnegative`);
}
function finiteNonnegative(value, label) {
  assert.equal(typeof value, "number", `${label}: number`);
  assert.equal(Number.isFinite(value), true, `${label}: finite`);
  assert.ok(value >= 0, `${label}: nonnegative`);
}

const jsonBytes = readFileSync(jsonPath);
const pngBytes = readFileSync(pngPath);
const evidence = JSON.parse(jsonBytes);
assert.equal(hashBytes(jsonBytes), "8cd005bf639b7638548c18b38a0bb32938b2494b179797aa875ddc5bd70060f7");
assert.equal(hashBytes(pngBytes), "d81ba53cbe4146e0be05be40bbbd6c53d9f082910bb7595d32958301b718a059");
assert.equal(evidence.screenshotSha256, hashBytes(pngBytes));
assert.equal(pngBytes.readUInt32BE(16), 1440, "PNG width");
assert.equal(pngBytes.readUInt32BE(20), 1050, "PNG height");

assert.equal(evidence.schema, "wasm-vm.e5-t25b-browser-v1");
assert.equal(evidence.task, "E5-T25b");
assert.equal(evidence.head, expectedHead);
assert.equal(evidence.browser, "152.0.7977.76");
assert.equal(evidence.headed, true);
assert.deepEqual(evidence.viewport, { width: 1440, height: 1050 });
assert.equal(evidence.deviceScaleFactor, 1);
assert.equal(evidence.image.assetRoot, expectedAssetRoot);
assert.deepEqual(evidence.errors, []);
assert.deepEqual(evidence.httpErrors, []);
assert.deepEqual(evidence.nullSinkAttack, { drawnPresents: 0, accepted: false, reason: "no-drawn-presents" });
assert.equal(evidence.runs.length, 5);
assert.deepEqual(evidence.aggregate.runs, evidence.runs, "aggregate must embed the same complete runs");

const manifestPath = `${evidence.image.assetRoot}/manifest.json`;
const manifestBytes = readFileSync(manifestPath);
assert.equal(hashBytes(manifestBytes), evidence.image.manifestSha256);
assert.equal(evidence.image.manifestSha256, "935a9fe2bf6022b01ac6147665b9ca59736930b6e265e33069318e4d9cc2ccaa");
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.layout, "split");
assert.equal(manifest.image_len, 1073741824);
assert.equal(manifest.chunks.length, 8192);
assert.ok(manifest.chunks.every((digest) => /^[0-9a-f]{64}$/.test(digest)));
const imageInfo = JSON.parse(readFileSync(imageInfoPath));
assert.equal(imageInfo.image.path, imagePath);
assert.equal(imageInfo.image.size, statSync(imagePath).size);
assert.equal(imageInfo.image.sha256, evidence.image.imageSha256);
assert.equal(await hashFile(imagePath), evidence.image.imageSha256);
assert.equal(evidence.image.imageSha256, "811267cbf96c1e055e31063829580432d5e5e343cff1a975f5fc10664cc2e00e");

const producerDifference = execFileSync("git", ["diff", "--name-only", `${expectedHead}..HEAD`], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
assert.deepEqual(producerDifference, ["tasks/epic-5-the-window/E5-T25b-drag-fps-harness.md"]);

const runAudit = [];
const globalSequences = new Set();
let previousGlobalSequence = -1;
let previousGlobalTimestamp = -Infinity;
for (const [runIndex, run] of evidence.runs.entries()) {
  const label = run.runId;
  assert.equal(label, `drag-${String(runIndex + 1).padStart(2, "0")}`);
  assert.equal(run.schema, "e5-t25b-v1");
  assert.equal(run.expectedMoves, 300);
  assert.equal(run.requestedMoves, 300);
  safeNonnegative(run.pointerFramesBefore, `${label}.pointerFramesBefore`);
  safeNonnegative(run.pointerFrames, `${label}.pointerFrames`);
  safeNonnegative(run.pointerFramesDelta, `${label}.pointerFramesDelta`);
  assert.equal(run.pointerFramesBefore + run.pointerFramesDelta, run.pointerFrames);
  assert.ok(run.pointerFramesDelta >= 300, `${label}: processed >=300 pointer frames`);
  assert.equal(run.browser, evidence.browser);
  assert.equal(run.deviceScaleFactor, evidence.deviceScaleFactor);
  assert.deepEqual(run.viewport, evidence.viewport);
  finiteNonnegative(run.wallMs, `${label}.wallMs`);
  assert.ok(run.wallMs > 0);
  assert.ok(Array.isArray(run.records) && run.records.length > 0);

  let drawn = 0;
  let undrawn = 0;
  let bytes = 0;
  let instructions = 0;
  let priorSequence = -1;
  let priorTimestamp = -Infinity;
  let priorGuestTotal = null;
  const damageRects = new Set();
  const damageX = [];
  for (const [recordIndex, record] of run.records.entries()) {
    const point = `${label}.records[${recordIndex}]`;
    assert.equal(record && typeof record, "object", point);
    safeNonnegative(record.sequence, `${point}.sequence`);
    assert.ok(record.sequence > priorSequence, `${point}: sequence strictly increases in run`);
    assert.ok(record.sequence > previousGlobalSequence, `${point}: sequence strictly increases globally`);
    assert.equal(globalSequences.has(record.sequence), false, `${point}: sequence unique`);
    globalSequences.add(record.sequence);
    priorSequence = previousGlobalSequence = record.sequence;
    finiteNonnegative(record.timestamp, `${point}.timestamp`);
    assert.ok(record.timestamp > priorTimestamp, `${point}: timestamp strictly increases in run`);
    assert.ok(record.timestamp > previousGlobalTimestamp, `${point}: timestamp strictly increases globally`);
    priorTimestamp = previousGlobalTimestamp = record.timestamp;
    assert.equal(typeof record.drawn, "boolean", `${point}.drawn boolean`);
    assert.equal(typeof record.replay, "boolean", `${point}.replay boolean`);
    assert.equal(record.backend, "canvas2d");
    safeNonnegative(record.resourceWidth, `${point}.resourceWidth`);
    safeNonnegative(record.resourceHeight, `${point}.resourceHeight`);
    assert.ok(record.resourceWidth > 0 && record.resourceHeight > 0);
    for (const key of ["x", "y", "width", "height"]) safeNonnegative(record.rect?.[key], `${point}.rect.${key}`);
    assert.ok(record.rect.width > 0 && record.rect.height > 0, `${point}: positive damage`);
    assert.ok(record.rect.x + record.rect.width <= record.resourceWidth, `${point}: damage x bounds`);
    assert.ok(record.rect.y + record.rect.height <= record.resourceHeight, `${point}: damage y bounds`);
    damageRects.add(`${record.rect.x},${record.rect.y},${record.rect.width},${record.rect.height}`);
    damageX.push(record.rect.x);
    safeNonnegative(record.bytes, `${point}.bytes`);
    assert.equal(record.bytes, record.rect.width * record.rect.height * 4, `${point}: bytes match damage`);
    safeNonnegative(record.guestInstructions, `${point}.guestInstructions`);
    safeNonnegative(record.guestInstructionsTotal, `${point}.guestInstructionsTotal`);
    assert.ok(record.guestInstructionsTotal >= record.guestInstructions, `${point}: total covers delta`);
    if (priorGuestTotal !== null) {
      assert.ok(record.guestInstructionsTotal >= priorGuestTotal, `${point}: guest total monotone`);
      assert.equal(record.guestInstructionsTotal - priorGuestTotal, record.guestInstructions, `${point}: guest delta coherent`);
    }
    priorGuestTotal = record.guestInstructionsTotal;
    if (record.drawn) {
      drawn += 1;
      assert.ok(record.bytes > 0, `${point}: drawn bytes positive`);
      assert.ok(record.guestInstructions > 0, `${point}: drawn attribution positive`);
      bytes += record.bytes;
      instructions += record.guestInstructions;
    } else {
      undrawn += 1;
    }
  }

  const first = run.records[0];
  const last = run.records.at(-1);
  assert.ok(run.wallMs >= last.timestamp - first.timestamp, `${label}: wall covers retained timestamp span`);
  assert.equal(drawn, run.drawnPresents);
  assert.equal(undrawn, run.acknowledgedUndrawnPresents);
  assert.equal(bytes, run.bytesUploaded);
  assert.equal(instructions, run.guestInstructions);
  near(run.fps, drawn / (run.wallMs / 1000), `${label}.fps`);
  near(run.bytesPerFrame, bytes / drawn, `${label}.bytesPerFrame`);
  near(run.instructionsPerFrame, instructions / drawn, `${label}.instructionsPerFrame`);
  assert.equal(run.presentDurationsMs.length, drawn);
  let presentMs = 0;
  for (const [index, duration] of run.presentDurationsMs.entries()) {
    finiteNonnegative(duration, `${label}.presentDurationsMs[${index}]`);
    presentMs += duration;
  }
  near(run.durationsMs.present, presentMs, `${label}.durationsMs.present`);

  const before = run.schedulerBefore;
  const after = run.schedulerAfter;
  for (const field of ["retiredInstructions", "requestedInstructions", "slices"]) {
    safeNonnegative(before[field], `${label}.schedulerBefore.${field}`);
    safeNonnegative(after[field], `${label}.schedulerAfter.${field}`);
    assert.ok(after[field] >= before[field], `${label}.${field}: monotone`);
  }
  for (const field of ["totalSliceMs", "fetchWaitTotalMs"]) {
    finiteNonnegative(before[field], `${label}.schedulerBefore.${field}`);
    finiteNonnegative(after[field], `${label}.schedulerAfter.${field}`);
    assert.ok(after[field] >= before[field], `${label}.${field}: monotone`);
  }
  const schedulerGuestMs = after.totalSliceMs - before.totalSliceMs;
  const schedulerTransferMs = after.fetchWaitTotalMs - before.fetchWaitTotalMs;
  near(run.durationsMs.guest, schedulerGuestMs, `${label}.durationsMs.guest`);
  near(run.durationsMs.transfer, schedulerTransferMs, `${label}.durationsMs.transfer`);

  const retiredDelta = after.retiredInstructions - before.retiredInstructions;
  const impliedPreviousSample = first.guestInstructionsTotal - first.guestInstructions;
  const preBoundary = before.retiredInstructions - impliedPreviousSample;
  const tailBoundary = after.retiredInstructions - last.guestInstructionsTotal;
  assert.ok(preBoundary >= 0, `${label}: present attribution does not begin after scheduler snapshot`);
  assert.ok(tailBoundary >= 0, `${label}: present attribution does not end after scheduler snapshot`);
  assert.equal(instructions - retiredDelta, preBoundary - tailBoundary, `${label}: retired/present boundary identity`);
  assert.ok(damageRects.size > 1, `${label}: retained baseline shows changing damage`);
  assert.ok(Math.max(...damageX) - Math.min(...damageX) >= 250, `${label}: retained baseline shows horizontal movement`);

  runAudit.push({
    runId: label,
    pointer: `${run.pointerFramesBefore}+${run.pointerFramesDelta}=${run.pointerFrames}`,
    records: run.records.length,
    sequence: `${first.sequence}-${last.sequence}`,
    timestampSpanMs: last.timestamp - first.timestamp,
    drawn,
    undrawn,
    distinctDamageRects: damageRects.size,
    damageXRange: `${Math.min(...damageX)}-${Math.max(...damageX)}`,
    bytes,
    guestInstructions: instructions,
    schedulerRetiredDelta: retiredDelta,
    preBoundaryInstructions: preBoundary,
    tailBoundaryInstructions: tailBoundary,
    presentSamples: run.presentDurationsMs.length,
    presentDurationMs: presentMs,
    guestDurationMs: schedulerGuestMs,
    transferDurationMs: schedulerTransferMs,
    fps: run.fps,
  });
}

const recomputedAggregate = aggregateDragRuns(evidence.runs);
for (const field of ["fpsP50", "fpsP95", "meanFps", "standardDeviationFps", "coefficientOfVariationPercent"]) {
  near(evidence.aggregate[field], recomputedAggregate[field], `aggregate.${field}`);
}
assert.equal(evidence.aggregate.runCount, 5);
assert.equal(evidence.aggregate.coefficientOfVariationLimitPercent, 15);
assert.equal(evidence.aggregate.repeatabilityHeld, true);
assert.ok(evidence.aggregate.coefficientOfVariationPercent < 15);

console.log(JSON.stringify({
  artifact: {
    jsonSha256: hashBytes(jsonBytes),
    pngSha256: hashBytes(pngBytes),
    pngDimensions: "1440x1050",
    head: evidence.head,
    currentHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    producerDifference,
    browser: evidence.browser,
    viewport: evidence.viewport,
    deviceScaleFactor: evidence.deviceScaleFactor,
    imageSha256: evidence.image.imageSha256,
    manifestSha256: evidence.image.manifestSha256,
    chunkCount: manifest.chunks.length,
  },
  runs: runAudit,
  aggregate: {
    fpsP50: evidence.aggregate.fpsP50,
    fpsP95: evidence.aggregate.fpsP95,
    meanFps: evidence.aggregate.meanFps,
    standardDeviationFps: evidence.aggregate.standardDeviationFps,
    coefficientOfVariationPercent: evidence.aggregate.coefficientOfVariationPercent,
    repeatabilityHeld: evidence.aggregate.repeatabilityHeld,
  },
  nullSinkAttack: evidence.nullSinkAttack,
  errors: evidence.errors,
  httpErrors: evidence.httpErrors,
}, null, 2));
