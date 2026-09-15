// Deterministic synthetic harness guards only. No guest, browser, or product proof.
import assert from "node:assert/strict";
import test from "node:test";
import { COLD_BLANK_PATH, COLD_STARTUP_MS, coldPairOptions, coldPairUrl, assertEmptyOriginStorage,
  assertColdRestore, assertColdDesktop, remainingStartupMs, withinStartupDeadline } from "./omarchy-cold-pair.mjs";

const options = () => ({ urlArg: "local", pair: "", chunks: "/synthetic/chunks", renderer: "llvmpipe", lp: "0" });
const storage = () => ({ origin: "http://127.0.0.1:4321", pathname: COLD_BLANK_PATH,
  databases: [], caches: [], serviceWorkers: [], localStorage: [], sessionStorage: [],
  serviceWorkerController: null, vmPresent: false, workerMessages: 0 });
function desktop() {
  const instance = { instance: "fixture_123", pid: 123 };
  return {
    renderer: { expectedRenderer: "llvmpipe", expectedLpNumThreads: "0", instance,
      environment: { exit: 0, stdout: "GALLIUM_DRIVER=llvmpipe\nLIBGL_ALWAYS_SOFTWARE=1\nLP_NUM_THREADS=0\n" },
      threads: { exit: 0, stdout: "Hyprland\n" }, log: { exit: 0, stdout: "" }, activeRendererValidated: false },
    confirmedInstances: [instance],
    clients: [{ class: "foot", mapped: true, hidden: false, pid: 234, address: "0xabc", size: [1280, 760] }],
    layers: { monitor: [{ namespace: "omarchy-bar", pid: 345, w: 1280, h: 40 },
      { namespace: "omarchy-background", pid: 345, w: 1280, h: 800 }] },
    processes: "345 quickshell /usr/bin/quickshell --path /usr/share/omarchy/shell",
  };
}

test("harness-only cold mode requires local LP0 chunks, no pair, and exactly 90 minutes", () => {
  assert.equal(coldPairOptions(options()), COLD_STARTUP_MS);
  assert.equal(coldPairOptions({ ...options(), urlArg: "selftest" }), COLD_STARTUP_MS);
  for (const mutation of [{ urlArg: "https://example.com" }, { pair: "/old/pair" }, { chunks: "" },
    { renderer: "softpipe" }, { lp: "1" }, { timeout: 300000 }, { timeout: 7200000 }, { timeout: "NaN" }]) {
    assert.throws(() => coldPairOptions({ ...options(), ...mutation }));
  }
  const url = coldPairUrl("http://127.0.0.1:4321/app.html?guest=omarchy&desktop=1#ide");
  assert.equal(url.searchParams.get("persist"), "1");
  assert.equal(url.searchParams.get("noSnapshot"), "1");
  assert.equal(url.searchParams.get("omarchyAssetBase"), url.origin);
  assert.equal(url.hash, "#ide");
  assert.throws(() => coldPairUrl("https://example.com/app.html"));
});

test("harness-only origin check refuses inherited storage or app/worker execution", () => {
  assertEmptyOriginStorage(storage(), storage().origin);
  for (const key of ["databases", "caches", "serviceWorkers", "localStorage", "sessionStorage"]) {
    assert.throws(() => assertEmptyOriginStorage({ ...storage(), [key]: ["inherited"] }, storage().origin), /pre-existing/u);
  }
  for (const mutation of [{ vmPresent: true }, { workerMessages: 1 }, { serviceWorkerController: "/sw.js" },
    { pathname: "/app.html" }, { origin: "http://127.0.0.1:9999" }]) {
    assert.throws(() => assertEmptyOriginStorage({ ...storage(), ...mutation }, storage().origin));
  }
});

test("harness-only cold proof rejects stored restore even with shipped restore false", () => {
  const fresh = { shipped: false, stored: { attempted: true, decision: "missing", overlayGeneration: 0 } };
  assertColdRestore(fresh);
  assert.throws(() => assertColdRestore({ ...fresh, shipped: true }));
  for (const mutation of [{ attempted: false }, { decision: "resume" }, { decision: "error" }, { overlayGeneration: 1 }]) {
    assert.throws(() => assertColdRestore({ ...fresh, stored: { ...fresh.stored, ...mutation } }));
  }
  assert.throws(() => assertColdRestore({ shipped: false }));
});

test("harness-only desktop proof accepts mapped LP0 with blank log or a strict actual label", () => {
  assert.equal(assertColdDesktop(desktop()).mappedFoot, true);
  const labeled = desktop();
  labeled.renderer.log.stdout = "DEBUG ]: Renderer: llvmpipe (LLVM 19.1.7, 256 bits)\nDEBUG ]: Vendor: Mesa/X.org";
  labeled.renderer.activeRendererValidated = true;
  assert.equal(assertColdDesktop(labeled).quickshellObserved, true);
});

test("harness-only desktop proof rejects stale PID, worker, duplicate environment, and false GL claims", () => {
  const attacks = [
    f => { f.confirmedInstances = [{ ...f.renderer.instance, pid: 999 }]; },
    f => { f.renderer.threads.stdout += "llvmpipe-0\n"; },
    f => { f.renderer.environment.stdout += "LP_NUM_THREADS=0\n"; },
    f => { f.renderer.environment.stdout = f.renderer.environment.stdout.replace("llvmpipe", "softpipe"); },
    f => { f.renderer.environment.exit = 1; },
    f => { f.renderer.activeRendererValidated = true; },
    f => { f.renderer.log.stdout = "DEBUG ]: Renderer: zink (llvmpipe)\nDEBUG ]: Vendor: Mesa"; },
    f => { f.renderer.instance.pid = "123; bad"; },
    f => { f.clients[0].mapped = false; },
    f => { f.layers.monitor[1].namespace = "impostor"; },
    f => { f.processes = "345 quickshell /usr/bin/quickshell --path /tmp/impostor"; },
  ];
  for (const attack of attacks) { const fixture = desktop(); attack(fixture); assert.throws(() => assertColdDesktop(fixture)); }
});

test("harness-only outer deadline includes queued operations and rejects expired success", async () => {
  assert.equal(remainingStartupMs(5400000, 0), COLD_STARTUP_MS);
  assert.equal(remainingStartupMs(5400000, 5000000), 400000);
  assert.throws(() => remainingStartupMs(100, 100), /UNPROVEN/u);
  let ran = false;
  await assert.rejects(withinStartupDeadline(() => { ran = true; }, Date.now() - 1), /UNPROVEN/u);
  assert.equal(ran, false);
  assert.equal(await withinStartupDeadline(() => 123, Date.now() + 1000), 123);
  await assert.rejects(withinStartupDeadline(() => new Promise(() => {}), Date.now() + 15), /UNPROVEN/u);
});
