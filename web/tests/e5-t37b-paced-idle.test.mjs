// E5-T37b: the "paced" interactive clock policy and the idle sleep the loader takes for it.
// Unit level; the browser evidence (idle host CPU, guest-time rate, latency) is in the task.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createIdleSleeper, IDLE_SLEEP_MAX_MS, IDLE_SLEEP_MIN_MS } from "../idle-sleep.js";
import { createGuestClockLifecycle, PACED_BUSY_LAG_MS, validateInteractiveClock } from "../guest-clock.js";

function timers() {
  const armed = new Map(); let next = 1; const log = [];
  return { log, armed,
    setTimer: (fn, ms) => { const id = next++; armed.set(id, fn); log.push(["set", id, ms]); return id; },
    clearTimer: (id) => { log.push(["clear", id]); armed.delete(id); },
    fire: (id) => { const fn = armed.get(id); armed.delete(id); fn(); } };
}

test("a sleep is armed only for a wait worth a timer, is clamped, and resumes once", () => {
  const t = timers(); let resumed = 0;
  const sleeper = createIdleSleeper(t);
  for (const ms of [undefined, null, NaN, "20", 0, -5, 1, IDLE_SLEEP_MIN_MS - 0.01, {}, [20]]) {
    assert.equal(sleeper.sleep(ms, () => { resumed += 1; }), false, `no sleep for ${String(ms)}`);
  }
  assert.equal(sleeper.sleep(20, "not a function"), false);
  assert.deepEqual(t.log, []); assert.equal(sleeper.armed(), false);

  assert.equal(sleeper.sleep(20, () => { resumed += 1; }), true);
  assert.deepEqual(t.log, [["set", 1, 20]]); assert.equal(sleeper.armed(), true);
  assert.equal(sleeper.sleep(30, () => assert.fail("a second sleep must not be armed")), false);
  t.fire(1);
  assert.equal(resumed, 1); assert.equal(sleeper.armed(), false);

  // The guest's timer may be minutes away; the sleep is never longer than the cap.
  for (const ms of [IDLE_SLEEP_MAX_MS, IDLE_SLEEP_MAX_MS + 1, 60_000, Infinity]) {
    assert.equal(sleeper.sleep(ms, () => { resumed += 1; }), true);
    assert.equal(t.log.at(-1)[2], IDLE_SLEEP_MAX_MS);
    t.fire(t.log.at(-1)[1]);
  }
  assert.equal(sleeper.sleep(IDLE_SLEEP_MIN_MS, () => { resumed += 1; }), true, "the minimum itself sleeps");
  assert.equal(t.log.at(-1)[2], IDLE_SLEEP_MIN_MS);
  t.fire(t.log.at(-1)[1]);
  assert.equal(resumed, 6);
  assert.deepEqual(sleeper.stats(), { idleSleeps: 6, idleSleepMs: 20 + 4 * IDLE_SLEEP_MAX_MS + IDLE_SLEEP_MIN_MS, idleWakes: 0 });
});

test("a wake ends the sleep, cancels its timer and suppresses its resume", () => {
  const t = timers(); let resumed = 0;
  const sleeper = createIdleSleeper(t);
  assert.equal(sleeper.wake(), false, "nothing to wake");
  assert.equal(sleeper.sleep(40, () => { resumed += 1; }), true);
  const late = t.armed.get(1);
  assert.equal(sleeper.wake(), true);
  assert.deepEqual(t.log, [["set", 1, 40], ["clear", 1]]);
  assert.equal(sleeper.armed(), false); assert.equal(sleeper.wake(), false);
  late(); // a timer callback that still runs after the clear must do nothing
  assert.equal(resumed, 0);
  // A new sleep can be armed at once, and its own callback still works.
  assert.equal(sleeper.sleep(10, () => { resumed += 1; }), true);
  late(); // the stale callback of the first sleep must not end the second
  assert.equal(sleeper.armed(), true); assert.equal(resumed, 0);
  t.fire(2);
  assert.equal(resumed, 1);
  assert.deepEqual(sleeper.stats(), { idleSleeps: 2, idleSleepMs: 50, idleWakes: 1 });
});

test("a delivery voids a wait that was taken but not slept on yet", () => {
  const t = timers(); let resumed = 0;
  const sleeper = createIdleSleeper(t);
  // The loader's order: ticket and wait right after the slice, sleep at the end of the tick.
  const stale = sleeper.ticket();
  assert.equal(sleeper.delivered(), false, "nothing was asleep");
  assert.equal(sleeper.sleep(20, () => { resumed += 1; }, stale), false, "the wait predates the delivery");
  assert.deepEqual(t.log, []);
  // The next slice's wait is good.
  const fresh = sleeper.ticket();
  assert.notEqual(fresh, stale);
  assert.equal(sleeper.sleep(20, () => { resumed += 1; }, fresh), true);
  // A delivery during the sleep ends it; the caller is told to run a slice now.
  assert.equal(sleeper.delivered(), true);
  assert.equal(sleeper.armed(), false);
  assert.equal(sleeper.sleep(20, () => { resumed += 1; }, fresh), false, "that ticket is spent too");
  // A plain wake (stop) ends a sleep without voiding tickets.
  const next = sleeper.ticket();
  assert.equal(sleeper.sleep(20, () => { resumed += 1; }, next), true);
  assert.equal(sleeper.wake(), true);
  assert.equal(sleeper.sleep(20, () => { resumed += 1; }, next), true);
  t.fire(t.log.at(-1)[1]);
  assert.equal(resumed, 1);
  assert.deepEqual(sleeper.stats(), { idleSleeps: 3, idleSleepMs: 60, idleWakes: 2 });
});

test("the loader takes the wait with a ticket straight after the run slice and every host call voids it", () => {
  const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
  // Nothing between the run slice and the take.
  assert.match(loader, /res = machine\.runChunk\(runQuantum, [^\n]+\);\n(?:\s*\/\/[^\n]*\n)*\s*if \(guestClockLifecycle\.idleYield\) \{ idleTicket = idleSleeper\.ticket\(\); idleMs = machine\.takeIdleWaitMs\(\); \}\n/);
  assert.equal(loader.match(/machine\.takeIdleWaitMs\(/g).length, 1, "taken in one place");
  assert.match(loader, /if \(!sleepIdle\(idleMs, idleTicket\)\) schedule\(\);/);
  // A completed disk read or persist in the same tick cancels the wait.
  assert.equal(loader.match(/idleMs = 0; \/\/ a /g).length, 2);
  // Every function on the controller is wrapped, after the last assignment to it.
  const wrap = loader.indexOf("controller[name] = (...args) => { wakeIdle(); return method.apply(controller, args); };");
  assert.ok(wrap > 0, "wrapper not found");
  assert.match(loader.slice(wrap - 400, wrap), /for \(const \[name, method\] of Object\.entries\(controller\)\) \{\n\s*if \(typeof method !== "function"\) continue;/);
  assert.match(loader.slice(wrap, wrap + 200), /^[^\n]+\n\s*\}\n\s*\}\n\s*return controller;/, "nothing is added to the controller after the wrap");
  assert.match(loader, /const wakeIdle = \(\) => \{\n\s*if \(!idleSleeper\.delivered\(\)\) return;\n\s*tickScheduled = false;\n\s*schedule\(\);\n\s*\};/);
});

test("the defaults use the realm's timers", async () => {
  const sleeper = createIdleSleeper();
  const resumed = new Promise((resolve) => assert.equal(sleeper.sleep(2, resolve), true));
  await resumed;
  assert.equal(sleeper.armed(), false);
});

const realm = { performance: { now: () => 1 } };
function machineFixture({ mode = "icount", clockDiv = 10, mtime = "123456789012345678", drift = false, methods = true } = {}) {
  const calls = []; let state = { mode, clockDiv, timebaseHz: 10_000_000, mtime };
  const machine = {
    guestClockState() { return { ...state }; },
    setICountDivider(divider) { calls.push(["setICountDivider", divider]); state = { ...state, clockDiv: divider }; },
    setGuestClock(next) { calls.push(["setGuestClock", next]); state = { ...state, mode: next, mtime: drift ? "1" : state.mtime }; },
    rebaseGuestClock() { calls.push(["rebaseGuestClock"]); },
  };
  if (methods) {
    machine.setPacedIdlePolicy = (yieldToHost, lagMs) => { calls.push(["setPacedIdlePolicy", yieldToHost, lagMs]); };
    machine.takeIdleWaitMs = () => 0;
  }
  return { machine, calls, state: () => state };
}

test('"paced" is an interactive clock policy of the retire-count clock with a host time source', () => {
  assert.equal(validateInteractiveClock("paced", "icount", realm), "paced");
  assert.equal(validateInteractiveClock(undefined, "icount", realm), undefined);
  for (const mode of ["wall", "paced-icount"]) assert.throws(() => validateInteractiveClock("paced", mode, realm), RangeError);
  for (const policy of ["Paced", "paced ", "pace", "paced-icount", true, 1, null]) assert.throws(() => validateInteractiveClock(policy, "icount", realm), RangeError);
  assert.throws(() => validateInteractiveClock("paced", "icount", {}), /monotonic performance\.now/);
  assert.equal(PACED_BUSY_LAG_MS, 50);
});

test("the paced policy selects the divider, then the paced clock, then the idle policy, before any slice", () => {
  const f = machineFixture({ clockDiv: 10 });
  const lifecycle = createGuestClockLifecycle(f.machine, "icount", 64, "paced");
  assert.deepEqual(f.calls, [["setICountDivider", 64], ["setGuestClock", "paced-icount"], ["setPacedIdlePolicy", true, PACED_BUSY_LAG_MS]]);
  assert.equal(lifecycle.idleYield, true);
  assert.deepEqual(lifecycle.state(), { mode: "paced-icount", clockDiv: 64, timebaseHz: 10_000_000, mtime: "123456789012345678" });
  // Already paced: a key press selects nothing more; an explicit resume rebases the host anchor.
  f.calls.length = 0;
  assert.equal(lifecycle.beforeKeyboardEvent(1, 30, 1), false);
  lifecycle.resume();
  assert.deepEqual(f.calls, [["rebaseGuestClock"]]);

  // Without a divider selection the clock is still selected explicitly first.
  const g = machineFixture();
  assert.equal(createGuestClockLifecycle(g.machine, "icount", undefined, "paced").idleYield, true);
  assert.deepEqual(g.calls, [["setGuestClock", "icount"], ["setGuestClock", "paced-icount"], ["setPacedIdlePolicy", true, PACED_BUSY_LAG_MS]]);
});

test("every other policy leaves the idle policy alone", () => {
  for (const policy of [undefined, "paced-on-keyboard", "wall-on-keyboard"]) {
    const f = machineFixture();
    const lifecycle = createGuestClockLifecycle(f.machine, "icount", 64, policy);
    assert.equal(lifecycle.idleYield, false, String(policy));
    assert.equal(f.calls.some(([name]) => name === "setPacedIdlePolicy"), false);
    assert.equal(f.state().mode, "icount");
  }
});

test("a machine without the idle bindings, or one whose time moves on selection, fails closed", () => {
  const missing = machineFixture({ methods: false });
  assert.throws(() => createGuestClockLifecycle(missing.machine, "icount", 64, "paced"), /requires WASM setPacedIdlePolicy/);
  assert.deepEqual(missing.calls, [], "refused before the divider or the clock is touched");
  const half = machineFixture(); delete half.machine.takeIdleWaitMs;
  assert.throws(() => createGuestClockLifecycle(half.machine, "icount", 64, "paced"), /requires WASM takeIdleWaitMs/);
  assert.deepEqual(half.calls, []);
  const drift = machineFixture({ drift: true });
  assert.throws(() => createGuestClockLifecycle(drift.machine, "icount", 64, "paced"), /changed time or did not reach paced-icount/);
  assert.equal(drift.calls.some(([name]) => name === "setPacedIdlePolicy"), false);
});

test("the Replay desktop asks for the paced policy; ?pace=0 turns it off", () => {
  const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("function replayDesktopBootOptions("), main.indexOf("async function bootReplayDesktop("));
  const matches = [...body.matchAll(/^    interactiveClock: (.+),$/gm)];
  assert.equal(matches.length, 1);
  const evaluate = (search) => vm.runInNewContext(matches[0][1], { URLSearchParams, location: { search } });
  assert.equal(evaluate(""), "paced");
  assert.equal(evaluate("?guest=replay-desktop&desktop=1"), "paced");
  assert.equal(evaluate("?pace=1"), "paced");
  assert.equal(evaluate("?pace=0"), undefined);
  assert.equal(evaluate("?guest=replay-desktop&pace=0&desktop=1"), undefined);
  assert.match(body, /guestClock: "icount",\n    icountDivider: 64,/, "the snapshot identity's clock is unchanged");
});

test("the loader admits the paced policy without accelerated graphics and only that one", () => {
  const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
  const gate = loader.match(/^    if \((interactiveClock !== undefined .*?)\) throw new Error\("interactiveClock requires accelerated graphics"\);$/m)?.[1];
  assert.ok(gate, "gate not found");
  const refused = (interactiveClock, virgl) => vm.runInNewContext(gate, { interactiveClock, virgl });
  assert.equal(refused("paced", false), false);
  assert.equal(refused("paced", undefined), false);
  assert.equal(refused(undefined, false), false);
  for (const policy of ["paced-on-keyboard", "wall-on-keyboard"]) {
    assert.equal(refused(policy, false), true);
    assert.equal(refused(policy, true), false);
  }
});
