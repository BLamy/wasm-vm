// E5-T37b: let the run loop sleep while a paced guest waits for its next timer.
//
// After a run slice the machine may report that the guest went idle and how long until the
// timer it is waiting for (`takeIdleWaitMs`). Instead of scheduling the next slice at once the
// loader arms one sleep here; a host call that may deliver something to the guest (input, a
// resize, a command) ends the sleep first.
//
// The machine's answer speaks for the guest as the run slice left it. Anything the host
// delivers afterwards may be exactly what the guest was waiting for, so a delivery also voids
// a wait that was taken but not slept on yet: the loader takes a `ticket` with the wait, and
// `sleep` refuses a ticket older than the last delivery.

// A wait shorter than this is not worth a timer: nested timers are clamped to about 4 ms, so a
// 1 ms wait would turn into 4. The loader runs the next slice at once instead.
export const IDLE_SLEEP_MIN_MS = 1.5;
// No sleep is longer than this, however far away the guest's timer is. It bounds how late the
// guest notices anything that should have ended the sleep and did not.
export const IDLE_SLEEP_MAX_MS = 50;

export function createIdleSleeper({
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (handle) => globalThis.clearTimeout(handle),
  minMs = IDLE_SLEEP_MIN_MS,
  maxMs = IDLE_SLEEP_MAX_MS,
} = {}) {
  let armed = false, handle, generation = 0, deliveries = 0, sleeps = 0, sleepMs = 0, wakes = 0;
  // End an armed sleep now; its `resume` is not called. Returns whether one was armed.
  const wake = () => {
    if (!armed) return false;
    armed = false;
    clearTimer(handle);
    handle = undefined;
    wakes += 1;
    return true;
  };
  return {
    // Take together with the machine's wait, right after the run slice and before anything
    // else runs; pass it to `sleep`.
    ticket: () => deliveries,
    // Arm one sleep of `ms`, at most `maxMs`, and call `resume` when it ends. Returns false and
    // arms nothing when `ms` is not a number of at least `minMs`, a sleep is already armed, or
    // the host delivered something since `ticket` was taken.
    sleep(ms, resume, ticket = deliveries) {
      if (armed || ticket !== deliveries || typeof ms !== "number" || !(ms >= minMs) || typeof resume !== "function") return false;
      const duration = Math.min(ms, maxMs);
      armed = true;
      sleeps += 1;
      sleepMs += duration;
      const mine = ++generation;
      handle = setTimer(() => {
        // Only the sleep this timer was armed for: a callback that outlives a wake must not end
        // a later sleep.
        if (!armed || mine !== generation) return;
        armed = false;
        handle = undefined;
        resume();
      }, duration);
      return true;
    },
    wake,
    // The host is about to deliver something to the guest. Voids every ticket taken so far and
    // ends an armed sleep; returns whether one was armed (the caller then runs a slice now).
    delivered() {
      deliveries += 1;
      return wake();
    },
    armed: () => armed,
    stats: () => ({ idleSleeps: sleeps, idleSleepMs: sleepMs, idleWakes: wakes }),
  };
}
