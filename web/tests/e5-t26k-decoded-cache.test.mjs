// JS configuration/ordering and real linked protocol evidence, not a guest/cache-coherence proof.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { applyDecodedCacheEntries, validateDecodedCacheEntries } from "../decoded-cache.js";
import { validateGuestClock, validateICountDivider } from "../guest-clock.js";
import { startLinuxBootWorker } from "../linux-worker-host.js";
import { createLinuxWorkerRuntime, LINUX_CONTROLLER_METHODS } from "../linux-worker-protocol.js";

const invalid = [null, false, true, 0, -0, -1, 4095, 4097, 16383, 16385, 4096.5, NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER, 4096n, [], [4096], {}, new Number(4096), new String("4096"),
  "", " ", "04096", "016384", "+4096", "-4096", "4096.0", "4096e0", "0x1000", "0b1000000000000",
  " 4096", "4096 ", "4096\n", "4096\r\n", "4096\t", "4096\0", "４０９６", "16384.00"];
function machineFixture(capacity = 4096) {
  const calls = [];
  let actual = capacity;
  const machine = {
    jitStats() { assert.equal(this, machine); calls.push(["stats", actual]); return { decodedCacheEntries: actual, marker: "actual machine" }; },
    setDecodedCacheEntries(entries) { assert.equal(this, machine); calls.push(["set", entries]); actual = entries; },
    runChunk() { calls.push(["pump", actual]); return { retired: 1 }; },
  };
  return { machine, calls, actual: () => actual, replace: value => { actual = value; } };
}

test("only 4096/16384 numbers and exact decimal strings validate; omission alone is undefined", () => {
  assert.equal(validateDecodedCacheEntries(undefined), undefined);
  for (const value of [4096, 16384, "4096", "16384"]) assert.equal(validateDecodedCacheEntries(value), Number(value));
  const poison = { [Symbol.toPrimitive]() { assert.fail("must not coerce an option"); } };
  for (const value of [...invalid, poison, Symbol("4096")]) {
    assert.throws(() => validateDecodedCacheEntries(value), RangeError);
    assert.throws(() => applyDecodedCacheEntries(new Proxy({}, { get() { assert.fail("invalid option accessed machine"); } }), value), RangeError);
  }
});

test("omission never touches cache APIs or overrides an already configured machine", () => {
  applyDecodedCacheEntries(new Proxy({}, { get() { assert.fail("omission accessed machine"); } }), undefined);
  for (const value of [null, undefined, {}, machineFixture(16384).machine]) applyDecodedCacheEntries(value, undefined);
  const f = machineFixture(16384); applyDecodedCacheEntries(f.machine, undefined);
  assert.deepEqual(f.calls, []); assert.equal(f.actual(), 16384);
});

test("same-size selection only reads actual capacity; changed size calls strict numeric setter and verifies", () => {
  for (const before of [4096, 16384]) for (const request of [4096, 16384, "4096", "16384"]) {
    const f = machineFixture(before), after = Number(request);
    assert.equal(applyDecodedCacheEntries(f.machine, request), undefined);
    assert.deepEqual(f.calls, before === after ? [["stats", before]] : [["stats", before], ["set", after], ["stats", after]]);
    assert.equal(f.actual(), after);
    f.calls.length = 0; applyDecodedCacheEntries(f.machine, request);
    assert.deepEqual(f.calls, [["stats", after]], "repeat selection must not invalidate/resize");
  }
});

test("both APIs are required before any read/mutation, including explicit same-size selection", () => {
  for (const method of ["setDecodedCacheEntries", "jitStats"]) for (const value of [undefined, null, {}, 1]) {
    const f = machineFixture(); f.machine[method] = value;
    assert.throws(() => applyDecodedCacheEntries(f.machine, 4096), new RegExp(`requires WASM ${method}`));
    assert.deepEqual(f.calls, []);
  }
});

test("malformed actual capacities and wrong post-set capacity fail closed without retry or echoed success", () => {
  for (const value of [...invalid, undefined, "4096", "16384"]) {
    const f = machineFixture(); f.replace(value);
    assert.throws(() => applyDecodedCacheEntries(f.machine, 16384), /actual supported cache capacity/);
    assert.equal(f.calls.some(([kind]) => kind === "set"), false);
  }
  for (const after of [4096, "16384", undefined, null, NaN, 32]) {
    const f = machineFixture();
    f.machine.setDecodedCacheEntries = value => { f.calls.push(["set", value]); f.replace(after); };
    assert.throws(() => applyDecodedCacheEntries(f.machine, 16384), /did not reach the actual machine/);
    assert.equal(f.calls.filter(([kind]) => kind === "set").length, 1);
  }
  for (const stage of ["before", "setter", "after"]) {
    const f = machineFixture(), failure = new Error(stage), read = f.machine.jitStats;
    let reads = 0;
    f.machine.jitStats = () => { if (++reads === (stage === "before" ? 1 : 2) && stage !== "setter") throw failure; return read.call(f.machine); };
    if (stage === "setter") f.machine.setDecodedCacheEntries = () => { throw failure; };
    assert.throws(() => applyDecodedCacheEntries(f.machine, 16384), error => error === failure);
    assert.equal(f.calls.some(([kind]) => kind === "pump"), false);
  }
});

const loader = readFileSync(new URL("../loader.js", import.meta.url), "utf8");
const desktop = readFileSync(new URL("../desktop-terminal.js", import.meta.url), "utf8");
const preflight = loader.match(/    validateDecodedCacheEntries\(decodedCacheEntries\);[\s\S]*?const manifest = await fetchJsonAsset\(manifestUrl, "boot manifest"\);/)?.[0];
assert.ok(preflight, "actual pre-fetch validation boundary missing");
const selection = "    applyDecodedCacheEntries(machine, decodedCacheEntries);";
const selectionAt = loader.indexOf(selection);
const restoreSource = loader.slice(loader.indexOf("    let restoredFromStoredSnapshot = false;"), selectionAt + selection.length);
const pump = loader.match(/res = machine\.runChunk\(runQuantum, usePersist \? maxDirtyBytes : undefined\);/)?.[0];
assert.ok(pump, "actual guest pump missing");

test("actual loader preflight rejects malformed options before fetch/restore/construction/execution", async () => {
  for (const value of invalid) {
    const calls = [];
    const check = vm.runInNewContext(`async () => { ${preflight} }`, {
      decodedCacheEntries: value, validateDecodedCacheEntries, validateGuestClock, validateICountDivider,
      guestClock: "icount", icountDivider: undefined, manifestUrl: "unused",
      fetchJsonAsset: () => calls.push("fetch"),
    });
    await assert.rejects(check(), RangeError); assert.deepEqual(calls, []);
  }
  assert.match(loader, /decodedCacheEntries = undefined,/);
  assert.ok(loader.indexOf(preflight) < loader.indexOf("new WasmLinux("));
});

// Execute the actual complete restore/selection block. Machine/storage stubs model only
// loader control flow; architectural preservation remains the Rust worker's proof boundary.
async function runRestoreBoundary(f, request, route = "cold") {
  const blob = Uint8Array.of(1, 2, 3);
  Object.assign(f.machine, {
    restoreStoredSnapshot: async () => { f.calls.push(["stored-restore", f.actual()]); return route === "stored" ? "resume" : "missing"; },
    overlayGeneration: () => 7,
    restoreDecisionCode: () => "resume",
    loadSnapshotBlob: () => f.calls.push(["blob-restore", f.actual()]),
    readStoredSnapshot: async () => route === "initramfs-cached" ? blob : null,
    stampBootSnapshotIdentity: () => {}, importStoredSnapshot: async () => {},
  });
  const run = vm.runInNewContext(`async () => { ${restoreSource}\nlet res; ${pump}\nreturn restoredFromBootSnapshot; }`, {
    machine: f.machine, decodedCacheEntries: request, applyDecodedCacheEntries,
    usePersist: route === "stored", mode: route.startsWith("initramfs") ? "initramfs" : "chunked",
    alpineRamBlob: route === "alpine" ? blob : null, alpineOverlaySeeded: false,
    bootSnap: route.startsWith("initramfs") ? { url: "unit-only-snapshot", sha256: "unit-only-digest" } : null,
    opts: {}, km: { sha256: "unit-only-kernel" }, manifest: { artifacts: { initramfs: { sha256: "unit-only-initrd" } } },
    deriveBootSnapshotBaseId: async () => "unit-only-base", decideBootPath: () => "boot_snapshot",
    fetchWithProgress: async () => blob, sha256hex: async () => "unit-only-digest", gunzip: async value => value,
    onProgress: () => {}, onState: state => f.calls.push(["state", state]), console: { warn: () => {} },
    runQuantum: 500000, maxDirtyBytes: 0,
  });
  return run();
}

test("cold/stored/Alpine/initramfs restore branches apply after restoration but before actual first pump", async () => {
  assert.ok(selectionAt > loader.indexOf('console.warn("wasm-vm: enableJit gate failed:'));
  assert.ok(selectionAt > loader.lastIndexOf("machine.loadSnapshotBlob(blob);", selectionAt));
  assert.ok(selectionAt < loader.indexOf("const runTick = async () =>"));
  assert.ok(selectionAt < loader.indexOf(pump));
  assert.doesNotMatch(loader.slice(loader.indexOf("export async function startLinuxBoot("), selectionAt), /machine\.(?:runChunk|step|run)\(/);
  assert.equal(loader.split(selection).length - 1, 1, "one selection, not a scheduler/restore retry");
  for (const route of ["cold", "stored", "alpine", "initramfs-cached", "initramfs-fetched"]) {
    for (const request of [undefined, 4096, "16384"]) {
      const f = machineFixture();
      assert.equal(await runRestoreBoundary(f, request, route), route !== "cold");
      assert.deepEqual(f.calls.at(-1), ["pump", request === "16384" ? 16384 : 4096]);
      const selected = f.calls.findIndex(([kind]) => kind === "set");
      if (request === "16384") {
        assert.ok(selected >= 0 && selected < f.calls.length - 1);
        for (const [index, call] of f.calls.entries()) if (call[0].endsWith("-restore")) assert.ok(index < selected);
      } else assert.equal(selected, -1);
      if (request === undefined) assert.equal(f.calls.some(([kind]) => kind === "stats"), false);
    }
  }
});

test("missing API or wrong actual capacity after a cold/stored restore never enters the pump or JIT fallback", async () => {
  for (const route of ["cold", "stored"]) for (const failure of ["method", "stats", "wrong-capacity", "throw"]) {
    const f = machineFixture();
    if (failure === "method") delete f.machine.setDecodedCacheEntries;
    if (failure === "stats") delete f.machine.jitStats;
    if (failure === "wrong-capacity") f.machine.setDecodedCacheEntries = () => {};
    if (failure === "throw") f.machine.setDecodedCacheEntries = () => { throw Error("resize refused"); };
    await assert.rejects(runRestoreBoundary(f, 16384, route));
    assert.equal(f.calls.some(([kind]) => kind === "pump"), false);
  }
  const f = machineFixture(16384);
  await runRestoreBoundary(f, undefined, "stored");
  assert.deepEqual(f.calls.at(-1), ["pump", 16384], "omission does not resize an already configured restored machine");
});

test("actual desktop options preserve exact raw query values, including omission and malformed empty strings", () => {
  const expression = desktop.match(/^  decodedCacheEntries: (.+),$/m)?.[1];
  assert.ok(expression);
  const callAt = desktop.indexOf("const bootPromise = startLinuxBootWorker({");
  assert.ok(desktop.indexOf(`  decodedCacheEntries: ${expression},`, callAt) > callAt);
  for (const [query, expected] of [["", undefined], ["decodedCacheEntries=4096", "4096"], ["decodedCacheEntries=16384", "16384"],
    ["decodedCacheEntries=", ""], ["decodedCacheEntries=04096", "04096"], ["decodedCacheEntries=4096.0", "4096.0"],
    ["decodedCacheEntries=%204096", " 4096"]]) {
    assert.equal(vm.runInNewContext(expression, { query: new URLSearchParams(query) }), expected);
  }
});

const protocolTests = readFileSync(new URL("./e4-t32-worker-protocol.test.mjs", import.meta.url), "utf8");
const pairBody = protocolTests.slice(protocolTests.indexOf("function endpointPair("), protocolTests.indexOf("function fakeController("));
const endpointPair = vm.runInNewContext(`${pairBody}\nendpointPair`, { structuredClone, queueMicrotask });
const statsExpression = loader.match(/^      jitStats: (.+),$/m)?.[1];
assert.ok(statsExpression);

test("real page host plus linked worker protocol clone raw boot option and forward actual capacity through existing jitStats", { timeout: 2000 }, async () => {
  for (const route of ["cold", "stored"]) for (const value of [undefined, 4096, "4096", 16384, "16384"]) {
    const { page, worker } = endpointPair(), f = machineFixture();
    let finish;
    const whenDone = new Promise(resolve => { finish = resolve; });
    createLinuxWorkerRuntime(worker, { startBoot: async opts => {
      assert.equal(Object.hasOwn(opts, "decodedCacheEntries"), value !== undefined);
      assert.equal(opts.decodedCacheEntries, value, "transport must preserve the raw type/value before validation");
      validateDecodedCacheEntries(opts.decodedCacheEntries);
      await runRestoreBoundary(f, opts.decodedCacheEntries, route);
      const jitStats = vm.runInNewContext(statsExpression, { machine: f.machine });
      return { whenDone, jitStats };
    } });
    const options = { WorkerCtor: function () { return page; }, workerHeartbeatIntervalMs: 0,
      ...(value === undefined ? {} : { decodedCacheEntries: value }) };
    const boot = startLinuxBootWorker(options); options.decodedCacheEntries = "changed after post";
    const controller = await boot;
    try {
      assert.ok(LINUX_CONTROLLER_METHODS.includes("jitStats"));
      assert.equal(controller.setDecodedCacheEntries, undefined, "do not expose a runtime setter RPC");
      const state = await controller.jitStats();
      assert.equal(state.decodedCacheEntries, value === undefined ? 4096 : Number(value));
      state.decodedCacheEntries = 1;
      assert.equal((await controller.jitStats()).decodedCacheEntries, f.actual(), "reply mutation cannot change live capacity");
      f.replace(16384);
      assert.equal((await controller.jitStats()).decodedCacheEntries, 16384, "stats are a live machine read, not echoed options");
    } finally { finish("stopped"); await controller.whenDone; }
  }
});

test("real worker boot rejects malformed input, missing methods and wrong actual capacity before execution", { timeout: 2000 }, async () => {
  for (const scenario of [null, "", "04096", "4096.0", false, [4096], { value: 4096 }, "missing-method", "missing-stats", "mismatch"]) {
    const { page, worker } = endpointPair(), f = machineFixture();
    const methodFailure = ["missing-method", "missing-stats", "mismatch"].includes(scenario);
    if (scenario === "missing-method") delete f.machine.setDecodedCacheEntries;
    if (scenario === "missing-stats") delete f.machine.jitStats;
    if (scenario === "mismatch") f.machine.setDecodedCacheEntries = () => {};
    createLinuxWorkerRuntime(worker, { startBoot: async opts => {
      validateDecodedCacheEntries(opts.decodedCacheEntries);
      await runRestoreBoundary(f, opts.decodedCacheEntries, "stored");
      assert.fail("invalid worker boot must not publish a controller");
    } });
    await assert.rejects(startLinuxBootWorker({ WorkerCtor: function () { return page; }, workerHeartbeatIntervalMs: 0,
      decodedCacheEntries: methodFailure ? 16384 : scenario }), /decodedCacheEntries/);
    assert.equal(f.calls.some(([kind]) => kind === "pump"), false);
    if (!methodFailure) assert.deepEqual(f.calls, [], "bad options fail before restore or machine access");
  }
});
