import {
  aggregateDragRuns,
  assertNullSinkRejected,
  buildDragPath,
  summarizeDragRun,
} from "../../../web/bench/desktop-perf.js";

const record = (timestamp, sequence, guestInstructions, extra = {}) => ({
  timestamp,
  sequence,
  drawn: true,
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

function stationaryPassingAggregate() {
  const runs = Array.from({ length: 5 }, (_, index) => {
    const summary = summarize({
      runId: `stationary-${index + 1}`,
      records: [
        record(100, 1, 10, { rect: { x: 200, y: 200, width: 20, height: 20 } }),
        record(150, 2, 20, { rect: { x: 200, y: 200, width: 20, height: 20 } }),
        record(200, 3, 30, { rect: { x: 200, y: 200, width: 20, height: 20 } }),
      ],
    });
    return {
      ...summary,
      requestedMoves: 300,
      pointerFramesBefore: index * 300,
      pointerFramesDelta: 300,
      pointerFrames: (index + 1) * 300,
    };
  });
  return aggregateDragRuns(runs);
}

const probes = [
  probe("path-299", () => buildDragPath(undefined, undefined, 299).length),
  probe("path-301", () => buildDragPath(undefined, undefined, 301).length),
  probe("summary-expectedMoves-299", () => summarize({ expectedMoves: 299 })),
  probe("summary-expectedMoves-301", () => summarize({ expectedMoves: 301 })),
  probe("duplicate-sequence", () => summarize({ records: [record(100, 1, 10), record(150, 1, 20)], presentDurationsMs: [1, 1] })),
  probe("regressing-sequence", () => summarize({ records: [record(100, 2, 10), record(150, 1, 20)], presentDurationsMs: [1, 1] })),
  probe("nan-timestamp", () => summarize({ records: [record(Number.NaN, 1, 10)], presentDurationsMs: [1] })),
  probe("nan-bytes", () => summarize({ records: [record(100, 1, 10, { bytes: Number.NaN })], presentDurationsMs: [1] })),
  probe("nan-present-duration", () => summarize({ presentDurationsMs: [1, Number.NaN, 3] })),
  probe("missing-attribution", () => summarize({ records: [record(100, 1, null)], presentDurationsMs: [1] })),
  probe("zero-attribution", () => summarize({ records: [record(100, 1, 0)], presentDurationsMs: [1] })),
  probe("negative-attribution", () => summarize({ records: [record(100, 1, -1)], presentDurationsMs: [1] })),
  probe("regressing-cumulative-attribution", () => summarize({
    records: [record(100, 1, 10, { guestInstructionsTotal: 100 }), record(150, 2, 10, { guestInstructionsTotal: 50 })],
    presentDurationsMs: [1, 1],
  })),
  probe("missing-scheduler-attribution", () => summarize({ schedulerAfter: {} })),
  probe("regressing-guest-duration", () => summarize({ schedulerAfter: { totalSliceMs: 0, fetchWaitTotalMs: 5 } })),
  probe("regressing-transfer-duration", () => summarize({ schedulerAfter: { totalSliceMs: 9, fetchWaitTotalMs: 1 } })),
  probe("null-record", () => summarize({ records: [null], presentDurationsMs: [] })),
  probe("all-undrawn", () => summarize({
    records: [{ ...record(100, 1, null), drawn: false }], presentDurationsMs: [],
  })),
  probe("null-sink", () => assertNullSinkRejected([{ ...record(100, 1, null), drawn: false }])),
  probe("aggregate-four-runs", () => aggregateDragRuns([1, 2, 3, 4].map((fps) => ({ fps })))),
  probe("aggregate-six-runs", () => aggregateDragRuns([1, 2, 3, 4, 5, 6].map((fps) => ({ fps })))),
  probe("aggregate-nan-fps", () => aggregateDragRuns([1, 2, 3, 4, Number.NaN].map((fps) => ({ fps })))),
  probe("aggregate-duplicate-run-ids", () => aggregateDragRuns([1, 2, 3, 4, 5].map((fps) => ({ runId: "same", fps })))),
  probe("aggregate-fps-only-malformed-runs", () => aggregateDragRuns([1, 2, 3, 4, 5].map((fps) => ({ fps })))),
  probe("stationary-window-browser-like-five-run-aggregate", () => stationaryPassingAggregate()),
];

console.log(JSON.stringify({
  head: "a14bf5453a6799a67b5f66e85b4167223580e541",
  note: "Accepted synthetic cases are held against the fixed production runner and strict retained-artifact audit.",
  probes,
}, null, 2));
