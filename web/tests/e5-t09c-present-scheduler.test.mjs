// E5-T09c — bounded latest-wins rAF scheduling and its presentation-controller seam.

import assert from "node:assert/strict";
import test from "node:test";

import { FrameScheduler } from "../src/sink/frame-scheduler.js";
import { PresentationController } from "../src/sink/presentation.js";

class FakeRaf {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.callbacks = new Map();
    this.maxActive = 0;
  }

  request(callback) {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    this.maxActive = Math.max(this.maxActive, this.callbacks.size);
    return id;
  }

  cancel(id) {
    this.callbacks.delete(id);
  }

  fireOne() {
    const entry = this.callbacks.entries().next();
    assert.equal(entry.done, false, "a display callback should be scheduled");
    const [id, callback] = entry.value;
    this.callbacks.delete(id);
    this.now += 1000 / 60;
    callback(this.now);
  }

  captureCallbacks() {
    return [...this.callbacks.values()];
  }

  get activeCount() {
    return this.callbacks.size;
  }
}

function schedulerOptions(raf, present, onError) {
  return {
    present,
    requestFrame: raf.request.bind(raf),
    cancelFrame: raf.cancel.bind(raf),
    onError,
  };
}

function frame(value, width = 2, height = 2) {
  return {
    scanout: 0,
    rect: { x: 0, y: 0, width, height },
    resourceWidth: width,
    resourceHeight: height,
    pixels: new Uint32Array(width * height).fill(value),
  };
}

test("latest-wins enqueue is idempotently scheduled and bounded to one pending plan", () => {
  const raf = new FakeRaf();
  const presented = [];
  const scheduler = new FrameScheduler(schedulerOptions(raf, (value) => {
    presented.push(value);
    return true;
  }));

  assert.equal(scheduler.enqueue(1), true);
  assert.equal(scheduler.enqueue(2), true);
  assert.equal(scheduler.enqueue(3), true);
  assert.equal(raf.activeCount, 1);
  assert.equal(scheduler.pendingCount, 1);
  assert.deepEqual(scheduler.snapshot(), {
    enqueued: 3,
    coalesced: 2,
    presented: 0,
    skipped: 2,
    overruns: 0,
    pending: 1,
    maxPending: 1,
    paused: false,
    disposed: false,
    scheduled: true,
  });

  raf.fireOne();
  assert.deepEqual(presented, [3]);
  assert.equal(scheduler.pendingCount, 0);
  assert.equal(scheduler.snapshot().presented, 1);
  assert.equal(scheduler.snapshot().skipped, 2);
  assert.equal(raf.activeCount, 0);
});

test("a 240-plans/sec producer with a 4x-slow backend never grows the queue", () => {
  const raf = new FakeRaf();
  const presented = [];
  let backendWork = 0;
  let random = 0x1badb002;
  const scheduler = new FrameScheduler(schedulerOptions(raf, (value) => {
    // Four deterministic work units model a backend that takes four producer units to finish.
    for (let unit = 0; unit < 4; unit += 1) backendWork += (value.sequence ^ unit) >>> 0;
    presented.push(value);
    return true;
  }));

  const displayCallbacks = 60;
  let latest = null;
  for (let refresh = 0; refresh < displayCallbacks; refresh += 1) {
    const order = [0, 1, 2, 3];
    for (let index = order.length - 1; index > 0; index -= 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const swap = random % (index + 1);
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    for (const offset of order) {
      latest = { refresh, offset, sequence: refresh * 4 + offset };
      scheduler.enqueue(latest);
      assert.equal(scheduler.pendingCount <= 1, true);
      assert.equal(raf.activeCount, 1);
    }
    raf.fireOne();
    assert.equal(raf.activeCount, 0);
  }

  const state = scheduler.snapshot();
  assert.equal(backendWork > 0, true);
  assert.equal(state.maxPending, 1);
  assert.equal(state.pending, 0);
  assert.equal(state.presented <= displayCallbacks + 1, true);
  assert.deepEqual(presented.at(-1), latest);
  assert.equal(raf.maxActive, 1);
  assert.equal(state.enqueued, state.presented + state.skipped);
  assert.equal(state.coalesced, state.skipped);
});

test("reentrant enqueue records one overrun and keeps one rAF chain", () => {
  const raf = new FakeRaf();
  const presented = [];
  let scheduler;
  scheduler = new FrameScheduler(schedulerOptions(raf, (value) => {
    presented.push(value);
    if (value === 1) {
      scheduler.enqueue(2);
      assert.equal(raf.activeCount, 0, "reentrant enqueue must not schedule during present");
    }
    return true;
  }));

  scheduler.enqueue(1);
  raf.fireOne();
  assert.deepEqual(presented, [1]);
  assert.equal(scheduler.snapshot().overruns, 1);
  assert.equal(scheduler.pendingCount, 1);
  assert.equal(raf.activeCount, 1);
  assert.equal(raf.maxActive, 1);

  raf.fireOne();
  assert.deepEqual(presented, [1, 2]);
  assert.equal(scheduler.snapshot().presented, 2);
  assert.equal(raf.activeCount, 0);
});

test("pause/resume preserves only the latest plan and stale callbacks cannot revive a chain", () => {
  const raf = new FakeRaf();
  const presented = [];
  const scheduler = new FrameScheduler(schedulerOptions(raf, (value) => {
    presented.push(value);
    return true;
  }));

  scheduler.enqueue("before-pause");
  const staleCallback = raf.captureCallbacks()[0];
  assert.equal(scheduler.pause(), true);
  assert.equal(scheduler.pause(), false);
  assert.equal(raf.activeCount, 0);
  assert.equal(scheduler.pendingCount, 1);
  scheduler.enqueue("after-pause");
  assert.equal(scheduler.snapshot().coalesced, 1);
  assert.equal(scheduler.resume(), true);
  assert.equal(scheduler.resume(), false);
  assert.equal(raf.activeCount, 1);

  staleCallback(0);
  assert.deepEqual(presented, []);
  assert.equal(raf.activeCount, 1, "a stale callback must not consume the resumed callback");
  raf.fireOne();
  assert.deepEqual(presented, ["after-pause"]);
  assert.equal(raf.activeCount, 0);
});

test("dispose drops pending work and makes both queued and stale callbacks inert", () => {
  const raf = new FakeRaf();
  const presented = [];
  const scheduler = new FrameScheduler(schedulerOptions(raf, (value) => {
    presented.push(value);
    return true;
  }));

  scheduler.enqueue("to-dispose");
  const staleCallback = raf.captureCallbacks()[0];
  scheduler.dispose();
  assert.equal(raf.activeCount, 0);
  assert.equal(scheduler.pendingCount, 0);
  assert.equal(scheduler.snapshot().skipped, 1);
  staleCallback(0);
  assert.deepEqual(presented, []);
  assert.equal(scheduler.snapshot().disposed, true);
  assert.throws(() => scheduler.enqueue("after-dispose"), /disposed/);
});

test("false or throwing backend delivery is skipped, never counted as presented", () => {
  const raf = new FakeRaf();
  const errors = [];
  const scheduler = new FrameScheduler(schedulerOptions(
    raf,
    (value) => {
      if (value === "false") return false;
      throw new Error("backend failed");
    },
    (error, value) => errors.push({ message: error.message, value }),
  ));

  scheduler.enqueue("false");
  raf.fireOne();
  scheduler.enqueue("throws");
  raf.fireOne();
  assert.deepEqual(errors, [{ message: "backend failed", value: "throws" }]);
  assert.deepEqual(scheduler.snapshot(), {
    enqueued: 2,
    coalesced: 0,
    presented: 0,
    skipped: 2,
    overruns: 0,
    pending: 0,
    maxPending: 1,
    paused: false,
    disposed: false,
    scheduled: false,
  });
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

test("scheduled PresentationController presents only on rAF and retires resized work", () => {
  const raf = new FakeRaf();
  const instances = [];
  const controller = new PresentationController(new FakeCanvas(), {
    scheduleFrames: true,
    requestFrame: raf.request.bind(raf),
    cancelFrame: raf.cancel.bind(raf),
    backendFactories: {
      canvas2d: (canvas) => new FakeBackend(canvas, instances),
      webgl2: (canvas) => new FakeBackend(canvas, instances),
    },
  });

  controller.present(frame(1));
  controller.present(frame(2));
  assert.equal(instances[0].presents.length, 0);
  assert.equal(raf.activeCount, 1);
  raf.fireOne();
  assert.equal(instances[0].presents.length, 1);
  assert.equal(instances[0].presents[0].pixels[0], 2);
  assert.equal(controller.snapshot().successfulPresents, 1);
  assert.equal(controller.snapshot().scheduler.presented, 1);

  controller.present(frame(3));
  assert.equal(controller.pause(), true);
  controller.present(frame(4));
  assert.equal(controller.resume(), true);
  raf.fireOne();
  assert.equal(instances[0].presents.length, 2);
  assert.equal(instances[0].presents.at(-1).pixels[0], 4);

  controller.present(frame(5));
  controller.present(frame(6, 1, 1));
  assert.equal(controller.snapshot().scheduler.pending, 1);
  raf.fireOne();
  assert.equal(instances[0].presents.length, 3);
  assert.equal(instances[0].presents.at(-1).pixels[0], 6);

  controller.present(frame(7));
  const staleCallback = raf.captureCallbacks()[0];
  controller.dispose();
  staleCallback(0);
  assert.equal(instances[0].presents.length, 3);
  assert.equal(controller.snapshot().scheduler.disposed, true);
  assert.equal(controller.snapshot().scheduler.pending, 0);
  assert.equal(controller.snapshot().scheduler.scheduled, false);
  assert.throws(() => controller.present(frame(8)), /disposed/);
});
