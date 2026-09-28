// Opt-in evidence only: observe actual display messages without modifying them.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function installDisplayPixelProbe({ enabled = false } = {}) {
  if (!enabled) return;
  if (globalThis.__omarchyDisplayPixels) throw Error("display probe already installed");
  const original = Worker.prototype.postMessage;
  const seen = new WeakSet(), listeners = [];
  const probe = globalThis.__omarchyDisplayPixels = {
    version: 1, diagnosticOnly: true, maxFrames: 8, maxBytesPerFrame: 1280 * 832 * 4,
    maxEvents: 64, events: [], frames: [], errors: [], sequence: 0, framesSeen: 0, evicted: 0, disposed: false,
  };
  const error = value => { if (probe.errors.length < 16) probe.errors.push(String(value)); };
  const observe = (data, worker) => {
    if (data?.type !== "display" || probe.disposed) return;
    try {
      const frame = data.frame;
      const row = { sequence: ++probe.sequence, timestamp: new Date().toISOString(),
        pageMs: performance.now(), worker, type: frame?.type === "clear" ? "clear" : "frame" };
      if (row.type === "frame") {
        const width = frame.resourceWidth, height = frame.resourceHeight;
        const size = width * height * 4;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
          || size > probe.maxBytesPerFrame || !(frame.pixels instanceof ArrayBuffer) || frame.pixels.byteLength !== size)
          throw Error("display buffer outside diagnostic byte bound");
        Object.assign(row, { scanout: frame.scanout, format: frame.format,
          rect: { ...frame.rect }, resourceWidth: width, resourceHeight: height, byteLength: size });
        // A private copy survives any later transfer, mutation or resource reuse.
        const bytes = new Uint8Array(frame.pixels.slice(0));
        probe.framesSeen++;
        if (probe.frames.length === probe.maxFrames) { probe.frames.shift(); probe.evicted++; }
        probe.frames.push({ ...row, bytes });
      }
      if (probe.events.length === probe.maxEvents) probe.events.shift();
      probe.events.push(row);
    } catch (failure) { error(failure); }
  };
  const wrapped = function (message, ...rest) {
    try {
      if (!seen.has(this) && !probe.disposed) {
        seen.add(this);
        if (listeners.length >= 8) error("display worker bound exceeded");
        else {
          const worker = listeners.length + 1;
          const listener = event => observe(event.data, worker);
          this.addEventListener("message", listener);
          listeners.push({ worker: this, listener });
        }
      }
    } catch (failure) { error(failure); }
    return original.call(this, message, ...rest);
  };
  Worker.prototype.postMessage = wrapped;
  probe.dispose = () => {
    probe.disposed = true;
    for (const { worker, listener } of listeners) worker.removeEventListener("message", listener);
    listeners.length = 0;
    if (Worker.prototype.postMessage === wrapped) Worker.prototype.postMessage = original;
  };
}

// Called only after the product capture, inside the existing owned cleanup budget.
export function readDisplayPixelProbe() {
  const probe = globalThis.__omarchyDisplayPixels;
  if (!probe) throw Error("display probe missing");
  const encode = bytes => {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return btoa(parts.join(""));
  };
  probe.dispose();
  const state = globalThis.__presentation.state();
  const canvas = globalThis.__presentation.readPixels();
  const snapshot = { version: probe.version, diagnosticOnly: true,
    maxFrames: probe.maxFrames, maxBytesPerFrame: probe.maxBytesPerFrame, maxEvents: probe.maxEvents,
    sequence: probe.sequence, framesSeen: probe.framesSeen, evicted: probe.evicted, disposed: probe.disposed,
    capturedAt: new Date().toISOString(), events: probe.events, errors: probe.errors,
    frames: probe.frames.map(({ bytes, ...row }) => ({ ...row, base64: encode(bytes) })),
    canvas: { state, width: state.width, height: state.height, base64: encode(canvas) } };
  probe.frames.length = 0;
  return snapshot;
}

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export async function collectDisplayPixelProbe(page, out, report) {
  const capture = await page.evaluate(readDisplayPixelProbe);
  const dir = path.join(out, "display-pixels");
  await fs.mkdir(dir, { recursive: false });
  for (const [index, row] of [...capture.frames, capture.canvas].entries()) {
    const bytes = Buffer.from(row.base64, "base64"); delete row.base64;
    row.file = index === capture.frames.length ? "canvas.rgba" : `frame-${row.sequence}.bgra`;
    row.size = bytes.length; row.sha256 = sha(bytes);
    await fs.writeFile(path.join(dir, row.file), bytes);
  }
  report.displayPixelProbe = capture;
}

export function displayFrameRgba(frame, bytes, width, height) {
  assert.ok([1, 2].includes(frame.format), "unsupported display format in diagnostic");
  assert.equal(bytes.length, frame.resourceWidth * frame.resourceHeight * 4);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  let partialAlphaPixels = 0;
  for (let y = 0; y < Math.min(height, frame.resourceHeight); y++) {
    for (let x = 0; x < Math.min(width, frame.resourceWidth); x++) {
      const src = (y * frame.resourceWidth + x) * 4, dst = (y * width + x) * 4;
      const alpha = frame.format === 2 ? 255 : bytes[src + 3];
      if (alpha !== 0 && alpha !== 255) partialAlphaPixels++;
      rgba[dst] = alpha ? bytes[src + 2] : 0;
      rgba[dst + 1] = alpha ? bytes[src + 1] : 0;
      rgba[dst + 2] = alpha ? bytes[src] : 0;
      rgba[dst + 3] = alpha;
    }
  }
  return { rgba, partialAlphaPixels };
}

export async function auditDisplayPixelProbe(report, out) {
  assert.equal(report.displayPixelProbeRequested, true);
  const capture = report.displayPixelProbe;
  assert.equal(capture.diagnosticOnly, true); assert.equal(capture.disposed, true);
  assert.deepEqual(capture.errors, []);
  assert.equal(capture.maxFrames, 8); assert.equal(capture.maxBytesPerFrame, 1280 * 832 * 4);
  assert.equal(capture.maxEvents, 64);
  assert.ok(capture.frames.length > 0 && capture.frames.length <= 8);
  assert.equal(capture.frames.length + capture.evicted, capture.framesSeen);
  assert.ok(capture.events.length <= 64);
  assert.equal(capture.events.at(-1)?.type, "frame", "final event must be a retained frame");
  assert.equal(capture.frames.at(-1).sequence, capture.sequence, "latest frame missing");
  assert.equal(capture.events.at(-1).sequence, capture.sequence);
  assert.equal(capture.canvas.state.backend, "canvas2d");
  assert.equal(capture.canvas.width, 1280); assert.equal(capture.canvas.height, 800);
  assert.equal(capture.canvas.state.framesReceived, capture.framesSeen);
  assert.equal(capture.canvas.state.successfulPresents, capture.framesSeen);
  assert.equal(capture.canvas.state.scheduler.pending, 0);
  assert.ok(Date.parse(capture.capturedAt) >= Date.parse(report.trial.responseImageCapturedAt));
  const load = async row => {
    assert.match(row.file, /^(?:canvas\.rgba|frame-[1-9][0-9]*\.bgra)$/u);
    const bytes = await fs.readFile(path.join(out, "display-pixels", row.file));
    assert.equal(bytes.length, row.size); assert.equal(sha(bytes), row.sha256);
    return bytes;
  };
  const canvas = await load(capture.canvas);
  assert.equal(canvas.length, 1280 * 800 * 4);
  const rows = [];
  let previousRaw = null, previousVisible = null, previousSequence = 0;
  const changedPixels = (a, b) => {
    if (!a || a.length !== b.length) return null;
    let count = 0;
    for (let i = 0; i < a.length; i += 4) if (a.readUInt32LE(i) !== b.readUInt32LE(i)) count++;
    return count;
  };
  for (const frame of capture.frames) {
    assert.ok(frame.sequence > previousSequence); previousSequence = frame.sequence;
    assert.ok(frame.size <= capture.maxBytesPerFrame);
    const bytes = await load(frame);
    const { rgba, partialAlphaPixels } = displayFrameRgba(frame, bytes, 1280, 800);
    rows.push({ sequence: frame.sequence, timestamp: frame.timestamp, scanout: frame.scanout,
      format: frame.format, rect: frame.rect, resourceWidth: frame.resourceWidth, resourceHeight: frame.resourceHeight,
      rawSha256: frame.sha256, visibleSha256: sha(rgba), partialAlphaPixels,
      rawChangedPixels: changedPixels(previousRaw, bytes), visibleChangedPixels: changedPixels(previousVisible, rgba),
      matchesCanvas: rgba.equals(canvas),
      afterNonce: Date.parse(frame.timestamp) >= Date.parse(report.keyboard.completedAt) });
    previousRaw = bytes; previousVisible = rgba;
  }
  assert.ok(rows.some(row => row.afterNonce), "no post-nonce frame at the measured boundary");
  return { diagnosticOnly: true, desktopAcceptance: false, canvasSha256: capture.canvas.sha256,
    captureAt: capture.capturedAt, evicted: capture.evicted, frames: rows,
    latestMatchesCanvas: rows.at(-1).matchesCanvas,
    alphaComparisonExact: rows.at(-1).partialAlphaPixels === 0 };
}
