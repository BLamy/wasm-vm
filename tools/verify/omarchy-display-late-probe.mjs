// Bounded observation after the product verdict. Never creates guest input.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { withinTrialDeadline, remainingTrialMs } from "./omarchy-input-trial.mjs";
import { displayFrameRgba } from "./omarchy-display-pixel-probe.mjs";

export const DISPLAY_LATE_MS = 180000;
export const DISPLAY_LATE_OFFSETS = Object.freeze([0, 40000, 80000, 120000, 160000]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function readLateDisplayCheckpoint() {
  const probe = globalThis.__omarchyDisplayPixels;
  if (!probe || probe.disposed || probe.errors.length) throw Error("live private pixel observer required");
  const frame = probe.frames.at(-1), state = globalThis.__presentation.state();
  if (!frame || frame.sequence !== probe.sequence || state.scheduler.pending !== 0
    || state.framesReceived !== probe.framesSeen || state.successfulPresents !== probe.framesSeen)
    throw Error("ambiguous latest display checkpoint");
  const encode = bytes => {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return btoa(parts.join(""));
  };
  const { bytes, ...metadata } = frame;
  return { capturedAt: new Date().toISOString(), sequence: probe.sequence, framesSeen: probe.framesSeen,
    frame: { ...metadata, base64: encode(bytes) },
    canvas: { state, width: state.width, height: state.height,
      base64: encode(globalThis.__presentation.readPixels()) } };
}

export async function captureLateDisplay(page, out, report, {
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  assert.equal(report.displayLateProbeRequested, true);
  assert.equal(report.keyboard?.verified, true);
  assert.ok(report.trial.responseImageCapturedAt);
  const start = now(), deadline = start + DISPLAY_LATE_MS;
  const receipt = report.displayLateProbe = { diagnosticOnly: true, desktopAcceptance: false,
    startedAt: new Date(start).toISOString(), deadlineAt: new Date(deadline).toISOString(),
    timeoutMs: DISPLAY_LATE_MS, status: "observing", checkpoints: [],
    original: { result: report.result, nonceCompletedAt: report.keyboard.completedAt,
      responseImageCapturedAt: report.trial.responseImageCapturedAt,
      captureDeadlineAt: report.trial.captureDeadlineAt, presentationAfter: structuredClone(report.trial.presentationAfter) } };
  const bounded = async (operation, label) => {
    const remaining = remainingTrialMs(deadline, now(), label);
    const value = await withinTrialDeadline(operation, Date.now() + remaining, label);
    remainingTrialMs(deadline, now(), label); return value;
  };
  const original = await bounded(() => fs.readFile(path.join(out, "desktop-keyboard.png")), "original product image");
  receipt.original.pngSha256 = sha(original);
  const directory = path.join(out, "late-display");
  await bounded(() => fs.mkdir(directory, { recursive: false }), "late display directory");
  try {
    for (const offset of DISPLAY_LATE_OFFSETS) {
      await bounded(() => sleep(Math.max(0, start + offset - now())), "late display schedule");
      const row = { offsetMs: offset, startedAt: new Date(now()).toISOString() };
      receipt.checkpoints.push(row);
      Object.assign(row, await bounded(() => page.evaluate(readLateDisplayCheckpoint), "late display bytes"));
      row.image = `checkpoint-${offset}.png`;
      await bounded(() => page.screenshot({ path: path.join(directory, row.image),
        timeout: Math.min(20000, remainingTrialMs(deadline, now())) }), "late display screenshot");
      row.after = await bounded(() => page.evaluate(() => ({
        sequence: globalThis.__omarchyDisplayPixels.sequence, state: globalThis.__presentation.state(),
      })), "late display image binding");
      assert.equal(row.after.sequence, row.sequence, "frame changed during screenshot");
      assert.equal(row.after.state.framesReceived, row.canvas.state.framesReceived);
      assert.equal(row.after.state.successfulPresents, row.canvas.state.successfulPresents);
      assert.equal(row.after.state.scheduler.pending, 0);
      row.imageSha256 = sha(await bounded(() => fs.readFile(path.join(directory, row.image)), "late display image hash"));
      for (const [kind, data] of [["frame", row.frame], ["canvas", row.canvas]]) {
        const bytes = Buffer.from(data.base64, "base64"); delete data.base64;
        assert.ok(bytes.length <= 1280 * 832 * 4);
        const packed = gzipSync(bytes);
        data.file = `checkpoint-${offset}-${kind}.gz`; data.encoding = "gzip";
        data.size = bytes.length; data.sha256 = sha(bytes); data.packedSha256 = sha(packed);
        await bounded(() => fs.writeFile(path.join(directory, data.file), packed), "late display save");
      }
      row.finishedAt = new Date(now()).toISOString();
      console.log(`OMARCHY_LATE_DISPLAY ${JSON.stringify({ offsetMs: offset, sequence: row.sequence,
        frames: row.framesSeen, imageSha256: row.imageSha256 })}`);
    }
    receipt.status = "captured";
  } catch (error) { receipt.status = "unproven"; receipt.error = String(error); throw error; }
  finally { receipt.finishedAt = new Date(now()).toISOString(); }
}

export async function auditLateDisplay(report, out) {
  assert.equal(report.displayLateProbeRequested, true);
  const r = report.displayLateProbe;
  assert.equal(r.diagnosticOnly, true); assert.equal(r.desktopAcceptance, false);
  assert.equal(r.status, "captured"); assert.equal(r.timeoutMs, DISPLAY_LATE_MS);
  const start = Date.parse(r.startedAt), deadline = Date.parse(r.deadlineAt);
  assert.equal(deadline - start, DISPLAY_LATE_MS);
  assert.ok(Date.parse(r.finishedAt) <= deadline);
  assert.ok(start >= Date.parse(report.trial.responseImageCapturedAt));
  assert.ok(Date.parse(report.cleanup.startedAt) >= Date.parse(r.finishedAt));
  assert.deepEqual(r.original, { result: report.result, nonceCompletedAt: report.keyboard.completedAt,
    responseImageCapturedAt: report.trial.responseImageCapturedAt,
    captureDeadlineAt: report.trial.captureDeadlineAt, presentationAfter: report.trial.presentationAfter,
    pngSha256: sha(await fs.readFile(path.join(out, "desktop-keyboard.png"))) });
  assert.deepEqual(r.checkpoints.map(row => row.offsetMs), DISPLAY_LATE_OFFSETS);
  const rows = [];
  for (const row of r.checkpoints) {
    assert.ok(Date.parse(row.startedAt) >= start + row.offsetMs);
    assert.ok(Date.parse(row.capturedAt) >= Date.parse(row.startedAt));
    assert.ok(Date.parse(row.finishedAt) <= deadline);
    assert.ok(Date.parse(row.finishedAt) >= Date.parse(row.capturedAt));
    assert.equal(row.after.sequence, row.sequence); assert.equal(row.frame.sequence, row.sequence);
    assert.ok(Date.parse(row.frame.timestamp) <= Date.parse(row.capturedAt));
    for (const state of [row.canvas.state, row.after.state]) {
      assert.equal(state.framesReceived, row.framesSeen); assert.equal(state.successfulPresents, row.framesSeen);
      assert.equal(state.scheduler.pending, 0); assert.equal(state.backend, "canvas2d");
    }
    assert.equal(row.canvas.width, 1280); assert.equal(row.canvas.height, 800);
    const load = async (data, kind) => {
      assert.equal(data.file, `checkpoint-${row.offsetMs}-${kind}.gz`); assert.equal(data.encoding, "gzip");
      const packed = await fs.readFile(path.join(out, "late-display", data.file));
      assert.equal(sha(packed), data.packedSha256);
      const bytes = gunzipSync(packed, { maxOutputLength: 1280 * 832 * 4 });
      assert.equal(bytes.length, data.size); assert.equal(sha(bytes), data.sha256); return bytes;
    };
    const raw = await load(row.frame, "frame"), canvas = await load(row.canvas, "canvas");
    assert.equal(canvas.length, 1280 * 800 * 4);
    const { rgba, partialAlphaPixels } = displayFrameRgba(row.frame, raw, 1280, 800);
    assert.equal(row.image, `checkpoint-${row.offsetMs}.png`);
    assert.equal(sha(await fs.readFile(path.join(out, "late-display", row.image))), row.imageSha256);
    rows.push({ offsetMs: row.offsetMs, sequence: row.sequence, frameAt: row.frame.timestamp,
      capturedAt: row.capturedAt, rawSha256: row.frame.sha256, canvasSha256: row.canvas.sha256,
      latestMatchesCanvas: rgba.equals(canvas), alphaComparisonExact: partialAlphaPixels === 0,
      image: row.image, imageSha256: row.imageSha256 });
  }
  return { diagnosticOnly: true, desktopAcceptance: false, original: r.original,
    checkpoints: rows, changedAfterVerdict: rows.slice(1).some(row => row.canvasSha256 !== rows[0].canvasSha256) };
}
