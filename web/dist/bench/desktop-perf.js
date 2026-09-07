// E5-T25b: deterministic aggregation for the headed desktop drag-FPS harness.
// This module has no browser or guest dependencies so the acceptance math can be attacked in Node.

export const DESKTOP_PERF_HARNESS_VERSION = "e5-t25b-v1";
export const KEY_LATENCY_HARNESS_VERSION = "e5-t25c-v1";
export const KEY_LATENCY_MEASUREMENT = "first-intersecting-drawn-present";
export const DRAG_MOVE_COUNT = 300;
export const DRAG_REPEAT_COUNT = 5;
export const DRAG_CV_LIMIT_PERCENT = 15;
export const DRAG_MIN_WINDOW_DISPLACEMENT_PX = 100;
export const KEY_LATENCY_TRIAL_COUNT = 100;
export const KEY_LATENCY_WARMUP_COUNT = 10;
export const PRESENT_DELAY_CALIBRATION_MS = 100;
export const TERMINAL_CELL_WIDTH_PX = 8;
export const TERMINAL_CELL_HEIGHT_PX = 16;

function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function nonNegativeNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) throw new RangeError(`${name} must be non-negative`);
  return number;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function checkedRect(rect, name = "rect") {
  if (rect === null || typeof rect !== "object") throw new TypeError(`${name} must be an object`);
  const result = {
    x: finiteNumber(rect.x, `${name}.x`),
    y: finiteNumber(rect.y, `${name}.y`),
    width: positiveNumber(rect.width, `${name}.width`),
    height: positiveNumber(rect.height, `${name}.height`),
  };
  return Object.freeze(result);
}

function rectanglesIntersect(left, right) {
  return left.x < right.x + right.width && right.x < left.x + left.width &&
    left.y < right.y + right.height && right.y < left.y + left.height;
}

function counterDelta(before, after, name) {
  const start = nonNegativeNumber(before, `${name}.before`);
  const end = nonNegativeNumber(after, `${name}.after`);
  if (end < start) throw new RangeError(`${name} regressed`);
  return end - start;
}

function percentile(values, fraction) {
  if (values.length === 0) throw new RangeError("percentile requires samples");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function coefficientOfVariation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) throw new RangeError("FPS mean must be positive");
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return { mean, standardDeviation: Math.sqrt(variance), cvPercent: (Math.sqrt(variance) / mean) * 100 };
}

/** Build exactly `moves` integer CSS points, including both path endpoints. */
export function buildDragPath(
  from = { x: 160, y: 180 },
  to = { x: 460, y: 180 },
  moves = DRAG_MOVE_COUNT,
) {
  positiveInteger(moves, "moves");
  const startX = finiteNumber(from?.x, "from.x");
  const startY = finiteNumber(from?.y, "from.y");
  const endX = finiteNumber(to?.x, "to.x");
  const endY = finiteNumber(to?.y, "to.y");
  return Array.from({ length: moves }, (_, index) => {
    const fraction = moves === 1 ? 1 : index / (moves - 1);
    return {
      x: Math.round(startX + ((endX - startX) * fraction)),
      y: Math.round(startY + ((endY - startY) * fraction)),
    };
  });
}

/** Reject a plausible-looking FPS sample unless the real window moved in the requested direction. */
export function assertWindowMoved(
  before,
  after,
  { direction = 0, minimumPx = DRAG_MIN_WINDOW_DISPLACEMENT_PX } = {},
) {
  const start = finiteNumber(before?.left, "windowBefore.left");
  const end = finiteNumber(after?.left, "windowAfter.left");
  const minimum = finiteNumber(minimumPx, "minimumPx");
  if (minimum <= 0) throw new RangeError("minimumPx must be positive");
  if (direction !== -1 && direction !== 0 && direction !== 1) {
    throw new RangeError("direction must be -1, 0, or 1");
  }
  const deltaX = end - start;
  const displacementPx = Math.abs(deltaX);
  if (displacementPx < minimum) {
    throw new Error(`window displacement ${displacementPx}px is below ${minimum}px`);
  }
  if (direction !== 0 && Math.sign(deltaX) !== direction) {
    throw new Error(`window moved in the wrong direction: ${deltaX}px`);
  }
  return Object.freeze({ deltaX, displacementPx });
}

/**
 * Locate the high-contrast Foot block cursor in a guest framebuffer. Foot's pinned image uses
 * the default 8x16 monospace cell, while the window origin and titlebar are measured from the
 * independent desktop-cursor geometry detector. This is only a test-side calibration helper;
 * production rendering never imports it.
 */
export function findTerminalCursorCell(
  pixels,
  { window: windowRect, titlebar },
  {
    cellWidth = TERMINAL_CELL_WIDTH_PX,
    cellHeight = TERMINAL_CELL_HEIGHT_PX,
    minSolidPixels = Math.floor(TERMINAL_CELL_WIDTH_PX * TERMINAL_CELL_HEIGHT_PX * 0.45),
    pixelWidth = 1280,
  } = {},
) {
  if (pixels === null || typeof pixels !== "object" || typeof pixels.length !== "number") {
    throw new TypeError("pixels must be array-like");
  }
  if (pixels.length < 4 || pixels.length % 4 !== 0) throw new RangeError("pixels must contain RGBA words");
  const left = finiteNumber(windowRect?.left, "window.left");
  const right = finiteNumber(windowRect?.right, "window.right");
  const top = finiteNumber(titlebar?.bottom, "titlebar.bottom");
  const bottom = finiteNumber(windowRect?.bottom, "window.bottom");
  const width = positiveNumber(cellWidth, "cellWidth");
  const height = positiveNumber(cellHeight, "cellHeight");
  const minimum = positiveNumber(minSolidPixels, "minSolidPixels");
  const framebufferWidth = positiveInteger(pixelWidth, "pixelWidth");
  const framebufferHeight = pixels.length / 4 / framebufferWidth;
  if (!Number.isSafeInteger(framebufferHeight)) throw new RangeError("pixels do not match pixelWidth");
  const columns = Math.floor((right - left) / width);
  const rows = Math.floor((bottom - top) / height);
  if (columns < 1 || rows < 1) throw new RangeError("window is smaller than one terminal cell");

  let best = null;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = { x: left + (column * width), y: top + (row * height), width, height };
      let solidPixels = 0;
      for (let y = Math.floor(cell.y); y < Math.ceil(cell.y + cell.height); y += 1) {
        for (let x = Math.floor(cell.x); x < Math.ceil(cell.x + cell.width); x += 1) {
          if (x < 0 || y < 0 || x >= framebufferWidth || y >= framebufferHeight) continue;
          const offset = ((y * framebufferWidth) + x) * 4;
          if (pixels[offset] >= 180 && pixels[offset + 1] >= 180 && pixels[offset + 2] >= 180) {
            solidPixels += 1;
          }
        }
      }
      if (solidPixels >= minimum && (!best || solidPixels > best.solidPixels)) {
        best = { ...cell, column, row, solidPixels };
      }
    }
  }
  return best ? Object.freeze(best) : null;
}

/** Return the first drawn post-input present whose damage rectangle touches the resulting cell. */
export function findFirstIntersectingPresent({
  records,
  inputAt,
  cursorCell,
  sequenceBefore = 0,
  nextInputAt = null,
  focused = true,
}) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  const startedAt = finiteNumber(inputAt, "inputAt");
  const priorSequence = nonNegativeInteger(sequenceBefore, "sequenceBefore");
  const followingInputAt = nextInputAt === null ? null : finiteNumber(nextInputAt, "nextInputAt");
  if (followingInputAt !== null && followingInputAt <= startedAt) {
    throw new RangeError("nextInputAt must be later than inputAt");
  }
  const cell = checkedRect(cursorCell, "cursorCell");
  if (focused !== true) return null;
  let lastSequence = 0;
  for (const record of records) {
    if (record === null || typeof record !== "object") throw new TypeError("present record must be an object");
    const sequence = positiveInteger(record.sequence, "present.sequence");
    if (sequence <= lastSequence) throw new RangeError("present sequence regressed or duplicated");
    lastSequence = sequence;
    const timestamp = finiteNumber(record.timestamp, "present.timestamp");
    const damage = checkedRect(record.rect, "present.rect");
    if (sequence <= priorSequence || timestamp < startedAt || record.drawn !== true) continue;
    if (followingInputAt !== null && timestamp >= followingInputAt) return null;
    if (!rectanglesIntersect(damage, cell)) continue;
    return Object.freeze({
      sequence,
      inputAt: startedAt,
      presentAt: timestamp,
      latencyMs: timestamp - startedAt,
      cursorCell: cell,
      damageRect: damage,
      drawn: true,
      measurement: KEY_LATENCY_MEASUREMENT,
    });
  }
  return null;
}

function histogramFor(values) {
  const bins = [
    { maxExclusive: 16, label: "0-16ms" },
    { maxExclusive: 33, label: "16-33ms" },
    { maxExclusive: 50, label: "33-50ms" },
    { maxExclusive: 100, label: "50-100ms" },
    { maxExclusive: 150, label: "100-150ms" },
    { maxExclusive: 250, label: "150-250ms" },
    { maxExclusive: 500, label: "250-500ms" },
    { maxExclusive: Number.POSITIVE_INFINITY, label: "500ms+" },
  ].map((bin) => ({ ...bin, count: 0 }));
  for (const value of values) {
    const bin = bins.find((candidate) => value < candidate.maxExclusive);
    bin.count += 1;
  }
  return bins.map(({ label, count }) => Object.freeze({ label, count }));
}

/** Summarize the post-warm-up distribution without hiding its tail behind p50/p95. */
export function summarizeKeyLatency(
  samples,
  {
    warmupDiscardCount = KEY_LATENCY_WARMUP_COUNT,
    refreshRateHz = 60,
    expectedTrials = KEY_LATENCY_TRIAL_COUNT,
  } = {},
) {
  if (!Array.isArray(samples)) throw new TypeError("latency samples must be an array");
  const warmup = nonNegativeInteger(warmupDiscardCount, "warmupDiscardCount");
  const expected = positiveInteger(expectedTrials, "expectedTrials");
  const refresh = positiveNumber(refreshRateHz, "refreshRateHz");
  if (samples.length < expected) throw new RangeError(`expected at least ${expected} latency samples`);
  const measured = samples.slice(warmup);
  if (measured.length < expected) throw new RangeError(`expected ${expected} post-warm-up latency samples`);
  const values = measured.map((sample, index) => {
    if (sample?.measurement !== KEY_LATENCY_MEASUREMENT) {
      throw new TypeError(`samples[${index}] must come from ${KEY_LATENCY_MEASUREMENT}`);
    }
    const latency = finiteNumber(sample?.latencyMs, `samples[${index}].latencyMs`);
    if (latency < 0) throw new RangeError(`samples[${index}].latencyMs must be non-negative`);
    return latency;
  });
  const errorBoundMs = 1000 / refresh;
  return Object.freeze({
    schema: KEY_LATENCY_HARNESS_VERSION,
    measurement: KEY_LATENCY_MEASUREMENT,
    warmupDiscardCount: warmup,
    trialCount: values.length,
    latencyP50Ms: percentile(values, 0.5),
    latencyP95Ms: percentile(values, 0.95),
    minimumLatencyMs: Math.min(...values),
    maximumLatencyMs: Math.max(...values),
    refreshRateHz: refresh,
    rafVsyncErrorBoundMs: errorBoundMs,
    histogram: histogramFor(values),
    samples: measured.map((sample) => ({ ...sample })),
  });
}

/** Validate the known-delay calibration against the detector's p50, including its tolerance. */
export function calibratePresentDelay(
  baseline,
  delayed,
  { delayMs = PRESENT_DELAY_CALIBRATION_MS, toleranceMs = 10 } = {},
) {
  const expected = positiveNumber(delayMs, "delayMs");
  const tolerance = positiveNumber(toleranceMs, "toleranceMs");
  const baselineP50 = finiteNumber(baseline?.latencyP50Ms, "baseline.latencyP50Ms");
  const delayedP50 = finiteNumber(delayed?.latencyP50Ms, "delayed.latencyP50Ms");
  if (baseline?.measurement !== KEY_LATENCY_MEASUREMENT || delayed?.measurement !== KEY_LATENCY_MEASUREMENT) {
    throw new TypeError(`calibration requires ${KEY_LATENCY_MEASUREMENT} summaries`);
  }
  const shiftMs = delayedP50 - baselineP50;
  return Object.freeze({
    delayMs: expected,
    toleranceMs: tolerance,
    baselineP50Ms: baselineP50,
    delayedP50Ms: delayedP50,
    measuredShiftMs: shiftMs,
    shiftHeld: Math.abs(shiftMs - expected) <= tolerance,
  });
}

function recordsInWindow(records, startedAt, endedAt) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  return records.filter((record) => {
    if (record === null || typeof record !== "object") throw new TypeError("present record must be an object");
    const timestamp = finiteNumber(record.timestamp, "present.timestamp");
    return timestamp >= startedAt && timestamp <= endedAt;
  });
}

/**
 * Summarize one real drag interval. Only drawn records count; acknowledged-but-undrawn records
 * are deliberately rejected instead of being allowed to manufacture an FPS number.
 */
export function summarizeDragRun({
  runId,
  records,
  startedAt,
  endedAt,
  expectedMoves = DRAG_MOVE_COUNT,
  schedulerBefore,
  schedulerAfter,
  presentDurationsMs,
  browser = null,
  deviceScaleFactor = null,
  viewport = null,
}) {
  const id = String(runId ?? "run");
  positiveInteger(expectedMoves, "expectedMoves");
  const start = finiteNumber(startedAt, "startedAt");
  const end = finiteNumber(endedAt, "endedAt");
  if (end <= start) throw new RangeError("drag interval must be positive");
  const wallMs = end - start;
  const windowRecords = recordsInWindow(records, start, end);
  const drawn = windowRecords.filter((record) => record.drawn === true);
  if (drawn.length === 0) throw new Error(`${id}: no drawn presents in drag interval`);
  const undrawn = windowRecords.filter((record) => record.drawn !== true).length;
  const bytesUploaded = drawn.reduce((sum, record) => sum + nonNegativeInteger(record.bytes, "present.bytes"), 0);
  const guestInstructions = drawn.reduce((sum, record) => {
    if (!Number.isSafeInteger(record.guestInstructions) || record.guestInstructions < 0) {
      throw new Error(`${id}: missing guest instruction attribution`);
    }
    return sum + record.guestInstructions;
  }, 0);
  if (guestInstructions <= 0) throw new Error(`${id}: guest attribution is zero`);
  if (!Array.isArray(presentDurationsMs) || presentDurationsMs.length !== drawn.length) {
    throw new Error(`${id}: present duration samples do not match drawn presents`);
  }
  const presentDurationMs = presentDurationsMs.reduce(
    (sum, value) => sum + nonNegativeNumber(value, "presentDurationMs"), 0,
  );
  const guestDurationMs = counterDelta(
    schedulerBefore?.totalSliceMs, schedulerAfter?.totalSliceMs, "guestDurationMs",
  );
  const transferDurationMs = counterDelta(
    schedulerBefore?.fetchWaitTotalMs, schedulerAfter?.fetchWaitTotalMs, "transferDurationMs",
  );
  const fps = drawn.length / (wallMs / 1000);
  return Object.freeze({
    schema: DESKTOP_PERF_HARNESS_VERSION,
    runId: id,
    expectedMoves,
    drawnPresents: drawn.length,
    acknowledgedUndrawnPresents: undrawn,
    wallMs,
    fps,
    bytesUploaded,
    bytesPerFrame: bytesUploaded / drawn.length,
    guestInstructions,
    instructionsPerFrame: guestInstructions / drawn.length,
    durationsMs: Object.freeze({ guest: guestDurationMs, transfer: transferDurationMs, present: presentDurationMs }),
    browser,
    deviceScaleFactor,
    viewport,
  });
}

export function aggregateDragRuns(runs, { expectedRuns = DRAG_REPEAT_COUNT } = {}) {
  if (!Array.isArray(runs) || runs.length !== expectedRuns) {
    throw new Error(`expected exactly ${expectedRuns} drag runs`);
  }
  const fps = runs.map((run) => finiteNumber(run?.fps, "run.fps"));
  const repeatability = coefficientOfVariation(fps);
  return Object.freeze({
    schema: DESKTOP_PERF_HARNESS_VERSION,
    runCount: runs.length,
    fpsP50: percentile(fps, 0.5),
    fpsP95: percentile(fps, 0.95),
    meanFps: repeatability.mean,
    standardDeviationFps: repeatability.standardDeviation,
    coefficientOfVariationPercent: repeatability.cvPercent,
    coefficientOfVariationLimitPercent: DRAG_CV_LIMIT_PERCENT,
    repeatabilityHeld: repeatability.cvPercent < DRAG_CV_LIMIT_PERCENT,
    runs: runs.map((run) => ({ ...run })),
  });
}

export function assertNullSinkRejected(records) {
  if (!Array.isArray(records) || records.some((record) => record?.drawn === true)) {
    throw new Error("null-sink attack must contain no drawn records");
  }
  return Object.freeze({ drawnPresents: 0, accepted: false, reason: "no-drawn-presents" });
}
