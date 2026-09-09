import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { createDesktopPerfInput } from "../../../web/bench/desktop-perf-hooks.js";
import { PresentationController as SourceController }
  from "../../../web/src/sink/presentation.js";
import { PresentationController as DistController }
  from "../../../web/dist/src/sink/presentation.js";

const exactHead = "a1c25437bed33910218eece228a77b230abfb8e9";
const checks = [];
function check(name, actual, expected) {
  const held = isDeepStrictEqual(actual, expected);
  checks.push({ name, held, actual, expected });
}

class Canvas {
  constructor() { this.width = 2; this.height = 2; }
  getContext() { return null; }
  addEventListener() {}
  removeEventListener() {}
}

class Backend {
  constructor(drawn = true) { this.drawn = drawn; this.calls = 0; }
  resize() {}
  present() { this.calls += 1; }
  drawsPixels() { return this.drawn; }
}

const factories = (backend) => ({ canvas2d: () => backend, webgl2: () => backend });
const frame = (rect = { x: 0, y: 0, width: 2, height: 2 }) => ({
  format: 1,
  rect,
  resourceWidth: 2,
  resourceHeight: 2,
  pixels: new Uint32Array(4).fill(0xff334455),
});

function attributionRun(Controller, samples) {
  let index = 0;
  const records = [];
  const backend = new Backend(true);
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(backend),
    now: () => 17,
    onPresent: (record) => records.push(record),
    guestInstructions: () => {
      const sample = samples[index++];
      if (sample?.kind === "callback-throw") throw new Error("sample unavailable");
      return sample?.kind === "factory" ? sample.make() : sample;
    },
  });
  const returns = samples.map(() => controller.present(frame()));
  const result = {
    attribution: records.map((record) => [record.guestInstructions, record.guestInstructionsTotal]),
    returns,
    backendCalls: backend.calls,
    gpu: controller.snapshot().gpu,
    errors: controller.snapshot().errors,
  };
  controller.dispose();
  return result;
}

const expectedRecovery = [[null, null], [100, 100], [75, 175]];
const invalidScalarCases = [
  ["null", null],
  ["undefined", undefined],
  ["numeric-string", "23"],
  ["boolean", true],
  ["nan", Number.NaN],
  ["positive-infinity", Number.POSITIVE_INFINITY],
  ["negative", -1],
  ["unsafe-integer", Number.MAX_SAFE_INTEGER + 1],
  ["boxed-number", new Number(23)],
  ["plain-object", {}],
];
const attribution = {};
for (const [name, value] of invalidScalarCases) {
  const result = attributionRun(SourceController, [value, 100, 175]);
  attribution[`scalar-${name}`] = result;
  check(`scalar-${name}-null-and-baseline-preserved`, result.attribution, expectedRecovery);
}

for (const key of ["retiredInstructions", "guestInstructions"]) {
  for (const [name, value] of invalidScalarCases.slice(0, 8)) {
    const result = attributionRun(SourceController, [{ [key]: value }, { [key]: 100 }, { [key]: 175 }]);
    attribution[`${key}-${name}`] = result;
    check(`${key}-${name}-null-and-baseline-preserved`, result.attribution, expectedRecovery);
  }
  const valid = attributionRun(SourceController, [{ [key]: 100 }, { [key]: 175 }]);
  attribution[`${key}-valid`] = valid;
  check(`${key}-valid-100-175`, valid.attribution, [[100, 100], [75, 175]]);
}

const callbackThrow = attributionRun(SourceController,
  [{ kind: "callback-throw" }, 100, 175]);
attribution.callbackThrow = callbackThrow;
check("callback-throw-null-and-baseline-preserved", callbackThrow.attribution, expectedRecovery);

const zero = attributionRun(SourceController, [0, 100, 175]);
attribution.zero = zero;
check("numeric-zero-is-valid", zero.attribution, [[0, 0], [100, 100], [75, 175]]);

const throwingGetter = attributionRun(SourceController, [{
  kind: "factory",
  make: () => Object.defineProperty({}, "retiredInstructions", {
    get() { throw new Error("hostile getter"); },
  }),
}, 100, 175]);
attribution.throwingGetter = throwingGetter;
check("throwing-getter-is-unavailable-and-recovers", throwingGetter.attribution, expectedRecovery);
check("throwing-getter-does-not-drop-present", throwingGetter.returns, [true, true, true]);

const nullPrototype = attributionRun(SourceController, [
  Object.assign(Object.create(null), { retiredInstructions: "100" }),
  Object.assign(Object.create(null), { retiredInstructions: 100 }),
  Object.assign(Object.create(null), { retiredInstructions: 175 }),
]);
attribution.nullPrototype = nullPrototype;
check("null-prototype-object-rejects-coercion", nullPrototype.attribution, expectedRecovery);

const conflictingFields = attributionRun(SourceController, [
  { retiredInstructions: "100", guestInstructions: 99 },
  { retiredInstructions: 100, guestInstructions: 7 },
  { retiredInstructions: 175, guestInstructions: 8 },
]);
attribution.conflictingFields = conflictingFields;
check("retired-field-precedence-does-not-coerce", conflictingFields.attribution, expectedRecovery);

const distRecovery = attributionRun(DistController, [null, 100, 175]);
attribution.distRecovery = distRecovery;
check("dist-unavailable-100-175", distRecovery.attribution, expectedRecovery);
check("source-dist-unavailable-byte-parity", JSON.stringify(attribution["scalar-null"]),
  JSON.stringify(distRecovery));

function recordingController({ failOnce = false, delay = false } = {}) {
  const calls = [];
  let shouldFail = failOnce;
  const call = (name) => async (...args) => {
    calls.push([name, ...args]);
    if (shouldFail && name === "sendTabletEvent" && args[0] === 1 && args[2] === 1) {
      shouldFail = false;
      throw new Error("injected operation failure");
    }
    if (delay) await new Promise((resolve) => setTimeout(resolve, 1));
  };
  return {
    calls,
    controller: {
      sendTabletEvent: call("sendTabletEvent"),
      syncTablet: call("syncTablet"),
      sendKeyboardEvent: call("sendKeyboardEvent"),
      syncKeyboard: call("syncKeyboard"),
    },
  };
}

const ordering = [];
for (let iteration = 0; iteration < 16; iteration += 1) {
  const fixture = recordingController({ delay: true });
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const moveFirst = iteration % 2 === 0;
  const pending = moveFirst
    ? [input.moveAbsolute(11, 12), input.leftButton(true)]
    : [input.leftButton(true), input.moveAbsolute(11, 12)];
  const records = await Promise.all(pending);
  const moveCalls = [
    ["sendTabletEvent", 3, 0, 11], ["sendTabletEvent", 3, 1, 12], ["syncTablet"],
  ];
  const buttonCalls = [["sendTabletEvent", 1, 0x110, 1], ["syncTablet"]];
  const expected = moveFirst ? [...moveCalls, ...buttonCalls] : [...buttonCalls, ...moveCalls];
  check(`delayed-order-${iteration}`, fixture.calls, expected);
  check(`delayed-sequences-${iteration}`, records.map((record) => record.sequence), [1, 2]);
  ordering.push({ iteration, moveFirst, calls: fixture.calls });
}

const recoveryFixture = recordingController({ failOnce: true, delay: true });
const recoveryInput = createDesktopPerfInput(recoveryFixture.controller, { enabled: true });
const recoverySettled = await Promise.allSettled([
  recoveryInput.leftButton(true), recoveryInput.leftButton(true), recoveryInput.key(30, true),
]);
check("rejected-operation-queue-recovers", recoverySettled.map((entry) => entry.status),
  ["rejected", "fulfilled", "fulfilled"]);
check("rejected-operation-keeps-unique-sequences",
  recoverySettled.slice(1).map((entry) => entry.value.sequence), [2, 3]);

const stateFixture = recordingController();
const stateInput = createDesktopPerfInput(stateFixture.controller, { enabled: true });
let invalidInputRejected = false;
try { stateInput.moveAbsolute(32768, 0); } catch { invalidInputRejected = true; }
const stateRecords = [
  await stateInput.leftButton(false), await stateInput.leftButton(true),
  await stateInput.leftButton(true), await stateInput.leftButton(false),
  await stateInput.leftButton(false), await stateInput.key(30, false),
  await stateInput.key(30, true), await stateInput.key(30, true),
  await stateInput.key(30, false), await stateInput.key(30, false),
];
check("invalid-input-rejected", invalidInputRejected, true);
check("stale-duplicate-noops", stateRecords.map((record) => record.noop),
  [true, false, true, false, true, true, false, true, false, true]);
check("state-sequences-stable", stateRecords.map((record) => record.sequence),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const damageBackend = new Backend(true);
const damageRecords = [];
const damageController = new SourceController(new Canvas(), {
  backendFactories: factories(damageBackend), onPresent: (record) => damageRecords.push(record),
  now: () => 19,
});
let invalidDamageRejected = false;
try { damageController.present(frame({ x: 1, y: 1, width: 2, height: 2 })); }
catch { invalidDamageRejected = true; }
damageController.present(frame());
check("invalid-damage-does-not-corrupt-next-present", [
  invalidDamageRejected, damageBackend.calls, damageRecords.length, damageRecords[0].sequence,
  damageRecords[0].bytes,
], [true, 1, 1, 1, 16]);

const nullBackend = new Backend(false);
const nullRecords = [];
const nullController = new SourceController(new Canvas(), {
  backendFactories: factories(nullBackend), onPresent: (record) => nullRecords.push(record),
});
nullController.present(frame());
check("null-sink-does-not-claim-draw", [
  nullBackend.calls, nullController.snapshot().gpu.successfulPresents,
  nullController.snapshot().gpu.drawnPresents, nullController.snapshot().gpu.drawnBytes,
  nullRecords[0].drawn,
], [1, 1, 0, 0, false]);

async function stableFixture(Controller) {
  const fixture = recordingController();
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const telemetry = [];
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(new Backend(true)), onPresent: (record) => telemetry.push(record),
    now: () => 23, guestInstructions: () => 100,
  });
  const events = [
    await input.moveAbsolute(100, 200), await input.leftButton(true),
    await input.leftButton(false), await input.key(30, true), await input.key(30, false),
  ];
  controller.present(frame());
  return JSON.stringify({ events, calls: fixture.calls, telemetry, gpu: controller.snapshot().gpu });
}
const fixtures = [];
for (let iteration = 0; iteration < 5; iteration += 1) fixtures.push(await stableFixture(SourceController));
const distFixture = await stableFixture(DistController);
check("five-records-byte-stable", new Set(fixtures).size, 1);
check("source-dist-schema-byte-parity", distFixture, fixtures[0]);

const failures = checks.filter((entry) => !entry.held);
const output = {
  exactHead,
  summary: { total: checks.length, held: checks.length - failures.length, failed: failures.length },
  failures,
  checks,
  attribution,
  ordering,
  queueRecovery: {
    statuses: recoverySettled.map((entry) => entry.status),
    sequences: recoverySettled.slice(1).map((entry) => entry.value.sequence),
    calls: recoveryFixture.calls,
  },
  stateAttack: { records: stateRecords, calls: stateFixture.calls },
  damageAttack: { records: damageRecords, gpu: damageController.snapshot().gpu },
  nullSinkAttack: { records: nullRecords, gpu: nullController.snapshot().gpu },
  fixtureHashes: fixtures.map((value) => createHash("sha256").update(value).digest("hex")),
  distFixtureHash: createHash("sha256").update(distFixture).digest("hex"),
};
await writeFile(new URL("attack-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output.summary));
if (failures.length) process.exitCode = 1;
