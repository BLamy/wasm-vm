// E5-T26i: opt-in browser clock policy, kept separate from the RTC and scheduler.
// The WASM adapter owns actual timekeeping; these checks fail before boot side effects.
function clockLabel(mode) {
  if (mode !== "icount" && mode !== "wall") {
    throw new RangeError(`unsupported guestClock: ${String(mode)}`);
  }
  return mode;
}

export function validateGuestClock(mode = "icount", realm = globalThis) {
  clockLabel(mode);
  if (mode === "wall") {
    const source = realm?.performance;
    if (typeof source?.now !== "function") {
      throw new Error("wall guestClock requires a monotonic performance.now source");
    }
    const sample = source.now();
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error("wall guestClock requires a finite nonnegative monotonic source");
    }
  }
  return mode;
}

// Apply only AFTER a boot snapshot is restored, but BEFORE the first execution slice.
// Explicit pauses freeze guest time; unpaused background gaps are left to the core policy.
export function createGuestClockLifecycle(machine, mode = "icount") {
  clockLabel(mode);
  if (mode === "wall") {
    for (const method of ["setGuestClock", "rebaseGuestClock", "guestClockState"]) {
      if (typeof machine?.[method] !== "function") {
        throw new Error(`wall guestClock requires WASM ${method}`);
      }
    }
  }
  if (typeof machine?.setGuestClock === "function") machine.setGuestClock(mode);
  return {
    resume() {
      if (mode === "wall") machine.rebaseGuestClock();
    },
    state() {
      return typeof machine?.guestClockState === "function" ? machine.guestClockState() : null;
    },
  };
}
