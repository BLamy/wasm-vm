import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { observeHyprlandRenderer, parseHyprlandRendererLog } from "./omarchy-renderer-log.mjs";
import { COLD_BLANK_PATH, coldPairUrl, assertEmptyOriginStorage, assertColdRestore, remainingStartupMs } from "./omarchy-cold-pair.mjs";
import { errors as playwrightErrors } from "../../web/node_modules/playwright/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.join(here, "omarchy-desktop-live.mjs"), "utf8");

test("prewarm sync proof rejects cross-TTY marker evidence", () => {
  assert.ok(source.includes("history -c && clear && sync && printf"));
  assert.ok(source.includes("readGuestFileEventually(targetPage, markerFile, marker"));
  assert.ok(source.includes("rm -f -- '${markerFile}' && sync"));
  assert.ok(source.includes("clearAndHistoryProvenByMarker: false"));
  assert.doesNotMatch(source, /__omarchyLiveEvidence\?\.serial\.includes\(marker\)/u);
});

test("prewarm clear proof requires a new real frame and focused Foot", () => {
  assert.ok(source.includes("const afterMarkerPresentation = await presentationProof(targetPage)"));
  assert.ok(source.includes("waitForFreshPresentation("));
  assert.ok(source.includes("markerBaseline"));
  assert.ok(source.includes("framesReceived"));
  assert.ok(source.includes("x: 301, y: 201"));
  assert.ok(source.includes("clear frame is not focused Foot"));
  assert.ok(source.includes("assertCanvasFocus(targetPage, `${label}:frame`, keyboardUrl)"));
});

test("post-marker presentation helper rejects typing frames", () => {
  const result = spawnSync(process.execPath, [path.join(here, "omarchy-desktop-live.mjs"), "--selftest-presentation"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("candidate mode is explicitly local-only and hash-bound", () => {
  assert.ok(source.includes("OMARCHY_CANDIDATE_PAIR_DIR"));
  assert.ok(source.includes("OMARCHY_CANDIDATE_CHUNKS"));
  assert.ok(source.includes("must be supplied together"));
  assert.ok(source.includes("local-only candidate inputs require URL argument local or selftest"));
  assert.ok(source.includes("/candidate/kernel"));
  assert.ok(source.includes("/candidate/boot-snapshot"));
  assert.ok(source.includes("/candidate/overlay-delta"));
  assert.ok(source.includes("chunked-omarchy/manifest-${manifestSha256}.json"));
  assert.ok(source.includes("candidate chunk ${name}"));
  assert.ok(source.includes("omarchyAssetBase"));
  assert.ok(source.includes("source: candidate.source"));
  assert.match(source, /candidate content-addressed chunk must be served/u);
});

test("renderer proof binds current Hyprland PID and instance before physical input", () => {
  assert.ok(source.includes("OMARCHY_EXPECT_RENDERER"));
  assert.ok(source.includes("Number.isSafeInteger(instance.pid)"));
  assert.ok(source.includes("/proc/${pid}/environ"));
  assert.ok(source.includes("ps -T -p ${pid} -o comm="));
  assert.ok(source.includes("DEBUG ]: Renderer:"));
  assert.ok(source.includes("observeHyprlandRenderer({ log: log.stdout, threads: threads.stdout, expectedRenderer })"));
  assert.ok(source.includes("llvmpipe worker present for softpipe"));
  assert.ok(source.indexOf("proveHyprlandRenderer(page, \"initial desktop\")")
    < source.indexOf("physical-keyboard-before"));
});

test("LP0 is configuration-only evidence and is checked before physical input", () => {
  assert.ok(source.includes("OMARCHY_EXPECT_LP_NUM_THREADS"));
  assert.ok(source.includes("lp0-configuration-observed"));
  assert.ok(source.includes("activeRendererValidated: false"));
  assert.ok(source.includes("validateExpectedLpEnvironment"));
  assert.ok(source.indexOf("proveHyprlandRenderer(page, \"initial desktop\")")
    < source.indexOf("physical-keyboard-before"));
});

test("actual built recording covers served resources and pre-send RPCs, even timed-out ones", () => {
  assert.ok(source.includes("context.addInitScript(installWireEvidence)"));
  assert.ok(source.indexOf("context.addInitScript(installWireEvidence)") < source.indexOf("const page = await context.newPage()"));
  assert.ok(source.includes("resourceIdentities.push(servedIdentity"));
  assert.ok(source.includes('context.on("request"'));
  const rpc = source.slice(source.indexOf("const exec = async"), source.indexOf("async function collectWireEvidence"));
  assert.ok(rpc.indexOf("targetPage.evaluate") >= 0);
  assert.ok(rpc.indexOf("report.serialCommands.push") < rpc.indexOf("targetPage.evaluate"));
  assert.ok(source.includes('await collectWireEvidence(page, "before-reload")'));
  assert.ok(source.includes('await collectWireEvidence(page, "final")'));
});

test("renderer log parser accepts the real DEBUG suffix labels", () => {
  assert.deepEqual(parseHyprlandRendererLog(
    "[ 125.755907] omarchy-demo uwsm_hyprland.desktop[478]: DEBUG ]: Renderer: llvmpipe (LLVM 19.1.7, 256 bits)\nDEBUG ]: Vendor: Mesa/X.org",
    "llvmpipe",
  ), {
    renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", vendor: "Mesa/X.org", positivelyMatched: true,
  });
});

test("renderer log parser rejects wrong, missing, ambiguous, and misleading records", () => {
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: zink (llvmpipe)\nDEBUG ]: Vendor: Mesa", "llvmpipe",
  ), /positively match requested driver/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: llvmpipe (LLVM)\nDEBUG ]: Vendor: Mesa", "softpipe",
  ), /positively match requested driver/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: llvmpipe (LLVM)", "llvmpipe",
  ), /Vendor log line is absent or ambiguous/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: llvmpipe (LLVM)\nDEBUG ]: Renderer: llvmpipe (LLVM 2)\nDEBUG ]: Vendor: Mesa",
    "llvmpipe",
  ), /Renderer log line is absent or ambiguous/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Requested Renderer: \"llvmpipe\"\nDEBUG ]: Vendor: Mesa", "llvmpipe",
  ), /Renderer log line is absent or ambiguous/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Error: Requested Renderer: \"llvmpipe\"\nDEBUG ]: Vendor: Mesa", "llvmpipe",
  ), /Renderer log line is absent or ambiguous/u);
});

test("nonce readback caps every guest RPC by the remaining 120-second deadline", () => {
  assert.ok(source.includes("Math.min(300000, remaining)"));
  assert.ok(source.includes("nonce readback completed after deadline"));
  assert.ok(source.includes("Math.min(1000, Math.max(1, deadline - Date.now()))"));
  assert.ok(source.includes("deadlineMs: timeoutMs, deadlineAt: new Date(deadline).toISOString()"));
  assert.ok(source.includes("120000, report.keyboard"));
  assert.ok(source.includes("report.keyboard.failedAt = new Date().toISOString()"));
  assert.ok(source.includes("guestFile.includes(nonce), false"));
  assert.doesNotMatch(source, /guestFile = `\/tmp\/desktop-keys-\$\{nonce\}`/u);
});

test("unlogged baseline worker evidence is explicitly weaker than a GL label", () => {
  assert.deepEqual(observeHyprlandRenderer({
    log: "\n", threads: "Hyprland\nllvmpipe-0\n", expectedRenderer: "llvmpipe",
  }), {
    kind: "llvmpipe-worker-observed", glLabelAvailable: false,
    note: "GL label unavailable; current compositor PID has a named llvmpipe worker",
  });
  for (const threads of ["Hyprland\n", "not-llvmpipe-0\n", "llvmpipe-0-extra\n"]) {
    assert.throws(() => observeHyprlandRenderer({ log: "", threads, expectedRenderer: "llvmpipe" }));
  }
  assert.throws(() => observeHyprlandRenderer({
    log: "", threads: "Hyprland\nllvmpipe-0\n", expectedRenderer: "softpipe",
  }));
  assert.throws(() => observeHyprlandRenderer({
    log: "DEBUG ]: Renderer: zink (llvmpipe)\nDEBUG ]: Vendor: Mesa",
    threads: "llvmpipe-0\n", expectedRenderer: "llvmpipe",
  }));
  assert.equal(observeHyprlandRenderer({
    log: "DEBUG ]: Renderer: softpipe\nDEBUG ]: Vendor: Mesa/X.org",
    threads: "Hyprland\n", expectedRenderer: "softpipe",
  }).kind, "gl-renderer-label-observed");
});

test("harness-only cold local HTTP selftest serves kernel/chunks and refuses snapshot routes without a browser", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-cold-http-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const chunk = Buffer.alloc(262144);
  const digest = createHash("sha256").update(chunk).digest("hex");
  // Synthetic repeated-zero disk manifest: HTTP coverage only, never an LP0 image claim.
  await fs.writeFile(path.join(directory, `${digest}.bin`), chunk);
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ version: 1,
    image_len: 4294967296, chunk_size: 262144, layout: "split", chunks: Array(16384).fill(digest) }));
  const output = path.join(directory, "result");
  const run = spawnSync(process.execPath, [path.join(here, "omarchy-desktop-live.mjs"), "selftest", output, "cold-pair"], {
    // HTTP fixture setup is not a desktop startup/input performance claim.
    encoding: "utf8", timeout: 120000,
    env: { ...process.env, OMARCHY_CANDIDATE_CHUNKS: directory, OMARCHY_CANDIDATE_PAIR_DIR: "",
      OMARCHY_EXPECT_RENDERER: "llvmpipe", OMARCHY_EXPECT_LP_NUM_THREADS: "0", OMARCHY_BROWSER_TIMEOUT_MS: "5400000" },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"));
  assert.equal(report.result, "http-selftest-passed");
  assert.deepEqual(Object.keys(report.candidate.manifest.artifacts), ["kernel"]);
  assert.equal(report.candidate.source.bootSnapshot, undefined);
  assert.equal(report.candidate.source.overlayDelta, undefined);
  assert.equal(report.candidate.source.cold, true);
  assert.equal(new URL(report.url).searchParams.get("noSnapshot"), "1");
  assert.equal(new URL(report.url).searchParams.get("persist"), "1");
  assert.equal((await fs.stat(output)).mode & 0o777, 0o700);
  assert.equal(report.browserRequests.length, 0);
  assert.ok(report.resourceIdentities.some(row => row.pathname === COLD_BLANK_PATH && row.status === 200));
});

test("harness-only actual cold orchestration inspects storage before app and returns after pair without input", async () => {
  const trace = [];
  const report = { errors: [] };
  const url = coldPairUrl("http://127.0.0.1:4321/app.html?guest=omarchy&desktop=1#ide").href;
  let location = new URL("http://127.0.0.1:4321/");
  const page = {
    async goto(next) { location = new URL(next); trace.push(location.pathname); },
    async waitForFunction() {},
    async evaluate(fn) {
      const result = await vm.runInNewContext(`(${fn.toString()})()`, {
        location, window: { __omarchyLiveEvidence: { ready: true }, __omarchyWireEvidence: { workerTraffic: [] },
          __linux: { restoredFromBootSnapshot: () => false },
          ...(location.pathname === "/app.html" ? { __linuxCtl: { storedSnapshotRestoreEvidence: () =>
            ({ attempted: true, decision: "missing", overlayGeneration: 0 }) } } : {}) },
        indexedDB: { databases: async () => [] }, caches: { keys: async () => [] },
        navigator: { serviceWorker: { getRegistrations: async () => [], controller: null } },
        localStorage: {}, sessionStorage: {},
      });
      return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
    },
    setViewportSize() { assert.fail("cold-pair entered resize/input path"); },
  };
  const bindings = {
    coldPair: true, inputTrial: false, coldDeadline: null, coldStartupMs: 5400000, COLD_BLANK_PATH, page, report, url,
    URL, Date, assert, remainingStartupMs, assertColdRestore,
    assertEmptyOriginStorage(state, origin) { assertEmptyOriginStorage(state, origin); trace.push("empty-origin"); },
    startupCall: op => op(), assertRealOmarchyLayout: async () => {}, recordBuildIdentities: async () => {},
    observeServiceWorker: async () => {}, screenshot: async name => trace.push(name), mode: "cold-pair",
    observeLoaderIdentity: async () => ({ baseBinding: "a".repeat(64) }),
    proveHyprlandRenderer: async () => { trace.push("renderer"); return { instance: { instance: "fixture_123", pid: 123 } }; },
    exec: async command => { trace.push(command); return { exit: 0, stdout: command.includes("instances") ? '[{"instance":"fixture_123","pid":123}]' : "[]" }; },
    assertColdDesktop: observation => { assert.equal(observation.renderer.instance.pid, 123); trace.push("desktop-proof"); return { foot: { pid: 234 } }; },
    capturePair: async () => { trace.push("capture"); report.pair = { synthetic: true }; },
  };
  const start = source.indexOf("async function runLive() {");
  const end = source.indexOf("\ntry {\n  await runLive();", start);
  assert.ok(start >= 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(bindings), `${source.slice(start, end)}\nreturn runLive();`)(...Object.values(bindings));
  assert.deepEqual(trace.slice(0, 3), [COLD_BLANK_PATH, "empty-origin", "/app.html"]);
  assert.ok(trace.indexOf("renderer") < trace.indexOf("desktop-proof"));
  assert.ok(trace.indexOf("desktop-proof") < trace.indexOf("capture"));
  assert.equal(trace.at(-1), "capture");
  assert.ok(trace.includes("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i fixture_123 -j clients"));
  assert.equal(report.keyboard, undefined);
  assert.equal(report.capturePrewarm, undefined);
  assert.equal(report.result, "cold-pair-captured-input-unverified");
});

test("harness-only capture selects exact overlay when both overlay and snapshot databases exist", async () => {
  const base = "a".repeat(64);
  const startToken = "const count = await page.evaluate(";
  const start = source.indexOf(startToken, source.indexOf("async function capturePair(")) + startToken.length;
  const end = source.indexOf("}, { base, coldPair });", start) + 1;
  assert.ok(start >= startToken.length && end > start);
  const callback = source.slice(start, end);
  async function run(names, hasBlocks = true) {
    const opened = [], state = {};
    let closed = false;
    const request = result => {
      const r = { result };
      queueMicrotask(() => r.onsuccess());
      return r;
    };
    const db = {
      objectStoreNames: { contains: name => name === "blocks" && hasBlocks },
      close: () => { closed = true; },
      transaction(name) {
        assert.equal(name, "blocks");
        return { objectStore(store) {
          assert.equal(store, "blocks");
          return { getAllKeys: () => request([5, 9]) };
        } };
      },
    };
    const execute = vm.runInNewContext(`(${callback})`, {
      window: state,
      indexedDB: { databases: async () => names.map(name => ({ name })),
        open: name => { opened.push(name); return request(db); } },
    });
    try {
      const count = await execute({ base, coldPair: true });
      assert.equal(count, 2);
      assert.deepEqual(opened, [`wvov-${base}`]);
      assert.equal(state.__omarchyExportDb, db);
    } catch (error) {
      if (!hasBlocks) assert.equal(closed, true, "invalid overlay must be closed");
      else assert.deepEqual(opened, [], "missing overlay must not open a snapshot or create a database");
      throw error;
    }
  }
  await run([`wvsn-${base}`, `wvov-${base}`, `wvov-${base}-unrelated`]);
  await assert.rejects(run([`wvsn-${base}`, `wvov-${base}-unrelated`]), /expected one fresh overlay/u);
  await assert.rejects(run([`wvsn-${base}`, `wvov-${base}`], false), /no blocks store/u);
});

// Execute the actual readiness-loop source with synthetic page responses and immediate polling sleeps.
// The only manufactured failures here are harness fixtures, never recorded guest evidence.
async function screenshotSequence({ cold = true, progressError = null, desktopError = null }) {
  const trace = [], diagnostics = [];
  const report = { errors: [], progressCaptureErrors: [] };
  const deadline = Date.now() + 400000;
  const ready = [false, true, true];
  const page = {
    evaluate: async fn => fn.toString().includes("__omarchyLiveEvidence.ready") ? ready.shift() : {},
    locator: () => ({ textContent: async () => { trace.push("progress-status"); return "Linux booting"; } }),
  };
  const bindings = { coldPair: cold, coldDeadline: cold ? deadline : null, page, report, Date, assert, remainingStartupMs,
    playwrightErrors, process: { env: {} }, startupCall: op => op(), setTimeout: callback => callback(),
    console: { warn: value => diagnostics.push(value), log: () => {} },
    screenshot: async (name, targetPage, timeoutMs = 20000) => {
      trace.push({ name, timeoutMs });
      if (name === "latest.png" && progressError) throw progressError;
      if (name === "desktop.png" && desktopError) throw desktopError;
    },
  };
  const start = source.indexOf("  const deadline = coldDeadline ??", source.indexOf("async function runLive()"));
  const end = source.indexOf("  report.restored =", start);
  assert.ok(start >= 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let error = null;
  try { await new AsyncFunction(...Object.keys(bindings), source.slice(start, end))(...Object.values(bindings)); }
  catch (caught) { error = caught; }
  return { trace, diagnostics, report, error };
}

test("harness-only cold progress TimeoutError is recorded before startup continues to mandatory desktop capture", async () => {
  const failure = new playwrightErrors.TimeoutError("page.screenshot: Timeout 20000ms exceeded");
  const run = await screenshotSequence({ progressError: failure });
  assert.equal(run.error, null);
  assert.deepEqual(run.trace.slice(0, 2), [{ name: "latest.png", timeoutMs: 20000 }, "progress-status"]);
  assert.equal(run.trace[2].name, "desktop.png");
  assert.ok(run.trace[2].timeoutMs > 300000 && run.trace[2].timeoutMs <= 400000);
  assert.deepEqual(run.report.errors, []);
  assert.equal(run.report.progressCaptureErrors.length, 1);
  const row = run.report.progressCaptureErrors[0];
  assert.equal(row.name, "latest.png");
  assert.equal(row.error, String(failure));
  assert.ok(Number.isFinite(Date.parse(row.timestamp)));
  assert.equal(run.diagnostics[0], `OMARCHY_PROGRESS_CAPTURE_ERROR ${JSON.stringify(row)}`);
});

test("harness-only progress catch propagates non-Playwright errors and verify-mode timeouts", async () => {
  const errors = [new Error("page closed"), Object.assign(new Error("outer deadline exceeded"), { name: "TimeoutError" })];
  for (const progressError of errors) {
    const run = await screenshotSequence({ progressError });
    assert.equal(run.error, progressError);
    assert.equal(run.trace.length, 1);
    assert.deepEqual(run.report.progressCaptureErrors, []);
  }
  const timeout = new playwrightErrors.TimeoutError("verify progress timeout");
  const verify = await screenshotSequence({ cold: false, progressError: timeout });
  assert.equal(verify.error, timeout);
  assert.equal(verify.trace.length, 1);
  assert.deepEqual(verify.report.progressCaptureErrors, []);
  const ordinary = await screenshotSequence({ cold: false });
  assert.equal(ordinary.error, null);
  assert.equal(ordinary.trace[2].timeoutMs, 20000);
});

test("harness-only final desktop TimeoutError remains fatal after a tolerated progress timeout", async () => {
  const desktopError = new playwrightErrors.TimeoutError("mandatory desktop timed out");
  const run = await screenshotSequence({ progressError: new playwrightErrors.TimeoutError("progress timed out"), desktopError });
  assert.equal(run.error, desktopError);
  assert.equal(run.trace.at(-1).name, "desktop.png");
  assert.equal(run.report.progressCaptureErrors.length, 1);
});

test("harness-only screenshot helper forwards the supplied timeout and keeps the 20-second default", async () => {
  const calls = [], report = { observations: [] };
  const bindings = { path, out: "/synthetic", page: { screenshot: async options => calls.push(options) }, report,
    fs: { readFile: async () => Buffer.from("synthetic screenshot bytes") }, createHash, console: { log() {} } };
  const start = source.indexOf("async function screenshot(");
  const end = source.indexOf("async function runtimeDiagnostics(", start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(bindings), `${source.slice(start, end)}
    await screenshot("latest.png"); await screenshot("desktop.png", page, 321000);`)(...Object.values(bindings));
  assert.deepEqual(calls, [{ path: "/synthetic/latest.png", timeout: 20000 }, { path: "/synthetic/desktop.png", timeout: 321000 }]);
  assert.equal(report.observations.length, 2);
});
