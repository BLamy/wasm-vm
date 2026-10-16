// E5-T13a: the host-side ledger for physical keys believed held by the guest.
// Keep this module independent from DOM and evdev details so lifecycle cleanup can be tested with
// synthetic targets and reused by the browser integration.

function report(onDiagnostic, reason, code = "") {
  try { onDiagnostic({ reason, code }); } catch { /* diagnostics never break input cleanup */ }
}

/**
 * Track physical key state with idempotent make/break operations.
 *
 * Values are deliberately opaque to the ledger. The keyboard bridge stores evdev/modifier
 * metadata there, while tests and future input devices can store their own release information.
 */
export function createHeldKeyLedger({ onDiagnostic = () => {}, onRelease = () => {} } = {}) {
  const held = new Map();

  function press(code, value = {}) {
    if (typeof code !== "string" || code.length === 0) {
      report(onDiagnostic, "invalid-key-code", typeof code === "string" ? code : "");
      return { accepted: false, code: typeof code === "string" ? code : "", reason: "invalid-key-code" };
    }
    const prior = held.get(code);
    if (prior !== undefined) {
      report(onDiagnostic, "duplicate-keydown", code);
      return { accepted: false, code, value: prior, reason: "duplicate-keydown" };
    }
    held.set(code, value);
    return { accepted: true, code, value };
  }

  function release(code) {
    if (!held.has(code)) {
      report(onDiagnostic, "orphan-keyup", typeof code === "string" ? code : "");
      return null;
    }
    const value = held.get(code);
    held.delete(code);
    return value;
  }

  function releaseAll(callback = onRelease) {
    if (typeof callback !== "function") throw new TypeError("releaseAll callback must be a function");

    const order = [...held.entries()];
    const records = [];
    // Release dependent keys before modifiers, and unwind each group in reverse make order.
    for (const modifier of [false, true]) {
      for (const [code, value] of [...order].reverse()) {
        if (Boolean(value?.modifier) !== modifier || !held.has(code)) continue;
        records.push({ code, value });
      }
    }
    // Clear before callbacks so a re-entrant lifecycle notification cannot emit a second break.
    for (const { code } of records) held.delete(code);
    for (const { code, value } of records) callback(code, value);
    return records;
  }

  function reset() {
    const records = [...held.entries()].map(([code, value]) => ({ code, value }));
    held.clear();
    return records;
  }

  return {
    press,
    release,
    releaseAll,
    reset,
    has: (code) => held.has(code),
    get: (code) => held.get(code),
    entries: () => [...held.entries()],
    codes: () => [...held.keys()],
    snapshot: () => [...held.entries()].map(([code, value]) => ({ code, value })),
    size: () => held.size,
  };
}

function addListener(registrations, target, type, listener) {
  if (!target || typeof target.addEventListener !== "function") return;
  target.addEventListener(type, listener);
  registrations.push({ target, type, listener });
}

/**
 * Attach every host lifecycle boundary that can strand a physical key.
 * The callback receives a reason string and should call the bridge's releaseAll method.
 */
export function attachHeldKeyLifecycle({
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  viewTarget = windowTarget ?? documentTarget,
  releaseAll,
  isPointerLocked = () => Boolean(documentTarget?.pointerLockElement),
  viewToggleEvent = "wvm:reserved-view-toggle",
} = {}) {
  if (typeof releaseAll !== "function") throw new TypeError("lifecycle hooks require releaseAll");

  const registrations = [];
  const trigger = (reason) => releaseAll(reason);
  addListener(registrations, windowTarget, "blur", () => trigger("blur"));
  addListener(registrations, documentTarget, "visibilitychange", () => {
    if (documentTarget?.hidden === true || documentTarget?.visibilityState === "hidden") {
      trigger("visibility-hidden");
    }
  });
  addListener(registrations, documentTarget, "pointerlockchange", () => {
    let locked = false;
    try { locked = Boolean(isPointerLocked()); } catch { /* a lost target is unlocked */ }
    if (!locked) trigger("pointerlock-lost");
  });
  addListener(registrations, viewTarget, viewToggleEvent, () => trigger("view-toggle"));

  return () => {
    for (const { target, type, listener } of registrations.splice(0).reverse()) {
      target.removeEventListener?.(type, listener);
    }
  };
}
