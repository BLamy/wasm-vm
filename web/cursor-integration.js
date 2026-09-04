// E5-T15d: one Chromium route for the cursor-plane integration proof. It composes the shipped
// CursorController and PresentationController; it does not add a protocol or presentation primitive.

import { PresentationController } from "./src/sink/presentation.js";
import { CURSOR_EVENTS, CURSOR_MODES, CursorController } from "./src/sink/cursor-controller.js";

const CURSOR_FORMAT_B8G8R8A8_UNORM = 1;
const CURSOR_WIDTH = 64;
const CURSOR_HEIGHT = 64;
const CURSOR_HOT_X = 10;
const CURSOR_HOT_Y = 3;
const MOVE_COUNT = 500;
const MOVE_BATCH_SIZE = 3;
const MOVE_PERIOD_MS = 6;
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 80;
const FRAME_COUNT = 160;
const FRAME_PERIOD_MS = 4;
const FRAME_DELAY_MS = 30;

const statusEl = document.getElementById("status");
const proofEl = document.getElementById("proof");
const surfaceHost = document.getElementById("surface-host");
const displayCanvas = document.getElementById("display");

function setStatus(text, state = "booting") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function publishProof(proof, state = "ready") {
  if (proofEl) {
    const visible = { ...proof, assetDataUrl: undefined };
    proofEl.textContent = JSON.stringify(visible, null, 2);
  }
  document.documentElement.dataset.e5T15dProof = JSON.stringify({
    ...proof,
    assetDataUrl: undefined,
  });
  document.documentElement.dataset.e5T15d = state;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate, label, timeoutMs = 10_000) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (performance.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(5);
  }
}

function cursorWord(x, y) {
  const checker = (x + y) % 2 === 0;
  const red = checker ? 0xe5 : 0x19;
  const green = checker ? 0x19 : 0xe5;
  const blue = x === CURSOR_HOT_X && y === CURSOR_HOT_Y ? 0xff : 0x44;
  const alpha = ((x + y) % 4) === 0 ? 0 : ((x + y) % 4) === 1 ? 0x80 : 0xff;
  return ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
}

function makeCursorWords() {
  const words = new Uint32Array(CURSOR_WIDTH * CURSOR_HEIGHT);
  for (let y = 0; y < CURSOR_HEIGHT; y += 1) {
    for (let x = 0; x < CURSOR_WIDTH; x += 1) words[y * CURSOR_WIDTH + x] = cursorWord(x, y);
  }
  return words;
}

function frameWord(index, seed) {
  const x = index % FRAME_WIDTH;
  const y = Math.floor(index / FRAME_WIDTH);
  const red = (seed + x * 3 + y) & 0xff;
  const green = (seed * 5 + x + y * 2) & 0xff;
  const blue = (seed * 11 + x * 2 + y * 7) & 0xff;
  return (0xff000000 | (red << 16) | (green << 8) | blue) >>> 0;
}

function makeFrame(seed) {
  const frame = new Uint32Array(FRAME_WIDTH * FRAME_HEIGHT);
  for (let index = 0; index < frame.length; index += 1) frame[index] = frameWord(index, seed);
  return frame;
}

function cursorState(resourceId, hotX, hotY, x, y) {
  return { resourceId, hotX, hotY, pos: { scanoutId: 0, x, y } };
}

function overlaySnapshot(overlay) {
  if (!overlay) return null;
  return {
    src: overlay.src,
    width: overlay.style.width,
    height: overlay.style.height,
    display: overlay.style.display,
    left: overlay.style.left,
    top: overlay.style.top,
    pointerEvents: overlay.style.pointerEvents,
    userSelect: overlay.style.userSelect,
    willChange: overlay.style.willChange,
    transformOrigin: overlay.style.transformOrigin,
    zIndex: overlay.style.zIndex,
    transform: overlay.style.transform,
  };
}

function installTransformTracker(element) {
  requireCondition(element && element.style, "cursor overlay style is unavailable");
  const nativeStyle = element.style;
  const priorOwnDescriptor = Object.getOwnPropertyDescriptor(element, "style");
  let active = false;
  let writes = 0;
  const proxy = new Proxy(nativeStyle, {
    set(target, property, value, receiver) {
      if (active && property === "transform") writes += 1;
      return Reflect.set(target, property, value, receiver);
    },
  });
  Object.defineProperty(element, "style", { configurable: true, value: proxy });
  return {
    setActive(value) { active = value; },
    writes() { return writes; },
    restore() {
      if (priorOwnDescriptor) Object.defineProperty(element, "style", priorOwnDescriptor);
      else delete element.style;
    },
  };
}

function installLayoutGuard(target) {
  let reads = 0;
  const prior = target.getBoundingClientRect;
  target.getBoundingClientRect = () => {
    reads += 1;
    throw new Error("layout read is forbidden during cursor movement");
  };
  return {
    reads() { return reads; },
    restore() {
      if (prior === undefined) delete target.getBoundingClientRect;
      else target.getBoundingClientRect = prior;
    },
  };
}

function startDelayedFrames(presentation) {
  let requested = 0;
  let delivered = 0;
  let pending = 0;
  let maxPending = 0;
  let interval = null;
  const delayedTimers = new Set();
  const startedAt = performance.now();
  const finished = new Promise((resolve) => {
    interval = setInterval(() => {
      requested += 1;
      pending += 1;
      maxPending = Math.max(maxPending, pending);
      const timer = setTimeout(() => {
        delayedTimers.delete(timer);
        pending -= 1;
        delivered += 1;
        presentation.present({
          format: 2,
          rect: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT },
          resourceWidth: FRAME_WIDTH,
          resourceHeight: FRAME_HEIGHT,
          pixels: makeFrame(requested),
        });
      }, FRAME_DELAY_MS);
      delayedTimers.add(timer);
      if (requested === FRAME_COUNT) {
        clearInterval(interval);
        interval = null;
        resolve();
      }
    }, FRAME_PERIOD_MS);
  });
  return {
    finished,
    get pending() { return pending; },
    async drain() {
      await finished;
      await waitUntil(() => pending === 0, "delayed framebuffer callbacks");
      return {
        requested,
        delivered,
        periodMs: FRAME_PERIOD_MS,
        delayMs: FRAME_DELAY_MS,
        maxPending: maxPending,
        elapsedMs: performance.now() - startedAt,
        delayedTimers: delayedTimers.size,
      };
    },
    cancel() {
      if (interval !== null) clearInterval(interval);
      interval = null;
      for (const timer of delayedTimers) clearTimeout(timer);
      delayedTimers.clear();
    },
  };
}

async function runMovement(controller, delayedFrames, tracker, layoutGuard) {
  await sleep(FRAME_PERIOD_MS);
  const startedAt = performance.now();
  let movesDuringDelayedFrame = 0;
  tracker.setActive(true);
  try {
    for (let index = 0; index < MOVE_COUNT; index += 1) {
      const x = 120 + index;
      const y = 80 + index;
      const result = controller.handle({
        type: CURSOR_EVENTS.MOVE,
        state: cursorState(7, CURSOR_HOT_X, CURSOR_HOT_Y, x, y),
        format: null,
        resourceWidth: 0,
        resourceHeight: 0,
        pixels: new Uint32Array(0),
      });
      requireCondition(result !== false, `MOVE ${index} was rejected`);
      if (delayedFrames.pending > 0) movesDuringDelayedFrame += 1;
      if ((index + 1) % MOVE_BATCH_SIZE === 0) await sleep(MOVE_PERIOD_MS);
    }
  } finally {
    tracker.setActive(false);
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    requested: MOVE_COUNT,
    requestedHz: (1_000 * MOVE_BATCH_SIZE) / MOVE_PERIOD_MS,
    observedHz: MOVE_COUNT / (elapsedMs / 1_000),
    elapsedMs,
    movesDuringDelayedFrame,
    layoutReads: layoutGuard.reads(),
    transformWrites: tracker.writes(),
    final: { x: 120 + MOVE_COUNT - 1, y: 80 + MOVE_COUNT - 1 },
  };
}

let integrationPromise = null;
async function runIntegration() {
  if (integrationPromise) return integrationPromise;
  integrationPromise = (async () => {
    requireCondition(surfaceHost && displayCanvas, "cursor integration surface is missing");
    setStatus("running cursor asset, delayed-frame, and 500 Hz proof…");
    const diagnostics = [];
    const controller = new CursorController({
      target: surfaceHost,
      documentTarget: document,
      overlayParent: surfaceHost,
      onDiagnostic: (entry) => diagnostics.push(entry),
    });
    const presentation = new PresentationController(displayCanvas, {
      defaultBackend: "canvas2d",
      scheduleFrames: true,
      requestFrame: (callback) => setTimeout(() => callback(performance.now()), FRAME_DELAY_MS),
      cancelFrame: (token) => clearTimeout(token),
    });
    const delayedFrames = startDelayedFrames(presentation);
    let tracker = null;
    let layoutGuard = null;
    try {
      const initial = {
        hostCursor: surfaceHost.style.cursor,
        overlays: surfaceHost.querySelectorAll(".wvm-cursor-overlay").length,
        cursor: controller.snapshot(),
      };
      requireCondition(initial.hostCursor === "", "no-traffic path changed the host cursor");
      requireCondition(initial.overlays === 0, "no-traffic path created an overlay");

      const words = makeCursorWords();
      const update = controller.handle({
        type: CURSOR_EVENTS.UPDATE,
        state: cursorState(7, CURSOR_HOT_X, CURSOR_HOT_Y, 100, 100),
        format: CURSOR_FORMAT_B8G8R8A8_UNORM,
        resourceWidth: CURSOR_WIDTH,
        resourceHeight: CURSOR_HEIGHT,
        pixels: words,
      });
      requireCondition(update?.kind === "css", "64x64 cursor did not select CSS mode");
      const assetDescriptor = controller.descriptor();
      controller.setPointerState({ mode: CURSOR_MODES.RELATIVE, pointerLocked: true });
      const overlay = surfaceHost.querySelector(".wvm-cursor-overlay");
      requireCondition(overlay, "relative mode did not create an overlay");
      const beforeMoves = overlaySnapshot(overlay);

      tracker = installTransformTracker(overlay);
      layoutGuard = installLayoutGuard(surfaceHost);
      const movement = await runMovement(controller, delayedFrames, tracker, layoutGuard);
      layoutGuard.restore();
      layoutGuard = null;
      tracker.restore();
      tracker = null;
      const afterMoves = overlaySnapshot(overlay);
      const stableOverlay = { ...beforeMoves, transform: undefined };
      const movedOverlay = { ...afterMoves, transform: undefined };
      requireCondition(JSON.stringify(stableOverlay) === JSON.stringify(movedOverlay), "MOVE changed non-transform overlay state");
      requireCondition(movement.layoutReads === 0, "MOVE path measured layout");
      requireCondition(movement.transformWrites === MOVE_COUNT, "MOVE path wrote an unexpected transform count");
      requireCondition(movement.movesDuringDelayedFrame > 0, "no cursor moves overlapped delayed framebuffer work");
      requireCondition(afterMoves.transform === "translate3d(609px, 576px, 0px)", "final transform drifted");

      const frameLoad = await delayedFrames.drain();
      await waitUntil(() => {
        const scheduler = presentation.snapshot().scheduler;
        return scheduler?.pending === 0 && scheduler?.scheduled === false;
      }, "delayed framebuffer presentation drain");
      const display = presentation.snapshot();
      requireCondition(frameLoad.requested === FRAME_COUNT, "frame request count drifted");
      requireCondition(frameLoad.delivered === FRAME_COUNT, "delayed frame delivery count drifted");
      requireCondition(display.scheduler.maxPending === 1, "frame scheduler pending bound grew");
      requireCondition(display.scheduler.coalesced > 0, "delayed framebuffer did not exercise coalescing");
      requireCondition(display.successfulPresents > 0, "delayed framebuffer produced no presents");

      const oversizedUpdate = controller.handle({
        type: CURSOR_EVENTS.UPDATE,
        state: cursorState(9, 255, 255, 120, 80),
        format: CURSOR_FORMAT_B8G8R8A8_UNORM,
        resourceWidth: 256,
        resourceHeight: 256,
        pixels: new Uint32Array(256 * 256).fill(0x80402010),
      });
      requireCondition(oversizedUpdate?.kind === "overlay", "oversized cursor did not fall back to overlay");
      requireCondition(surfaceHost.querySelectorAll(".wvm-cursor-overlay").length === 1, "oversized replacement leaked an overlay");
      const oversizedDescriptor = controller.descriptor();

      controller.setPositionScale(2);
      const dprMove = controller.handle({
        type: CURSOR_EVENTS.MOVE,
        state: cursorState(9, 255, 255, 40, 30),
        format: null,
        resourceWidth: 0,
        resourceHeight: 0,
        pixels: new Uint32Array(0),
      });
      requireCondition(dprMove !== false, "DPR 2 move was rejected");
      const dprTransform = surfaceHost.querySelector(".wvm-cursor-overlay")?.style.transform || "";
      requireCondition(dprTransform === "translate3d(-175px, -195px, 0px)", "DPR 2 transform drifted");
      controller.setPositionScale(1);

      const hidden = controller.handle({
        type: CURSOR_EVENTS.UPDATE,
        state: cursorState(0, 0, 0, 40, 30),
        format: null,
        resourceWidth: 0,
        resourceHeight: 0,
        pixels: new Uint32Array(0),
      });
      requireCondition(hidden?.kind === "hidden", "resource 0 did not hide the cursor");
      requireCondition(surfaceHost.querySelectorAll(".wvm-cursor-overlay").length === 0, "resource 0 left an overlay");
      requireCondition(surfaceHost.style.cursor === "", "resource 0 did not restore the host cursor");
      const proof = {
        schema: "wasm-vm.e5-t15d.cursor-integration.v1",
        task: "E5-T15d",
        route: "cursor-integration",
        browser: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          devicePixelRatio: window.devicePixelRatio,
        },
        noTraffic: initial,
        asset: {
          kind: assetDescriptor.kind,
          width: assetDescriptor.width,
          height: assetDescriptor.height,
          hotX: assetDescriptor.hotX,
          hotY: assetDescriptor.hotY,
          dataUrlChars: assetDescriptor.dataUrl.length,
          assetDataUrl: assetDescriptor.dataUrl,
        },
        movement: {
          ...movement,
          finalTransform: afterMoves.transform,
          overlayBefore: { ...beforeMoves, src: undefined, transform: undefined },
          overlayAfter: { ...afterMoves, src: undefined, transform: undefined },
        },
        delayedFrames: { ...frameLoad, presentation: display },
        oversized: {
          kind: oversizedDescriptor.kind,
          width: oversizedDescriptor.width,
          height: oversizedDescriptor.height,
          hotX: oversizedDescriptor.hotX,
          hotY: oversizedDescriptor.hotY,
          dataUrlChars: oversizedDescriptor.src.length,
          maxDataUrlChars: 350_006,
          overlays: 1,
        },
        dpr2: { transform: dprTransform, scale: 2 },
        hidden: {
          kind: hidden.kind,
          resourceId: controller.snapshot().resourceId,
          hostCursor: surfaceHost.style.cursor,
          overlays: surfaceHost.querySelectorAll(".wvm-cursor-overlay").length,
        },
        diagnostics: diagnostics.length,
      };
      publishProof(proof);
      setStatus("cursor plane integration proof ready", "ready");
      globalThis.__e5T15dProof = () => proof;
      return proof;
    } catch (error) {
      const proof = {
        schema: "wasm-vm.e5-t15d.cursor-integration.v1",
        task: "E5-T15d",
        route: "cursor-integration",
        error: String(error?.message || error),
      };
      publishProof(proof, "error");
      setStatus(`cursor integration failed: ${error.message || error}`, "error");
      globalThis.__e5T15dProof = () => proof;
      throw error;
    } finally {
      layoutGuard?.restore();
      tracker?.restore();
      delayedFrames.cancel();
      presentation.dispose();
      controller.dispose();
    }
  })();
  return integrationPromise;
}

document.documentElement.dataset.e5T15dReady = "ready";
globalThis.runE5T15dIntegration = runIntegration;
globalThis.__e5T15dProof = () => null;
setStatus("ready for cursor integration proof", "ready");
