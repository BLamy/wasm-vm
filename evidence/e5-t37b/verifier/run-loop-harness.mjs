// Verifier (E5-T37b): run the loader's OWN run-loop text (web/loader.js: tickScheduled .. the
// first schedule(), the real stop/pause/resume bodies, and the real controller wrap) against a
// scripted machine, a fake task queue and fake timers. Nothing here re-implements the loop.
//   node run-loop-harness.mjs <web-dir> [seeds=300]
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const web = path.resolve(process.argv[2]); const SEEDS = Number(process.argv[3] ?? 300);
const loader = readFileSync(path.join(web, "loader.js"), "utf8");
const { createIdleSleeper } = await import(pathToFileURL(path.join(web, "idle-sleep.js")).href);
const { createTaskQuiescence } = await import(pathToFileURL(path.join(web, "task-quiescence.js")).href);
const between = (a, b, inclusiveEnd = true) => { const i = loader.indexOf(a); if (i < 0 || loader.indexOf(a, i + 1) >= 0) throw new Error("anchor not unique: " + a.slice(0, 50));
  const j = loader.indexOf(b, i); if (j < 0) throw new Error("end anchor missing: " + b.slice(0, 50)); return loader.slice(i, inclusiveEnd ? j + b.length : j); };
const loopText = between("    let tickScheduled = false;\n", "    const tick = () => taskQuiescence.run(runTick);\n    schedule();\n");
const controlText = between("      stop: async () => {\n", "      isPaused: () => paused,\n");
const wrapText = between(process.env.HARNESS_WRAP_ANCHOR || "    if (guestClockLifecycle.idleYield) {\n      for (const [name, method] of Object.entries(controller)) {", "    return controller;", false);
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
  const whenDoneRef = whenDone;
  const controller = {
    sendInput: (bytes) => { if (!stopped && !gpuCaptureBusy) machine.sendInput(bytes); },
    schedulerStats: () => ({ slices: sliceCount, ...idleSleeper.stats() }),
${controlText}
    whenDone,
  };
  ${wrapText}
  return controller;
`);
function world({ idleYield = true, waits = () => 50, chunkAwait = () => false } = {}) {
  const tasks = [], timers = new Map(), stale = [], log = []; let nextTimer = 1, sliceNo = 0, fetchResolve = null, deliveredSinceTake = false, lastTake = 0;
  const H = { log, idleYield, createTaskQuiescence,
    createIdleSleeper: () => createIdleSleeper({ setTimer: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); log.push(`timer.set ${ms}`); return id; },
      clearTimer: (id) => { const t = timers.get(id); if (t) { timers.delete(id); stale.push(t.fn); log.push("timer.clear"); } } }),
    postTask: (fn) => new Promise((resolve, reject) => { tasks.push({ fn, resolve, reject }); }),
    onState: (s) => log.push("state " + s), onError: (e) => { log.push("ERROR " + (e?.message ?? e)); },
    machine: {
      runChunk() { const s = H.state(); if (s.stopped || s.paused) throw new Error("INVARIANT: slice while stopped/paused"); sliceNo += 1; deliveredSinceTake = false; log.push("slice"); return { retired: 100, done: false }; },
      takeIdleWaitMs() { lastTake = waits(sliceNo); return lastTake; },
      sendInput() { deliveredSinceTake = true; log.push("deliver"); },
      inputLifecycle() {}, pendingChunks: () => (chunkAwait(sliceNo) ? [1] : []), fetchStats: () => ({}),
      fetchPending: () => new Promise((resolve) => { fetchResolve = resolve; }),
    } };
  const controller = build(H);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const pending = () => tasks.length + timers.size;
  return { H, controller, tasks, timers, stale, log, settle, pending,
    runTask: async () => { const t = tasks.shift(); Promise.resolve().then(t.fn).then(t.resolve, t.reject); await settle(); },
    fireTimer: async () => { const [id, t] = timers.entries().next().value; timers.delete(id); t.fn(); await settle(); },
    fireStale: async () => { const fn = stale.shift(); fn(); await settle(); },
    resolveFetch: async () => { const r = fetchResolve; fetchResolve = null; r(); await settle(); },
    fetchOpen: () => fetchResolve != null, deliveredSinceTake: () => deliveredSinceTake, lastTake: () => lastTake };
}
const results = []; const check = (name, fn) => fn().then(() => results.push({ name, ok: true }), (e) => results.push({ name, ok: false, error: String(e?.message ?? e) }));
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

await check("A1 a host call during a sleep ends it and one slice runs at once; the stale timer does nothing", async () => {
  const w = world(); await w.settle(); eq([w.tasks.length, w.timers.size], [1, 0], "boot: one posted tick");
  await w.runTask(); eq([w.tasks.length, w.timers.size, w.H.state().armed], [0, 1, true], "idle slice arms one sleep");
  w.controller.sendInput(new Uint8Array(1)); eq([w.tasks.length, w.timers.size, w.H.state().armed], [1, 0, false], "delivery: timer cleared, one tick posted in the same turn");
  const before = w.H.state().slices; await w.fireStale(); eq([w.tasks.length, w.H.state().slices], [1, before], "stale callback: nothing");
  await w.runTask(); eq(w.H.state().slices, before + 1, "the posted tick ran a slice"); eq(w.pending(), 1, "one pending after");
  eq(w.log.filter((l) => l === "slice" || l === "deliver").slice(0, 3), ["slice", "deliver", "slice"], "the delivery is followed by a slice with no timer in between");
});
await check("A1b a status read during a sleep also ends it (every controller function is wrapped)", async () => {
  const w = world(); await w.settle(); await w.runTask(); eq(w.H.state().armed, true, "asleep");
  w.controller.schedulerStats(); eq([w.tasks.length, w.timers.size], [1, 0], "woken");
});
await check("A2 timer end resumes into exactly one tick; short waits are not slept on", async () => {
  const w = world({ waits: (n) => (n % 2 ? 50 : 1) }); await w.settle(); await w.runTask(); eq(w.timers.size, 1, "50 ms wait sleeps");
  await w.fireTimer(); eq([w.tasks.length, w.timers.size, w.H.state().slices], [1, 0, 2], "timer -> slice 2 (1 ms wait) -> posted tick, no sleep");
  await w.runTask(); eq([w.tasks.length, w.timers.size, w.H.state().slices], [0, 1, 3], "slice 3 sleeps again");
});
await check("A5 pause during a sleep: no slice while paused; resume schedules exactly one tick", async () => {
  const w = world(); await w.settle(); await w.runTask(); eq(w.H.state().armed, true, "asleep");
  await w.controller.pause(); await w.settle(); const s = w.H.state().slices; eq([w.timers.size, w.H.state().paused], [0, true], "sleep ended, paused");
  while (w.tasks.length) await w.runTask(); eq([w.H.state().slices, w.pending(), w.H.state().tickScheduled], [s, 0, false], "no slice, nothing pending, flag clear");
  w.controller.resume(); w.controller.resume(); eq([w.tasks.length, w.timers.size], [1, 0], "resume twice: one tick");
  await w.runTask(); eq([w.H.state().slices, w.pending()], [s + 1, 1], "runs again");
});
await check("A5b rapid pause->resume while asleep leaves one tick, not two", async () => {
  const w = world(); await w.settle(); await w.runTask();
  w.controller.pause(); w.controller.resume(); await w.settle(); eq(w.pending(), 1, "one pending"); await w.runTask(); eq(w.pending(), 1, "still one");
});
await check("A5c stop during a sleep: done resolves 'stopped', no slice afterwards, a late timer or tick is inert", async () => {
  const w = world(); await w.settle(); await w.runTask(); const s = w.H.state().slices;
  const done = await w.controller.stop(); eq(done, "stopped", "whenDone"); eq(w.timers.size, 0, "sleep ended by the stop call");
  while (w.tasks.length) await w.runTask(); while (w.stale.length) await w.fireStale(); eq(w.H.state().slices, s, "no slice after stop");
  eq(w.log.filter((l) => l.startsWith("ERROR") || l === "state error"), [], "no error reported after a stop");
});
await check("A8/A9 without the policy: the wait is never taken, nothing sleeps, the controller is not wrapped", async () => {
  let takes = 0; const w = world({ idleYield: false, waits: () => { takes += 1; return 50; } }); await w.settle();
  for (let i = 0; i < 5; i++) { await w.runTask(); eq([w.tasks.length, w.timers.size], [1, 0], "always the next tick, never a timer"); }
  eq(takes, 0, "takeIdleWaitMs not called"); w.controller.sendInput(new Uint8Array(1)); eq(w.H.state().stats, { idleSleeps: 0, idleSleepMs: 0, idleWakes: 0 }, "no sleeps, no wakes");
  eq(w.controller.sendInput.toString().includes("wakeIdle"), false, "controller method is the original");
});
await check("TICKET a delivery during a tick's await voids the wait that tick took (needs an await: not reachable on an admitted boot)", async () => {
  const w = world({ chunkAwait: (n) => n === 1 }); await w.settle();
  const t = w.tasks.shift(); Promise.resolve().then(t.fn).then(t.resolve, t.reject); await w.settle(); eq(w.fetchOpen(), true, "tick parked on the fetch after taking a 50 ms wait");
  w.controller.sendInput(new Uint8Array(1)); await w.resolveFetch();
  eq([w.timers.size, w.tasks.length], [0, 1], "no sleep on the stale wait: the next slice is scheduled at once");
});
// Random interleavings.
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
await check(`A2 random interleavings (${SEEDS} seeds x 120 steps): never two pending ticks, never a stall, never a slice while paused/stopped`, async () => {
  let steps = 0, sleeps = 0, wakes = 0, staleFired = 0, inTickDeliveries = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed); const w = world({ waits: () => [0, 0, 1, 1.5, 7, 50, 50, 400][Math.floor(r() * 8)], chunkAwait: () => r() < 0.08 }); await w.settle();
    let stopped = false, tookAtAwait = null;
    for (let i = 0; i < 120 && !stopped; i++) {
      const acts = [];
      if (w.fetchOpen()) acts.push("resolveFetch", "resolveFetch"); else { if (w.tasks.length) acts.push("task", "task", "task"); if (w.timers.size) acts.push("timer", "timer"); }
      if (w.stale.length) acts.push("stale");
      acts.push("input", "stats"); if (!w.fetchOpen()) acts.push(w.H.state().paused ? "resume" : "pause"); if (w.H.state().paused) acts.push("resume");
      if (i > 100 && r() < 0.05 && !w.fetchOpen()) acts.push("stop");
      const act = acts[Math.floor(r() * acts.length)]; steps += 1;
      const beforeArmed = w.H.state().armed;
      if (act === "task") await w.runTask(); else if (act === "timer") await w.fireTimer(); else if (act === "stale") { await w.fireStale(); staleFired += 1; }
      else if (act === "input") { if (w.fetchOpen()) inTickDeliveries += 1; w.controller.sendInput(new Uint8Array(1)); if (beforeArmed) { wakes += 1; eq([w.tasks.length, w.timers.size], [1, 0], `seed ${seed} step ${i}: wake`); } await w.settle(); }
      else if (act === "stats") { w.controller.schedulerStats(); await w.settle(); }
      else if (act === "pause") { await w.controller.pause(); await w.settle(); } else if (act === "resume") { w.controller.resume(); await w.settle(); }
      else if (act === "resolveFetch") { const delivered = w.deliveredSinceTake(); await w.resolveFetch(); if (delivered && w.timers.size) throw new Error(`seed ${seed} step ${i}: slept on a wait taken before a delivery`); }
      else if (act === "stop") { await w.controller.stop(); stopped = true; }
      const s = w.H.state(); const inTick = w.fetchOpen() ? 1 : 0; const n = w.tasks.length + w.timers.size + inTick;
      if (w.timers.size !== (s.armed ? 1 : 0)) throw new Error(`seed ${seed} step ${i} (${act}): ${w.timers.size} live timers, armed ${s.armed}`);
      if (n > 1) throw new Error(`seed ${seed} step ${i} (${act}): ${n} pending ticks (tasks ${w.tasks.length}, timers ${w.timers.size}, in-tick ${inTick})`);
      if (!s.stopped && !s.paused && n !== 1) throw new Error(`seed ${seed} step ${i} (${act}): run loop stalled (nothing pending, not paused)`);
      if (w.log.some((l) => l.startsWith("ERROR"))) throw new Error(`seed ${seed} step ${i} (${act}): ${w.log.find((l) => l.startsWith("ERROR"))}`);
    }
    sleeps += w.H.state().stats.idleSleeps;
  }
  results.push({ name: "  (interleaving totals)", ok: true, steps, sleeps, wakes, staleFired, inTickDeliveries });
});
console.log(JSON.stringify({ web, results }, null, 1));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
