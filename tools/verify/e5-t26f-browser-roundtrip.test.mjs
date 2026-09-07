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
  const api = vm.runInContext(progress + capture + `
    ({ phaseProgress, sampleProgress, startProgressSampling, stopProgressSampling,
       remainingInteractionMs, waitForRestoredCursor, captureFailure,
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
