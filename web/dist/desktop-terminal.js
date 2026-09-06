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
let serialText = "";
let frameCount = 0;
let lastInspectionAt = 0;
let latestPixels = null;
let latestInspection = null;
let latestSurface = { nonBlackRatio: 0, darkRatio: 0, greenPixels: 0 };
let desktopReady = false;
let readinessStarted = false;
let finalProof = null;
let displayError = null;
let latestError = null;
let lastObservedFrame = 0;
let desktopPerfGuestInstructions = null;
let desktopPerfStatsTimer = null;
let desktopPerfInput = null;

const pointerFrames = [];
const keyboardFrames = [];
const keyboardEvents = [];
const desktopPerfPresentRecords = [];
const desktopPerfPresentDurations = [];
const diagnostics = [];
const interactions = {
  launches: [],
  focuses: [],
  commands: [],
  closes: [],
};
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

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function finishReadiness() {
  if (readinessStarted || desktopReady || !controller || !presentation) return;
  readinessStarted = true;
  try {
    await controller.pause();
    latestPixels = clonePixels();
    const inspection = inspectDesktop(latestPixels);
    if (!(inspection.wallpaper && inspection.panel.ready && inspection.menu)) {
      readinessStarted = false;
      return;
    }
    desktopReady = true;
    setMarker(readyEl, true, "desktop ready");
    document.documentElement.dataset.desktopReady = "ready";
    document.documentElement.dataset.desktopWallpaper = "ready";
    document.documentElement.dataset.desktopPanel = "ready";
    document.documentElement.dataset.desktopMenu = "ready";
    await controller.resume();
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

function recordPointerFrame(frame) {
  pointerFrames.push({ atMs: Math.round(performance.now() - bootStartedAt), ...frame });
  if (pointerFrames.length > 2_000) pointerFrames.shift();
}

function recordKeyboardFrame(frame) {
  keyboardFrames.push({ atMs: Math.round(performance.now() - bootStartedAt), ...frame });
  if (keyboardFrames.length > 10_000) keyboardFrames.shift();
}

function recordKeyboardEvent(event) {
  keyboardEvents.push({
    atMs: Math.round(performance.now() - bootStartedAt),
    type: event?.type || "",
    code: event?.code || "",
    key: event?.key || "",
    repeat: event?.repeat === true,
  });
  if (keyboardEvents.length > 10_000) keyboardEvents.shift();
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
    diagnostics: [...diagnostics],
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
    beginCommand,
    finishCommand,
    beginClose,
    finishClose,
    finishProof,
    state: publicState,
    serial: () => serialText,
    focus: () => canvas?.focus(),
    pointerState: () => pointerBridge?.state() ?? null,
    proof: () => finalProof,
    presentation: () => presentation?.snapshot() ?? null,
  };
}

if (!root || !canvas) throw new Error("desktop terminal route is missing its host surface");

try {
  presentation = new PresentationController(canvas, {
    defaultBackend: "canvas2d",
    canvas2dOptions: { contextAttributes: { alpha: true, willReadFrequently: true } },
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
if (desktopPerfHooksRequested) {
  globalThis.__desktopPerf = {
    version: "e5-t25b-v1",
    ready: () => desktopPerfInput !== null,
    input: () => desktopPerfInput,
    now: () => performance.now(),
    presents: () => desktopPerfPresentRecords.map((record) => ({ ...record, rect: { ...record.rect } })),
    presentDurations: () => [...desktopPerfPresentDurations],
    clear: () => {
      desktopPerfPresentRecords.length = 0;
      desktopPerfPresentDurations.length = 0;
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
  persist: false,
  slirpNet: false,
  fastInterpreter: true,
  jit: query.get("jit") !== "0",
  quantum: Number(query.get("quantum") || 500_000),
  onState: (state) => setStatus(`linux: ${state}`),
  onProgress: (role, loaded, total) => {
    const progress = total ? `${Math.round((loaded / total) * 100)}%` : `${Math.round(loaded / 1048576)} MB`;
    setStatus(`loading ${role} ${progress}`);
  },
  onOutput,
  onDisplayFrame,
  onError: (error) => {
    latestError = error;
    setStatus(`boot error: ${error.message || error}`, "error");
  },
});

bootPromise.then((value) => {
  controller = value;
  globalThis.__desktopController = controller;
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
      diagnostics.push({ reason: "desktop-perf-hook-load-failed", error: String(error?.message || error) });
    });
  }
  keyboardBridge = createKeyboardBridge(createWasmKeyboardAdapter(controller), {
    onFrame: recordKeyboardFrame,
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  keyboardReconciler = createKeyboardReconciler(keyboardBridge, {
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  keyboardCapture = createKeyboardCapturePolicy({
    initialCaptured: true,
    onGuestEvent: (event) => {
      recordKeyboardEvent(event);
      return keyboardReconciler.handleKeyEvent(event);
    },
    onDiagnostic: (entry) => diagnostics.push(entry),
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
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  detachPointer = attachPointerBridge(canvas, pointerBridge, {
    documentTarget: document,
    windowTarget: window,
    capture: true,
    preventDefault: true,
  });
  canvas.focus();
  document.documentElement.dataset.desktopController = "ready";
  if (latestInspection?.wallpaper && latestInspection.panel.ready && latestInspection.menu) void finishReadiness();
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
