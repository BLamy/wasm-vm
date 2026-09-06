// E5-T25b — deterministic drag path and drawn-present aggregation.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAG_MOVE_COUNT,
  aggregateDragRuns,
  assertNullSinkRejected,
  buildDragPath,
  summarizeDragRun,
} from "../bench/desktop-perf.js";

function record(timestamp, sequence, guestInstructions, drawn = true) {
  return { timestamp, sequence, drawn, bytes: 16, guestInstructions, guestInstructionsTotal: guestInstructions };
}

function validRun(overrides = {}) {
  return summarizeDragRun({
    runId: "fixture",
    records: [record(100, 1, 10), record(150, 2, 20), record(200, 3, 30)],
    startedAt: 100,
    endedAt: 300,
    schedulerBefore: { totalSliceMs: 1, fetchWaitTotalMs: 2 },
    schedulerAfter: { totalSliceMs: 9, fetchWaitTotalMs: 5 },
    presentDurationsMs: [1, 2, 3],
    ...overrides,
  });
}

test("drag path contains exactly 300 smooth endpoint-inclusive moves", () => {
  const path = buildDragPath();
  assert.equal(path.length, DRAG_MOVE_COUNT);
  assert.deepEqual(path[0], { x: 160, y: 180 });
  assert.deepEqual(path.at(-1), { x: 460, y: 180 });
  assert.equal(new Set(path.map((point) => `${point.x},${point.y}`)).size, DRAG_MOVE_COUNT);
  assert.ok(path.every((point) => point.y === 180));
  assert.ok(path.every((point, index) => index === 0 || point.x > path[index - 1].x));
});

test("summarizer counts only drawn presents and reports attribution buckets", () => {
  const result = validRun();
  assert.equal(result.schema, "e5-t25b-v1");
  assert.equal(result.expectedMoves, DRAG_MOVE_COUNT);
  assert.equal(result.drawnPresents, 3);
  assert.equal(result.acknowledgedUndrawnPresents, 0);
  assert.equal(result.fps, 15);
  assert.equal(result.bytesUploaded, 48);
  assert.equal(result.bytesPerFrame, 16);
  assert.equal(result.guestInstructions, 60);
  assert.equal(result.instructionsPerFrame, 20);
  assert.deepEqual(result.durationsMs, { guest: 8, transfer: 3, present: 6 });
});

test("null sink is rejected instead of reporting an FPS number", () => {
  const nullRecords = [record(100, 1, null, false), record(150, 2, null, false)];
  assert.deepEqual(assertNullSinkRejected(nullRecords), {
    drawnPresents: 0, accepted: false, reason: "no-drawn-presents",
  });
  assert.throws(() => validRun({ records: nullRecords }), /no drawn presents/);
});

test("five-run aggregation exposes repeatability and p50/p95", () => {
  const runs = [20, 21, 20, 19, 20].map((fps, index) => ({ ...validRun({ runId: `run-${index + 1}` }), fps }));
  const result = aggregateDragRuns(runs);
  assert.equal(result.runCount, 5);
  assert.equal(result.fpsP50, 20);
  assert.equal(result.fpsP95, 21);
  assert.equal(result.repeatabilityHeld, true);
  assert.ok(result.coefficientOfVariationPercent < 15);
});

test("summarizer rejects missing attribution, mismatched durations, and counter regressions", () => {
  assert.throws(() => validRun({ records: [record(100, 1, null)] }), /missing guest instruction/);
  assert.throws(() => validRun({ presentDurationsMs: [1, 2] }), /duration samples/);
  assert.throws(() => validRun({ schedulerAfter: { totalSliceMs: 0, fetchWaitTotalMs: 5 } }), /guestDurationMs regressed/);
});
