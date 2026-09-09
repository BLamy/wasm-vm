// E5-T08: the focused host-chrome surface. It keeps the real fbcon canvas and xterm serial
// terminal alive at the same time, while tabs only change visibility. The verifier can therefore
// hide either face during a cold boot, a large tty0 scroll, a screenshot, and a bounded recording.

import { startLinuxBoot } from "./loader.js";
import { createLinuxTerminal } from "./terminal.js";
import { PresentationController } from "./src/sink/presentation.js";
import { createCanvasRecorder, createHostViewController } from "./src/host/console-capture.js";
import { createKeyboardBridge, createWasmKeyboardAdapter } from "./src/input/keyboard.js";
import { attachKeyboardCapture, createKeyboardCapturePolicy } from "./src/input/capture.js";
import { attachHeldKeyLifecycle } from "./src/input/held-keys.js";
import { createKeyboardReconciler } from "./src/input/reconciliation.js";

const WIDTH = 1280;
const HEIGHT = 800;
const FULL_BYTES = WIDTH * HEIGHT * 4;
const BOOT_TIMEOUT_MS = 450_000;
const RECORDING_MAX_MS = 10_000;
const HIDDEN_FLUSH_COMMAND =
  "printf 'E5T08_HIDDEN_FRAME\\n' > /dev/tty0; echo E5T08_HIDDEN_DONE\\n";
const SCROLL_COMMAND =
  "dd if=/dev/zero bs=1000000 count=1 of=/dev/tty0; printf 'E5T08_SCROLL_OK\\n' > /dev/tty0; " +
  "echo E5T08_SCROLL_DONE\\n";
const PROMPT = "~ # ";

const root = document.getElementById("console-capture-root");
const canvas = document.getElementById("console-capture-canvas");
const displayPanel = document.getElementById("console-display-panel");
const serialPanel = document.getElementById("console-serial-panel");
const displayButton = document.getElementById("console-view-display");
const serialButton = document.getElementById("console-view-serial");
const ownerEl = document.getElementById("console-keyboard-owner");
const statusEl = document.getElementById("console-capture-status");
const viewMetricsEl = document.getElementById("console-view-metrics");
const displayBackendEl = document.getElementById("console-display-backend");
const serialStateEl = document.getElementById("console-serial-state");
const screenshotButton = document.getElementById("console-screenshot");
const recordButton = document.getElementById("console-record");
const captureStateEl = document.getElementById("console-capture-state");
const proofEl = document.getElementById("console-capture-proof");
const serialHost = document.getElementById("serial-terminal");

if (!root || !canvas || !displayPanel || !serialPanel || !serialHost) {
  throw new Error("console-capture route is missing its host surface");
}

const query = new URLSearchParams(location.search);
const proofMode = query.get("proof") === "1";
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const serialUi = createLinuxTerminal(serialHost);

let presentation = null;
let controller = null;
let serialText = "";
let serialBytes = 0;
let frameCount = 0;
let framesWhileSerialHidden = 0;
let serialHiddenStarted = null;
let serialHiddenEnded = null;
let firstFrameAt = null;
let finalProof = null;
let lastScreenshot = null;
let lastRecording = null;
let screenshotPromise = Promise.resolve(null);
let recordingCompletePromise = Promise.resolve(null);
let resolveRecordingComplete = null;
let recordingFrameStart = null;
let recordingView = null;
let reservedToggleCount = 0;
let keyboardBridge = null;
let keyboardReconciler = null;
let keyboardForwarded = [];
let keyboardDiagnostics = [];
let displayError = null;
let proofStarted = false;

function setStatus(text, state = "booting") {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }
  if (serialStateEl) serialStateEl.textContent = text;
}

function updateMetrics() {
  if (viewMetricsEl) viewMetricsEl.textContent = `flushes: ${frameCount} · serial: ${serialBytes.toLocaleString()} B`;
  if (presentation && displayBackendEl) {
    const state = presentation.snapshot();
    displayBackendEl.textContent = `${state.backend} · ${state.width}×${state.height} · ${state.successfulPresents} presents`;
    displayBackendEl.dataset.state = state.backend === "canvas2d" ? "ready" : "booting";
  }
}

function renderProof(proof) {
  if (proofEl) proofEl.textContent = JSON.stringify(proof, null, 2);
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

async function sha256hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readCanvasPixels() {
  const context = canvas.getContext("2d");
  if (!context || typeof context.getImageData !== "function") throw new Error("Canvas2D readback unavailable");
  return new Uint8ClampedArray(context.getImageData(0, 0, WIDTH, HEIGHT).data);
}

async function decodePng(blob) {
  const url = URL.createObjectURL(blob);
  let bitmap = null;
  const decoded = document.createElement("canvas");
  decoded.width = WIDTH;
  decoded.height = HEIGHT;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
      const context = decoded.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return new Uint8ClampedArray(context.getImageData(0, 0, WIDTH, HEIGHT).data);
    }
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("PNG readback image failed to load"));
      image.src = url;
    });
    const context = decoded.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return new Uint8ClampedArray(context.getImageData(0, 0, WIDTH, HEIGHT).data);
  } finally {
    bitmap?.close?.();
    URL.revokeObjectURL(url);
  }
}

async function canvasToBlob() {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("canvas.toBlob returned no PNG")), "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function captureScreenshot({ download = true } = {}) {
  if (!presentation || !controller) throw new Error("guest display is not ready");
  const wasPaused = controller.isPaused?.() === true;
  controller.pause?.();
  const generation = frameCount;
  try {
    const readback = readCanvasPixels();
    const blob = await canvasToBlob();
    const decoded = await decodePng(blob);
    let mismatchBytes = 0;
    for (let index = 0; index < readback.length; index += 1) {
      if (readback[index] !== decoded[index]) mismatchBytes += 1;
    }
    const filename = `wasm-vm-display-${Date.now()}.png`;
    if (download) downloadBlob(blob, filename);
    lastScreenshot = {
      generation,
      width: WIDTH,
      height: HEIGHT,
      blobSize: blob.size,
      filename,
      readbackSha256: await sha256hex(readback),
      decodedPngSha256: await sha256hex(decoded),
      mismatchBytes,
      pixelIdentical: mismatchBytes === 0 && sameBytes(readback, decoded),
    };
    captureStateEl.textContent = `PNG ready · ${blob.size.toLocaleString()} B · flush ${generation}`;
    captureStateEl.dataset.state = lastScreenshot.pixelIdentical ? "ready" : "error";
    return lastScreenshot;
  } finally {
    if (!wasPaused) controller.resume?.();
  }
}

async function inspectRecording(result) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.hidden = true;
  document.body.appendChild(video);
  const url = URL.createObjectURL(result.blob);
  let metadataLoaded = false;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("recorded WebM metadata timed out")), 5_000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        metadataLoaded = true;
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("recorded WebM failed video decoding"));
      };
      video.src = url;
      video.load();
    });
    await video.play().catch(() => {});
    const playable = metadataLoaded && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    video.pause();
    return {
      playable,
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    video.remove();
  }
}

function updateRecordingUi(state) {
  if (!recordButton || !captureStateEl) return;
  if (state === "recording") {
    recordButton.textContent = "Stop recording";
    recordButton.classList.add("recording");
    recordButton.setAttribute("aria-pressed", "true");
    captureStateEl.textContent = "recording · 10 s cap";
    captureStateEl.dataset.state = "recording";
  } else if (state === "error") {
    recordButton.textContent = "Record 10 s";
    recordButton.classList.remove("recording");
    recordButton.setAttribute("aria-pressed", "false");
    captureStateEl.dataset.state = "error";
  } else if (!lastRecording) {
    recordButton.textContent = "Record 10 s";
    recordButton.classList.remove("recording");
    recordButton.setAttribute("aria-pressed", "false");
    captureStateEl.textContent = "recorder idle";
    captureStateEl.dataset.state = "idle";
  }
}

let recorder = null;
try {
  presentation = new PresentationController(canvas, { defaultBackend: "canvas2d", width: WIDTH, height: HEIGHT });
  recorder = createCanvasRecorder(canvas, {
    frameRate: 30,
    maxDurationMs: RECORDING_MAX_MS,
    onStateChange: (change) => {
      if (change.state === "recording") {
        updateRecordingUi("recording");
        return;
      }
      if (change.state === "error") {
        updateRecordingUi("error");
        setStatus(`recording error: ${change.error}`, "error");
        return;
      }
      if (change.state === "idle" && change.result) {
        const frameEnd = frameCount;
        const frameStart = recordingFrameStart ?? frameEnd;
        const view = recordingView ?? "display";
        void inspectRecording(change.result).then((playback) => {
          lastRecording = {
            blobSize: change.result.blobSize,
            mimeType: change.result.mimeType,
            frameRate: change.result.frameRate,
            maxDurationMs: change.result.maxDurationMs,
            startedAt: change.result.startedAt,
            stoppedAt: change.result.stoppedAt,
            durationMs: change.result.durationMs,
            stopReason: change.result.stopReason,
            framesDuringRecording: Math.max(0, frameEnd - frameStart),
            startedInView: view,
            playback,
          };
          lastRecording._blob = change.result.blob;
          updateRecordingUi("idle");
          captureStateEl.textContent = `WebM ready · ${change.result.blobSize.toLocaleString()} B · ${Math.round(change.result.durationMs)} ms`;
          captureStateEl.dataset.state = playback.playable ? "ready" : "error";
          resolveRecordingComplete?.(lastRecording);
          resolveRecordingComplete = null;
        }).catch((error) => {
          setStatus(`recording playback failed: ${error.message || error}`, "error");
          captureStateEl.textContent = `WebM playback failed: ${error.message || error}`;
          captureStateEl.dataset.state = "error";
          resolveRecordingComplete?.(null);
          resolveRecordingComplete = null;
        });
      }
    },
  });
  updateMetrics();
  screenshotButton.disabled = false;
  recordButton.disabled = false;
} catch (error) {
  displayError = error;
  setStatus(`display unavailable: ${error.message || error}`, "error");
  throw error;
}

function startRecording() {
  if (!recorder || recorder.isRecording()) return recorder?.snapshot?.() ?? null;
  recordingFrameStart = frameCount;
  recordingView = viewController.activeView();
  recordingCompletePromise = new Promise((resolve) => { resolveRecordingComplete = resolve; });
  try {
    return recorder.start();
  } catch (error) {
    resolveRecordingComplete?.(null);
    resolveRecordingComplete = null;
    recordingCompletePromise = Promise.resolve(null);
    throw error;
  }
}

async function stopRecording(reason = "manual") {
  if (!recorder?.isRecording()) return lastRecording;
  await recorder.stop(reason);
  return recordingCompletePromise;
}

function setView(view, reason = "api") {
  const next = viewController.show(view, reason);
  if (next.activeView === "serial") {
    serialUi.fitNow();
    serialUi.focus();
  } else {
    canvas.focus?.();
  }
  return next;
}

const viewController = createHostViewController({
  displayPanel,
  serialPanel,
  displayButton,
  serialButton,
  ownerElement: ownerEl,
  initialView: "display",
  onViewChange: (change) => {
    if (change.activeView === "serial") {
      if (serialHiddenStarted === null) serialHiddenStarted = frameCount;
    } else if (serialHiddenStarted !== null) {
      serialHiddenEnded = frameCount;
    }
    if (change.reason === "proof-boot-toggle" || change.reason === "proof-recording") {
      // The specific proof windows are captured below; this branch only makes the owner indicator
      // update observable before the next guest callback.
      updateMetrics();
    }
  },
});

const keyboardCapture = createKeyboardCapturePolicy({
  initialCaptured: true,
  preserveDefault: (event) => event?.target?.classList?.contains("xterm-helper-textarea") && (
    event?.code === "Space" || /^[A-Za-z]$/.test(event?.key || "")
  ),
  onGuestEvent: (event) => {
    if (!keyboardReconciler) return { forwarded: false, code: event?.code || "", reason: "guest-not-ready" };
    const result = keyboardReconciler.handleKeyEvent(event);
    if (result?.forwarded) keyboardForwarded.push({ type: event.type, code: event.code });
    return result;
  },
  onReserved: (event) => {
    reservedToggleCount += 1;
    viewController.toggle("reserved-hotkey");
    window.dispatchEvent(new CustomEvent("wvm:reserved-view-toggle", {
      detail: { code: event?.code || "Backquote" },
    }));
  },
  onDiagnostic: (entry) => {
    keyboardDiagnostics.push(entry);
    if (keyboardDiagnostics.length > 128) keyboardDiagnostics.shift();
  },
  onStateChange: (captured) => {
    document.documentElement.dataset.keyboardCapture = captured ? "on" : "off";
  },
});
const detachKeyboardCapture = attachKeyboardCapture(root, keyboardCapture, { capture: true });
const detachKeyboardLifecycle = attachHeldKeyLifecycle({
  releaseAll: () => keyboardBridge?.releaseAll?.(),
});

function onDisplayFrame(frame) {
  if (!presentation || displayError) return false;
  try {
    const reached = presentation.present(frame);
    frameCount += 1;
    if (viewController.activeView() === "serial") framesWhileSerialHidden += 1;
    if (firstFrameAt === null) firstFrameAt = performance.now();
    updateMetrics();
    return reached;
  } catch (error) {
    displayError = error;
    setStatus(`display error: ${error.message || error}`, "error");
    return false;
  }
}

function onOutput(bytes) {
  const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  serialBytes += chunk.byteLength;
  serialText += decoder.decode(chunk, { stream: true });
  if (serialText.length > 750_000) serialText = serialText.slice(-750_000);
  serialUi.write(chunk);
  updateMetrics();
}

function sendCommand(command) {
  serialUi.typeBytes(encoder.encode(command));
}

function proofKeyEvent(type, code, extra = {}) {
  root.dispatchEvent(new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code,
    key: code === "Backquote" ? "`" : code.replace(/^(Control|Alt)/u, ""),
    ...extra,
  }));
}

function capturePolicyProof() {
  const before = reservedToggleCount;
  const priorView = viewController.activeView();
  keyboardForwarded = [];
  proofKeyEvent("keydown", "ControlLeft", { key: "Control" });
  proofKeyEvent("keydown", "AltLeft", { key: "Alt", ctrlKey: true });
  proofKeyEvent("keydown", "Backquote", { ctrlKey: true, altKey: true });
  proofKeyEvent("keyup", "Backquote", { ctrlKey: true, altKey: true });
  proofKeyEvent("keyup", "AltLeft", { ctrlKey: true });
  proofKeyEvent("keyup", "ControlLeft");
  return {
    priorView,
    afterView: viewController.activeView(),
    reservedToggleCount: reservedToggleCount - before,
    forwardedCodes: keyboardForwarded.map((event) => event.code),
    reservedCodesAfter: keyboardCapture.reservedCodes(),
  };
}

function publicProof() {
  return finalProof;
}

try {
  window.__consoleCapture = {
    view: () => viewController.snapshot(),
    showView: (view) => setView(view, "api"),
    toggleView: () => viewController.toggle("api"),
    screenshot: (options) => { screenshotPromise = captureScreenshot(options); return screenshotPromise; },
    startRecording,
    stopRecording,
    recording: () => ({
      ...(recorder?.snapshot?.() ?? {}),
      last: lastRecording ? { ...lastRecording, _blob: undefined } : null,
    }),
    serial: () => ({ bytes: serialBytes, text: serialText }),
    keyboard: () => ({
      captured: keyboardCapture.isCaptured(),
      forwarded: [...keyboardForwarded],
      diagnostics: [...keyboardDiagnostics],
      reservedToggleCount,
      reservedCodes: keyboardCapture.reservedCodes(),
    }),
    proof: publicProof,
  };
  window.__consoleCaptureProof = publicProof;
} catch { /* page-only hooks are optional */ }

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
    const progress = total ? `${role} ${Math.round((loaded / total) * 100)}%` : `${role} ${Math.round(loaded / 1048576)} MB`;
    setStatus(`loading · ${progress}`);
  },
  onOutput,
  onDisplayFrame,
  onError: (error) => setStatus(`boot error: ${error.message || error}`, "error"),
});

bootPromise.then((value) => {
  controller = value;
  window.__consoleCaptureController = controller;
  keyboardBridge = createKeyboardBridge(createWasmKeyboardAdapter(controller));
  keyboardReconciler = createKeyboardReconciler(keyboardBridge);
  serialUi.attachSink((bytes) => {
    try { controller.sendInput(bytes); } catch (error) { setStatus(`serial input error: ${error.message || error}`, "error"); }
  });
  serialUi.fitNow();
  serialUi.focus();
  screenshotButton.disabled = false;
  recordButton.disabled = !recorder;
  document.documentElement.dataset.consoleCaptureBackend = presentation.backendName;
  document.documentElement.dataset.consoleCaptureController = "ready";
  setStatus("Linux guest ready · display live", "ready");
  void runProofScenario();
}, (error) => {
  displayError = error;
  setStatus(`boot failed: ${error.message || error}`, "error");
  renderProof({ route: "console-capture", error: String(error?.message || error) });
  document.documentElement.dataset.consoleCapture = "error";
});

screenshotButton.addEventListener("click", () => {
  screenshotPromise = captureScreenshot().catch((error) => {
    setStatus(`screenshot failed: ${error.message || error}`, "error");
    captureStateEl.textContent = `PNG failed: ${error.message || error}`;
    captureStateEl.dataset.state = "error";
    return null;
  });
});

recordButton.addEventListener("click", () => {
  if (recorder?.isRecording()) {
    void stopRecording("manual");
    return;
  }
  try {
    startRecording();
  } catch (error) {
    setStatus(`recording unavailable: ${error.message || error}`, "error");
    captureStateEl.textContent = `WebM unavailable: ${error.message || error}`;
    captureStateEl.dataset.state = "error";
  }
});

async function runProofScenario() {
  if (!proofMode || proofStarted || !controller) return;
  proofStarted = true;
  try {
    await waitUntil(() => frameCount >= 8, "initial display frames", BOOT_TIMEOUT_MS);
    const bootBefore = { frameCount, serialBytes, view: viewController.activeView() };
    setView("serial", "proof-boot-toggle");
    await waitUntil(() => serialText.includes(PROMPT), "BusyBox prompt while display is hidden", BOOT_TIMEOUT_MS);
    sendCommand(HIDDEN_FLUSH_COMMAND);
    await waitUntil(() => serialText.includes("E5T08_HIDDEN_DONE"), "hidden display flush completion", 30_000);
    await waitUntil(() => frameCount > bootBefore.frameCount, "frame while display is hidden", 30_000);
    const bootAfter = { frameCount, serialBytes, view: viewController.activeView() };
    setView("display", "proof-boot-return");

    await waitUntil(() => serialText.includes(PROMPT), "BusyBox prompt", BOOT_TIMEOUT_MS);
    document.getElementById("console-screenshot").click();
    await waitUntil(() => lastScreenshot !== null, "PNG screenshot proof", 15_000);
    await screenshotPromise;

    setView("serial", "proof-recording");
    document.getElementById("console-record").click();
    await waitUntil(() => recorder?.isRecording?.() === true, "MediaRecorder start", 5_000);
    sendCommand(SCROLL_COMMAND);
    await waitUntil(() => serialText.includes("E5T08_SCROLL_DONE"), "tty0 scroll completion", 120_000);
    await waitUntil(() => lastRecording !== null && recorder?.isRecording?.() === false, "10 second WebM recording", 20_000);
    setView("display", "proof-recording-return");

    const listenerCountBefore = viewController.snapshot().listenerCount;
    const transitionsBefore = viewController.snapshot().transitions;
    for (let index = 0; index < 25; index += 1) {
      serialButton.click();
      displayButton.click();
    }
    const rapid = viewController.snapshot();
    const reserved = capturePolicyProof();
    setView("display", "proof-final-display");

    const scheduler = controller.schedulerStats?.() ?? null;
    const recording = lastRecording ? { ...lastRecording, _blob: undefined } : null;
    finalProof = {
      route: "console-capture",
      backend: presentation.backendName,
      canvas: { width: WIDTH, height: HEIGHT },
      view: {
        bootBefore,
        bootAfter,
        framesWhileSerialHidden,
        framesDuringHiddenWindow: Math.max(0, bootAfter.frameCount - bootBefore.frameCount),
        serialBytesDuringHiddenWindow: Math.max(0, bootAfter.serialBytes - bootBefore.serialBytes),
        hiddenFlushMarkerObserved: serialText.includes("E5T08_HIDDEN_DONE"),
        activeAtEnd: viewController.activeView(),
      },
      reservedHotkey: reserved,
      screenshot: lastScreenshot,
      recording,
      serial: {
        bytes: serialBytes,
        sha256: await sha256hex(encoder.encode(serialText)),
        scrollCommandObserved: serialText.includes(SCROLL_COMMAND.trimEnd()),
        scrollMarkerObserved: serialText.includes("E5T08_SCROLL_DONE"),
        promptObserved: serialText.includes(PROMPT),
      },
      rapidToggles: {
        requested: 50,
        transitionsAdded: rapid.transitions - transitionsBefore,
        listenerCountBefore,
        listenerCountAfter: rapid.listenerCount,
        displayHiddenAtEnd: rapid.displayHidden,
        serialHiddenAtEnd: rapid.serialHidden,
      },
      presentation: presentation.snapshot(),
      scheduler,
      firstFrameAt,
      paused: controller.isPaused?.() === true,
      fullSurfaceBytes: FULL_BYTES,
    };
    renderProof(finalProof);
    setStatus("host chrome proof ready", "ready");
    document.documentElement.dataset.consoleCapture = "ready";
    document.documentElement.dataset.consoleCaptureFrames = String(frameCount);
    document.documentElement.dataset.consoleCaptureProof = JSON.stringify(finalProof);
  } catch (error) {
    displayError = error;
    renderProof({ route: "console-capture", error: String(error?.message || error) });
    setStatus(`host chrome proof failed: ${error.message || error}`, "error");
    document.documentElement.dataset.consoleCapture = "error";
    document.documentElement.dataset.consoleCaptureProof = JSON.stringify({
      route: "console-capture",
      error: String(error?.message || error),
    });
  }
}

addEventListener("beforeunload", () => {
  detachKeyboardCapture?.();
  detachKeyboardLifecycle?.();
  recorder?.dispose?.();
  presentation?.dispose?.();
  void controller?.stop?.();
});
