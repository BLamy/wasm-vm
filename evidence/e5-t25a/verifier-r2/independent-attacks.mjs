import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { createDesktopPerfInput } from "../../../web/bench/desktop-perf-hooks.js";
import { PresentationController as SourcePresentationController }
  from "../../../web/src/sink/presentation.js";
import { PresentationController as DistPresentationController }
  from "../../../web/dist/src/sink/presentation.js";

const checks = [];
function check(name, actual, expected) {
  const held = isDeepStrictEqual(actual, expected);
  checks.push({ name, held, actual, expected });
  return held;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function recordingController(delays = {}, failure = null) {
  const calls = [];
  const controller = {};
  for (const name of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
    controller[name] = async (...args) => {
      calls.push([name, ...args]);
      if (failure?.(name, args)) throw new Error("injected controller failure");
      await delay(delays[name] ?? 0);
    };
  }
  return { controller, calls };
}

class Canvas {
  constructor() { this.width = 2; this.height = 2; }
  getContext() { return null; }
  addEventListener() {}
  removeEventListener() {}
}

class Backend {
  constructor(drawn = true) { this.drawn = drawn; this.presentCalls = 0; }
  resize() {}
  present() { this.presentCalls += 1; }
  drawsPixels() { return this.drawn; }
}

const factories = (backend) => ({ canvas2d: () => backend, webgl2: () => backend });
const frame = (rect = { x: 0, y: 0, width: 2, height: 2 }) => ({
  format: 1,
  rect,
  resourceWidth: 2,
  resourceHeight: 2,
  pixels: new Uint32Array(4).fill(0xff445566),
});

const moveCalls = [
  ["sendTabletEvent", 3, 0, 11],
  ["sendTabletEvent", 3, 1, 12],
  ["syncTablet"],
];
const buttonCalls = [
  ["sendTabletEvent", 1, 0x110, 1],
  ["syncTablet"],
];

// Re-test the prior interleaving refutation in both public-call orders with real
// macrotask delays inside every async controller boundary.
const concurrentRuns = [];
for (let repetition = 0; repetition < 64; repetition += 1) {
  const fixture = recordingController({
    sendTabletEvent: 1 + (repetition % 3),
    syncTablet: 1 + ((repetition + 1) % 3),
  });
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const moveFirst = repetition % 2 === 0;
  const pending = moveFirst
    ? [input.moveAbsolute(11, 12), input.leftButton(true)]
    : [input.leftButton(true), input.moveAbsolute(11, 12)];
  const records = await Promise.all(pending);
  const expectedCalls = moveFirst ? [...moveCalls, ...buttonCalls] : [...buttonCalls, ...moveCalls];
  check(`concurrent-${repetition}-complete-frame-order`, fixture.calls, expectedCalls);
  check(`concurrent-${repetition}-public-sequences`, records.map((record) => record.sequence), [1, 2]);
  concurrentRuns.push({ repetition, moveFirst, calls: fixture.calls, records });
}

// Novel mixed-device burst: a single queue must preserve five complete frames,
// including their device-specific sync boundaries.
const mixedFixture = recordingController({
  sendTabletEvent: 2,
  syncTablet: 1,
  sendKeyboardEvent: 3,
  syncKeyboard: 1,
});
const mixedInput = createDesktopPerfInput(mixedFixture.controller, { enabled: true });
const mixedRecords = await Promise.all([
  mixedInput.moveAbsolute(20, 21),
  mixedInput.leftButton(true),
  mixedInput.key(30, true),
  mixedInput.leftButton(false),
  mixedInput.key(30, false),
]);
const expectedMixedCalls = [
  ["sendTabletEvent", 3, 0, 20], ["sendTabletEvent", 3, 1, 21], ["syncTablet"],
  ["sendTabletEvent", 1, 0x110, 1], ["syncTablet"],
  ["sendKeyboardEvent", 1, 30, 1], ["syncKeyboard"],
  ["sendTabletEvent", 1, 0x110, 0], ["syncTablet"],
  ["sendKeyboardEvent", 1, 30, 0], ["syncKeyboard"],
];
check("mixed-device-complete-frame-order", mixedFixture.calls, expectedMixedCalls);
check("mixed-device-public-sequences", mixedRecords.map((record) => record.sequence), [1, 2, 3, 4, 5]);

// A failed queued operation may consume its unique sequence, but must release the
// queue and must not mark the failed button as pressed.
let failOnce = true;
const recoveryFixture = recordingController(
  { sendTabletEvent: 1, syncTablet: 1, sendKeyboardEvent: 1, syncKeyboard: 1 },
  (name, args) => {
    if (failOnce && name === "sendTabletEvent" && args[0] === 1 && args[1] === 0x110 && args[2] === 1) {
      failOnce = false;
      return true;
    }
    return false;
  },
);
const recoveryInput = createDesktopPerfInput(recoveryFixture.controller, { enabled: true });
const recoverySettled = await Promise.allSettled([
  recoveryInput.leftButton(true),
  recoveryInput.leftButton(true),
  recoveryInput.key(30, true),
]);
check("queue-recovery-statuses", recoverySettled.map((entry) => entry.status),
  ["rejected", "fulfilled", "fulfilled"]);
check("queue-recovery-sequences", recoverySettled.slice(1).map((entry) => entry.value.sequence), [2, 3]);
const recoveryDuplicate = await recoveryInput.leftButton(true);
check("queue-recovery-state", [recoverySettled[1].value.noop, recoveryDuplicate.noop], [false, true]);

// Required stale/duplicate/validation attacks and public-sequence uniqueness.
const stateFixture = recordingController();
const stateInput = createDesktopPerfInput(stateFixture.controller, { enabled: true });
let invalidThrew = false;
try { stateInput.moveAbsolute(32768, 0); } catch { invalidThrew = true; }
const stateRecords = [
  await stateInput.leftButton(false),
  await stateInput.leftButton(true),
  await stateInput.leftButton(true),
  await stateInput.leftButton(false),
  await stateInput.leftButton(false),
  await stateInput.key(30, false),
  await stateInput.key(30, true),
  await stateInput.key(30, true),
  await stateInput.key(30, false),
  await stateInput.key(30, false),
  await stateInput.moveAbsolute(7, 9),
];
check("invalid-input-rejected-synchronously", invalidThrew, true);
check("invalid-input-does-not-consume-sequence", stateRecords.map((record) => record.sequence),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
check("stale-and-duplicate-noops", stateRecords.slice(0, 10).map((record) => record.noop),
  [true, false, true, false, true, true, false, true, false, true]);
check("public-sequences-unique", new Set(stateRecords.map((record) => record.sequence)).size, 11);

function runAttribution(Controller, samplerValues) {
  const records = [];
  const errors = [];
  const backend = new Backend(true);
  let index = 0;
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(backend),
    onPresent: (record) => records.push(record),
    now: () => 15,
    guestInstructions: samplerValues === undefined ? undefined : () => {
      const value = samplerValues[index++];
      if (value instanceof Error) throw value;
      return value;
    },
  });
  const count = samplerValues?.length ?? 1;
  for (let n = 0; n < count; n += 1) controller.present(frame());
  errors.push(...controller.snapshot().errors);
  return { records, errors, gpu: controller.snapshot().gpu, backendCalls: backend.presentCalls };
}

const sourceAttribution = runAttribution(SourcePresentationController, [100, 175]);
const distAttribution = runAttribution(DistPresentationController, [100, 175]);
const retiredObjectAttribution = runAttribution(SourcePresentationController,
  [{ retiredInstructions: 100 }, { retiredInstructions: 175 }]);
const guestObjectAttribution = runAttribution(SourcePresentationController,
  [{ guestInstructions: 100 }, { guestInstructions: 175 }]);
const compactAttribution = (result) => result.records.map((record) =>
  [record.guestInstructionsTotal, record.guestInstructions]);
check("source-attribution-100-175", compactAttribution(sourceAttribution), [[100, 100], [175, 75]]);
check("dist-attribution-100-175", compactAttribution(distAttribution), [[100, 100], [175, 75]]);
check("retired-object-attribution-100-175", compactAttribution(retiredObjectAttribution),
  [[100, 100], [175, 75]]);
check("guest-object-attribution-100-175", compactAttribution(guestObjectAttribution),
  [[100, 100], [175, 75]]);
check("source-dist-attribution-byte-parity", JSON.stringify(sourceAttribution), JSON.stringify(distAttribution));

const missingSampler = runAttribution(SourcePresentationController, undefined);
const nullSampler = runAttribution(SourcePresentationController, [null]);
const throwingSampler = runAttribution(SourcePresentationController, [new Error("sampler unavailable")]);
const invalidSampler = runAttribution(SourcePresentationController, [Number.NaN, -1, 100]);
const decreasingSampler = runAttribution(SourcePresentationController, [100, 80, 95]);
check("missing-sampler-explicit-null", compactAttribution(missingSampler), [[null, null]]);
check("null-sampler-explicit-null", compactAttribution(nullSampler), [[null, null]]);
check("throwing-sampler-explicit-null", compactAttribution(throwingSampler), [[null, null]]);
check("invalid-sampler-recovers", compactAttribution(invalidSampler), [[null, null], [null, null], [100, 100]]);
check("decreasing-total-explicit-reset", compactAttribution(decreasingSampler),
  [[100, 100], [80, null], [95, 15]]);

// Required out-of-bounds damage and acknowledging null-sink attacks.
const damageRecords = [];
const damageBackend = new Backend(true);
const damageController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(damageBackend),
  onPresent: (record) => damageRecords.push(record),
  now: () => 42,
  guestInstructions: () => 100,
});
let damageRejected = false;
try { damageController.present(frame({ x: 1, y: 1, width: 2, height: 2 })); } catch { damageRejected = true; }
damageController.present(frame());
check("out-of-bounds-damage-rejected", damageRejected, true);
check("out-of-bounds-does-not-mutate-next-record",
  [damageBackend.presentCalls, damageRecords.length, damageRecords[0].sequence,
    damageRecords[0].bytes, damageController.snapshot().gpu.drawnPresents],
  [1, 1, 1, 16, 1]);

const nullRecords = [];
const nullBackend = new Backend(false);
const nullController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(nullBackend),
  onPresent: (record) => nullRecords.push(record),
  now: () => 43,
  guestInstructions: () => 100,
});
nullController.present(frame());
check("acknowledging-null-sink-not-drawn",
  [nullBackend.presentCalls, nullController.snapshot().gpu.successfulPresents,
    nullController.snapshot().gpu.drawnPresents, nullController.snapshot().gpu.drawnBytes,
    nullRecords[0].drawn],
  [1, 1, 0, 0, false]);

async function deterministicFixture(Controller) {
  const fixture = recordingController();
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const telemetry = [];
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(new Backend(true)),
    onPresent: (record) => telemetry.push(record),
    now: () => 15,
    guestInstructions: () => 100,
  });
  const events = [
    await input.moveAbsolute(100, 200),
    await input.leftButton(true),
    await input.leftButton(false),
    await input.key(30, true),
    await input.key(30, false),
  ];
  controller.present(frame());
  return JSON.stringify({ events, calls: fixture.calls, telemetry, gpu: controller.snapshot().gpu });
}
const fixtureBytes = [];
for (let repetition = 0; repetition < 5; repetition += 1) {
  fixtureBytes.push(await deterministicFixture(SourcePresentationController));
}
const distFixtureBytes = await deterministicFixture(DistPresentationController);
check("five-fixture-repetitions-byte-stable", new Set(fixtureBytes).size, 1);
check("source-dist-fixture-byte-parity", distFixtureBytes, fixtureBytes[0]);

const [jsProjection, tsProjection, sourcePresentation, distPresentation] = await Promise.all([
  readFile(new URL("../../../web/bench/desktop-perf-hooks.js", import.meta.url), "utf8"),
  readFile(new URL("../../../web/bench/desktop-perf-hooks.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../web/src/sink/presentation.js", import.meta.url), "utf8"),
  readFile(new URL("../../../web/dist/src/sink/presentation.js", import.meta.url), "utf8"),
]);
check("js-ts-projection-byte-parity", jsProjection, tsProjection);
check("source-dist-presentation-byte-parity", sourcePresentation, distPresentation);

const failures = checks.filter((entry) => !entry.held);
const output = {
  exactHead: "0da96f6a5c7f323b986fe41b6f6bfb2508eec834",
  summary: { totalChecks: checks.length, held: checks.length - failures.length, failed: failures.length },
  failures,
  checks,
  concurrentRuns,
  mixedBurst: { records: mixedRecords, calls: mixedFixture.calls },
  queueRecovery: {
    settled: recoverySettled.map((entry) => entry.status === "fulfilled"
      ? { status: entry.status, record: entry.value }
      : { status: entry.status, reason: String(entry.reason?.message || entry.reason) }),
    postDuplicate: recoveryDuplicate,
    calls: recoveryFixture.calls,
  },
  stateAttack: { records: stateRecords, calls: stateFixture.calls },
  attribution: {
    source100Then175: sourceAttribution,
    dist100Then175: distAttribution,
    retiredObject100Then175: retiredObjectAttribution,
    guestObject100Then175: guestObjectAttribution,
    missingSampler,
    nullSampler,
    throwingSampler,
    invalidSampler,
    decreasingSampler,
  },
  damageAttack: { records: damageRecords, gpu: damageController.snapshot().gpu },
  nullSinkAttack: { records: nullRecords, gpu: nullController.snapshot().gpu },
  fixture: { hashes: fixtureBytes.map(sha256), distHash: sha256(distFixtureBytes) },
};
await writeFile(new URL("independent-attack-results.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`);
const compact = {
  exactHead: output.exactHead,
  checkSummary: output.summary,
  failedPredictions: failures,
  delayedConcurrency: {
    repetitions: concurrentRuns.length,
    allCompleteFrames: checks
      .filter((entry) => entry.name.startsWith("concurrent-")).every((entry) => entry.held),
    ordersExercised: ["move-then-button", "button-then-move"],
    firstCalls: concurrentRuns[0].calls,
    secondCalls: concurrentRuns[1].calls,
  },
  mixedBurst: {
    sequences: mixedRecords.map((record) => record.sequence),
    calls: mixedFixture.calls,
  },
  queueRecovery: {
    statuses: recoverySettled.map((entry) => entry.status),
    fulfilledSequences: recoverySettled.slice(1).map((entry) => entry.value.sequence),
    postFailureState: [recoverySettled[1].value.noop, recoveryDuplicate.noop],
  },
  stateAndSequence: {
    sequences: stateRecords.map((record) => record.sequence),
    noops: stateRecords.slice(0, 10).map((record) => record.noop),
    unique: new Set(stateRecords.map((record) => record.sequence)).size === stateRecords.length,
  },
  attribution: {
    source100Then175: compactAttribution(sourceAttribution),
    dist100Then175: compactAttribution(distAttribution),
    retiredObject100Then175: compactAttribution(retiredObjectAttribution),
    guestObject100Then175: compactAttribution(guestObjectAttribution),
    missingSampler: compactAttribution(missingSampler),
    nullSampler: compactAttribution(nullSampler),
    throwingSampler: compactAttribution(throwingSampler),
    invalidSampler: compactAttribution(invalidSampler),
    decreasingSampler: compactAttribution(decreasingSampler),
  },
  damage: {
    backendCalls: damageBackend.presentCalls,
    records: damageRecords.length,
    nextSequence: damageRecords[0].sequence,
    nextBytes: damageRecords[0].bytes,
    drawnPresents: damageController.snapshot().gpu.drawnPresents,
  },
  nullSink: {
    backendCalls: nullBackend.presentCalls,
    successfulPresents: nullController.snapshot().gpu.successfulPresents,
    drawnPresents: nullController.snapshot().gpu.drawnPresents,
    drawnBytes: nullController.snapshot().gpu.drawnBytes,
    recordDrawn: nullRecords[0].drawn,
  },
  fixture: {
    fiveHashes: fixtureBytes.map(sha256),
    distHash: sha256(distFixtureBytes),
  },
  projections: {
    jsTsByteEqual: jsProjection === tsProjection,
    sourceDistPresentationByteEqual: sourcePresentation === distPresentation,
  },
};
await writeFile(new URL("independent-observations.json", import.meta.url),
  `${JSON.stringify(compact, null, 2)}\n`);
console.log(JSON.stringify(output.summary));
if (failures.length > 0) process.exitCode = 1;
