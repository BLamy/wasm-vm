import assert from "node:assert/strict";

import {
  DRAG_MIN_WINDOW_DISPLACEMENT_PX,
  aggregateDragRuns,
  assertWindowMoved,
} from "../../../web/bench/desktop-perf.js";

function probe(name, operation, expected) {
  try {
    const value = operation();
    assert.equal(expected, "accepted", `${name} unexpectedly accepted`);
    return { name, outcome: "accepted", value };
  } catch (error) {
    assert.equal(expected, "rejected", `${name} unexpectedly rejected: ${error.message}`);
    return { name, outcome: "rejected", error: String(error.message) };
  }
}

const probes = [
  probe("stationary-right", () => assertWindowMoved({ left: 100 }, { left: 100 }, { direction: 1 }), "rejected"),
  probe("stationary-left", () => assertWindowMoved({ left: 100 }, { left: 100 }, { direction: -1 }), "rejected"),
  probe("right-below-minimum", () => assertWindowMoved({ left: 100 }, { left: 199.999 }, { direction: 1 }), "rejected"),
  probe("left-below-minimum", () => assertWindowMoved({ left: 100 }, { left: 0.001 }, { direction: -1 }), "rejected"),
  probe("right-exact-minimum", () => assertWindowMoved({ left: 100 }, { left: 200 }, { direction: 1 }), "accepted"),
  probe("left-exact-minimum", () => assertWindowMoved({ left: 100 }, { left: 0 }, { direction: -1 }), "accepted"),
  probe("wrong-way-right", () => assertWindowMoved({ left: 100 }, { left: -200 }, { direction: 1 }), "rejected"),
  probe("wrong-way-left", () => assertWindowMoved({ left: 100 }, { left: 400 }, { direction: -1 }), "rejected"),
  probe("neutral-either-direction", () => assertWindowMoved({ left: 100 }, { left: -50 }, { direction: 0 }), "accepted"),
  probe("nan-before", () => assertWindowMoved({ left: Number.NaN }, { left: 200 }, { direction: 1 }), "rejected"),
  probe("infinite-after", () => assertWindowMoved({ left: 100 }, { left: Infinity }, { direction: 1 }), "rejected"),
  probe("zero-minimum", () => assertWindowMoved({ left: 100 }, { left: 100 }, { direction: 1, minimumPx: 0 }), "rejected"),
  probe("invalid-direction", () => assertWindowMoved({ left: 100 }, { left: 400 }, { direction: 2 }), "rejected"),
];

// The pure FPS aggregator deliberately has no geometry input. This bounded sabotage proves that
// browser-loop integration is the enforcement point and must execute before this call.
const stationarySummaries = Array.from({ length: 5 }, (_, index) => ({
  runId: `stationary-${index + 1}`,
  fps: 15,
}));
const bypassAggregate = aggregateDragRuns(stationarySummaries);
assert.equal(bypassAggregate.repeatabilityHeld, true);

console.log(JSON.stringify({
  head: "6fca89a7463ee5bb932a615d62986fafadb26068",
  minimumPx: DRAG_MIN_WINDOW_DISPLACEMENT_PX,
  probes,
  bypassWithoutBrowserIntegration: {
    meanFps: bypassAggregate.meanFps,
    coefficientOfVariationPercent: bypassAggregate.coefficientOfVariationPercent,
    repeatabilityHeld: bypassAggregate.repeatabilityHeld,
  },
}, null, 2));
