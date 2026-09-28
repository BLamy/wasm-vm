import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readLateDisplayCheckpoint, captureLateDisplay, auditLateDisplay,
  DISPLAY_LATE_OFFSETS } from "./omarchy-display-late-probe.mjs";

test("checkpoint requires completed latest presentation and owns its exported bytes", () => {
  const frame = { sequence: 1, format: 2, scanout: 0, resourceWidth: 1, resourceHeight: 1,
    rect: { x: 0, y: 0, width: 1, height: 1 }, bytes: Uint8Array.from([3,5,7,11]) };
  const state = { width: 1, height: 1, framesReceived: 1, successfulPresents: 1, scheduler: { pending: 0 } };
  const probe = { frames: [frame], sequence: 1, framesSeen: 1, disposed: false, errors: [] };
  const context = vm.createContext({ __omarchyDisplayPixels: probe,
    __presentation: { state: () => state, readPixels: () => Uint8Array.from([7,5,3,255]) },
    btoa: value => Buffer.from(value, "binary").toString("base64") });
  const read = () => vm.runInContext(`(${readLateDisplayCheckpoint})()`, context);
  const capture = read(); frame.bytes.fill(0);
  assert.deepEqual([...Buffer.from(capture.frame.base64, "base64")], [3,5,7,11]);
  state.scheduler.pending = 1; assert.throws(read, /ambiguous/); state.scheduler.pending = 0;
  probe.sequence = 2; assert.throws(read, /ambiguous/); probe.sequence = 1;
  state.successfulPresents = 0; assert.throws(read, /ambiguous/); state.successfulPresents = 1;
  probe.disposed = true; assert.throws(read, /live private/);
});

async function fixture(t, { mismatch = false, overrun = false } = {}) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "display-late-test-"));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  await fs.writeFile(path.join(out, "desktop-keyboard.png"), "fixture-original-image");
  let now = Date.now(), sequence = 1;
  const start = now, iso = n => new Date(n).toISOString();
  const report = { displayLateProbeRequested: true, result: "original-product-result",
    keyboard: { verified: true, completedAt: iso(now-2000) },
    trial: { responseImageCapturedAt: iso(now-1000), captureDeadlineAt: iso(now+1000), presentationAfter: { framesReceived: 1 } } };
  const original = structuredClone(report);
  const raw = Buffer.alloc(1280*800*4), canvas = Buffer.alloc(raw.length);
  for (let i=3; i<canvas.length; i+=4) canvas[i]=255;
  const state = () => ({ backend: "canvas2d", width: 1280, height: 800, framesReceived: sequence,
    successfulPresents: sequence, scheduler: { pending: 0 } });
  const shotTimeouts = [];
  const page = {
    evaluate: async fn => fn.name === "readLateDisplayCheckpoint" ? {
      capturedAt: iso(now), sequence, framesSeen: sequence,
      frame: { sequence, timestamp: iso(now-10), scanout: 0, format: 2, resourceWidth: 1280, resourceHeight: 800,
        rect: { x: 0, y: 0, width: 1280, height: 800 }, base64: raw.toString("base64") },
      canvas: { width: 1280, height: 800, state: state(), base64: canvas.toString("base64") },
    } : { sequence, state: state() },
    screenshot: async ({ path: file, timeout }) => {
      shotTimeouts.push(timeout); await fs.writeFile(file, "fixture-late-image");
      now += overrun ? 181000 : 1000; if (mismatch) sequence++;
    },
  };
  const run = () => captureLateDisplay(page, out, report, { now: () => now, sleep: async ms => { now += ms; } });
  return { out, report, original, start, shotTimeouts, run, now: () => now };
}

test("absolute continuation offsets preserve product evidence and reject late or mismatched receipts", async t => {
  const f = await fixture(t); await f.run();
  f.report.cleanup = { startedAt: new Date(f.now()).toISOString() };
  assert.deepEqual(f.report.trial, f.original.trial); assert.deepEqual(f.report.keyboard, f.original.keyboard);
  assert.equal(f.report.result, f.original.result);
  assert.deepEqual(f.report.displayLateProbe.checkpoints.map(row => Date.parse(row.startedAt)-f.start), DISPLAY_LATE_OFFSETS);
  assert.deepEqual(f.shotTimeouts, [20000,20000,20000,20000,20000]);
  const audit = await auditLateDisplay(f.report, f.out);
  assert.equal(audit.desktopAcceptance, false); assert.equal(audit.changedAfterVerdict, false);
  assert.ok(audit.checkpoints.every(row => row.latestMatchesCanvas));
  for (const mutate of [
    r => { r.displayLateProbe.checkpoints[1].after.sequence++; },
    r => { r.displayLateProbe.checkpoints[1].finishedAt = new Date(f.start+180001).toISOString(); },
    r => { r.displayLateProbe.checkpoints[1].canvas.sha256 = "0".repeat(64); },
    r => { r.displayLateProbe.original.responseImageCapturedAt = new Date(f.start+50000).toISOString(); },
    r => { r.displayLateProbe.checkpoints[1].offsetMs = 1; },
  ]) {
    const bad = structuredClone(f.report); mutate(bad); await assert.rejects(auditLateDisplay(bad, f.out));
  }
});

test("a new frame during the screenshot produces no accepted checkpoint", async t => {
  const f = await fixture(t, { mismatch: true });
  await assert.rejects(f.run(), /frame changed during screenshot/);
  assert.equal(f.report.displayLateProbe.status, "unproven");
  assert.equal(f.report.result, f.original.result);
});

test("a slow operation exhausts the one diagnostic deadline without renewal", async t => {
  const f = await fixture(t, { overrun: true });
  await assert.rejects(f.run(), /deadline exceeded/);
  assert.equal(f.report.displayLateProbe.status, "unproven");
  assert.equal(f.report.displayLateProbe.checkpoints.length, 1);
  assert.equal(f.report.result, f.original.result);
});
