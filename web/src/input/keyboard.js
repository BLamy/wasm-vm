// E5-T12b: DOM KeyboardEvent normalization and the T11 evdev frame adapter.
// This file intentionally uses JavaScript-compatible TypeScript so the no-bundler demo can use the
// byte-identical keyboard.js projection. Capture/preventDefault policy is owned by E5-T12c.

import { evdevForCode } from "./keymap.js";

export const EV_SYN = 0;
export const SYN_REPORT = 0;
export const EV_KEY = 1;
export const IME_KEY_CODE = 229;

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

function result(code, reason, extra = {}) {
  return { forwarded: false, code, reason, ...extra };
}

function isImeEvent(event) {
  return event?.isComposing === true
    || Number(event?.keyCode) === IME_KEY_CODE
    || Number(event?.which) === IME_KEY_CODE;
}

/** Adapt either a direct WasmLinux controller or the whole-machine-worker proxy. */
export function createWasmKeyboardAdapter(controller) {
  if (typeof controller?.sendKeyboardEvent !== "function") {
    throw new TypeError("keyboard adapter requires sendKeyboardEvent");
  }
  if (typeof controller?.syncKeyboard !== "function") {
    throw new TypeError("keyboard adapter requires syncKeyboard");
  }
  return {
    sendKeyboardEvent: (...args) => controller.sendKeyboardEvent(...args),
    syncKeyboard: () => controller.syncKeyboard(),
  };
}

/**
 * Create the physical-code bridge. Each accepted key transition emits one EV_KEY event followed
 * by one T11 sync frame. The adapter methods may be synchronous (direct WasmLinux) or return
 * promises (the worker proxy); the worker protocol already serializes the posted calls in order.
 */
export function createKeyboardBridge(adapter, { onDiagnostic = () => {}, onFrame = () => {} } = {}) {
  if (typeof adapter?.sendKeyboardEvent !== "function") {
    throw new TypeError("keyboard bridge requires sendKeyboardEvent");
  }
  if (typeof adapter?.syncKeyboard !== "function") {
    throw new TypeError("keyboard bridge requires syncKeyboard");
  }

  // Map preserves physical press order. Modifier releases can therefore be deferred until every
  // dependent key is released, even when the browser/OS reports a rapid interleaved chord as
  // ShiftDown, ADown, ShiftUp, AUp.
  const held = new Map();

  function diagnostic(reason, event) {
    try {
      onDiagnostic({
        reason,
        code: typeof event?.code === "string" ? event.code : "",
        eventType: event?.type ?? "",
      });
    } catch {
      // Diagnostics must never break the input path.
    }
  }

  function publish(code, evdev, value) {
    adapter.sendKeyboardEvent(EV_KEY, evdev, value);
    adapter.syncKeyboard();
    const frame = { eventType: EV_KEY, code, evdev, value, sync: SYN_REPORT };
    try { onFrame(frame); } catch { /* instrumentation must not break input */ }
    return { forwarded: true, code, evdev, value, frame };
  }

  function hasDependentKey() {
    for (const state of held.values()) {
      if (!state.modifier) return true;
    }
    return false;
  }

  function flushDeferredModifiers() {
    if (hasDependentKey()) return [];
    const flushed = [];
    const pending = [...held.entries()]
      .filter(([, state]) => state.modifier && state.pendingRelease)
      .reverse();
    for (const [code, state] of pending) {
      flushed.push(publish(code, state.evdev, 0));
      held.delete(code);
    }
    return flushed;
  }

  function handleKeyEvent(event) {
    const eventType = event?.type;
    if (eventType !== "keydown" && eventType !== "keyup") {
      diagnostic("unsupported-event", event);
      return result(typeof event?.code === "string" ? event.code : "", "unsupported-event");
    }
    if (isImeEvent(event)) {
      diagnostic("ime-event", event);
      return result(typeof event?.code === "string" ? event.code : "", "ime-event");
    }

    const code = typeof event.code === "string" ? event.code : "";
    const evdev = evdevForCode(code);
    if (evdev === null) {
      diagnostic("unmapped-code", event);
      return result(code, "unmapped-code");
    }

    const modifier = MODIFIER_CODES.has(code);
    if (eventType === "keydown") {
      if (event.repeat === true) {
        diagnostic("repeat-keydown", event);
        return result(code, "repeat-keydown", { evdev });
      }
      const prior = held.get(code);
      if (prior) {
        // A second non-repeat keydown is still a duplicate physical make. If a modifier's release
        // was deferred, this keydown means it stayed held and cancels that pending break.
        prior.pendingRelease = false;
        diagnostic("duplicate-keydown", event);
        return result(code, "duplicate-keydown", { evdev });
      }
      const forwarded = publish(code, evdev, 1);
      held.set(code, { evdev, modifier, pendingRelease: false });
      return forwarded;
    }

    const prior = held.get(code);
    if (!prior) {
      diagnostic("orphan-keyup", event);
      return result(code, "orphan-keyup", { evdev });
    }
    if (prior.modifier && hasDependentKey()) {
      prior.pendingRelease = true;
      return result(code, "modifier-release-deferred", { evdev });
    }

    const forwarded = publish(code, evdev, 0);
    held.delete(code);
    if (!prior.modifier) flushDeferredModifiers();
    return forwarded;
  }

  function releaseAll() {
    const releases = [];
    const order = [...held.entries()];
    // Release dependent keys before modifiers so a focus-loss cleanup cannot strand a modifier
    // state in the guest. Reverse each group to mirror physical stack unwinding.
    for (const modifier of [false, true]) {
      for (const [code, state] of [...order].reverse()) {
        if (state.modifier !== modifier || !held.has(code)) continue;
        releases.push(publish(code, state.evdev, 0));
        held.delete(code);
      }
    }
    return releases;
  }

  return {
    handleKeyEvent,
    keydown: (event) => handleKeyEvent({ ...event, type: "keydown" }),
    keyup: (event) => handleKeyEvent({ ...event, type: "keyup" }),
    releaseAll,
    heldCodes: () => [...held.keys()],
    isHeld: (code) => held.has(code),
    pendingModifierCodes: () => [...held.entries()]
      .filter(([, state]) => state.modifier && state.pendingRelease)
      .map(([code]) => code),
  };
}

/** Attach only event translation; capture and browser-default policy are deliberately separate. */
export function attachKeyboardBridge(target, bridge, options = {}) {
  if (!target || typeof target.addEventListener !== "function") {
    throw new TypeError("keyboard bridge target must support addEventListener");
  }
  if (typeof bridge?.handleKeyEvent !== "function") {
    throw new TypeError("keyboard bridge requires handleKeyEvent");
  }
  const listener = (event) => bridge.handleKeyEvent(event);
  target.addEventListener("keydown", listener, options);
  target.addEventListener("keyup", listener, options);
  return () => {
    target.removeEventListener?.("keydown", listener, options);
    target.removeEventListener?.("keyup", listener, options);
  };
}
