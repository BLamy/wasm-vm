// Independent D72 JS boundary checks. These execute the actual loader callbacks and
// clock lifecycle; the small machine below observes ordering, not guest timekeeping.
// Real worker/Wasm/stock acceptance remains a separate required recording.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createGuestClockLifecycle } from "../guest-clock.js";

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");

function callback(name, parameters = "") {
  const escaped = parameters.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = loader.match(new RegExp(`      ${name}: \\(${escaped}\\) => \\{([\\s\\S]*?)\\n      \\},`))?.[1];
  assert.ok(body, `actual loader ${name} callback must remain identifiable`);
  return `(${parameters}) => {${body}\n}`;
}

function rig({ paused = true, fault = null } = {}) {
  const calls = [];
  const failure = new Error("independent selection refusal");
  let current = { mode: "icount", mtime: "18446744073709550000", timebaseHz: 10_000_000, clockDiv: 64 };
  let selected = false;
  const machine = {
    setGuestClock(mode) {
      calls.push(["select", mode]);
      if (selected && fault === "throw") throw failure;
      current = { ...current, mode };
    },
    rebaseGuestClock() { calls.push(["rebase", current.mode]); },
    guestClockState() {
      calls.push(["read", current.mode]);
      if (selected && current.mode === "wall") {
        if (fault === "stale-mode") return { ...current, mode: "icount" };
        if (fault === "mtime-drift") return { ...current, mtime: String(BigInt(current.mtime) + 1n) };
        if (fault === "rounded-mtime") return { ...current, mtime: Number(current.mtime) };
        if (fault === "wrong-timebase") return { ...current, timebaseHz: 1_000_000 };
        if (fault === "wrong-divider") return { ...current, clockDiv: 10 };
        if (fault === "null-state") return null;
      }
      return { ...current };
    },
    sendKeyboardEvent(type, code, value) {
      calls.push(["make", type, code, value, current.mode]);
    },
    syncKeyboard() { calls.push(["sync"]); },
    setDiskReadOnly() { calls.push(["disk-read-only"]); },
  };
  const lifecycle = createGuestClockLifecycle(machine, "icount", undefined, "wall-on-keyboard");
  selected = true;
  calls.length = 0;
  const sandbox = vm.createContext({
    machine, guestClockLifecycle: lifecycle, stopped: false, paused,
    quotaPaused: false, quotaReadOnly: false, lastPersistRetry: 99,
    doneSettled: false, pendingFinishState: null, tickScheduled: false,
    productionGpu: { dispose() { calls.push(["dispose"]); } },
    settleFinished() { calls.push(["settled"]); },
    onState(state) {
      assert.equal(sandbox.stopped, true, "stop before notifying a selection error");
      calls.push(["notify-state", state]);
    },
    onError(error) { calls.push(["notify-error", error.message]); },
    schedule() { if (!sandbox.stopped) calls.push(["schedule"]); },
  });
  const finishBody = loader.match(/    const finish = \(state\) => \{([\s\S]*?)\n    \};/)?.[1];
  assert.ok(finishBody, "use actual loader finish ordering");
  sandbox.finish = vm.runInContext(`(state) => {${finishBody}\n}`, sandbox);
  const methods = {};
  for (const [name, parameters] of [["sendKeyboardEvent", "eventType, code, value"],
    ["syncKeyboard", ""], ["pause", ""], ["resume", ""],
    ["resumeAfterQuota", ""], ["continueReadOnly", ""]]) {
    if (name === "pause") continue; // Its one-line source shape is deliberately separate.
    methods[name] = vm.runInContext(callback(name, parameters), sandbox);
  }
  return { calls, methods, sandbox, lifecycle, machine, failure,
    current: () => ({ ...current }) };
}

test("critic: paused first NumLock repair selects before staging, preserving a u64 clock exactly", () => {
  const r = rig();
  const before = r.current();
  assert.equal(r.methods.sendKeyboardEvent(1, 69, 1), true);
  assert.equal(r.methods.syncKeyboard(), true);
  assert.deepEqual(r.calls, [["read", "icount"], ["select", "wall"], ["read", "wall"],
    ["make", 1, 69, 1, "wall"], ["sync"]]);
  assert.equal(r.current().mtime, before.mtime);
  assert.equal(r.sandbox.paused, true, "input does not implicitly execute the paused guest");
  r.calls.length = 0;
  r.methods.resume();
  assert.deepEqual(r.calls, [["rebase", "wall"], ["schedule"]]);
  assert.equal(r.sandbox.paused, false);
  r.calls.length = 0;
  r.methods.sendKeyboardEvent(1, 30, 1);
  r.methods.syncKeyboard();
  r.methods.sendKeyboardEvent(1, 69, 0);
  r.methods.syncKeyboard();
  assert.deepEqual(r.calls, [["make", 1, 30, 1, "wall"], ["sync"],
    ["make", 1, 69, 0, "wall"], ["sync"]], "later input cannot reset the wall anchor");
});

test("critic: malformed handoff readbacks stop the actual loader before make or SYN", () => {
  for (const fault of ["throw", "stale-mode", "mtime-drift", "rounded-mtime",
    "wrong-timebase", "wrong-divider", "null-state"]) {
    const r = rig({ fault });
    assert.throws(() => r.methods.sendKeyboardEvent(1, 248, 1),
      fault === "throw" ? (error) => error === r.failure : /selection changed time|wall mode/);
    assert.equal(r.sandbox.stopped, true, fault);
    assert.equal(r.sandbox.pendingFinishState, "error", fault);
    assert.equal(r.methods.syncKeyboard(), false, "queued SYN cannot survive fatal selection");
    assert.equal(r.methods.sendKeyboardEvent(1, 30, 1), false, "later input cannot bypass poison");
    r.methods.resume();
    assert.equal(r.sandbox.paused, true);
    assert.equal(r.calls.filter(([kind]) => kind === "dispose").length, 1);
    assert.equal(r.calls.filter(([kind]) => kind === "make" || kind === "sync" ||
      kind === "rebase" || kind === "schedule").length, 0, fault);
    assert.throws(() => r.lifecycle.resume(), /restart required/);
    assert.throws(() => r.lifecycle.beforeKeyboardEvent(1, 30, 1), /restart required/);
  }
});

test("critic: handoff pause/quota resume errors preserve each execution barrier", () => {
  for (const name of ["resume", "resumeAfterQuota", "continueReadOnly"]) {
    for (const refuse of [false, true]) {
      const r = rig();
      r.methods.sendKeyboardEvent(1, 30, 1);
      r.calls.length = 0;
      r.sandbox.quotaPaused = name !== "resume";
      const failure = new Error("independent wall rebase refusal");
      r.machine.rebaseGuestClock = () => {
        assert.equal(name === "resume" ? r.sandbox.paused : r.sandbox.quotaPaused, true);
        assert.equal(r.sandbox.quotaReadOnly, false);
        r.calls.push(["rebase", "wall"]);
        if (refuse) throw failure;
      };
      if (refuse) {
        assert.throws(() => r.methods[name](), (error) => error === failure);
        assert.equal(name === "resume" ? r.sandbox.paused : r.sandbox.quotaPaused, true);
        assert.equal(r.sandbox.quotaReadOnly, false);
        assert.equal(r.sandbox.lastPersistRetry, 99);
        assert.deepEqual(r.calls, [["rebase", "wall"]]);
      } else {
        r.methods[name]();
        assert.deepEqual(r.calls, name === "continueReadOnly"
          ? [["rebase", "wall"], ["disk-read-only"], ["schedule"]]
          : [["rebase", "wall"], ["schedule"]]);
      }
    }
  }
});

test("critic: stopped input and non-make numeric frames do not select the clock", () => {
  const r = rig({ paused: false });
  for (const frame of [[1, 30, 0], [1, 30, 2], [0, 0, 0], [4, 4, 1],
    [1, 0, 1], [1, 249, 1], [1, 30.5, 1], [1, "30", 1],
    ["1", 30, 1], [1, 30, "1"], [1, NaN, 1], [1, Infinity, 1]]) {
    r.methods.sendKeyboardEvent(...frame);
  }
  assert.equal(r.calls.filter(([kind]) => kind === "select").length, 0);
  r.calls.length = 0;
  r.sandbox.stopped = true;
  assert.equal(r.methods.sendKeyboardEvent(1, 1, 1), false);
  assert.equal(r.methods.syncKeyboard(), false);
  assert.deepEqual(r.calls, []);
  assert.equal(r.current().mode, "icount");
});
