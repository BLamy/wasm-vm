// E5-T09d — hidden-tab timer fallback, visibility resumption, and scalar GPU metrics.

import assert from "node:assert/strict";
import test from "node:test";

import { PresentationController } from "../src/sink/presentation.js";
import { VisibilityFrameScheduler } from "../src/sink/visibility-scheduler.js";

class FakeVisibilityTarget {
  constructor() {
    this.hidden = false;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(type = "visibilitychange") {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextRafId = 1;
    this.nextTimerId = 1;
    this.rafCallbacks = new Map();
    this.timers = new Map();
    this.maxRafActive = 0;
    this.maxTimerActive = 0;
  }

  requestAnimationFrame(callback) {
    const id = this.nextRafId;
    this.nextRafId += 1;
    this.rafCallbacks.set(id, callback);
    this.maxRafActive = Math.max(this.maxRafActive, this.rafCallbacks.size);
    return id;
  }

  cancelAnimationFrame(id) {
    this.rafCallbacks.delete(id);
  }

  setTimeout(callback, delay) {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(id, { callback, due: this.now + delay });
    this.maxTimerActive = Math.max(this.maxTimerActive, this.timers.size);
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  captureRaf() {
    return [...this.rafCallbacks.values()][0] ?? null;
  }

  captureTimer() {
    return [...this.timers.values()][0]?.callback ?? null;
  }

  fireRaf() {
    const entry = this.rafCallbacks.entries().next();
    assert.equal(entry.done, false, "a visible frame callback should be pending");
    const [id, callback] = entry.value;
    this.rafCallbacks.delete(id);
    callback(this.now);
  }

  fireTimer() {
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.due <= this.now)
      .sort((left, right) => left[1].due - right[1].due)[0];
    assert.ok(due, "a hidden timer should be due");
    this.timers.delete(due[0]);
    due[1].callback();
  }

  advance(milliseconds) {
    this.now += milliseconds;
  }

  get activeCount() {
    return this.rafCallbacks.size + this.timers.size;
  }
}

function options(clock, target, present) {
  return {
    present,
    visibilityTarget: target,
    requestAnimationFrame: clock.requestAnimationFrame.bind(clock),
    cancelAnimationFrame: clock.cancelAnimationFrame.bind(clock),
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    now: () => clock.now,
  };
}

test("hidden mode drains through one 250 ms timer while producer work continues", () => {
  const clock = new FakeClock();
  const target = new FakeVisibilityTarget();
  target.hidden = true;
  const presented = [];
  const serial = [];
  const scheduler = new VisibilityFrameScheduler(options(clock, target, (value) => {
    presented.push(value);
    return true;
  }));

  scheduler.enqueue("cursor-1");
  serial.push("serial-byte-1");
  scheduler.enqueue("cursor-2");
  serial.push("serial-byte-2");
  assert.equal(target.listenerCount(), 1);
  assert.equal(clock.rafCallbacks.size, 0);
  assert.equal(clock.timers.size, 1);
  assert.equal(scheduler.pendingCount, 1);
  assert.equal(scheduler.snapshot().timerMs, 250);
  clock.advance(249);
  assert.deepEqual(presented, []);
  assert.equal(serial.length, 2);
  clock.advance(1);
  clock.fireTimer();
  assert.deepEqual(presented, ["cursor-2"]);
  assert.equal(scheduler.snapshot().presented, 1);
  assert.equal(scheduler.snapshot().skipped, 1);
  assert.equal(scheduler.snapshot().mode, "timer");
  assert.equal(clock.activeCount, 0);
  scheduler.dispose();
});

test("visibility transition cancels a delayed timer and resumes the latest plan on rAF", () => {
  const clock = new FakeClock();
  const target = new FakeVisibilityTarget();
  target.hidden = true;
  const presented = [];
  const scheduler = new VisibilityFrameScheduler(options(clock, target, (value) => {
    presented.push(value);
    return true;
  }));

  scheduler.enqueue("hidden-old");
  const delayedTimer = clock.captureTimer();
  target.hidden = false;
  target.dispatch("visibilitychange");
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.rafCallbacks.size, 1);
  assert.equal(scheduler.snapshot().mode, "raf");
  delayedTimer();
  assert.deepEqual(presented, []);
  assert.equal(clock.rafCallbacks.size, 1);
  scheduler.enqueue("visible-latest");
  clock.fireRaf();
  assert.deepEqual(presented, ["visible-latest"]);
  assert.equal(scheduler.snapshot().pending, 0);
  assert.equal(scheduler.snapshot().presented, 1);
  scheduler.dispose();
  assert.equal(target.listenerCount(), 0);
});

test("1,000 alternating visibility callbacks keep one chain and deliver every latest frame", () => {
  const clock = new FakeClock();
  const target = new FakeVisibilityTarget();
  const presented = [];
  let serialBytes = 0;
  const scheduler = new VisibilityFrameScheduler(options(clock, target, (value) => {
    presented.push(value);
    return true;
  }));

  for (let cycle = 0; cycle < 1_000; cycle += 1) {
    target.hidden = cycle % 2 === 0;
    const frame = { cycle, cursor: cycle ^ 0x5a5a };
    scheduler.enqueue(frame);
    serialBytes += 4;
    const stale = target.hidden ? clock.captureTimer() : clock.captureRaf();
    target.dispatch("visibilitychange");
    assert.equal(clock.activeCount, 1);
    stale?.(clock.now);
    assert.equal(clock.activeCount, 1);
    if (target.hidden) {
      clock.advance(250);
      clock.fireTimer();
    } else {
      clock.fireRaf();
    }
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(clock.activeCount, 0);
  }

  const state = scheduler.snapshot();
  assert.equal(serialBytes, 4_000);
  assert.equal(state.enqueued, 1_000);
  assert.equal(state.presented, 1_000);
  assert.equal(state.coalesced, 0);
  assert.equal(state.skipped, 0);
  assert.equal(state.maxPending, 1);
  assert.equal(state.pending, 0);
  assert.equal(clock.maxRafActive, 1);
  assert.equal(clock.maxTimerActive, 1);
  assert.deepEqual(presented.at(-1), { cycle: 999, cursor: 999 ^ 0x5a5a });
  scheduler.dispose();
});

class FakeCanvas {
  constructor(width = 2, height = 2) {
    this.width = width;
    this.height = height;
    this.listeners = new Map();
  }

  getContext() {
    return null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
}

class FakeBackend {
  constructor(canvas, instances) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.presents = [];
    this.disposed = false;
    instances.push(this);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  present(rect, pixels) {
    assert.equal(this.disposed, false);
    this.presents.push({ rect, pixels: new Uint32Array(pixels) });
  }

  dispose() {
    this.disposed = true;
  }
}

function frame(value, width = 2, height = 2) {
  return {
    rect: { x: 0, y: 0, width, height },
    resourceWidth: width,
    resourceHeight: height,
    pixels: new Uint32Array(width * height).fill(value),
  };
}

test("PresentationController exposes fresh scalar vm.stats.gpu snapshots", () => {
  const clock = new FakeClock();
  const target = new FakeVisibilityTarget();
  target.hidden = true;
  const vm = { stats: {} };
  const instances = [];
  const controller = new PresentationController(new FakeCanvas(), {
    scheduleFrames: true,
    visibilityTarget: target,
    requestAnimationFrame: clock.requestAnimationFrame.bind(clock),
    cancelAnimationFrame: clock.cancelAnimationFrame.bind(clock),
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    now: () => clock.now,
    vm,
    backendFactories: {
      canvas2d: (canvas) => new FakeBackend(canvas, instances),
      webgl2: (canvas) => new FakeBackend(canvas, instances),
    },
  });

  controller.present(frame(0xff112233));
  const before = vm.stats.gpu;
  for (const name of [
    "framesReceived", "enqueued", "coalesced", "presented", "successfulPresents", "skipped",
    "droppedFrames", "overruns", "pending", "maxPending", "uploadedBytes", "width", "height",
  ]) assert.equal(typeof before[name], "number", `${name} should be numeric`);
  assert.equal(before.pending, 1);
  assert.equal(before.presented, 0);
  assert.equal("canvas" in before, false);
  assert.equal("backend" in before, false);
  assert.deepEqual(JSON.parse(JSON.stringify(before)), before);
  clock.advance(250);
  clock.fireTimer();
  const after = vm.stats.gpu;
  assert.equal(after.presented, 1);
  assert.equal(after.successfulPresents, 1);
  assert.equal(after.uploadedBytes, 16);
  assert.equal(after.pending, 0);
  assert.deepEqual(controller.snapshot().gpu, after);

  controller.dispose();
  assert.equal(target.listenerCount(), 0);
  assert.equal(vm.stats.gpu.pending, 0);
  assert.equal(vm.stats.gpu.disposed, undefined);
});
