// These tests prove JS validation/lifecycle ordering, not guest rdtime progression.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createGuestClockLifecycle, validateGuestClock } from "../guest-clock.js";

test("omitted/icount mode never reads a host clock, including on legacy machines", () => {
  const realm = new Proxy({}, { get() { throw Error("host clock accessed"); } });
  assert.equal(validateGuestClock(undefined, realm), "icount");
  assert.equal(validateGuestClock("icount", realm), "icount");
  for (const machine of [undefined, null, {}, { guestClockState: 1 }]) {
    const lifecycle = createGuestClockLifecycle(machine);
    assert.equal(lifecycle.resume(), undefined);
    assert.equal(lifecycle.state(), null, "legacy builds must not fabricate clock state");
  }
});

test("only exact clock labels pass, before accessing the realm or machine", () => {
  const poison = new Proxy({}, { get() { throw Error("source or machine accessed"); } });
  for (const mode of ["", "WALL", "wall ", " wall", "ICount", "rtc", null, false, 0, {}, ["wall"]]) {
    assert.throws(() => validateGuestClock(mode, poison), /unsupported guestClock/);
    assert.throws(() => createGuestClockLifecycle(poison, mode), /unsupported guestClock/);
  }
});

test("wall validation samples the injected performance source once with its receiver", () => {
  for (const sample of [0, 0.25, 123_456.75]) {
    let reads = 0;
    const performance = { now() { assert.equal(this, performance); reads += 1; return sample; } };
    assert.equal(validateGuestClock("wall", { performance }), "wall");
    assert.equal(reads, 1);
  }
});

test("wall validation refuses missing, noncallable, nonfinite and negative sources", () => {
  for (const realm of [null, {}, { performance: null }, { performance: {} }, { performance: { now: 1 } }]) {
    assert.throws(() => validateGuestClock("wall", realm), /monotonic performance.now source/);
  }
  for (const sample of [NaN, Infinity, -Infinity, -0.001, "0", 0n, undefined, null, false, []]) {
    assert.throws(() => validateGuestClock("wall", { performance: { now: () => sample } }), /finite nonnegative/);
  }
  const failure = new Error("monotonic source failed");
  assert.throws(() => validateGuestClock("wall", { performance: { now() { throw failure; } } }),
    (error) => error === failure);
});

test("every wall API must exist before setGuestClock can mutate the machine", () => {
  for (const method of ["setGuestClock", "rebaseGuestClock", "guestClockState"]) {
    for (const unavailable of [undefined, null, 1, {}]) {
      let mutations = 0;
      const machine = {
        setGuestClock() { mutations += 1; },
        rebaseGuestClock() { mutations += 1; },
        guestClockState() { mutations += 1; },
        [method]: unavailable,
      };
      assert.throws(() => createGuestClockLifecycle(machine, "wall"), new RegExp(`requires WASM ${method}`));
      assert.equal(mutations, 0);
    }
  }
  assert.throws(() => createGuestClockLifecycle(null, "wall"), /requires WASM setGuestClock/);
});

test("selection happens once, resume only rebases wall, and state is the current machine result", () => {
  for (const mode of [undefined, "icount", "wall"]) {
    const calls = [];
    let current = { mode: "machine-reported", mtime: "18446744073709551615", timebaseHz: 10_000_000, clockDiv: 10 };
    const machine = {
      setGuestClock(value) { assert.equal(this, machine); calls.push(["set", value]); },
      rebaseGuestClock() { assert.equal(this, machine); calls.push(["rebase"]); },
      guestClockState() { assert.equal(this, machine); calls.push(["state"]); return current; },
    };
    const lifecycle = createGuestClockLifecycle(machine, mode);
    assert.deepEqual(calls, [["set", mode ?? "icount"]], "creation must not read or invent state");
    assert.equal(lifecycle.state(), current);
    current = { mode: "another-real-result", mtime: "9" };
    assert.equal(lifecycle.state(), current, "state cannot be cached from creation");
    current = null;
    assert.equal(lifecycle.state(), null);
    lifecycle.resume();
    lifecycle.resume();
    assert.equal(calls.filter(([name]) => name === "rebase").length, mode === "wall" ? 2 : 0);
    assert.equal(calls.filter(([name]) => name === "set").length, 1);
  }
});

test("machine selection, rebase and state exceptions propagate without fabricated success", () => {
  for (const method of ["setGuestClock", "rebaseGuestClock", "guestClockState"]) {
    const failure = new Error(`${method} refused`);
    const machine = { setGuestClock() {}, rebaseGuestClock() {}, guestClockState() {},
      [method]() { throw failure; } };
    if (method === "setGuestClock") {
      assert.throws(() => createGuestClockLifecycle(machine, "wall"), (error) => error === failure);
    } else {
      const lifecycle = createGuestClockLifecycle(machine, "wall");
      assert.throws(() => method === "rebaseGuestClock" ? lifecycle.resume() : lifecycle.state(),
        (error) => error === failure);
    }
  }
});

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");

// Exercise only the actual small callbacks; importing the full loader would pull in boot assets.
for (const method of ["resume", "resumeAfterQuota", "continueReadOnly"]) {
  test(`loader ${method} rebases before unpausing/scheduling and refuses all later mutations on error`, () => {
    const body = loader.match(new RegExp(`      ${method}: \\(\\) => \\{([\\s\\S]*?)\\n      \\},`))?.[1];
    assert.ok(body, `missing loader ${method} callback`);
    for (const fails of [false, true]) {
      const calls = [];
      const failure = new Error("rebase refused");
      const sandbox = { paused: true, quotaPaused: true, quotaReadOnly: false, stopped: false, lastPersistRetry: 99 };
      const machine = {
        setGuestClock() {}, guestClockState: () => null,
        rebaseGuestClock() {
          assert.equal(method === "resume" ? sandbox.paused : sandbox.quotaPaused, true);
          assert.equal(sandbox.quotaReadOnly, false);
          calls.push("rebase");
          if (fails) throw failure;
        },
        setDiskReadOnly() { calls.push("read-only"); },
      };
      Object.assign(sandbox, { machine, guestClockLifecycle: createGuestClockLifecycle(machine, "wall"),
        schedule() {
          assert.equal(method === "resume" ? sandbox.paused : sandbox.quotaPaused, false);
          calls.push("schedule");
        } });
      const resume = vm.runInNewContext(`() => { ${body} }`, sandbox);
      if (fails) {
        assert.throws(resume, (error) => error === failure);
        assert.deepEqual(calls, ["rebase"]);
        assert.equal(sandbox.paused, true);
        assert.equal(sandbox.quotaPaused, true);
        assert.equal(sandbox.quotaReadOnly, false);
        assert.equal(sandbox.lastPersistRetry, 99);
      } else {
        resume();
        assert.deepEqual(calls, method === "continueReadOnly" ? ["rebase", "read-only", "schedule"] : ["rebase", "schedule"]);
        resume();
        assert.equal(calls.filter((call) => call === "rebase").length, 1, "no rebase without an active pause");
        sandbox.stopped = true;
        sandbox.paused = sandbox.quotaPaused = true;
        resume();
        assert.equal(calls.filter((call) => call === "rebase").length, 1, "stopped machines cannot rebase");
      }
    }
  });
}
