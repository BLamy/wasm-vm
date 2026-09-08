// E5-T26f — exercise the runner's diagnostics and cursor deadline without booting a guest.
// Extract only the bounded helpers into a VM; importing the runner would launch Chromium.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");

for (const mode of ["create", "reuse"]) {
  test(`make verify-E5-T26f refuses diagnostic ${mode} before any build or browser command`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "e5-t26f-make-guard-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const tripwire = path.join(directory, "unexpected-command");
    // No real Cargo, Node, recursive make, or build shell is reachable even if the guard regresses.
    for (const command of ["cargo", "node", "make", "bash"]) {
      await fs.writeFile(path.join(directory, command),
        '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$E5_T26F_TRIPWIRE"\nexit 99\n', { mode: 0o700 });
    }
    const result = spawnSync("/usr/bin/make", ["--no-print-directory", "-j1", "-f",
      fileURLToPath(new URL("../../Makefile", import.meta.url)), "verify-E5-T26f",
      "SHELL=/bin/sh", `MAKE=${path.join(directory, "make")}`], {
      cwd: directory, encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024,
      env: { PATH: directory, E5_T26F_DIAGNOSTIC: mode, E5_T26F_TRIPWIRE: tripwire },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.match(output, /verify-E5-T26f refuses diagnostic mode/);
    assert.doesNotMatch(output, /cargo |node |web-dist|Chromium proof|verify-E5-T26f.*: OK/);
    assert.equal((await fs.readdir(directory)).includes("unexpected-command"), false);
  });
}

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `runner helper boundaries missing: ${startMarker}`);
  return source.slice(start, end);
}

const progress = extractBetween("let lastPhase =", "function guestPoint");
const capture = extractBetween("async function captureFailure", "async function launchTerminal");
const restoreHelpers = extractBetween("async function waitForReadyAndRestore", "\ntry {\n  phaseProgress(\"server:startup\")");

test("cold playback fixture keeps errors and conditional success without verbose parameter dumping", () => {
  const setup = source.match(/const aplayCommand = (.*);/)[1];
  const command = vm.runInNewContext(setup);
  assert.match(command, /aplay -Dhw:0,0 --period-size=480 --buffer-size=960/);
  assert.match(command, /\/tmp\/p&&printf/);
  assert.doesNotMatch(command, /aplay -[vq]|2>/);
});

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
      timers.set(id, { callback, ms, next: clock.now + ms, interval: true });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, ms) => {
      const id = ++nextTimer;
      timers.set(id, { callback, ms, next: clock.now + ms, interval: false });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    mkdir: async () => {},
    writeFile: async (file, value) => writes.push({ file, value }),
    performance: { now: () => clock.now },
    document: {
      documentElement: { dataset: { desktopReady: "ready", desktopRestored: "ready" } },
      querySelector: () => ({ textContent: "s".repeat(1_000) }),
    },
    window: {},
    diagnostic: null,
    diagnosticCheckpoint: null,
    page: { url: () => "http://local/test" },
  };
  const context = vm.createContext(sandbox);
  const api = vm.runInContext(progress + capture + restoreHelpers + `
    ({ phaseProgress, sampleProgress, startProgressSampling, stopProgressSampling,
       remainingInteractionMs, waitForRestoredCursor, captureFailure,
       waitForReadyAndRestore, auditRestoreCoherence,
       installInteractionLatencyProbe, commandMarkerReady, startInteractionLatencyProbe, stopInteractionLatencyProbe,
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
    audio: () => ({ policy: { state: "locked" }, sink: { renderedFrames: 4 },
      pcm: () => ({ writeIndex: 480, nonSilentFrames: 480, maxAbs: 0.125 }) }),
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
  assert.equal(sample.audio.pcm.writeIndex, 480);
  assert.equal(sample.audio.pcm.nonSilentFrames, 480);
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

test("failure capture retains producer PCM even when the command never completes", async () => {
  const f = fixture();
  f.sandbox.window.__desktopTerminal = {
    state: () => ({ active: { command: { terminalMarkerSeen: false } } }),
    audio: () => ({
      policy: { state: "unlocked" }, sink: { context: { state: "running" }, renderedFrames: 999_999 },
      pcm: () => ({ writeIndex: 480, nonSilentFrames: 480, maxAbs: 0.125 }),
    }),
  };
  f.sandbox.page.evaluate = async (fn) => fn();
  f.sandbox.page.screenshot = async () => {};
  await f.api.captureFailure("failure-aplay", new Error("command timeout"));
  const saved = JSON.parse(f.writes.filter(({ file }) => file.endsWith(".json")).at(-1).value);
  assert.equal(saved.state.terminal.active.command.terminalMarkerSeen, false);
  assert.equal(saved.state.audio.renderedFrames, 999_999);
  assert.deepEqual(saved.state.audio.pcm, { writeIndex: 480, nonSilentFrames: 480, maxAbs: 0.125 });
  assert.equal(saved.captureError, undefined);
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

function delayedGestureFixture(startAt = 1_100, postRestoreCommand = "sh /tmp/a", keyDelay = 0) {
  const f = fixture();
  const events = [];
  const delayStarted = deferred();
  const releaseDelay = deferred();
  const point = { x: 684, y: 392 };
  const audio = { policy: { state: "locked" }, sink: { renderedFrames: 0 }, pcm: () => ({ writeIndex: 0 }) };
  const focus = { accepted: true, guestVisible: true };
  const command = { accepted: true, terminalMarkerSeen: false };
  let pointerFrames = 0;
  f.clock.now = startAt;
  Object.assign(f.sandbox, {
    firstRestore: { completedAt: 1_000 },
    postRestoreCommand,
    postRestoreKeyDelayMs: keyDelay,
    desktopBox: async () => ({}),
    guestPoint: (_box, x, y) => ({ x, y }),
  });
  f.sandbox.window.__desktopCursor = { focusGuestPoint: () => point, renderedCursor: () => point };
  f.sandbox.window.__desktopTerminal = {
    audio: () => audio,
    state: () => ({ pointerFrames, active: { command }, pointerFrameSample: [
      { device: "tablet", source: "pointermove", coordinates: point },
    ] }),
    beginFocus: () => {}, focus: () => {}, finishFocus: () => ({ focuses: [focus] }),
    beginCommand: (value) => { command.command = value; events.push(`command:${value}`); },
    finishCommand: () => ({ commands: [command] }),
    confirmGuestFocus: () => ({ focuses: [focus] }),
  };
  f.sandbox.page.evaluate = async (fn, argument) => fn(argument);
  f.sandbox.page.waitForTimeout = async (ms) => {
    assert.equal(ms, 350, "retain the complete intentional gesture delay");
    events.push("delay-start");
    delayStarted.resolve();
    await releaseDelay.promise;
    f.clock.now += ms;
    events.push("delay-end");
  };
  f.sandbox.page.mouse = {
    move: async (x, y) => {
      assert.equal(x, point.x); assert.equal(y, point.y);
      events.push("move"); pointerFrames += 1;
    },
    down: async () => { events.push("down"); pointerFrames += 1; },
    up: async () => { events.push("up"); pointerFrames += 1; audio.policy.state = "unlocked"; },
  };
  f.sandbox.page.keyboard = {
    down: async (key) => { events.push(`down:${key}`); },
    up: async (key) => { events.push(`up:${key}`); },
    type: async (character, options) => {
      assert.equal(options.delay, keyDelay);
      f.clock.now += keyDelay;
      events.push(`key:${character}`);
    },
    press: async (key) => { events.push(`key:${key}`); if (key === "Enter") command.terminalMarkerSeen = true; },
  };
  f.sandbox.page.waitForFunction = async (predicate, argument) => {
    const value = predicate(argument);
    assert.ok(value, "required cursor/input/audio observation was missing");
    return { jsonValue: async () => value, dispose: async () => {} };
  };
  const typing = extractBetween("const shiftedPhysicalKey", "async function waitForDesktopReady");
  const leg = extractBetween('  phaseProgress("post-restore:focus-and-gesture");',
    '  phaseProgress("post-restore:audio-pcm-and-render");');
  const run = () => vm.runInContext(`${typing}\n(async () => {
    ${leg}
    return { postRestoreStart, postRestoreCursor, postAudioCommand };
  })()`, f.context);
  return { ...f, events, audio, delayStarted, releaseDelay, run };
}

test("pointer motion precedes the full delayed gesture; no click or physical key occurs early", async () => {
  const f = delayedGestureFixture();
  const running = f.run();
  try {
    await Promise.race([f.delayStarted.promise, running.then(() => assert.fail("gesture delay skipped"))]);
    assert.deepEqual(f.events, ["move", "delay-start"]);
    assert.equal(f.audio.policy.state, "locked");
    f.releaseDelay.resolve();
    const result = await running;
    assert.deepEqual(f.events.slice(0, 6), ["move", "delay-start", "delay-end", "down", "up", "command:sh /tmp/a"]);
    assert.deepEqual(f.events.slice(6), [..."sh /tmp/a"].map((key) => `key:${key}`).concat("key:Enter"));
    assert.equal(result.postRestoreStart, 1_000);
    assert.equal(result.postRestoreCursor.elapsedMs, 450);
  } finally {
    f.releaseDelay.resolve();
    await running.catch(() => {});
  }
});

test("premature audio unlock during the delay fails before the click or command", async () => {
  const f = delayedGestureFixture();
  const running = f.run();
  const rejected = assert.rejects(running, /audio unlocked before the delayed click/);
  try {
    await Promise.race([f.delayStarted.promise, rejected]);
    f.audio.policy.state = "unlocked";
    f.releaseDelay.resolve();
    await rejected;
    assert.deepEqual(f.events, ["move", "delay-start", "delay-end"]);
  } finally {
    f.releaseDelay.resolve();
    await running.catch(() => {});
  }
});

test("overlapped motion spends the original deadline; late command completion still fails", async () => {
  const f = delayedGestureFixture(2_649.5);
  f.releaseDelay.resolve();
  const result = await f.run();
  assert.equal(result.postRestoreStart, 1_000);
  assert.equal(result.postRestoreCursor.elapsedMs, 1_999.5);
  f.sandbox.postRestoreStart = result.postRestoreStart;
  f.sandbox.postRestoreEnd = 3_000;
  vm.runInContext(originalTimingAssertion, f.context);
  f.sandbox.postRestoreEnd = 3_000.01;
  assert.throws(() => vm.runInContext(originalTimingAssertion, f.context), /interaction exceeded 2 seconds/);
  const expired = delayedGestureFixture(2_650);
  expired.releaseDelay.resolve();
  await assert.rejects(expired.run(), /original 2-second budget/);
  assert.equal(expired.events.some((event) => event.startsWith("key:")), false);
});

function selectDiagnosticCommand(env) {
  const selection = extractBetween("function diagnosticOptions", "const DIAGNOSTIC_OWNER");
  return vm.runInNewContext(`${selection}\n({ diagnostic, postRestoreCommand, postRestoreKeyDelayMs })`, { assert, path, process: { env } });
}

const reuseCommandEnv = {
  E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_PROFILE: "/tmp/t26f-command",
  E5_T26F_DIAGNOSTIC_PORT: "48123",
};

test("latency opt-in is exactly 1, reuse-only, and never changes the command or key pacing", () => {
  for (const env of [{}, { ...reuseCommandEnv, E5_T26F_DIAGNOSTIC: "create" }]) {
    assert.throws(() => selectDiagnosticCommand({ ...env, E5_T26F_DIAGNOSTIC_LATENCY: "1" }), /requires reuse mode/);
  }
  for (const flag of ["", "0", "true", "01", "2"]) {
    assert.throws(() => selectDiagnosticCommand({ ...reuseCommandEnv, E5_T26F_DIAGNOSTIC_LATENCY: flag }), /exactly 1/);
  }
  assert.equal(selectDiagnosticCommand({}).diagnostic, null);
  assert.equal(selectDiagnosticCommand(reuseCommandEnv).diagnostic.latency, false);
  const selected = selectDiagnosticCommand({ ...reuseCommandEnv,
    E5_T26F_DIAGNOSTIC_LATENCY: "1", E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5" });
  assert.equal(selected.diagnostic.latency, true);
  assert.equal(selected.postRestoreCommand, "sh /tmp/a");
  assert.equal(selected.postRestoreKeyDelayMs, 5);
  const run = vm.runInNewContext(extractBetween("const milestones = {", "\nlet lastPhase") + "\nmilestones.run", selected);
  assert.equal(run.acceptance, false);
  assert.equal(run.diagnostic.latency, true);
});

async function flushMicrotasks() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

async function advanceProbe(f, target) {
  await flushMicrotasks();
  for (;;) {
    const next = [...f.timers.entries()].sort((a, b) => a[1].next - b[1].next)[0];
    if (!next || next[1].next > target) break;
    const [id, timer] = next;
    f.clock.now = timer.next;
    if (timer.interval) timer.next += timer.ms;
    else f.timers.delete(id);
    timer.callback();
    await flushMicrotasks();
  }
  f.clock.now = target;
  await flushMicrotasks();
}

function latencyFixture(startedAt = 1_200) {
  const f = fixture();
  const ring = { writeIndex: 0 };
  const counters = { pixels: 0, pcm: 0, scheduler: 0, rpc: 0 };
  const state = { frameCount: 4, active: { command: { terminalMarkerSeen: false } } };
  f.clock.now = startedAt;
  f.sandbox.diagnostic = { mode: "reuse", latency: true };
  f.sandbox.window.__desktopTerminal = {
    audio: () => ({ sink: { ring }, pcm: (baseline) => {
      counters.pcm += 1;
      assert.equal(baseline, 0);
      return { available: true, writeIndex: ring.writeIndex, writtenFrames: ring.writeIndex,
        nonSilentFrames: ring.writeIndex, maxAbs: 0.125 };
    } }),
    state: () => { counters.pixels += 1; f.clock.now += 3; return state; },
  };
  f.sandbox.window.__desktopController = {
    schedulerStats: async () => {
      counters.scheduler += 1;
      return { slices: counters.scheduler, retiredInstructions: counters.scheduler * 500_000 };
    },
    workerRpcStats: async () => { counters.rpc += 1; return { calls: counters.rpc, pending: 0 }; },
  };
  f.sandbox.page.evaluate = async (fn, argument) => structuredClone(await fn(argument));
  f.sandbox.page.screenshot = async () => {};
  return { ...f, ring, counters, state };
}

test("probes register before physical typing but a stalled RPC cannot delay typing or completion cleanup", { timeout: 1_000 }, async () => {
  const f = delayedGestureFixture(1_100, "sh /tmp/a", 5);
  const held = deferred();
  let calls = 0;
  f.sandbox.diagnostic = { mode: "reuse", latency: true };
  f.sandbox.window.__desktopController = { schedulerStats: () => { calls += 1; return held.promise; } };
  const originalType = f.sandbox.page.keyboard.type;
  f.sandbox.page.keyboard.type = async (...args) => {
    assert.ok(f.sandbox.window.__e5t26fLatencyProbe, "probe registered before the first key");
    await originalType(...args);
  };
  f.releaseDelay.resolve();
  try {
    const result = await f.run();
    assert.equal(calls, 1);
    assert.equal(result.postRestoreStart, 1_000);
    assert.equal(result.postAudioCommand.command, "sh /tmp/a");
    assert.equal(f.events.filter((e) => e.startsWith("key:")).length, 10);
    assert.equal(f.milestones.interactionLatency.restoredAt, 1_000);
    assert.equal(f.milestones.interactionLatency.stopReason, "command-wait-settled");
    assert.equal(f.milestones.interactionLatency.schedulerSamples[0].status, "pending-at-stop");
    assert.equal(f.timers.size, 0);
  } finally { held.resolve({ slices: 1 }); }
});

test("first non-silent PCM precedes a separately timed existing marker read without extra pixel reads", async () => {
  const f = latencyFixture();
  await f.api.startInteractionLatencyProbe(1_000, 0);
  await advanceProbe(f, 1_250);
  f.ring.writeIndex = 1440;
  await advanceProbe(f, 1_300);
  assert.equal(f.counters.pixels, 0, "the sampler must not read state or pixels");
  assert.equal(f.counters.pcm, 1);
  assert.equal(f.api.commandMarkerReady(), false);
  assert.equal(f.counters.pixels, 1, "one existing predicate means one state read");
  f.clock.now = 1_500;
  f.state.active.command.terminalMarkerSeen = true;
  assert.equal(f.api.commandMarkerReady(), true);
  await f.api.stopInteractionLatencyProbe("completion");
  const report = f.milestones.interactionLatency;
  assert.equal(report.firstPcm.observedAt, 1_300);
  assert.equal(report.firstPcm.elapsedMs, 300);
  assert.equal(report.firstPcm.pcm.nonSilentFrames, 1440);
  assert.equal(report.firstMarker.observedAt, 1_503);
  assert.equal(report.firstMarker.stateReadMs, 3);
  assert.equal(report.markerTotalMs, 6);
  assert.equal(report.markerCalls, 2);
  f.ring.writeIndex = 2880;
  await advanceProbe(f, 9_000);
  assert.equal(f.counters.pcm, 1);
  assert.equal(report.firstPcm.pcm.writeIndex, 1440, "later PCM cannot overwrite the first latch");
  assert.equal(f.timers.size, 0);
});

test("one held scheduler RPC survives a rejected local-stat read without overlap, even at the time limit", async () => {
  const f = latencyFixture();
  const held = deferred();
  f.sandbox.window.__desktopController.schedulerStats = () => { f.counters.scheduler += 1; return held.promise; };
  f.sandbox.window.__desktopController.workerRpcStats = () => { throw Error("local stats unavailable"); };
  const report = f.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  await advanceProbe(f, 6_999);
  assert.equal(f.counters.scheduler, 1);
  assert.equal(report.schedulerSamples.length, 1);
  assert.equal(report.schedulerSamples[0].status, "pending");
  await advanceProbe(f, 7_000);
  assert.equal(report.stopReason, "time-limit");
  assert.equal(report.schedulerSamples[0].status, "pending-at-stop");
  assert.equal(f.timers.size, 0);
  const frozen = JSON.stringify(report);
  held.resolve({ slices: 99 });
  await flushMicrotasks();
  assert.equal(JSON.stringify(report), frozen, "late settlement cannot mutate stopped evidence");
  assert.equal(f.counters.scheduler, 1);
});

test("JIT RPC follows scheduler settlement and holds the whole sample until completion", async () => {
  const f = latencyFixture();
  const scheduler = deferred(), jit = deferred();
  const calls = [];
  let activeRpc = 0;
  f.sandbox.window.__desktopController.schedulerStats = () => {
    assert.equal(activeRpc, 0, "scheduler cannot overlap a JIT request");
    activeRpc += 1; calls.push("scheduler");
    return scheduler.promise.finally(() => { activeRpc -= 1; });
  };
  f.sandbox.window.__desktopController.jitStats = () => {
    assert.equal(activeRpc, 0, "JIT cannot overtake the scheduler response");
    activeRpc += 1; calls.push("jit");
    return jit.promise.finally(() => { activeRpc -= 1; });
  };
  const report = f.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  await advanceProbe(f, 1_500);
  assert.deepEqual(calls, ["scheduler"]);
  scheduler.resolve({ retiredInstructions: 12_920_000, slices: 20 });
  await flushMicrotasks();
  assert.deepEqual(calls, ["scheduler", "jit"]);
  const sample = report.schedulerSamples[0];
  assert.equal(sample.scheduler.retiredInstructions, 12_920_000);
  assert.equal(sample.observedAt, 1_500);
  assert.equal(sample.jit.requestedAt, 1_500);
  assert.equal(sample.status, "jit-pending");
  await advanceProbe(f, 2_500);
  assert.deepEqual(calls, ["scheduler", "jit"], "later timer ticks cannot start another sample");
  jit.resolve({ hasExecutor: true, guestRetired: 13_000_000 });
  await flushMicrotasks();
  assert.equal(activeRpc, 0);
  assert.equal(sample.jit.observedAt, 2_500);
  assert.equal(sample.status, "completed");
  assert.equal(sample.jit.stats.guestRetired, 13_000_000);
  assert.equal(report.restoredAt, 1_000);
  f.sandbox.window.__e5t26fLatencyProbe.stop("completion");
  assert.equal(f.timers.size, 0);
});

test("stopping with JIT pending retains scheduler evidence and ignores late success or failure", async () => {
  for (const rejectLate of [false, true]) {
    const f = latencyFixture();
    let settle;
    const held = new Promise((resolve, reject) => { settle = rejectLate ? reject : resolve; });
    f.sandbox.window.__desktopController.jitStats = () => held;
    await f.api.startInteractionLatencyProbe(1_000, 0);
    await flushMicrotasks();
    await f.api.stopInteractionLatencyProbe("completion");
    const report = f.milestones.interactionLatency;
    const sample = report.schedulerSamples[0];
    assert.equal(sample.scheduler.retiredInstructions, 500_000);
    assert.equal(sample.observedAt, 1_200);
    assert.equal(sample.jit.requestedAt, 1_200);
    assert.equal(sample.jit.observedAt, null);
    assert.equal(sample.status, "pending-at-stop");
    assert.equal(sample.jit.status, "pending-at-stop");
    assert.equal(f.timers.size, 0);
    const preserved = JSON.stringify(report);
    settle(rejectLate ? Error("late JIT failure") : { guestRetired: 999 });
    await flushMicrotasks();
    const pageReport = f.sandbox.window.__e5t26fLatencyProbe.stop("again");
    assert.equal(JSON.stringify(pageReport), preserved);
    assert.equal(JSON.stringify(f.milestones.interactionLatency), preserved);
  }
});

test("scheduler settlement after stop or the original deadline never requests JIT", async () => {
  for (const deadline of [false, true]) {
    const f = latencyFixture();
    const held = deferred();
    let jitCalls = 0;
    f.sandbox.window.__desktopController.schedulerStats = () => held.promise;
    f.sandbox.window.__desktopController.jitStats = () => { jitCalls += 1; return {}; };
    const report = f.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
    await flushMicrotasks();
    if (deadline) await advanceProbe(f, 7_000);
    else f.sandbox.window.__e5t26fLatencyProbe.stop("completion");
    const preserved = JSON.stringify(report);
    held.resolve({ retiredInstructions: 999 });
    await flushMicrotasks();
    assert.equal(jitCalls, 0);
    assert.equal(JSON.stringify(report), preserved);
    assert.equal(f.timers.size, 0);
  }
});

test("JIT observations copy only named scalar fields and record a missing API as unavailable", async () => {
  const f = latencyFixture();
  const stats = { hasExecutor: true, guestRetired: 100, retiredViaJit: 80, compiledBlocks: 9,
    jitCacheInstalls: 10, jitCacheEvictions: 2, jitCacheRetranslations: 1, executedBlocks: 40, directChainEntries: 30,
    entryCost: { hostEntries: 50, stateCopyBytes: 512, timingEnabled: false, timerReads: 0 } };
  const forbid = { get() { throw Error("unlisted JIT payload read"); } };
  Object.defineProperty(stats, "regions", forbid);
  Object.defineProperty(stats.entryCost, "stateCopyCalls", forbid);
  f.sandbox.window.__desktopController.jitStats = async () => stats;
  const report = f.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  await flushMicrotasks();
  const captured = JSON.parse(JSON.stringify(report.schedulerSamples[0].jit.stats));
  assert.deepEqual(captured, stats);
  assert.ok(JSON.stringify(captured).length < 500);
  stats.compiledBlocks = { unexpected: "x".repeat(10_000) };
  stats.entryCost.timerReads = Infinity;
  await advanceProbe(f, 1_450);
  assert.equal(report.schedulerSamples[1].jit.stats.compiledBlocks, null);
  assert.equal(report.schedulerSamples[1].jit.stats.entryCost.timerReads, null);
  f.sandbox.window.__e5t26fLatencyProbe.stop("completion");

  const missing = latencyFixture();
  const missingReport = missing.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  await flushMicrotasks();
  assert.equal(missingReport.schedulerSamples[0].jit.available, false);
  assert.equal(missingReport.schedulerSamples[0].jit.status, "unavailable");
  assert.equal(missingReport.schedulerSamples[0].jit.requestedAt, null);
  missing.sandbox.window.__e5t26fLatencyProbe.stop("completion");
});

test("without the latency flag neither default nor reuse interaction requests diagnostic JIT stats", async () => {
  for (const diagnostic of [null, { mode: "reuse", latency: false }]) {
    const f = delayedGestureFixture(1_100, "sh /tmp/a", 5);
    f.sandbox.diagnostic = diagnostic;
    f.sandbox.window.__desktopController = new Proxy({}, {
      get() { assert.fail("disabled latency diagnostics accessed the controller"); },
    });
    f.releaseDelay.resolve();
    const result = await f.run();
    assert.equal(result.postRestoreStart, 1_000);
    assert.equal(result.postAudioCommand.command, "sh /tmp/a");
    assert.equal(f.milestones.interactionLatency, undefined);
    assert.equal(f.timers.size, 0);
  }
});

test("sampling is capped at 120 PCM/marker records and 24 spaced scheduler reads within the original restore window", async () => {
  const f = latencyFixture(1_000);
  const report = f.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  for (let i = 0; i < 121; i += 1) f.api.commandMarkerReady();
  f.state.active.command.terminalMarkerSeen = true;
  f.api.commandMarkerReady();
  assert.equal(report.markerSamples.length, 120);
  assert.equal(report.markerCalls, 122);
  assert.ok(report.firstMarker, "the first marker survives a full sample array");
  // Restore monotonic test time after exercising the independent marker accounting.
  f.clock.now = 1_366;
  for (const timer of f.timers.values()) {
    if (timer.interval) timer.next = f.clock.now + timer.ms;
  }
  await advanceProbe(f, 10_000);
  assert.ok(report.pcmSamples.length <= 120);
  assert.ok(report.schedulerSamples.length <= 24);
  for (let i = 1; i < report.schedulerSamples.length; i += 1) {
    assert.ok(report.schedulerSamples[i].requestedAt - report.schedulerSamples[i - 1].requestedAt >= 250);
  }
  assert.ok(report.pcmSamples.every((sample) => sample.observedAt < 7_000));
  assert.equal(report.deadlineAt, 7_000);
  assert.equal(report.stoppedAt, 7_000);
  assert.equal(f.timers.size, 0);

  const late = latencyFixture(6_500);
  const lateReport = late.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  await advanceProbe(late, 7_000);
  assert.equal(lateReport.deadlineAt, 7_000, "installation must not restart the six-second observation window");
  assert.ok(lateReport.pcmSamples.length <= 10);
  assert.equal(lateReport.restoredAt, 1_000);
});

test("missing diagnostic APIs are recorded as unavailable without fallback calls", async () => {
  const f = latencyFixture();
  f.sandbox.window.__desktopController = {};
  f.sandbox.window.__desktopTerminal.audio = () => ({});
  const report = f.api.installInteractionLatencyProbe({ restoredAt: 1_000, baselineWriteIndex: 0 });
  await advanceProbe(f, 1_500);
  f.sandbox.window.__e5t26fLatencyProbe.stop("completion");
  assert.ok(report.pcmSamples.every((sample) => sample.available === false && sample.writeIndex === null));
  assert.ok(report.schedulerSamples.every((sample) => sample.schedulerAvailable === false && sample.workerRpcAvailable === false));
  assert.equal(report.firstPcm, null);
  assert.equal(f.counters.pixels, 0);
  assert.equal(f.counters.pcm, 0);
  assert.equal(f.timers.size, 0);
});

test("latency samples survive the unchanged two-second failure before any failure pixel capture", async () => {
  const f = latencyFixture();
  await f.api.startInteractionLatencyProbe(1_000, 0);
  f.ring.writeIndex = 1440;
  await advanceProbe(f, 1_300);
  f.clock.now = 4_500;
  f.state.active.command.terminalMarkerSeen = true;
  f.api.commandMarkerReady();
  f.sandbox.postRestoreStart = 1_000;
  f.sandbox.postRestoreEnd = 4_503;
  let original;
  try { vm.runInContext(originalTimingAssertion, f.context); } catch (error) { original = error; }
  assert.match(original?.message || "", /interaction exceeded 2 seconds/);
  const evaluate = f.sandbox.page.evaluate;
  f.sandbox.page.evaluate = async (fn, argument) => {
    if (argument === "failure") {
      assert.equal(f.writes.length, 1, "write the original failure before collecting page diagnostics");
      return evaluate(fn, argument);
    }
    assert.equal(f.writes.length, 2, "save collected milestones before the failure's additional pixel read");
    throw Error("page closed after diagnostic collection");
  };
  await f.api.captureFailure("failure-post-restore-interaction-checks", original);
  const initial = JSON.parse(f.writes[0].value);
  assert.equal(initial.error.message, original.message);
  assert.equal(initial.milestones.interactionLatency.restoredAt, 1_000);
  const saved = JSON.parse(f.writes[1].value);
  assert.equal(saved.error.message, original.message);
  assert.equal(saved.milestones.interactionLatency.restoredAt, 1_000);
  assert.equal(saved.milestones.interactionLatency.firstPcm.observedAt, 1_250);
  assert.equal(saved.milestones.interactionLatency.firstMarker.observedAt, 4_503);
  assert.equal(saved.milestones.interactionLatency.stopReason, "failure");
  assert.equal(f.timers.size, 0);
});

test("failure is written before a stalled latency collection; timeout persists and never piles up or accepts late data", async () => {
  const f = latencyFixture();
  await f.api.startInteractionLatencyProbe(1_000, 0);
  const held = deferred();
  const collectionStarted = deferred();
  const original = new Error("original two-second failure");
  let calls = 0, lateReport;
  f.sandbox.page.evaluate = (fn, argument) => {
    calls += 1;
    assert.equal(argument, "failure", "no additional browser request behind the held collection");
    assert.equal(f.writes.length, 1);
    const initial = JSON.parse(f.writes[0].value);
    assert.equal(initial.error.message, original.message);
    assert.equal(initial.milestones.interactionLatency.restoredAt, 1_000);
    // The page stops its timers, but the collection response is indefinitely delayed.
    lateReport = structuredClone(fn(argument));
    collectionStarted.resolve();
    return held.promise;
  };
  const capturing = f.api.captureFailure("failure-stalled-latency", original);
  await collectionStarted.promise;
  await advanceProbe(f, 2_200);
  await capturing;
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0, "both page timers and the host collection timeout are cleared");
  const saved = JSON.parse(f.writes.filter(({ file }) => file.endsWith(".json")).at(-1).value);
  assert.equal(saved.error.message, original.message);
  assert.match(saved.milestones.interactionLatency.captureError, /exceeded 1000 ms/);
  assert.match(saved.captureError, /latency collection still pending/);
  assert.ok(f.writes.some(({ file }) => file.endsWith("-server.log")));
  await f.api.captureFailure("failure-again", original);
  assert.equal(calls, 1, "a second failure must not queue behind the timed-out collection");
  const preserved = JSON.stringify(f.milestones);
  held.resolve(lateReport);
  await flushMicrotasks();
  assert.equal(JSON.stringify(f.milestones), preserved, "late results cannot overwrite persisted evidence");
  assert.equal(f.timers.size, 0);
});

test("command override refuses acceptance/create and rejects unbounded or multiline input", () => {
  for (const env of [{}, { ...reuseCommandEnv, E5_T26F_DIAGNOSTIC: "create" }]) {
    assert.throws(() => selectDiagnosticCommand({ ...env, E5_T26F_DIAGNOSTIC_COMMAND: "true" }), /requires reuse mode/);
  }
  for (const command of ["", "x".repeat(64), "true\ntrue", "echo\tbad", "é"]) {
    assert.throws(() => selectDiagnosticCommand({ ...reuseCommandEnv, E5_T26F_DIAGNOSTIC_COMMAND: command }), /1-63 printable ASCII/);
  }
});

test("without override all modes keep the exact sh /tmp/a command", () => {
  for (const env of [{}, reuseCommandEnv, { ...reuseCommandEnv, E5_T26F_DIAGNOSTIC: "create" }]) {
    assert.equal(selectDiagnosticCommand(env).postRestoreCommand, "sh /tmp/a");
    assert.equal(selectDiagnosticCommand(env).postRestoreKeyDelayMs, 0);
  }
});

test("diagnostic key pacing is bounded, reuse-only, recorded, and inside the original deadline", () => {
  for (const env of [{}, { ...reuseCommandEnv, E5_T26F_DIAGNOSTIC: "create" }]) {
    assert.throws(() => selectDiagnosticCommand({ ...env, E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5" }), /requires reuse mode/);
  }
  for (const delay of ["", "-1", "1.5", "26", "NaN", "05"]) {
    assert.throws(() => selectDiagnosticCommand({ ...reuseCommandEnv, E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: delay }), /integer from 0 to 25/);
  }
  for (const delay of [0, 5, 25]) {
    const selected = selectDiagnosticCommand({ ...reuseCommandEnv, E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: String(delay) });
    const run = vm.runInNewContext(extractBetween("const milestones = {", "\nlet lastPhase") + "\nmilestones.run", selected);
    assert.equal(run.acceptance, false);
    assert.equal(run.postRestoreKeyDelayMs, delay);
    assert.equal(run.diagnostic.keyDelayMs, delay);
  }
  assert.ok(source.includes('    120_000,\n    postRestoreKeyDelayMs,\n'));
  assert.ok(source.includes(originalTimingAssertion));
});

test("reuse override is recorded verbatim in nonacceptance metadata and the physical command record", async () => {
  const override = 'aplay() { shift; command aplay "$@"; }; . /tmp/a';
  const selected = selectDiagnosticCommand({ ...reuseCommandEnv, E5_T26F_DIAGNOSTIC_COMMAND: override });
  const run = vm.runInNewContext(extractBetween("const milestones = {", "\nlet lastPhase") + "\nmilestones.run", selected);
  assert.equal(run.acceptance, false);
  assert.equal(run.postRestoreCommand, override);
  assert.equal(run.diagnostic.command, override);
  const f = delayedGestureFixture(1_100, selected.postRestoreCommand);
  f.releaseDelay.resolve();
  const result = await f.run();
  assert.equal(result.postAudioCommand.command, override);
  assert.ok(f.events.indexOf(`command:${override}`) > f.events.indexOf("up"));
  assert.ok(f.events.includes("key:Enter"));
  assert.equal(result.postRestoreStart, 1_000);
  assert.ok(source.includes(originalTimingAssertion));
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
  "  phaseProgress(\"post-restore:interaction-checks\", \"done\");",
  "  if (diagnostic) {\n    phaseProgress(\"diagnostic:iteration-evidence\");",
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
      milestones.postRestoreInteraction = postRestoreInteraction;
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

const checkpointHelpers = extractBetween("function diagnosticOptions", "assert.ok(Number.isSafeInteger(timeoutMs)");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function checkpointFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "e5-t26f-checkpoint-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { mode: "create", directory, port: 48123, origin: "http://127.0.0.1:48123" };
  const binding = { head: "a".repeat(40), runtimeSha256: "b".repeat(64), kernelSha256: "c".repeat(64),
    imageSha256: "d".repeat(64), imageBytes: 4096, manifestSha256: "e".repeat(64), origin: options.origin };
  const context = vm.createContext({
    assert, path, ...fs, Buffer, JSON, URL, process: { env: {} }, sha256, SHA256: /^[0-9a-f]{64}$/u,
    sha256File: async (file) => sha256(await fs.readFile(file)),
  });
  const api = vm.runInContext(checkpointHelpers + `
    ({ diagnosticOptions, treeDigest, diagnosticBinding, prepareDiagnostic, validateCheckpoint,
       installCheckpointSession, readBrowserIdentity })
  `, context);
  const prepared = await api.prepareDiagnostic(options, binding);
  const bytes = Buffer.from([0, 1, 255, 127]);
  const normalSnapshot = {
    sha256: sha256(bytes), byteLength: bytes.length, preFrontBufferCrc: "3079a40f",
    machineResume: { persisted: true, paused: true, preFrontBufferCrc: "3079a40f", overlayGeneration: 617 },
  };
  const envelope = { schema: "wasm-vm.e5-t26f.desktop-snapshot.v1", ...normalSnapshot, bytes: bytes.toString("base64") };
  const checkpoint = {
    schema: "wasm-vm.e5-t26f.diagnostic-profile.v1", createdAt: "2026-09-07T23:00:00Z",
    browser: { name: "chromium", version: "test-only", headless: true }, normalSnapshot,
    session: { key: "wasm-vm.desktop-snapshot.v1", value: JSON.stringify(envelope) },
  };
  return { api, context, options, binding, prepared, checkpoint, directory };
}

async function sealFixture(f) {
  await fs.mkdir(path.join(f.prepared.seed, "Default"));
  await fs.writeFile(path.join(f.prepared.seed, "Default", "persisted-state"), "baseline overlay and resume");
  f.checkpoint.profileSha256 = await f.api.treeDigest(f.prepared.seed);
  await fs.writeFile(f.prepared.checkpointFile, JSON.stringify(f.checkpoint), { flag: "wx" });
}

test("diagnostics require explicit mode, absolute scratch and stable port; default remains fresh acceptance", async (t) => {
  const { api } = await checkpointFixture(t);
  assert.equal(api.diagnosticOptions({}), null);
  const env = { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_PROFILE: "/tmp/t26f", E5_T26F_DIAGNOSTIC_PORT: "48123" };
  assert.equal(api.diagnosticOptions(env).origin, "http://127.0.0.1:48123");
  for (const change of [
    { E5_T26F_DIAGNOSTIC: "" }, { E5_T26F_DIAGNOSTIC: "acceptance" },
    { E5_T26F_DIAGNOSTIC_PROFILE: "relative" }, { E5_T26F_DIAGNOSTIC_PROFILE: "/" },
    { E5_T26F_DIAGNOSTIC_PROFILE: "/tmp/../tmp/t26f" },
    { E5_T26F_DIAGNOSTIC_PORT: "" }, { E5_T26F_DIAGNOSTIC_PORT: "0" },
    { E5_T26F_DIAGNOSTIC_PORT: "NaN" }, { E5_T26F_DIAGNOSTIC_PORT: "65536" },
  ]) assert.throws(() => api.diagnosticOptions({ ...env, ...change }));
  assert.match(source, /if \(retained\) \{[\s\S]*launchPersistentContext[\s\S]*\} else \{\n    browser = await chromium.launch\(launchOptions\);\n    context = await browser.newContext/);
  assert.match(source, /kind: diagnostic \? "diagnostic-iteration" : "acceptance", acceptance: !diagnostic/);
  assert.match(source, /schema: "wasm-vm.e5-t26f.diagnostic-iteration.v1", acceptance: false/);
  assert.match(source, /const postRestoreStart = firstRestore.completedAt;/);
  assert.ok(source.includes(originalTimingAssertion));
});

test("profile creation never overwrites existing data and reuse requires the task marker and completed seal", async (t) => {
  const f = await checkpointFixture(t);
  const before = await fs.readdir(f.directory);
  await assert.rejects(f.api.prepareDiagnostic(f.options, f.binding), /nonempty profile/);
  await assert.rejects(f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, f.binding), /ENOENT/);
  assert.deepEqual(await fs.readdir(f.directory), before);
  const unowned = path.join(f.directory, "user-profile");
  await fs.mkdir(unowned);
  await fs.writeFile(path.join(unowned, "personal-data"), "keep");
  await assert.rejects(f.api.prepareDiagnostic({ ...f.options, directory: unowned }, f.binding), /nonempty profile/);
  await assert.rejects(f.api.prepareDiagnostic({ ...f.options, directory: unowned, mode: "reuse" }, f.binding), /ENOENT/);
  assert.equal(await fs.readFile(path.join(unowned, "personal-data"), "utf8"), "keep");
});

test("every runtime/kernel/image/origin binding mismatch refuses reuse before copying any profile", async (t) => {
  const f = await checkpointFixture(t);
  await sealFixture(f);
  const before = await fs.readdir(f.directory);
  for (const key of Object.keys(f.binding).filter((key) => key !== "head")) {
    const changed = { ...f.binding, [key]: key === "imageBytes" ? 8192 : "different" };
    await assert.rejects(f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, changed), /binding differs/);
    assert.deepEqual(await fs.readdir(f.directory), before);
  }
});

test("harness-only HEAD changes permit reuse while preserving creator and current provenance", async (t) => {
  const f = await checkpointFixture(t);
  await sealFixture(f);
  const currentBinding = { ...f.binding, head: "f".repeat(40) };
  const reused = await f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, currentBinding);
  assert.equal(reused.creatorHead, f.binding.head);
  assert.notEqual(reused.creatorHead, currentBinding.head);
  assert.equal(reused.checkpoint.session.value, f.checkpoint.session.value);
  const owner = JSON.parse(await fs.readFile(path.join(f.directory, "e5-t26f-owner.json"), "utf8"));
  assert.equal(owner.binding.head, f.binding.head, "reuse must not rewrite creator identity");
  assert.match(source, /milestones.run.creatorHead = retained.creatorHead;/);
  assert.match(source, /milestones.run.currentHead = head;/);
});

test("runtime binding hashes actual served JS/WASM/kernel bytes, including uncommitted changes", async (t) => {
  const f = await checkpointFixture(t);
  const repo = path.join(f.directory, "repo");
  const web = path.join(repo, "web");
  await fs.mkdir(path.join(web, "pkg"), { recursive: true });
  await fs.mkdir(path.join(web, "src"));
  await fs.mkdir(path.join(repo, "releases"));
  const kernel = Buffer.from("kernel bytes");
  await fs.writeFile(path.join(repo, "releases", "Image"), kernel);
  await fs.writeFile(path.join(web, "artifacts-alpine.json"), JSON.stringify({
    artifacts: { kernel: { url: "releases/Image", sha256: sha256(kernel) } },
  }));
  const files = ["loader.js", "src/ring.js", "pkg/runtime.wasm"];
  for (const file of files) await fs.writeFile(path.join(web, file), file);
  Object.assign(f.context, { repo, web, head: f.binding.head, imageSha256: f.binding.imageSha256,
    imageStat: { size: f.binding.imageBytes }, manifestSha256: f.binding.manifestSha256 });
  const baseline = await f.api.diagnosticBinding(f.options);
  for (const file of files) {
    await fs.writeFile(path.join(web, file), `${file} changed`);
    assert.notEqual((await f.api.diagnosticBinding(f.options)).runtimeSha256, baseline.runtimeSha256);
    await fs.writeFile(path.join(web, file), file);
  }
  assert.equal((await f.api.diagnosticBinding(f.options)).runtimeSha256, baseline.runtimeSha256);
  await fs.writeFile(path.join(repo, "releases", "Image"), "different kernel");
  await assert.rejects(f.api.diagnosticBinding(f.options), /kernel digest/);
  // A local-relative URL outside the server's /releases override is served from web/, not repo/.
  await fs.mkdir(path.join(web, "local-kernel"));
  await fs.writeFile(path.join(web, "local-kernel", "Image"), kernel);
  await fs.writeFile(path.join(web, "artifacts-alpine.json"), JSON.stringify({
    artifacts: { kernel: { url: "./local-kernel/Image", sha256: sha256(kernel) } },
  }));
  assert.equal((await f.api.diagnosticBinding(f.options)).kernelSha256, sha256(kernel));
});

test("reuse enters autoRestore directly without cold setup or resetting the restored timing boundary", async () => {
  const f = restoreFixture();
  const calls = [];
  f.sandbox.diagnosticCheckpoint = { normalSnapshot: f.sandbox.normalSnapshot };
  f.sandbox.page.goto = async (url) => calls.push(url);
  f.sandbox.page.reload = async () => assert.fail("reuse should not reload a cold page");
  f.sandbox.performTimedInteraction = async (boundary) => {
    assert.equal(boundary, 1_131);
    return 2_000;
  };
  f.sandbox.nextSave = () => {};
  f.sandbox.window.__desktopController.snapshotDecision = async () => "resume";
  f.sandbox.window.__desktopController.snapshotGeneration = async () => 617;
  await runRestoreSequence(f);
  assert.deepEqual(calls, [f.sandbox.restoreUrl]);
  assert.equal(f.milestones.postRestoreInteraction.elapsedMs, 869);
  assert.equal(f.milestones.normalRestore.checksPassed, true);
});

test("reuse cold-boot fallback fails on its first readiness sample instead of waiting for another boot", async () => {
  const f = fixture();
  f.sandbox.diagnostic = { mode: "reuse" };
  f.sandbox.timeoutMs = 900_000;
  f.sandbox.window.__desktopTerminal = { state: () => ({ bootStates: [{ state: "booting" }] }) };
  let samples = 0;
  f.sandbox.page.evaluate = async (fn) => { samples += 1; return fn(); };
  f.sandbox.waitFor = async (fn) => fn();
  const readiness = extractBetween("async function waitForDesktopReady", "async function waitForAgentReady");
  const run = vm.runInContext(`${readiness}\nwaitForDesktopReady`, f.context);
  await assert.rejects(run("diagnostic restore"), /aborting cold-boot fallback/);
  assert.equal(samples, 1);
});

test("reuse copies a sealed profile, preserves actual envelope/metadata and retains separate failed iterations", async (t) => {
  const f = await checkpointFixture(t);
  await sealFixture(f);
  const first = await f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, f.binding);
  assert.notEqual(first.profile, f.prepared.seed);
  assert.equal(first.checkpoint.session.value, f.checkpoint.session.value);
  assert.equal(first.checkpoint.normalSnapshot.machineResume.overlayGeneration, 617);
  await fs.writeFile(path.join(first.profile, "Default", "persisted-state"), "failed iteration guest writes");
  const second = await f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, f.binding);
  assert.notEqual(first.profile, second.profile);
  assert.equal(await fs.readFile(path.join(second.profile, "Default", "persisted-state"), "utf8"), "baseline overlay and resume");
  assert.equal(await fs.readFile(path.join(first.profile, "Default", "persisted-state"), "utf8"), "failed iteration guest writes");
  assert.equal(await f.api.treeDigest(f.prepared.seed), f.checkpoint.profileSha256);
});

test("tampered profile bytes or desktop envelope/normal metadata cannot be reused", async (t) => {
  const f = await checkpointFixture(t);
  await sealFixture(f);
  for (const mutate of [
    (c) => { c.session.value = c.session.value.replace("AAH/fw==", "AQH/fw=="); },
    (c) => { c.normalSnapshot.preFrontBufferCrc = "deadbeef"; },
    (c) => { c.normalSnapshot.machineResume.overlayGeneration += 1; },
    (c) => { c.session.key = "unrelated-session-key"; },
  ]) {
    const changed = structuredClone(f.checkpoint);
    mutate(changed);
    assert.throws(() => f.api.validateCheckpoint(changed));
  }
  await fs.writeFile(path.join(f.prepared.seed, "Default", "persisted-state"), "tampered");
  const before = await fs.readdir(f.directory);
  await assert.rejects(f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, f.binding), /profile changed/);
  assert.deepEqual(await fs.readdir(f.directory), before);
});

test("profile ownership refuses symlinks instead of traversing or overwriting an external profile", async (t) => {
  const f = await checkpointFixture(t);
  await sealFixture(f);
  const linked = path.join(f.directory, "linked-profile");
  await fs.symlink(f.prepared.seed, linked);
  await assert.rejects(f.api.prepareDiagnostic({ ...f.options, directory: linked }, f.binding), /real directory/);
  await fs.symlink(f.prepared.checkpointFile, path.join(f.prepared.seed, "external"));
  await assert.rejects(f.api.prepareDiagnostic({ ...f.options, mode: "reuse" }, f.binding), /refuses symlink/);
});

test("checkpoint session hydration is exact, origin-scoped and refuses an existing different envelope", async (t) => {
  const f = await checkpointFixture(t);
  const data = new Map();
  const sandbox = vm.createContext({
    location: { origin: "http://elsewhere" },
    sessionStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
  });
  const targetPage = { addInitScript: async (fn, argument) => {
    sandbox.argument = argument;
    vm.runInContext(`(${fn})(argument)`, sandbox);
  } };
  await f.api.installCheckpointSession(targetPage, f.checkpoint, f.options.origin);
  assert.equal(data.size, 0);
  sandbox.location.origin = f.options.origin;
  await f.api.installCheckpointSession(targetPage, f.checkpoint, f.options.origin);
  assert.equal(data.get(f.checkpoint.session.key), f.checkpoint.session.value);
  data.set(f.checkpoint.session.key, "unrelated envelope");
  await assert.rejects(f.api.installCheckpointSession(targetPage, f.checkpoint, f.options.origin), /refusing to overwrite/);
  assert.equal(data.get(f.checkpoint.session.key), "unrelated envelope");
});

test("persistent Chromium identity uses public CDP when browser() is null and always detaches", async (t) => {
  const f = await checkpointFixture(t);
  let detached = 0;
  const session = { send: async (method) => {
    assert.equal(method, "Browser.getVersion");
    return { product: "Chrome/152.0.1" };
  }, detach: async () => { detached += 1; } };
  const context = { newCDPSession: async () => session };
  const identity = await f.api.readBrowserIdentity(null, context, {}, true);
  assert.equal(identity.version, "Chrome/152.0.1");
  assert.equal(identity.headless, true);
  assert.equal(detached, 1);
  session.send = async () => { throw Error("CDP disconnected"); };
  await assert.rejects(f.api.readBrowserIdentity(null, context, {}, true), /disconnected/);
  assert.equal(detached, 2);
});

test("zero PCM and completion attachment/timestamps reach failure milestones before the PCM assertion", async () => {
  const body = extractBetween("  const postPcmAtCompletion =", "  await page.waitForFunction(\n    ({ minimum })");
  for (const attached of [true, false, null]) {
    const f = fixture();
    f.clock.now = 14_000;
    f.sandbox.postRestoreStart = 1_000;
    f.sandbox.postAudioBefore = { writeIndex: 0 };
    f.sandbox.window.__desktopTerminal = { audio: () => ({ pcm: () => ({
      writeIndex: 0, readIndex: 0, writtenFrames: 0, nonSilentFrames: 0, maxAbs: 0,
    }) }) };
    f.sandbox.window.__desktopController = { audioOutputReady: async () => {
      assert.equal(f.milestones.postRestorePcmAtCompletion.pcm.writeIndex, 0);
      assert.equal(f.milestones.postRestorePcmAtCompletion.observedAt, 14_000);
      assert.equal(f.milestones.postRestorePcmAtCompletion.elapsedMs, 13_000);
      return attached;
    } };
    f.sandbox.page.evaluate = async (fn, argument) => fn(argument);
    let failure;
    await assert.rejects(vm.runInContext(`(async () => { ${body} })()`, f.context), (error) => {
      failure = error;
      return /wrote no guest PCM at completion/.test(error.message);
    });
    f.sandbox.page.evaluate = async () => { throw Error("page closed"); };
    await f.api.captureFailure("failure-pcm", failure);
    const saved = JSON.parse(f.writes[0].value).milestones;
    assert.equal(saved.postRestorePcmAtCompletion.pcm.writtenFrames, 0);
    assert.equal(saved.postRestorePcmAtCompletion.observedAt, 14_000);
    assert.equal(saved.postRestorePcmAtCompletion.elapsedMs, 13_000);
    assert.equal(saved.postRestoreOutputAttached.outputAttached, attached);
    assert.equal(saved.postRestoreOutputAttached.observedAt, 14_000);
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
