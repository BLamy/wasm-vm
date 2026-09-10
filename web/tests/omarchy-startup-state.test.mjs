import assert from "node:assert/strict";
import test from "node:test";
import {
  createOmarchyStartupLifecycle,
  formatOmarchyProgress,
  omarchyGuestStateLabel,
} from "../omarchy-startup-state.js";

function fakeTimers() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    pending() {
      return timers.size;
    },
  };
}

test("progress labels are human-friendly and unpacking never exposes a stale bar", () => {
  assert.deepEqual(
    formatOmarchyProgress({ phase: "chunkManifest: downloading", loaded: 512, total: 1024 }),
    {
      text: "Downloading chunk manifest…",
      role: "chunkManifest",
      roleLabel: "chunk manifest",
      phase: "downloading",
      note: null,
      loaded: 512,
      total: 1024,
      determinate: true,
    },
  );
  assert.equal(
    formatOmarchyProgress({ phase: "bootSnapshot: reading cache", loaded: 1, total: 2 }).text,
    "Reading cache for boot snapshot…",
  );
  const unavailable = formatOmarchyProgress({
    phase: "kernel: downloading (cache unavailable)",
    loaded: 1,
    total: 2,
  });
  assert.equal(unavailable.text, "Downloading kernel (cache unavailable)…");
  assert.equal(unavailable.note, "cache unavailable");
  assert.equal(
    formatOmarchyProgress({ phase: "bootSnapshot: unpacking", loaded: null, total: null }).determinate,
    false,
  );
  assert.equal(omarchyGuestStateLabel("restored"), "Desktop restored; waiting for guest response…");
  assert.equal(omarchyGuestStateLabel("unknown"), null);
});

test("guest-response feedback is bounded and cancelled by lifecycle edges", () => {
  const clock = fakeTimers();
  const waiting = [];
  const lifecycle = createOmarchyStartupLifecycle({
    waitMs: 15_000,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    onWaiting: () => waiting.push("waiting"),
  });

  lifecycle.state("restored");
  clock.advance(14_999);
  assert.deepEqual(waiting, []);
  clock.advance(1);
  assert.deepEqual(waiting, ["waiting"]);
  assert.equal(clock.pending(), 0);

  lifecycle.booting();
  lifecycle.state("restored");
  lifecycle.guestReady();
  clock.advance(14_999);
  assert.deepEqual(waiting, ["waiting"]);
  clock.advance(1);
  assert.deepEqual(waiting, ["waiting", "waiting"]);

  lifecycle.state("restored");
  lifecycle.error();
  clock.advance(15_000);
  assert.deepEqual(waiting, ["waiting", "waiting"]);
  lifecycle.state("restored");
  lifecycle.halted();
  clock.advance(15_000);
  assert.deepEqual(waiting, ["waiting", "waiting"]);
});

test("desktop readiness is sticky against later generic lifecycle traffic until a new boot", () => {
  const clock = fakeTimers();
  let waiting = 0;
  const lifecycle = createOmarchyStartupLifecycle({
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    onWaiting: () => { waiting += 1; },
  });

  lifecycle.desktopReady();
  assert.equal(lifecycle.isDesktopReady(), true);
  lifecycle.state("restored");
  clock.advance(15_000);
  assert.equal(waiting, 0);
  lifecycle.booting();
  assert.equal(lifecycle.isDesktopReady(), false);
  lifecycle.state("restored");
  clock.advance(15_000);
  assert.equal(waiting, 1);
});
