// JS validation/forwarding evidence only: real retired-instruction timing belongs to core/browser gates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createGuestClockLifecycle, validateGuestClock, validateICountDivider } from "../guest-clock.js";
import { createLinuxWorkerClient, createLinuxWorkerRuntime, LINUX_CONTROLLER_METHODS } from "../linux-worker-protocol.js";

const clock = (clockDiv = 10, mtime = "9007199254740993") => ({ mode: "icount", clockDiv, timebaseHz: 10_000_000, mtime });
function machineFixture(before = clock()) {
  const calls = [];
  let current = before;
  const machine = {
    setGuestClock: value => calls.push(["mode", value]),
    setICountDivider: value => { calls.push(["divider", value]); current = { ...current, clockDiv: value }; },
    guestClockState: () => { calls.push(["state"]); return current; },
    rebaseGuestClock: () => calls.push(["rebase"]),
  };
  return { machine, calls, current: () => current, replace: value => { current = value; } };
}

test("all 1..1024 numbers and exact decimal strings validate; undefined alone omits", () => {
  assert.equal(validateICountDivider(undefined), undefined);
  assert.equal(validateICountDivider(undefined, "wall"), undefined);
  for (let value = 1; value <= 1024; value += 1) {
    assert.equal(validateICountDivider(value), value);
    assert.equal(validateICountDivider(String(value), "icount"), value);
  }
});

test("invalid syntax, types, ranges and explicit incompatible modes refuse before machine access", () => {
  const poison = new Proxy({}, { get() { assert.fail("invalid option accessed the machine"); } });
  const invalid = [null, false, true, 0, -0, -1, 1.5, 1025, NaN, Infinity, -Infinity,
    1n, [], [1], {}, new Number(1), "", "0", "00", "01", "+1", "-1", "1.0", "1e1", "0x10",
    " 1", "1 ", "1\n", "1\r", "1\r\n", "1\t", "1\0", "１０", "1025", "00010"];
  for (const value of invalid) {
    assert.throws(() => validateICountDivider(value), RangeError, String(value));
    assert.throws(() => createGuestClockLifecycle(poison, "icount", value), RangeError);
  }
  for (const mode of ["wall", "WALL", "icount ", "", null, false]) {
    assert.throws(() => validateICountDivider(1, mode), RangeError);
    assert.throws(() => createGuestClockLifecycle(poison, mode, 1), RangeError);
  }
});

test("omission preserves the old mode call without divider/state reads or a fabricated selection", () => {
  for (const machine of [null, {}, { setGuestClock(mode) { assert.equal(mode, "icount"); } }]) {
    const lifecycle = createGuestClockLifecycle(machine);
    assert.equal(lifecycle.dividerSelection(), null);
    lifecycle.resume();
  }
  const f = machineFixture(clock(37));
  Object.defineProperty(f.machine, "setICountDivider", { get() { assert.fail("omission read divider API"); } });
  Object.defineProperty(f.machine, "guestClockState", { get() { assert.fail("omission read state API"); } });
  const lifecycle = createGuestClockLifecycle(f.machine, "icount", undefined);
  assert.deepEqual(f.calls, [["mode", "icount"]]);
  assert.equal(lifecycle.dividerSelection(), null);
  lifecycle.resume();
  assert.equal(f.current().clockDiv, 37, "JS must not substitute default ten for a stored divider");
});

test("both explicit APIs are validated before the first read or mutation", () => {
  for (const method of ["setICountDivider", "guestClockState"]) {
    for (const value of [undefined, null, 1, {}]) {
      const f = machineFixture(); f.machine[method] = value;
      assert.throws(() => createGuestClockLifecycle(f.machine, "icount", 1), new RegExp(`requires WASM ${method}`));
      assert.deepEqual(f.calls, []);
    }
  }
});

test("actual pre-selection state must be ICount and valid; no implicit wall conversion", () => {
  for (const before of [null, {}, { ...clock(), mode: "wall" }, { ...clock(), clockDiv: 0 },
    { ...clock(), clockDiv: 1.5 }, { ...clock(), clockDiv: Number.MAX_SAFE_INTEGER + 1 },
    { ...clock(), timebaseHz: 1 }, { ...clock(), mtime: 1 }, { ...clock(), mtime: "-1" },
    { ...clock(), mtime: "1\n" }]) {
    const f = machineFixture(before);
    assert.throws(() => createGuestClockLifecycle(f.machine, "icount", 1), /actual valid ICount state/);
    assert.deepEqual(f.calls, [["state"]]);
  }
});

test("explicit selection reads stored state, sets once, reads actual result, and never resets mode/time on resume", () => {
  for (const [stored, requested] of [[10, 1], [1, 10], [10, 10], [1024, 1]]) {
    const f = machineFixture(clock(stored));
    const lifecycle = createGuestClockLifecycle(f.machine, "icount", String(requested));
    assert.deepEqual(f.calls, [["state"], ["divider", requested], ["state"]]);
    assert.deepEqual(lifecycle.dividerSelection(), { requested, before: clock(stored), after: clock(requested) });
    lifecycle.resume(); lifecycle.resume();
    assert.equal(f.calls.length, 3, "ICount resumes do not reapply selection or rebase time");
    assert.equal(lifecycle.state(), f.current(), "live state remains an actual machine read");
  }
});

test("setter/read exceptions and changed time or wrong actual divider refuse without retry/fallback", () => {
  for (const stage of ["before", "setter", "after"]) {
    const f = machineFixture(), failure = new Error(stage);
    let reads = 0;
    const read = f.machine.guestClockState, set = f.machine.setICountDivider;
    f.machine.guestClockState = () => {
      if (++reads === (stage === "before" ? 1 : 2) && stage !== "setter") throw failure;
      return read();
    };
    f.machine.setICountDivider = value => { if (stage === "setter") throw failure; set(value); };
    assert.throws(() => createGuestClockLifecycle(f.machine, "icount", 1), error => error === failure);
    assert.ok(f.calls.filter(([name]) => name === "divider").length <= 1);
    assert.equal(f.calls.some(([name]) => name === "mode" || name === "rebase"), false);
  }
  for (const after of [clock(10), clock(1, "9007199254740994"), { ...clock(1), mode: "wall" }, null]) {
    const f = machineFixture();
    f.machine.setICountDivider = value => { f.calls.push(["divider", value]); f.replace(after); };
    assert.throws(() => createGuestClockLifecycle(f.machine, "icount", 1), /selection changed time|actual valid ICount/);
    assert.deepEqual(f.calls, [["state"], ["divider", 1], ["state"]]);
  }
});

test("receipt is immutable history, returns independent scalar-only copies, and never rereads live state", () => {
  const before = { ...clock(), secret: { pixels: [1, 2, 3] } };
  const f = machineFixture(before), lifecycle = createGuestClockLifecycle(f.machine, "icount", 1);
  const expected = { requested: 1, before: clock(), after: clock(1) };
  const first = lifecycle.dividerSelection();
  first.requested = 99; first.before.mtime = "0"; first.after.clockDiv = 99;
  before.mtime = "7"; f.current().mtime = "8";
  f.replace(clock(32, "9999999999999999"));
  assert.deepEqual(lifecycle.dividerSelection(), expected);
  assert.notEqual(lifecycle.dividerSelection().before, lifecycle.dividerSelection().before);
  assert.equal(f.calls.length, 3);
  assert.equal(lifecycle.state().clockDiv, 32);
});

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
test("loader validates before its first fetch and selects after restore branches but before execution", async () => {
  const preflight = loader.match(/    validateGuestClock\(guestClock\);[\s\S]*?const manifest = await fetchJsonAsset\(manifestUrl, "boot manifest"\);/)?.[0];
  assert.ok(preflight);
  for (const value of [null, "01", "0", "1025"]) {
    let fetches = 0;
    const run = vm.runInNewContext(`async () => { ${preflight} }`, {
      guestClock: "icount", icountDivider: value, validateGuestClock, validateICountDivider,
      manifestUrl: "unused", fetchJsonAsset: () => { fetches += 1; },
    });
    await assert.rejects(run(), RangeError);
    assert.equal(fetches, 0);
  }
  const call = "const guestClockLifecycle = createGuestClockLifecycle(machine, guestClock, icountDivider);";
  const at = loader.indexOf(call);
  assert.ok(at > loader.indexOf('if (mode === "initramfs" && bootSnap'));
  assert.ok(loader.lastIndexOf("machine.loadSnapshotBlob(blob);", at) < at);
  assert.ok(at < loader.indexOf("const runTick = async () =>"));
  assert.ok(at < loader.indexOf("res = machine.runChunk("));
  assert.match(loader, /icountDividerSelection: \(\) => guestClockLifecycle\.dividerSelection\(\)/);
});

test("desktop query preserves omission versus exact raw string, including invalid empty input", () => {
  const desktop = readFileSync(new URL("../desktop-terminal.js", import.meta.url), "utf8");
  const expression = desktop.match(/^  icountDivider: (.+),$/m)?.[1];
  assert.ok(expression);
  for (const [query, expected] of [["", undefined], ["icountDivider=", ""], ["icountDivider=01", "01"],
    ["icountDivider=10", "10"], ["icountDivider=%201", " 1"]]) {
    assert.equal(vm.runInNewContext(expression, { query: new URLSearchParams(query) }), expected);
  }
});

// Reuse the existing paired protocol harness, not a mock RPC implementation.
const protocolTests = readFileSync(new URL("./e4-t32-worker-protocol.test.mjs", import.meta.url), "utf8");
const pairBody = protocolTests.slice(protocolTests.indexOf("function endpointPair("), protocolTests.indexOf("function fakeController("));
const endpointPair = vm.runInNewContext(`${pairBody}\nendpointPair`, { structuredClone, queueMicrotask });
test("raw divider boot data and real lifecycle receipt traverse the paired worker protocol", { timeout: 2_000 }, async () => {
  for (const value of [undefined, "1", 10, "1024"]) {
    const { page, worker } = endpointPair();
    const f = machineFixture();
    let lifecycle, resolveDone;
    const whenDone = new Promise(resolve => { resolveDone = resolve; });
    createLinuxWorkerRuntime(worker, { startBoot: async opts => {
      assert.equal(Object.hasOwn(opts, "icountDivider"), value !== undefined);
      assert.equal(opts.icountDivider, value);
      lifecycle = createGuestClockLifecycle(f.machine, opts.guestClock, opts.icountDivider);
      return { whenDone, icountDividerSelection: () => lifecycle.dividerSelection(), guestClockState: () => lifecycle.state() };
    } });
    const client = createLinuxWorkerClient(page);
    const opts = value === undefined ? {} : { icountDivider: value };
    const boot = client.boot(opts); opts.icountDivider = "mutated after post";
    try {
      const controller = await boot;
      assert.ok(LINUX_CONTROLLER_METHODS.includes("icountDividerSelection"));
      assert.equal(controller.setICountDivider, undefined, "the scalar RPC must not expose a live setter");
      const receipt = await controller.icountDividerSelection();
      assert.deepEqual(receipt, value === undefined ? null : { requested: Number(value), before: clock(), after: clock(Number(value)) });
      if (receipt) receipt.after.mtime = "caller changed";
      f.replace(clock(77, "18446744073709551615"));
      assert.deepEqual(await controller.icountDividerSelection(), lifecycle.dividerSelection());
      assert.equal((await controller.guestClockState()).mtime, "18446744073709551615");
    } finally {
      resolveDone("stopped");
      await client.controller.whenDone.catch(() => {});
    }
  }
});
