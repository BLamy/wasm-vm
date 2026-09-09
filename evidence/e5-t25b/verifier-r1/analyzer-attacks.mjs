import {
  aggregateDragRuns,
  assertNullSinkRejected,
  buildDragPath,
  summarizeDragRun,
} from "../../../web/bench/desktop-perf.js";

const record = (timestamp, sequence, guestInstructions, drawn = true, extra = {}) => ({
  timestamp,
  sequence,
  drawn,
  bytes: 16,
  guestInstructions,
  guestInstructionsTotal: guestInstructions,
  ...extra,
});

function summarize(overrides = {}) {
  return summarizeDragRun({
    runId: "attack",
    records: [record(100, 1, 10), record(150, 2, 20), record(200, 3, 30)],
    startedAt: 100,
    endedAt: 300,
    schedulerBefore: { totalSliceMs: 1, fetchWaitTotalMs: 2 },
    schedulerAfter: { totalSliceMs: 9, fetchWaitTotalMs: 5 },
    presentDurationsMs: [1, 2, 3],
    ...overrides,
  });
}

function probe(name, operation) {
  try {
    const value = operation();
    return { name, outcome: "accepted", value };
  } catch (error) {
    return { name, outcome: "rejected", error: String(error?.message || error) };
  }
}

const path299 = buildDragPath(undefined, undefined, 299);
const path301 = buildDragPath(undefined, undefined, 301);
const duplicatePath = buildDragPath({ x: 10, y: 10 }, { x: 10, y: 10 }, 300);

const probes = [
  { name: "path-299", outcome: "observed", value: { length: path299.length, unique: new Set(path299.map(JSON.stringify)).size, first: path299[0], last: path299.at(-1) } },
  { name: "path-301", outcome: "observed", value: { length: path301.length, unique: new Set(path301.map(JSON.stringify)).size, first: path301[0], last: path301.at(-1) } },
  { name: "duplicate-300-point-path", outcome: "observed", value: { length: duplicatePath.length, unique: new Set(duplicatePath.map(JSON.stringify)).size } },
  probe("nan-path-coordinate", () => buildDragPath({ x: Number.NaN, y: 0 }, { x: 1, y: 0 }, 300)),
  probe("summary-expectedMoves-299", () => summarize({ expectedMoves: 299 })),
  probe("summary-expectedMoves-301", () => summarize({ expectedMoves: 301 })),
  probe("nan-present-timestamp", () => summarize({ records: [record(Number.NaN, 1, 10)], presentDurationsMs: [1] })),
  probe("nan-present-bytes", () => summarize({ records: [record(100, 1, 10, true, { bytes: Number.NaN })], presentDurationsMs: [1] })),
  probe("nan-present-duration", () => summarize({ presentDurationsMs: [1, Number.NaN, 3] })),
  probe("missing-guest-attribution", () => summarize({ records: [record(100, 1, null)], presentDurationsMs: [1] })),
  probe("zero-guest-attribution", () => summarize({ records: [record(100, 1, 0)], presentDurationsMs: [1] })),
  probe("negative-guest-delta", () => summarize({ records: [record(100, 1, -1)], presentDurationsMs: [1] })),
  probe("regressing-guest-total", () => summarize({ records: [record(100, 1, 10, true, { guestInstructionsTotal: 100 }), record(150, 2, 10, true, { guestInstructionsTotal: 50 })], presentDurationsMs: [1, 1] })),
  probe("duplicate-present-sequence", () => summarize({ records: [record(100, 1, 10), record(150, 1, 10)], presentDurationsMs: [1, 1] })),
  probe("regressing-present-sequence", () => summarize({ records: [record(100, 2, 10), record(150, 1, 10)], presentDurationsMs: [1, 1] })),
  probe("missing-scheduler-attribution", () => summarize({ schedulerAfter: {} })),
  probe("zero-duration-attribution", () => summarize({ schedulerBefore: { totalSliceMs: 1, fetchWaitTotalMs: 2 }, schedulerAfter: { totalSliceMs: 1, fetchWaitTotalMs: 2 }, presentDurationsMs: [0, 0, 0] })),
  probe("regressing-guest-duration", () => summarize({ schedulerAfter: { totalSliceMs: 0, fetchWaitTotalMs: 5 } })),
  probe("regressing-transfer-duration", () => summarize({ schedulerAfter: { totalSliceMs: 9, fetchWaitTotalMs: 1 } })),
  probe("null-record", () => summarize({ records: [null], presentDurationsMs: [] })),
  probe("undrawn-null-sink", () => summarize({ records: [record(100, 1, null, false)], presentDurationsMs: [] })),
  probe("null-sink-assertion", () => assertNullSinkRejected([record(100, 1, null, false)])),
  probe("mixed-drawn-undrawn", () => summarize({ records: [record(100, 1, 10, true), record(150, 2, null, false)], presentDurationsMs: [1] })),
  probe("unsafe-byte-sum", () => summarize({ records: [record(100, 1, 10, true, { bytes: Number.MAX_SAFE_INTEGER }), record(150, 2, 10, true, { bytes: Number.MAX_SAFE_INTEGER })], presentDurationsMs: [1, 1] })),
  probe("unsafe-guest-sum", () => summarize({ records: [record(100, 1, Number.MAX_SAFE_INTEGER), record(150, 2, Number.MAX_SAFE_INTEGER)], presentDurationsMs: [1, 1] })),
  probe("aggregate-four-runs", () => aggregateDragRuns([1, 2, 3, 4].map((fps) => ({ fps })))),
  probe("aggregate-six-runs", () => aggregateDragRuns([1, 2, 3, 4, 5, 6].map((fps) => ({ fps })))),
  probe("aggregate-nan-fps", () => aggregateDragRuns([1, 2, 3, 4, Number.NaN].map((fps) => ({ fps })))),
];

console.log(JSON.stringify({ head: "6bc03107cc72704c5f6e1f939e6147a15625e973", probes }, null, 2));
