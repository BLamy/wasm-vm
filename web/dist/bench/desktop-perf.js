// E5-T25b: deterministic aggregation for the headed desktop drag-FPS harness.
// This module has no browser or guest dependencies so the acceptance math can be attacked in Node.

export const DESKTOP_PERF_HARNESS_VERSION = "e5-t25b-v1";
export const DRAG_MOVE_COUNT = 300;
export const DRAG_REPEAT_COUNT = 5;
export const DRAG_CV_LIMIT_PERCENT = 15;
export const DRAG_MIN_WINDOW_DISPLACEMENT_PX = 100;

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
