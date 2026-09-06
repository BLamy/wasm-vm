// E5-T25a — explicit perf input gate and drawn-present telemetry.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDesktopPerfInput } from "../bench/desktop-perf-hooks.js";
import { PresentationController } from "../src/sink/presentation.js";

function fakeController() {
  const calls = [];
  const controller = {};
  for (const name of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
    controller[name] = (...args) => { calls.push([name, ...args]); };
  }
  return { controller, calls };
}

class Canvas {
  constructor() { this.width = 2; this.height = 2; this.listeners = new Map(); }
  getContext() { return null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener() {}
}

class Backend {
  constructor(canvas, drawn = true) { this.canvas = canvas; this.width = 2; this.height = 2; this.drawn = drawn; }
  resize(width, height) { this.width = width; this.height = height; }
  present() {}
  drawsPixels() { return this.drawn; }
}

function factories(drawn = true) {
  return {
    canvas2d: (canvas) => new Backend(canvas, drawn),
    webgl2: (canvas) => new Backend(canvas, drawn),
  };
}

function frame() {
  return { format: 1, rect: { x: 0, y: 0, width: 2, height: 2 }, resourceWidth: 2, resourceHeight: 2,
    pixels: new Uint32Array(4).fill(0xff112233) };
}

test("perf input is opt-in and emits bounded ordered evdev frames", async () => {
  const { controller, calls } = fakeController();
  assert.throws(() => createDesktopPerfInput(controller), /disabled/);
  const input = createDesktopPerfInput(controller, { enabled: true });
  assert.deepEqual(await input.moveAbsolute(10, 20), {
    version: "e5-t25a-v1", sequence: 1, device: "tablet", sync: "SYN_REPORT",
    noop: false,
    events: [{ eventType: 3, code: 0, value: 10 }, { eventType: 3, code: 1, value: 20 }],
  });
  assert.deepEqual(await input.leftButton(true), {
    version: "e5-t25a-v1", sequence: 2, device: "tablet", sync: "SYN_REPORT",
    noop: false,
    events: [{ eventType: 1, code: 0x110, value: 1 }],
  });
  assert.deepEqual(await input.key(30, true), {
    version: "e5-t25a-v1", sequence: 3, device: "keyboard", sync: "SYN_REPORT",
    noop: false,
    events: [{ eventType: 1, code: 30, value: 1 }],
  });
  assert.deepEqual(calls, [
    ["sendTabletEvent", 3, 0, 10], ["sendTabletEvent", 3, 1, 20], ["syncTablet"],
    ["sendTabletEvent", 1, 0x110, 1], ["syncTablet"],
    ["sendKeyboardEvent", 1, 30, 1], ["syncKeyboard"],
  ]);
  assert.throws(() => input.moveAbsolute(32768, 0), /x must be/);
  const staleRelease = await createDesktopPerfInput(fakeController().controller, { enabled: true }).leftButton(false);
  assert.deepEqual(staleRelease, {
    version: "e5-t25a-v1", sequence: 1, device: "tablet", sync: "SYN_REPORT", noop: true, events: [],
  });

  const repetitions = [];
  for (let repetition = 0; repetition < 5; repetition += 1) {
    const fixture = fakeController();
    const fixtureInput = createDesktopPerfInput(fixture.controller, { enabled: true });
    const telemetry = [];
    const presentController = new PresentationController(new Canvas(), {
      backendFactories: factories(true),
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
    repetitions.push({ events, calls: fixture.calls, telemetry, gpu: presentController.snapshot().gpu });
    presentController.dispose();
  }
  for (const repetition of repetitions.slice(1)) assert.deepEqual(repetition, repetitions[0]);
});

test("presentation telemetry records drawn damage and does not trust a null sink", () => {
  const records = [];
  const controller = new PresentationController(new Canvas(), {
    backendFactories: factories(true),
    onPresent: (record) => records.push(record),
    now: () => 15,
  });
  controller.present(frame());
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    sequence: 1, timestamp: 15, backend: "canvas2d", drawn: true, replay: false,
    rect: { x: 0, y: 0, width: 2, height: 2 }, resourceWidth: 2, resourceHeight: 2, bytes: 16,
  });
  assert.deepEqual(controller.snapshot().gpu, {
    framesReceived: 1, enqueued: 1, coalesced: 0, presented: 1, successfulPresents: 1,
    skipped: 0, droppedFrames: 0, overruns: 0, pending: 0, maxPending: 0, uploadedBytes: 16,
    drawnPresents: 1, drawnBytes: 16, width: 2, height: 2,
  });
  assert.throws(() => controller.present({
    ...frame(), rect: { x: 1, y: 1, width: 2, height: 2 },
  }), /outside the resource/);
  controller.dispose();

  const nullRecords = [];
  const nullController = new PresentationController(new Canvas(), {
    backendFactories: factories(false),
    onPresent: (record) => nullRecords.push(record),
  });
  nullController.present(frame());
  assert.equal(nullRecords[0].drawn, false);
  assert.equal(nullController.snapshot().gpu.successfulPresents, 1);
  assert.equal(nullController.snapshot().gpu.drawnPresents, 0);
  assert.equal(nullController.snapshot().gpu.drawnBytes, 0);
  nullController.dispose();
});

test("bench JavaScript and editor projection stay byte-identical", () => {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bench");
  assert.equal(readFileSync(path.join(directory, "desktop-perf-hooks.js"), "utf8"),
    readFileSync(path.join(directory, "desktop-perf-hooks.ts"), "utf8"));
});
