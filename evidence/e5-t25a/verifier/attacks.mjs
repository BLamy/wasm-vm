import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { createDesktopPerfInput } from "../../../web/bench/desktop-perf-hooks.js";
import { PresentationController } from "../../../web/src/sink/presentation.js";

const callsFor = () => {
  const calls = [];
  const controller = {};
  for (const name of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
    controller[name] = (...args) => calls.push([name, ...args]);
  }
  return { controller, calls };
};

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

const frame = (rect = { x: 0, y: 0, width: 2, height: 2 }) => ({
  format: 1,
  rect,
  resourceWidth: 2,
  resourceHeight: 2,
  pixels: new Uint32Array(4).fill(0xff112233),
});

const invalidFixture = callsFor();
const invalidInput = createDesktopPerfInput(invalidFixture.controller, { enabled: true });
assert.throws(() => invalidInput.leftButton(1), /must be boolean/);
assert.throws(() => invalidInput.button(0x1_0000, true), /button code must be/);
assert.throws(() => createDesktopPerfInput({}, { enabled: true }), /requires sendTabletEvent/);

const genericButtonFixture = callsFor();
const genericButtonInput = createDesktopPerfInput(genericButtonFixture.controller, { enabled: true });
const genericButtonRecords = [
  await genericButtonInput.button(0x111, false),
  await genericButtonInput.button(0x111, true),
  await genericButtonInput.button(0x111, true),
  await genericButtonInput.button(0x111, false),
];
assert.deepEqual(genericButtonRecords.map(({ sequence, noop }) => ({ sequence, noop })), [
  { sequence: 1, noop: true }, { sequence: 2, noop: false },
  { sequence: 3, noop: true }, { sequence: 4, noop: false },
]);

const stateFixture = callsFor();
const input = createDesktopPerfInput(stateFixture.controller, { enabled: true });
const stateRecords = [
  await input.leftButton(false),
  await input.leftButton(true),
  await input.leftButton(true),
  await input.leftButton(false),
  await input.leftButton(false),
  await input.key(30, false),
  await input.key(30, true),
  await input.key(30, true),
  await input.key(30, false),
  await input.moveAbsolute(7, 9),
];
assert.deepEqual(stateRecords.map((record) => record.sequence), [1,2,3,4,5,6,7,8,9,10]);
assert.deepEqual(stateRecords.map((record) => record.noop), [true,false,true,false,true,true,false,true,false,false]);
assert.deepEqual(stateFixture.calls, [
  ["sendTabletEvent", 1, 0x110, 1], ["syncTablet"],
  ["sendTabletEvent", 1, 0x110, 0], ["syncTablet"],
  ["sendKeyboardEvent", 1, 30, 1], ["syncKeyboard"],
  ["sendKeyboardEvent", 1, 30, 0], ["syncKeyboard"],
  ["sendTabletEvent", 3, 0, 7], ["sendTabletEvent", 3, 1, 9], ["syncTablet"],
]);

const damageRecords = [];
const damageBackend = new Backend(true);
const damageController = new PresentationController(new Canvas(), {
  backendFactories: { canvas2d: () => damageBackend, webgl2: () => damageBackend },
  onPresent: (record) => damageRecords.push(record),
  now: () => 42,
});
assert.throws(
  () => damageController.present(frame({ x: 1, y: 1, width: 2, height: 2 })),
  /outside the resource/,
);
assert.equal(damageBackend.presentCalls, 0);
assert.deepEqual(damageRecords, []);
assert.equal(damageController.present(frame()), true);
assert.equal(damageBackend.presentCalls, 1);
assert.equal(damageRecords[0].sequence, 1);
assert.deepEqual(damageController.snapshot().gpu, {
  framesReceived: 1, enqueued: 1, coalesced: 0, presented: 1,
  successfulPresents: 1, skipped: 0, droppedFrames: 0, overruns: 0,
  pending: 0, maxPending: 0, uploadedBytes: 16, drawnPresents: 1,
  drawnBytes: 16, width: 2, height: 2,
});

const nullRecords = [];
const nullBackend = new Backend(false);
const nullController = new PresentationController(new Canvas(), {
  backendFactories: { canvas2d: () => nullBackend, webgl2: () => nullBackend },
  onPresent: (record) => nullRecords.push(record),
  now: () => 43,
});
assert.equal(nullController.present(frame()), true);
assert.equal(nullBackend.presentCalls, 1);
assert.equal(nullController.snapshot().gpu.successfulPresents, 1);
assert.equal(nullController.snapshot().gpu.drawnPresents, 0);
assert.equal(nullController.snapshot().gpu.drawnBytes, 0);
assert.equal(nullRecords[0].drawn, false);

const interleavedCalls = [];
const asyncController = {
  async sendTabletEvent(...args) {
    interleavedCalls.push(["sendTabletEvent", ...args]);
    if (args[0] === 3 && args[1] === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  },
  async syncTablet() { interleavedCalls.push(["syncTablet"]); },
  async sendKeyboardEvent(...args) { interleavedCalls.push(["sendKeyboardEvent", ...args]); },
  async syncKeyboard() { interleavedCalls.push(["syncKeyboard"]); },
};
const concurrentInput = createDesktopPerfInput(asyncController, { enabled: true });
const [moveRecord, pressRecord] = await Promise.all([
  concurrentInput.moveAbsolute(11, 12),
  concurrentInput.leftButton(true),
]);
const expectedSerializedCalls = [
  ["sendTabletEvent", 3, 0, 11], ["sendTabletEvent", 3, 1, 12], ["syncTablet"],
  ["sendTabletEvent", 1, 0x110, 1], ["syncTablet"],
];
const concurrencyHeld = JSON.stringify(interleavedCalls) === JSON.stringify(expectedSerializedCalls);

const browserEvidence = JSON.parse(await readFile(new URL("fresh-browser/results.json", import.meta.url), "utf8"));
const parityFixture = callsFor();
const parityNodeRecord = await createDesktopPerfInput(parityFixture.controller, { enabled: true }).moveAbsolute(4, 5);
const nodeBytes = JSON.stringify(parityNodeRecord);
const browserBytes = browserEvidence.browsers.map((entry) => JSON.stringify(entry.hookRecord));
assert.ok(browserBytes.every((value) => value === nodeBytes));

const repetitionBytes = [];
for (let repetition = 0; repetition < 5; repetition += 1) {
  const fixture = callsFor();
  const fixtureInput = createDesktopPerfInput(fixture.controller, { enabled: true });
  const telemetry = [];
  const fixtureBackend = new Backend(true);
  const presentController = new PresentationController(new Canvas(), {
    backendFactories: { canvas2d: () => fixtureBackend, webgl2: () => fixtureBackend },
    onPresent: (record) => telemetry.push(record),
    now: () => 15,
  });
  const events = [
    await fixtureInput.moveAbsolute(100, 200),
    await fixtureInput.leftButton(true),
    await fixtureInput.leftButton(false),
    await fixtureInput.key(30, true),
    await fixtureInput.key(30, false),
  ];
  presentController.present(frame());
  repetitionBytes.push(JSON.stringify({
    events,
    calls: fixture.calls,
    telemetry,
    gpu: presentController.snapshot().gpu,
  }));
}
assert.equal(new Set(repetitionBytes).size, 1);

const output = {
  exactHead: "fc7bfdf5e6aa503e853ab85e48d4ea656dbede77",
  stateAttack: {
    sequences: stateRecords.map((record) => record.sequence),
    noop: stateRecords.map((record) => record.noop),
    calls: stateFixture.calls,
  },
  genericButtonAttack: { records: genericButtonRecords, calls: genericButtonFixture.calls },
  damageAttack: { records: damageRecords, gpu: damageController.snapshot().gpu },
  nullSinkAttack: { records: nullRecords, gpu: nullController.snapshot().gpu },
  schemaParity: {
    nodeBytes,
    browserBytes,
    sha256: createHash("sha256").update(nodeBytes).digest("hex"),
  },
  fiveRepetitions: {
    allByteEqual: true,
    sha256: repetitionBytes.map((bytes) => createHash("sha256").update(bytes).digest("hex")),
    bytes: repetitionBytes[0],
  },
  concurrencyAttack: {
    records: [moveRecord, pressRecord],
    observedCalls: interleavedCalls,
    expectedSerializedCalls,
    held: concurrencyHeld,
  },
};
await writeFile(new URL("attack-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  state: "held",
  damage: "held",
  nullSink: "held",
  schemaParity: "held",
  concurrency: concurrencyHeld ? "held" : "failed",
}));
