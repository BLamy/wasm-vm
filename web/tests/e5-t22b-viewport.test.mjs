import assert from "node:assert/strict";
import test from "node:test";
import { DisplayViewportController, viewportPixelMode, fitFrameToViewport, nativeContentRect } from "../src/sink/viewport.js";
import { PresentationController } from "../src/sink/presentation.js";
import { absoluteCoordinatesFromEvent } from "../src/input/pointer.js";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function rig({ delay, setDisplay = async () => true } = {}) {
  let now = 0, nextId = 0, dpr = 1;
  let rect = { left: 10, top: 20, width: 641, height: 481 };
  const timers = new Map(), media = [], observers = [], sizes = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const presentation = { canvas: { style: {} }, setViewport: (...size) => sizes.push(size),
    snapshot: () => ({ latest: { resourceWidth: 800, resourceHeight: 600 } }) };
  const viewport = new DisplayViewportController({ container: { getBoundingClientRect: () => rect },
    presentation, controller: { setDisplay }, ResizeObserverClass: Observer,
    getDpr: () => dpr,
    matchMedia: (query) => {
      const item = { query, listeners: new Set(), addEventListener(_type, fn) { this.listeners.add(fn); },
        removeEventListener(_type, fn) { this.listeners.delete(fn); } };
      media.push(item); return item;
    },
    setTimer: (callback, ms) => { const id = ++nextId; timers.set(id, { due: now + ms, callback }); return id; },
    clearTimer: (id) => timers.delete(id),
    ...(delay === undefined ? {} : { testDebounceMs: delay }),
  });
  const tick = async (ms) => {
    const until = now + ms;
    while (true) {
      const entry = [...timers].filter(([, value]) => value.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      now = entry[1].due; timers.delete(entry[0]); entry[1].callback(); await flush();
    }
    now = until; await flush();
  };
  return { viewport, timers, media, observers, sizes, presentation, tick,
    resize(width, height) { rect = { ...rect, width, height }; observers[0].callback(); },
    dpr(value) { dpr = value; for (const callback of [...media.at(-1).listeners]) callback(); },
    dprWithoutEvent(value) { dpr = value; },
  };
}

test("CSS/DPR rounding and minimum/maximum clamps are finite, hidden panes do not hotplug", () => {
  assert.deepEqual(viewportPixelMode(641, 481, 1.5), { width: 962, height: 722, dpr: 1.5, cssWidth: 962 / 1.5, cssHeight: 722 / 1.5 });
  assert.deepEqual(viewportPixelMode(1, 2, 1), { width: 320, height: 240, dpr: 1, cssWidth: 320, cssHeight: 240 });
  assert.equal(viewportPixelMode(10000, 9000, 2).width, 4095);
  assert.equal(viewportPixelMode(10000, 9000, 2).height, 4095);
  assert.equal(viewportPixelMode(0, 400, 1), null);
  assert.equal(viewportPixelMode(400, 0, 1), null);
  for (const bad of [NaN, Infinity, -1, "640", null]) assert.throws(() => viewportPixelMode(bad, 480, 1));
  for (const bad of [0, NaN, -Infinity, -1]) assert.throws(() => viewportPixelMode(640, 480, bad));
  assert.throws(() => viewportPixelMode(640, 480, Number.MIN_VALUE));
  assert.throws(() => rig({ delay: 1 }), /zero-delay/);
});

test("50 resizes/5 seconds send one trailing request at exactly 250ms, DPR listener rearms and disposes", async () => {
  const calls = [];
  const r = rig({ setDisplay: async (...args) => { calls.push(args); return true; } });
  for (let index = 0; index < 50; index++) { r.resize(641 + index, 481 + index); await r.tick(100); }
  assert.deepEqual(calls, []);
  await r.tick(149); assert.deepEqual(calls, []);
  await r.tick(1); assert.deepEqual(calls, [[690, 530]]);
  r.dpr(1.5); assert.equal(r.media[0].listeners.size, 0);
  assert.equal(r.media.at(-1).listeners.size, 1);
  await r.tick(250); assert.deepEqual(calls.at(-1), [1035, 795]);
  assert.equal(r.presentation.canvas.style.width, "690px");
  r.dpr(1); await r.tick(250); assert.deepEqual(calls.at(-1), [690, 530]);
  r.resize(0, 0); await r.tick(500); assert.equal(calls.length, 3);
  r.resize(10, 20); r.viewport.dispose(); r.viewport.dispose(); await r.tick(500);
  assert.equal(calls.length, 3);
  assert.equal(r.timers.size, 0); assert.equal(r.media.at(-1).listeners.size, 0);
  assert.equal(r.observers[0].connected, false);
  assert.equal(r.viewport.measure(), null);
  const listenerCount = r.media.length;
  r.viewport._onDpr(); r.viewport._pollDpr();
  assert.equal(r.media.length, listenerCount);
  assert.equal(r.timers.size, 0, "stale DPR callbacks cannot revive listeners or timers");
});

test("in-flight requests serialize latest intent, stale replies and disposed completions cannot restore old state", async () => {
  const calls = [], releases = [];
  const r = rig({ delay: 0, setDisplay: (...args) => {
    calls.push(args); return new Promise((resolve) => releases.push(resolve));
  } });
  await r.tick(0); assert.deepEqual(calls, [[641, 481]]);
  r.resize(801, 601); await r.tick(0);
  r.resize(803, 603); await r.tick(0);
  assert.equal(calls.length, 1);
  releases[0](true); await flush();
  assert.deepEqual(calls[1], [803, 603]);
  assert.equal(r.viewport.snapshot().accepted, null);
  assert.equal(r.viewport.snapshot().desired.width, 803);
  r.viewport.dispose(); releases[1](true); await flush();
  assert.equal(r.viewport.snapshot().accepted, null);
  assert.equal(r.viewport.snapshot().inFlight, false);
});

test("scalar fallback detects silent DPR changes without CSS or media-query notification", async () => {
  const calls = [];
  const r = rig({ setDisplay: async (...args) => { calls.push(args); return true; } });
  await r.tick(250);
  r.dprWithoutEvent(1.5);
  await r.tick(249); assert.equal(r.viewport.snapshot().desired.dpr, 1);
  await r.tick(1); assert.equal(r.viewport.snapshot().desired.dpr, 1.5);
  await r.tick(250); assert.deepEqual(calls.at(-1), [962, 722]);
  r.viewport.dispose(); assert.equal(r.timers.size, 0);
  assert.equal(r.viewport.snapshot().dprWatcherPending, false);
});

test("controller replacement ignores old completion, initial binding has no duplicate timer, errors recover", async () => {
  let releaseOld;
  const r = rig({ setDisplay: () => new Promise((resolve) => { releaseOld = resolve; }) });
  await r.tick(250);
  let freshCalls = 0;
  await r.viewport.setController({ setDisplay: async () => { freshCalls++; return true; } });
  assert.equal(r.viewport.snapshot().accepted.width, 641);
  releaseOld(false); await flush(); assert.equal(r.viewport.snapshot().error, null);
  await r.tick(1000); assert.equal(freshCalls, 1);
  await r.viewport.setController({ setDisplay: async () => false });
  assert.equal(r.viewport.snapshot().error, "GPU unavailable");
  await r.viewport.setController({ setDisplay: async () => { throw new Error("worker gone"); } });
  assert.match(r.viewport.snapshot().error, /worker gone/);
  await r.viewport.setController({ setDisplay: async () => true });
  assert.equal(r.viewport.snapshot().error, null);
  r.viewport.dispose();
});

function source(width, height) {
  return { resourceWidth: width, resourceHeight: height, rect: { x: width - 1, y: height - 1, width: 1, height: 1 },
    pixels: Uint32Array.from({ length: width * height }, (_, i) => (0xff000000 | (i * 7919 + 0x110203)) >>> 0) };
}

test("native fit keeps odd resource stride and independently checks every clipped/padded pixel", () => {
  for (const [sw, sh, tw, th] of [[7, 5, 3, 9], [3, 9, 7, 5], [13, 11, 17, 19]]) {
    const frame = source(sw, sh);
    const fitted = fitFrameToViewport(frame, tw, th);
    assert.equal(fitted.pixels.length, tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      assert.equal(fitted.pixels[y * tw + x], x < sw && y < sh ? frame.pixels[y * sw + x] : 0xff000000);
    }
    assert.deepEqual(fitted.rect, { x: 0, y: 0, width: tw, height: th });
    assert.equal(fitFrameToViewport(frame, sw, sh), frame, "matching frames use original damage/bytes");
  }
  assert.throws(() => fitFrameToViewport(source(2, 2), 4096, 2));
  const rect = nativeContentRect({ left: 10, top: 20 }, 800, 600, 2);
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: 210, clientY: 170 }, rect), { x: 16384, y: 16384 });
  assert.deepEqual(absoluteCoordinatesFromEvent({ clientX: 1000, clientY: 1000 }, rect), { x: 32767, y: 32767 });
  assert.equal(nativeContentRect({ left: 0, top: 0 }, 1, 1, 0), null);
});

test("presentation keeps fixed viewport on pending old frame and later matching frame", () => {
  const pending = new Map(), received = [];
  const canvas = { width: 7, height: 5, getContext: () => null, style: {} };
  const backend = { width: 7, height: 5, present(rect, pixels) { received.push({ rect, pixels: [...pixels] }); },
    resize(width, height) { this.width = width; this.height = height; }, dispose() {} };
  const p = new PresentationController(canvas, { scheduleFrames: true, backendFactories: { canvas2d: () => backend },
    requestFrame: (fn) => { pending.set(1, fn); return 1; }, cancelFrame: (id) => pending.delete(id) });
  p.present(source(7, 5)); assert.equal(pending.size, 1);
  p.setViewport(3, 9); assert.equal(p.snapshot().scheduler.pending, 0);
  assert.equal(p.snapshot().sizeMismatch, true);
  assert.equal(received.at(-1).pixels.length, 27);
  const count = received.length;
  pending.get(1)(); pending.delete(1);
  assert.equal(received.length, count, "previous scheduled callback has no stale work left");
  p.present(source(3, 9));
  assert.equal(p.snapshot().sizeMismatch, true, "received is not painted");
  p.present(source(3, 9));
  pending.get(1)(); pending.delete(1);
  assert.equal(p.snapshot().sizeMismatch, false);
  assert.deepEqual(received.at(-1).rect, { x: 0, y: 0, width: 3, height: 9 });
  assert.deepEqual(received.at(-1).pixels, [...source(3, 9).pixels], "coalescing cannot erase the required full repaint");
  p.present(source(3, 9)); pending.get(1)(); pending.delete(1);
  assert.deepEqual(received.at(-1).rect, source(3, 9).rect, "later same-size damage retains the partial fast path");
  assert.equal(p.snapshot().width, 3);
  assert.throws(() => p.setViewport(4, NaN));
  assert.equal(p.snapshot().width, 3);
  p.dispose(); assert.throws(() => p.setViewport(4, 5));
});
