// Deterministic adapter tests, not guest or performance evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { applyAdmissionProbe } from "../admission-probe.js";
import { LINUX_CONTROLLER_METHODS } from "../linux-worker-protocol.js";

function fixture() {
  const calls = []; let enabled = false;
  const machine = {
    jitStats() { calls.push("stats"); return { hasExecutor: true, admissionProbe: { enabled } }; },
    setAdmissionProbe(on) { calls.push(["probe", on]); enabled = on; },
    setProfiling() { assert.fail("probe must not arm profiling"); },
    enableJit() { assert.fail("probe must not change JIT policy"); },
    runChunk() { calls.push("run"); },
  };
  return { machine, calls };
}

test("admission probe omission/false never accesses the machine; invalid values fail without coercion", () => {
  const poison = new Proxy({}, { get() { assert.fail("disabled/invalid probe accessed machine"); } });
  applyAdmissionProbe(poison); applyAdmissionProbe(poison, false);
  for (const value of [null, 0, 1, "1", "true", {}, [], NaN]) {
    assert.throws(() => applyAdmissionProbe(poison, value), /must be boolean/u);
  }
});

test("explicit probe checks real JIT, arms once, then verifies actual enabled state", () => {
  const f = fixture(); applyAdmissionProbe(f.machine, true);
  assert.deepEqual(f.calls, ["stats", ["probe", true], "stats"]);
});

test("missing API, missing JIT and refused enablement fail closed", () => {
  for (const method of ["setAdmissionProbe", "jitStats"]) {
    const f = fixture(); delete f.machine[method];
    assert.throws(() => applyAdmissionProbe(f.machine, true), /requires WASM/u);
    assert.deepEqual(f.calls, []);
  }
  const absent = fixture(); absent.machine.jitStats = () => ({ hasExecutor: false });
  assert.throws(() => applyAdmissionProbe(absent.machine, true), /actual JIT/u);
  assert.deepEqual(absent.calls, []);
  const refused = fixture(); refused.machine.setAdmissionProbe = () => {};
  assert.throws(() => applyAdmissionProbe(refused.machine, true), /actual machine/u);
});

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
test("actual loader rejects malformed/non-JIT probe options before asset fetch", () => {
  const validation = loader.match(/    if \(typeof jitAdmissionProbe !== "boolean"\)[\s\S]*?    validateDecodedCacheEntries\(decodedCacheEntries\);/u)?.[0];
  assert.ok(validation);
  assert.ok(loader.indexOf(validation) < loader.indexOf('const manifest = await fetchJsonAsset(manifestUrl, "boot manifest");'));
  for (const [probe, jit] of [[null, true], ["1", true], [1, true], [true, false], [true, undefined]]) {
    let advanced = false;
    assert.throws(() => vm.runInNewContext(validation, { jitAdmissionProbe: probe, jit,
      decodedCacheEntries: undefined, validateDecodedCacheEntries() { advanced = true; } }));
    assert.equal(advanced, false);
  }
});

test("actual loader arms only after all restores and before the first run, with no mutation RPC", () => {
  const selection = "if (jitAdmissionProbe) applyAdmissionProbe(machine, jitAdmissionProbe);";
  const at = loader.indexOf(selection);
  assert.equal(loader.split(selection).length, 2);
  assert.ok(at > loader.lastIndexOf("machine.loadSnapshotBlob(blob);", at));
  assert.ok(at > loader.indexOf("const guestClockLifecycle = createGuestClockLifecycle"));
  assert.ok(at < loader.indexOf("const runTick = async () =>"));
  for (const enabled of [false, true]) {
    const f = fixture(); f.calls.push("restore");
    vm.runInNewContext(`${selection}\nmachine.runChunk();`, { machine: f.machine,
      jitAdmissionProbe: enabled, applyAdmissionProbe });
    assert.deepEqual(f.calls, enabled ? ["restore", "stats", ["probe", true], "stats", "run"] : ["restore", "run"]);
  }
  assert.equal(LINUX_CONTROLLER_METHODS.includes("setAdmissionProbe"), false);
  assert.equal(LINUX_CONTROLLER_METHODS.includes("jitStats"), true);
});

test("Omarchy page opts in only through the literal diagnostic query value 1", () => {
  const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const expression = main.match(/^      jitAdmissionProbe: (.+),$/mu)?.[1]; assert.ok(expression);
  for (const value of ["", "jitAdmissionProbe=0", "jitAdmissionProbe=true", "jitAdmissionProbe=1.0", "jitAdmissionProbe=1"]) {
    assert.equal(vm.runInNewContext(expression, { query: new URLSearchParams(value) }), value === "jitAdmissionProbe=1");
  }
});
