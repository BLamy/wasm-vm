import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { installDisplayPixelProbe, readDisplayPixelProbe, displayFrameRgba,
  collectDisplayPixelProbe, auditDisplayPixelProbe } from "./omarchy-display-pixel-probe.mjs";

function fixture() {
  class Worker {
    listeners = new Set(); calls = [];
    addEventListener(type, fn) { assert.equal(type, "message"); this.listeners.add(fn); }
    removeEventListener(type, fn) { assert.equal(type, "message"); this.listeners.delete(fn); }
    postMessage(...args) { this.calls.push(args); if (this.failure) throw this.failure; return 73; }
    emit(data) { for (const fn of this.listeners) fn({ data }); }
  }
  const original = Worker.prototype.postMessage;
  const context = vm.createContext({ Worker, ArrayBuffer, Uint8Array, performance,
    btoa: value => Buffer.from(value, "binary").toString("base64") });
  const install = enabled => vm.runInContext(`(${installDisplayPixelProbe})(${JSON.stringify({ enabled })})`, context);
  const frame = () => ({ type: "display", frame: { scanout: null, format: 2,
    rect: { x: 0, y: 0, width: 1, height: 1 }, resourceWidth: 1, resourceHeight: 1,
    pixels: Uint8Array.from([3, 5, 7, 11]).buffer } });
  return { Worker, original, context, install, frame };
}

test("opt-in observer preserves transport, private ownership and disposal", () => {
  const f = fixture(); f.install(false);
  assert.equal(f.Worker.prototype.postMessage, f.original);
  assert.equal(f.context.__omarchyDisplayPixels, undefined);
  f.install(true);
  const worker = new f.Worker(), message = { type: "input" }, transfer = [new ArrayBuffer(4)];
  assert.equal(worker.postMessage(message, transfer), 73);
  assert.equal(worker.calls[0][0], message); assert.equal(worker.calls[0][1], transfer);
  worker.postMessage(message); assert.equal(worker.listeners.size, 1);
  worker.failure = new Error("native transport failure");
  assert.throws(() => worker.postMessage(message), error => error === worker.failure);
  const wire = f.frame(); worker.emit(wire);
  assert.equal(new Uint8Array(wire.frame.pixels)[3], 11, "original X byte must remain unchanged");
  wire.frame.rect.x = 9; new Uint8Array(wire.frame.pixels).fill(0);
  structuredClone(wire.frame.pixels, { transfer: [wire.frame.pixels] });
  const probe = f.context.__omarchyDisplayPixels;
  assert.deepEqual([...probe.frames[0].bytes], [3, 5, 7, 11]); assert.equal(probe.frames[0].rect.x, 0);
  const other = () => {}; worker.listeners.add(other);
  probe.dispose(); assert.equal(f.Worker.prototype.postMessage, f.original);
  assert.deepEqual([...worker.listeners], [other]); worker.emit(f.frame()); assert.equal(probe.framesSeen, 1);
});

test("frame and event rings remain bounded; malformed frames cannot interrupt transport", () => {
  const f = fixture(); f.install(true); const worker = new f.Worker(); worker.postMessage({});
  for (let i = 0; i < 80; i++) worker.emit(f.frame());
  const probe = f.context.__omarchyDisplayPixels;
  assert.equal(probe.framesSeen, 80); assert.equal(probe.evicted, 72);
  assert.equal(probe.frames.length, 8); assert.equal(probe.events.length, 64);
  assert.equal(probe.frames[0].sequence, 73); assert.equal(probe.frames.at(-1).sequence, 80);
  const invalid = f.frame(); invalid.frame.resourceWidth = 1281; invalid.frame.resourceHeight = 832;
  worker.emit(invalid); assert.equal(probe.errors.length, 1); assert.equal(probe.framesSeen, 80);
  for (let i = 0; i < 9; i++) assert.equal(new f.Worker().postMessage({}), 73);
  assert.ok(probe.errors.some(error => error.includes("worker bound")));
  probe.dispose();
});

test("export owns the latest bytes and restores the observer before canvas readback", () => {
  const f = fixture(); f.install(true); const worker = new f.Worker(); worker.postMessage({}); worker.emit(f.frame());
  f.context.__presentation = { state: () => ({ width: 1, height: 1 }), readPixels: () => {
    assert.equal(f.Worker.prototype.postMessage, f.original);
    return Uint8Array.from([7, 5, 3, 255]);
  } };
  const result = vm.runInContext(`(${readDisplayPixelProbe})()`, f.context);
  assert.equal(result.disposed, true); assert.equal(f.context.__omarchyDisplayPixels.frames.length, 0);
  assert.deepEqual([...Buffer.from(result.frames[0].base64, "base64")], [3, 5, 7, 11]);
  assert.deepEqual([...Buffer.from(result.canvas.base64, "base64")], [7, 5, 3, 255]);
});

test("literal BGRA and BGRX conversion crops the actual top-left viewport", () => {
  const bytes = Buffer.from([3,5,7,11, 17,19,23,0, 29,31,37,255, 41,43,47,255]);
  const frame = { format: 2, resourceWidth: 2, resourceHeight: 2 };
  assert.deepEqual([...displayFrameRgba(frame, bytes, 1, 1).rgba], [7,5,3,255]);
  const alpha = displayFrameRgba({ ...frame, format: 1 }, bytes, 2, 1);
  assert.deepEqual([...alpha.rgba], [7,5,3,11, 0,0,0,0]); assert.equal(alpha.partialAlphaPixels, 1);
  assert.deepEqual([...displayFrameRgba(frame, bytes, 3, 1).rgba], [7,5,3,255,23,19,17,255,0,0,0,255]);
});

test("saved-byte audit binds latest frame, nonce, presentation completion and file digest", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "display-pixel-test-"));
  try {
    const raw = Buffer.alloc(1280 * 800 * 4), canvas = Buffer.alloc(raw.length);
    for (let i = 3; i < canvas.length; i += 4) canvas[i] = 255;
    const capture = { version: 1, diagnosticOnly: true, maxFrames: 8, maxBytesPerFrame: 1280*832*4,
      maxEvents: 64, sequence: 1, framesSeen: 1, evicted: 0, disposed: true,
      capturedAt: "2026-09-16T00:00:03Z", errors: [], events: [{ sequence: 1, type: "frame" }],
      frames: [{ sequence: 1, timestamp: "2026-09-16T00:00:02Z", scanout: 0, format: 2,
        rect: { x: 0, y: 0, width: 1280, height: 800 }, resourceWidth: 1280, resourceHeight: 800,
        base64: raw.toString("base64") }],
      canvas: { width: 1280, height: 800, state: { backend: "canvas2d", framesReceived: 1,
        successfulPresents: 1, scheduler: { pending: 0 } }, base64: canvas.toString("base64") } };
    const report = { displayPixelProbeRequested: true, trial: { responseImageCapturedAt: "2026-09-16T00:00:03Z" },
      keyboard: { completedAt: "2026-09-16T00:00:01Z" } };
    await collectDisplayPixelProbe({ evaluate: async fn => { assert.equal(fn, readDisplayPixelProbe); return capture; } }, out, report);
    const result = await auditDisplayPixelProbe(report, out);
    assert.equal(result.latestMatchesCanvas, true); assert.equal(result.desktopAcceptance, false);
    assert.equal(result.canvasSha256, createHash("sha256").update(canvas).digest("hex"));
    for (const mutate of [r => { r.displayPixelProbeRequested = false; },
      r => { r.displayPixelProbe.sequence = 2; }, r => { r.displayPixelProbe.canvas.state.scheduler.pending = 1; },
      r => { r.displayPixelProbe.canvas.state.successfulPresents = 0; },
      r => { r.keyboard.completedAt = "2026-09-16T00:00:04Z"; },
      r => { r.displayPixelProbe.frames[0].sha256 = "0".repeat(64); }]) {
      const bad = structuredClone(report); mutate(bad); await assert.rejects(auditDisplayPixelProbe(bad, out));
    }
    raw[0] = 1; await fs.writeFile(path.join(out, "display-pixels/frame-1.bgra"), raw);
    await assert.rejects(auditDisplayPixelProbe(report, out));
  } finally { await fs.rm(out, { recursive: true, force: true }); }
});
