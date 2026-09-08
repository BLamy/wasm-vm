// Execute bounded production helpers/control blocks without importing the browser runner.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { assertWindowMoved } from "../../web/bench/desktop-perf.js";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing production boundary: ${startMarker}`);
  return source.slice(start, end);
}

const diagnosticOptions = vm.runInNewContext(
  `${between("function diagnosticOptions", "const diagnostic =")}\ndiagnosticOptions`,
  { assert, path },
);
const reuse = {
  E5_T26F_DIAGNOSTIC: "reuse",
  E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/e5-t26f-completion-fixture",
  E5_T26F_DIAGNOSTIC_PORT: "48123",
};
const complete = { ...reuse, E5_T26F_DIAGNOSTIC_COMPLETE: "1" };

test("completion is absent by default and requires exact string 1 plus reuse", () => {
  assert.equal(diagnosticOptions({}), null);
  assert.notEqual(diagnosticOptions(reuse).complete, true);
  assert.equal(diagnosticOptions(complete).complete, true);
  for (const value of ["", "0", "true", "01", "1 ", " 1", "1\n", 1, true, false, null, {}, ["1"]]) {
    assert.throws(() => diagnosticOptions({ ...reuse, E5_T26F_DIAGNOSTIC_COMPLETE: value }),
      assert.AssertionError, `invalid completion value ${String(value)}`);
  }
  for (const mode of [undefined, "", "create", "REUSE", "reuse "]) {
    assert.throws(() => diagnosticOptions({ ...complete, E5_T26F_DIAGNOSTIC: mode }),
      assert.AssertionError, `invalid completion mode ${String(mode)}`);
  }
});

test("completion rejects every tuning/instrumentation/command flag, including empty values", () => {
  const conflicts = {
    E5_T26F_DIAGNOSTIC_CPU: "1",
    E5_T26F_DIAGNOSTIC_LATENCY: "1",
    E5_T26F_DIAGNOSTIC_JIT: "1",
    E5_T26F_DIAGNOSTIC_RESIDENCY: "repack-off",
    E5_T26F_DIAGNOSTIC_GUEST_CLOCK: "icount",
    E5_T26F_DIAGNOSTIC_COMMAND: "sh /tmp/a",
  };
  for (const [key, validValue] of Object.entries(conflicts)) {
    for (const value of ["", validValue]) {
      assert.throws(() => diagnosticOptions({ ...complete, [key]: value }),
        assert.AssertionError, `${key}=${JSON.stringify(value)} must not combine with completion`);
    }
  }
});

test("completion permits existing bounded key delay without altering the command or tuning defaults", () => {
  for (const delay of ["0", "5", "25"]) {
    const options = diagnosticOptions({ ...complete, E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: delay });
    assert.equal(options.complete, true);
    assert.equal(options.keyDelayMs, Number(delay));
    assert.equal(options.command, null);
    assert.equal(options.cpu, false);
    assert.equal(options.latency, false);
    assert.equal(options.jit, null);
    assert.equal(options.residency, null);
    assert.equal(options.guestClock, null);
  }
});

const completionHelpers = between("function retainDeferredInteractionCap", "async function recordDiagnosticJit");
const dragHelpers = between("async function recordCompletionGeneration", "function retainDeferredInteractionCap");
const waitHelper = between("async function waitFor(predicate", "async function sha256File");
const captureHelper = between("async function captureFailure", "async function launchTerminal");
const identityHelper = between("async function readBrowserIdentity", "assert.ok(Number.isSafeInteger(timeoutMs)");
const capAssertions = [...source.matchAll(/^\s*assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\);/gm)];
assert.equal(capAssertions.length, 1, "retain exactly the original final cap assertion");

function capError(start = 1_000, end = 3_001) {
  try {
    vm.runInNewContext(capAssertions[0][0], { assert, postRestoreStart: start, postRestoreEnd: end });
  } catch (error) { return error; }
  assert.fail("fixture must cross the production cap");
}

const originalStart = source.match(/  const postRestoreStart = firstRestore\.completedAt;\n  milestones\.postRestoreStart = postRestoreStart;/)?.[0];
assert.ok(originalStart, "timing must originate at the real first restore boundary");
const tail = between("  const postRestoreEnd = await page.evaluate(() => performance.now());",
  "\n} catch (error) {\n  const phase = lastPhase");
assert.ok(tail.endsWith("\n  }"), "expected the enclosing checkpoint-reuse branch terminator");
// Remove only the enclosing checkpoint branch's closing brace. Keep and execute all actual
// functional/cap/audit/diagnostic/drag/evidence branches inside it, including the acceptance guard.
const control = originalStart + "\n" + tail.slice(0, -"\n  }".length);
const failureHandler = between("\n} catch (error) {\n  const phase = lastPhase", "\n} finally {")
  .slice("\n} catch (error) {".length);

function fixture({ enabled = true, elapsed = 2_500, failAudit = null, failRestore = false } = {}) {
  const events = [];
  const writes = [];
  const captures = [];
  let now = 1_000 + elapsed;
  let snapshotIndex = 0;
  let paused = false;
  let moves = 0;
  const storage = new Map();
  const dragBox = { x: 17, y: 23, width: 1280, height: 800 };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [FixtureDate.now()])); }
    static now() { return 1_700_000_000_000 + now; }
  }
  const laterError = new Error("later functional failure");
  const sandbox = {
    assert, assertWindowMoved, path, Number, Date: FixtureDate, diagnostic: diagnosticOptions(enabled ? complete : reuse),
    out: "/virtual/completion", head: "frozen-runner", startedAt: FixtureDate.now() - 1_000,
    imageSha256: "image-digest", manifestSha256: "manifest-digest", serverOutput: "server transcript",
    jsonReplacer: (_key, value) => typeof value === "bigint" ? String(value) : value,
    SHA256: /^[0-9a-f]{64}$/u, restoreUrl: "http://fixture/desktop?autoRestore=1",
    DESKTOP_STORAGE_KEY: "wasm-vm.desktop-snapshot.v1",
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => now },
    sleep: async (ms) => { events.push(`sleep:${ms}`); now += ms; },
    phaseProgress(phase, event = "start") {
      sandbox.lastPhase = { phase, event };
      events.push(`phase:${phase}:${event}`);
    },
    startProgressSampling() { events.push("sampling:start"); },
    stopProgressSampling() { events.push("sampling:stop"); },
    mkdir: async () => {},
    writeFile: async (file, value) => { writes.push({ file: path.basename(file), value }); events.push(`write:${path.basename(file)}`); },
    console: { log: () => {}, error: () => {} },
    desktopBox: async () => { events.push("desktopBox:refresh"); return dragBox; },
    guestPoint: (box, x, y) => {
      assert.equal(box, dragBox, "drag coordinates must use the freshly observed canvas box");
      return { x: box.x + x, y: box.y + y };
    },
    auditRestoreCoherence: async (restore, snapshot, label) => {
      events.push(`audit:${label}`);
      sandbox.phaseProgress(`audit:${label}`);
      assert.equal(restore, label === "normal" ? sandbox.firstRestore : sandbox.secondRestore);
      assert.equal(snapshot, label === "normal" ? sandbox.normalSnapshot : sandbox.snapshots[2]);
      now += 10_000; // auditing cannot grant a fresh interaction deadline
      if (label === failAudit) throw laterError;
    },
    reloadWithAutoRestore: async (url, label) => {
      events.push(`restore:${label}`);
      assert.equal(url, sandbox.restoreUrl);
      assert.equal(label, "drag");
      assert.equal(paused, true, "publication must remain paused through reload");
      assert.equal(sandbox.milestones.dragCheckpointBeforeReload.status, "passed");
      if (failRestore) throw laterError;
      return sandbox.secondRestore;
    },
    snapshotFixture(persist) {
      events.push(`snapshot:${snapshotIndex}:${persist}`);
      assert.equal(persist, snapshotIndex === 2, "only the moving-drag snapshot is persisted");
      if (snapshotIndex >= 2) assert.equal(paused, true, "moving and released saves require the existing paused boundary");
      if (persist) storage.set(sandbox.DESKTOP_STORAGE_KEY, JSON.stringify({ sha256: sandbox.snapshots[2].sha256 }));
      return sandbox.snapshots[snapshotIndex++];
    },
  };
  const context = vm.createContext(sandbox);
  // Data lives in the VM realm so the unmodified runner's strict deepEqual assertions stay strict.
  vm.runInContext(`
    milestones = { run: { acceptance: false, checkpoint: "retained-real-provenance" },
      normalRestore: { displayChecksPassed: true, checksPassed: false } };
    browserErrors = []; httpErrors = [];
    browserIdentity = { name: "chromium", version: "Chrome/fixture", headless: false };
    lastPhase = { phase: "post-restore:interaction-checks", event: "start" };
    lastProgressSample = null; progressProbe = null;
    interactionLatencyActive = false; interactionLatencyCollectionPending = false;
    focusBefore = 2; postBox = { x: 0, y: 0, width: 1280, height: 800 };
    postAudioCommand = { terminalMarkerSeen: true, visualDiffPixels: 2000 };
    normalSnapshot = { sha256: "a".repeat(64), machineResume: { persisted: true } };
    firstRestore = { completedAt: 1000, snapshotSha256: normalSnapshot.sha256 };
    milestones.normalRestore.result = firstRestore;
    snapshots = ["b", "c", "d", "e"].map((letter) => ({ sha256: letter.repeat(64),
      byteLength: 512, preFrontBufferCrc: "crc-exact", machineResume: { persisted: true, sha256: "machine", overlayGeneration: 621 } }));
    secondRestore = { snapshotSha256: snapshots[2].sha256, report: { fullRepairFrame: true },
      observation: { firstPresent: { crc32: "crc-exact" } }, machineResume: snapshots[2].machineResume,
      resume: { restored: true }, bootStates: [{ state: "restored" }] };
    terminalState = { pointerFrames: 3, keyboardFrames: 20 };
    pointerState = { heldButtons: [] };
    audioState = { policy: { state: "unlocked" }, sink: { context: { state: "running" }, renderedFrames: 1440 } };
    window = {
      __desktopTerminal: {
        state: () => terminalState, pointerState: () => pointerState, audio: () => audioState,
        serial: () => "real fixture serial", presentation: () => ({ successfulPresents: 3 }),
        restoreObservation: () => secondRestore.observation, restoreResult: () => secondRestore,
        saveDesktopSnapshot: ({ persist }) => snapshotFixture(persist),
      },
      __desktopCursor: { detectWindowChrome: () => assert.fail("drag must use the topmost titlebar reader"),
        state: () => ({ visible: true }) },
    };
    document = { documentElement: { dataset: { desktopReady: "ready", desktopRestored: "ready" } } };
  `, context);
  sandbox.window.__desktopController = {
    pause: async () => { events.push("controller:pause"); paused = true; },
    isPaused: async () => { events.push("controller:isPaused"); return paused; },
    snapshotGeneration: async () => { events.push("controller:generation"); return 621; },
    snapshotDecision: async () => { events.push("controller:decision"); return "resume"; },
    resume: () => assert.fail("no resume is permitted between publication and reload"),
  };
  const titlebar = vm.runInContext("({ left: 20, top: 30, bottom: 50 })", context);
  sandbox.dragTitlebarFixture = () => ({ ...titlebar });
  sandbox.page = {
    url: () => sandbox.restoreUrl,
    // Geometry has a separate framebuffer test suite. Substitute only this browser reader's
    // observation; execute the real wait, pause/recheck, audit and orchestration callbacks.
    evaluate: async (fn, arg) => fn === sandbox.readTopmostDragTitlebar
      ? { at: now, titlebar: sandbox.dragTitlebarFixture() } : fn(arg),
    waitForTimeout: async (ms) => { now += ms; },
    screenshot: async ({ path: file }) => events.push(`screenshot:${path.basename(file)}`),
    mouse: {
      move: async () => { events.push("mouse:move"); if (++moves === 2) titlebar.left += 80; },
      down: async () => events.push("mouse:down"),
      up: async () => events.push("mouse:up"),
    },
  };
  // Completion reuse has no cold setup values or Browser. Any accidental acceptance-path access
  // must fail instead of letting a fabricated placeholder satisfy serialization.
  for (const key of ["browser", "shellProbe", "agentProbe", "firstCommand", "cursorProof", "audioBefore",
    "preSnapshotPresents", "imageStat", "manifest", "launchOptions"]) {
    Object.defineProperty(sandbox, key, { get() { throw Error(`cold-only access: ${key}`); } });
  }
  const api = vm.runInContext(`${completionHelpers}\n${dragHelpers}\n${waitHelper}\n${captureHelper}\n${identityHelper}\n({
    retainDeferredInteractionCap, finishDiagnosticCompletion, captureFailure, readBrowserIdentity,
    observedDragTranslation, proveAndPauseDrag, auditFrozenDragSnapshot,
    fail: async (error) => { ${failureHandler} },
  })`, context);
  sandbox.captureFailure = async (label, error) => {
    captures.push({ label, error });
    events.push(`capture:${label}`);
    await api.captureFailure(label, error);
  };
  return {
    sandbox, context, api, events, writes, captures, laterError, titlebar, now: () => now,
    run: () => vm.runInContext(`(async () => { try { ${control} } catch (error) { ${failureHandler} } })()`, context),
    json: (name) => JSON.parse(writes.findLast(({ file }) => file === name)?.value ?? "null"),
  };
}

test("only the dedicated cap AssertionError with valid original boundaries can be retained", () => {
  const f = fixture();
  const cap = capError();
  assert.equal(f.api.retainDeferredInteractionCap(cap, 1_000, 3_001), cap);
  const saved = f.sandbox.milestones.deferredInteractionCap;
  assert.equal(saved.postRestoreStart, 1_000);
  assert.equal(saved.postRestoreEnd, 3_001);
  assert.equal(saved.elapsedMs, 2_001);
  assert.equal(saved.limitMs, 2_000);
  assert.equal(saved.acceptance, false);
  const others = [new Error(cap.message), new assert.AssertionError({ actual: false, expected: true,
    operator: "==", message: "functional failure" }), Object.assign({}, cap)];
  for (const [key, value] of [["actual", 0], ["expected", 1], ["operator", "strictEqual"], ["code", "OTHER"]]) {
    const wrong = capError(); wrong[key] = value; others.push(wrong);
  }
  for (const error of others) {
    assert.throws(() => f.api.retainDeferredInteractionCap(error, 1_000, 3_001), (caught) => caught === error);
    assert.equal(f.sandbox.milestones.deferredInteractionCap, saved);
  }
  for (const [start, end] of [[NaN, 4_000], [0, Infinity], [-1, 3_000], [0, -3_000], [3_000, 1_000], [0, 2_000]]) {
    assert.throws(() => f.api.retainDeferredInteractionCap(cap, start, end), (caught) => caught === cap);
    assert.equal(f.sandbox.milestones.deferredInteractionCap, saved);
  }
  for (const diagnostic of [null, { mode: "reuse", complete: false }, { mode: "create", complete: true }]) {
    f.sandbox.diagnostic = diagnostic;
    assert.throws(() => f.api.retainDeferredInteractionCap(cap, 1_000, 3_001), (caught) => caught === cap);
  }
});

test("completion executes real normal audit, drag phases and second restore, persists diagnostics then rethrows original cap", async () => {
  const f = fixture();
  let failure;
  await assert.rejects(f.run(), (error) => { failure = error; return error instanceof assert.AssertionError; });
  const firstCapture = f.captures[0];
  assert.equal(firstCapture.label, "diagnostic-completion-timing");
  assert.equal(failure, firstCapture.error, "nonzero path must rethrow the exact original cap object");
  assert.ok(f.events.indexOf("capture:diagnostic-completion-timing") < f.events.indexOf("audit:normal"));
  assert.ok(f.events.indexOf("sampling:start") > f.events.indexOf("sampling:stop"));
  assert.ok(f.events.indexOf("sampling:start") < f.events.indexOf("audit:normal"));
  assert.ok(f.events.includes("phase:post-restore:interaction-checks:timing-failed-continuing"));
  assert.equal(f.events.includes("phase:post-restore:interaction-checks:done"), false);
  assert.ok(f.events.indexOf("desktopBox:refresh") < f.events.indexOf("mouse:move"));
  assert.deepEqual(f.events.filter((event) => /^(audit:|restore:|snapshot:|mouse:)/u.test(event)), [
    "audit:normal", "mouse:move", "snapshot:0:false", "mouse:down", "snapshot:1:false",
    "mouse:move", "snapshot:2:true", "mouse:up", "snapshot:3:false", "restore:drag", "audit:drag",
  ]);
  const orderedBoundary = [
    "phase:drag:guest-translation:start", "controller:pause", "phase:drag:guest-translation:done",
    "snapshot:2:true", "phase:drag:checkpoint-Published:done", "mouse:up", "snapshot:3:false",
    "phase:drag:checkpoint-BeforeReload:done", "restore:drag",
  ];
  let previous = -1;
  for (const event of orderedBoundary) {
    const index = f.events.indexOf(event);
    assert.ok(index > previous, `${event} must follow the prior frozen-boundary step`);
    previous = index;
  }
  const immediate = f.json("diagnostic-completion-timing.json");
  assert.equal(immediate.milestones.deferredInteractionCap.postRestoreStart, 1_000);
  assert.equal(immediate.milestones.deferredInteractionCap.postRestoreEnd, 3_500);
  assert.equal(immediate.milestones.normalRestore.checksPassed, false);
  assert.equal(immediate.milestones.dragRestore, undefined, "capture preceded drag execution");
  const result = f.json("diagnostic-completion.json");
  assert.equal(result.schema, "wasm-vm.e5-t26f.diagnostic-completion.v1");
  assert.equal(result.acceptance, false);
  assert.equal(result.functionalChecksPassed, true);
  assert.equal(result.timingPassed, false);
  assert.equal(result.checksPassed, false);
  assert.equal(result.milestones.postRestoreStart, 1_000);
  assert.equal(result.milestones.postRestoreEnd, 3_500);
  assert.equal(result.milestones.dragMovement.status, "passed");
  assert.equal(result.milestones.dragMovement.pausedTranslation.deltaX, 80);
  for (const label of ["Published", "BeforeReload"]) {
    const checkpoint = result.milestones[`dragCheckpoint${label}`];
    assert.equal(checkpoint.status, "passed");
    assert.equal(checkpoint.observed.isPaused, true);
    assert.equal(checkpoint.observed.stillPaused, true);
    assert.equal(checkpoint.observed.generation, 621);
    assert.equal(checkpoint.observed.finalGeneration, 621);
    assert.equal(checkpoint.observed.envelopeSha256, result.milestones.dragSnapshot.sha256);
  }
  for (const name of ["postRestoreInteractionChecks", "normalRestore", "dragRestore"]) {
    assert.equal(result.milestones[name].functionalChecksPassed, true);
    assert.equal(result.milestones[name].checksPassed, false);
  }
  assert.equal(result.browser.version, "Chrome/fixture");
  assert.equal(result.milestones.run.checkpoint, "retained-real-provenance");
  for (const key of ["shellProbe", "agentProbe", "firstCommand", "cursorProof", "interactions", "image"]) {
    assert.equal(Object.hasOwn(result, key), false, `no fabricated cold field ${key}`);
  }
  assert.ok(f.events.includes("screenshot:diagnostic-completion.png"));
  assert.ok(f.writes.some(({ file }) => file === "diagnostic-completion-server.log"));
  assert.equal(f.events.some((event) => /desktop-roundtrip|diagnostic-iteration/u.test(event)), false);
});

test("completion at the exact cap stays diagnostic and never takes the normal artifact path", async () => {
  const f = fixture({ elapsed: 2_000 });
  await f.run();
  const result = f.json("diagnostic-completion.json");
  assert.equal(result.acceptance, false);
  assert.equal(result.timingPassed, true);
  assert.equal(result.checksPassed, true);
  assert.equal(result.milestones.deferredInteractionCap, undefined);
  assert.equal(f.captures.length, 0);
  assert.ok(f.events.includes("audit:drag"));
  assert.equal(f.events.some((event) => /desktop-roundtrip|diagnostic-iteration/u.test(event)), false);
});

test("ordinary reuse keeps its original cap failure and early diagnostic-only success", async () => {
  const late = fixture({ enabled: false });
  await assert.rejects(late.run(), /post-restore interaction exceeded 2 seconds/);
  assert.equal(late.captures[0].label, "post-restore");
  assert.equal(late.sandbox.milestones.deferredInteractionCap, undefined);
  assert.equal(late.events.includes("audit:normal"), false);
  const timely = fixture({ enabled: false, elapsed: 2_000 });
  await timely.run();
  assert.equal(timely.json("diagnostic-iteration.json").acceptance, false);
  assert.equal(timely.events.includes("audit:normal"), true);
  assert.equal(timely.events.includes("restore:drag"), false);
  assert.equal(timely.json("diagnostic-completion.json"), null);
});

test("functional assertions fail fast, including an unrelated failure with the cap's identical shape", async () => {
  const changes = [
    (f) => { f.sandbox.terminalState.pointerFrames = 2; },
    (f) => { f.sandbox.pointerState.heldButtons.push(1); },
    (f) => { f.sandbox.audioState.policy.state = "locked"; },
    (f) => { f.sandbox.postAudioCommand.terminalMarkerSeen = false; },
    (f) => { f.sandbox.postAudioCommand.visualDiffPixels = 1_999; },
    (f) => { f.sandbox.browserErrors.push("page error"); },
    (f) => { f.sandbox.httpErrors.push("HTTP error"); },
    (f) => { Object.defineProperty(f.sandbox.terminalState, "pointerFrames", { get() { throw capError(); } }); },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    await assert.rejects(f.run(), assert.AssertionError);
    assert.equal(f.sandbox.milestones.deferredInteractionCap, undefined);
    assert.equal(f.events.includes("audit:normal"), false);
    assert.equal(f.json("diagnostic-completion.json"), null);
  }
});

for (const options of [{ failAudit: "normal" }, { failAudit: "drag" }, { failRestore: true }]) {
  test(`later ${JSON.stringify(options)} failure retains timing evidence and refuses completion success`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), (error) => error === f.laterError);
    assert.equal(f.captures[0].label, "diagnostic-completion-timing");
    assert.equal(f.captures.at(-1).error, f.laterError);
    const later = f.json(`${f.captures.at(-1).label}.json`);
    assert.equal(later.error.message, f.laterError.message);
    assert.equal(later.milestones.deferredInteractionCap.error.message, f.captures[0].error.message);
    assert.equal(later.milestones.deferredInteractionCap.postRestoreStart, 1_000);
    assert.equal(later.milestones.deferredInteractionCap.postRestoreEnd, 3_500);
    assert.equal(later.milestones.normalRestore.checksPassed, false);
    assert.equal(f.json("diagnostic-completion.json"), null);
  });
}

test("persistent-context identity uses CDP with no Browser object and always detaches", async () => {
  const f = fixture();
  for (const fail of [false, true]) {
    const calls = [];
    const failure = new Error("CDP version failed");
    const page = {};
    const context = { newCDPSession: async (actual) => {
      assert.equal(actual, page);
      return { send: async (method) => { calls.push(method); if (fail) throw failure; return { product: "Chrome/real-identity" }; },
        detach: async () => { calls.push("detach"); } };
    } };
    const run = f.api.readBrowserIdentity(null, context, page, false);
    if (fail) await assert.rejects(run, (error) => error === failure);
    else {
      const identity = await run;
      assert.equal(identity.name, "chromium");
      assert.equal(identity.version, "Chrome/real-identity");
      assert.equal(identity.headless, false);
    }
    assert.deepEqual(calls, ["Browser.getVersion", "detach"]);
  }
});

test("finish refuses a dropped cap or contradictory metadata before writing any completion success", async () => {
  const attacks = [
    (_f, _cap) => null,
    (_f, _cap) => undefined,
    (_f, cap) => new Error(cap.message),
    (_f, _cap) => capError(), // same type/message, different retained stack
    (f, cap) => { delete f.sandbox.milestones.deferredInteractionCap; return cap; },
    (f, cap) => { f.sandbox.milestones.postRestoreStart = 1_001; return cap; },
    (f, cap) => { f.sandbox.milestones.postRestoreEnd = NaN; return cap; },
    (f, cap) => { f.sandbox.milestones.deferredInteractionCap.acceptance = true; return cap; },
    (f, cap) => { f.sandbox.milestones.deferredInteractionCap.limitMs = 4_000; return cap; },
    (f, cap) => { f.sandbox.milestones.postRestoreInteractionChecks.timingPassed = true; return cap; },
    (f, cap) => { f.sandbox.milestones.normalRestore.checksPassed = true; return cap; },
    (f, cap) => { f.sandbox.milestones.dragRestore.checksPassed = true; return cap; },
    (f, cap) => { f.sandbox.milestones.normalRestore.functionalChecksPassed = false; return cap; },
    (f, cap) => { f.sandbox.milestones.dragRestore.functionalChecksPassed = false; return cap; },
  ];
  for (const attack of attacks) {
    const f = fixture();
    await assert.rejects(f.run(), /post-restore interaction exceeded 2 seconds/);
    const cap = f.captures[0].error;
    const argument = attack(f, cap);
    f.writes.length = 0;
    await assert.rejects(f.api.finishDiagnosticCompletion(f.sandbox.browserIdentity, {}, argument),
      (error) => error instanceof assert.AssertionError && error !== cap);
    assert.equal(f.writes.length, 0, "inconsistent completion cannot overwrite the retained result");
  }
});

test("observed drag translation accepts only finite same-row rightward 64..96px geometry", () => {
  const f = fixture();
  const before = Object.freeze({ left: 20, top: 30, bottom: 50 });
  for (const delta of [64, 80, 96]) {
    for (const offset of [-1, 0, 1]) {
      const after = Object.freeze({ left: 20 + delta, top: 30 + offset, bottom: 50 + offset });
      const result = f.api.observedDragTranslation(before, after);
      assert.equal(result.deltaX, delta);
      assert.equal(result.displacementPx, delta);
    }
  }
  for (const delta of [-96, -80, -64, 0, 63.999, 96.001]) {
    assert.equal(f.api.observedDragTranslation(before, { ...before, left: before.left + delta }), null);
  }
  for (const field of ["left", "top", "bottom"]) {
    for (const value of [undefined, null, NaN, Infinity, -Infinity, "30"]) {
      assert.equal(f.api.observedDragTranslation(before, { left: 100, top: 30, bottom: 50, [field]: value }), null);
      assert.equal(f.api.observedDragTranslation({ ...before, [field]: value }, { left: 100, top: 30, bottom: 50 }), null);
    }
  }
  for (const after of [null, {}, { left: 100, top: 31.001, bottom: 50 }, { left: 100, top: 30, bottom: 48.999 }]) {
    assert.equal(f.api.observedDragTranslation(before, after), null, "another titlebar row must not prove the requested drag");
  }
});

test("drag translation permits only the exact 32px panel clamp or same-row rounding with unchanged height", () => {
  const f = fixture();
  const before = Object.freeze({ left: 557, top: 13, bottom: 39 });
  for (const top of [12, 13, 14, 31, 32, 33]) {
    for (const height of [25, 26, 27]) {
      const result = f.api.observedDragTranslation(before, { left: 644, top, bottom: top + height });
      assert.equal(result.deltaX, 87);
      assert.equal(result.displacementPx, 87);
    }
  }
  for (const top of [0, 11.999, 14.001, 20, 30.999, 33.001, 50, 80]) {
    assert.equal(f.api.observedDragTranslation(before, { left: 644, top, bottom: top + 26 }), null,
      `arbitrary vertical displacement to ${top} must not identify the same window`);
  }
  for (const top of [13, 32]) {
    for (const height of [0, 24.999, 27.001, 52]) {
      assert.equal(f.api.observedDragTranslation(before, { left: 644, top, bottom: top + height }), null,
        "matching row or panel clamp cannot excuse a changed window height");
    }
  }
  assert.equal(f.api.observedDragTranslation({ ...before, top: 50, bottom: 76 },
    { left: 644, top: 32, bottom: 58 }), null, "panel clamp must not move an already-lower window upward");
});

test("drag proof polls read-only geometry before pausing and independently rechecks the paused titlebar", async () => {
  const f = fixture();
  const before = { left: 20, top: 30, bottom: 50 };
  const moved = { ...before, left: 100 };
  const sequence = [null, before, { ...moved, top: 35 }, moved, { ...moved, left: 101 }];
  let reads = 0;
  f.sandbox.dragTitlebarFixture = () => {
    const titlebar = sequence[reads++];
    f.events.push(`chrome:${reads}`);
    return titlebar;
  };
  f.sandbox.milestones.postRestoreStart = 1_000;
  f.sandbox.milestones.postRestoreEnd = 3_500;
  const start = f.now();
  await f.api.proveAndPauseDrag(before);
  assert.equal(reads, 5);
  assert.equal(f.now() - start, 750);
  assert.deepEqual(f.events.filter((event) => event.startsWith("sleep:")), ["sleep:250", "sleep:250", "sleep:250"]);
  assert.ok(f.events.indexOf("controller:pause") > f.events.indexOf("chrome:4"));
  assert.ok(f.events.indexOf("controller:isPaused") > f.events.indexOf("controller:pause"));
  assert.ok(f.events.indexOf("chrome:5") > f.events.indexOf("controller:isPaused"));
  const evidence = f.sandbox.milestones.dragMovement;
  assert.equal(evidence.observed.titlebar, moved);
  assert.equal(evidence.observed.at, start + 750);
  assert.equal(evidence.translation.deltaX, 80);
  assert.equal(evidence.pausedTranslation.deltaX, 81, "paused geometry must be a fresh read, not the prior translation");
  assert.equal(evidence.paused.isPaused, true);
  assert.equal(evidence.status, "passed");
  assert.equal(f.sandbox.milestones.postRestoreStart, 1_000);
  assert.equal(f.sandbox.milestones.postRestoreEnd, 3_500);
});

test("missing, stale, wrong-direction and wrong-window drag evidence expires at 15s without pausing or saving", async () => {
  const before = { left: 20, top: 30, bottom: 50 };
  for (const titlebar of [null, before, { ...before, left: -60 }, { ...before, left: 100, bottom: 55 }]) {
    const f = fixture();
    let reads = 0;
    f.sandbox.dragTitlebarFixture = () => { reads += 1; return titlebar; };
    const start = f.now();
    await assert.rejects(f.api.proveAndPauseDrag(before), /bounded wait expired: guest window did not complete the requested 80px drag/);
    assert.equal(f.now() - start, 15_000);
    assert.equal(reads, 60, "the actual wait helper polls at 250ms within the fixed deadline");
    assert.equal(f.events.some((event) => /^(controller:|snapshot:|mouse:)/u.test(event)), false);
    assert.equal(f.sandbox.milestones.dragMovement.status, "waiting");
    assert.equal(f.sandbox.milestones.dragMovement.observed.titlebar, titlebar);
    assert.equal(f.sandbox.milestones.dragMovement.translation, null);
    assert.equal(f.sandbox.milestones.dragMovement.paused, undefined);
  }
});

test("pause refusal or a superseded paused titlebar cannot satisfy drag proof or publish a checkpoint", async () => {
  const before = { left: 20, top: 30, bottom: 50 };
  for (const failure of ["not-paused", "superseded", "pause-error"]) {
    const f = fixture();
    let pausedRead = false;
    f.sandbox.dragTitlebarFixture = () =>
      pausedRead && failure === "superseded" ? before : { ...before, left: 100 };
    const controller = f.sandbox.window.__desktopController;
    const pause = controller.pause;
    controller.pause = async () => {
      if (failure === "pause-error") throw f.laterError;
      await pause(); pausedRead = true;
    };
    if (failure === "not-paused") controller.isPaused = async () => false;
    await assert.rejects(f.api.proveAndPauseDrag(before), failure === "pause-error"
      ? (error) => error === f.laterError : /must leave the guest paused|no longer matches/);
    assert.equal(f.sandbox.milestones.dragMovement.translation.deltaX, 80);
    assert.notEqual(f.sandbox.milestones.dragMovement.status, "passed");
    assert.equal(f.events.some((event) => event.startsWith("snapshot:")), false);
  }
});

function frozenAuditFixture({ isPaused = true, stillPaused = true, generation = 621,
  finalGeneration = generation, decision = "resume", envelope = JSON.stringify({ sha256: "d".repeat(64) }) } = {}) {
  const f = fixture();
  const calls = [];
  let pauseReads = 0;
  let generationReads = 0;
  f.sandbox.window.__desktopController = {
    isPaused: async () => { calls.push("isPaused"); return pauseReads++ ? stillPaused : isPaused; },
    snapshotGeneration: async () => { calls.push("generation"); return generationReads++ ? finalGeneration : generation; },
    snapshotDecision: async () => { calls.push("decision"); return decision; },
    pause: () => assert.fail("audit must only observe, not repair, the paused boundary"),
    resume: () => assert.fail("audit must not resume the guest"),
  };
  f.sandbox.sessionStorage.getItem = (key) => {
    assert.equal(key, f.sandbox.DESKTOP_STORAGE_KEY);
    calls.push("envelope"); return envelope;
  };
  return { ...f, calls, snapshot: f.sandbox.snapshots[2] };
}

test("frozen checkpoint audit reads both pause/generation endpoints and the actual session envelope in order", async () => {
  for (const label of ["Published", "BeforeReload"]) {
    const f = frozenAuditFixture();
    await f.api.auditFrozenDragSnapshot(f.snapshot, label);
    assert.deepEqual(f.calls, ["isPaused", "generation", "decision", "envelope", "isPaused", "generation"]);
    const audit = f.sandbox.milestones[`dragCheckpoint${label}`];
    assert.equal(audit.status, "passed");
    assert.equal(audit.snapshotSha256, f.snapshot.sha256);
    assert.equal(audit.observed.at, f.now());
    assert.equal(audit.observed.decision, "resume");
    assert.equal(audit.observed.envelopeSha256, f.snapshot.sha256);
  }
});

test("frozen checkpoint audit refuses stale, advancing, unpaused or mismatched-envelope state and retains raw observations", async () => {
  const attacks = [
    { isPaused: false }, { isPaused: "true" }, { stillPaused: false },
    { generation: 625 }, { finalGeneration: 625 },
    ...[NaN, null, -1, 621.5, "621", Number.MAX_SAFE_INTEGER + 1].map((generation) => ({ generation })),
    { decision: "cold" }, { decision: "stale" }, { decision: null },
    { envelope: null }, { envelope: "{}" }, { envelope: JSON.stringify({ sha256: "e".repeat(64) }) },
  ];
  for (const options of attacks) {
    const f = frozenAuditFixture(options);
    await assert.rejects(f.api.auditFrozenDragSnapshot(f.snapshot, "Published"), assert.AssertionError);
    const audit = f.sandbox.milestones.dragCheckpointPublished;
    assert.equal(audit.status, "failed");
    assert.equal(typeof audit.error, "string");
    for (const key of ["isPaused", "stillPaused", "generation", "finalGeneration", "decision"]) {
      if (Object.hasOwn(options, key)) assert.equal(audit.observed[key], options[key], `retain actual ${key}`);
    }
    assert.equal(audit.observed.envelopeSha256, JSON.parse(options.envelope ?? "null")?.sha256 ??
      (Object.hasOwn(options, "envelope") ? null : f.snapshot.sha256));
    assert.equal(f.events.some((event) => /^(snapshot:|restore:)/u.test(event)), false);
  }
  for (const envelope of ["not JSON", "{"]) {
    const f = frozenAuditFixture({ envelope });
    await assert.rejects(f.api.auditFrozenDragSnapshot(f.snapshot, "BeforeReload"), /JSON/);
    assert.equal(f.sandbox.milestones.dragCheckpointBeforeReload.status, "failed");
  }
  const f = frozenAuditFixture();
  delete f.snapshot.machineResume.overlayGeneration;
  await assert.rejects(f.api.auditFrozenDragSnapshot(f.snapshot, "Published"), /disk generation advanced/);
  assert.equal(f.sandbox.milestones.dragCheckpointPublished.observed.generation, 621);
});

test("a failed frozen audit at publication or before reload stays fail-fast and preserves the original timing failure", async () => {
  for (const label of ["Published", "BeforeReload"]) {
    const f = fixture();
    const controller = f.sandbox.window.__desktopController;
    controller.snapshotDecision = async () =>
      f.sandbox.lastPhase.phase === `drag:checkpoint-${label}` ? "stale" : "resume";
    await assert.rejects(f.run(), /moving whole-machine snapshot is not coherent/);
    const audit = f.sandbox.milestones[`dragCheckpoint${label}`];
    assert.equal(audit.status, "failed");
    assert.equal(audit.observed.decision, "stale");
    assert.equal(f.events.includes("restore:drag"), false);
    assert.equal(f.events.includes("snapshot:3:false"), label === "BeforeReload");
    assert.equal(f.json("diagnostic-completion.json"), null);
    const failure = f.json(`${f.captures.at(-1).label}.json`);
    assert.equal(failure.milestones.deferredInteractionCap.postRestoreStart, 1_000);
    assert.equal(failure.milestones.deferredInteractionCap.postRestoreEnd, 3_500);
    assert.equal(failure.milestones[`dragCheckpoint${label}`].observed.decision, "stale");
  }
});

test("completion output guard permits only new/empty output and runs before browser or failure capture", async () => {
  const helper = between("async function requireEmptyCompletionOutput", "assert.ok(Number.isSafeInteger(timeoutMs)");
  const call = source.match(/^if \(diagnostic\?\.complete\) await requireEmptyCompletionOutput\(out\);$/m)?.[0];
  assert.ok(call, "execute the actual opt-in output guard");
  const startup = source.indexOf('\ntry {\n  phaseProgress("server:startup")');
  const manifest = source.indexOf("const manifestBytes = await readFile(manifestPath)");
  assert.ok(startup > source.indexOf(call) && manifest > source.indexOf(call),
    "protected-output refusal must precede artifact reads and the failure-capture try");
  for (const existing of [undefined, [], ["desktop-roundtrip.json"], ["unrelated-user-file.txt"]]) {
    let entries = existing?.slice();
    const calls = [];
    const sandbox = { assert, out: "/virtual/fresh-completion", diagnostic: { complete: true },
      mkdir: async (directory, options) => {
        calls.push("mkdir"); assert.equal(directory, sandbox.out); assert.equal(options.recursive, true);
        entries ??= [];
      },
      readdir: async (directory) => { calls.push("readdir"); assert.equal(directory, sandbox.out); return entries.slice(); },
    };
    const run = () => vm.runInNewContext(`${helper}\n(async () => { ${call} })()`, sandbox);
    if (existing?.length) await assert.rejects(run(), /refuses nonempty output directory/);
    else await run();
    assert.deepEqual(entries, existing ?? [], "existing directory entries must remain untouched");
    assert.deepEqual(calls, ["mkdir", "readdir"], "guard has no evidence/marker/browser side effects");
    for (const diagnostic of [null, { complete: false }]) {
      sandbox.diagnostic = diagnostic;
      calls.length = 0;
      await run();
      assert.deepEqual(calls, [], "ordinary paths retain their existing output policy");
    }
  }
});
