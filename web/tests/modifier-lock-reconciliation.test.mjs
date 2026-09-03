// E5-T13b — modifier resynchronization and T11 LED repair.
// Run from the repository root with: npm run test:keyboard-reconciliation --prefix web

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createKeyboardBridge } from "../src/input/keyboard.js";
import { createKeyboardReconciler } from "../src/input/reconciliation.js";

function key(type, code, states = {}) {
  return {
    type,
    code,
    getModifierState: (kind) => Boolean(states[kind]),
  };
}

function make() {
  const frames = [];
  const bridge = createKeyboardBridge({
    sendKeyboardEvent: (...args) => frames.push(["event", ...args]),
    syncKeyboard: () => frames.push(["sync"]),
  });
  let leds = { capsLock: false, numLock: false };
  const diagnostics = [];
  const reconciler = createKeyboardReconciler(bridge, {
    getGuestLedState: () => leds,
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  return { bridge, reconciler, frames, diagnostics, setLeds: (value) => { leds = value; } };
}

function events(frames) {
  return frames.filter(([kind]) => kind === "event").map(([, ...args]) => args);
}

test("TypeScript source and no-bundler browser projection stay byte-identical", () => {
  const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/input");
  assert.equal(
    readFileSync(path.join(inputDir, "reconciliation.ts"), "utf8"),
    readFileSync(path.join(inputDir, "reconciliation.js"), "utf8"),
  );
});

test("missing Control is repaired before a dependent key and released on the false branch", () => {
  const { reconciler, frames, bridge } = make();
  const down = reconciler.handleKeyEvent(key("keydown", "KeyA", { Control: true }));
  assert.equal(down.corrections.length, 1);
  assert.deepEqual(events(frames), [[1, 29, 1], [1, 30, 1]]);

  const up = reconciler.handleKeyEvent(key("keyup", "KeyA", { Control: false }));
  assert.equal(up.corrections.length, 1);
  assert.deepEqual(events(frames), [[1, 29, 1], [1, 30, 1], [1, 29, 0], [1, 30, 0]]);
  assert.deepEqual(bridge.heldCodes(), []);
  assert.equal(reconciler.stats().modifierRepairs, 2);
});

test("matching modifier state and the modifier's own edges do not self-repair", () => {
  const { reconciler, frames, bridge } = make();
  reconciler.handleKeyEvent(key("keydown", "ShiftLeft", { Shift: true }));
  reconciler.handleKeyEvent(key("keyup", "ShiftLeft", { Shift: false }));
  assert.deepEqual(events(frames), [[1, 42, 1], [1, 42, 0]]);
  assert.equal(reconciler.stats().modifierRepairs, 0);
  assert.deepEqual(bridge.heldCodes(), []);
});

test("a stranded Alt is repaired up before an unrelated key", () => {
  const { reconciler, bridge, frames } = make();
  bridge.keydown({ code: "AltRight" });
  const result = reconciler.handleKeyEvent(key("keydown", "KeyB", { Alt: false }));
  assert.equal(result.corrections.length, 1);
  assert.deepEqual(events(frames), [[1, 100, 1], [1, 100, 0], [1, 48, 1]]);
});

test("reconciliation can release a stranded modifier before a dependent key", () => {
  const { reconciler, bridge, frames } = make();
  bridge.keydown({ code: "ControlLeft" });
  bridge.keydown({ code: "KeyA" });
  const result = reconciler.handleKeyEvent(key("keydown", "KeyB", { Control: false }));
  assert.equal(result.corrections[0].forwarded, true);
  assert.deepEqual(events(frames), [[1, 29, 1], [1, 30, 1], [1, 29, 0], [1, 48, 1]]);
  assert.equal(bridge.isHeld("ControlLeft"), false);
  assert.equal(bridge.isHeld("KeyA"), true);
});

test("CapsLock and NumLock repairs are exact pairs and deduplicated until LED feedback catches up", () => {
  const { reconciler, frames, diagnostics, setLeds } = make();
  const first = reconciler.reconcileLocks({ capsLock: true, numLock: true });
  assert.equal(first.length, 4);
  assert.deepEqual(events(frames), [
    [1, 58, 1], [1, 58, 0],
    [1, 69, 1], [1, 69, 0],
  ]);
  assert.equal(reconciler.reconcileLocks({ capsLock: true, numLock: true }).length, 0);
  assert.deepEqual(reconciler.pendingLockKinds(), ["CapsLock", "NumLock"]);

  setLeds({ capsLock: true, numLock: true });
  assert.equal(reconciler.reconcileLocks({ capsLock: true, numLock: true }).length, 0);
  assert.deepEqual(reconciler.pendingLockKinds(), []);
  assert.equal(reconciler.stats().lockRepairs, 2);
  assert.equal(diagnostics.filter((entry) => entry.reason === "lock-reconciled").length, 2);
});

test("per-event lock modifier state is observed without a separate host-state callback", () => {
  const { reconciler, frames, setLeds } = make();
  const result = reconciler.handleKeyEvent(key("keydown", "KeyA", { CapsLock: true }));
  assert.equal(result.lockCorrections.length, 2);
  assert.deepEqual(events(frames), [[1, 58, 1], [1, 58, 0], [1, 30, 1]]);
  setLeds({ capsLock: true, numLock: false });
  reconciler.reconcileLocks({ capsLock: true, numLock: false });
  assert.deepEqual(reconciler.pendingLockKinds(), []);
});

test("rapid lock observations do not oscillate when the guest statusq is slow", () => {
  const { reconciler, frames } = make();
  for (let index = 0; index < 50; index += 1) {
    reconciler.reconcileLocks({ capsLock: true, numLock: false });
  }
  // The stale guest starts off, so only the first true observation needs a pair; repeated
  // observations are pending-suppressed until the statusq catches up.
  assert.equal(events(frames).filter(([, code]) => code === 58).length, 2);
  assert.equal(reconciler.stats().lockRepairs, 1);
});

test("AltGr-shaped Control + AltRight state is reconciled independently and stays bounded", () => {
  const { reconciler, frames } = make();
  const result = reconciler.handleKeyEvent(key("keydown", "KeyQ", { Control: true, Alt: true }));
  assert.equal(result.corrections.length, 2);
  assert.deepEqual(events(frames), [[1, 29, 1], [1, 56, 1], [1, 16, 1]]);
  assert.equal(reconciler.stats().modifierRepairs, 2);
});
