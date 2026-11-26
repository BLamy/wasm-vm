// E5-T37b (promoted by the verifier): the loader's run loop, executed.
//
// tests/e5-t37b-paced-idle.test.mjs pins the idle sleeper and the clock lifecycle and matches the
// loader's source text; it does not run the tick. This file does: it cuts the loader's OWN text —
// the run loop (`tickScheduled` .. the first `schedule()`), the real `stop`/`pause`/`resume` and
// the real controller wrap — out of ../loader.js and runs it against a scripted machine, a task
// queue this test drains by hand and timers it fires by hand. Nothing here re-implements the
// loop. What it holds the loop to:
//   - at most ONE pending tick at any time (a posted task, an armed sleep, or a tick parked on an
//     await), and exactly one while the guest is neither paused nor stopped: no second loop, no
//     stall;
//   - a host call ends an idle sleep in the same turn and the next slice follows with no timer
//     in between; a timer callback that outlives its sleep does nothing;
//   - no slice while paused or stopped; a wait taken before a delivery is never slept on; and no
//     sleep is shorter than 1.5 ms or longer than 50 ms, whatever the machine reports.
//
// If the loader's loop is reshaped, the anchors below stop matching or a new free variable shows
// up as a ReferenceError: update the anchors or the stub list in `build`, not the invariants.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createIdleSleeper } from "../idle-sleep.js";
import { createTaskQuiescence } from "../task-quiescence.js";

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
function between(start, end, inclusiveEnd = true) {
  const i = loader.indexOf(start);
  assert.ok(i >= 0 && loader.indexOf(start, i + 1) < 0, `loader.js anchor must occur exactly once: ${JSON.stringify(start.slice(0, 60))}`);
  const j = loader.indexOf(end, i);
  assert.ok(j >= 0, `loader.js end anchor missing: ${JSON.stringify(end.slice(0, 60))}`);
  return loader.slice(i, inclusiveEnd ? j + end.length : j);
}
const loopText = between("    let tickScheduled = false;\n", "    const tick = () => taskQuiescence.run(runTick);\n    schedule();\n");
const controlText = between("      stop: async () => {\n", "      isPaused: () => paused,\n");
const wrapText = between("    if (guestClockLifecycle.idleYield) {\n      for (const [name, method] of Object.entries(controller)) {", "    return controller;", false);

// The free variables of the three cuts, as a whole-image, non-persistent worker boot has them
// (the only kind of boot the paced policy is admitted for), plus `H`, the scripted world.
const build = new Function("H", `
  let stopped = false, paused = false, quotaPaused = false, quotaReadOnly = false, lastPersistRetry = 0, gpuCaptureBusy = false;
  let inputActive = false, inputStopped = false, inputWriter = null, inputStore = null, productionGpu = null;
  const flushInputRecording = () => Promise.resolve(null), stopInputCapture = async () => {};
  const usePersist = false, lockReadOnly = false, maxDirtyBytes = 0, isChunked = true, workerMode = true;
  let schedulerYields = 0, timerYields = 0, mainThreadYields = 0;
  const workerPostTask = H.postTask, yieldToMain = () => { throw new Error("main-thread yield in worker mode"); };
  const onState = H.onState, onError = H.onError, onQuota = () => {}, onAgentOutput = () => {}, observeCaptureStart = () => {}, emitOutput = () => {};
  const machine = H.machine, guestClockLifecycle = { idleYield: H.idleYield, resume() { H.log.push("clock.resume"); } };
  let runQuantum = 500000, sliceCount = 0, sliceTotalMs = 0, sliceMaxMs = 0, stretchMaxMs = 0, lastSliceStart = 0;
  let requestedInstructions = 0, retiredInstructions = 0, fetchWaits = 0, fetchRequestedChunks = 0, fetchWaitTotalMs = 0, fetchWaitMaxMs = 0;
  const sliceBoundsMs = [4, 8, 16, 32, 64, 128, 256, 512, 1000, Infinity], sliceHistogram = sliceBoundsMs.map(() => 0);
  const createIdleSleeper = H.createIdleSleeper, createTaskQuiescence = H.createTaskQuiescence;
  H.state = () => ({ stopped, paused, tickScheduled, armed: idleSleeper.armed(), stats: idleSleeper.stats(), slices: sliceCount });
  ${loopText}
  const controller = {
    sendInput: (bytes) => { if (!stopped && !gpuCaptureBusy) machine.sendInput(bytes); },
    schedulerStats: () => ({ slices: sliceCount, ...idleSleeper.stats() }),
${controlText}
    whenDone,
  };
  ${wrapText}
  return controller;
`);

// A loop that is wrong must fail, not hang: no scripted world runs more slices than this (a
// runaway loop gets an exception from the machine, which the tick reports as an error), and
// every promise the loop hands out is awaited with a deadline.
const SLICE_CAP = 2_000;
const TEST_TIMEOUT_MS = 30_000;
function within(promise, what, ms = 2_000) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: not settled after ${ms} ms`)), ms); });
  return Promise.race([Promise.resolve(promise), late]).finally(() => clearTimeout(timer));
}

function world({ idleYield = true, waits = () => 50, chunkAwait = () => false } = {}) {
  const tasks = [], timers = new Map(), stale = [], log = [];
  let nextTimer = 1, sliceNo = 0, fetchResolve = null, deliveredSinceTake = false;
  const H = {
    log, idleYield, createTaskQuiescence,
    createIdleSleeper: () => createIdleSleeper({
      setTimer: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); log.push(`timer.set ${ms}`); return id; },
      // A cleared timer's callback is kept: a browser may still run it, and it must do nothing.
      clearTimer: (id) => { const t = timers.get(id); if (t) { timers.delete(id); stale.push(t.fn); log.push("timer.clear"); } },
    }),
    postTask: (fn) => new Promise((resolve, reject) => { tasks.push({ fn, resolve, reject }); }),
    onState: (s) => log.push(`state ${s}`),
    onError: (e) => { log.push(`ERROR ${e?.message ?? e}`); },
    machine: {
      runChunk() {
        const s = H.state();
        if (s.stopped || s.paused) throw new Error("INVARIANT: slice while stopped/paused");
        sliceNo += 1;
        if (sliceNo > SLICE_CAP) throw new Error("INVARIANT: runaway run loop");
        deliveredSinceTake = false; log.push("slice");
        return { retired: 100, done: false };
      },
      takeIdleWaitMs: () => waits(sliceNo),
      sendInput() { deliveredSinceTake = true; log.push("deliver"); },
      inputLifecycle() {},
      pendingChunks: () => (chunkAwait(sliceNo) ? [1] : []),
      fetchStats: () => ({}),
      fetchPending: () => new Promise((resolve) => { fetchResolve = resolve; }),
    },
  };
  const controller = build(H);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  return {
    H, controller, tasks, timers, stale, log, settle,
    pending: () => tasks.length + timers.size,
    runTask: async () => { assert.ok(tasks.length, "a posted tick to run"); const t = tasks.shift(); Promise.resolve().then(t.fn).then(t.resolve, t.reject); await settle(); },
    fireTimer: async () => { assert.ok(timers.size, "an armed timer to fire"); const [id, t] = timers.entries().next().value; timers.delete(id); t.fn(); await settle(); },
    fireStale: async () => { const fn = stale.shift(); fn(); await settle(); },
    resolveFetch: async () => { const r = fetchResolve; fetchResolve = null; r(); await settle(); },
    fetchOpen: () => fetchResolve != null,
    deliveredSinceTake: () => deliveredSinceTake,
    errors: () => log.filter((l) => l.startsWith("ERROR") || l === "state error"),
  };
}
const snapshot = (w) => [w.tasks.length, w.timers.size, w.H.state().armed];
const run = (name, fn) => test(name, { timeout: TEST_TIMEOUT_MS }, fn);

run("a host call during a sleep ends it and one slice runs at once; the stale timer does nothing", async () => {
  const w = world(); await w.settle();
  assert.deepEqual(snapshot(w), [1, 0, false], "boot: one posted tick");
  await w.runTask();
  assert.deepEqual(snapshot(w), [0, 1, true], "an idle slice arms one sleep in place of the next tick");
  assert.deepEqual(w.log.filter((l) => l.startsWith("timer.set")), ["timer.set 50"]);
  w.controller.sendInput(new Uint8Array(1));
  assert.deepEqual(snapshot(w), [1, 0, false], "delivery: timer cleared and one tick posted in the same turn");
  const before = w.H.state().slices;
  await w.fireStale();
  assert.deepEqual([w.tasks.length, w.H.state().slices], [1, before], "the cleared timer's callback: nothing");
  await w.runTask();
  assert.equal(w.H.state().slices, before + 1, "the posted tick ran a slice");
  assert.equal(w.pending(), 1, "one pending tick after it");
  assert.deepEqual(w.log.filter((l) => l === "slice" || l === "deliver").slice(0, 3), ["slice", "deliver", "slice"]);
  assert.deepEqual(w.H.state().stats, { idleSleeps: 2, idleSleepMs: 100, idleWakes: 1 });
  assert.deepEqual(w.errors(), []);
});

run("every controller function ends a sleep, a status read included", async () => {
  const w = world(); await w.settle(); await w.runTask();
  assert.equal(w.H.state().armed, true, "asleep");
  w.controller.schedulerStats();
  assert.deepEqual([w.tasks.length, w.timers.size], [1, 0], "woken");
  assert.deepEqual(w.errors(), []);
});

run("a sleep that nothing ends resumes into exactly one slice; a wait too short for a timer is not slept on", async () => {
  const w = world({ waits: (n) => (n % 2 ? 50 : 1) }); await w.settle(); await w.runTask();
  assert.equal(w.timers.size, 1, "a 50 ms wait sleeps");
  await w.fireTimer();
  assert.deepEqual([w.tasks.length, w.timers.size, w.H.state().slices], [1, 0, 2], "timer -> slice 2 at once (1 ms wait) -> posted tick, no sleep");
  await w.runTask();
  assert.deepEqual([w.tasks.length, w.timers.size, w.H.state().slices], [0, 1, 3], "slice 3 sleeps again");
  assert.deepEqual(w.errors(), []);
});

run("pause during a sleep: no slice while paused; resume, even twice, schedules exactly one tick", async () => {
  const w = world(); await w.settle(); await w.runTask();
  assert.equal(w.H.state().armed, true, "asleep");
  await within(w.controller.pause(), "pause()"); await w.settle();
  const slices = w.H.state().slices;
  assert.deepEqual([w.timers.size, w.H.state().paused], [0, true], "the sleep ended, paused");
  while (w.tasks.length) await w.runTask();
  assert.deepEqual([w.H.state().slices, w.pending(), w.H.state().tickScheduled], [slices, 0, false], "no slice, nothing pending, flag clear");
  w.controller.resume(); w.controller.resume();
  assert.deepEqual([w.tasks.length, w.timers.size], [1, 0], "one tick");
  await w.runTask();
  assert.deepEqual([w.H.state().slices, w.pending()], [slices + 1, 1], "runs again");
  assert.deepEqual(w.errors(), []);
});

run("a rapid pause then resume while asleep leaves one tick, not two", async () => {
  const w = world(); await w.settle(); await w.runTask();
  w.controller.pause(); w.controller.resume(); await w.settle();
  assert.equal(w.pending(), 1, "one pending");
  await w.runTask();
  assert.equal(w.pending(), 1, "still one");
  assert.deepEqual(w.errors(), []);
});

run("stop during a sleep: done resolves 'stopped', no slice afterwards, a late timer or tick is inert", async () => {
  const w = world(); await w.settle(); await w.runTask();
  const slices = w.H.state().slices;
  assert.equal(await within(w.controller.stop(), "stop()"), "stopped");
  assert.equal(w.timers.size, 0, "the sleep was ended by the stop call");
  while (w.tasks.length) await w.runTask();
  while (w.stale.length) await w.fireStale();
  assert.equal(w.H.state().slices, slices, "no slice after stop");
  assert.deepEqual(w.errors(), [], "no error reported after a stop");
});

run("without the policy the wait is never taken, nothing sleeps and the controller is not wrapped", async () => {
  let takes = 0;
  const w = world({ idleYield: false, waits: () => { takes += 1; return 50; } }); await w.settle();
  for (let i = 0; i < 5; i++) {
    await w.runTask();
    assert.deepEqual([w.tasks.length, w.timers.size], [1, 0], "always the next tick, never a timer");
  }
  assert.equal(takes, 0, "takeIdleWaitMs is not called");
  w.controller.sendInput(new Uint8Array(1));
  assert.deepEqual(w.H.state().stats, { idleSleeps: 0, idleSleepMs: 0, idleWakes: 0 });
  assert.equal(w.controller.sendInput.toString().includes("wakeIdle"), false, "the controller method is the original");
  assert.deepEqual(w.errors(), []);
});

run("a delivery during a tick's await voids the wait that tick took", async () => {
  // Not reachable on an admitted boot (its tick awaits nothing after the slice); the ticket is
  // what keeps it safe if a later boot's tick does.
  const w = world({ chunkAwait: (n) => n === 1 }); await w.settle();
  const t = w.tasks.shift(); Promise.resolve().then(t.fn).then(t.resolve, t.reject); await w.settle();
  assert.equal(w.fetchOpen(), true, "the tick is parked on a fetch after taking a 50 ms wait");
  w.controller.sendInput(new Uint8Array(1));
  await w.resolveFetch();
  assert.deepEqual([w.timers.size, w.tasks.length], [0, 1], "no sleep on the stale wait: the next slice is scheduled at once");
  assert.deepEqual(w.errors(), []);
});

// mulberry32: the interleavings are the same on every run.
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const SEEDS = 200, STEPS = 120;
run(`random interleavings (${SEEDS} seeds x ${STEPS} steps): never two pending ticks, never a stall, never a slice while paused or stopped`, async () => {
  let steps = 0, sleeps = 0, wakes = 0, staleFired = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed);
    const w = world({ waits: () => [0, 0, 1, 1.5, 7, 50, 50, 400][Math.floor(r() * 8)], chunkAwait: () => r() < 0.08 });
    await w.settle();
    let stopped = false;
    for (let i = 0; i < STEPS && !stopped; i++) {
      const acts = [];
      if (w.fetchOpen()) acts.push("resolveFetch", "resolveFetch");
      else { if (w.tasks.length) acts.push("task", "task", "task"); if (w.timers.size) acts.push("timer", "timer"); }
      if (w.stale.length) acts.push("stale");
      acts.push("input", "stats");
      if (!w.fetchOpen()) acts.push(w.H.state().paused ? "resume" : "pause");
      if (w.H.state().paused) acts.push("resume");
      if (i > 100 && r() < 0.05 && !w.fetchOpen()) acts.push("stop");
      const act = acts[Math.floor(r() * acts.length)]; steps += 1;
      const at = `seed ${seed} step ${i} (${act})`;
      const wasArmed = w.H.state().armed;
      if (act === "task") await w.runTask();
      else if (act === "timer") await w.fireTimer();
      else if (act === "stale") { await w.fireStale(); staleFired += 1; }
      else if (act === "input") {
        w.controller.sendInput(new Uint8Array(1));
        if (wasArmed) { wakes += 1; assert.deepEqual([w.tasks.length, w.timers.size], [1, 0], `${at}: a delivery to a sleeping guest posts one tick in the same turn`); }
        await w.settle();
      } else if (act === "stats") { w.controller.schedulerStats(); await w.settle(); }
      else if (act === "pause") { await within(w.controller.pause(), `${at}: pause()`); await w.settle(); }
      else if (act === "resume") { w.controller.resume(); await w.settle(); }
      else if (act === "resolveFetch") {
        const delivered = w.deliveredSinceTake();
        await w.resolveFetch();
        assert.ok(!(delivered && w.timers.size), `${at}: slept on a wait taken before a delivery`);
      } else if (act === "stop") { await within(w.controller.stop(), `${at}: stop()`); stopped = true; }
      const s = w.H.state(), inTick = w.fetchOpen() ? 1 : 0, pending = w.tasks.length + w.timers.size + inTick;
      assert.equal(w.timers.size, s.armed ? 1 : 0, `${at}: live timers against the sleeper's own state`);
      // The task's numbers, not the module's constants: the machine's 400 ms wait is slept 50 at
      // a time, and a 1 ms wait is not slept on at all.
      for (const t of w.timers.values()) assert.ok(t.ms >= 1.5 && t.ms <= 50, `${at}: a sleep of ${t.ms} ms`);
      assert.ok(pending <= 1, `${at}: ${pending} pending ticks (tasks ${w.tasks.length}, timers ${w.timers.size}, in-tick ${inTick})`);
      assert.ok(s.stopped || s.paused || pending === 1, `${at}: run loop stalled (nothing pending, not paused)`);
      assert.deepEqual(w.errors(), [], at);
    }
    sleeps += w.H.state().stats.idleSleeps;
  }
  // The walk must actually have reached the states it is about.
  assert.ok(sleeps > 1_000 && wakes > 200 && staleFired > 500, `coverage of the walk: ${JSON.stringify({ steps, sleeps, wakes, staleFired })}`);
});
