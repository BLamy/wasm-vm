// E5-T14b — absolute/relative pointer routing, Pointer Lock recovery, and button safety.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ABS_MAX,
  ABS_X,
  ABS_Y,
  BTN_EXTRA,
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  BTN_SIDE,
  EV_ABS,
  EV_KEY,
  EV_REL,
  POINTER_MODES,
  REL_HWHEEL,
  REL_WHEEL,
  REL_X,
  REL_Y,
  WHEEL_DELTA_MODES,
  WHEEL_DETENT_UNITS,
  absoluteCoordinatesFromEvent,
  attachPointerBridge,
  createPointerBridge,
  createWasmPointerAdapter,
  evdevForPointerButton,
} from "../src/input/pointer.js";

function recorder() {
  const calls = [];
  return {
    calls,
    sendTabletEvent: (...args) => calls.push(["tablet", "event", ...args]),
    syncTablet: () => calls.push(["tablet", "sync"]),
    sendMouseEvent: (...args) => calls.push(["mouse", "event", ...args]),
    syncMouse: () => calls.push(["mouse", "sync"]),
  };
}

function rect() {
  return { left: 10, top: 20, width: 400, height: 200 };
}

function pointerEvent(extra = {}) {
  return { type: "pointermove", clientX: 210, clientY: 120, ...extra };
}

test("TypeScript source and no-bundler pointer projection stay byte-identical", () => {
  const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/input");
  assert.equal(
    readFileSync(path.join(inputDir, "pointer.ts"), "utf8"),
    readFileSync(path.join(inputDir, "pointer.js"), "utf8"),
  );
});

test("absolute coordinates use the current CSS rect and clamp independently of DPR/backing pixels", () => {
  const r = rect();
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: 10, clientY: 20 }, r), { x: 0, y: 0 });
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: 410, clientY: 220 }, r), { x: ABS_MAX, y: ABS_MAX });
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: 210, clientY: 120 }, r), { x: 16384, y: 16384 });
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: -100, clientY: 999 }, r), { x: 0, y: ABS_MAX });
  // A canvas backing store and devicePixelRatio are deliberately absent from this API: the CSS rect
  // is the complete input coordinate contract, so a 2x backing store cannot change the answer.
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: 210, clientY: 120 }, {
    ...r,
    backingWidth: 800,
    backingHeight: 400,
    devicePixelRatio: 2,
  }), { x: 16384, y: 16384 });
});

test("browser button numbers map to the documented evdev codes", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(evdevForPointerButton), [
    BTN_LEFT,
    BTN_MIDDLE,
    BTN_RIGHT,
    BTN_SIDE,
    BTN_EXTRA,
  ]);
  assert.equal(evdevForPointerButton(5), null);
  assert.equal(evdevForPointerButton("bad"), null);
});

test("absolute moves target the tablet while relative moves target only the mouse", () => {
  const io = recorder();
  const bridge = createPointerBridge(io, { getRect: rect });
  const absolute = bridge.handlePointerMove(pointerEvent());
  assert.equal(absolute.forwarded, true);
  assert.deepEqual(io.calls, [
    ["tablet", "event", EV_ABS, ABS_X, 16384],
    ["tablet", "event", EV_ABS, ABS_Y, 16384],
    ["tablet", "sync"],
  ]);

  bridge.setMode(POINTER_MODES.RELATIVE, { requestLock: false });
  const relative = bridge.handlePointerMove(pointerEvent({ movementX: 7, movementY: -3 }));
  assert.equal(relative.forwarded, true);
  assert.deepEqual(io.calls.slice(-3), [
    ["mouse", "event", EV_REL, REL_X, 7],
    ["mouse", "event", EV_REL, REL_Y, -3],
    ["mouse", "sync"],
  ]);
  assert.equal(io.calls.filter((call) => call[0] === "tablet").length, 3);
});

test("mode changes release old-device buttons before routing the next button pair", () => {
  const io = recorder();
  const bridge = createPointerBridge(io, { getRect: rect });
  assert.equal(bridge.handlePointerDown({ type: "pointerdown", button: 0 }).forwarded, true);
  assert.deepEqual(bridge.heldButtons().map((entry) => [entry.device, entry.evdev]), [["tablet", BTN_LEFT]]);

  bridge.setMode(POINTER_MODES.RELATIVE, { requestLock: false });
  assert.deepEqual(io.calls.slice(-2), [
    ["tablet", "event", EV_KEY, BTN_LEFT, 0],
    ["tablet", "sync"],
  ]);
  assert.deepEqual(bridge.heldButtons(), []);

  assert.equal(bridge.handlePointerDown({ type: "pointerdown", button: 2 }).forwarded, true);
  assert.equal(bridge.handlePointerUp({ type: "pointerup", button: 2 }).forwarded, true);
  assert.deepEqual(io.calls.slice(-4), [
    ["mouse", "event", EV_KEY, BTN_RIGHT, 1],
    ["mouse", "sync"],
    ["mouse", "event", EV_KEY, BTN_RIGHT, 0],
    ["mouse", "sync"],
  ]);
});

test("pixel and line wheel detents use signed per-axis accumulators", () => {
  const io = recorder();
  const bridge = createPointerBridge(io);
  const pixel = bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: 120 });
  assert.equal(pixel.forwarded, true);
  assert.deepEqual(io.calls.slice(-2), [
    ["mouse", "event", EV_REL, REL_WHEEL, -1],
    ["mouse", "sync"],
  ]);
  const line = bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.LINE, deltaY: 3 });
  assert.equal(line.forwarded, true);
  assert.deepEqual(io.calls.slice(-2), [
    ["mouse", "event", EV_REL, REL_WHEEL, -1],
    ["mouse", "sync"],
  ]);
  const horizontal = bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.LINE, deltaX: 3, deltaY: 0 });
  assert.equal(horizontal.forwarded, true);
  assert.deepEqual(io.calls.slice(-2), [
    ["mouse", "event", EV_REL, REL_HWHEEL, 1],
    ["mouse", "sync"],
  ]);
});

test("1000 small pixel wheel deltas stay bounded and never change emitted sign", () => {
  const io = recorder();
  const frames = [];
  const bridge = createPointerBridge(io, { onFrame: (frame) => frames.push(frame) });
  for (let index = 0; index < 1000; index += 1) {
    const result = bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: 3 });
    assert.equal(result.consumed, true);
  }
  assert.equal(frames.length, 25);
  assert.deepEqual(frames.flatMap((frame) => frame.events.map((event) => event.value)), Array(25).fill(-1));
  assert.equal(bridge.wheelRemainders().vertical, 0);
  assert.ok(Math.abs(bridge.wheelRemainders().horizontal) < WHEEL_DETENT_UNITS);
  assert.equal(frames.reduce((total, frame) => total + frame.events[0].value, 0), -25);
});

test("wheel accumulators cancel across direction changes and reject invalid modes", () => {
  const bridge = createPointerBridge(recorder());
  assert.equal(bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: 60 }).forwarded, false);
  assert.equal(bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: -60 }).forwarded, false);
  assert.deepEqual(bridge.wheelRemainders(), { horizontal: 0, vertical: 0 });
  assert.equal(bridge.handleWheel({ deltaMode: 99, deltaY: 120 }).consumed, false);
  assert.equal(bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: Infinity }).consumed, false);
  assert.ok(Math.abs(bridge.handleWheel({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: 1e30 }).remainders.vertical) < WHEEL_DETENT_UNITS);
});

test("Pointer Lock success is accepted and denial/loss returns to neutral absolute mode", async () => {
  const io = recorder();
  const diagnostics = [];
  const documentTarget = { pointerLockElement: null };
  const target = {
    requestPointerLock(options) {
      assert.deepEqual(options, { unadjustedMovement: true });
      return Promise.resolve();
    },
  };
  const bridge = createPointerBridge(io, {
    target,
    documentTarget,
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  bridge.requestRelative();
  assert.equal(bridge.mode(), POINTER_MODES.RELATIVE);
  documentTarget.pointerLockElement = target;
  bridge.handlePointerLockChange();
  assert.equal(bridge.isPointerLocked(), true);
  documentTarget.pointerLockElement = null;
  bridge.handlePointerLockChange();
  assert.equal(bridge.mode(), POINTER_MODES.ABSOLUTE);
  assert.equal(diagnostics.some((entry) => entry.reason === "pointerlock-lost"), false);

  const denied = createPointerBridge(recorder(), {
    target: { requestPointerLock: () => Promise.reject(new Error("denied")) },
    documentTarget: { pointerLockElement: null },
  });
  denied.requestRelative();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(denied.mode(), POINTER_MODES.ABSOLUTE);
  assert.equal(denied.state().pointerLockRequested, false);
});

test("legacy Pointer Lock retries without options and explicit errors fail closed", () => {
  const io = recorder();
  let requests = 0;
  const target = {
    requestPointerLock(options) {
      requests += 1;
      if (options) throw new TypeError("legacy API");
    },
  };
  const bridge = createPointerBridge(io, { target, documentTarget: {} });
  bridge.requestRelative();
  assert.equal(requests, 2);
  assert.equal(bridge.mode(), POINTER_MODES.RELATIVE);

  const failed = createPointerBridge(recorder(), {
    target: { requestPointerLock: () => { throw new Error("policy"); } },
    documentTarget: {},
  });
  failed.requestRelative();
  assert.equal(failed.mode(), POINTER_MODES.ABSOLUTE);
});

test("attached surface captures buttons and suppresses the browser context menu", () => {
  const listeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const captures = [];
  const target = {
    addEventListener(type, listener, options) { listeners.set(type, { listener, options }); },
    removeEventListener(type) { listeners.delete(type); },
    setPointerCapture(id) { captures.push(["set", id]); },
    releasePointerCapture(id) { captures.push(["release", id]); },
    getBoundingClientRect: rect,
  };
  const documentTarget = {
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); },
    pointerLockElement: null,
    hidden: false,
  };
  const windowTarget = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const io = recorder();
  const bridge = createPointerBridge(io, { getRect: rect });
  const detach = attachPointerBridge(target, bridge, { documentTarget, windowTarget });
  let prevented = 0;
  listeners.get("pointerdown").listener({ type: "pointerdown", button: 0, pointerId: 9, preventDefault: () => { prevented += 1; } });
  const dragMove = listeners.get("pointermove").listener({ type: "pointermove", clientX: -100, clientY: 999, preventDefault: () => { prevented += 1; } });
  assert.equal(dragMove, undefined);
  listeners.get("pointerup").listener({ type: "pointerup", button: 0, pointerId: 9, preventDefault: () => { prevented += 1; } });
  listeners.get("wheel").listener({ deltaMode: WHEEL_DELTA_MODES.PIXEL, deltaY: 120, preventDefault: () => { prevented += 1; } });
  const context = { preventDefault: () => { prevented += 1; } };
  listeners.get("contextmenu").listener(context);
  assert.deepEqual(captures, [["set", 9], ["release", 9]]);
  assert.equal(prevented, 5);
  assert.deepEqual([...documentListeners.keys()].sort(), ["pointerlockchange", "pointerlockerror", "visibilitychange"]);
  assert.deepEqual([...windowListeners.keys()].sort(), ["blur", "wvm:reserved-view-toggle"]);

  bridge.handlePointerDown({ type: "pointerdown", button: 0, pointerId: 10 });
  windowListeners.get("blur")();
  assert.deepEqual(bridge.heldButtons(), []);
  bridge.setMode(POINTER_MODES.RELATIVE, { requestLock: false });
  bridge.handlePointerDown({ type: "pointerdown", button: 4, pointerId: 11 });
  windowListeners.get("wvm:reserved-view-toggle")();
  assert.equal(bridge.mode(), POINTER_MODES.ABSOLUTE);
  assert.deepEqual(bridge.heldButtons(), []);
  bridge.setMode(POINTER_MODES.RELATIVE, { requestLock: false });
  bridge.handlePointerDown({ type: "pointerdown", button: 1, pointerId: 12 });
  documentTarget.hidden = true;
  documentListeners.get("visibilitychange")();
  assert.equal(bridge.mode(), POINTER_MODES.ABSOLUTE);
  assert.deepEqual(bridge.heldButtons(), []);
  detach();
  assert.equal(listeners.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(windowListeners.size, 0);
});

test("Wasm pointer adapter requires the complete four-method transport surface", () => {
  assert.throws(() => createWasmPointerAdapter({}), /sendTabletEvent/);
  const calls = [];
  const adapter = createWasmPointerAdapter({
    sendTabletEvent: (...args) => calls.push(["tablet", ...args]),
    syncTablet: () => calls.push(["tablet-sync"]),
    sendMouseEvent: (...args) => calls.push(["mouse", ...args]),
    syncMouse: () => calls.push(["mouse-sync"]),
  });
  adapter.sendTabletEvent(EV_ABS, ABS_X, 1);
  adapter.syncTablet();
  adapter.sendMouseEvent(EV_REL, REL_Y, -1);
  adapter.syncMouse();
  assert.deepEqual(calls, [
    ["tablet", EV_ABS, ABS_X, 1],
    ["tablet-sync"],
    ["mouse", EV_REL, REL_Y, -1],
    ["mouse-sync"],
  ]);
});
