// E5-T07d: Chromium-only native-parity and bounded fbcon stress proof.  The page intentionally
// keeps an independent RGBA model, drives a one-million-byte /dev/tty0 write plus 100 VT switches,
// and exposes a manual mode so the verifier can interrupt a live boot before reloading it.

import { startLinuxBoot } from "./loader.js";
import { PresentationController } from "./src/sink/presentation.js";

const WIDTH = 1280;
const HEIGHT = 800;
const FULL_AREA = WIDTH * HEIGHT;
const TRACE_HEAD = 256;
const TRACE_TAIL = 256;
const SERIAL_LIMIT = 2_000_000;
const BOOT_TIMEOUT_MS = 900_000;
const SETTLE_MS = 2_000;
const MANUAL = new URLSearchParams(location.search).get("manual") === "1";
const SEED = new URLSearchParams(location.search).get("seed") || "17";
const REQUESTED_QUEUE_DELAY = Number(new URLSearchParams(location.search).get("queueDelayMs") || 0);
const QUEUE_DELAY_MS = Number.isFinite(REQUESTED_QUEUE_DELAY)
  ? Math.max(0, Math.min(4, Math.floor(REQUESTED_QUEUE_DELAY)))
  : 0;
const CLEAR_COMMAND = "printf '\\033[2J\\033[H' > /dev/tty0\n";
const SCROLL_COMMAND = "dd if=/dev/zero bs=1000000 count=1 of=/dev/tty0; printf 'E5-T07D\\n' > /dev/tty0; echo E5T07D_SCROLL_OK\n";
const VT_COMMAND = "i=0; while [ \"$i\" -lt 100 ]; do chvt 1; i=$((i + 1)); done; echo E5T07D_VT_OK\n";
const MARKERS = Object.freeze({
  virtioGpu: "virtio_gpu",
  drm: "[drm]",
  fbcon: "fb0: virtio_gpudrmfb",
});

const canvas = document.getElementById("tty0-stress-canvas");
const statusEl = document.getElementById("tty0-stress-status");
const backendEl = document.getElementById("display-backend");
const serialStateEl = document.getElementById("serial-state");
const serialEl = document.getElementById("serial-log");
const proofEl = document.getElementById("proof");

let presentation = null;
let controller = null;
let serialText = "";
let decoder = new TextDecoder();
let seenMarkers = new Set();
let modelRgba = new Uint8Array(WIDTH * HEIGHT * 4);
let callbackCount = 0;
let outsideRectanglesPreserved = true;
let resourceDimensionsStable = true;
let traceShort = [];
let traceFirst = [];
let traceLast = [];
let traceDigest = 0xcbf29ce484222325n;
let traceDigestEncoder = new TextEncoder();
let clearBytes = 0;
let scrollBytes = 0;
let vtBytes = 0;
let scrollStartedAt = null;
let scrollFinishedAt = null;
let finalProof = null;
let displayError = null;
let scenarioStarted = false;
let manualReady = false;

function setStatus(text, state = "booting") {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }
  if (serialStateEl) serialStateEl.textContent = text;
}

function rgbaForWord(value, format) {
  const word = Number(value) >>> 0;
  return [
    (word >>> 16) & 0xff,
    (word >>> 8) & 0xff,
    word & 0xff,
    Number(format) === 2 ? 0xff : word >>> 24,
  ];
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function rgbaAt(bytes, x, y) {
  const offset = (y * WIDTH + x) * 4;
  return Array.from(bytes.subarray(offset, offset + 4));
}

function sampleOutside(rect) {
  if (rect.width === WIDTH && rect.height === HEIGHT && rect.x === 0 && rect.y === 0) return [];
  const context = canvas.getContext("2d");
  if (!context || typeof context.getImageData !== "function") throw new Error("2D readback unavailable");
  const seed = Number.parseInt(SEED, 10) || 0;
  const candidates = [
    [0, 0], [WIDTH - 1, 0], [0, HEIGHT - 1], [WIDTH - 1, HEIGHT - 1],
    [Math.floor(WIDTH / 2), Math.floor(HEIGHT / 2)], [WIDTH - 2, Math.floor(HEIGHT / 2)],
  ];
  const offset = ((seed % candidates.length) + candidates.length) % candidates.length;
  const rotated = candidates.slice(offset).concat(candidates.slice(0, offset));
  const seen = new Set();
  const samples = [];
  for (const [x, y] of rotated) {
    const key = `${x},${y}`;
    if (seen.has(key) || pointInRect(x, y, rect)) continue;
    seen.add(key);
    samples.push({ x, y, rgba: Array.from(context.getImageData(x, y, 1, 1).data) });
  }
  return samples;
}

function outsideSamplesHeld(before, rect) {
  if (!before.length) return true;
  const context = canvas.getContext("2d");
  if (!context || typeof context.getImageData !== "function") throw new Error("2D readback unavailable");
  return before.every((sample) => sameBytes(
    sample.rgba,
    Array.from(context.getImageData(sample.x, sample.y, 1, 1).data),
  ) && !pointInRect(sample.x, sample.y, rect));
}

function updateReference(frame) {
  const width = Number(frame.resourceWidth);
  const height = Number(frame.resourceHeight);
  if (width !== WIDTH || height !== HEIGHT) throw new Error(`unexpected resource ${width}x${height}`);
  const rect = frame.rect;
  const format = Number(frame.format ?? 1);
  const pixels = frame.pixels;
  for (let row = 0; row < rect.height; row += 1) {
    for (let column = 0; column < rect.width; column += 1) {
      const sourceIndex = (rect.y + row) * width + rect.x + column;
      modelRgba.set(rgbaForWord(pixels[sourceIndex], format), sourceIndex * 4);
    }
  }
}

function forceQueueDelay() {
  if (QUEUE_DELAY_MS === 0) return;
  const deadline = performance.now() + QUEUE_DELAY_MS;
  while (performance.now() < deadline) {}
}

function markerState() {
  return Object.fromEntries(Object.entries(MARKERS).map(([name, marker]) => [
    name,
    seenMarkers.has(marker) || serialText.includes(marker),
  ]));
}

function updateLiveState() {
  if (!presentation || !backendEl) return;
  const state = presentation.snapshot();
  backendEl.textContent = `${state.backend} · ${state.width}×${state.height} · ${state.successfulPresents} presents`;
  backendEl.dataset.state = state.backend === "canvas2d" ? "ready" : "booting";
}

function renderProof(proof) {
  if (proofEl) proofEl.textContent = JSON.stringify(proof, null, 2);
}

async function sha256hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function regionStats(bytes) {
  let nonBlackPixels = 0;
  let opaquePixels = 0;
  let brightPixels = 0;
  const colors = new Set();
  for (let index = 0; index < bytes.length; index += 4) {
    const r = bytes[index];
    const g = bytes[index + 1];
    const b = bytes[index + 2];
    if (r !== 0 || g !== 0 || b !== 0) {
      nonBlackPixels += 1;
      colors.add(`${r},${g},${b}`);
      if (Math.max(r, g, b) >= 0x80) brightPixels += 1;
    }
    if (bytes[index + 3] === 0xff) opaquePixels += 1;
  }
  return { nonBlackPixels, opaquePixels, brightPixels, uniqueRgbColors: [...colors].sort() };
}

function waitUntil(predicate, label, timeoutMs = BOOT_TIMEOUT_MS) {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function sendCommand(command) {
  const bytes = new TextEncoder().encode(command);
  controller.pause?.();
  controller.sendInput(bytes);
  controller.resume?.();
  return bytes;
}

function promptAfterMarker(marker, start = 0) {
  const markerIndex = serialText.indexOf(marker, start);
  return markerIndex >= 0 && serialText.indexOf("~ # ", markerIndex + marker.length) >= 0;
}

function recordTrace(entry) {
  const encoded = traceDigestEncoder.encode(JSON.stringify(entry));
  for (const byte of encoded) {
    traceDigest ^= BigInt(byte);
    traceDigest = BigInt.asUintN(64, traceDigest * 0x100000001b3n);
  }
  if (traceShort.length < TRACE_HEAD + TRACE_TAIL) traceShort.push(entry);
  if (traceFirst.length < TRACE_HEAD) traceFirst.push(entry);
  traceLast.push(entry);
  if (traceLast.length > TRACE_TAIL) traceLast.shift();
}

function sampledTrace() {
  if (callbackCount <= TRACE_HEAD + TRACE_TAIL) return traceShort;
  return [...traceFirst, ...traceLast];
}

function progress() {
  const scheduler = controller?.schedulerStats?.() ?? null;
  return {
    route: "tty0-stress",
    seed: SEED,
    queueDelayMs: QUEUE_DELAY_MS,
    manual: MANUAL,
    manualReady,
    backend: presentation?.backendName ?? null,
    frameCount: callbackCount,
    traceStored: sampledTrace().length,
    traceTruncated: Math.max(0, callbackCount - sampledTrace().length),
    scheduler,
    markers: markerState(),
  };
}

async function finishProof() {
  if (finalProof || !controller || displayError) return;
  controller.pause?.();
  const actualRgba = presentation.readPixels();
  const presentationState = presentation.snapshot();
  let mismatchBytes = 0;
  let firstMismatch = -1;
  for (let index = 0; index < modelRgba.length; index += 1) {
    if (modelRgba[index] !== actualRgba[index]) {
      mismatchBytes += 1;
      if (firstMismatch < 0) firstMismatch = index;
    }
  }
  const frameTrace = sampledTrace();
  const fullFrames = frameTrace.filter((entry) => entry.full).length;
  const partialFrames = frameTrace.filter((entry) => !entry.full).length;
  const allFrames = callbackCount <= TRACE_HEAD + TRACE_TAIL ? traceShort : [...traceFirst, ...traceLast];
  const sequenceContiguous = allFrames.every((entry, index) => {
    if (callbackCount <= TRACE_HEAD + TRACE_TAIL) return entry.sequence === index;
    if (index < TRACE_HEAD) return entry.sequence === index;
    return entry.sequence === callbackCount - TRACE_TAIL + index - TRACE_HEAD;
  });
  const dimensionsStable = allFrames.every((entry) => entry.resourceWidth === WIDTH && entry.resourceHeight === HEIGHT);
  const scheduler = controller.schedulerStats?.() ?? null;
  const inputBytes = clearBytes + scrollBytes + vtBytes;
  const serialBytes = new TextEncoder().encode(serialText);
  const traceDigestHex = traceDigest.toString(16).padStart(16, "0");
  const proof = {
    route: "tty0-stress",
    backend: presentationState.backend,
    canvas: { width: WIDTH, height: HEIGHT },
    seed: SEED,
    queueDelayMs: QUEUE_DELAY_MS,
    manual: MANUAL,
    markers: markerState(),
    clearCommand: CLEAR_COMMAND.trimEnd(),
    scrollCommandPrefix: "dd if=/dev/zero bs=1000000 count=1 of=/dev/tty0",
    scrollBytesRequested: 1_000_000,
    scrollCommandObserved: serialText.includes("dd if=/dev/zero bs=1000000"),
    scrollBytesReported: /1000000 bytes/u.test(serialText),
    scrollMarkerObserved: serialText.includes("E5T07D_SCROLL_OK"),
    promptAfterScroll: promptAfterMarker("E5T07D_SCROLL_OK"),
    vtSwitchesRequested: 100,
    vtMarkerObserved: serialText.includes("E5T07D_VT_OK"),
    promptAfterVt: promptAfterMarker("E5T07D_VT_OK"),
    serialTail: serialText.slice(-3_000),
    finalModel: regionStats(modelRgba),
    finalActual: regionStats(actualRgba),
    referenceMatchesCanvas: mismatchBytes === 0,
    mismatchBytes,
    firstMismatch,
    frameCount: callbackCount,
    fullFrameCount: fullFrames,
    partialFrameCount: partialFrames,
    largestPartialArea: frameTrace.reduce((largest, entry) => entry.full ? largest : Math.max(largest, entry.area), 0),
    fullArea: FULL_AREA,
    outsideRectanglesPreserved,
    frameSequenceContiguous: sequenceContiguous,
    resourceDimensionsStable,
    traceCapacity: TRACE_HEAD + TRACE_TAIL,
    traceStored: frameTrace.length,
    traceTruncated: Math.max(0, callbackCount - frameTrace.length),
    traceDropped: 0,
    traceDigest: traceDigestHex,
    frameTrace,
    presentation: presentationState,
    duplicateCallbacks: false,
    input: {
      clearBytes,
      scrollBytes,
      vtBytes,
      expectedBytes: inputBytes,
      schedulerBytes: scheduler?.inputBytes ?? null,
      schedulerCalls: scheduler?.inputCalls ?? null,
    },
    queueLiveness: {
      retiredInstructions: scheduler?.retiredInstructions ?? null,
      slices: scheduler?.slices ?? null,
      mainThreadYields: scheduler?.mainThreadYields ?? null,
      schedulerYields: scheduler?.schedulerYields ?? null,
    },
    stateDigest: controller.stateDigest?.() ?? null,
    serialSha256: await sha256hex(serialBytes),
    modelRgbaSha256: await sha256hex(modelRgba),
    canvasRgbaSha256: await sha256hex(actualRgba),
    scrollStartedAt,
    scrollFinishedAt,
    paused: controller.isPaused?.() === true,
  };
  finalProof = proof;
  renderProof(proof);
  setStatus("tty0 stress proof ready", "ready");
  document.documentElement.dataset.tty0Stress = "ready";
  document.documentElement.dataset.tty0StressFrames = String(callbackCount);
  document.documentElement.dataset.tty0StressProof = JSON.stringify(proof);
  globalThis.__tty0StressProof = () => finalProof;
}

async function waitForBootBoundary() {
  await waitUntil(() => {
    const markers = markerState();
    return markers.virtioGpu && markers.drm && markers.fbcon && serialText.includes("~ # ");
  }, "Linux fbcon markers and BusyBox prompt");
}

async function runScenario() {
  if (scenarioStarted) return;
  scenarioStarted = true;
  try {
    await waitForBootBoundary();
    if (MANUAL) {
      manualReady = true;
      setStatus("manual stress boundary ready", "ready");
      document.documentElement.dataset.tty0StressManual = "ready";
      return;
    }

    const promptsBeforeClear = (serialText.match(/~ # /gu) || []).length;
    const clear = sendCommand(CLEAR_COMMAND);
    clearBytes = clear.byteLength;
    await waitUntil(() => (serialText.match(/~ # /gu) || []).length > promptsBeforeClear, "clear command prompt", 30_000);

    scrollStartedAt = performance.now();
    const scroll = sendCommand(SCROLL_COMMAND);
    scrollBytes = scroll.byteLength;
    await waitUntil(() => serialText.includes("E5T07D_SCROLL_OK"), "one-million-byte tty0 marker", BOOT_TIMEOUT_MS);
    await waitUntil(() => promptAfterMarker("E5T07D_SCROLL_OK"), "scroll command prompt", 30_000);
    scrollFinishedAt = performance.now();

    const vt = sendCommand(VT_COMMAND);
    vtBytes = vt.byteLength;
    await waitUntil(() => serialText.includes("E5T07D_VT_OK"), "100 VT-switch marker", 60_000);
    await waitUntil(() => promptAfterMarker("E5T07D_VT_OK"), "VT command prompt", 30_000);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    await finishProof();
  } catch (error) {
    displayError = error;
    renderProof({ route: "tty0-stress", error: String(error?.message || error) });
    setStatus(`tty0 stress proof failed: ${error.message || error}`, "error");
    document.documentElement.dataset.tty0Stress = "error";
    document.documentElement.dataset.tty0StressManual = "error";
    globalThis.__tty0StressProof = () => ({ route: "tty0-stress", error: String(error?.message || error) });
  }
}

function onDisplayFrame(frame) {
  if (!presentation || displayError) return false;
  try {
    const rect = {
      x: Number(frame.rect.x),
      y: Number(frame.rect.y),
      width: Number(frame.rect.width),
      height: Number(frame.rect.height),
    };
    const before = sampleOutside(rect);
    updateReference(frame);
    forceQueueDelay();
    const reached = presentation.present(frame);
    const outsidePreserved = outsideSamplesHeld(before, rect);
    const sequence = callbackCount;
    const entry = {
      sequence,
      timestampMs: Math.round(performance.now()),
      rect,
      area: rect.width * rect.height,
      full: rect.width * rect.height === FULL_AREA,
      format: Number(frame.format ?? 1),
      resourceWidth: Number(frame.resourceWidth),
      resourceHeight: Number(frame.resourceHeight),
      reached,
      outsidePreserved,
    };
    callbackCount += 1;
    outsideRectanglesPreserved = outsideRectanglesPreserved && outsidePreserved;
    resourceDimensionsStable = resourceDimensionsStable && entry.resourceWidth === WIDTH && entry.resourceHeight === HEIGHT;
    recordTrace(entry);
    updateLiveState();
    return reached;
  } catch (error) {
    displayError = error;
    setStatus(`display error: ${error.message || error}`, "error");
    return false;
  }
}

if (!canvas) throw new Error("tty0 stress canvas is missing");

try {
  presentation = new PresentationController(canvas, { defaultBackend: "canvas2d" });
  updateLiveState();
  document.documentElement.dataset.tty0StressBackend = "canvas2d";
} catch (error) {
  displayError = error;
  setStatus(`display unavailable: ${error.message || error}`, "error");
  throw error;
}

globalThis.__tty0StressProof = () => finalProof;
globalThis.__tty0StressProgress = progress;
globalThis.__tty0StressPresentation = () => presentation?.snapshot?.() ?? null;

function onOutput(bytes) {
  const decoded = decoder.decode(bytes, { stream: true });
  serialText += decoded;
  for (const marker of Object.values(MARKERS)) {
    if (serialText.includes(marker)) seenMarkers.add(marker);
  }
  if (serialText.length > SERIAL_LIMIT) serialText = serialText.slice(-SERIAL_LIMIT);
  if (serialEl) {
    serialEl.textContent = serialText;
    serialEl.scrollTop = serialEl.scrollHeight;
  }
}

const bootPromise = startLinuxBoot({
  manifestUrl: "./artifacts.json",
  mode: "initramfs",
  ramMib: 256,
  bootargs: "console=tty0 console=ttyS0 earlycon=sbi",
  bootSnapshot: false,
  fastInterpreter: true,
  jit: false,
  quantum: 500_000,
  onState: (state) => setStatus(`linux: ${state}`),
  onProgress: (role, loaded, total) => {
    const progress = total ? ` ${role} ${Math.round((loaded / total) * 100)}%` : ` ${role} ${Math.round(loaded / 1048576)}MB`;
    setStatus(`loading${progress}`);
  },
  onOutput,
  onDisplayFrame,
  onError: (error) => setStatus(`boot error: ${error.message || error}`, "error"),
});

bootPromise.then((value) => {
  controller = value;
  globalThis.__tty0StressController = controller;
  void runScenario();
}, (error) => {
  displayError = error;
  setStatus(`boot failed: ${error.message || error}`, "error");
  document.documentElement.dataset.tty0Stress = "error";
  document.documentElement.dataset.tty0StressManual = "error";
});

addEventListener("beforeunload", () => {
  void controller?.stop?.();
});
