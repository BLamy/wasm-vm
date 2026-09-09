// E5-T12b — DOM keyboard normalization, physical evdev frames, and hostile-event policy.
// Run from the repository root with: node --test web/tests/keyboard-bridge.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EV_KEY,
  attachKeyboardBridge,
  createKeyboardBridge,
  createWasmKeyboardAdapter,
} from "../src/input/keyboard.js";

function makeBridge() {
  const frames = [];
  const diagnostics = [];
  const bridge = createKeyboardBridge(
    {
      sendKeyboardEvent: (...args) => frames.push({ kind: "event", args }),
      syncKeyboard: () => frames.push({ kind: "sync" }),
    },
    { onDiagnostic: (entry) => diagnostics.push(entry) },
  );
  return { bridge, frames, diagnostics };
}

function key(type, code, extra = {}) {
  return { type, code, ...extra };
}

function eventFrames(frames) {
  return frames
    .filter((frame) => frame.kind === "event")
    .map((frame) => frame.args);
}

test("TypeScript source and no-bundler browser projection stay byte-identical", () => {
  const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/input");
  assert.equal(
    readFileSync(path.join(inputDir, "keyboard.ts"), "utf8"),
    readFileSync(path.join(inputDir, "keyboard.js"), "utf8"),
  );
});

test("KeyA make/break is one EV_KEY frame each and DOM repeats add no make", () => {
  const { bridge, frames } = makeBridge();
  assert.equal(bridge.handleKeyEvent(key("keydown", "KeyA")).forwarded, true);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(bridge.handleKeyEvent(key("keydown", "KeyA", { repeat: true })).forwarded, false);
  }
  assert.equal(bridge.handleKeyEvent(key("keyup", "KeyA")).forwarded, true);
  assert.deepEqual(eventFrames(frames), [
    [EV_KEY, 30, 1],
    [EV_KEY, 30, 0],
  ]);
  assert.equal(frames.filter((frame) => frame.kind === "sync").length, 2);
  assert.deepEqual(bridge.heldCodes(), []);
});

test("rapid Shift/A interleaving preserves modifier-before-key and key-before-modifier release", () => {
  const { bridge, frames } = makeBridge();
  bridge.handleKeyEvent(key("keydown", "ShiftLeft"));
  bridge.handleKeyEvent(key("keydown", "KeyA"));
  const deferred = bridge.handleKeyEvent(key("keyup", "ShiftLeft"));
  assert.equal(deferred.forwarded, false);
  assert.equal(deferred.reason, "modifier-release-deferred");
  assert.deepEqual(bridge.pendingModifierCodes(), ["ShiftLeft"]);
  bridge.handleKeyEvent(key("keyup", "KeyA"));
  assert.deepEqual(eventFrames(frames), [
    [EV_KEY, 42, 1],
    [EV_KEY, 30, 1],
    [EV_KEY, 30, 0],
    [EV_KEY, 42, 0],
  ]);
  assert.deepEqual(bridge.heldCodes(), []);
});

test("Ctrl+C and shifted punctuation emit physical modifier frames in chord order", () => {
  const ctrl = makeBridge();
  for (const event of [
    key("keydown", "ControlLeft"),
    key("keydown", "KeyC"),
    key("keyup", "KeyC"),
    key("keyup", "ControlLeft"),
  ]) ctrl.bridge.handleKeyEvent(event);
  assert.deepEqual(eventFrames(ctrl.frames), [
    [EV_KEY, 29, 1],
    [EV_KEY, 46, 1],
    [EV_KEY, 46, 0],
    [EV_KEY, 29, 0],
  ]);

  const shifted = makeBridge();
  for (const event of [
    key("keydown", "ShiftLeft"),
    key("keydown", "Digit1"),
    key("keyup", "ShiftLeft"),
    key("keyup", "Digit1"),
  ]) shifted.bridge.handleKeyEvent(event);
  assert.deepEqual(eventFrames(shifted.frames), [
    [EV_KEY, 42, 1],
    [EV_KEY, 2, 1],
    [EV_KEY, 2, 0],
    [EV_KEY, 42, 0],
  ]);
});

test("Windows AltGr representation is ControlLeft + AltRight and releases in dependency order", () => {
  const { bridge, frames } = makeBridge();
  for (const event of [
    key("keydown", "ControlLeft"),
    key("keydown", "AltRight"),
    key("keydown", "KeyQ"),
    key("keyup", "AltRight"),
    key("keyup", "KeyQ"),
    key("keyup", "ControlLeft"),
  ]) bridge.handleKeyEvent(event);
  assert.deepEqual(eventFrames(frames), [
    [EV_KEY, 29, 1],
    [EV_KEY, 100, 1],
    [EV_KEY, 16, 1],
    [EV_KEY, 16, 0],
    [EV_KEY, 100, 0],
    [EV_KEY, 29, 0],
  ]);
});

test("IME/composing events are suppressed, while a non-composing dead key uses physical code", () => {
  const { bridge, frames, diagnostics } = makeBridge();
  for (const event of [
    key("keydown", "KeyA", { isComposing: true }),
    key("keyup", "KeyA", { isComposing: true }),
    key("keydown", "KeyA", { keyCode: 229 }),
    key("keyup", "KeyA", { which: 229 }),
  ]) assert.equal(bridge.handleKeyEvent(event).forwarded, false);
  assert.equal(bridge.handleKeyEvent(key("keydown", "Backquote", { key: "Dead" })).forwarded, true);
  bridge.handleKeyEvent(key("keyup", "Backquote", { key: "Dead" }));
  assert.deepEqual(eventFrames(frames), [
    [EV_KEY, 41, 1],
    [EV_KEY, 41, 0],
  ]);
  assert.equal(diagnostics.filter((entry) => entry.reason === "ime-event").length, 4);
});

test("unmapped and orphan events are explicit no-ops, and the Wasm adapter forwards both calls", () => {
  const { bridge, frames, diagnostics } = makeBridge();
  assert.equal(bridge.handleKeyEvent(key("keydown", "Unidentified")).forwarded, false);
  assert.equal(bridge.handleKeyEvent(key("keyup", "KeyY")).forwarded, false);
  assert.deepEqual(diagnostics.map((entry) => entry.reason), ["unmapped-code", "orphan-keyup"]);
  assert.deepEqual(frames, []);

  const calls = [];
  const controller = {
    sendKeyboardEvent: (...args) => calls.push(["event", ...args]),
    syncKeyboard: () => calls.push(["sync"]),
  };
  const adapter = createWasmKeyboardAdapter(controller);
  const adapted = createKeyboardBridge(adapter);
  adapted.handleKeyEvent(key("keydown", "KeyY"));
  adapted.handleKeyEvent(key("keyup", "KeyY"));
  assert.deepEqual(calls, [
    ["event", EV_KEY, 21, 1],
    ["sync"],
    ["event", EV_KEY, 21, 0],
    ["sync"],
  ]);
});

test("attachKeyboardBridge installs and removes only translation listeners", () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener, options) { listeners.set(type, { listener, options }); },
    removeEventListener(type, listener) {
      assert.equal(listeners.get(type)?.listener, listener);
      listeners.delete(type);
    },
  };
  const { bridge, frames } = makeBridge();
  const detach = attachKeyboardBridge(target, bridge, { capture: true });
  assert.equal(listeners.get("keydown").options.capture, true);
  assert.equal(listeners.get("keyup").options.capture, true);
  listeners.get("keydown").listener(key("keydown", "KeyA"));
  listeners.get("keyup").listener(key("keyup", "KeyA"));
  assert.deepEqual(eventFrames(frames), [[EV_KEY, 30, 1], [EV_KEY, 30, 0]]);
  detach();
  assert.equal(listeners.size, 0);
});
