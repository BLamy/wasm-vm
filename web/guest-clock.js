// E5-T26i: opt-in browser clock policy, kept separate from the RTC and scheduler.
// The WASM adapter owns actual timekeeping; these checks fail before boot side effects.
function clockLabel(mode) {
  if (mode !== "icount" && mode !== "wall" && mode !== "paced-icount") {
    throw new RangeError(`unsupported guestClock: ${String(mode)}`);
  }
  return mode;
}

export function validateGuestClock(mode = "icount", realm = globalThis) {
  clockLabel(mode);
  if (mode !== "icount") {
    const source = realm?.performance;
    if (typeof source?.now !== "function") {
      throw new Error(`${mode} guestClock requires a monotonic performance.now source`);
    }
    const sample = source.now();
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error(`${mode} guestClock requires a finite nonnegative monotonic source`);
    }
  }
  return mode;
}

export function validateInteractiveClock(policy, mode = "icount", realm = globalThis) {
  if (policy === undefined) return undefined;
  if (policy !== "wall-on-keyboard" && policy !== "paced-on-keyboard") throw new RangeError("unsupported interactiveClock");
  if (mode !== "icount") throw new RangeError("interactiveClock requires guestClock=icount");
  validateGuestClock(policy === "paced-on-keyboard" ? "paced-icount" : "wall", realm);
  return policy;
}

// Query strings use exact decimal notation. The WASM boundary receives only the validated number.
export function validateICountDivider(value, mode = "icount") {
  if (value === undefined) return undefined;
  clockLabel(mode);
  if (mode !== "icount") throw new RangeError("icountDivider requires guestClock=icount");
  const divider = typeof value === "string" && /^[1-9][0-9]{0,3}$/.test(value) ? Number(value) : value;
  if (typeof divider !== "number" || !Number.isInteger(divider) || divider < 1 || divider > 1024) {
    throw new RangeError("icountDivider must be an integer from 1 to 1024");
  }
  return divider;
}

function readICountState(machine) {
  const state = machine.guestClockState();
  if (state?.mode !== "icount" || !Number.isSafeInteger(state.clockDiv) || state.clockDiv < 1 ||
      state.timebaseHz !== 10_000_000 || typeof state.mtime !== "string" || !/^[0-9]+$/.test(state.mtime)) {
    throw new Error("icountDivider requires actual valid ICount state");
  }
  return Object.freeze({ mode: state.mode, clockDiv: state.clockDiv,
    timebaseHz: state.timebaseHz, mtime: state.mtime });
}

// Apply only AFTER a boot snapshot is restored, but BEFORE the first execution slice.
// Explicit pauses freeze guest time; unpaused background gaps are left to the core policy.
export function createGuestClockLifecycle(machine, mode = "icount", requestedDivider = undefined, interactiveClock = undefined) {
  clockLabel(mode);
  validateInteractiveClock(interactiveClock, mode);
  const divider = validateICountDivider(requestedDivider, mode);
  if (mode !== "icount" || interactiveClock !== undefined) {
    for (const method of ["setGuestClock", "rebaseGuestClock", "guestClockState"]) {
      if (typeof machine?.[method] !== "function") {
        throw new Error(`wall guestClock requires WASM ${method}`);
      }
    }
  }
  let selection = null;
  if (divider !== undefined) {
    for (const method of ["setICountDivider", "guestClockState"]) {
      if (typeof machine?.[method] !== "function") throw new Error(`icountDivider requires WASM ${method}`);
    }
    const before = readICountState(machine);
    // The actual machine must already be ICount. No implicit wall-mode conversion can precede a
    // failed selection, and no guest execution occurs between the two observations.
    machine.setICountDivider(divider);
    const after = readICountState(machine);
    if (after.clockDiv !== divider || after.mtime !== before.mtime) {
      throw new Error("icountDivider selection changed time or did not reach the actual machine");
    }
    selection = Object.freeze({ requested: divider, before, after });
  } else if (typeof machine?.setGuestClock === "function") machine.setGuestClock(mode);
  let failed = false;
  return {
    dividerSelection() {
      return selection ? { requested: selection.requested, before: { ...selection.before }, after: { ...selection.after } } : null;
    },
    resume() {
      if (failed) throw new Error("interactive clock selection failed; restart required");
      if (mode !== "icount") machine.rebaseGuestClock();
    },
    beforeKeyboardEvent(eventType, code, value) {
      if (failed) throw new Error("interactive clock selection failed; restart required");
      // Match the original keyboard's PC105_KEY_RANGE (keyboard.rs), not browser
      // repeat notifications or a claimed DOM trust bit. Lock repairs qualify.
      if (interactiveClock === undefined || mode !== "icount" || eventType !== 1 || value !== 1 ||
          !Number.isInteger(code) || code < 1 || code > 248) return false;
      try {
        const before = readICountState(machine);
        const selectedMode = interactiveClock === "paced-on-keyboard" ? "paced-icount" : "wall";
        machine.setGuestClock(selectedMode);
        const after = machine.guestClockState();
        if (after?.mode !== selectedMode || after.mtime !== before.mtime ||
            after.timebaseHz !== before.timebaseHz || after.clockDiv !== before.clockDiv) {
          throw new Error(`interactive clock selection changed time or did not reach ${selectedMode} mode`);
        }
        mode = selectedMode;
        return true;
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    state() {
      return typeof machine?.guestClockState === "function" ? machine.guestClockState() : null;
    },
  };
}
