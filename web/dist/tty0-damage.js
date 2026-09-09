// E5-T07c: Chromium-only tty0/fbcon damage proof.  The page keeps an independent RGBA reference
// buffer, samples pixels outside every partial rectangle, and drives one deterministic BusyBox
// command through the serial input seam.

import { startLinuxBoot } from "./loader.js";
import { PresentationController } from "./src/sink/presentation.js";

const WIDTH = 1280;
const HEIGHT = 800;
const FULL_AREA = WIDTH * HEIGHT;
const MAX_TRACE = 512;
const BOOT_TIMEOUT_MS = 450_000;
const TARGET_SETTLE_MS = 2_500;
const CLEAR_COMMAND = "printf '\\033[2J\\033[H' > /dev/tty0\n";
const TARGET_COMMAND = "echo hello > /dev/tty0\n";
const MARKERS = Object.freeze({
  virtioGpu: "virtio_gpu",
  drm: "[drm]",
  fbcon: "fb0: virtio_gpudrmfb",
});
const HELLO_RECT = Object.freeze({ x: 0, y: 0, width: 40, height: 16 });

const canvas = document.getElementById("tty0-damage-canvas");
const statusEl = document.getElementById("tty0-damage-status");
const backendEl = document.getElementById("display-backend");
const serialStateEl = document.getElementById("serial-state");
const serialEl = document.getElementById("serial-log");
const proofEl = document.getElementById("proof");

let presentation = null;
let controller = null;
let serialText = "";
let decoder = new TextDecoder();
let modelRgba = new Uint8Array(WIDTH * HEIGHT * 4);
let callbackCount = 0;
let traceDropped = 0;
let frameTrace = [];
let commandStartedAt = null;
let commandFinishedAt = null;
let clearBytes = 0;
let targetBytes = 0;
let targetSerialStart = 0;
let finalProof = null;
let displayError = null;
let scenarioStarted = false;

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
  const candidates = [
    [0, 0], [WIDTH - 1, 0], [0, HEIGHT - 1], [WIDTH - 1, HEIGHT - 1],
    [Math.floor(WIDTH / 2), Math.floor(HEIGHT / 2)], [WIDTH - 2, Math.floor(HEIGHT / 2)],
  ];
  const seen = new Set();
  const samples = [];
  for (const [x, y] of candidates) {
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
      const rgba = rgbaForWord(pixels[sourceIndex], format);
      const targetOffset = sourceIndex * 4;
      modelRgba.set(rgba, targetOffset);
    }
  }
}

function markerState() {
  return Object.fromEntries(Object.entries(MARKERS).map(([name, marker]) => [name, serialText.includes(marker)]));
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

function regionStats(bytes, rect) {
  let nonBlackPixels = 0;
  let opaquePixels = 0;
  let brightPixels = 0;
  const colors = new Set();
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const rgba = rgbaAt(bytes, x, y);
      if (rgba[0] !== 0 || rgba[1] !== 0 || rgba[2] !== 0) {
        nonBlackPixels += 1;
        colors.add(rgba.slice(0, 3).join(","));
        if (Math.max(rgba[0], rgba[1], rgba[2]) >= 0x80) brightPixels += 1;
      }
      if (rgba[3] === 0xff) opaquePixels += 1;
    }
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

function promptAfter(command, start) {
  const commandIndex = serialText.indexOf(command, start);
  return commandIndex >= 0 && serialText.indexOf("~ # ", commandIndex + command.length) >= 0;
}

async function finishProof() {
  if (finalProof || !controller || displayError) return;
  controller.pause?.();
  const actualRgba = presentation.readPixels();
  const presentationState = presentation.snapshot();
  const helloModel = regionStats(modelRgba, HELLO_RECT);
  const helloActual = regionStats(actualRgba, HELLO_RECT);
  let mismatchBytes = 0;
  let firstMismatch = -1;
  for (let index = 0; index < modelRgba.length; index += 1) {
    if (modelRgba[index] !== actualRgba[index]) {
      mismatchBytes += 1;
      if (firstMismatch < 0) firstMismatch = index;
    }
  }
  const fullFrames = frameTrace.filter((entry) => entry.full).length;
  const partialFrames = frameTrace.filter((entry) => !entry.full).length;
  const postTarget = frameTrace.filter((entry) => entry.afterTarget);
  const postTargetPartials = postTarget.filter((entry) => !entry.full);
  const sequenceContiguous = frameTrace.every((entry, index) => entry.sequence === index);
  const dimensionsStable = frameTrace.every((entry) => entry.resourceWidth === WIDTH && entry.resourceHeight === HEIGHT);
  const scheduler = controller.schedulerStats?.() ?? null;
  const inputBytes = clearBytes + targetBytes;
  const serialBytes = new TextEncoder().encode(serialText);
  const proof = {
    route: "tty0-damage",
    backend: presentationState.backend,
    canvas: { width: WIDTH, height: HEIGHT },
    markers: markerState(),
    clearCommand: CLEAR_COMMAND.trimEnd(),
    targetCommand: TARGET_COMMAND.trimEnd(),
    targetCommandObserved: serialText.includes(TARGET_COMMAND.trimEnd()),
    promptAfterTarget: promptAfter(TARGET_COMMAND.trimEnd(), targetSerialStart),
    serialTail: serialText.slice(-2_000),
    helloRect: HELLO_RECT,
    helloModel,
    helloActual,
    referenceMatchesCanvas: mismatchBytes === 0,
    mismatchBytes,
    firstMismatch,
    frameCount: callbackCount,
    fullFrameCount: fullFrames,
    partialFrameCount: partialFrames,
    postTargetFrameCount: postTarget.length,
    postTargetPartialFrameCount: postTargetPartials.length,
    largestPartialArea: frameTrace.reduce((largest, entry) => entry.full ? largest : Math.max(largest, entry.area), 0),
    fullArea: FULL_AREA,
    outsideRectanglesPreserved: frameTrace.every((entry) => entry.outsidePreserved),
    frameSequenceContiguous: sequenceContiguous,
    resourceDimensionsStable: dimensionsStable,
    traceCapacity: MAX_TRACE,
    traceDropped,
    frameTrace,
    presentation: presentationState,
    duplicateCallbacks: callbackCount !== new Set(frameTrace.map((entry) => entry.sequence)).size,
    input: {
      clearBytes,
      targetBytes,
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
    commandStartedAt,
    commandFinishedAt,
    paused: controller.isPaused?.() === true,
  };
  finalProof = proof;
  renderProof(proof);
  setStatus("tty0 damage proof ready", "ready");
  document.documentElement.dataset.tty0Damage = "ready";
  document.documentElement.dataset.tty0DamageFrames = String(callbackCount);
  document.documentElement.dataset.tty0DamageProof = JSON.stringify(proof);
  globalThis.__tty0DamageProof = () => finalProof;
}

async function runScenario() {
  if (scenarioStarted) return;
  scenarioStarted = true;
  try {
    await waitUntil(() => {
      const markers = markerState();
      return markers.virtioGpu && markers.drm && markers.fbcon && serialText.includes("~ # ");
    }, "Linux fbcon markers and BusyBox prompt");

    const clearStart = serialText.length;
    const clear = sendCommand(CLEAR_COMMAND);
    clearBytes = clear.byteLength;
    await waitUntil(() => promptAfter(CLEAR_COMMAND.trimEnd(), clearStart), "clear command prompt");

    const targetStart = serialText.length;
    targetSerialStart = targetStart;
    const target = new TextEncoder().encode(TARGET_COMMAND);
    targetBytes = target.byteLength;
    commandStartedAt = performance.now();
    sendCommand(TARGET_COMMAND);
    await waitUntil(() => promptAfter(TARGET_COMMAND.trimEnd(), targetStart), "tty0 command prompt");
    commandFinishedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, TARGET_SETTLE_MS));
    await finishProof();
  } catch (error) {
    displayError = error;
    renderProof({ route: "tty0-damage", error: String(error?.message || error) });
    setStatus(`tty0 damage proof failed: ${error.message || error}`, "error");
    document.documentElement.dataset.tty0Damage = "error";
    globalThis.__tty0DamageProof = () => ({ route: "tty0-damage", error: String(error?.message || error) });
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
    const reached = presentation.present(frame);
    const outsidePreserved = outsideSamplesHeld(before, rect);
    const sequence = callbackCount;
    callbackCount += 1;
    if (frameTrace.length < MAX_TRACE) {
      const afterTarget = commandStartedAt !== null && performance.now() >= commandStartedAt;
      frameTrace.push({
        sequence,
        timestampMs: Math.round(performance.now()),
        afterTarget,
        rect,
        area: rect.width * rect.height,
        full: rect.width * rect.height === FULL_AREA,
        format: Number(frame.format ?? 1),
        resourceWidth: Number(frame.resourceWidth),
        resourceHeight: Number(frame.resourceHeight),
        reached,
        outsidePreserved,
      });
    } else {
      traceDropped += 1;
    }
    updateLiveState();
    return reached;
  } catch (error) {
    displayError = error;
    setStatus(`display error: ${error.message || error}`, "error");
    return false;
  }
}

if (!canvas) throw new Error("tty0 damage canvas is missing");

try {
  presentation = new PresentationController(canvas, { defaultBackend: "canvas2d" });
  updateLiveState();
  document.documentElement.dataset.tty0DamageBackend = "canvas2d";
} catch (error) {
  displayError = error;
  setStatus(`display unavailable: ${error.message || error}`, "error");
  throw error;
}

globalThis.__tty0DamageProof = () => finalProof;
globalThis.__tty0DamagePresentation = () => presentation?.snapshot?.() ?? null;

function onOutput(bytes) {
  serialText += decoder.decode(bytes, { stream: true });
  if (serialText.length > 500_000) serialText = serialText.slice(-500_000);
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
  globalThis.__tty0DamageController = controller;
  void runScenario();
}, (error) => {
  displayError = error;
  setStatus(`boot failed: ${error.message || error}`, "error");
  document.documentElement.dataset.tty0Damage = "error";
});

addEventListener("beforeunload", () => {
  void controller?.stop?.();
});
