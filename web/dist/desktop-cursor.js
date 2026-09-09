// E5-T18c: local Chromium proof for guest cursor alignment and Weston window-control hit tests.
// The verified T18b desktop route owns boot, presentation, and the real pointer transport. This
// page adds only CSS-space geometry inspection and records the visual state around real controls.

import {
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  clientPointFromGuest,
  guestPixelFromClient,
  hitTestGuestPixel,
  tabletPointFromGuest,
  westonWindowControls,
} from "./src/input/desktop-geometry.js";
import { findGuestCursor } from "./src/input/desktop-cursor-template.js";

const canvas = document.getElementById("desktop-canvas");
const statusEl = document.getElementById("desktop-status");
const proofEl = document.getElementById("cursor-proof");
const dprEl = document.getElementById("cursor-dpr");
const hoverEl = document.getElementById("cursor-hover");
const maximizeEl = document.getElementById("cursor-maximize");
const closeEl = document.getElementById("cursor-close");
const repeatEl = document.getElementById("cursor-repeat");

let finalProof = null;
let activeHover = null;
let activeButton = null;
const interactions = {
  hovers: [],
  maximizes: [],
  closes: [],
};

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

function pixels() {
  if (!canvas) throw new Error("desktop cursor canvas is missing");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("desktop cursor canvas has no 2D context");
  return new Uint8ClampedArray(context.getImageData(0, 0, DESKTOP_WIDTH, DESKTOP_HEIGHT).data);
}

function pixelAt(bytes, x, y) {
  const column = Math.max(0, Math.min(DESKTOP_WIDTH - 1, Math.round(x)));
  const row = Math.max(0, Math.min(DESKTOP_HEIGHT - 1, Math.round(y)));
  const offset = (row * DESKTOP_WIDTH + column) * 4;
  return [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
}

function diffRegion(before, after, center, radiusX = 18, radiusY = 13) {
  if (!before || !after || before.length !== after.length) return 0;
  const left = Math.max(0, Math.floor(center.x - radiusX));
  const right = Math.min(DESKTOP_WIDTH, Math.ceil(center.x + radiusX + 1));
  const top = Math.max(0, Math.floor(center.y - radiusY));
  const bottom = Math.min(DESKTOP_HEIGHT, Math.ceil(center.y + radiusY + 1));
  let changed = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * DESKTOP_WIDTH + x) * 4;
      if (Math.abs(before[offset] - after[offset]) > 8 ||
          Math.abs(before[offset + 1] - after[offset + 1]) > 8 ||
          Math.abs(before[offset + 2] - after[offset + 2]) > 8) changed += 1;
    }
  }
  return changed;
}

function diffAll(before, after) {
  if (!before || !after || before.length !== after.length) return 0;
  let changed = 0;
  for (let offset = 0; offset < before.length; offset += 4) {
    if (Math.abs(before[offset] - after[offset]) > 8 ||
        Math.abs(before[offset + 1] - after[offset + 1]) > 8 ||
        Math.abs(before[offset + 2] - after[offset + 2]) > 8) changed += 1;
  }
  return changed;
}



function darkWindowBodyGroups(bytes) {
  const rows = [];
  // The panel can obscure all but seven rows of a newly placed titlebar. Recover that window
  // from its client body, not the panel-darkened titlebar (which does not mean lost focus).
  for (let y = 32; y < DESKTOP_HEIGHT; y += 1) {
    let dark = 0;
    let first = DESKTOP_WIDTH;
    let last = -1;
    for (let x = 0; x < DESKTOP_WIDTH; x += 1) {
      const [red, green, blue] = pixelAt(bytes, x, y);
      if (red < 65 && green < 65 && blue < 65) {
        dark += 1;
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
    if (dark >= 240 && last >= first) rows.push({ y, dark, first, last });
  }
  const groups = [];
  for (const row of rows) {
    const previous = groups.at(-1);
    if (!previous || row.y !== previous.at(-1).y + 1) groups.push([row]);
    else previous.push(row);
  }
  return groups.filter((group) => group.length >= 40);
}

function largestDarkWindow(bytes) {
  const bodyGroups = darkWindowBodyGroups(bytes);
  if (bodyGroups.length === 0) return null;
  const body = bodyGroups.sort((leftGroup, rightGroup) => {
    const leftArea = leftGroup.length * (leftGroup[0].last - leftGroup[0].first);
    const rightArea = rightGroup.length * (rightGroup[0].last - rightGroup[0].first);
    return rightArea - leftArea;
  })[0];
  // An arrow can extend a few rows beyond either edge. The dominant edge across the client
  // height ignores that outlier; extrema or per-row edge jumps would let the cursor resize it.
  const dominant = (key) => {
    const counts = new Map();
    for (const row of body) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  };
  const left = dominant("first");
  const right = dominant("last") + 1;
  const titleBottom = body[0].y;
  return {
    window: { left, top: Math.max(0, titleBottom - 26), right, bottom: body.at(-1).y + 1 },
    titlebar: { top: Math.max(0, titleBottom - 26), bottom: titleBottom, left, right },
  };
}

/** Recover stable CSD geometry from the client body; hover colors must not resize the bounds. */
export function detectWindowChrome(bytes = pixels()) {
  const body = largestDarkWindow(bytes);
  if (!body) return null;
  const controls = westonWindowControls(body.window);
  if (controls.length === 0) return null;
  return {
    ...body,
    controls,
    samples: Object.fromEntries(controls.map((control) => [control.name, pixelAt(bytes, control.x, control.y)])),
  };
}

function canvasRect() {
  const rect = canvas?.getBoundingClientRect?.();
  if (!rect) throw new Error("desktop cursor canvas has no CSS rect");
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function pointerState() {
  return globalThis.__desktopTerminal?.state?.() || null;
}

function lastTabletMove(state) {
  return [...(state?.pointerFrameSample || [])].reverse().find(
    (frame) => frame.device === "tablet" && frame.source === "pointermove",
  ) || null;
}

function mappingForControl(control) {
  const rect = canvasRect();
  const client = clientPointFromGuest(control, rect);
  const guest = guestPixelFromClient(client.x, client.y, rect);
  const tablet = tabletPointFromGuest(control, rect);
  const hit = hitTestGuestPixel(guest, [control]);
  return {
    cssRect: rect,
    client,
    guest,
    tablet,
    hit: hit?.name || null,
  };
}

function focusGuestPoint() {
  const chrome = detectWindowChrome();
  if (!chrome) return null;
  const { window: windowRect, titlebar } = chrome;
  const bodyTop = Math.max(titlebar.bottom, windowRect.top);
  return {
    x: Math.round((windowRect.left + windowRect.right) / 2),
    // The T18b path focuses foot through its client body: tablet motion establishes the guest
    // coordinate and the production mouse seat supplies the activation button.
    y: Math.round((bodyTop + windowRect.bottom) / 2),
  };
}

function startHover(control, label = control?.name || "hover") {
  if (!control) throw new Error("hover control is missing");
  activeHover = {
    label: String(label),
    control: { ...control },
    before: pixels(),
    pointerBefore: pointerState()?.pointerFrames || 0,
    mapping: mappingForControl(control),
  };
  interactions.hovers.push(activeHover);
  return publicState();
}

// White/black cursor pixels cannot satisfy this predicate: a cursor repaint alone is not a
// hover highlight. The colored background must occupy a substantial part of the actual button.
function hoverHighlights(chrome = detectWindowChrome(), bytes = pixels()) {
  return (chrome?.controls || []).map((control) => {
    let coloredPixels = 0;
    for (let y = control.top; y < control.bottom; y += 1) {
      for (let x = control.left; x < control.right; x += 1) {
        const [r, g, b] = pixelAt(bytes, x, y);
        const colored = control.name === "maximize" ? g > r + 40 && g > b + 40 :
          control.name === "close" ? r > g + 40 && r > b + 40 : b > r + 40 && b > g + 30;
        if (colored) coloredPixels += 1;
      }
    }
    const threshold = Math.max(12, Math.floor((control.right - control.left) * (control.bottom - control.top) / 5));
    return { name: control.name, coloredPixels, threshold, highlighted: coloredPixels >= threshold };
  });
}

function renderedCursor(point, bytes = pixels()) {
  return findGuestCursor(bytes, DESKTOP_WIDTH, DESKTOP_HEIGHT, point);
}

function finishHover() {
  if (!activeHover) throw new Error("no active hover proof");
  const record = activeHover;
  const after = pixels();
  const state = pointerState();
  const frame = lastTabletMove(state);
  record.pointerAfter = state?.pointerFrames || 0;
  record.pointerFrames = record.pointerAfter - record.pointerBefore;
  record.frameCoordinates = frame?.coordinates || null;
  record.hoverDiffPixels = diffRegion(record.before, after, record.control);
  record.beforePixel = pixelAt(record.before, record.control.x, record.control.y);
  record.afterPixel = pixelAt(after, record.control.x, record.control.y);
  record.highlights = hoverHighlights(detectWindowChrome(after), after);
  record.renderedCursor = renderedCursor(record.control, after);
  record.cursorMatches = record.renderedCursor?.x === record.control.x && record.renderedCursor?.y === record.control.y;
  record.highlightMatches = record.highlights.filter((entry) => entry.highlighted).map((entry) => entry.name).join() === record.control.name;
  record.mappingMatches = Boolean(frame?.coordinates) &&
    Math.abs(frame.coordinates.x - record.mapping.tablet.x) <= 1 &&
    Math.abs(frame.coordinates.y - record.mapping.tablet.y) <= 1;
  record.guestPixelMatches = record.mapping.guest.x === record.control.x && record.mapping.guest.y === record.control.y;
  record.accepted = record.pointerFrames >= 1 && record.mappingMatches && record.guestPixelMatches && record.highlightMatches && record.cursorMatches;
  delete record.before;
  activeHover = null;
  if (!record.accepted) throw new Error(`guest hover did not align: ${JSON.stringify(record)}`);
  setMarker(hoverEl, true, "cursor hover aligned");
  return publicState();
}

function startButton(name, control) {
  if (!control) throw new Error(`${name} control is missing`);
  activeButton = {
    name: String(name),
    control: { ...control },
    before: pixels(),
    beforeChrome: detectWindowChrome(),
    pointerBefore: pointerState()?.pointerFrames || 0,
    mapping: mappingForControl(control),
  };
  if (name === "maximize") interactions.maximizes.push(activeButton);
  if (name === "close") interactions.closes.push(activeButton);
  return publicState();
}

function finishButton(closeProbe = null) {
  if (!activeButton) throw new Error("no active button proof");
  const record = activeButton;
  const after = pixels();
  const state = pointerState();
  const frame = lastTabletMove(state);
  record.pointerAfter = state?.pointerFrames || 0;
  record.pointerFrames = record.pointerAfter - record.pointerBefore;
  record.frameCoordinates = frame?.coordinates || null;
  record.mappingMatches = Boolean(frame?.coordinates) &&
    Math.abs(frame.coordinates.x - record.mapping.tablet.x) <= 1 &&
    Math.abs(frame.coordinates.y - record.mapping.tablet.y) <= 1;
  record.guestPixelMatches = record.mapping.guest.x === record.control.x && record.mapping.guest.y === record.control.y;
  record.visualDiffPixels = diffAll(record.before, after);
  record.afterChrome = detectWindowChrome(after);
  record.windowChanged = JSON.stringify(record.beforeChrome?.window) !== JSON.stringify(record.afterChrome?.window);
  record.windowMaximized = record.name === "maximize" && record.afterChrome?.window.left === 0 &&
    record.afterChrome.window.top === 32 && record.afterChrome.window.right === DESKTOP_WIDTH &&
    record.afterChrome.window.bottom === DESKTOP_HEIGHT;
  record.closeProbe = closeProbe;
  record.windowClosed = record.name === "close" && record.afterChrome === null &&
    closeProbe?.windowRestored === false && closeProbe.retiredInstructions >= 100_000_000;
  record.accepted = record.pointerFrames >= 1 && record.mappingMatches && record.guestPixelMatches &&
    record.visualDiffPixels >= 2_000 && (record.name === "maximize" ? record.windowMaximized : record.windowClosed);
  delete record.before;
  activeButton = null;
  if (!record.accepted) throw new Error(`${record.name} button did not hit its window: ${JSON.stringify(record)}`);
  if (record.name === "maximize") setMarker(maximizeEl, true, "maximize hit-test");
  if (record.name === "close") setMarker(closeEl, true, "close hit-test");
  return publicState();
}

function safeRecord(record) {
  if (!record) return null;
  const copy = { ...record };
  delete copy.before;
  return copy;
}

function publicState() {
  return {
    devicePixelRatio: Number(globalThis.devicePixelRatio || 1),
    canvas: { width: canvas?.width || 0, height: canvas?.height || 0, cssRect: canvasRect() },
    pointer: { ...globalThis.__desktopTerminal?.pointerState?.(), diagnostics: pointerState()?.diagnostics || [] },
    chrome: detectWindowChrome(),
    hovers: interactions.hovers.map(safeRecord),
    maximizes: interactions.maximizes.map(safeRecord),
    closes: interactions.closes.map(safeRecord),
    active: { hover: safeRecord(activeHover), button: safeRecord(activeButton) },
  };
}

async function finishProof() {
  if (finalProof) return finalProof;
  const controller = globalThis.__desktopController;
  if (!controller) throw new Error("desktop controller is missing");
  if (activeHover || activeButton) throw new Error("cursor proof has an active interaction");
  await controller.pause();
  const [stateDigest, fetchStats, paused] = await Promise.all([
    controller.stateDigest?.() ?? null,
    controller.fetchStats?.() ?? null,
    controller.isPaused?.() ?? false,
  ]);
  finalProof = {
    schema: "wasm-vm.e5-t18c.desktop-cursor-dpr-hit-testing.v1",
    task: "E5-T18c",
    route: "desktop-cursor",
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    devicePixelRatio: Number(globalThis.devicePixelRatio || 1),
    canvas: publicState().canvas,
    hovers: interactions.hovers.map(safeRecord),
    maximizes: interactions.maximizes.map(safeRecord),
    closes: interactions.closes.map(safeRecord),
    pointer: { ...globalThis.__desktopTerminal?.pointerState?.(), diagnostics: pointerState()?.diagnostics || [] },
    chrome: detectWindowChrome(),
    stateDigest,
    fetchStats,
    paused: paused === true,
    error: null,
  };
  proofEl.textContent = JSON.stringify(finalProof, null, 2);
  setStatus(`cursor geometry proof ready at DPR ${finalProof.devicePixelRatio}`, "ready");
  setMarker(dprEl, true, `DPR ${finalProof.devicePixelRatio} matrix`);
  setMarker(repeatEl, true, "repeat/focus stable");
  document.documentElement.dataset.desktopCursorReady = "ready";
  document.documentElement.dataset.desktopCursorProof = JSON.stringify(finalProof);
  globalThis.__desktopCursorProof = () => finalProof;
  return finalProof;
}

function publicApi() {
  return {
    state: publicState,
    pixels,
    detectWindowChrome,
    hoverHighlights,
    renderedCursor,
    mappingForControl,
    focusGuestPoint,
    startHover,
    finishHover,
    startButton,
    finishButton,
    finishProof,
    proof: () => finalProof,
  };
}

if (!canvas || !proofEl) throw new Error("desktop cursor route is missing its proof surface");
globalThis.__desktopCursor = publicApi();
globalThis.__desktopCursorProof = () => finalProof;
setStatus("desktop booting: cursor geometry pending");
