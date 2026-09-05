// E5-T18a: local Chromium proof for the T17 desktop image. This route deliberately has no input
// bridge: it owns only cold-load assembly, scanout presentation, and the visible wallpaper/panel/
// WM-menu readiness contract. Later T18 slices add terminal, pointer, and recovery interactions.

import { startLinuxBootWorker } from "./linux-worker-host.js";
import { PresentationController } from "./src/sink/presentation.js";

const WIDTH = 1280;
const HEIGHT = 800;
const MAX_SERIAL_BYTES = 500_000;
const EXPECTED_IMAGE_SHA256 = "467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e";
const EXPECTED_CHUNK_MANIFEST_SHA256 = "1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827";

const query = new URLSearchParams(location.search);
const canvas = document.getElementById("desktop-canvas");
const statusEl = document.getElementById("desktop-status");
const proofEl = document.getElementById("desktop-proof");
const wallpaperEl = document.getElementById("desktop-wallpaper");
const panelEl = document.getElementById("desktop-panel");
const menuEl = document.getElementById("desktop-menu");
const bootStartedAt = performance.now();

let presentation = null;
let controller = null;
let serialText = "";
let frameCount = 0;
let lastInspectionAt = 0;
let latestInspection = null;
let lastInspectionLogAt = 0;
let lastSerialLogAt = 0;
let finalProof = null;
let displayError = null;
let readyScheduled = false;
const decoder = new TextDecoder();

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

function rgbaAt(bytes, x, y) {
  const offset = (y * WIDTH + x) * 4;
  return [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
}

function colorDistance(left, right) {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
}

function averageRow(bytes, y, start = 0, end = WIDTH) {
  let red = 0;
  let green = 0;
  let blue = 0;
  const first = Math.max(0, Math.min(WIDTH - 1, start));
  const last = Math.max(first + 1, Math.min(WIDTH, end));
  for (let x = first; x < last; x += 1) {
    const offset = (y * WIDTH + x) * 4;
    red += bytes[offset];
    green += bytes[offset + 1];
    blue += bytes[offset + 2];
  }
  const count = last - first;
  return [red / count, green / count, blue / count];
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

function nonBlackRatio(bytes) {
  let count = 0;
  for (let index = 0; index < bytes.length; index += 32) {
    if (bytes[index] > 8 || bytes[index + 1] > 8 || bytes[index + 2] > 8) count += 1;
  }
  return count / Math.ceil(bytes.length / 32);
}

function rowBandScore(bytes, top, height, wallpaper) {
  const bottom = Math.min(HEIGHT, top + height);
  let different = 0;
  let edgeChanges = 0;
  let previous = null;
  for (let y = top; y < bottom; y += 2) {
    const average = averageRow(bytes, y);
    if (colorDistance(average, wallpaper) > 24) different += 1;
    if (previous && colorDistance(average, previous) > 16) edgeChanges += 1;
    previous = average;
  }
  const rows = Math.ceil((bottom - top) / 2);
  return { differentRatio: different / rows, edgeChanges, mean: averageRegion(bytes, top, bottom) };
}

function inkStats(bytes, top, bottom, panelColor) {
  let inkPixels = 0;
  let runs = 0;
  let inRun = false;
  for (let y = top; y < bottom; y += 2) {
    for (let x = 0; x < WIDTH; x += 2) {
      const offset = (y * WIDTH + x) * 4;
      const pixel = [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
      const ink = colorDistance(pixel, panelColor) > 42 && (pixel[0] + pixel[1] + pixel[2]) > 100;
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
  const candidates = [
    { position: "top", top: 0 },
    { position: "bottom", top: HEIGHT - 80 },
  ].map((candidate) => ({
    ...candidate,
    band: rowBandScore(bytes, candidate.top, 80, background),
  }));
  const selected = candidates.sort((left, right) =>
    (right.band.differentRatio + right.band.edgeChanges / 40)
    - (left.band.differentRatio + left.band.edgeChanges / 40))[0];
  const panelReady = wallpaper
    && selected.band.differentRatio >= 0.35
    && colorDistance(selected.band.mean, background) > 18;
  const panelColor = selected.band.mean;
  const ink = inkStats(bytes, selected.top, Math.min(HEIGHT, selected.top + 80), panelColor);
  // Weston desktop-shell's launcher/menu affordance is a compact, high-contrast run of glyphs in
  // the panel. Requiring several independent runs prevents a plain framebuffer or a boot splash
  // from being misreported as a ready WM menu.
  const menu = panelReady && ink.inkPixels >= 24 && ink.runs >= 8;
  return {
    wallpaper,
    panel: {
      ready: panelReady,
      position: selected.position,
      top: selected.top,
      height: 80,
      mean: panelColor.map(clampByte),
      difference: Math.round(colorDistance(panelColor, background)),
    },
    menu,
    nonBlackRatio: nonBlack,
    background: background.map(clampByte),
    menuDetails: { ready: menu, inkPixels: ink.inkPixels, runs: ink.runs },
  };
}

function publishLiveInspection(inspection) {
  latestInspection = inspection;
  globalThis.__desktopLiveInspection = () => latestInspection;
  document.documentElement.dataset.desktopInspection = JSON.stringify(inspection);
  setMarker(wallpaperEl, inspection.wallpaper, "wallpaper");
  setMarker(panelEl, inspection.panel.ready, "panel");
  setMarker(menuEl, inspection.menu, "WM menu");
  if (inspection.wallpaper && inspection.panel.ready && inspection.menu) {
    scheduleFinish();
  }
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function finishDesktop() {
  if (finalProof || !controller || displayError) return;
  await controller.pause();
  const pixels = presentation.readPixels();
  const inspection = inspectDesktop(pixels);
  const state = presentation.snapshot();
  const [scheduler, fetchStats, stateDigest, paused] = await Promise.all([
    controller.schedulerStats?.() ?? null,
    controller.fetchStats?.() ?? null,
    controller.stateDigest?.() ?? null,
    controller.isPaused?.() ?? false,
  ]);
  const imageManifestUrl = query.get("imageManifestUrl") || "./e5t18a-desktop/manifest.json";
  const imageManifestText = await (await fetch(imageManifestUrl, { cache: "no-store" })).text();
  const imageManifest = JSON.parse(imageManifestText);
  const proof = {
    schema: "wasm-vm.e5-t18a.desktop-cold-boot.v1",
    task: "E5-T18a",
    route: "desktop",
    image: {
      expectedSha256: EXPECTED_IMAGE_SHA256,
      manifestUrl: imageManifestUrl,
      manifestSha256: await sha256Hex(new TextEncoder().encode(imageManifestText)),
      expectedManifestSha256: EXPECTED_CHUNK_MANIFEST_SHA256,
      imageLen: imageManifest.image_len,
      chunkSize: imageManifest.chunk_size,
      chunkCount: Array.isArray(imageManifest.chunks) ? imageManifest.chunks.length : null,
      layout: imageManifest.layout,
    },
    readiness: inspection,
    selectedBackend: state.backend,
    canvas: { width: state.width, height: state.height },
    frameCount,
    bootToDesktopMs: Math.round(performance.now() - bootStartedAt),
    serialBytes: new TextEncoder().encode(serialText).byteLength,
    serialSha256: await sha256Hex(new TextEncoder().encode(serialText)),
    serialTail: serialText.slice(-2_000),
    presentation: state,
    scheduler,
    fetchStats,
    stateDigest,
    paused: paused === true,
  };
  finalProof = proof;
  proofEl.textContent = JSON.stringify(proof, null, 2);
  setStatus("desktop ready: wallpaper · panel · WM menu", "ready");
  document.documentElement.dataset.desktopReady = "ready";
  document.documentElement.dataset.desktopWallpaper = "ready";
  document.documentElement.dataset.desktopPanel = "ready";
  document.documentElement.dataset.desktopMenu = "ready";
  document.documentElement.dataset.desktopProof = JSON.stringify(proof);
  globalThis.__desktopProof = () => finalProof;
}

function scheduleFinish() {
  if (readyScheduled || finalProof || !controller) return;
  readyScheduled = true;
  void finishDesktop().catch((error) => {
    displayError = error;
    readyScheduled = false;
    setStatus(`desktop proof failed: ${error.message || error}`, "error");
    document.documentElement.dataset.desktopReady = "error";
  });
}

function onDisplayFrame(frame) {
  if (!presentation) return false;
  try {
    const reached = presentation.present(frame);
    frameCount += 1;
    const now = performance.now();
    if (now - lastInspectionAt >= 1_000 || frameCount === 1) {
      lastInspectionAt = now;
      const inspection = inspectDesktop(presentation.readPixels());
      publishLiveInspection(inspection);
      if (now - lastInspectionLogAt >= 5_000) {
        lastInspectionLogAt = now;
        console.info(`E5T18A_INSPECTION ${JSON.stringify({ frameCount, ...inspection })}`);
      }
    }
    return reached;
  } catch (error) {
    displayError = error;
    setStatus(`display error: ${error.message || error}`, "error");
    document.documentElement.dataset.desktopReady = "error";
    return false;
  }
}

function onOutput(bytes) {
  serialText += decoder.decode(bytes, { stream: true });
  if (serialText.length > MAX_SERIAL_BYTES) serialText = serialText.slice(-MAX_SERIAL_BYTES);
  const now = performance.now();
  if (now - lastSerialLogAt >= 5_000) {
    lastSerialLogAt = now;
    console.info(`E5T18A_SERIAL ${JSON.stringify(serialText.slice(-1_000))}`);
  }
}

if (!canvas) throw new Error("desktop canvas is missing");
try {
  presentation = new PresentationController(canvas, {
    defaultBackend: "canvas2d",
    canvas2dOptions: { contextAttributes: { alpha: true, willReadFrequently: true } },
  });
  document.documentElement.dataset.desktopBackend = presentation.backendName;
} catch (error) {
  displayError = error;
  setStatus(`display unavailable: ${error.message || error}`, "error");
  throw error;
}

globalThis.__desktopProof = () => finalProof;

const bootPromise = startLinuxBootWorker({
  manifestUrl: query.get("manifestUrl") || "./artifacts-alpine.json",
  mode: "chunked",
  imageManifestUrl: query.get("imageManifestUrl") || "./e5t18a-desktop/manifest.json",
  bootProfileUrl: query.get("bootProfileUrl") || null,
  baseUrl: query.get("baseUrl") || "./e5t18a-desktop/",
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
  onError: (error) => setStatus(`boot error: ${error.message || error}`, "error"),
});

bootPromise.then((value) => {
  controller = value;
  globalThis.__desktopController = controller;
  if (latestInspection?.wallpaper && latestInspection.panel.ready && latestInspection.menu) scheduleFinish();
}, (error) => {
  displayError = error;
  setStatus(`boot failed: ${error.message || error}`, "error");
  document.documentElement.dataset.desktopReady = "error";
});

addEventListener("beforeunload", () => { void controller?.stop?.(); });
