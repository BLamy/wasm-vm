// E5-T13b: modifier and lock-key reconciliation layered on the T12b keyboard bridge.
// The module is synchronous by design: callers provide the latest host modifier observation and
// a cached T11 LED observation, so every repair is ordered before the triggering DOM event.

const MODIFIER_GROUPS = Object.freeze([
  Object.freeze({ kind: "Control", codes: Object.freeze(["ControlLeft", "ControlRight"]) }),
  Object.freeze({ kind: "Alt", codes: Object.freeze(["AltLeft", "AltRight"]) }),
  Object.freeze({ kind: "Shift", codes: Object.freeze(["ShiftLeft", "ShiftRight"]) }),
  Object.freeze({ kind: "Meta", codes: Object.freeze(["MetaLeft", "MetaRight"]) }),
]);

const LOCKS = Object.freeze([
  Object.freeze({ kind: "CapsLock", code: "CapsLock", state: "capsLock" }),
  Object.freeze({ kind: "NumLock", code: "NumLock", state: "numLock" }),
]);

function codeOf(event) {
  return typeof event?.code === "string" ? event.code : "";
}

function safeCallback(callback, value) {
  try { callback(value); } catch { /* reconciliation telemetry cannot break input */ }
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : null;
}

function readModifier(event, kind, getModifierState) {
  try {
    const provided = getModifierState?.(event, kind);
    if (typeof provided === "boolean") return provided;
  } catch {
    // Fall through to the native KeyboardEvent method and report no observation if it also fails.
  }
  try {
    const native = event?.getModifierState?.(kind);
    return booleanValue(native);
  } catch {
    return null;
  }
}

function readLockState(value, getHostLockState, getModifierState) {
  if (value && typeof value === "object" &&
      ("capsLock" in value || "numLock" in value)) return value;
  try {
    const provided = getHostLockState?.(value);
    if (provided && typeof provided === "object") return provided;
  } catch {
    // Fall through to the KeyboardEvent modifier-state API.
  }
  const state = {};
  let observed = false;
  for (const lock of LOCKS) {
    const valueForLock = readModifier(value, lock.kind, getModifierState);
    if (valueForLock !== null) {
      state[lock.state] = valueForLock;
      observed = true;
    }
  }
  return observed ? state : null;
}

function guestLedValue(guest, state) {
  if (!guest || typeof guest !== "object") return null;
  return booleanValue(guest[state]);
}

/**
 * Wrap a T12b bridge with focus-recovery reconciliation.
 *
 * `getGuestLedState` should return the latest synchronous T11 LED snapshot. A pending repair is
 * suppressed until that snapshot reports the requested state, which prevents a slow statusq from
 * turning one divergence into an oscillating stream of CapsLock/NumLock pairs.
 */
export function createKeyboardReconciler(
  bridge,
  {
    getModifierState,
    getGuestLedState = () => null,
    getHostLockState,
    onDiagnostic = () => {},
    onStatsChange = () => {},
  } = {},
) {
  if (typeof bridge?.handleKeyEvent !== "function" || typeof bridge?.heldCodes !== "function") {
    throw new TypeError("keyboard reconciler requires a T12 keyboard bridge");
  }

  let modifierRepairs = 0;
  let lockRepairs = 0;
  const pendingLockRepairs = new Map();

  function diagnostic(reason, extra = {}) {
    safeCallback(onDiagnostic, { reason, ...extra });
  }

  function stats() {
    return {
      modifierRepairs,
      lockRepairs,
      pendingLockRepairs: [...pendingLockRepairs.entries()].map(([kind, value]) => ({ kind, value })),
    };
  }

  function notifyStats() {
    safeCallback(onStatsChange, stats());
  }

  function reconcileModifiers(event) {
    if (event?.type !== "keydown" && event?.type !== "keyup") return [];
    const corrections = [];
    for (const group of MODIFIER_GROUPS) {
      const desired = readModifier(event, group.kind, getModifierState);
      if (desired === null || group.codes.includes(codeOf(event))) continue;
      const held = bridge.heldCodes().filter((code) => group.codes.includes(code));
      if (desired && held.length === 0) {
        const synthetic = bridge.handleKeyEvent({
          type: "keydown",
          code: group.codes[0],
          repeat: false,
          reconciliation: true,
        });
        corrections.push(synthetic);
        if (synthetic.forwarded) {
          modifierRepairs += 1;
          diagnostic("modifier-reconciled-down", { kind: group.kind, code: group.codes[0] });
        }
      } else if (!desired && held.length > 0) {
        for (const code of [...held].reverse()) {
          const synthetic = bridge.handleKeyEvent({
            type: "keyup",
            code,
            reconciliation: true,
          });
          corrections.push(synthetic);
          if (synthetic.forwarded || synthetic.reason === "modifier-release-deferred") {
            modifierRepairs += 1;
            diagnostic("modifier-reconciled-up", { kind: group.kind, code });
          }
        }
      }
    }
    if (corrections.length > 0) notifyStats();
    return corrections;
  }

  function reconcileLocks(hostOrEvent = undefined, { skipCode = "" } = {}) {
    const host = readLockState(hostOrEvent, getHostLockState, getModifierState);
    if (!host) return [];
    let guest;
    try { guest = getGuestLedState?.(); } catch { guest = null; }
    const corrections = [];
    for (const lock of LOCKS) {
      if (skipCode === lock.code) continue;
      const desired = booleanValue(host[lock.state]);
      const observed = guestLedValue(guest, lock.state);
      if (desired === null || observed === null) continue;
      if (observed === desired) {
        pendingLockRepairs.delete(lock.kind);
        continue;
      }
      if (pendingLockRepairs.get(lock.kind) === desired) continue;

      const down = bridge.handleKeyEvent({ type: "keydown", code: lock.code, repeat: false, reconciliation: true });
      const up = bridge.handleKeyEvent({ type: "keyup", code: lock.code, reconciliation: true });
      corrections.push(down, up);
      pendingLockRepairs.set(lock.kind, desired);
      if (down.forwarded && up.forwarded) {
        lockRepairs += 1;
        diagnostic("lock-reconciled", { kind: lock.kind, desired });
        notifyStats();
      }
    }
    return corrections;
  }

  function handleKeyEvent(event) {
    const corrections = reconcileModifiers(event);
    const lockCorrections = reconcileLocks(event, { skipCode: codeOf(event) });
    const result = bridge.handleKeyEvent(event);
    return { ...result, corrections, lockCorrections };
  }

  return {
    handleKeyEvent,
    reconcileModifiers,
    reconcileLocks,
    stats,
    pendingLockKinds: () => [...pendingLockRepairs.keys()],
  };
}
