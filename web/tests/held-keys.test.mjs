// E5-T13a — isolated held-key state and lifecycle release hooks.
// Run from the repository root with: npm run test:keyboard-hardening --prefix web

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachHeldKeyLifecycle,
  createHeldKeyLedger,
} from "../src/input/held-keys.js";

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    listenerCount() { return listeners.size; },
  };
}

test("TypeScript source and no-bundler browser projection stay byte-identical", () => {
  const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/input");
  assert.equal(
    readFileSync(path.join(inputDir, "held-keys.ts"), "utf8"),
    readFileSync(path.join(inputDir, "held-keys.js"), "utf8"),
  );
});

test("press/release is idempotent and preserves opaque key metadata", () => {
  const diagnostics = [];
  const ledger = createHeldKeyLedger({ onDiagnostic: (entry) => diagnostics.push(entry) });
  const value = { evdev: 29, modifier: true };
  assert.equal(ledger.press("ControlLeft", value).accepted, true);
  assert.equal(ledger.press("ControlLeft", { evdev: 97 }).reason, "duplicate-keydown");
  assert.equal(ledger.release("ControlLeft"), value);
  assert.equal(ledger.release("ControlLeft"), null);
  assert.deepEqual(diagnostics.map((entry) => entry.reason), ["duplicate-keydown", "orphan-keyup"]);
  assert.equal(ledger.size(), 0);
});

test("releaseAll emits reverse dependent-before-modifier order and clears before callbacks", () => {
  const ledger = createHeldKeyLedger();
  ledger.press("ShiftLeft", { evdev: 42, modifier: true });
  ledger.press("KeyA", { evdev: 30, modifier: false });
  ledger.press("KeyB", { evdev: 48, modifier: false });
  const emitted = [];
  const records = ledger.releaseAll((code, value) => {
    emitted.push([code, value.evdev, ledger.codes()]);
  });
  assert.deepEqual(records.map(({ code }) => code), ["KeyB", "KeyA", "ShiftLeft"]);
  assert.deepEqual(emitted, [
    ["KeyB", 48, []],
    ["KeyA", 30, []],
    ["ShiftLeft", 42, []],
  ]);
  assert.deepEqual(ledger.snapshot(), []);
  assert.deepEqual(ledger.releaseAll(), []);
});

test("releaseAll is safe under 500 repeated lifecycle-style calls", () => {
  const ledger = createHeldKeyLedger();
  const emitted = [];
  for (let index = 0; index < 500; index += 1) {
    ledger.press(`Key${index}`, { modifier: false });
    ledger.releaseAll((code) => emitted.push(code));
    ledger.releaseAll((code) => emitted.push(code));
  }
  assert.equal(emitted.length, 500);
  assert.equal(new Set(emitted).size, 500);
  assert.equal(ledger.size(), 0);
});

test("lifecycle hooks share one release-all callback and ignore visible/locked transitions", () => {
  const win = target();
  const doc = target();
  const view = target();
  const reasons = [];
  let hidden = false;
  let pointerLockElement = {};
  Object.defineProperties(doc, {
    hidden: { get: () => hidden },
    visibilityState: { get: () => hidden ? "hidden" : "visible" },
    pointerLockElement: { get: () => pointerLockElement },
  });
  const detach = attachHeldKeyLifecycle({
    windowTarget: win,
    documentTarget: doc,
    viewTarget: view,
    releaseAll: (reason) => reasons.push(reason),
  });

  win.dispatch("blur");
  hidden = true;
  doc.dispatch("visibilitychange");
  hidden = false;
  doc.dispatch("visibilitychange");
  pointerLockElement = null;
  doc.dispatch("pointerlockchange");
  pointerLockElement = {};
  doc.dispatch("pointerlockchange");
  view.dispatch("wvm:reserved-view-toggle");
  assert.deepEqual(reasons, ["blur", "visibility-hidden", "pointerlock-lost", "view-toggle"]);
  assert.equal(win.listenerCount(), 1);
  assert.equal(doc.listenerCount(), 2);
  assert.equal(view.listenerCount(), 1);
  detach();
  assert.equal(win.listenerCount(), 0);
  assert.equal(doc.listenerCount(), 0);
  assert.equal(view.listenerCount(), 0);
});

test("bridge releaseAll uses the shared ledger and reset drops stale state without guest breaks", async () => {
  const { createKeyboardBridge } = await import("../src/input/keyboard.js");
  const calls = [];
  const bridge = createKeyboardBridge({
    sendKeyboardEvent: (...args) => calls.push(["event", ...args]),
    syncKeyboard: () => calls.push(["sync"]),
  });
  bridge.keydown({ code: "AltLeft" });
  bridge.keydown({ code: "KeyA" });
  assert.deepEqual(bridge.heldCodes(), ["AltLeft", "KeyA"]);
  bridge.releaseAll();
  assert.deepEqual(bridge.heldCodes(), []);
  assert.deepEqual(calls.filter(([kind]) => kind === "event").map(([, ...args]) => args), [
    [1, 56, 1],
    [1, 30, 1],
    [1, 30, 0],
    [1, 56, 0],
  ]);
  bridge.keydown({ code: "KeyB" });
  assert.deepEqual(bridge.resetHeld().map(({ code }) => code), ["KeyB"]);
  assert.deepEqual(bridge.heldCodes(), []);
});
