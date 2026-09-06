import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { createDesktopPerfInput } from "../../../web/bench/desktop-perf-hooks.js";
import { PresentationController as SourcePresentationController }
  from "../../../web/src/sink/presentation.js";
import { PresentationController as DistPresentationController }
  from "../../../web/dist/src/sink/presentation.js";

const exactHead = "0da96f6a5c7f323b986fe41b6f6bfb2508eec834";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recordingController(overrides = {}) {
  const calls = [];
  const controller = {};
  for (const name of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
    controller[name] = async (...args) => {
      calls.push([name, ...args]);
      return await overrides[name]?.(...args);
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
  constructor(drawn) { this.drawn = drawn; this.presentCalls = 0; }
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
  pixels: new Uint32Array(4).fill(0xff112233),
});

const expectedConcurrentCalls = [
  ["sendTabletEvent", 3, 0, 11],
  ["sendTabletEvent", 3, 1, 12],
  ["syncTablet"],
  ["sendTabletEvent", 1, 0x110, 1],
  ["syncTablet"],
];
const concurrencyRuns = [];
for (let repetition = 0; repetition < 25; repetition += 1) {
  const fixture = recordingController({
    sendTabletEvent: async (eventType, code) => {
      if (eventType === 3 && code === 0) await delay(1 + (repetition % 5));
      else await Promise.resolve();
    },
    syncTablet: async () => { await Promise.resolve(); },
  });
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const [move, button] = await Promise.all([
    input.moveAbsolute(11, 12),
    input.leftButton(true),
  ]);
  const held = JSON.stringify(fixture.calls) === JSON.stringify(expectedConcurrentCalls)
    && move.sequence === 1 && button.sequence === 2;
  assert.equal(held, true);
  concurrencyRuns.push({ repetition, held, sequences: [move.sequence, button.sequence], calls: fixture.calls });
}

const stateFixture = recordingController();
const stateInput = createDesktopPerfInput(stateFixture.controller, { enabled: true });
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
];
assert.throws(() => stateInput.moveAbsolute(32768, 0), /x must be/);
const postInvalidMove = await stateInput.moveAbsolute(7, 9);
assert.deepEqual(stateRecords.map((record) => record.sequence), [1,2,3,4,5,6,7,8,9,10]);
assert.deepEqual(stateRecords.map((record) => record.noop), [true,false,true,false,true,true,false,true,false,true]);
assert.equal(postInvalidMove.sequence, 11);
assert.equal(new Set([...stateRecords, postInvalidMove].map((record) => record.sequence)).size, 11);
assert.deepEqual(stateFixture.calls, [
  ["sendTabletEvent", 1, 0x110, 1], ["syncTablet"],
  ["sendTabletEvent", 1, 0x110, 0], ["syncTablet"],
  ["sendKeyboardEvent", 1, 30, 1], ["syncKeyboard"],
  ["sendKeyboardEvent", 1, 30, 0], ["syncKeyboard"],
  ["sendTabletEvent", 3, 0, 7], ["sendTabletEvent", 3, 1, 9], ["syncTablet"],
]);

function attributionRun(Controller) {
  const records = [];
  const backend = new Backend(true);
  let total = 100;
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(backend),
    onPresent: (record) => records.push(record),
    now: () => 15,
    guestInstructions: () => total,
  });
  assert.equal(controller.present(frame()), true);
  total = 175;
  assert.equal(controller.present(frame()), true);
  assert.deepEqual(records.map((record) => [record.guestInstructions, record.guestInstructionsTotal]), [
    [100, 100], [75, 175],
  ]);
  return { records, gpu: controller.snapshot().gpu, backendCalls: backend.presentCalls };
}
const sourceAttribution = attributionRun(SourcePresentationController);
const distAttribution = attributionRun(DistPresentationController);
assert.equal(JSON.stringify(sourceAttribution), JSON.stringify(distAttribution));

const objectRecords = [];
const objectTotals = [{ retiredInstructions: 100 }, { retiredInstructions: 175 }];
const objectController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(new Backend(true)),
  onPresent: (record) => objectRecords.push(record),
  now: () => 16,
  guestInstructions: () => objectTotals.shift(),
});
objectController.present(frame());
objectController.present(frame());
assert.deepEqual(objectRecords.map((record) => [record.guestInstructions, record.guestInstructionsTotal]), [
  [100, 100], [75, 175],
]);

const noSourceRecords = [];
const noSourceController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(new Backend(true)),
  onPresent: (record) => noSourceRecords.push(record),
  now: () => 17,
});
noSourceController.present(frame());
assert.deepEqual(
  [noSourceRecords[0].guestInstructions, noSourceRecords[0].guestInstructionsTotal],
  [null, null],
);

const unavailableRecords = [];
const unavailableController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(new Backend(true)),
  onPresent: (record) => unavailableRecords.push(record),
  now: () => 18,
  guestInstructions: () => null,
});
unavailableController.present(frame());
const unavailableExplicit = unavailableRecords[0].guestInstructions === null
  && unavailableRecords[0].guestInstructionsTotal === null;

function attributionEdge(source) {
  const records = [];
  const controller = new SourcePresentationController(new Canvas(), {
    backendFactories: factories(new Backend(true)),
    onPresent: (record) => records.push(record),
    now: () => 19,
    guestInstructions: source,
  });
  controller.present(frame());
  return { record: records[0], errors: controller.snapshot().errors };
}
const negativeAttribution = attributionEdge(() => -1);
assert.deepEqual(
  [negativeAttribution.record.guestInstructions, negativeAttribution.record.guestInstructionsTotal],
  [null, null],
);
const throwingAttribution = attributionEdge(() => { throw new Error("injected attribution failure"); });
assert.deepEqual(
  [throwingAttribution.record.guestInstructions, throwingAttribution.record.guestInstructionsTotal],
  [null, null],
);
assert.deepEqual(throwingAttribution.errors, ["guest instruction telemetry: injected attribution failure"]);
const regressionRecords = [];
const regressionTotals = [175, 100];
const regressionController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(new Backend(true)),
  onPresent: (record) => regressionRecords.push(record),
  now: () => 20,
  guestInstructions: () => regressionTotals.shift(),
});
regressionController.present(frame());
regressionController.present(frame());
assert.deepEqual(regressionRecords.map((record) => [record.guestInstructions, record.guestInstructionsTotal]), [
  [175, 175], [null, 100],
]);

const damageRecords = [];
const damageBackend = new Backend(true);
let damageTotal = 100;
const damageController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(damageBackend),
  onPresent: (record) => damageRecords.push(record),
  now: () => 42,
  guestInstructions: () => damageTotal,
});
assert.throws(
  () => damageController.present(frame({ x: 1, y: 1, width: 2, height: 2 })),
  /outside the resource/,
);
assert.equal(damageBackend.presentCalls, 0);
assert.deepEqual(damageRecords, []);
assert.equal(damageController.present(frame()), true);
assert.equal(damageRecords[0].sequence, 1);
assert.equal(damageRecords[0].guestInstructions, 100);
assert.deepEqual(damageController.snapshot().gpu, {
  framesReceived: 1, enqueued: 1, coalesced: 0, presented: 1,
  successfulPresents: 1, skipped: 0, droppedFrames: 0, overruns: 0,
  pending: 0, maxPending: 0, uploadedBytes: 16, drawnPresents: 1,
  drawnBytes: 16, width: 2, height: 2,
});

const nullRecords = [];
const nullBackend = new Backend(false);
const nullController = new SourcePresentationController(new Canvas(), {
  backendFactories: factories(nullBackend),
  onPresent: (record) => nullRecords.push(record),
  now: () => 43,
  guestInstructions: () => 100,
});
assert.equal(nullController.present(frame()), true);
assert.equal(nullBackend.presentCalls, 1);
assert.equal(nullController.snapshot().gpu.successfulPresents, 1);
assert.equal(nullController.snapshot().gpu.drawnPresents, 0);
assert.equal(nullController.snapshot().gpu.drawnBytes, 0);
assert.equal(nullRecords[0].drawn, false);

async function deterministicFixture(Controller) {
  const inputFixture = recordingController();
  const input = createDesktopPerfInput(inputFixture.controller, { enabled: true });
  const telemetry = [];
  const backend = new Backend(true);
  const presentation = new Controller(new Canvas(), {
    backendFactories: factories(backend),
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
  presentation.present(frame());
  return JSON.stringify({ events, calls: inputFixture.calls, telemetry, gpu: presentation.snapshot().gpu });
}
const repetitions = [];
for (let index = 0; index < 5; index += 1) {
  repetitions.push(await deterministicFixture(SourcePresentationController));
}
assert.equal(new Set(repetitions).size, 1);
const distFixture = await deterministicFixture(DistPresentationController);
assert.equal(distFixture, repetitions[0]);

let rejectFirstPress = true;
const recoveryFixture = recordingController({
  sendTabletEvent: async (eventType, code, value) => {
    if (rejectFirstPress && eventType === 1 && code === 0x110 && value === 1) {
      rejectFirstPress = false;
      throw new Error("injected first press failure");
    }
    await Promise.resolve();
  },
  syncTablet: async () => { await Promise.resolve(); },
  sendKeyboardEvent: async () => { await Promise.resolve(); },
  syncKeyboard: async () => { await Promise.resolve(); },
});
const recoveryInput = createDesktopPerfInput(recoveryFixture.controller, { enabled: true });
const recoverySettled = await Promise.allSettled([
  recoveryInput.leftButton(true),
  recoveryInput.leftButton(true),
  recoveryInput.key(30, true),
]);
assert.equal(recoverySettled[0].status, "rejected");
assert.equal(recoverySettled[1].status, "fulfilled");
assert.equal(recoverySettled[1].value.sequence, 2);
assert.equal(recoverySettled[1].value.noop, false);
assert.equal(recoverySettled[2].status, "fulfilled");
assert.equal(recoverySettled[2].value.sequence, 3);
const postRecoveryDuplicate = await recoveryInput.leftButton(true);
assert.equal(postRecoveryDuplicate.sequence, 4);
assert.equal(postRecoveryDuplicate.noop, true);
assert.deepEqual(recoveryFixture.calls, [
  ["sendTabletEvent", 1, 0x110, 1],
  ["sendTabletEvent", 1, 0x110, 1], ["syncTablet"],
  ["sendKeyboardEvent", 1, 30, 1], ["syncKeyboard"],
]);

const jsProjection = await readFile(new URL("../../../web/bench/desktop-perf-hooks.js", import.meta.url), "utf8");
const tsProjection = await readFile(new URL("../../../web/bench/desktop-perf-hooks.ts", import.meta.url), "utf8");
assert.equal(jsProjection, tsProjection);

const output = {
  exactHead,
  delayedConcurrentAttack: {
    repetitions: concurrencyRuns.length,
    allHeld: concurrencyRuns.every((entry) => entry.held),
    expectedCalls: expectedConcurrentCalls,
    traceHashes: concurrencyRuns.map((entry) => sha256(JSON.stringify(entry.calls))),
    firstRun: concurrencyRuns[0],
    lastRun: concurrencyRuns.at(-1),
  },
  stateAndSequenceAttack: {
    records: [...stateRecords, postInvalidMove],
    calls: stateFixture.calls,
    uniqueSequences: true,
    invalidInputConsumedSequence: false,
  },
  guestAttribution: {
    source: sourceAttribution,
    dist: distAttribution,
    sourceDistByteEqual: JSON.stringify(sourceAttribution) === JSON.stringify(distAttribution),
    objectSourceRecords: objectRecords,
    noSourceRecord: noSourceRecords[0],
    unavailableCallbackRecord: unavailableRecords[0],
    unavailableExplicit,
    negativeAttribution,
    throwingAttribution,
    regressionRecords,
  },
  damageAttack: { records: damageRecords, gpu: damageController.snapshot().gpu },
  nullSinkAttack: { records: nullRecords, gpu: nullController.snapshot().gpu },
  fiveRepetitions: {
    allByteEqual: new Set(repetitions).size === 1,
    sha256: repetitions.map(sha256),
    bytes: repetitions[0],
    distByteEqual: distFixture === repetitions[0],
  },
  queueRecoveryAttack: {
    settled: recoverySettled.map((entry) => entry.status === "fulfilled"
      ? { status: entry.status, record: entry.value }
      : { status: entry.status, reason: String(entry.reason?.message || entry.reason) }),
    postRecoveryDuplicate,
    calls: recoveryFixture.calls,
    held: true,
  },
  jsTsByteEqual: jsProjection === tsProjection,
};
await writeFile(new URL("attack-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  concurrency: "held",
  attribution100Then175: "held",
  unavailableExplicit: unavailableExplicit ? "held" : "failed",
  stateAndSequence: "held",
  damage: "held",
  nullSink: "held",
  fiveRepetitions: "held",
  queueRecovery: "held",
}));
