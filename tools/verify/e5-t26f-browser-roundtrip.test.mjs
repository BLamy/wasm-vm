// E5-T26f — exercise the runner's diagnostics and cursor deadline without booting a guest.
// Extract only the bounded helpers into a VM; importing the runner would launch Chromium.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `runner helper boundaries missing: ${startMarker}`);
  return source.slice(start, end);
}

const progress = extractBetween("let lastPhase =", "function guestPoint");
const capture = extractBetween("async function captureFailure", "async function launchTerminal");
const restoreHelpers = extractBetween("async function waitForReadyAndRestore", "\ntry {\n  phaseProgress(\"server:startup\")");

function fixture() {
  const logs = [];
  const timers = new Map();
  const writes = [];
  const milestones = {};
  const clock = { now: 6_000 };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [FixtureDate.now()])); }
    static now() { return 1_700_000_000_000 + clock.now; }
  }
  let nextTimer = 0;
  const sandbox = {
    assert, Date: FixtureDate, startedAt: FixtureDate.now() - 5_000, milestones,
    path, out: "/virtual/evidence", head: "719c6212",
    imageSha256: "image-digest", manifestSha256: "manifest-digest", serverOutput: "server log",
    jsonReplacer: (_key, value) => typeof value === "bigint" ? String(value) : value,
    console: { error: (value) => logs.push(JSON.parse(value.slice("[e5-t26f] ".length))) },
    setInterval: (callback, ms) => {
      const id = ++nextTimer;
      timers.set(id, { callback, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    mkdir: async () => {},
    writeFile: async (file, value) => writes.push({ file, value }),
    performance: { now: () => clock.now },
    document: {
      documentElement: { dataset: { desktopReady: "ready", desktopRestored: "ready" } },
      querySelector: () => ({ textContent: "s".repeat(1_000) }),
    },
    window: {},
    page: { url: () => "http://local/test" },
  };
  const context = vm.createContext(sandbox);
  const api = vm.runInContext(progress + capture + restoreHelpers + `
    ({ phaseProgress, sampleProgress, startProgressSampling, stopProgressSampling,
       remainingInteractionMs, waitForRestoredCursor, captureFailure,
       waitForReadyAndRestore, auditRestoreCoherence,
       state: () => ({ lastPhase, lastProgressSample, progressProbe }) })
  `, context);
  return { api, sandbox, context, logs, timers, writes, milestones, clock };
}

test("one unresolved progress probe prevents subsequent timer ticks from piling up", async () => {
  const f = fixture();
  let calls = 0;
  let resolve;
  f.sandbox.page.evaluate = () => {
    calls += 1;
    return new Promise((done) => { resolve = done; });
  };
  f.api.phaseProgress("focus:terminal-1:first-settle");
  f.api.startProgressSampling();
  f.api.startProgressSampling();
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.ms, 30_000);
  const pending = f.api.sampleProgress();
  for (let i = 0; i < 100; i += 1) {
    f.clock.now += timer.ms;
    timer.callback();
  }
  assert.equal(calls, 1);
  assert.equal(f.logs.at(-1).event, "probe-pending");
  assert.equal(f.logs.at(-1).pendingMs, 3_000_000);
  resolve({ serialTail: "last" });
  await pending;
  assert.equal(f.api.state().lastProgressSample.phase, "focus:terminal-1:first-settle");
  assert.equal(f.api.state().progressProbe, null);
  f.api.stopProgressSampling();
  assert.equal(f.timers.size, 0);
});

test("public sample is bounded and excludes pixels, full records and guest control", async () => {
  const f = fixture();
  const poison = { toJSON() { throw Error("pixels serialized"); } };
  const record = { marker: "aplay", accepted: false, beforePixels: poison, command: "x".repeat(10_000) };
  f.sandbox.window.__desktopTerminal = {
    state: () => ({
      frameCount: 3, active: { command: record }, focuses: [record],
      agent: { state: "ready", pendingBytes: 0 },
    }),
    serial: () => "x".repeat(10_000),
    presentation: () => ({ successfulPresents: 9, scheduler: { pending: 1, scheduled: true } }),
    audio: () => ({ policy: { state: "locked" }, sink: { renderedFrames: 4 } }),
  };
  f.sandbox.window.__desktopController = new Proxy({}, {
    get() { throw Error("guest controller accessed"); },
  });
  f.sandbox.page.evaluate = async (fn) => fn();
  f.api.phaseProgress("command:aplay:completion");
  f.api.startProgressSampling();
  await f.api.sampleProgress();
  const sample = f.api.state().lastProgressSample;
  assert.equal(sample.serialTail.length, 240);
  assert.equal(sample.status.length, 160);
  assert.equal(sample.command.marker, "aplay");
  assert.equal(sample.command.command, undefined);
  assert.equal(sample.command.beforePixels, undefined);
  assert.equal(sample.focus.marker, "aplay");
  assert.equal(sample.agent.state, "ready");
  assert.equal(sample.presentation.scheduler.pending, 1);
  assert.ok(JSON.stringify(sample).length < 2_000);
  f.api.stopProgressSampling();
});

test("navigation rejection frees the probe; stopped sampling suppresses late results", async () => {
  const f = fixture();
  let calls = 0;
  let reject;
  f.sandbox.page.evaluate = async () => {
    calls += 1;
    throw Error("Execution context destroyed");
  };
  f.api.startProgressSampling();
  await f.api.sampleProgress();
  assert.equal(f.logs.at(-1).event, "probe-error");
  assert.equal(f.api.state().progressProbe, null);
  f.sandbox.page.evaluate = () => {
    calls += 1;
    return new Promise((_resolve, failed) => { reject = failed; });
  };
  const pending = f.api.sampleProgress();
  f.api.stopProgressSampling();
  const count = f.logs.length;
  reject(Error("page closed"));
  await pending;
  await f.api.sampleProgress();
  assert.equal(f.logs.length, count);
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
});

test("failure artifacts retain phase, error and milestones before browser capture", async () => {
  const f = fixture();
  f.milestones.normalSnapshot = { sha256: "saved", preFrontBufferCrc: "deadbeef" };
  f.milestones.normalRestore = {
    checksPassed: true,
    result: { snapshotSha256: "saved", report: { sequence: 2n } },
  };
  f.api.phaseProgress("post-restore:cursor-render");
  f.api.startProgressSampling();
  f.sandbox.page.evaluate = async () => {
    assert.equal(f.writes.length, 1, "phase evidence must be written before the browser probe");
    throw Error("page closed");
  };
  const error = Object.assign(new Error("cursor missing"), { code: "ERR_ASSERTION" });
  await f.api.captureFailure("failure-cursor", error);
  const record = JSON.parse(f.writes.filter(({ file }) => file.endsWith(".json")).at(-1).value);
  assert.equal(record.lastPhase.phase, "post-restore:cursor-render");
  assert.equal(record.lastPhase.elapsedMs, 5_000);
  assert.equal(record.timestamp, new f.sandbox.Date().toISOString());
  assert.equal(record.error.name, "Error");
  assert.equal(record.error.message, "cursor missing");
  assert.equal(record.error.code, "ERR_ASSERTION");
  assert.match(record.error.stack, /cursor missing/);
  assert.equal(record.milestones.normalSnapshot.preFrontBufferCrc, "deadbeef");
  assert.equal(record.milestones.normalRestore.checksPassed, true);
  assert.equal(record.milestones.normalRestore.result.snapshotSha256, "saved");
  assert.equal(record.head, "719c6212");
  assert.equal(record.image.imageSha256, "image-digest");
  assert.equal(record.image.manifestSha256, "manifest-digest");
  assert.equal(record.captureError, "page closed");
  assert.equal(f.timers.size, 0);
});

test("failure capture does not issue requests behind a stuck progress probe", async () => {
  const f = fixture();
  let calls = 0;
  let resolve;
  f.sandbox.page.evaluate = () => {
    calls += 1;
    return new Promise((done) => { resolve = done; });
  };
  f.api.startProgressSampling();
  const pending = f.api.sampleProgress();
  await f.api.captureFailure("failure-pending", new Error("acceptance failed"));
  assert.equal(calls, 1);
  const saved = JSON.parse(f.writes[1].value);
  assert.match(saved.captureError, /progress probe still pending/);
  assert.ok(saved.progressProbe);
  assert.equal(f.timers.size, 0);
  const count = f.logs.length;
  resolve({ serialTail: "late result" });
  await pending;
  assert.equal(f.logs.length, count);
  assert.equal(f.api.state().lastProgressSample, null);
});

test("cursor timeout uses only the unspent original two-second budget", () => {
  const { api } = fixture();
  assert.equal(api.remainingInteractionMs(5_000, 5_000), 2_000);
  assert.equal(api.remainingInteractionMs(5_000, 6_000), 1_000);
  assert.equal(api.remainingInteractionMs(5_000, 6_999.5), 0.5);
  for (const now of [7_000, 7_001, NaN, Infinity, 4_999]) {
    assert.throws(() => api.remainingInteractionMs(5_000, now));
  }
  for (const boundary of [NaN, Infinity, -Infinity]) {
    assert.throws(() => api.remainingInteractionMs(boundary, 6_000));
  }
});

test("cursor waits through missing/stale pixels, returns matching sample and disposes its handle", async () => {
  const f = fixture();
  const expected = { x: 10, y: 20 };
  let rendered = null;
  let disposed = 0;
  f.sandbox.window.__desktopTerminal = {
    state: () => ({
      pointerFrameSample: [{ device: "tablet", source: "pointermove", coordinates: expected }],
    }),
  };
  f.sandbox.window.__desktopCursor = { renderedCursor: () => rendered };
  f.sandbox.page.evaluate = async (fn) => fn();
  f.sandbox.page.waitForFunction = async (predicate, args, options) => {
    assert.equal(options.timeout, 1_000);
    assert.equal(args.boundary, 5_000);
    assert.equal(predicate(args), false);
    rendered = { x: 9, y: 20 };
    assert.equal(predicate(args), false);
    rendered = { x: 10, y: 19 };
    assert.equal(predicate(args), false);
    rendered = expected;
    f.clock.now = 7_001;
    assert.equal(predicate(args), false);
    f.clock.now = 6_100;
    const sample = predicate(args);
    assert.equal(sample.rendered.x, 10);
    return { jsonValue: async () => sample, dispose: async () => { disposed += 1; } };
  };
  const sample = await f.api.waitForRestoredCursor(expected, 5_000);
  assert.equal(sample.elapsedMs, 1_100);
  assert.equal(sample.rendered.y, 20);
  assert.equal(disposed, 1);
  assert.equal(f.api.state().lastPhase.event, "done");
});

test("exhausted cursor budget fails before polling; a polling timeout remains a failure", async () => {
  const f = fixture();
  let polls = 0;
  f.sandbox.page.evaluate = async () => 7_000;
  f.sandbox.page.waitForFunction = async () => {
    polls += 1;
    throw Error("cursor deadline");
  };
  await assert.rejects(f.api.waitForRestoredCursor({ x: 1, y: 2 }, 5_000), /original 2-second budget/);
  assert.equal(polls, 0);
  f.sandbox.page.evaluate = async () => 6_000;
  await assert.rejects(f.api.waitForRestoredCursor({ x: 1, y: 2 }, 5_000), /cursor deadline/);
  assert.equal(polls, 1);
  assert.equal(f.api.state().lastPhase.event, "start");
});

test("top-level catch captures the phase before finally cleanup and rethrows the original error", async () => {
  const f = fixture();
  const catchMarker = "} catch (error) {\n  const phase =";
  const start = source.lastIndexOf(catchMarker);
  const end = source.indexOf("} finally {", start);
  assert.ok(start > 0 && end > start, "runner top-level catch/finally is missing");
  const body = source.slice(start + "} catch (error) {".length, end);
  const order = [];
  const original = new Error("cursor was not visible");
  f.sandbox.original = original;
  f.sandbox.cleanup = () => order.push("cleanup");
  f.sandbox.captureSpy = async (label, error) => {
    order.push("capture");
    assert.equal(label, "failure-post-restore-cursor-render");
    assert.equal(error, original);
  };
  f.api.phaseProgress("post-restore:cursor-render");
  await assert.rejects(vm.runInContext(`
    (async () => {
      const captureFailure = captureSpy;
      try { throw original; } catch (error) { ${body} } finally { cleanup(); }
    })()
  `, f.context), (error) => error === original);
  assert.deepEqual(order, ["capture", "cleanup"]);
  assert.equal(f.api.state().lastPhase.event, "failed");
  assert.match(source.slice(end), /^\} finally \{\n  stopProgressSampling\(\);/);
  assert.match(source,
    /assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\)/);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function restoreFixture() {
  const f = fixture();
  const machineResume = { persisted: true, paused: true, preFrontBufferCrc: "b258b915", overlayGeneration: 617 };
  const restored = {
    snapshotSha256: "saved", snapshotBytes: 2_620_726, completedAt: 1_131,
    report: { fullRepairFrame: true, agentRehandshake: true },
    handshake: { version: 1, generation: 2, capabilities: 1n },
    machineResume, preFrontBufferCrc: "b258b915",
  };
  const state = { bootStates: [{ state: "restored", atMs: 709 }], diagnostics: [] };
  f.clock.now = 1_263;
  f.sandbox.timeoutMs = 900_000;
  f.sandbox.waitForDesktopReady = async () => {};
  f.sandbox.restoreUrl = "http://local/test?autoRestore=1";
  f.sandbox.history = { replaceState: () => {} };
  f.sandbox.normalSnapshot = { sha256: "saved", machineResume, preFrontBufferCrc: "b258b915" };
  f.sandbox.window.__desktopTerminal = {
    restoreResult: () => restored,
    restoreObservation: () => ({ firstPresent: { crc32: "b258b915", successfulPresents: 2 } }),
    state: () => state,
    presentation: () => ({ successfulPresents: 2, scheduler: null }),
  };
  f.sandbox.window.__desktopController = { restoredFromBootSnapshot: () => true };
  f.sandbox.page.evaluate = async (fn, argument) => fn(argument);
  f.sandbox.page.reload = async () => {};
  f.sandbox.page.screenshot = async () => {};
  f.sandbox.page.waitForFunction = async (predicate, argument) => assert.ok(predicate(argument));
  return f;
}

// Run the actual orchestration surrounding the timed interaction. Substitute only the input/audio
// exercise; keep the runner's restore read, display checks, original deadline assertion and audit.
const beforeTimedInteraction = extractBetween(
  "  const firstRestore = await reloadWithAutoRestore",
  "  phaseProgress(\"post-restore:focus-and-gesture\")",
);
const afterTimedInteraction = extractBetween(
  "  milestones.postRestoreInteraction = postRestoreInteraction;",
  "  phaseProgress(\"drag:prepare\")",
);
const originalTimingAssertion = source.match(
  /assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\);/,
)?.[0];
assert.ok(originalTimingAssertion, "runner's original two-second gate is missing");

function runRestoreSequence(f) {
  return vm.runInContext(`
    (async () => {
      ${beforeTimedInteraction}
      const postRestoreStart = firstRestore.completedAt;
      const postRestoreEnd = await performTimedInteraction(postRestoreStart);
      const postRestoreInteraction = { elapsedMs: postRestoreEnd - postRestoreStart };
      ${originalTimingAssertion}
      ${afterTimedInteraction}
      nextSave();
      return firstRestore;
    })()
  `, f.context);
}

test("a held coherence read starts after timed interaction and must finish before the next save", async () => {
  const f = restoreFixture();
  const timingDone = deferred();
  const auditStarted = deferred();
  const releaseAudit = deferred();
  let decisionCalls = 0;
  let generationCalls = 0;
  let saves = 0;
  f.sandbox.window.__desktopController.snapshotDecision = () => {
    decisionCalls += 1;
    auditStarted.resolve("audit");
    return releaseAudit.promise;
  };
  f.sandbox.window.__desktopController.snapshotGeneration = () => { generationCalls += 1; return 617; };
  f.sandbox.performTimedInteraction = async (boundary) => {
    assert.equal(boundary, 1_131);
    assert.equal(decisionCalls, 0, "coherence I/O preceded the timed interaction");
    assert.equal(generationCalls, 0);
    const immediate = f.milestones.normalRestore.result;
    assert.equal(immediate.resume.restored, true);
    assert.equal(immediate.resume.snapshotDecision, null);
    assert.equal(immediate.resume.overlayGeneration, null);
    assert.equal(immediate.coherenceAudit.status, "deferred");
    f.clock.now = 2_000;
    timingDone.resolve("timing");
    return f.clock.now;
  };
  f.sandbox.nextSave = () => { saves += 1; };
  const proof = runRestoreSequence(f);
  try {
    const first = await Promise.race([timingDone.promise, auditStarted.promise, proof.then(() => "proof")]);
    assert.equal(first, "timing", "a slow coherence read blocked the timing path");
    await Promise.race([auditStarted.promise, proof.then(() => assert.fail("proof skipped its coherence audit"))]);
    assert.equal(saves, 0);
    assert.equal(f.milestones.normalRestore.displayChecksPassed, true);
    assert.equal(f.milestones.normalRestore.checksPassed, false);
    assert.equal(f.milestones.normalRestore.result.coherenceAudit.status, "running");
    assert.equal(f.milestones.postRestoreInteraction.elapsedMs, 869);
    assert.equal(f.api.state().lastPhase.phase, "restore:normal:coherence-audit");
    f.clock.now += 20_000;
    releaseAudit.resolve("resume");
    const result = await proof;
    assert.equal(decisionCalls, 1);
    assert.equal(generationCalls, 1);
    assert.equal(result.completedAt, 1_131, "audit must not reset the restore boundary");
    assert.equal(result.resume.snapshotDecision, "resume");
    assert.equal(result.resume.overlayGeneration, 617);
    assert.equal(result.coherenceAudit.status, "passed");
    assert.equal(f.milestones.normalRestore.result, result);
    assert.equal(f.milestones.normalRestore.checksPassed, true);
    assert.equal(f.milestones.postRestoreInteraction.elapsedMs, 869);
    assert.equal(saves, 1);
  } finally {
    releaseAudit.resolve("resume");
    await proof.catch(() => {});
  }
});

test("stale or mismatched actual coherence fails after timing and survives in failure milestones", async () => {
  for (const [decision, generation, reason] of [
    ["stale", 617, /not coherent/],
    ["resume", 618, /actual overlay generation differs/],
    ["resume", null, /actual overlay generation is missing/],
  ]) {
    const f = restoreFixture();
    let saves = 0;
    f.sandbox.performTimedInteraction = async () => 2_000;
    f.sandbox.nextSave = () => { saves += 1; };
    f.sandbox.window.__desktopController.snapshotDecision = async () => decision;
    f.sandbox.window.__desktopController.snapshotGeneration = async () => generation;
    let failure;
    await assert.rejects(runRestoreSequence(f), (error) => {
      failure = error;
      return reason.test(error.message);
    });
    assert.equal(saves, 0);
    await f.api.captureFailure("failure-coherence-audit", failure);
    const saved = JSON.parse(f.writes.filter(({ file }) => file.endsWith(".json")).at(-1).value);
    assert.equal(saved.milestones.normalRestore.checksPassed, false);
    assert.equal(saved.milestones.normalRestore.displayChecksPassed, true);
    assert.equal(saved.milestones.normalRestore.result.resume.snapshotDecision, decision);
    assert.equal(saved.milestones.normalRestore.result.resume.overlayGeneration, generation);
    assert.equal(saved.milestones.normalRestore.result.completedAt, 1_131);
    assert.equal(saved.milestones.normalRestore.result.coherenceAudit.status, "failed");
    assert.equal(saved.milestones.postRestoreInteraction.elapsedMs, 869);
    assert.equal(saved.lastPhase.phase, "restore:normal:coherence-audit");
    assert.match(saved.error.message, reason);
  }
});

test("second restore performs the real coherence audit after display/button checks and before evidence", () => {
  const sequence = extractBetween("  const secondRestore = await reloadWithAutoRestore", "  const result = {\n    schema:");
  const buttonCheck = sequence.indexOf("assert.deepEqual(afterDragState.pointer.heldButtons, []");
  const displayCheck = sequence.indexOf("assert.ok(afterDragState.presentation.successfulPresents > 0");
  const audit = sequence.indexOf('await auditRestoreCoherence(secondRestore, dragSnapshot, "drag")');
  const passed = sequence.indexOf("milestones.dragRestore.checksPassed = true");
  const evidence = sequence.indexOf('phaseProgress("evidence:write")');
  assert.ok(buttonCheck >= 0 && displayCheck > buttonCheck && audit > displayCheck && passed > audit && evidence > passed);
});
