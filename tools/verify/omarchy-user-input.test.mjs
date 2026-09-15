// T03m harness-only synthetic fixtures. No browser, guest, file effect, pixels or input proof.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { physicalStroke } from "./omarchy-browser-session.mjs";
import { assertInputTrialRuntime, inputTrialOptions } from "./omarchy-input-trial.mjs";

const source = readFileSync(new URL("./omarchy-desktop-live.mjs", import.meta.url), "utf8");
const trialSource = readFileSync(new URL("./omarchy-input-trial.mjs", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function slice(text, start, end) {
  const i = text.indexOf(start), j = text.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `actual source boundary: ${start}`);
  return text.slice(i, j);
}
const runSource = slice(source, "async function runLive() {", "\ntry {\n  await runLive();");
const actualHelpers = [
  slice(source, "async function mappedFoot(", "async function proveHyprlandRenderer("),
  slice(source, "async function observeFocus(", "async function assertRealOmarchyLayout("),
  slice(source, "async function readGuestFileEventually(", "async function typePhysical("),
  slice(source, "async function waitForFreshPresentation(", "function layerRecords("),
  trialSource.slice(trialSource.indexOf("export function remainingTrialMs(")).replace(/^export /gm, ""),
  slice(source, "const startupCall =", "const exec = async"),
].join("\n");

function fixture({ mode = "input-trial", missingReady = false, lostFocus = false,
  wrongNonce = false, lateReadback = false, stalePresentation = false,
  missingFoot = false, wrongActive = false, stopAtFirstKey = false,
  lateTyping = false } = {}) {
  const trace = [], commands = [], keys = [], screenshots = [], deadlines = [];
  const report = { errors: [], observations: [], trial: {}, inputEvents: [] };
  const trial = inputTrialOptions({ urlArg: "local", pair: "fixture", chunks: "fixture",
    arm: "control", renderer: null, lp: null });
  let now = Date.now(), focus = "", entered = false, typed = "", shift = false;
  let randomCall = 0;
  const epoch = now, readyMs = 5;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const url = "http://127.0.0.1:4321/app.html?guest=omarchy&desktop=1#ide";
  const before = { framesReceived: 2, successfulPresents: 2 };
  const pageWindow = {
    __omarchyLiveEvidence: { ready: !missingReady, events: [{ type: "wvm:desktop-ready", ms: readyMs }] },
    __linux: { restoredFromBootSnapshot: () => true },
    __presentation: { state() {
      if (stalePresentation) { now += trial.captureMs + 1; return { ...before }; }
      return { framesReceived: 3, successfulPresents: 3 };
    } },
  };
  const document = { get activeElement() { return { id: focus, tagName: "CANVAS" }; } };
  const charFor = new Map();
  for (const character of "printf '0123456789abcdef' > /tmp/desktop-keys-") {
    const stroke = physicalStroke(character);
    charFor.set(`${stroke.code}:${Boolean(stroke.shift)}`, character);
  }
  const page = {
    async goto() { trace.push("goto"); now += 10; },
    async waitForFunction() {}, url: () => url,
    async evaluate(fn) {
      const result = await vm.runInNewContext(`(${fn.toString()})()`, {
        window: pageWindow, document, location: { href: url },
      });
      if (fn.toString().includes("__omarchyLiveEvidence.ready")) {
        trace.push("ready");
        if (missingReady) now += trial.startupMs + 1;
      }
      if (fn.toString().includes("activeId")) trace.push("focus");
      if (fn.toString().includes("__presentation")) trace.push("presentation");
      return result;
    },
    locator() { return { async click() { trace.push("click"); focus = lostFocus ? "elsewhere" : "ide-display-canvas"; },
      async textContent() { return "fixture boot"; } }; },
    keyboard: {
      async down(code) { keys.push(["down", code]); shift = true; },
      async up(code) { keys.push(["up", code]); shift = false; },
      async press(code) {
        trace.push("key");
        if (stopAtFirstKey) throw new Error("fixture stopped at first physical key");
        if (lateTyping) now += trial.typingMs + 1;
        now++;
        keys.push(["press", code]);
        report.inputEvents.push({ context: "primary", epoch: "final", type: "keydown", trusted: true,
          code, ms: now - epoch }); // Explicitly synthetic; actual runs use the DOM observer.
        if (code === "Enter") { entered = true; return; }
        assert.ok(charFor.has(`${code}:${shift}`), `unexpected physical stroke ${code}:${shift}`);
        typed += charFor.get(`${code}:${shift}`);
      },
    },
  };
  const state = { presentation: before, clock: { mode: "icount", clockDiv: 64 },
    jit: { hasExecutor: true, admissionProbe: false,
      coldCounterRecycling: { enabled: false, epochs: "0", discardedCounters: "0", threshold: 512, capacity: 65536 },
      decodedCacheEntries: 4096, jitResidencyPolicy: "repack-off", jitResidencyCap: 24, entryCost: { timingEnabled: false } } };
  const bindings = {
    assert, URL, Date: Clock, setTimeout, clearTimeout, process: { send() {}, env: {} },
    console: { log() {}, warn() {} }, page, report, url, trial, inputTrial: mode === "input-trial",
    coldPair: false, coldDeadline: null, trialCaptureDeadline: null, mode,
    expectedRenderer: mode === "input-trial" ? null : "llvmpipe", prewarmTimeoutMs: 3600000,
    physicalStroke, assertInputTrialRuntime,
    randomBytes: () => Buffer.from((randomCall++ ? "b" : "a").repeat(16), "hex"),
    assertRealOmarchyLayout: async () => { trace.push("layout"); },
    recordBuildIdentities: async () => {}, observeServiceWorker: async () => {},
    observeLoaderIdentity: async () => ({ baseBinding: "fixture" }),
    assertNoOmarchyPersistentIdb: async () => { trace.push("no-persistence"); },
    proveHyprlandRenderer: async () => { trace.push("renderer-attestation"); },
    screenshot: async (name, target, timeout = 20000) => { screenshots.push(name); trace.push(name); deadlines.push(timeout); },
    runtimeDiagnostics: async () => { trace.push("runtime"); return structuredClone(state); },
    exec: async (command, target, label, timeout) => {
      commands.push(command);
      if (command.endsWith("-j clients")) return { exit: 0, stdout: JSON.stringify(missingFoot ? [] :
        [{ class: "foot", mapped: true, hidden: false, size: [1280, 800], address: "0x123" }]) };
      if (command.endsWith("-j activewindow")) return { exit: 0, stdout: JSON.stringify({ address: wrongActive ? "0x456" : "0x123" }) };
      assert.ok(entered, "readback must follow physical Enter");
      assert.equal(command, `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi`);
      assert.ok(!command.includes(report.keyboard.nonce), "nonce must never be supplied through serial");
      assert.ok(timeout <= 120000);
      trace.push("readback");
      if (lateReadback) now = report.keyboard.enteredAtMs + trial.readbackMs + 1;
      const expectedCommand = `printf '${report.keyboard.nonce}' > ${report.keyboard.guestFile}`;
      if (typed !== expectedCommand) return { exit: 1, stdout: "synthetic command incomplete" };
      return { exit: 0, stdout: wrongNonce ? "wrong synthetic nonce" : report.keyboard.nonce };
    },
  };
  async function run() {
    try {
      await new AsyncFunction(...Object.keys(bindings), `${actualHelpers}\n${runSource}\nawait runLive();`)(...Object.values(bindings));
      return null;
    } catch (error) { return error; }
  }
  return { report, trace, commands, keys, screenshots, deadlines, run, trial, page, readyMs };
}

test("synthetic actual input-trial reaches physical keys without mapped-client/active-window RPCs", async () => {
  const f = fixture();
  assert.equal(await f.run(), null);
  assert.equal(f.report.result, "input-trial-physical-nonce-and-fresh-presentation");
  assert.equal(f.report.foot, undefined);
  assert.equal(f.commands.length, 1, "only the independent post-input readback is a recorder RPC");
  assert.deepEqual(f.keys[0], ["press", "KeyP"]);
  assert.deepEqual(f.keys.at(-1), ["press", "Enter"]);
  const order = ["ready", "desktop.png", "click", "focus", "key", "readback", "presentation", "desktop-keyboard.png"];
  for (let i = 1; i < order.length; i++) assert.ok(f.trace.indexOf(order[i - 1]) < f.trace.indexOf(order[i]), order.join(" → "));
  assert.ok(!f.report.keyboard.guestFile.includes(f.report.keyboard.nonce));
  assert.equal(f.report.startup.timeoutMs, 300000);
  assert.equal(f.report.keyboard.deadlineMs, 120000);
  assert.equal(Date.parse(f.report.keyboard.deadlineAt), f.report.keyboard.enteredAtMs + 120000);
  assert.deepEqual(f.deadlines, [20000, 20000]);
});

test("synthetic capture and verify retain actual mapped-Foot and active-window checks before keys", async () => {
  for (const mode of ["capture", "verify"]) {
    const f = fixture({ mode, stopAtFirstKey: true });
    assert.match(String(await f.run()), /fixture stopped at first physical key/);
    assert.deepEqual(f.commands, ["XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients",
      "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow"]);
    assert.equal(f.report.foot.address, "0x123");
    assert.ok(f.trace.indexOf("renderer-attestation") < f.trace.indexOf("key"));
    assert.equal(f.trace.includes("no-persistence"), mode === "verify");
    for (const mutation of [{ missingFoot: true }, { wrongActive: true }]) {
      const bad = fixture({ mode, ...mutation });
      assert.ok(await bad.run());
      assert.equal(bad.keys.length, 0);
      assert.equal(bad.report.result, undefined);
    }
  }
});

test("synthetic missing application readiness or lost canvas focus forbids any key", async () => {
  for (const mutation of [{ missingReady: true }, { lostFocus: true }]) {
    const f = fixture(mutation);
    assert.match(String(await f.run()), /deadline exceeded|stole focus/);
    assert.equal(f.keys.length, 0);
    assert.equal(f.commands.length, 0);
    assert.equal(f.report.result, undefined);
  }
});

test("synthetic actual nonce reader rejects mismatched bytes in a successful RPC response", async () => {
  const f = fixture({ wrongNonce: true });
  assert.match(String(await f.run()), /nonce readback mismatch/);
  assert.equal(f.report.keyboard.verified, false);
  assert.ok(f.report.keyboard.failedAt);
  assert.equal(f.report.result, undefined);
  assert.ok(!f.screenshots.includes("desktop-keyboard.png"));
});

test("synthetic late typing/readback and stale presentation cannot publish success", async () => {
  for (const mutation of [{ lateTyping: true }, { lateReadback: true }, { stalePresentation: true }]) {
    const f = fixture(mutation);
    assert.match(String(await f.run()), /deadline exceeded|timed out waiting for presentation/);
    assert.equal(f.report.result, undefined);
    assert.ok(!f.screenshots.includes("desktop-keyboard.png"));
    if (mutation.lateReadback) assert.equal(f.report.keyboard.verified, false);
    if (mutation.stalePresentation) assert.equal(f.report.keyboard.verified, true, "nonce alone is not presentation success");
  }
});

test("synthetic timing observation uses same-page actual recorded event fields, not probe completion", async () => {
  const f = fixture();
  assert.equal(await f.run(), null);
  const events = [{ type: "wvm:desktop-ready", ms: f.readyMs }];
  const body = slice(source, "        report.events = evidence?.events ?? [];", "        await fs.writeFile(path.join(out, \"serial.log\")");
  new Function("report", "evidence", "page", "pageLabels", body)(f.report, { events }, f.page, new Map([[f.page, "primary"]]));
  assert.equal(f.report.keyboard.desktopReadyPageMs, f.readyMs);
  assert.equal(f.report.keyboard.firstPhysicalKeydownPageMs, f.report.inputEvents[0].ms);
  assert.equal(f.report.keyboard.readyToFirstPhysicalKeydownMs, f.report.inputEvents[0].ms - f.readyMs);
  const missing = { keyboard: {}, inputEvents: [{ context: "other", epoch: "final", type: "keydown", trusted: true, ms: 100 }] };
  new Function("report", "evidence", "page", "pageLabels", body)(missing, { events }, f.page, new Map([[f.page, "primary"]]));
  assert.equal(missing.keyboard.readyToFirstPhysicalKeydownMs, undefined, "missing matching evidence stays missing");
});
