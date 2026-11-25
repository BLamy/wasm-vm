// E5-T06d — presentation selection, context-loss recovery, and last-frame delivery.

import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

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

test("B8G8R8X8 frames normalize the unused byte to opaque before delivery", () => {
  const instances = [];
  const controller = new PresentationController(new FakeCanvas(2, 1), {
    backendFactories: factories(instances),
  });
  controller.present({
    ...frame(0x00112233, 2, 1),
    format: 2,
  });
  assert.deepEqual([...instances[0].presents[0].pixels], [0xff112233, 0xff112233]);
  controller.dispose();
});

test("clear control drops the retained frame and resets the presentation surface", () => {
  const instances = [];
  const controller = new PresentationController(new FakeCanvas(2, 2), {
    backendFactories: factories(instances),
  });
  controller.present(frame(0x11223344));
  assert.equal(controller.snapshot().latest.resourceWidth, 2);
  assert.equal(controller.present({ type: "clear" }), true);
  assert.equal(controller.snapshot().latest, null);
  assert.equal(controller.snapshot().sizeMismatch, false);
  assert.equal(controller.snapshot().successfulPresents, 1);
  controller.present(frame(0xaabbccdd));
  assert.equal(controller.snapshot().successfulPresents, 2);
  controller.dispose();
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

// A manual animation-frame source: callbacks run only when the test calls `tick()`.
function manualFrames() {
  const queue = new Map();
  let next = 1;
  return {
    request(callback) { const id = next++; queue.set(id, callback); return id; },
    cancel(id) { queue.delete(id); },
    tick() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

function partial(value, rect, width = 8, height = 8) {
  return { scanout: 0, rect, resourceWidth: width, resourceHeight: height,
    pixels: new Uint32Array(width * height).fill(value) };
}

test("frames coalesced within one animation frame paint the union of their damage", () => {
  const instances = [];
  const raf = manualFrames();
  const controller = new PresentationController(new FakeCanvas(8, 8), {
    backendFactories: factories(instances), scheduleFrames: true,
    requestFrame: raf.request, cancelFrame: raf.cancel,
  });
  // The first frame reaches the backend as a full repaint (nothing has been painted yet).
  controller.present(partial(1, { x: 0, y: 0, width: 8, height: 8 }));
  raf.tick();
  const backend = controller.backend;
  assert.deepEqual({ ...backend.presents.at(-1).rect }, { x: 0, y: 0, width: 8, height: 8 });

  // Two flushes land before the next animation frame: a "button" repaint, then a "cursor" flush
  // elsewhere. Only the newest frame is kept, but both regions must be painted.
  controller.present(partial(2, { x: 1, y: 1, width: 2, height: 2 }));
  controller.present(partial(3, { x: 5, y: 6, width: 1, height: 1 }));
  assert.equal(backend.presents.length, 1, "nothing is painted before the animation frame");
  raf.tick();
  assert.equal(backend.presents.length, 2, "the two flushes coalesce into one present");
  assert.deepEqual({ ...backend.presents.at(-1).rect }, { x: 1, y: 1, width: 5, height: 6 });
  assert.equal(backend.presents.at(-1).pixels[0], 3, "with the newest frame's pixels");

  // Painted damage is not carried into the next animation frame.
  controller.present(partial(4, { x: 7, y: 0, width: 1, height: 1 }));
  raf.tick();
  assert.deepEqual({ ...backend.presents.at(-1).rect }, { x: 7, y: 0, width: 1, height: 1 });

  // Three coalesced flushes, the middle one inside the first: still one covering rect.
  controller.present(partial(5, { x: 0, y: 0, width: 4, height: 4 }));
  controller.present(partial(6, { x: 1, y: 1, width: 1, height: 1 }));
  controller.present(partial(7, { x: 3, y: 3, width: 2, height: 2 }));
  raf.tick();
  assert.deepEqual({ ...backend.presents.at(-1).rect }, { x: 0, y: 0, width: 5, height: 5 });
  assert.equal(controller.snapshot().framesReceived, 7);
  controller.dispose();
});

test("queued damage of another resource size is not unioned into a resized frame", () => {
  const instances = [];
  const raf = manualFrames();
  const controller = new PresentationController(new FakeCanvas(8, 8), {
    backendFactories: factories(instances), scheduleFrames: true,
    requestFrame: raf.request, cancelFrame: raf.cancel,
  });
  controller.present(partial(1, { x: 0, y: 0, width: 8, height: 8 }));
  raf.tick();
  controller.present(partial(2, { x: 6, y: 6, width: 2, height: 2 }));
  // The resource shrinks before the animation frame: the old rect no longer describes it.
  controller.present(partial(3, { x: 0, y: 0, width: 1, height: 1 }, 4, 4));
  raf.tick();
  const last = controller.backend.presents.at(-1);
  assert.deepEqual({ ...last.rect }, { x: 0, y: 0, width: 4, height: 4 }, "a new size repaints in full");
  assert.equal(last.pixels.length, 16);
  controller.dispose();
});

test("an immediate present keeps the damage of the queued frame it replaces", () => {
  const instances = [];
  const raf = manualFrames();
  const controller = new PresentationController(new FakeCanvas(8, 8), {
    backendFactories: factories(instances), scheduleFrames: true,
    requestFrame: raf.request, cancelFrame: raf.cancel,
  });
  controller.present(partial(1, { x: 0, y: 0, width: 8, height: 8 }));
  raf.tick();
  controller.present(partial(2, { x: 0, y: 0, width: 2, height: 2 }));
  controller.presentNow(partial(3, { x: 6, y: 6, width: 2, height: 2 }));
  assert.deepEqual({ ...controller.backend.presents.at(-1).rect }, { x: 0, y: 0, width: 8, height: 8 });
  raf.tick();
  assert.equal(controller.backend.presents.length, 2, "the replaced frame is not painted again");
  controller.dispose();
});

// Promoted by the E5-T35a verifier. The resized case above repaints in full with or without the
// size check, because a resource-following resize forgets the painted size. A fixed viewport has no
// such reset, so there a rect unioned across two resource sizes would reach the backend unchanged.
test("under a fixed viewport, queued damage of another resource size is not unioned", () => {
  const own = { x: 0, y: 0, width: 1, height: 1 };
  const whole = { x: 0, y: 0, width: 8, height: 8 };
  for (const [width, height, rect] of [
    [16, 16, { x: 12, y: 12, width: 4, height: 4 }], // larger: a union would leave the 8x8 resource
    [8, 16, { x: 0, y: 12, width: 8, height: 4 }], // same width, taller
    [4, 8, { x: 2, y: 5, width: 2, height: 3 }], // same height, narrower: a union would stay in bounds
  ]) {
    const instances = [];
    const raf = manualFrames();
    const controller = new PresentationController(new FakeCanvas(8, 8), {
      backendFactories: factories(instances), scheduleFrames: true,
      requestFrame: raf.request, cancelFrame: raf.cancel,
    });
    controller.setViewport(8, 8);
    controller.present(partial(1, whole));
    raf.tick();
    // A frame of another size is queued, then replaced before it is painted.
    controller.present(partial(2, rect, width, height));
    controller.present(partial(3, own));
    raf.tick();
    const backend = controller.backend;
    assert.equal(backend.presents.length, 2, `${width}x${height}: the pair coalesces into one present`);
    const painted = { ...backend.presents.at(-1).rect };
    // The controller paints the frame's own rect today; a full repaint would be correct as well.
    // A rect that mixes the two coordinate spaces is not.
    assert.ok(isDeepStrictEqual(painted, own) || isDeepStrictEqual(painted, whole),
      `${width}x${height}: painted ${JSON.stringify(painted)}`);
    assert.equal(backend.presents.at(-1).pixels[0], 3, "with the newest frame's pixels");
    assert.deepEqual(controller.snapshot().errors, []);
    controller.dispose();
  }
});
