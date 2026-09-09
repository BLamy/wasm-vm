// E5-T25c — adversarial key-to-first-intersecting-present math and calibration.

import assert from "node:assert/strict";
import test from "node:test";

import {
  KEY_LATENCY_MEASUREMENT,
  KEY_LATENCY_HARNESS_VERSION,
  KEY_LATENCY_TRIAL_COUNT,
  PRESENT_DELAY_CALIBRATION_MS,
  calibratePresentDelay,
  findFirstIntersectingPresent,
  findTerminalCursorCell,
  summarizeKeyLatency,
} from "../bench/desktop-perf.js";

function present(sequence, timestamp, rect, drawn = true) {
  return { sequence, timestamp, rect, drawn };
}

test("detector ignores pre-input, unrelated, and acknowledged-undrawn presents", () => {
  const result = findFirstIntersectingPresent({
    inputAt: 100,
    sequenceBefore: 2,
    cursorCell: { x: 40, y: 16, width: 8, height: 16 },
    records: [
      present(1, 90, { x: 40, y: 16, width: 8, height: 16 }),
      present(2, 95, { x: 40, y: 16, width: 8, height: 16 }),
      present(3, 105, { x: 0, y: 0, width: 8, height: 8 }),
      present(4, 110, { x: 40, y: 16, width: 8, height: 16 }, false),
      present(5, 125, { x: 40, y: 16, width: 8, height: 16 }),
    ],
  });
  assert.equal(result.sequence, 5);
  assert.equal(result.latencyMs, 25);
  assert.equal(result.measurement, KEY_LATENCY_MEASUREMENT);
  assert.deepEqual(result.damageRect, { x: 40, y: 16, width: 8, height: 16 });
});

test("detector returns null while a key has no intersecting drawn damage", () => {
  assert.equal(findFirstIntersectingPresent({
    inputAt: 100,
    cursorCell: { x: 40, y: 16, width: 8, height: 16 },
    records: [present(1, 120, { x: 0, y: 0, width: 8, height: 8 })],
  }), null);
  assert.throws(() => findFirstIntersectingPresent({
    inputAt: 100,
    cursorCell: { x: 40, y: 16, width: 8, height: 16 },
    records: [present(2, 120, { x: 0, y: 0, width: 8, height: 8 }), present(2, 121, { x: 40, y: 16, width: 8, height: 16 })],
  }), /regressed or duplicated/);
});

test("detector refuses unfocused and overlapping input windows", () => {
  const cursorCell = { x: 40, y: 16, width: 8, height: 16 };
  const records = [present(1, 120, { x: 40, y: 16, width: 8, height: 16 })];
  assert.equal(findFirstIntersectingPresent({
    inputAt: 100,
    cursorCell,
    focused: false,
    records,
  }), null);
  assert.equal(findFirstIntersectingPresent({
    inputAt: 100,
    nextInputAt: 110,
    cursorCell,
    records,
  }), null);
  assert.throws(() => findFirstIntersectingPresent({
    inputAt: 100,
    nextInputAt: 100,
    cursorCell,
    records,
  }), /nextInputAt must be later/);
});

test("cursor-cell scanner selects a solid Foot block from the measured window", () => {
  const pixels = new Uint8ClampedArray(1280 * 800 * 4);
  const left = 100;
  const top = 200;
  for (let y = top; y < top + 16; y += 1) {
    for (let x = left + 24; x < left + 32; x += 1) {
      const offset = (y * 1280 + x) * 4;
      pixels[offset] = 240;
      pixels[offset + 1] = 240;
      pixels[offset + 2] = 240;
      pixels[offset + 3] = 255;
    }
  }
  const cell = findTerminalCursorCell(pixels, {
    window: { left, right: left + 80, bottom: top + 80 },
    titlebar: { bottom: top },
  });
  assert.deepEqual(cell, { x: left + 24, y: top, width: 8, height: 16, column: 3, row: 0, solidPixels: 128 });
});

test("histogram and p95 retain a bimodal 500 ms tail", () => {
  const samples = [
    ...Array.from({ length: 10 }, () => ({ latencyMs: 4, measurement: KEY_LATENCY_MEASUREMENT })),
    ...Array.from({ length: 80 }, () => ({ latencyMs: 16, measurement: KEY_LATENCY_MEASUREMENT })),
    ...Array.from({ length: 10 }, () => ({ latencyMs: 500, measurement: KEY_LATENCY_MEASUREMENT })),
  ];
  const result = summarizeKeyLatency(samples, { warmupDiscardCount: 0, refreshRateHz: 120 });
  assert.equal(result.schema, KEY_LATENCY_HARNESS_VERSION);
  assert.equal(result.measurement, KEY_LATENCY_MEASUREMENT);
  assert.equal(result.trialCount, KEY_LATENCY_TRIAL_COUNT);
  assert.equal(result.latencyP95Ms, 500);
  assert.equal(result.histogram.at(-1).count, 10);
  assert.equal(result.rafVsyncErrorBoundMs, 1000 / 120);
  assert.throws(() => summarizeKeyLatency(
    Array.from({ length: 100 }, () => ({ latencyMs: 16 })),
    { warmupDiscardCount: 0 },
  ), /first-intersecting-drawn-present/);
});

test("100 ms present-delay calibration is explicit and bounded", () => {
  const baseline = { latencyP50Ms: 24, measurement: KEY_LATENCY_MEASUREMENT };
  const delayed = { latencyP50Ms: baseline.latencyP50Ms + PRESENT_DELAY_CALIBRATION_MS, measurement: KEY_LATENCY_MEASUREMENT };
  const result = calibratePresentDelay(baseline, delayed);
  assert.equal(result.measuredShiftMs, 100);
  assert.equal(result.shiftHeld, true);
  assert.equal(calibratePresentDelay(baseline, { latencyP50Ms: 40, measurement: KEY_LATENCY_MEASUREMENT }).shiftHeld, false);
  assert.throws(() => calibratePresentDelay(baseline, { latencyP50Ms: 124 }), /first-intersecting-drawn-present/);
});
