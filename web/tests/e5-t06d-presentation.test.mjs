// E5-T06d — presentation selection, context-loss recovery, and last-frame delivery.

import assert from "node:assert/strict";
import test from "node:test";

import { PresentationController } from "../src/sink/presentation.js";

class FakeCanvas {
  constructor(width = 2, height = 2) {
    this.width = width;
    this.height = height;
    this.parentNode = null;
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

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  cloneNode() {
    return new FakeCanvas(this.width, this.height);
  }
}

class FakeParent {
  constructor(child) {
    this.child = child;
    child.parentNode = this;
  }

  replaceChild(next, prior) {
    assert.equal(prior, this.child);
    this.child = next;
    next.parentNode = this;
    prior.parentNode = null;
  }
}

class FakeBackend {
  constructor(name, canvas, instances) {
    this.name = name;
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.instances = instances;
    this.presents = [];
    this.disposed = false;
    instances.push(this);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    return { width, height };
  }

  present(rect, pixels) {
    assert.equal(this.disposed, false);
    this.presents.push({ rect, pixels: new Uint32Array(pixels) });
  }

  dispose() {
    this.disposed = true;
  }
}

function factories(instances, { failWebgl = false } = {}) {
  return {
    canvas2d: (canvas) => new FakeBackend("canvas2d", canvas, instances),
    webgl2: (canvas) => {
      if (failWebgl) throw new Error("WebGL2 disabled by test");
      return new FakeBackend("webgl2", canvas, instances);
    },
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

test("Canvas2D is the measured default and unavailable WebGL2 falls back", () => {
  const firstInstances = [];
  const first = new PresentationController(new FakeCanvas(), {
    backendFactories: factories(firstInstances),
  });
  assert.equal(first.backendName, "canvas2d");
  assert.equal(first.snapshot().fallbacks, 0);
  first.dispose();

  const fallbackInstances = [];
  const fallback = new PresentationController(new FakeCanvas(), {
    defaultBackend: "webgl2",
    backendFactories: factories(fallbackInstances, { failWebgl: true }),
  });
  assert.equal(fallback.backendName, "canvas2d");
  assert.equal(fallback.snapshot().fallbacks, 1);
  fallback.dispose();
});

test("WebGL context loss replaces the context and replays the latest frame through Canvas2D", () => {
  const instances = [];
  const canvas = new FakeCanvas();
  const parent = new FakeParent(canvas);
  const controller = new PresentationController(canvas, {
    defaultBackend: "webgl2",
    backendFactories: factories(instances),
  });
  controller.present(frame(0x11223344));
  const partial = frame(0x11223344);
  partial.pixels[3] = 0x55667788;
  controller.present({
    ...partial,
    rect: { x: 1, y: 1, width: 1, height: 1 },
  });
  const oldBackend = controller.backend;
  let prevented = false;
  canvas.dispatch("webglcontextlost", { preventDefault: () => { prevented = true; } });

  const state = controller.snapshot();
  assert.equal(prevented, true);
  assert.equal(parent.child, controller.canvas);
  assert.notEqual(controller.canvas, canvas);
  assert.equal(controller.backendName, "canvas2d");
  assert.equal(oldBackend.disposed, true);
  assert.equal(state.replayedFrames, 1);
  assert.ok(state.droppedFrames <= 1);
  assert.deepEqual(instances.at(-1).presents[0].rect, { x: 0, y: 0, width: 2, height: 2 });
  assert.deepEqual([...controller.backend.presents[0].pixels], [0x11223344, 0x11223344, 0x11223344, 0x55667788]);
  assert.equal(canvas.listeners.get("webglcontextlost")?.size ?? 0, 0);
  assert.equal(controller.snapshot().listenerCount, 2);

  controller.resize(3, 1);
  controller.present(frame(0xaabbccdd, 3, 1));
  assert.equal(controller.snapshot().backend, "canvas2d");
  assert.equal(controller.snapshot().successfulPresents, 4);
  assert.deepEqual([...controller.backend.presents.at(-1).pixels], [0xaabbccdd, 0xaabbccdd, 0xaabbccdd]);
  controller.dispose();
  assert.equal(controller.snapshot().listenerCount, 0);
});

test("rapid presents are synchronous, last-frame-wins, and listener ownership is bounded", () => {
  const instances = [];
  const canvas = new FakeCanvas(1, 1);
  const controller = new PresentationController(canvas, {
    backendFactories: factories(instances),
  });
  for (let value = 0; value < 1_000; value += 1) {
    assert.equal(controller.present(frame(value, 1, 1)), true);
  }
  const state = controller.snapshot();
  assert.equal(state.framesReceived, 1_000);
  assert.equal(state.successfulPresents, 1_000);
  assert.equal(state.droppedFrames, 0);
  assert.equal(controller.backend.presents.at(-1).pixels[0], 999);
  assert.equal(state.listenerCount, 2);
  controller.dispose();
  assert.equal(controller.snapshot().listenerCount, 0);
  assert.equal(canvas.listeners.get("webglcontextlost")?.size ?? 0, 0);
});
