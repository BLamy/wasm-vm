// E5-T09e: one Chromium integration route for tiled/full-frame A/B, frame pacing, visibility
// resume, and a forced-hidden Linux boot. The route proves existing T09a-d primitives; it does
// not add a GPU protocol or scheduler primitive. Independent machines, WebKit, and host rr are
// intentionally outside this acceptance boundary.

import { startLinuxBoot } from "./loader.js";
import { Canvas2DBackend } from "./src/sink/canvas2d.js";
import { PresentationController } from "./src/sink/presentation.js";
import { VisibilityFrameScheduler } from "./src/sink/visibility-scheduler.js";

const WIDTH = 1280;
const HEIGHT = 800;
const TILE_SIZE = 64;
const FULL_RECT = Object.freeze({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
const FULL_FRAME_BYTES = WIDTH * HEIGHT * 4;
const CURSOR_RECT = Object.freeze({ x: 64, y: 64, width: 16, height: 16 });
const MODE = new URLSearchParams(location.search).get("mode") || "integration";
const statusEl = document.getElementById("status");
const proofEl = document.getElementById("proof");
const serialEl = document.getElementById("serial");
const displayCanvas = document.getElementById("integration-canvas");

const pageVm = globalThis.vm && typeof globalThis.vm === "object" && !Array.isArray(globalThis.vm)
  ? globalThis.vm
  : {};
if (!pageVm.stats || typeof pageVm.stats !== "object" || Array.isArray(pageVm.stats)) pageVm.stats = {};
globalThis.vm = pageVm;

function setStatus(text, state = "booting") {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function publishProof(name, proof, state = "ready") {
  if (proofEl) proofEl.textContent = JSON.stringify(proof, null, 2);
  document.documentElement.dataset[`${name}Proof`] = JSON.stringify(proof);
  document.documentElement.dataset[name] = state;
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
    await sleep(10);
  }
}

function clipRect(rect, width, height) {
  const x = Number(rect.x);
  const y = Number(rect.y);
  const right = Math.min(width, x + Number(rect.width));
  const bottom = Math.min(height, y + Number(rect.height));
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
    || !Number.isSafeInteger(rect.width) || !Number.isSafeInteger(rect.height)
    || rect.width <= 0 || rect.height <= 0 || x < 0 || y < 0
    || x >= width || y >= height || right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** The browser-side proof mirror of T09b's 64x64 resource tile plan. */
function tilePlan(rect, width, height) {
  const clipped = clipRect(rect, width, height);
  if (!clipped) return [];
  const firstX = Math.floor(clipped.x / TILE_SIZE);
  const firstY = Math.floor(clipped.y / TILE_SIZE);
  const lastX = Math.floor((clipped.x + clipped.width - 1) / TILE_SIZE);
  const lastY = Math.floor((clipped.y + clipped.height - 1) / TILE_SIZE);
  const plan = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const x = tileX * TILE_SIZE;
      const y = tileY * TILE_SIZE;
      plan.push({
        x,
        y,
        width: Math.min(TILE_SIZE, width - x),
        height: Math.min(TILE_SIZE, height - y),
      });
    }
  }
  return plan;
}

function colorFor(seed, x, y) {
  const red = (seed + (x * 3) + y) & 0xff;
  const green = ((seed * 5) + x + (y * 2)) & 0xff;
  const blue = ((seed * 11) + (x * 2) + (y * 7)) & 0xff;
  return (0xff000000 | (red << 16) | (green << 8) | blue) >>> 0;
}

function makeFrame(width, height, seed) {
  const frame = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) frame[y * width + x] = colorFor(seed, x, y);
  }
  return frame;
}

function paintRect(frame, width, height, rect, seed) {
  const clipped = clipRect(rect, width, height);
  if (!clipped) return null;
  for (let y = clipped.y; y < clipped.y + clipped.height; y += 1) {
    for (let x = clipped.x; x < clipped.x + clipped.width; x += 1) {
      frame[y * width + x] = colorFor(seed, x, y);
    }
  }
  return clipped;
}

function copyRect(source, target, width, rect) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    const start = y * width + rect.x;
    target.set(source.subarray(start, start + rect.width), start);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function crcHex(bytes) {
  return crc32(bytes).toString(16).padStart(8, "0");
}

function compareBytes(left, right) {
  requireCondition(left.length === right.length, "readback lengths differ");
  let mismatchBytes = 0;
  let firstMismatch = -1;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      mismatchBytes += 1;
      if (firstMismatch < 0) firstMismatch = index;
    }
  }
  return { equal: mismatchBytes === 0, mismatchBytes, firstMismatch };
}

function readPixels(canvas, width, height) {
  const context = canvas.getContext("2d");
  requireCondition(context && typeof context.getImageData === "function", "Canvas2D readback unavailable");
  return new Uint8Array(context.getImageData(0, 0, width, height).data);
}

function makeSurface(width, height, label) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.className = "test-surface";
  canvas.dataset.surface = label;
  document.body.append(canvas);
  return { canvas, backend: new Canvas2DBackend(canvas) };
}

function removeSurface(surface) {
  surface.canvas.remove();
}

function presentPlan(backend, frame, plan) {
  const startedAt = performance.now();
  let uploadedBytes = 0;
  for (const rect of plan) {
    backend.present(rect, frame);
    uploadedBytes += rect.width * rect.height * 4;
  }
  return { uploadedBytes, elapsedMs: performance.now() - startedAt, rectCount: plan.length };
}

function runCursorBlinkAB() {
  const base = makeFrame(WIDTH, HEIGHT, 0x19);
  const cursorOn = base.slice();
  const cursorOff = base.slice();
  paintRect(cursorOn, WIDTH, HEIGHT, CURSOR_RECT, 0xe1);
  paintRect(cursorOff, WIDTH, HEIGHT, CURSOR_RECT, 0x19);
  const disabled = makeSurface(WIDTH, HEIGHT, "cursor-disabled");
  const tiled = makeSurface(WIDTH, HEIGHT, "cursor-tiled");
  try {
    disabled.backend.present(FULL_RECT, base);
    disabled.backend.present(FULL_RECT, cursorOn);
    disabled.backend.present(FULL_RECT, cursorOff);
    tiled.backend.present(FULL_RECT, base);
    const tiledPlan = tilePlan(CURSOR_RECT, WIDTH, HEIGHT);
    const first = presentPlan(tiled.backend, cursorOn, tiledPlan);
    const second = presentPlan(tiled.backend, cursorOff, tiledPlan);
    const disabledPixels = readPixels(disabled.canvas, WIDTH, HEIGHT);
    const tiledPixels = readPixels(tiled.canvas, WIDTH, HEIGHT);
    const readback = compareBytes(disabledPixels, tiledPixels);
    const uploadedBytes = first.uploadedBytes + second.uploadedBytes;
    return {
      workload: "cursor-blink",
      mode: { enabled: "64x64 tiled", disabled: "full-frame" },
      cursorRect: CURSOR_RECT,
      updates: 2,
      tileCountPerUpdate: tiledPlan.length,
      fullFrameBytes: FULL_FRAME_BYTES,
      tiledUploadedBytes: uploadedBytes,
      disabledUploadedBytes: FULL_FRAME_BYTES * 2,
      tiledBytesPerFullFrameBudget: uploadedBytes / FULL_FRAME_BYTES,
      belowOnePercent: uploadedBytes < FULL_FRAME_BYTES * 0.01,
      finalReadback: readback,
      disabledCrc32: crcHex(disabledPixels),
      tiledCrc32: crcHex(tiledPixels),
      tiledMsPerUpdate: [first.elapsedMs, second.elapsedMs].map((value) => Math.round(value * 1000) / 1000),
    };
  } finally {
    removeSurface(disabled);
    removeSurface(tiled);
  }
}

function makeScrollFrame(base) {
  const frame = new Uint32Array(base.length);
  for (let y = 0; y < HEIGHT - 1; y += 1) {
    frame.set(base.subarray((y + 1) * WIDTH, (y + 2) * WIDTH), y * WIDTH);
  }
  for (let x = 0; x < WIDTH; x += 1) frame[(HEIGHT - 1) * WIDTH + x] = colorFor(0xa7, x, HEIGHT - 1);
  return frame;
}

function runFullScrollAB() {
  const base = makeFrame(WIDTH, HEIGHT, 0x27);
  const scrolled = makeScrollFrame(base);
  const disabled = makeSurface(WIDTH, HEIGHT, "scroll-disabled");
  const tiled = makeSurface(WIDTH, HEIGHT, "scroll-tiled");
  try {
    disabled.backend.present(FULL_RECT, base);
    const disabledTiming = presentPlan(disabled.backend, scrolled, [FULL_RECT]);
    tiled.backend.present(FULL_RECT, base);
    const tiledTiming = presentPlan(tiled.backend, scrolled, tilePlan(FULL_RECT, WIDTH, HEIGHT));
    const disabledPixels = readPixels(disabled.canvas, WIDTH, HEIGHT);
    const tiledPixels = readPixels(tiled.canvas, WIDTH, HEIGHT);
    const readback = compareBytes(disabledPixels, tiledPixels);
    return {
      workload: "full-scroll",
      mode: { enabled: "64x64 tiled", disabled: "full-frame" },
      tileCount: tiledTiming.rectCount,
      fullFrameBytes: FULL_FRAME_BYTES,
      tiledUploadedBytes: tiledTiming.uploadedBytes,
      disabledUploadedBytes: disabledTiming.uploadedBytes,
      tiledCoversFullFrame: tiledTiming.uploadedBytes === FULL_FRAME_BYTES,
      finalPixelsMatch: readback.equal,
      finalCrc32: { disabled: crcHex(disabledPixels), tiled: crcHex(tiledPixels) },
      mismatchBytes: readback.mismatchBytes,
      firstMismatch: readback.firstMismatch,
      disabledMsPerFrame: disabledTiming.elapsedMs,
      tiledMsPerFrame: tiledTiming.elapsedMs,
    };
  } finally {
    removeSurface(disabled);
    removeSurface(tiled);
  }
}

function nextRandom(state) {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value;
}

function runABFuzz() {
  const width = 257;
  const height = 131;
  const source = makeFrame(width, height, 0x31);
  const reference = source.slice();
  const tiled = source.slice();
  const random = { value: 0x5eedf00d };
  let tileUpdates = 0;
  let maxPlanLength = 0;
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const rect = {
      x: nextRandom(random) % (width + 32),
      y: nextRandom(random) % (height + 32),
      width: nextRandom(random) % 97,
      height: nextRandom(random) % 73,
    };
    const seed = nextRandom(random) & 0xff;
    paintRect(source, width, height, rect, seed);
    paintRect(reference, width, height, rect, seed);
    const plan = tilePlan(rect, width, height);
    maxPlanLength = Math.max(maxPlanLength, plan.length);
    tileUpdates += plan.length;
    for (const tile of plan) copyRect(source, tiled, width, tile);
  }
  const referenceBytes = new Uint8Array(reference.buffer);
  const tiledBytes = new Uint8Array(tiled.buffer);
  const readback = compareBytes(referenceBytes, tiledBytes);
  return {
    seed: "0x5eedf00d",
    sequences: 10_000,
    resource: { width, height, tileSize: TILE_SIZE },
    tileUpdates,
    maxPlanLength,
    finalPixelsMatch: readback.equal,
    mismatchBytes: readback.mismatchBytes,
    referenceCrc32: crcHex(referenceBytes),
    tiledCrc32: crcHex(tiledBytes),
  };
}

async function runResizeAndBoundaries() {
  const boundaryCases = [
    { name: "exact-tile", rect: { x: 64, y: 64, width: 64, height: 64 }, expected: [{ x: 64, y: 64, width: 64, height: 64 }] },
    { name: "right-edge-pixel", rect: { x: 1279, y: 799, width: 1, height: 1 }, expected: [{ x: 1216, y: 768, width: 64, height: 32 }] },
    { name: "empty-outside", rect: { x: WIDTH, y: 0, width: 1, height: 1 }, expected: [] },
  ];
  for (const test of boundaryCases) {
    requireCondition(JSON.stringify(tilePlan(test.rect, WIDTH, HEIGHT)) === JSON.stringify(test.expected), `${test.name} tile boundary changed`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  canvas.className = "test-surface";
  document.body.append(canvas);
  const controller = new PresentationController(canvas, { defaultBackend: "canvas2d" });
  try {
    const before = makeFrame(64, 64, 0x44);
    controller.present({ format: 2, rect: { x: 0, y: 0, width: 64, height: 64 }, resourceWidth: 64, resourceHeight: 64, pixels: before });
    const resized = controller.resize(65, 65);
    const after = makeFrame(65, 65, 0x55);
    controller.present({ format: 2, rect: { x: 64, y: 64, width: 1, height: 1 }, resourceWidth: 65, resourceHeight: 65, pixels: after });
    const snapshot = controller.snapshot();
    requireCondition(resized.width === 65 && resized.height === 65, "resize dimensions were not applied");
    requireCondition(snapshot.errors.length === 0 && snapshot.droppedFrames === 0, "resize introduced a presentation error");
    return { boundaryCases, resize: { from: { width: 64, height: 64 }, to: resized, snapshot } };
  } finally {
    controller.dispose();
    canvas.remove();
  }
}

function makeVisibilityTarget(hidden = true) {
  const listeners = new Set();
  return {
    hidden,
    addEventListener(type, listener) { if (type === "visibilitychange") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "visibilitychange") listeners.delete(listener); },
    dispatch() { for (const listener of [...listeners]) listener(); },
    listenerCount() { return listeners.size; },
  };
}

function makeCallbackQueue() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    request(callback) { const id = nextId++; callbacks.set(id, callback); return id; },
    cancel(id) { callbacks.delete(id); },
    capture() { return [...callbacks.values()]; },
    fireOne(timestamp) {
      const entry = callbacks.entries().next();
      requireCondition(!entry.done, "expected one queued callback");
      callbacks.delete(entry.value[0]);
      entry.value[1](timestamp);
    },
    get activeCount() { return callbacks.size; },
  };
}

function runVisibilityResume() {
  const target = makeVisibilityTarget(true);
  const raf = makeCallbackQueue();
  const timers = makeCallbackQueue();
  const delivered = [];
  let now = 0;
  const scheduler = new VisibilityFrameScheduler({
    present: (frame) => { delivered.push(frame); return true; },
    visibilityTarget: target,
    isHidden: () => target.hidden,
    requestAnimationFrame: raf.request.bind(raf),
    cancelAnimationFrame: raf.cancel.bind(raf),
    setTimeout: timers.request.bind(timers),
    clearTimeout: timers.cancel.bind(timers),
    now: () => now,
  });
  try {
    scheduler.enqueue({ kind: "base" });
    requireCondition(timers.activeCount === 1 && raf.activeCount === 0, "hidden mode did not choose one timer");
    const staleTimer = timers.capture()[0];
    target.hidden = false;
    target.dispatch();
    requireCondition(timers.activeCount === 0 && raf.activeCount === 1, "resume did not replace the timer with one rAF");
    scheduler.enqueue({ kind: "cursor" });
    now = 16;
    raf.fireOne(now);
    staleTimer(250);
    const snapshot = scheduler.snapshot();
    requireCondition(delivered.length === 1 && delivered[0].kind === "cursor", "resume did not deliver the latest cursor");
    requireCondition(snapshot.pending === 0 && snapshot.scheduled === false, "resume left pending work");
    return {
      cursorDeliveredAfterResume: true,
      deliveredKinds: delivered.map((frame) => frame.kind),
      staleTimerIgnored: true,
      targetListenersDuringRun: target.listenerCount(),
      snapshot,
    };
  } finally {
    scheduler.dispose();
  }
}

async function runSchedulerLoad({ label, durationMs = 1_000, plansPerSecond = 240 } = {}) {
  const width = 256;
  const height = 128;
  const full = { x: 0, y: 0, width, height };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.className = "test-surface";
  document.body.append(canvas);
  let displayCallbacks = 0;
  const requestFrame = (callback) => requestAnimationFrame((timestamp) => {
    displayCallbacks += 1;
    callback(timestamp);
  });
  const vm = { stats: {} };
  const controller = new PresentationController(canvas, {
    defaultBackend: "canvas2d",
    scheduleFrames: true,
    requestFrame,
    cancelFrame: (id) => cancelAnimationFrame(id),
    vm,
  });
  const longTasks = [];
  const start = performance.now();
  let observer = null;
  if (typeof PerformanceObserver === "function") {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime >= start) longTasks.push(entry.duration);
      }
    });
    try { observer.observe({ entryTypes: ["longtask"] }); } catch { observer = null; }
  }
  const frame = makeFrame(width, height, 0x61);
  const totalPlans = Math.round((durationMs / 1_000) * plansPerSecond);
  const productionStart = performance.now();
  try {
    for (let index = 0; index < totalPlans; index += 1) {
      const target = productionStart + (index * 1_000) / plansPerSecond;
      const delay = target - performance.now();
      if (delay > 0) await sleep(delay);
      frame[(index * 17) % frame.length] = (0xff000000 | ((index & 0xff) << 16) | ((index * 3) & 0xff) << 8 | (index * 7) & 0xff) >>> 0;
      controller.present({ format: 2, rect: full, resourceWidth: width, resourceHeight: height, pixels: frame });
    }
    const productionMs = performance.now() - productionStart;
    await waitUntil(() => {
      const snapshot = controller.snapshot().scheduler;
      return snapshot && snapshot.pending === 0 && snapshot.scheduled === false;
    }, `${label} scheduler drain`, 5_000);
    await sleep(60);
    observer?.disconnect();
    const snapshot = controller.snapshot();
    const scheduler = snapshot.scheduler;
    const maxLongTaskMs = longTasks.length ? Math.max(...longTasks) : 0;
    const refreshBudget = displayCallbacks + 1;
    const proof = {
      label,
      requestedPlans: totalPlans,
      plansPerSecond,
      productionMs,
      observedPlansPerSecond: totalPlans / (productionMs / 1_000),
      displayCallbacks,
      refreshPlusOneBudget: refreshBudget,
      presentsWithinRefreshPlusOne: scheduler.presented <= refreshBudget,
      scheduler,
      maxLongTaskMs,
      longTaskCount: longTasks.length,
      longTaskObserverSupported: observer !== null,
      noLongTaskOver50Ms: maxLongTaskMs <= 50,
      pendingQueueBounded: scheduler.maxPending <= 1 && scheduler.pending === 0,
      latestWins: scheduler.enqueued === scheduler.presented + scheduler.skipped,
      gpu: vm.stats.gpu,
    };
    requireCondition(proof.presentsWithinRefreshPlusOne, `${label} exceeded refresh plus one`);
    requireCondition(proof.noLongTaskOver50Ms, `${label} produced a long task over 50 ms`);
    requireCondition(proof.pendingQueueBounded, `${label} pending queue grew`);
    requireCondition(proof.latestWins, `${label} latest-wins accounting diverged`);
    return proof;
  } finally {
    observer?.disconnect();
    controller.dispose();
    canvas.remove();
  }
}

let integrationPromise = null;
async function runIntegration() {
  if (integrationPromise) return integrationPromise;
  integrationPromise = (async () => {
    setStatus("running A/B, fuzz, and frame pacing proof…");
    const cursor = runCursorBlinkAB();
    requireCondition(cursor.belowOnePercent, "cursor blink exceeded one percent of a full-frame budget");
    requireCondition(cursor.finalReadback.equal, "cursor A/B readback mismatch");
    const scroll = runFullScrollAB();
    requireCondition(scroll.finalPixelsMatch && scroll.tiledCoversFullFrame, "full-scroll A/B CRC mismatch");
    const fuzz = runABFuzz();
    requireCondition(fuzz.finalPixelsMatch, "seeded A/B fuzz mismatch");
    const boundaries = await runResizeAndBoundaries();
    const visibilityResume = runVisibilityResume();
    const load = await runSchedulerLoad({ label: "visible-240-plans" });
    const proof = {
      schema: "wasm-vm.e5-t09e.present-integration.v1",
      task: "E5-T09e",
      route: "present-integration",
      browser: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        devicePixelRatio: window.devicePixelRatio,
        visibilityState: document.visibilityState,
      },
      resource: { width: WIDTH, height: HEIGHT, tileSize: TILE_SIZE, fullFrameBytes: FULL_FRAME_BYTES },
      cursor,
      scroll,
      fuzz,
      boundaries,
      visibilityResume,
      load,
      sourceDistParity: "checked by the Node verifier",
    };
    publishProof("e5T09e", proof);
    setStatus("presentation integration proof ready", "ready");
    globalThis.__e5T09eProof = () => proof;
    return proof;
  })().catch((error) => {
    const proof = { schema: "wasm-vm.e5-t09e.present-integration.v1", task: "E5-T09e", route: "present-integration", error: String(error?.message || error) };
    publishProof("e5T09e", proof, "error");
    setStatus(`presentation integration failed: ${error.message || error}`, "error");
    globalThis.__e5T09eProof = () => proof;
    throw error;
  });
  return integrationPromise;
}

async function runHiddenBoot() {
  const hiddenTarget = makeVisibilityTarget(true);
  let presentation = null;
  let controller = null;
  let serialText = "";
  const decoder = new TextDecoder();
  const command = "echo E5T09E_HIDDEN_OK > /dev/tty0; echo E5T09E_SERIAL_OK\n";
  const onOutput = (bytes) => {
    serialText += decoder.decode(bytes, { stream: true });
    if (serialText.length > 500_000) serialText = serialText.slice(-500_000);
    if (serialEl) {
      serialEl.hidden = false;
      serialEl.textContent = serialText;
      serialEl.scrollTop = serialEl.scrollHeight;
    }
  };
  try {
    requireCondition(displayCanvas, "integration canvas is missing");
    presentation = new PresentationController(displayCanvas, {
      defaultBackend: "canvas2d",
      scheduleFrames: true,
      visibilityTarget: hiddenTarget,
      isHidden: () => hiddenTarget.hidden,
      vm: pageVm,
    });
    globalThis.__e5T09eHiddenPresentation = () => presentation.snapshot();
    setStatus("forced-hidden Linux boot is running…");
    const bootStartedAt = performance.now();
    controller = await startLinuxBoot({
      manifestUrl: "./artifacts.json",
      mode: "initramfs",
      ramMib: 256,
      bootargs: "console=tty0 console=ttyS0 earlycon=sbi",
      bootSnapshot: false,
      fastInterpreter: true,
      jit: false,
      quantum: 500_000,
      onState: (state) => setStatus(`hidden boot: ${state}`),
      onProgress: (role, loaded, total) => setStatus(`loading ${role} ${total ? Math.round((loaded / total) * 100) : Math.round(loaded / 1048576)}%`),
      onOutput,
      onDisplayFrame: (frame) => presentation.present(frame),
      onError: (error) => setStatus(`hidden boot error: ${error.message || error}`, "error"),
    });
    globalThis.__e5T09eHiddenController = controller;
    await waitUntil(() => serialText.includes("~ # "), "BusyBox prompt", 900_000);
    const serialBeforeCommand = serialText.length;
    const commandBytes = new TextEncoder().encode(command);
    controller.sendInput(commandBytes);
    await waitUntil(() => serialText.includes("E5T09E_SERIAL_OK"), "hidden serial marker", 60_000);
    await waitUntil(() => {
      const scheduler = presentation.snapshot().scheduler;
      return scheduler?.mode === "timer" && scheduler.presented > 0;
    }, "hidden presentation timer drain", 60_000);
    const snapshot = presentation.snapshot();
    const guest = controller.schedulerStats?.() ?? null;
    const proof = {
      schema: "wasm-vm.e5-t09e.hidden-boot.v1",
      task: "E5-T09e",
      route: "present-integration",
      forcedHidden: true,
      actualDocumentVisibility: document.visibilityState,
      timerMs: snapshot.scheduler?.timerMs ?? null,
      serialMarker: "E5T09E_SERIAL_OK",
      serialOutputLive: serialText.length > serialBeforeCommand,
      serialBytesAfterCommand: serialText.length - serialBeforeCommand,
      commandBytes: commandBytes.byteLength,
      command,
      bootMs: performance.now() - bootStartedAt,
      presentation: snapshot,
      gpu: pageVm.stats.gpu,
      guest,
      browserHealth: "checked by the Node verifier",
    };
    requireCondition(proof.serialOutputLive, "hidden boot serial did not progress after input");
    requireCondition(proof.presentation.scheduler.mode === "timer", "hidden boot did not use timer mode");
    requireCondition(proof.presentation.scheduler.pending <= 1, "hidden boot pending queue grew");
    publishProof("e5T09eHiddenBoot", proof);
    setStatus("forced-hidden boot proof ready", "ready");
    globalThis.__e5T09eHiddenProof = () => proof;
    return proof;
  } catch (error) {
    const proof = { schema: "wasm-vm.e5-t09e.hidden-boot.v1", task: "E5-T09e", route: "present-integration", error: String(error?.message || error) };
    publishProof("e5T09eHiddenBoot", proof, "error");
    setStatus(`forced-hidden boot failed: ${error.message || error}`, "error");
    globalThis.__e5T09eHiddenProof = () => proof;
    throw error;
  } finally {
    try { await controller?.stop?.(); } catch { /* proof already captures a failed boot */ }
    presentation?.dispose?.();
  }
}

if (MODE === "hidden-boot") {
  void runHiddenBoot();
} else {
  document.documentElement.dataset.e5T09eReady = "ready";
  globalThis.runE5T09eIntegration = runIntegration;
  globalThis.runE5T09eLoad = runSchedulerLoad;
  globalThis.__e5T09eProof = () => null;
  setStatus("ready for integration proof", "ready");
}
