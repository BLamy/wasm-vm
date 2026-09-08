// E5-T18b: local Chromium proof for the Weston Terminal launcher and T12 keyboard path.
// The route is intentionally separate from E5-T18a's cold-load-only page: it adds the real
// tablet pointer bridge, physical-code keyboard capture, and a bounded interactive proof while
// retaining the same T17 guest image and Canvas2D presentation boundary.

import { startLinuxBootWorker } from "./linux-worker-host.js";
import { PresentationController } from "./src/sink/presentation.js";
import { createPointerBridge, createWasmPointerAdapter, attachPointerBridge } from "./src/input/pointer.js";
import { createKeyboardBridge, createWasmKeyboardAdapter } from "./src/input/keyboard.js";
import { attachKeyboardCapture, createKeyboardCapturePolicy } from "./src/input/capture.js";
import { createKeyboardReconciler } from "./src/input/reconciliation.js";
import { AudioSink } from "./src/audio/sink.js";
import { CHANNELS, HEADER_BYTES } from "./src/audio/ring.js";
import { createAutoplayPolicy } from "./src/audio/autoplay.js";
import { createDesktopAgentBridge } from "./desktop-agent-bridge.js";
import { restoreDesktopThroughHost } from "./desktop-restore.js";

const WIDTH = 1280;
const HEIGHT = 800;
const MAX_SERIAL_BYTES = 750_000;
const MIN_VISUAL_DIFF = 2_000;
const MIN_TERMINAL_MARKER_PIXELS = 24;
const MIN_TERMINAL_DARK_RATIO = 0.12;
const FALLBACK_IMAGE_SHA256 = "467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e";
const FALLBACK_CHUNK_MANIFEST_SHA256 = "1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827";

const query = new URLSearchParams(location.search);
const desktopPerfHooksRequested = query.has("testHooks") && query.has("perfHooks");
const desktopLatencyHooksRequested = desktopPerfHooksRequested && query.has("latencyHooks");
const root = document.getElementById("desktop-terminal-root");
const canvas = document.getElementById("desktop-canvas");
const statusEl = document.getElementById("desktop-status");
const proofEl = document.getElementById("terminal-proof");
const readyEl = document.getElementById("desktop-ready");
const launchEl = document.getElementById("terminal-launch");
const focusEl = document.getElementById("terminal-focus");
const commandEl = document.getElementById("terminal-command");
const repeatEl = document.getElementById("terminal-repeat");
const bootStartedAt = performance.now();
const decoder = new TextDecoder();
const encoder = new TextEncoder();

let presentation = null;
let controller = null;
let pointerBridge = null;
let detachPointer = null;
let keyboardBridge = null;
let keyboardReconciler = null;
let keyboardCapture = null;
let detachKeyboard = null;
let desktopAudioSink = null;
let desktopAudioPolicy = null;
let desktopAgentBridge = null;
const pendingAgentOutput = [];
let restoreObservation = null;
let lastRestoreResult = null;
let serialText = "";
let frameCount = 0;
let lastInspectionAt = 0;
let latestPixels = null;
let latestInspection = null;
let latestSurface = { nonBlackRatio: 0, darkRatio: 0, greenPixels: 0, redPixels: 0 };
let desktopReady = false;
let readinessStarted = false;
let autoRestoreInFlight = false;
let autoRestorePromise = null;
let finalProof = null;
let displayError = null;
let latestError = null;
let lastObservedFrame = 0;
let desktopPerfGuestInstructions = null;
let desktopPerfStatsTimer = null;
let desktopPerfInput = null;
let desktopPerfPresentDelayMs = 0;
let desktopPerfCalibrationPixels = null;

const pointerFrames = [];
const keyboardFrames = [];
const keyboardEvents = [];
const desktopPerfPresentRecords = [];
const desktopPerfPresentDurations = [];
const diagnostics = [];
const bootStates = [];
const MAX_DIAGNOSTICS = 64;
const interactions = {
  launches: [],
  focuses: [],
  commands: [],
  closes: [],
};

function recordDiagnostic(entry) {
  diagnostics.push({ atMs: Math.round(performance.now() - bootStartedAt), ...entry });
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
}

// E5-T26f: prepare the real page-owned audio sink before the guest is assembled. The AudioContext
// remains locked until the first user gesture; the SharedArrayBuffer is safe to transfer to the
// whole-machine worker while the autoplay policy owns the unlock boundary.
try {
  if (typeof globalThis.AudioContext === "function") {
    desktopAudioSink = new AudioSink({ requestedSampleRateHz: 48_000 });
    desktopAudioPolicy = createAutoplayPolicy({
      context: desktopAudioSink.context,
      ring: desktopAudioSink.ring,
      sampleRateHz: desktopAudioSink.sampleRateHz,
      clockBuffer: desktopAudioSink.clockBuffer,
      target: document,
      onUnlocked: () => desktopAudioSink.connect(),
    });
    desktopAudioPolicy.start();
  }
} catch (error) {
  recordDiagnostic({ reason: "desktop-audio-unavailable", error: String(error?.message || error) });
  desktopAudioSink = null;
  desktopAudioPolicy = null;
}
let activeLaunch = null;
let activeCommand = null;
let activeClose = null;

function setStatus(text, state = "booting") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function setMarker(element, ready, label) {
  if (!element) return;
  element.dataset.state = ready ? "ready" : "pending";
  element.textContent = label;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorDistance(left, right) {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
}

function averageRegion(bytes, top, bottom, left = 0, right = WIDTH) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 8) {
    for (let x = left; x < right; x += 8) {
      const offset = (y * WIDTH + x) * 4;
      red += bytes[offset];
      green += bytes[offset + 1];
      blue += bytes[offset + 2];
      count += 1;
    }
  }
  return count ? [red / count, green / count, blue / count] : [0, 0, 0];
}

function averageRow(bytes, y) {
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let x = 0; x < WIDTH; x += 8) {
    const offset = (y * WIDTH + x) * 4;
    red += bytes[offset];
    green += bytes[offset + 1];
    blue += bytes[offset + 2];
  }
  const count = Math.ceil(WIDTH / 8);
  return [red / count, green / count, blue / count];
}

function nonBlackRatio(bytes) {
  let count = 0;
  const samples = Math.ceil(bytes.length / 32);
  for (let index = 0; index < bytes.length; index += 32) {
    if (bytes[index] > 8 || bytes[index + 1] > 8 || bytes[index + 2] > 8) count += 1;
  }
  return count / samples;
}

function greenPixels(bytes) {
  let count = 0;
  // Sample every eighth pixel. The command marker is a colored terminal glyph run, while the
  // desktop wallpaper and panel are neutral; sampling keeps this bounded during slow boots.
  for (let offset = 0; offset < bytes.length; offset += 32) {
    const red = bytes[offset];
    const green = bytes[offset + 1];
    const blue = bytes[offset + 2];
    if (green >= 72 && green > red + 20 && green > blue + 20) count += 1;
  }
  return count;
}

function redPixels(bytes) {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 32) {
    const red = bytes[offset];
    const green = bytes[offset + 1];
    const blue = bytes[offset + 2];
    if (red >= 72 && red > green + 20 && red > blue + 20) count += 1;
  }
  return count;
}

function darkRatio(bytes) {
  let dark = 0;
  let samples = 0;
  // Weston keeps the panel in the first 80 guest rows. A foot surface is a large dark client
  // rectangle below it; the wallpaper is deliberately neutral and much brighter.
  for (let y = 80; y < HEIGHT; y += 8) {
    for (let x = 0; x < WIDTH; x += 8) {
      const offset = (y * WIDTH + x) * 4;
      if (bytes[offset] < 55 && bytes[offset + 1] < 55 && bytes[offset + 2] < 55) dark += 1;
      samples += 1;
    }
  }
  return samples ? dark / samples : 0;
}

function surfaceStats(bytes) {
  return {
    nonBlackRatio: nonBlackRatio(bytes),
    darkRatio: darkRatio(bytes),
    greenPixels: greenPixels(bytes),
    redPixels: redPixels(bytes),
  };
}

function rowBand(bytes, top, wallpaper) {
  let different = 0;
  let edges = 0;
  let previous = null;
  for (let y = top; y < top + 80 && y < HEIGHT; y += 2) {
    const current = averageRow(bytes, y);
    if (colorDistance(current, wallpaper) > 24) different += 1;
    if (previous && colorDistance(current, previous) > 16) edges += 1;
    previous = current;
  }
  return { differentRatio: different / 40, edges, mean: averageRegion(bytes, top, Math.min(HEIGHT, top + 80)) };
}

function inkStats(bytes, top, panelColor) {
  let inkPixels = 0;
  let runs = 0;
  for (let y = top; y < top + 80 && y < HEIGHT; y += 2) {
    let inRun = false;
    for (let x = 0; x < WIDTH; x += 2) {
      const offset = (y * WIDTH + x) * 4;
      const pixel = [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
      const ink = colorDistance(pixel, panelColor) > 42 && pixel[0] + pixel[1] + pixel[2] > 100;
      if (ink) {
        inkPixels += 1;
        if (!inRun) runs += 1;
        inRun = true;
      } else {
        inRun = false;
      }
    }
  }
  return { inkPixels, runs };
}

function inspectDesktop(bytes) {
  if (!ArrayBuffer.isView(bytes) || bytes.length !== WIDTH * HEIGHT * 4) {
    throw new Error(`desktop readback must be ${WIDTH}×${HEIGHT} RGBA`);
  }
  const background = averageRegion(bytes, 160, 640, 160, 1120);
  const nonBlack = nonBlackRatio(bytes);
  const wallpaper = nonBlack > 0.08 && colorDistance(background, [0, 0, 0]) > 12;
  const candidates = [rowBand(bytes, 0, background), rowBand(bytes, HEIGHT - 80, background)];
  const selectedIndex = candidates[1].differentRatio + candidates[1].edges / 40 >
    candidates[0].differentRatio + candidates[0].edges / 40 ? 1 : 0;
  const selected = candidates[selectedIndex];
  const panelReady = wallpaper && selected.differentRatio >= 0.35 && colorDistance(selected.mean, background) > 18;
  const ink = inkStats(bytes, selectedIndex ? HEIGHT - 80 : 0, selected.mean);
  const menu = panelReady && ink.inkPixels >= 24 && ink.runs >= 8;
  return {
    wallpaper,
    panel: {
      ready: panelReady,
      position: selectedIndex ? "bottom" : "top",
      top: selectedIndex ? HEIGHT - 80 : 0,
      height: 80,
      mean: selected.mean.map(clampByte),
      difference: Math.round(colorDistance(selected.mean, background)),
    },
    menu,
    nonBlackRatio: nonBlack,
    background: background.map(clampByte),
    menuDetails: { ready: menu, inkPixels: ink.inkPixels, runs: ink.runs },
  };
}

function clonePixels() {
  if (!presentation) return null;
  return new Uint8ClampedArray(presentation.readPixels());
}

function crc32Hex(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

function frontBufferCrc() {
  return crc32Hex(clonePixels());
}

// The render clock advances for worklet quanta even when the ring contains digital silence. Keep
// the proof separate: this bounded read inspects only the guest-written slots since a supplied
// producer index and therefore cannot turn a silent counter advance into a PCM success.
function audioPcmObservation(fromWriteIndex = null) {
  const ring = desktopAudioSink?.ring;
  let samples = null;
  if (ring) {
    try {
      // Read the public SAB payload directly; the worklet consumes slots but never rewrites them.
      samples = new Float32Array(ring.sharedBuffer, HEADER_BYTES, ring.capacityFrames * CHANNELS);
    } catch { /* a torn/invalid audio setup is reported as unavailable below */ }
  }
  if (!ring || !(samples instanceof Float32Array)) {
    return { available: false, writtenFrames: 0, nonSilentFrames: 0, maxAbs: 0 };
  }
  const writeIndex = ring.writeIndex;
  const readIndex = ring.readIndex;
  const fillFrames = ring.fillFrames;
  const requested = fromWriteIndex == null ? ring.capacityFrames : (writeIndex - fromWriteIndex) >>> 0;
  const inspectedFrames = Math.min(requested, ring.capacityFrames);
  const firstIndex = (writeIndex - inspectedFrames) >>> 0;
  let nonSilentFrames = 0;
  let maxAbs = 0;
  for (let frame = 0; frame < inspectedFrames; frame += 1) {
    const slot = (firstIndex + frame) % ring.capacityFrames;
    const left = Math.abs(samples[slot * CHANNELS] || 0);
    const right = Math.abs(samples[slot * CHANNELS + 1] || 0);
    maxAbs = Math.max(maxAbs, left, right);
    if (left > 0 || right > 0) nonSilentFrames += 1;
  }
  return {
    available: true,
    writeIndex,
    readIndex,
    fillFrames,
    capacityFrames: ring.capacityFrames,
    writtenFrames: requested,
    inspectedFrames,
    nonSilentFrames,
    maxAbs,
  };
}

function visualDiff(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let changed = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (Math.abs(left[index] - right[index]) > 12 ||
        Math.abs(left[index + 1] - right[index + 1]) > 12 ||
        Math.abs(left[index + 2] - right[index + 2]) > 12) changed += 1;
  }
  return changed;
}

function observeInteractionPixels() {
  if (!presentation || frameCount === lastObservedFrame) return;
  lastObservedFrame = frameCount;
  const current = clonePixels();
  latestPixels = current;
  latestSurface = surfaceStats(current);
  for (const record of [activeLaunch, activeCommand, activeClose]) {
    if (!record || !record.beforePixels) continue;
    record.visualDiffPixels = visualDiff(record.beforePixels, current);
    if (record.visualDiffPixels >= MIN_VISUAL_DIFF) record.visualChange = true;
  }
  if (activeLaunch && activeLaunch.visualChange) {
    if (latestSurface.darkRatio >= MIN_TERMINAL_DARK_RATIO) {
      activeLaunch.nonBlackStreak += 1;
      // A launcher repaint or cursor move can produce a large pixel diff without creating a
      // client surface. Require a sustained dark foot rectangle below the panel before accepting.
      if (activeLaunch.nonBlackStreak >= 3) activeLaunch.terminalRendered = true;
    } else {
      activeLaunch.nonBlackStreak = 0;
    }
  }
  if (activeCommand && latestSurface.greenPixels >= MIN_TERMINAL_MARKER_PIXELS &&
      latestSurface.greenPixels > activeCommand.greenPixelsBefore) {
    activeCommand.terminalMarkerSeen = true;
  }
}

function publishInspection(inspection) {
  latestInspection = inspection;
  document.documentElement.dataset.desktopInspection = JSON.stringify(inspection);
  setMarker(readyEl, inspection.wallpaper && inspection.panel.ready && inspection.menu, "desktop ready");
  if (inspection.wallpaper && inspection.panel.ready && inspection.menu) {
    setStatus("desktop ready: launcher available", "ready");
    if (controller && !readinessStarted) void finishReadiness();
  }
}

// Keep readiness inspection from owning a pause it did not create. This is deliberately small so
// a transient optimistic inspection can return without stranding the whole-machine controller.
async function withReadinessPause(owner, inspect) {
  const wasPaused = await owner.isPaused?.() === true;
  await owner.pause();
  try {
    return await inspect();
  } finally {
    if (!wasPaused) await owner.resume?.();
  }
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const DESKTOP_SNAPSHOT_STORAGE_KEY = "wasm-vm.desktop-snapshot.v1";

function snapshotBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function snapshotBytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function ownedSnapshotBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError("desktop snapshot must be bytes");
}

function normalizeDesktopSnapshot(value) {
  if (value == null) return null;
  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return { bytes: ownedSnapshotBytes(value) };
  }
  if (typeof value === "object" && value.bytes != null) {
    return { ...value, bytes: ownedSnapshotBytes(value.bytes) };
  }
  throw new TypeError("desktop snapshot must contain bytes");
}

function storedDesktopSnapshot() {
  const raw = sessionStorage.getItem(DESKTOP_SNAPSHOT_STORAGE_KEY);
  if (!raw) return null;
  const record = JSON.parse(raw);
  if (!record || typeof record.bytes !== "string") throw new Error("stored desktop snapshot is malformed");
  const bytes = snapshotBytesFromBase64(record.bytes);
  return { ...record, bytes };
}

async function drainPresentationBeforeSnapshot() {
  const initial = presentation?.snapshot?.().scheduler;
  if (!initial) return null;
  if (initial.pending === 0 && initial.scheduled === false) return initial;
  const deadline = performance.now() + 2_000;
  while (true) {
    const scheduler = presentation?.snapshot?.().scheduler;
    if (!scheduler || (scheduler.pending === 0 && scheduler.scheduled === false)) return scheduler;
    if (performance.now() >= deadline) {
      throw new Error(`presentation did not drain before snapshot: ${JSON.stringify(scheduler)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function saveDesktopSnapshot({ persist = false, machinePersist = persist } = {}) {
  if (!controller || typeof controller.saveDesktopSnapshot !== "function") {
    throw new Error("desktop snapshot save is unavailable");
  }
  const wasPaused = await controller.isPaused?.() === true;
  if (!wasPaused) await controller.pause?.();
  try {
    // A normal T26f page has no presentation scheduler. When latency hooks do enable one, drain
    // its already-received frame before pairing the visible CRC with the paused guest snapshot.
    await drainPresentationBeforeSnapshot();
    // All paired evidence is taken at this paused boundary. The CRC is no longer a racy read
    // performed by the browser harness before an unrelated snapshot RPC can run the guest.
    if (machinePersist) await controller.persist?.();
    const preFrontBufferCrc = frontBufferCrc();
    const value = await controller.saveDesktopSnapshot();
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
    const sha256 = await sha256Hex(bytes);
    let machineResume = null;
    if (machinePersist) {
      if (typeof controller.snapshotSave !== "function") {
        throw new Error("whole-machine snapshot persistence is unavailable");
      }
      const snapshotSaveResult = await controller.snapshotSave();
      if (snapshotSaveResult === "not_persistent") {
        throw new Error("whole-machine snapshot persistence is unavailable");
      }
      machineResume = {
        persisted: true,
        paused: true,
        preFrontBufferCrc,
        overlayGeneration: await controller.snapshotGeneration?.() ?? null,
      };
    }
    const record = {
      schema: "wasm-vm.e5-t26f.desktop-snapshot.v1",
      bytes: snapshotBase64(bytes),
      byteLength: bytes.byteLength,
      sha256,
      preFrontBufferCrc,
      machineResume,
      savedAt: new Date().toISOString(),
    };
    if (persist) sessionStorage.setItem(DESKTOP_SNAPSHOT_STORAGE_KEY, JSON.stringify(record));
    return { ...record, bytes };
  } finally {
    if (!wasPaused) await controller.resume?.();
  }
}

async function restoreDesktopSnapshot(snapshot = null, hostViewport = null) {
  if (!controller || !desktopAgentBridge) throw new Error("desktop restore is not ready");
  const record = snapshot == null
    ? storedDesktopSnapshot()
    : normalizeDesktopSnapshot(snapshot);
  if (!record?.bytes) throw new Error("desktop snapshot is missing");
  const viewport = hostViewport || {
    width: presentation?.snapshot?.().width || WIDTH,
    height: presentation?.snapshot?.().height || HEIGHT,
  };
  const wasPaused = await controller.isPaused?.() === true;
  restoreObservation = {
    baseSuccessfulPresents: presentation.snapshot().successfulPresents,
    firstPresent: null,
  };
  try {
    const result = await restoreDesktopThroughHost({
      controller,
      agentChannel: desktopAgentBridge.channel,
      presentation,
      beforeRestore: async () => {
        if (!wasPaused) await controller.pause?.();
      },
    }, record.bytes, viewport);
    const restoredSha256 = await sha256Hex(record.bytes);
    document.documentElement.dataset.desktopRestored = "ready";
    lastRestoreResult = {
      ...result,
      snapshotSha256: restoredSha256,
      snapshotBytes: record.bytes.byteLength,
      preFrontBufferCrc: record.preFrontBufferCrc || null,
      machineResume: record.machineResume || null,
      completedAt: performance.now(),
    };
    return lastRestoreResult;
  } catch (error) {
    restoreObservation = null;
    lastRestoreResult = null;
    throw error;
  } finally {
    if (!wasPaused) await controller.resume?.();
  }
}

async function finishReadiness() {
  if (readinessStarted || autoRestoreInFlight || desktopReady || !controller || !presentation) return;
  readinessStarted = true;
  try {
    await beginAutoRestoreIfRequested();
    const inspectedReady = await withReadinessPause(controller, async () => {
      latestPixels = clonePixels();
      const inspection = inspectDesktop(latestPixels);
      if (!(inspection.wallpaper && inspection.panel.ready && inspection.menu)) {
        readinessStarted = false;
        return false;
      }
      desktopReady = true;
      setMarker(readyEl, true, "desktop ready");
      document.documentElement.dataset.desktopReady = "ready";
      document.documentElement.dataset.desktopWallpaper = "ready";
      document.documentElement.dataset.desktopPanel = "ready";
      document.documentElement.dataset.desktopMenu = "ready";
      return true;
    });
    if (!inspectedReady) {
      readinessStarted = false;
      return;
    }
    // The interpreted guest can still be finishing OpenRC while the first desktop frame is
    // painted. Start the reconnecting Channel at the usable-desktop boundary so its initial HELLO
    // is not repeatedly submitted before the named virtio port has opened.
    startDesktopAgentBridge();
    if (query.has("autoRestore") && document.documentElement.dataset.desktopRestored !== "ready") {
      try {
        await restoreDesktopSnapshot();
        setStatus("desktop restored: snapshot and agent ready", "ready");
      } catch (error) {
        latestError = error;
        recordDiagnostic({ reason: "desktop-auto-restore", error: String(error?.message || error) });
        document.documentElement.dataset.desktopRestored = "error";
        setStatus(`desktop restore failed: ${error.message || error}`, "error");
      }
    }
  } catch (error) {
    latestError = error;
    readinessStarted = false;
    displayError = error;
    setStatus(`desktop proof failed: ${error.message || error}`, "error");
    document.documentElement.dataset.desktopReady = "error";
  }
}

function onDisplayFrame(frame) {
  if (!presentation || displayError) return false;
  try {
    const startedAt = desktopPerfHooksRequested ? performance.now() : 0;
    const reached = presentation.present(frame);
    if (restoreObservation && !restoreObservation.firstPresent &&
        presentation.snapshot().successfulPresents > restoreObservation.baseSuccessfulPresents) {
      restoreObservation.firstPresent = {
        successfulPresents: presentation.snapshot().successfulPresents,
        crc32: frontBufferCrc(),
      };
    }
    if (desktopPerfHooksRequested) {
      desktopPerfPresentDurations.push(Math.max(0, performance.now() - startedAt));
      if (desktopPerfPresentDurations.length > 4_096) desktopPerfPresentDurations.shift();
    }
    frameCount += 1;
    const now = performance.now();
    if (now - lastInspectionAt >= 500 || frameCount === 1) {
      lastInspectionAt = now;
      const pixels = clonePixels();
      latestPixels = pixels;
      publishInspection(inspectDesktop(pixels));
      observeInteractionPixels();
    }
    return reached;
  } catch (error) {
    displayError = error;
    latestError = error;
    setStatus(`display error: ${error.message || error}`, "error");
    document.documentElement.dataset.desktopReady = "error";
    return false;
  }
}

function clearDesktopPerf() {
  if (desktopPerfStatsTimer !== null) clearInterval(desktopPerfStatsTimer);
  desktopPerfStatsTimer = null;
  desktopPerfGuestInstructions = null;
  desktopPerfInput = null;
  desktopPerfPresentRecords.length = 0;
  desktopPerfPresentDurations.length = 0;
}

function onOutput(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  serialText += decoder.decode(value, { stream: true });
  if (serialText.length > MAX_SERIAL_BYTES) serialText = serialText.slice(-MAX_SERIAL_BYTES);
}

function onAgentOutput(bytes) {
  const value = bytes instanceof Uint8Array ? bytes.slice() : Uint8Array.from(bytes || []);
  if (!value.byteLength) return;
  if (desktopAgentBridge) desktopAgentBridge.receive(value);
  else {
    pendingAgentOutput.push(value);
    if (pendingAgentOutput.length > 128) pendingAgentOutput.shift();
  }
}

function startDesktopAgentBridge() {
  if (!desktopAgentBridge) return;
  desktopAgentBridge.start();
  for (const bytes of pendingAgentOutput.splice(0)) desktopAgentBridge.receive(bytes);
}

function beginAutoRestoreIfRequested() {
  if (!query.has("autoRestore") || autoRestorePromise) return autoRestorePromise;
  let snapshot;
  try {
    snapshot = storedDesktopSnapshot();
  } catch (error) {
    autoRestorePromise = Promise.reject(error);
    return autoRestorePromise;
  }
  if (!snapshot) {
    document.documentElement.dataset.desktopRestored = "none";
    return null;
  }
  autoRestoreInFlight = true;
  autoRestorePromise = (async () => {
    // A whole-machine resume may have no pending GPU damage. Start the live agent and apply the
    // host envelope as soon as the controller exists, rather than waiting for a new guest frame to
    // prove readiness. The restore itself publishes the full repair frame.
    startDesktopAgentBridge();
    return restoreDesktopSnapshot(snapshot);
  })().finally(() => {
    autoRestoreInFlight = false;
  });
  return autoRestorePromise;
}

function recordPointerFrame(frame) {
  pointerFrames.push({ atMs: Math.round(performance.now() - bootStartedAt), ...frame });
  if (pointerFrames.length > 2_000) pointerFrames.shift();
}

function recordKeyboardFrame(frame) {
  keyboardFrames.push({ atMs: Math.round(performance.now() - bootStartedAt), ...frame });
  if (keyboardFrames.length > 10_000) keyboardFrames.shift();
}

function recordKeyboardEvent(event) {
  const timestamp = performance.now();
  keyboardEvents.push({
    atMs: Math.round(timestamp - bootStartedAt),
    timestamp,
    type: event?.type || "",
    code: event?.code || "",
    key: event?.key || "",
    repeat: event?.repeat === true,
  });
  if (keyboardEvents.length > 10_000) keyboardEvents.shift();
}

// T25c calibration delays presentation dispatch itself. The delayed path first requests the same
// normal rAF boundary as the control path, then holds the callback for the requested interval;
// it deliberately does not enter a second rAF, so an rAF-only observer cannot see the delay as a
// display event. The handle carries both timers for correct cancellation.
function delayedRequestAnimationFrame(callback) {
  if (desktopPerfPresentDelayMs <= 0) return requestAnimationFrame(callback);
  const handle = { timer: null, frame: null, cancelled: false };
  handle.frame = requestAnimationFrame(() => {
    handle.frame = null;
    if (handle.cancelled) return;
    handle.timer = setTimeout(() => {
      handle.timer = null;
      if (!handle.cancelled) callback(performance.now());
    }, desktopPerfPresentDelayMs);
  });
  return handle;
}

function delayedCancelAnimationFrame(handle) {
  if (handle && typeof handle === "object") {
    handle.cancelled = true;
    if (handle.timer !== null) clearTimeout(handle.timer);
    if (handle.frame !== null) cancelAnimationFrame(handle.frame);
    return;
  }
  cancelAnimationFrame(handle);
}

function presentCalibrationFrame(rect) {
  if (!desktopLatencyHooksRequested || !presentation) throw new Error("latency hooks are disabled");
  const state = presentation.snapshot();
  const checkedRect = {
    x: Number(rect?.x),
    y: Number(rect?.y),
    width: Number(rect?.width),
    height: Number(rect?.height),
  };
  if (!Object.values(checkedRect).every(Number.isSafeInteger) || checkedRect.x < 0 || checkedRect.y < 0 ||
      checkedRect.width < 1 || checkedRect.height < 1 ||
      checkedRect.x + checkedRect.width > state.width || checkedRect.y + checkedRect.height > state.height) {
    throw new RangeError("calibration rect is outside the presentation resource");
  }
  const pixelCount = state.width * state.height;
  if (!desktopPerfCalibrationPixels || desktopPerfCalibrationPixels.length !== pixelCount) {
    desktopPerfCalibrationPixels = new Uint32Array(pixelCount);
  }
  // A white cursor-sized block makes the probe visibly drawn while leaving the existing desktop
  // surface intact outside the measured damage rectangle.
  for (let y = checkedRect.y; y < checkedRect.y + checkedRect.height; y += 1) {
    desktopPerfCalibrationPixels.fill(0xffffffff, (y * state.width) + checkedRect.x,
      (y * state.width) + checkedRect.x + checkedRect.width);
  }
  presentation.present({
    format: 1,
    rect: checkedRect,
    resourceWidth: state.width,
    resourceHeight: state.height,
    pixels: desktopPerfCalibrationPixels,
  });
  return checkedRect;
}

function beginLaunch(label = `launch-${interactions.launches.length + 1}`) {
  if (!desktopReady || !presentation) throw new Error("desktop is not ready");
  observeInteractionPixels();
  const record = {
    label: String(label),
    beforeFrame: frameCount,
    pointerStart: pointerFrames.length,
    keyboardStart: keyboardFrames.length,
    beforePixels: latestPixels ? latestPixels.slice() : clonePixels(),
    visualDiffPixels: 0,
    visualChange: false,
    terminalRendered: false,
    nonBlackStreak: 0,
  };
  interactions.launches.push(record);
  activeLaunch = record;
  setMarker(launchEl, false, `launching ${record.label}`);
  return publicState();
}

function finishLaunch() {
  observeInteractionPixels();
  if (!activeLaunch) throw new Error("no active launcher proof");
  const record = activeLaunch;
  record.afterFrame = frameCount;
  record.pointerFrames = pointerFrames.length - record.pointerStart;
  record.visualChange = record.visualDiffPixels >= MIN_VISUAL_DIFF;
  record.accepted = record.visualChange && record.terminalRendered && record.pointerFrames >= 2;
  delete record.beforePixels;
  if (!record.accepted) throw new Error(`Terminal launcher caused no visible window change: ${JSON.stringify(record)}`);
  setMarker(launchEl, true, `Terminal launcher (${record.label})`);
  return publicState();
}

function beginFocus(label = `focus-${interactions.focuses.length + 1}`) {
  if (!desktopReady) throw new Error("desktop is not ready");
  const record = {
    label: String(label),
    beforeFrame: frameCount,
    pointerStart: pointerFrames.length,
    hostFocusedBefore: document.activeElement === canvas,
  };
  interactions.focuses.push(record);
  return publicState();
}

function finishFocus() {
  const record = interactions.focuses.at(-1);
  if (!record) throw new Error("no focus proof");
  record.afterFrame = frameCount;
  record.pointerFrames = pointerFrames.length - record.pointerStart;
  record.hostFocusedAfter = document.activeElement === canvas;
  record.accepted = record.hostFocusedAfter && record.pointerFrames >= 2;
  if (!record.accepted) throw new Error(`terminal focus was not established: ${JSON.stringify(record)}`);
  setMarker(focusEl, true, "terminal focus");
  return publicState();
}

function confirmGuestFocus(marker) {
  const focus = interactions.focuses.at(-1);
  const command = [...interactions.commands].reverse().find((entry) => entry.marker === String(marker));
  if (!focus || !command) throw new Error("guest focus proof requires a completed visible command");
  focus.guestVisible = command.accepted && command.terminalMarkerSeen && command.visualDiffPixels >= MIN_VISUAL_DIFF;
  focus.guestVisibleCommand = String(marker);
  focus.guestVisiblePixels = command.visualDiffPixels;
  focus.accepted = focus.accepted && focus.guestVisible;
  if (!focus.accepted) throw new Error(`guest focus was not visibly used: ${JSON.stringify(focus)}`);
  return publicState();
}

function beginCommand(command, marker) {
  if (!desktopReady || !canvas) throw new Error("desktop is not ready");
  observeInteractionPixels();
  const record = {
    command: String(command),
    marker: String(marker),
    beforeFrame: frameCount,
    keyboardStart: keyboardFrames.length,
    domEventStart: keyboardEvents.length,
    beforePixels: latestPixels ? latestPixels.slice() : clonePixels(),
    visualDiffPixels: 0,
    terminalMarkerSeen: false,
    greenPixelsBefore: latestSurface.greenPixels,
    redPixelsBefore: latestSurface.redPixels,
  };
  interactions.commands.push(record);
  activeCommand = record;
  return publicState();
}

function finishCommand(marker = activeCommand?.marker) {
  observeInteractionPixels();
  if (!activeCommand) throw new Error("no active command proof");
  const record = activeCommand;
  record.afterFrame = frameCount;
  record.terminalMarkerSeen = record.terminalMarkerSeen ||
    (latestSurface.greenPixels >= MIN_TERMINAL_MARKER_PIXELS &&
      latestSurface.greenPixels > record.greenPixelsBefore);
  record.redMarkerSeen = latestSurface.redPixels >= MIN_TERMINAL_MARKER_PIXELS &&
    latestSurface.redPixels > record.redPixelsBefore;
  record.visualDiffPixels = Math.max(record.visualDiffPixels, visualDiff(record.beforePixels, latestPixels || clonePixels()));
  record.keyboardFrames = keyboardFrames.length - record.keyboardStart;
  record.domEvents = keyboardEvents.length - record.domEventStart;
  const commandFrames = keyboardFrames.slice(record.keyboardStart);
  const commandEvents = keyboardEvents.slice(record.domEventStart);
  record.inputSequenceMatch = commandFrames.length === commandEvents.length && commandEvents.every((event, index) => {
    const frame = commandFrames[index];
    return frame?.code === event.code && frame.value === (event.type === "keydown" ? 1 : 0);
  });
  record.inputTraceSha256 = null;
  record.accepted = record.terminalMarkerSeen && record.visualDiffPixels >= MIN_VISUAL_DIFF && record.keyboardFrames > 0;
  delete record.beforePixels;
  if (!record.accepted) throw new Error(`ls command was not visibly rendered: ${JSON.stringify(record)}`);
  setMarker(commandEl, true, "ls command rendered");
  return publicState();
}

function beginClose(label = `close-${interactions.closes.length + 1}`) {
  observeInteractionPixels();
  const record = {
    label: String(label),
    beforeFrame: frameCount,
    beforePixels: latestPixels ? latestPixels.slice() : clonePixels(),
    visualDiffPixels: 0,
  };
  interactions.closes.push(record);
  activeClose = record;
  return publicState();
}

function finishClose() {
  observeInteractionPixels();
  if (!activeClose) throw new Error("no active close proof");
  const record = activeClose;
  record.afterFrame = frameCount;
  record.visualDiffPixels = Math.max(record.visualDiffPixels, visualDiff(record.beforePixels, latestPixels || clonePixels()));
  record.accepted = record.afterFrame > record.beforeFrame && record.visualDiffPixels >= MIN_VISUAL_DIFF;
  delete record.beforePixels;
  if (!record.accepted) throw new Error(`terminal close caused no visible change: ${JSON.stringify(record)}`);
  activeLaunch = null;
  activeCommand = null;
  activeClose = null;
  if (interactions.commands.length >= 2 && interactions.closes.length >= 2) {
    setMarker(repeatEl, true, "repeat open/type/close");
  }
  return publicState();
}

function safeRecord(record) {
  if (!record) return null;
  const copy = { ...record };
  delete copy.beforePixels;
  return copy;
}

function publicState() {
  observeInteractionPixels();
  return {
    desktopReady,
    frameCount,
    serialText: serialText.slice(-2_000),
    pointerFrames: pointerFrames.length,
    pointerFrameSample: pointerFrames.slice(-16),
    keyboardFrames: keyboardFrames.length,
    keyboardEvents: keyboardEvents.length,
    keyboardFrameSample: keyboardFrames.slice(-16),
    keyboardEventSample: keyboardEvents.slice(-16),
    surface: { ...latestSurface },
    agent: desktopAgentBridge?.stats() || null,
    diagnostics: [...diagnostics],
    readiness: {
      desktopReady,
      inspection: latestInspection ? { ...latestInspection } : null,
      agentState: desktopAgentBridge?.stats?.().state || null,
    },
    bootStates: [...bootStates],
    launches: interactions.launches.map(safeRecord),
    focuses: interactions.focuses.map(safeRecord),
    commands: interactions.commands.map(safeRecord),
    closes: interactions.closes.map(safeRecord),
    active: {
      launch: safeRecord(activeLaunch),
      command: safeRecord(activeCommand),
      close: safeRecord(activeClose),
    },
  };
}

async function finishProof() {
  if (finalProof || !controller || !desktopReady) return finalProof;
  await controller.pause();
  const pixels = clonePixels();
  const imageManifestUrl = query.get("imageManifestUrl") || "./e5t18b-desktop/manifest.json";
  const imageManifestText = await (await fetch(imageManifestUrl, { cache: "no-store" })).text();
  const imageManifest = JSON.parse(imageManifestText);
  const state = presentation.snapshot();
  const [scheduler, fetchStats, stateDigest, paused] = await Promise.all([
    controller.schedulerStats?.() ?? null,
    controller.fetchStats?.() ?? null,
    controller.stateDigest?.() ?? null,
    controller.isPaused?.() ?? false,
  ]);
  const proof = {
    schema: "wasm-vm.e5-t18b.desktop-terminal-input.v1",
    task: "E5-T18b",
    route: "desktop-terminal",
    image: {
      expectedSha256: query.get("imageSha256") || FALLBACK_IMAGE_SHA256,
      manifestUrl: imageManifestUrl,
      manifestSha256: await sha256Hex(encoder.encode(imageManifestText)),
      expectedManifestSha256: query.get("manifestSha256") || FALLBACK_CHUNK_MANIFEST_SHA256,
      imageLen: imageManifest.image_len,
      chunkSize: imageManifest.chunk_size,
      chunkCount: Array.isArray(imageManifest.chunks) ? imageManifest.chunks.length : null,
      layout: imageManifest.layout,
    },
    readiness: latestInspection,
    selectedBackend: state.backend,
    canvas: { width: state.width, height: state.height },
    frameCount,
    bootToDesktopMs: Math.round(performance.now() - bootStartedAt),
    serialBytes: encoder.encode(serialText).byteLength,
    serialSha256: await sha256Hex(encoder.encode(serialText)),
    serialTail: serialText.slice(-2_000),
    interactions: {
      launches: interactions.launches.map(safeRecord),
      focuses: interactions.focuses.map(safeRecord),
      commands: interactions.commands.map(safeRecord),
      closes: interactions.closes.map(safeRecord),
    },
    input: {
      pointerFrameCount: pointerFrames.length,
      keyboardFrameCount: keyboardFrames.length,
      keyboardEventCount: keyboardEvents.length,
      keyboardFrames: keyboardFrames.slice(-4_000),
      diagnostics: [...diagnostics],
    },
    presentation: state,
    scheduler,
    fetchStats,
    stateDigest,
    paused: paused === true,
    error: latestError ? String(latestError.message || latestError) : null,
  };
  finalProof = proof;
  proofEl.textContent = JSON.stringify(proof, null, 2);
  setStatus("terminal input proof ready", "ready");
  document.documentElement.dataset.desktopProof = JSON.stringify(proof);
  globalThis.__desktopTerminalProof = () => finalProof;
  return finalProof;
}

function publicApi() {
  return {
    beginLaunch,
    finishLaunch,
    beginFocus,
    finishFocus,
    confirmGuestFocus,
    beginCommand,
    finishCommand,
    beginClose,
    finishClose,
    finishProof,
    state: publicState,
    guestClock: async () => await controller?.guestClockState?.() ?? null,
    serial: () => serialText,
    focus: () => canvas?.focus(),
    pointerState: () => pointerBridge?.state() ?? null,
    proof: () => finalProof,
    presentation: () => presentation?.snapshot() ?? null,
    frontBufferCrc,
    restoreObservation: () => restoreObservation ? {
      baseSuccessfulPresents: restoreObservation.baseSuccessfulPresents,
      firstPresent: restoreObservation.firstPresent ? { ...restoreObservation.firstPresent } : null,
    } : null,
    restoreResult: () => lastRestoreResult ? { ...lastRestoreResult } : null,
    saveDesktopSnapshot,
    restoreDesktopSnapshot,
    storedDesktopSnapshot,
    agentChannel: () => desktopAgentBridge?.channel ?? null,
    audio: () => ({
      policy: desktopAudioPolicy,
      sink: desktopAudioSink,
      pcm: audioPcmObservation,
      ready: Boolean(desktopAudioSink),
    }),
  };
}

if (!root || !canvas) throw new Error("desktop terminal route is missing its host surface");

try {
  presentation = new PresentationController(canvas, {
    defaultBackend: "canvas2d",
    canvas2dOptions: { contextAttributes: { alpha: true, willReadFrequently: true } },
    scheduleFrames: desktopLatencyHooksRequested,
    visibilityTarget: desktopLatencyHooksRequested ? document : undefined,
    requestAnimationFrame: desktopLatencyHooksRequested ? delayedRequestAnimationFrame : undefined,
    cancelAnimationFrame: desktopLatencyHooksRequested ? delayedCancelAnimationFrame : undefined,
    onPresent: desktopPerfHooksRequested
      ? (record) => {
        desktopPerfPresentRecords.push({ ...record, rect: { ...record.rect } });
        if (desktopPerfPresentRecords.length > 4_096) desktopPerfPresentRecords.shift();
      }
      : undefined,
    now: desktopPerfHooksRequested ? () => performance.now() : undefined,
    guestInstructions: desktopPerfHooksRequested ? () => desktopPerfGuestInstructions : undefined,
  });
  document.documentElement.dataset.desktopBackend = presentation.backendName;
} catch (error) {
  displayError = error;
  latestError = error;
  setStatus(`display unavailable: ${error.message || error}`, "error");
  throw error;
}

globalThis.__desktopTerminal = publicApi();
globalThis.__desktopTerminalProof = () => finalProof;
globalThis.__desktopSnapshot = Object.freeze({
  save: saveDesktopSnapshot,
  restore: restoreDesktopSnapshot,
  read: storedDesktopSnapshot,
  clear: () => sessionStorage.removeItem(DESKTOP_SNAPSHOT_STORAGE_KEY),
});
if (desktopPerfHooksRequested) {
  globalThis.__desktopPerf = {
    version: desktopLatencyHooksRequested ? "e5-t25c-v1" : "e5-t25b-v1",
    latencyHooks: desktopLatencyHooksRequested,
    ready: () => desktopPerfInput !== null,
    input: () => desktopPerfInput,
    now: () => performance.now(),
    presents: () => desktopPerfPresentRecords.map((record) => ({ ...record, rect: { ...record.rect } })),
    presentDurations: () => [...desktopPerfPresentDurations],
    keyboardEvents: () => keyboardEvents.map((event) => ({ ...event })),
    setPresentDelay: (milliseconds) => {
      if (!desktopLatencyHooksRequested) throw new Error("latency hooks are disabled");
      const value = Number(milliseconds);
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000) {
        throw new RangeError("present delay must be an integer in [0, 1000] ms");
      }
      desktopPerfPresentDelayMs = value;
      return desktopPerfPresentDelayMs;
    },
    presentCalibrationFrame: (rect) => presentCalibrationFrame(rect),
    presentDelay: () => desktopPerfPresentDelayMs,
    clear: () => {
      const wasPaused = presentation?.pause?.() === true;
      const discardedPending = presentation?.discardPending?.() === true;
      if (wasPaused) presentation.resume();
      desktopPerfPresentRecords.length = 0;
      desktopPerfPresentDurations.length = 0;
      return { discardedPending };
    },
    state: () => presentation?.snapshot?.() ?? null,
    scheduler: async () => await controller?.schedulerStats?.() ?? null,
  };
}

const bootPromise = startLinuxBootWorker({
  manifestUrl: query.get("manifestUrl") || "./artifacts-alpine.json",
  mode: "chunked",
  imageManifestUrl: query.get("imageManifestUrl") || "./e5t18b-desktop/manifest.json",
  bootProfileUrl: query.get("bootProfileUrl") || null,
  baseUrl: query.get("baseUrl") || "./e5t18b-desktop/",
  ramMib: 256,
  bootargs: "root=/dev/vda rw console=ttyS0 earlycon=sbi",
  bootSnapshot: false,
  // E5-T26f: the desktop envelope is paired with the persistent whole-machine resume snapshot.
  // The envelope restores host-owned GPU/input/sound/agent state; the resume blob carries CPU/RAM
  // and transport state so a reload does not execute a fresh Linux probe sequence.
  persist: true,
  slirpNet: false,
  fastInterpreter: true,
  guestClock: query.get("guestClock") ?? "icount",
  jit: query.get("jit") !== "0",
  quantum: Number(query.get("quantum") || 500_000),
  audioSharedBuffer: desktopAudioSink?.ring.sharedBuffer ?? null,
  audioClockBuffer: desktopAudioSink?.clockBuffer ?? null,
  audioCapacityFrames: desktopAudioSink?.ring.capacityFrames ?? 0,
  audioSampleRateHz: desktopAudioSink?.sampleRateHz ?? 0,
  onState: (state) => {
    bootStates.push({ state: String(state), atMs: Math.round(performance.now() - bootStartedAt) });
    if (bootStates.length > 128) bootStates.shift();
    setStatus(`linux: ${state}`);
  },
  onProgress: (role, loaded, total) => {
    const progress = total ? `${Math.round((loaded / total) * 100)}%` : `${Math.round(loaded / 1048576)} MB`;
    setStatus(`loading ${role} ${progress}`);
  },
  onOutput,
  onAgentOutput,
  onDisplayFrame,
  onError: (error) => {
    latestError = error;
    setStatus(`boot error: ${error.message || error}`, "error");
  },
});

bootPromise.then((value) => {
  controller = value;
  globalThis.__desktopController = controller;
  try {
    desktopAgentBridge = createDesktopAgentBridge(controller, {
      onError: (error) => recordDiagnostic({
        reason: "agent-channel",
        error: String(error?.message || error),
        channelState: desktopAgentBridge?.channel?.state || null,
        transportGeneration: desktopAgentBridge?.stats?.().transportGeneration ?? null,
      }),
    });
    globalThis.__desktopAgentChannel = desktopAgentBridge.channel;
  } catch (error) {
    latestError = error;
    recordDiagnostic({ reason: "agent-bridge-unavailable", error: String(error?.message || error) });
  }
  if (desktopPerfHooksRequested) {
    import("./bench/desktop-perf-hooks.js").then(({ createDesktopPerfInput }) => {
      if (controller !== value) return;
      desktopPerfInput = createDesktopPerfInput(controller, { enabled: true });
      const sampleGuestInstructions = async () => {
        if (controller !== value) return;
        try {
          const stats = await value.schedulerStats?.() ?? null;
          const retired = stats?.retiredInstructions;
          if (typeof retired === "number" && Number.isSafeInteger(retired) && retired >= 0) {
            desktopPerfGuestInstructions = retired;
          }
        } catch { /* perf attribution is diagnostic-only */ }
      };
      void sampleGuestInstructions();
      desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);
    }).catch((error) => {
      recordDiagnostic({ reason: "desktop-perf-hook-load-failed", error: String(error?.message || error) });
    });
  }
  keyboardBridge = createKeyboardBridge(createWasmKeyboardAdapter(controller), {
    onFrame: recordKeyboardFrame,
    onDiagnostic: (entry) => recordDiagnostic(entry),
  });
  keyboardReconciler = createKeyboardReconciler(keyboardBridge, {
    onDiagnostic: (entry) => recordDiagnostic(entry),
  });
  keyboardCapture = createKeyboardCapturePolicy({
    initialCaptured: true,
    onGuestEvent: (event) => {
      recordKeyboardEvent(event);
      return keyboardReconciler.handleKeyEvent(event);
    },
    onDiagnostic: (entry) => recordDiagnostic(entry),
    onStateChange: (captured) => { document.documentElement.dataset.keyboardCapture = captured ? "on" : "off"; },
  });
  detachKeyboard = attachKeyboardCapture(root, keyboardCapture, { capture: true });
  pointerBridge = createPointerBridge(createWasmPointerAdapter(controller), {
    target: canvas,
    documentTarget: document,
    windowTarget: window,
    // Weston classifies the absolute tablet as a pointer for motion but handles desktop-shell
    // button activation through the relative mouse seat. Keep tablet coordinates and route only
    // the button transition through that compatible device.
    absoluteButtonDevice: "mouse",
    // The worker RPC surface is asynchronous. Keep each tablet/mouse frame awaited and ordered so
    // the compositor applies the coordinate motion before the mouse-seat button transition.
    serializeTransport: true,
    isReady: () => controller !== null && displayError === null,
    onFrame: recordPointerFrame,
    onDiagnostic: (entry) => recordDiagnostic(entry),
  });
  detachPointer = attachPointerBridge(canvas, pointerBridge, {
    documentTarget: document,
    windowTarget: window,
    capture: true,
    preventDefault: true,
  });
  canvas.focus();
  document.documentElement.dataset.desktopController = "ready";
  const autoRestore = beginAutoRestoreIfRequested();
  if (autoRestore) {
    void autoRestore.then(() => {
      if (desktopReady || displayError) return;
      try {
        // A resumed guest is allowed to be visually quiescent. Inspect the repair frame emitted by
        // the envelope restore directly so readiness does not depend on another Linux repaint.
        latestPixels = clonePixels();
        publishInspection(inspectDesktop(latestPixels));
      } catch (error) {
        latestError = error;
        displayError = error;
        setStatus(`desktop restore display failed: ${error.message || error}`, "error");
        document.documentElement.dataset.desktopReady = "error";
      }
      if (!desktopReady && latestInspection?.wallpaper && latestInspection.panel.ready && latestInspection.menu) {
        void finishReadiness();
      }
    }).catch((error) => {
      latestError = error;
      setStatus(`desktop restore failed: ${error.message || error}`, "error");
      document.documentElement.dataset.desktopRestored = "error";
      document.documentElement.dataset.desktopReady = "error";
    });
  } else if (latestInspection?.wallpaper && latestInspection.panel.ready && latestInspection.menu) {
    void finishReadiness();
  }
}, (error) => {
  displayError = error;
  latestError = error;
  setStatus(`boot failed: ${error.message || error}`, "error");
  document.documentElement.dataset.desktopReady = "error";
});

addEventListener("beforeunload", () => {
  clearDesktopPerf();
  detachPointer?.();
  detachKeyboard?.();
  void controller?.stop?.();
});
