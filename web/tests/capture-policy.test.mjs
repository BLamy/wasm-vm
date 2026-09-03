// E5-T12c — browser-default capture policy and hostile shortcut ordering.
// Run from the repository root with: node --test web/tests/capture-policy.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachKeyboardCapture,
  createKeyboardCapturePolicy,
} from "../src/input/capture.js";

function key(type, code, extra = {}) {
  let prevented = false;
  let stopped = false;
  return {
    type,
    code,
    ...extra,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; },
    get defaultPrevented() { return prevented; },
    get propagationStopped() { return stopped; },
  };
}

function makePolicy(overrides = {}) {
  const guest = [];
  const reserved = [];
  const diagnostics = [];
  const policy = createKeyboardCapturePolicy({
    onGuestEvent: (event) => guest.push(event),
    onReserved: (event) => reserved.push(event),
    onDiagnostic: (entry) => diagnostics.push(entry),
    ...overrides,
  });
  return { policy, guest, reserved, diagnostics };
}

test("TypeScript source and no-bundler browser projection stay byte-identical", () => {
  const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/input");
  assert.equal(
    readFileSync(path.join(inputDir, "capture.ts"), "utf8"),
    readFileSync(path.join(inputDir, "capture.js"), "utf8"),
  );
});

test("capture-on prevents ordinary events and flushes modifier prefixes in order", () => {
  const { policy, guest } = makePolicy();
  const events = [
    key("keydown", "ControlLeft"),
    key("keydown", "ShiftLeft"),
    key("keydown", "KeyA", { ctrlKey: true, shiftKey: true }),
    key("keyup", "KeyA", { ctrlKey: true, shiftKey: true }),
    key("keyup", "ShiftLeft", { ctrlKey: true }),
    key("keyup", "ControlLeft"),
  ];
  for (const event of events) policy.handleKeyEvent(event);

  assert.deepEqual(guest.map((event) => `${event.type}:${event.code}`), [
    "keydown:ControlLeft",
    "keydown:ShiftLeft",
    "keydown:KeyA",
    "keyup:KeyA",
    "keyup:ShiftLeft",
    "keyup:ControlLeft",
  ]);
  // Modifier prefix edges stay cancellable only after a dependent key is known. This preserves
  // browser shortcut dispatch for Ctrl/Meta chords without weakening ordinary-key capture.
  assert.equal(events.filter((event) => event.code === "KeyA").every((event) => event.defaultPrevented), true);
  assert.deepEqual(policy.pendingModifierCodes(), []);
});

test("capture-off leaves defaults alone and never forwards to the guest", () => {
  const { policy, guest } = makePolicy({ initialCaptured: false });
  const event = key("keydown", "KeyA");
  const result = policy.handleKeyEvent(event);
  assert.equal(result.reason, "capture-off");
  assert.equal(result.captured, false);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(guest, []);

  policy.setCaptured(true);
  const captured = key("keydown", "KeyB");
  policy.handleKeyEvent(captured);
  assert.equal(captured.defaultPrevented, true);
  assert.deepEqual(guest.map((item) => item.code), ["KeyB"]);
});

test("reserved Ctrl+Alt+Backquote consumes prefixes without preventing the browser default", () => {
  const { policy, guest, reserved } = makePolicy();
  const control = key("keydown", "ControlLeft");
  const alt = key("keydown", "AltLeft");
  const trigger = key("keydown", "Backquote", { ctrlKey: true, altKey: true });
  for (const event of [control, alt, trigger]) policy.handleKeyEvent(event);
  for (const event of [
    key("keyup", "Backquote", { ctrlKey: true, altKey: true }),
    key("keyup", "AltLeft", { ctrlKey: true }),
    key("keyup", "ControlLeft"),
  ]) policy.handleKeyEvent(event);

  assert.deepEqual(guest, []);
  assert.equal(reserved.length, 1);
  assert.equal(trigger.defaultPrevented, false);
  assert.equal(trigger.propagationStopped, true);
  assert.deepEqual(policy.reservedCodes(), []);

  const synthetic = key("keydown", "Backquote", { ctrlKey: true, altKey: true });
  policy.handleKeyEvent(synthetic);
  assert.deepEqual(policy.reservedCodes(), ["Backquote"]);
  policy.handleKeyEvent(key("keyup", "Backquote", { ctrlKey: true, altKey: true }));
  assert.deepEqual(policy.reservedCodes(), []);
});

test("browser-owned Ctrl/Meta shortcuts and F11 are passed through on both edges", () => {
  const { policy, guest } = makePolicy();
  const shortcuts = [
    ["ControlLeft", "KeyW", { ctrlKey: true }],
    ["ControlLeft", "KeyT", { ctrlKey: true }],
    ["ControlLeft", "KeyN", { ctrlKey: true }],
    ["MetaLeft", "KeyQ", { metaKey: true }],
    ["MetaLeft", "Tab", { metaKey: true }],
    [null, "F11", {}],
  ];
  const events = [];
  for (const [modifier, code, flags] of shortcuts) {
    if (modifier) {
      events.push(key("keydown", modifier));
      events.push(key("keydown", code, flags));
      events.push(key("keyup", code, flags));
      events.push(key("keyup", modifier));
    } else {
      events.push(key("keydown", code));
      events.push(key("keyup", code));
    }
  }
  for (const event of events) {
    const result = policy.handleKeyEvent(event);
    if (event.code === "ControlLeft" || event.code === "MetaLeft") {
      assert.equal(event.defaultPrevented, false, `${event.type}:${event.code} was prevented`);
      continue;
    }
    assert.equal(result.passthrough, true, `${event.type}:${event.code}`);
    assert.equal(event.defaultPrevented, false, `${event.type}:${event.code} was prevented`);
  }
  assert.deepEqual(guest, []);
  assert.deepEqual(policy.passthroughCodes(), []);
});

test("Firefox-style quick-find is prevented when Slash reaches a captured host", () => {
  const { policy, guest } = makePolicy();
  const event = key("keydown", "Slash");
  const result = policy.handleKeyEvent(event);
  assert.equal(result.forwarded, true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(guest.map((item) => item.code), ["Slash"]);
});

test("IME events remain browser-owned and do not flush a pending modifier", () => {
  const { policy, guest, diagnostics } = makePolicy();
  const control = key("keydown", "ControlLeft");
  const ime = key("keydown", "KeyA", { isComposing: true, ctrlKey: true });
  policy.handleKeyEvent(control);
  policy.handleKeyEvent(ime);
  assert.equal(ime.defaultPrevented, false);
  assert.deepEqual(policy.pendingModifierCodes(), ["ControlLeft"]);
  assert.deepEqual(guest, []);
  assert.equal(diagnostics.at(-1).reason, "ime-event");
  policy.setCaptured(false);
  assert.deepEqual(policy.pendingModifierCodes(), []);
});

test("attachKeyboardCapture installs/removes policy listeners", () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener, options) { listeners.set(type, { listener, options }); },
    removeEventListener(type, listener) {
      assert.equal(listeners.get(type)?.listener, listener);
      listeners.delete(type);
    },
  };
  const { policy, guest } = makePolicy();
  const detach = attachKeyboardCapture(target, policy, { capture: true });
  assert.equal(listeners.get("keydown").options.capture, true);
  const event = key("keydown", "KeyY");
  listeners.get("keydown").listener(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(guest.map((item) => item.code), ["KeyY"]);
  detach();
  assert.equal(listeners.size, 0);
});
