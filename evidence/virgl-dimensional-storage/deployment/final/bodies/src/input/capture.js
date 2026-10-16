// E5-T12c: keyboard capture policy for the browser-facing guest input surface.
// The policy is deliberately independent from the evdev bridge so it can be attacked with plain
// KeyboardEvent-shaped fixtures and so browser-default decisions remain auditable.

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

const MODIFIER_FLAGS = Object.freeze({
  Control: "ctrlKey",
  Meta: "metaKey",
  Alt: "altKey",
  Shift: "shiftKey",
});

const RESERVED_VIEW_TOGGLE = Object.freeze({
  code: "Backquote",
  modifiers: Object.freeze(["Control", "Alt"]),
});

/** Browser-owned shortcuts are intentionally not promised to the guest. */
export const DEFAULT_PASSTHROUGH = Object.freeze([
  Object.freeze({ code: "KeyW", modifiers: Object.freeze(["Control"]) }),
  Object.freeze({ code: "KeyT", modifiers: Object.freeze(["Control"]) }),
  Object.freeze({ code: "KeyN", modifiers: Object.freeze(["Control"]) }),
  Object.freeze({ code: "KeyQ", modifiers: Object.freeze(["Meta"]) }),
  Object.freeze({ code: "Tab", modifiers: Object.freeze(["Meta"]) }),
  Object.freeze({ code: "F11", modifiers: Object.freeze([]) }),
]);

const IME_KEY_CODE = 229;

function codeOf(event) {
  return typeof event?.code === "string" ? event.code : "";
}

function isModifierCode(code) {
  return MODIFIER_CODES.has(code);
}

function pendingHasModifier(pending, kind) {
  const prefix = kind === "Control" ? "Control"
    : kind === "Meta" ? "Meta"
      : kind === "Alt" ? "Alt" : "Shift";
  for (const code of pending.keys()) {
    if (code.startsWith(prefix)) return true;
  }
  return false;
}

function modifierIsDown(event, pending, kind) {
  return Boolean(event?.[MODIFIER_FLAGS[kind]]) || pendingHasModifier(pending, kind);
}

function isImeEvent(event) {
  return event?.isComposing === true
    || Number(event?.keyCode) === IME_KEY_CODE
    || Number(event?.which) === IME_KEY_CODE;
}

function normalizeRules(rules) {
  return [...(rules ?? [])].map((rule) => {
    if (typeof rule === "function") return rule;
    if (typeof rule === "string") return (event) => codeOf(event) === rule;
    if (!rule || typeof rule.code !== "string") {
      throw new TypeError("keyboard passthrough rules require a code or predicate");
    }
    const modifiers = [...(rule.modifiers ?? [])];
    for (const modifier of modifiers) {
      if (!(modifier in MODIFIER_FLAGS)) {
        throw new TypeError(`unknown keyboard passthrough modifier: ${modifier}`);
      }
    }
    return (event, pending) => codeOf(event) === rule.code &&
      modifiers.every((modifier) => modifierIsDown(event, pending, modifier));
  });
}

function callSafely(callback, value, onError, errorReason) {
  try {
    callback(value);
    return true;
  } catch (error) {
    onError(errorReason, value, error);
    return false;
  }
}

function makeResult(code, reason, extra = {}) {
  return {
    captured: extra.captured ?? true,
    prevented: extra.prevented ?? false,
    forwarded: extra.forwarded ?? false,
    reserved: extra.reserved ?? false,
    passthrough: extra.passthrough ?? false,
    code,
    reason,
    ...extra,
  };
}

/**
 * Create the deterministic browser-default policy around the T12b physical keyboard bridge.
 *
 * Modifiers are held as prefixes until a dependent key arrives. This is important for reserved
 * and browser-owned chords: ControlLeft + AltLeft must never leak to the guest before
 * Ctrl+Alt+Backquote is recognized as the T08 view-toggle hook.
 */
export function createKeyboardCapturePolicy({
  initialCaptured = true,
  onGuestEvent = () => {},
  onReserved = () => {},
  onDiagnostic = () => {},
  onStateChange = () => {},
  preserveDefault = () => false,
  passthrough = DEFAULT_PASSTHROUGH,
} = {}) {
  let captured = Boolean(initialCaptured);
  const pendingModifiers = new Map();
  const passthroughHeld = new Set();
  const reservedHeld = new Set();
  const rules = normalizeRules(passthrough);

  function diagnostic(reason, event, error = undefined) {
    callSafely(onDiagnostic, {
      reason,
      code: codeOf(event),
      eventType: event?.type ?? "",
      ...(error ? { error: error?.message || String(error) } : {}),
    }, () => {}, "diagnostic-callback-error");
  }

  function prevent(event) {
    try {
      if (preserveDefault(event)) return false;
    } catch (error) {
      diagnostic("preserve-default-error", event, error);
    }
    if (typeof event?.preventDefault !== "function") return false;
    try {
      event.preventDefault();
      return true;
    } catch (error) {
      diagnostic("prevent-default-error", event, error);
      return false;
    }
  }

  function stopPropagation(event) {
    if (typeof event?.stopImmediatePropagation !== "function") return;
    try { event.stopImmediatePropagation(); } catch (error) {
      diagnostic("stop-propagation-error", event, error);
    }
  }

  function guest(event) {
    return callSafely(onGuestEvent, event, (reason, value, error) => {
      diagnostic(reason, value, error);
    }, "guest-callback-error");
  }

  function pendingCodes() {
    return [...pendingModifiers.keys()];
  }

  function clearTransientState() {
    pendingModifiers.clear();
    passthroughHeld.clear();
    reservedHeld.clear();
  }

  function stateChanged() {
    callSafely(onStateChange, captured, () => {}, "state-callback-error");
  }

  function matchesPassthrough(event) {
    return rules.some((rule) => {
      try {
        return Boolean(rule(event, pendingModifiers));
      } catch (error) {
        diagnostic("passthrough-rule-error", event, error);
        return false;
      }
    });
  }

  function matchesReserved(event) {
    if (codeOf(event) !== RESERVED_VIEW_TOGGLE.code) return false;
    if (event?.shiftKey || event?.metaKey) return false;
    return modifierIsDown(event, pendingModifiers, "Control") &&
      modifierIsDown(event, pendingModifiers, "Alt");
  }

  function prefixCodesForChord() {
    const codes = pendingCodes();
    // A synthetic or browser-recovered event may expose modifier flags without a preceding DOM
    // keydown. There is no physical code to track in that case, so only real pending prefixes are
    // suppressed and the trigger itself remains the complete ownership record.
    return codes;
  }

  function flushModifiers() {
    let forwarded = false;
    for (const event of pendingModifiers.values()) forwarded = guest(event) || forwarded;
    pendingModifiers.clear();
    return forwarded;
  }

  function handleCaptured(event) {
    const code = codeOf(event);
    const eventType = event?.type;
    const modifier = isModifierCode(code);

    if (isImeEvent(event)) {
      diagnostic("ime-event", event);
      return makeResult(code, "ime-event", { captured, passthrough: true });
    }

    if (eventType === "keydown") {
      if (reservedHeld.has(code)) {
        return makeResult(code, "reserved-held", { captured, reserved: true });
      }
      if (passthroughHeld.has(code)) {
        return makeResult(code, "passthrough-held", { captured, passthrough: true });
      }
      if (matchesReserved(event)) {
        for (const prefix of prefixCodesForChord()) reservedHeld.add(prefix);
        pendingModifiers.clear();
        reservedHeld.add(code);
        stopPropagation(event);
        callSafely(onReserved, event, (reason, value, error) => {
          diagnostic(reason, value, error);
        }, "reserved-callback-error");
        return makeResult(code, "reserved-view-toggle", {
          captured,
          reserved: true,
        });
      }
      if (matchesPassthrough(event)) {
        for (const prefix of prefixCodesForChord()) passthroughHeld.add(prefix);
        pendingModifiers.clear();
        passthroughHeld.add(code);
        stopPropagation(event);
        return makeResult(code, "browser-passthrough", {
          captured,
          passthrough: true,
        });
      }
      if (modifier) {
        if (event?.repeat === true || pendingModifiers.has(code)) {
          diagnostic(event?.repeat === true ? "repeat-modifier" : "duplicate-modifier", event);
          return makeResult(code, event?.repeat === true ? "repeat-modifier" : "duplicate-modifier", {
            captured,
            prevented: false,
          });
        }
        pendingModifiers.set(code, event);
        // Do not cancel a modifier before we know whether it prefixes a browser-owned shortcut.
        // Modifiers have no useful standalone browser default; the dependent key receives the
        // ordinary captured decision once the chord is known.
        return makeResult(code, "modifier-prefix", { captured, prevented: false });
      }
      const prevented = prevent(event);
      const flushed = flushModifiers();
      const forwarded = guest(event) || flushed;
      return makeResult(code, "captured-keydown", { captured, prevented, forwarded });
    }

    if (eventType === "keyup") {
      if (reservedHeld.has(code)) {
        reservedHeld.delete(code);
        return makeResult(code, "reserved-keyup", { captured, reserved: true });
      }
      if (passthroughHeld.has(code)) {
        passthroughHeld.delete(code);
        return makeResult(code, "passthrough-keyup", { captured, passthrough: true });
      }
      if (modifier && pendingModifiers.has(code)) {
        pendingModifiers.delete(code);
        return makeResult(code, "modifier-prefix-keyup", { captured, prevented: false });
      }
      const prevented = prevent(event);
      const forwarded = guest(event);
      return makeResult(code, "captured-keyup", { captured, prevented, forwarded });
    }

    diagnostic("unsupported-event", event);
    return makeResult(code, "unsupported-event", { captured });
  }

  function handleKeyEvent(event) {
    const code = codeOf(event);
    if (event?.type !== "keydown" && event?.type !== "keyup") {
      diagnostic("unsupported-event", event);
      return makeResult(code, "unsupported-event", { captured });
    }
    if (!captured) return makeResult(code, "capture-off", { captured: false });
    return handleCaptured(event);
  }

  function setCaptured(value) {
    const next = Boolean(value);
    if (captured === next) return captured;
    captured = next;
    clearTransientState();
    stateChanged();
    return captured;
  }

  function toggle() {
    return setCaptured(!captured);
  }

  stateChanged();

  return {
    handleKeyEvent,
    isCaptured: () => captured,
    setCaptured,
    toggle,
    pendingModifierCodes: pendingCodes,
    passthroughCodes: () => [...passthroughHeld],
    reservedCodes: () => [...reservedHeld],
    clearTransientState,
  };
}

/** Attach policy listeners without hiding the policy's preventDefault decision. */
export function attachKeyboardCapture(target, policy, options = { capture: true }) {
  if (!target || typeof target.addEventListener !== "function") {
    throw new TypeError("keyboard capture target must support addEventListener");
  }
  if (typeof policy?.handleKeyEvent !== "function") {
    throw new TypeError("keyboard capture policy requires handleKeyEvent");
  }
  const listener = (event) => policy.handleKeyEvent(event);
  target.addEventListener("keydown", listener, options);
  target.addEventListener("keyup", listener, options);
  return () => {
    target.removeEventListener?.("keydown", listener, options);
    target.removeEventListener?.("keyup", listener, options);
  };
}
