// E5-T07b: focused browser proof for the first real Linux fbcon frame.
// The route deliberately uses the direct loader and a cold initramfs boot: the serial stream stays
// visible beside the production FrameSink canvas, while the verifier owns the browser error capture.

import { startLinuxBoot } from "./loader.js";
import { PresentationController } from "./src/sink/presentation.js";

const query = new URLSearchParams(location.search);
const canvas = document.getElementById("first-light-canvas");
const statusEl = document.getElementById("first-light-status");
const backendEl = document.getElementById("display-backend");
const serialStateEl = document.getElementById("serial-state");
const serialEl = document.getElementById("serial-log");
const proofEl = document.getElementById("proof");
const bootStartedAt = performance.now();
const requestedBackend = query.get("backend") === "webgl2" ? "webgl2" : "canvas2d";
const webgl2Disabled = query.get("disableWebGL2") === "1";

let presentation = null;
let controller = null;
let serialText = "";
let decoder = new TextDecoder();
let frameCount = 0;
let firstFrame = null;
let firstVisibleFrame = null;
let colorSample = null;
let finalProof = null;
let readyScheduled = false;
let displayError = null;
const markerNames = Object.freeze({
  virtioGpu: "virtio_gpu",
  drm: "[drm]",
  fbcon: "fb0: virtio_gpudrmfb",
});

function setStatus(text, state = "booting") {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }
  if (serialStateEl) serialStateEl.textContent = text;
}

function rgbaForWord(value, format = 1) {
  const word = value >>> 0;
  return [
    (word >>> 16) & 0xff,
    (word >>> 8) & 0xff,
    word & 0xff,
    format === 2 ? 0xff : word >>> 24,
  ];
}

function rgbaAt(bytes, index) {
  const offset = index * 4;
  return [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
}

function sameBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scanWords(words, format) {
  let nonZeroWords = 0;
  let nonBlackWords = 0;
  let asymmetricIndex = -1;
  let firstNonZeroIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] >>> 0;
    if (word !== 0) {
      nonZeroWords += 1;
      if (firstNonZeroIndex < 0) firstNonZeroIndex = index;
    }
    if ((word & 0x00ffffff) !== 0) nonBlackWords += 1;
    const [red, green, blue, alpha] = rgbaForWord(word, format);
    if (asymmetricIndex < 0 && alpha !== 0 && (red !== green || green !== blue)) {
      asymmetricIndex = index;
    }
  }
  return { nonZeroWords, nonBlackWords, firstNonZeroIndex, asymmetricIndex };
}

function sampleFrame(words, frame) {
  const format = Number(frame.format ?? 1);
  const scan = scanWords(words, format);
  const index = scan.asymmetricIndex >= 0 ? scan.asymmetricIndex : scan.firstNonZeroIndex;
  const sample = index >= 0
    ? { index, word: words[index] >>> 0, expectedRgba: rgbaForWord(words[index], format) }
    : null;
  return {
    format,
    rect: { ...frame.rect },
    resourceWidth: Number(frame.resourceWidth),
    resourceHeight: Number(frame.resourceHeight),
    nonZeroWords: scan.nonZeroWords,
    nonBlackWords: scan.nonBlackWords,
    asymmetricPixel: scan.asymmetricIndex >= 0,
    sample,
  };
}

function markerState() {
  return Object.fromEntries(Object.entries(markerNames).map(([name, marker]) => [name, serialText.includes(marker)]));
}

function renderProof(proof) {
  if (!proofEl) return;
  proofEl.textContent = JSON.stringify(proof, null, 2);
}

function updateLiveDisplayState() {
  if (!presentation || !backendEl) return;
  const state = presentation.snapshot();
  backendEl.textContent = `${state.backend} · ${state.width}×${state.height} · ${state.successfulPresents} presents`;
  backendEl.dataset.state = state.backend === "canvas2d" ? "ready" : "booting";
}

async function sha256hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function finishFirstLight() {
  if (finalProof || !controller || displayError) return;
  // Stop scheduling the next guest slice while this synchronous readback is made. The current
  // runChunk has already returned, so the latest FrameSink callback is the frame being captured.
  controller.pause();
  const rgba = presentation.readPixels();
  const state = presentation.snapshot();
  const nonBlackPixels = (() => {
    let count = 0;
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index] !== 0 || rgba[index + 1] !== 0 || rgba[index + 2] !== 0 || rgba[index + 3] !== 0) count += 1;
    }
    return count;
  })();
  const sample = colorSample?.sample;
  if (sample) sample.finalRgba = rgbaAt(rgba, sample.index);
  const scheduler = controller.schedulerStats?.() ?? null;
  finalProof = {
    route: "first-light",
    requestedBackend,
    webgl2Disabled,
    selectedBackend: state.backend,
    canvas: { width: state.width, height: state.height },
    frameCount,
    firstFrame,
    firstVisibleFrame,
    colorSample,
    colorChannelOrderHeld: Boolean(sample && sameBytes(sample.expectedRgba, sample.observedRgba)),
    nonBlackPixels,
    canvasRgbaSha256: await sha256hex(rgba),
    presentation: state,
    markers: markerState(),
    serialMarkerLines: serialText.split(/\r?\n/u)
      .filter((line) => Object.values(markerNames).some((marker) => line.includes(marker)))
      .slice(0, 12),
    serialLogSha256: await sha256hex(new TextEncoder().encode(serialText)),
    serialBytes: new TextEncoder().encode(serialText).byteLength,
    bootElapsedMs: Math.round(performance.now() - bootStartedAt),
    scheduler,
    paused: controller.isPaused?.() === true,
  };
  renderProof(finalProof);
  setStatus("fbcon first light ready", "ready");
  document.documentElement.dataset.firstLight = "ready";
  document.documentElement.dataset.firstLightBackend = state.backend;
  document.documentElement.dataset.firstLightFrames = String(frameCount);
  document.documentElement.dataset.firstLightMarkers = JSON.stringify(finalProof.markers);
  document.documentElement.dataset.firstLightProof = JSON.stringify(finalProof);
  globalThis.__firstLightProof = () => finalProof;
}

function maybeFinish() {
  if (readyScheduled || finalProof || !controller || displayError) return;
  const markers = markerState();
  if (!firstVisibleFrame || !markers.virtioGpu || !markers.drm || !markers.fbcon) return;
  readyScheduled = true;
  void finishFirstLight().catch((error) => {
    displayError = error;
    setStatus(`first-light readback failed: ${error.message || error}`, "error");
  });
}

function onDisplayFrame(frame) {
  if (!presentation) return false;
  try {
    const reached = presentation.present(frame);
    frameCount += 1;
    const words = frame.pixels instanceof Uint32Array ? new Uint32Array(frame.pixels) : Uint32Array.from(frame.pixels);
    if (!firstFrame) firstFrame = sampleFrame(words, frame);
    const candidate = sampleFrame(words, frame);
    if (!firstVisibleFrame && candidate.nonBlackWords > 0) firstVisibleFrame = candidate;
    if (!colorSample) {
      if (candidate.sample?.word != null) {
        const actual = presentation.readPixels();
        candidate.sample.observedRgba = rgbaAt(actual, candidate.sample.index);
        colorSample = candidate;
      }
    }
    updateLiveDisplayState();
    maybeFinish();
    return reached;
  } catch (error) {
    displayError = error;
    setStatus(`display error: ${error.message || error}`, "error");
    return false;
  }
}

if (!canvas) throw new Error("first-light canvas is missing");
if (webgl2Disabled) {
  const nativeGetContext = canvas.getContext.bind(canvas);
  canvas.getContext = (kind, attributes) => kind === "webgl2" ? null : nativeGetContext(kind, attributes);
}

try {
  presentation = new PresentationController(canvas, { defaultBackend: requestedBackend });
  updateLiveDisplayState();
  document.documentElement.dataset.firstLightRequestedBackend = requestedBackend;
  document.documentElement.dataset.firstLightWebgl2Disabled = String(webgl2Disabled);
} catch (error) {
  displayError = error;
  setStatus(`display unavailable: ${error.message || error}`, "error");
  throw error;
}

globalThis.__firstLightProof = () => finalProof;
globalThis.__firstLightPresentation = () => presentation?.snapshot?.() ?? null;

const markerText = new Set(Object.values(markerNames));
function onOutput(bytes) {
  serialText += decoder.decode(bytes, { stream: true });
  // Keep the visible diagnostic bounded if a future kernel becomes excessively chatty, while
  // retaining every marker needed by the proof. The cold T05 initramfs is far below this bound.
  if (serialText.length > 500_000) serialText = serialText.slice(-500_000);
  if (serialEl) {
    serialEl.textContent = serialText;
    serialEl.scrollTop = serialEl.scrollHeight;
  }
  if (markerText.size > 0) maybeFinish();
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
  globalThis.__firstLightController = controller;
  maybeFinish();
}, (error) => {
  displayError = error;
  setStatus(`boot failed: ${error.message || error}`, "error");
});

addEventListener("beforeunload", () => {
  void controller?.stop?.();
});
