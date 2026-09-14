import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";

function fixture({ groupAlive = () => false } = {}) {
  const child = new EventEmitter(); child.pid = 123;
  const timers = [], killed = [];
  const result = watchOwnedTrial(child, { now: () => 1000, killGroup: pid => killed.push(pid), groupAlive,
    later: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    cancel: timer => { if (timer) timer.cancelled = true; } });
  return { child, timers, killed, result };
}
test("owned watchdog caps setup and navigation once, and normal close cancels timers", async () => {
  const f = fixture(); assert.equal(f.timers[0].ms, 120000);
  f.child.emit("message", { kind: "input-trial-navigation", startedAtMs: 900 });
  assert.equal(f.timers[0].cancelled, true); assert.equal(f.timers[1].ms, 529900);
  f.child.emit("message", { kind: "input-trial-navigation", startedAtMs: 1000 });
  assert.equal(f.timers.length, 2, "cannot reset lifecycle deadline");
  f.child.emit("close", 1, null);
  assert.deepEqual(await f.result, { code: 1, signal: null, closed: true, watchdog: null });
  assert.equal(f.timers[1].cancelled, true); assert.deepEqual(f.killed, []);
});
test("stalled owned browser/recorder is killed and missing close settles as unconfirmed", async () => {
  const f = fixture({ groupAlive: () => true });
  f.child.emit("message", { kind: "input-trial-owned-browser", pid: -99 });
  f.child.emit("message", { kind: "input-trial-owned-browser", pid: 456 });
  f.timers[0].fn();
  assert.deepEqual(f.killed, [456, 123]);
  assert.equal(f.timers[1].ms, 5000); f.timers[1].fn();
  const result = await f.result;
  assert.equal(result.closed, false); assert.equal(result.watchdog.phase, "recorder-setup");
});
test("already exited browser is not killed; watchdog intervention never looks like a normal pass", async () => {
  const f = fixture();
  f.child.emit("message", { kind: "input-trial-owned-browser", pid: 456 });
  f.child.emit("message", { kind: "input-trial-browser-exited", pid: 456 });
  f.timers[0].fn(); f.child.emit("close", null, "SIGKILL");
  f.timers[1].fn();
  assert.deepEqual(f.killed, [123]); assert.ok((await f.result).watchdog);
});
test("future/invalid navigation cannot extend setup", async () => {
  const f = fixture(); f.child.emit("message", { kind: "input-trial-navigation", startedAtMs: 1001 });
  f.child.emit("close", null, "SIGKILL");
  f.timers[1].fn();
  assert.equal((await f.result).watchdog.phase, "invalid-navigation-receipt");
});
test("recorder exit cannot orphan its browser or kill an already-exited recorder group", async () => {
  for (const event of ["close", "error"]) {
    const f = fixture();
    f.child.emit("message", { kind: "input-trial-owned-browser", pid: 456 });
    f.child.emit(event, event === "close" ? 1 : new Error("recorder broke"));
    assert.deepEqual(f.killed, [456], "only the still-registered browser group may be killed");
    assert.equal(f.timers[1].ms, 5000); f.timers[1].fn();
    const result = await f.result;
    assert.ok(result.watchdog); assert.deepEqual(result.watchdog.unconfirmedGroups, []);
    assert.equal(result.closed, true, "OS group absence confirms cleanup, not trial acceptance");
  }
});
test("exit before stdio close never sends a later watchdog signal to the exited recorder", async () => {
  const f = fixture({ groupAlive: () => true });
  f.child.emit("message", { kind: "input-trial-owned-browser", pid: 456 });
  f.child.emit("exit", 1, null); // No close: inherited stdio remains open.
  f.timers[0].fn();
  assert.deepEqual(f.killed, [456]);
  f.timers[1].fn();
  assert.equal((await f.result).closed, false);
});
