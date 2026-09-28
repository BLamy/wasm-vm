// Deterministic browser-adapter tests, not guest or performance evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  applyColdCounterRecycling,
  isLoopbackOrigin,
} from "../cold-counter-recycling.js";
import { LINUX_CONTROLLER_METHODS } from "../linux-worker-protocol.js";

function fixture({ enabled = false, hasExecutor = true } = {}) {
  const calls = [];
  const machine = {
    jitStats() {
      calls.push("stats");
      return { hasExecutor, coldCounterRecycling: { enabled, epochs: "2", discardedCounters: "3" } };
    },
    setColdCounterRecycling(on) {
      calls.push(["recycling", on]);
      enabled = on;
    },
    enableJit() { assert.fail("cold recycling must not implicitly enable JIT"); },
    runChunk() { calls.push("run"); },
  };
  return { machine, calls };
}

test("cold recycling omission/false never accesses the machine; invalid values are not coerced", () => {
  const poison = new Proxy({}, { get() { assert.fail("disabled/invalid recycling accessed machine"); } });
  applyColdCounterRecycling(poison);
  applyColdCounterRecycling(poison, false);
  for (const value of [null, 0, 1, "1", "true", {}, [], NaN]) {
    assert.throws(() => applyColdCounterRecycling(poison, value), /must be boolean/u);
  }
});

test("explicit recycling verifies the actual executor and enabled report without implicit JIT", () => {
  const f = fixture();
  const report = applyColdCounterRecycling(f.machine, true);
  assert.deepEqual(f.calls, ["stats", ["recycling", true], "stats"]);
  assert.deepEqual(report, { enabled: true, epochs: "2", discardedCounters: "3" });

  const absent = fixture({ hasExecutor: false });
  assert.throws(() => applyColdCounterRecycling(absent.machine, true), /actual JIT executor/u);
  assert.deepEqual(absent.calls, ["stats"]);

  const refused = fixture();
  refused.machine.setColdCounterRecycling = () => {};
  assert.throws(() => applyColdCounterRecycling(refused.machine, true), /actual machine/u);
});

test("local-origin gate accepts only the requested loopback origins", () => {
  for (const origin of [
    "http://localhost:8080",
    "https://localhost",
    "http://127.0.0.1:4173",
    "http://[::1]:8080",
  ]) assert.equal(isLoopbackOrigin({ origin }), true, origin);
  for (const origin of [
    "http://wasm-vm.pages.dev",
    "http://localhost.example",
    "http://127.0.0.1.example",
    "http://0.0.0.0:8080",
    "file:///tmp/wasm-vm",
    "not an origin",
  ]) assert.equal(isLoopbackOrigin({ origin }), false, origin);
});

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");

test("loader has a default-off strict selection gate before any asset fetch", () => {
  assert.match(loader, /jitColdCounterRecycling = false/u);
  const validation = loader.indexOf("if (typeof jitColdCounterRecycling !== \"boolean\")");
  const validationEnd = loader.indexOf("    validateGuestClock", validation);
  const manifestFetch = loader.indexOf('const manifest = await fetchJsonAsset(manifestUrl, "boot manifest");');
  assert.ok(validation >= 0 && validationEnd > validation && validationEnd < manifestFetch);

  const block = loader.slice(validation, validationEnd);
  for (const [recycling, jit, location, shouldPass] of [
    [null, true, { origin: "http://localhost" }, false],
    ["1", true, { origin: "http://localhost" }, false],
    [true, false, { origin: "http://localhost" }, false],
    [true, true, { origin: "https://wasm-vm.pages.dev" }, false],
    [true, true, { origin: "http://localhost" }, true],
  ]) {
    const context = {
      jitColdCounterRecycling: recycling,
      jit,
      location,
      isLoopbackOrigin,
    };
    if (shouldPass) {
      assert.doesNotThrow(() => vm.runInNewContext(block, context));
    } else {
      assert.throws(() => vm.runInNewContext(block, context));
    }
  }
});

test("loader applies recycling after restore and before execution, with no controller mutation RPC", () => {
  const selection = "if (jitColdCounterRecycling) applyColdCounterRecycling(machine, jitColdCounterRecycling);";
  const at = loader.indexOf(selection);
  assert.equal(loader.split(selection).length, 2);
  assert.ok(at > loader.lastIndexOf("machine.loadSnapshotBlob(blob);", at));
  assert.ok(at < loader.indexOf("const runTick = async () =>"));
  assert.equal(LINUX_CONTROLLER_METHODS.includes("setColdCounterRecycling"), false);
  assert.equal(LINUX_CONTROLLER_METHODS.includes("jitStats"), true);
});

test("Omarchy selects recycling only for literal 1 on a loopback origin", () => {
  const expression = main.match(/^      jitColdCounterRecycling: (query\.get\("jitColdCounterRecycling"\) === "1" && isLoopbackOrigin\(location\)),$/mu)?.[1];
  assert.ok(expression);
  for (const [queryText, origin, expected] of [
    ["", "http://localhost:8080", false],
    ["jitColdCounterRecycling=0", "http://localhost:8080", false],
    ["jitColdCounterRecycling=true", "http://localhost:8080", false],
    ["jitColdCounterRecycling=1.0", "http://localhost:8080", false],
    ["jitColdCounterRecycling=1", "http://wasm-vm.pages.dev", false],
    ["jitColdCounterRecycling=1", "http://localhost:8080", true],
  ]) {
    assert.equal(vm.runInNewContext(expression, {
      query: new URLSearchParams(queryText),
      location: { origin },
      isLoopbackOrigin,
    }), expected);
  }
});
