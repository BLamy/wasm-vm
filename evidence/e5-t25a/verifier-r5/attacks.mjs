import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { createDesktopPerfInput } from "../../../web/bench/desktop-perf-hooks.js";
import { PresentationController as SourceController }
  from "../../../web/src/sink/presentation.js";
import { PresentationController as DistController }
  from "../../../web/dist/src/sink/presentation.js";

const exactHead = "57c2cc828c151c830ebd7a377dc29d7bf898566d";
const checks = [];
function check(name, actual, expected) {
  checks.push({ name, held: isDeepStrictEqual(actual, expected), actual, expected });
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
  format: 1, rect, resourceWidth: 2, resourceHeight: 2,
  pixels: new Uint32Array(4).fill(0xff334455),
});

function attributionRun(Controller, samples) {
  let index = 0;
  const records = [];
  const backend = new Backend(true);
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(backend), now: () => 17,
    onPresent: (record) => records.push(record),
    guestInstructions: () => {
      const sample = samples[index++];
      if (sample?.kind === "throw") throw sample.value;
      return sample?.kind === "factory" ? sample.make() : sample;
    },
  });
  const returns = samples.map(() => {
    try { return controller.present(frame()); } catch (error) { return `threw:${error}`; }
  });
  const snapshot = controller.snapshot();
  const result = {
    attribution: records.map((record) =>
      [record.guestInstructions, record.guestInstructionsTotal]),
    returns, backendCalls: backend.calls, gpu: snapshot.gpu, errors: snapshot.errors,
  };
  controller.dispose();
  return result;
}

const expectedRecovery = [[null, null], [100, 100], [75, 175]];
const expectedPreservedBaseline = [[40, 40], [null, null], [60, 100], [75, 175]];
const invalidValues = [
  ["null", null], ["undefined", undefined], ["string", "100"], ["boolean", true],
  ["nan", NaN], ["infinity", Infinity], ["negative", -1],
  ["unsafe", Number.MAX_SAFE_INTEGER + 1], ["boxed", new Number(100)],
  ["coercible", { valueOf: () => 100, toString: () => "100" }],
];
const attribution = {};
for (const [surface, Controller] of [["source", SourceController], ["dist", DistController]]) {
  for (const [name, value] of invalidValues) {
    const scalar = attributionRun(Controller, [value, 100, 175]);
    attribution[`${surface}-scalar-${name}`] = scalar;
    check(`${surface}-scalar-${name}-rejects-without-baseline-change`,
      scalar.attribution, expectedRecovery);
    for (const key of ["retiredInstructions", "guestInstructions"]) {
      const objectForm = attributionRun(Controller,
        [{ [key]: value }, { [key]: 100 }, { [key]: 175 }]);
      attribution[`${surface}-${key}-${name}`] = objectForm;
      check(`${surface}-${key}-${name}-rejects-without-baseline-change`,
        objectForm.attribution, expectedRecovery);
    }
  }

  const normalError = attributionRun(Controller,
    [40, { kind: "throw", value: new Error("ordinary callback error") }, 100, 175]);
  attribution[`${surface}-normal-error`] = normalError;
  check(`${surface}-normal-error-contained`, [normalError.attribution, normalError.returns,
    normalError.backendCalls, normalError.gpu.successfulPresents, normalError.gpu.drawnPresents,
    normalError.gpu.droppedFrames, normalError.errors.some((v) =>
      v.includes("ordinary callback error"))],
  [expectedPreservedBaseline, [true, true, true, true], 4, 4, 4, 0, true]);

  const getterError = attributionRun(Controller, [40, { kind: "factory", make: () =>
    Object.defineProperty({}, "retiredInstructions", {
      get() { throw new Error("hostile retired getter"); },
    }) }, 100, 175]);
  attribution[`${surface}-retired-getter`] = getterError;
  check(`${surface}-retired-getter-contained`, [getterError.attribution, getterError.returns,
    getterError.gpu.successfulPresents, getterError.gpu.drawnPresents,
    getterError.gpu.droppedFrames, getterError.errors.some((v) =>
      v.includes("hostile retired getter"))],
  [expectedPreservedBaseline, [true, true, true, true], 4, 4, 0, true]);

  const fallbackError = attributionRun(Controller, [40, { kind: "factory", make: () =>
    Object.defineProperties({}, {
      retiredInstructions: { value: null },
      guestInstructions: { get() { throw new Error("hostile fallback getter"); } },
    }) }, 100, 175]);
  attribution[`${surface}-fallback-getter`] = fallbackError;
  check(`${surface}-fallback-getter-contained`, [fallbackError.attribution,
    fallbackError.returns, fallbackError.gpu.droppedFrames,
    fallbackError.errors.some((v) => v.includes("hostile fallback getter"))],
  [expectedPreservedBaseline, [true, true, true, true], 0, true]);

  const hostileMessage = Object.defineProperty({}, "message", {
    get() { throw new Error("hostile message getter"); },
  });
  const messageError = attributionRun(Controller,
    [40, { kind: "throw", value: hostileMessage }, 100, 175]);
  attribution[`${surface}-hostile-message`] = messageError;
  check(`${surface}-hostile-message-contained`, [messageError.attribution,
    messageError.returns, messageError.gpu.successfulPresents,
    messageError.gpu.drawnPresents, messageError.gpu.droppedFrames,
    messageError.errors.length > 0,
    messageError.errors.every((v) => typeof v === "string")],
  [expectedPreservedBaseline, [true, true, true, true], 4, 4, 0, true, true]);

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const revokedProxy = attributionRun(Controller,
    [40, { kind: "throw", value: proxy }, 100, 175]);
  attribution[`${surface}-revoked-proxy`] = revokedProxy;
  check(`${surface}-revoked-proxy-novel-diagnostic-contained`, [revokedProxy.attribution,
    revokedProxy.returns, revokedProxy.gpu.successfulPresents,
    revokedProxy.gpu.drawnPresents, revokedProxy.gpu.droppedFrames,
    revokedProxy.errors, revokedProxy.errors.every((v) => typeof v === "string")],
  [expectedPreservedBaseline, [true, true, true, true], 4, 4, 0,
    ["guest instruction telemetry: unavailable"], true]);
}

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
  return { calls, controller: {
    sendTabletEvent: call("sendTabletEvent"), syncTablet: call("syncTablet"),
    sendKeyboardEvent: call("sendKeyboardEvent"), syncKeyboard: call("syncKeyboard"),
  } };
}

const ordering = [];
for (let iteration = 0; iteration < 24; iteration += 1) {
  const fixture = recordingController({ delay: true });
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const moveFirst = iteration % 2 === 0;
  const records = await Promise.all(moveFirst
    ? [input.moveAbsolute(11, 12), input.leftButton(true)]
    : [input.leftButton(true), input.moveAbsolute(11, 12)]);
  const move = [["sendTabletEvent", 3, 0, 11], ["sendTabletEvent", 3, 1, 12],
    ["syncTablet"]];
  const button = [["sendTabletEvent", 1, 0x110, 1], ["syncTablet"]];
  check(`delayed-order-${iteration}`, fixture.calls,
    moveFirst ? [...move, ...button] : [...button, ...move]);
  check(`delayed-sequences-${iteration}`, records.map((v) => v.sequence), [1, 2]);
  ordering.push({ iteration, moveFirst, calls: fixture.calls });
}

const recoveryFixture = recordingController({ failOnce: true, delay: true });
const recoveryInput = createDesktopPerfInput(recoveryFixture.controller, { enabled: true });
const recovery = await Promise.allSettled([
  recoveryInput.leftButton(true), recoveryInput.leftButton(true), recoveryInput.key(30, true),
]);
check("rejected-queue-recovers", recovery.map((v) => v.status),
  ["rejected", "fulfilled", "fulfilled"]);
check("rejected-queue-keeps-unique-sequences", recovery.slice(1).map((v) => v.value.sequence),
  [2, 3]);

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
check("stale-duplicate-noops", stateRecords.map((v) => v.noop),
  [true, false, true, false, true, true, false, true, false, true]);
check("state-sequences-stable", stateRecords.map((v) => v.sequence),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const damageBackend = new Backend(true);
const damageRecords = [];
const damageController = new SourceController(new Canvas(), {
  backendFactories: factories(damageBackend), onPresent: (v) => damageRecords.push(v), now: () => 19,
});
let invalidDamageRejected = false;
try { damageController.present(frame({ x: 1, y: 1, width: 2, height: 2 })); }
catch { invalidDamageRejected = true; }
damageController.present(frame());
check("invalid-damage-leaves-next-valid-present-intact", [invalidDamageRejected,
  damageBackend.calls, damageRecords.length, damageRecords[0].sequence, damageRecords[0].bytes],
[true, 1, 1, 1, 16]);

const nullBackend = new Backend(false);
const nullRecords = [];
const nullController = new SourceController(new Canvas(), {
  backendFactories: factories(nullBackend), onPresent: (v) => nullRecords.push(v),
});
nullController.present(frame());
check("null-sink-does-not-claim-draw", [nullBackend.calls,
  nullController.snapshot().gpu.successfulPresents,
  nullController.snapshot().gpu.drawnPresents, nullController.snapshot().gpu.drawnBytes,
  nullRecords[0].drawn], [1, 1, 0, 0, false]);

async function stableFixture(Controller) {
  const fixture = recordingController();
  const input = createDesktopPerfInput(fixture.controller, { enabled: true });
  const telemetry = [];
  const controller = new Controller(new Canvas(), {
    backendFactories: factories(new Backend(true)), onPresent: (v) => telemetry.push(v),
    now: () => 23, guestInstructions: () => 100,
  });
  const events = [await input.moveAbsolute(100, 200), await input.leftButton(true),
    await input.leftButton(false), await input.key(30, true), await input.key(30, false)];
  controller.present(frame());
  return JSON.stringify({ events, calls: fixture.calls, telemetry, gpu: controller.snapshot().gpu });
}
const fixtures = [];
for (let i = 0; i < 5; i += 1) fixtures.push(await stableFixture(SourceController));
const distFixture = await stableFixture(DistController);
check("five-fixtures-byte-stable", new Set(fixtures).size, 1);
check("source-dist-schema-byte-parity", distFixture, fixtures[0]);

const failures = checks.filter((entry) => !entry.held);
const output = {
  exactHead,
  summary: { total: checks.length, held: checks.length - failures.length, failed: failures.length },
  failures, checks, attribution, ordering,
  queueRecovery: { statuses: recovery.map((v) => v.status),
    sequences: recovery.slice(1).map((v) => v.value.sequence), calls: recoveryFixture.calls },
  stateAttack: { records: stateRecords, calls: stateFixture.calls },
  damageAttack: { records: damageRecords, gpu: damageController.snapshot().gpu },
  nullSinkAttack: { records: nullRecords, gpu: nullController.snapshot().gpu },
  fixtureHashes: fixtures.map((value) => createHash("sha256").update(value).digest("hex")),
  distFixtureHash: createHash("sha256").update(distFixture).digest("hex"),
};
await writeFile(new URL("attack-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output.summary));
if (failures.length) process.exitCode = 1;
