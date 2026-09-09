// E5-T15c — cursor mode wiring, transform-only movement, and DOM lifecycle.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURSOR_EVENTS,
  CURSOR_MODES,
  CursorController,
} from "../src/sink/cursor-controller.js";

const CURSOR_FORMAT_B8G8R8A8_UNORM = 1;

function trackedStyle(initial = {}) {
  const writes = [];
  return new Proxy({ ...initial }, {
    get(target, property) {
      if (property === "writes") return writes;
      return target[property];
    },
    set(target, property, value) {
      writes.push(String(property));
      target[property] = value;
      return true;
    },
  });
}

class FakeImage {
  constructor() {
    this.style = trackedStyle();
    this.src = "";
    this.alt = null;
    this.draggable = null;
    this.attributes = new Map();
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

class FakeSurface {
  constructor(cursor = "auto") {
    this.style = trackedStyle({ cursor, position: "" });
    this.children = [];
    this.listeners = new Map();
    this.layoutReads = 0;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    assert.notEqual(index, -1, "removing a cursor overlay must target an attached node");
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  // A MOVE_CURSOR test must fail immediately if the implementation starts measuring layout.
  getBoundingClientRect() {
    this.layoutReads += 1;
    throw new Error("layout read is forbidden during cursor movement");
  }
}

function makeDom() {
  const target = new FakeSurface();
  const documentTarget = {
    createElement: (tagName) => {
      assert.equal(tagName, "img");
      return new FakeImage();
    },
  };
  return { target, documentTarget };
}

function state(resourceId, hotX = 10, hotY = 3, x = 100, y = 50) {
  return {
    resourceId,
    hotX,
    hotY,
    pos: { scanoutId: 0, x, y },
  };
}

function update(controller, resourceId = 7, width = 64, height = 64, hotX = 10, hotY = 3, x = 100, y = 50) {
  return controller.handle({
    type: CURSOR_EVENTS.UPDATE,
    state: state(resourceId, hotX, hotY, x, y),
    format: CURSOR_FORMAT_B8G8R8A8_UNORM,
    resourceWidth: width,
    resourceHeight: height,
    pixels: new Uint32Array(width * height).fill(0xff102030),
  });
}

test("source and no-bundler cursor-controller projection stay byte-identical", () => {
  const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/sink");
  assert.equal(
    readFileSync(path.join(inputDir, "cursor-controller.ts"), "utf8"),
    readFileSync(path.join(inputDir, "cursor-controller.js"), "utf8"),
  );
});

test("absolute mode owns CSS and suppresses the overlay; relative mode owns overlay and lock hiding", () => {
  const { target, documentTarget } = makeDom();
  const controller = new CursorController({ target, documentTarget });
  assert.equal(target.style.cursor, "auto");
  assert.equal(target.children.length, 0);
  assert.equal(controller.snapshot().hostCursorOwned, false);

  const absolute = update(controller);
  assert.equal(absolute.kind, "css");
  assert.equal(target.style.cursor, controller.descriptor().css);
  assert.equal(target.children.length, 0);
  assert.equal(controller.snapshot().overlayAttached, false);

  controller.setPointerState({ mode: CURSOR_MODES.RELATIVE, pointerLocked: false });
  assert.equal(target.style.cursor, "auto", "relative request does not hide the host cursor before lock");
  assert.equal(target.children.length, 1);
  const overlay = target.children[0];
  assert.equal(overlay.style.willChange, "transform");
  assert.equal(overlay.style.pointerEvents, "none");
  assert.equal(overlay.style.transform, "translate3d(90px, 47px, 0)");

  controller.setPointerState({ mode: CURSOR_MODES.RELATIVE, pointerLocked: true });
  assert.equal(target.style.cursor, "none");
  assert.equal(controller.snapshot().hostCursorHidden, true);

  controller.setPointerState({ mode: CURSOR_MODES.ABSOLUTE, pointerLocked: false });
  assert.equal(target.style.cursor, controller.descriptor().css);
  assert.equal(target.children.length, 0);
  assert.equal(controller.snapshot().hostCursorHidden, false);
});

test("500 MOVE_CURSOR callbacks update only the existing overlay transform and never measure layout", () => {
  const { target, documentTarget } = makeDom();
  const modeStateChanges = [];
  const controller = new CursorController({
    target,
    documentTarget,
    onStateChange: (snapshot) => modeStateChanges.push(snapshot.reason),
  });
  update(controller);
  controller.setPointerState({ mode: CURSOR_MODES.RELATIVE, pointerLocked: true });
  const overlay = target.children[0];
  const sourceUrl = overlay.src;
  const writesBefore = overlay.style.writes.length;
  const modeStateChangesBeforeMoves = modeStateChanges.length;

  for (let index = 0; index < 500; index += 1) {
    const result = controller.handle({
      type: CURSOR_EVENTS.MOVE,
      state: state(7, 10, 3, 200 + index, 300 + index),
      // MOVE_CURSOR deliberately carries no format, dimensions, or pixel view.
      format: null,
      resourceWidth: 0,
      resourceHeight: 0,
      pixels: new Uint32Array(0),
    });
    assert.notEqual(result, false);
  }
  assert.equal(target.layoutReads, 0);
  assert.equal(target.children.length, 1);
  assert.equal(target.children[0], overlay);
  assert.equal(overlay.src, sourceUrl);
  assert.deepEqual(overlay.style.writes.slice(writesBefore), Array(500).fill("transform"));
  assert.equal(overlay.style.transform, "translate3d(689px, 796px, 0)");
  assert.equal(controller.snapshot().moves, 500);
  assert.equal(modeStateChanges.length, modeStateChangesBeforeMoves);
});

test("replacement, hide/unref, reset, and software-fbcon no-traffic paths leave no stale DOM", () => {
  const { target, documentTarget } = makeDom();
  const controller = new CursorController({ target, documentTarget });

  // No cursorq event means no cursor style or overlay mutation at all.
  controller.setPointerState({ mode: CURSOR_MODES.ABSOLUTE, pointerLocked: false });
  assert.equal(target.style.cursor, "auto");
  assert.equal(target.children.length, 0);
  assert.equal(controller.snapshot().hostCursorOwned, false);

  const first = update(controller, 7, 64, 64, 10, 3);
  assert.equal(target.style.cursor, controller.descriptor().css);
  const second = update(controller, 8, 64, 64, 4, 2, 20, 30);
  assert.equal(target.style.cursor, controller.descriptor().css);
  assert.equal(target.children.length, 0);

  controller.setPointerState({ mode: CURSOR_MODES.RELATIVE, pointerLocked: true });
  assert.equal(target.children.length, 1);
  const large = update(controller, 9, 256, 256, 255, 255, 30, 40);
  assert.equal(large.kind, "overlay");
  assert.equal(target.children.length, 1, "replacement reuses one owned overlay node");
  assert.equal(target.children[0].src, controller.descriptor().src);

  const hidden = controller.handle({
    type: CURSOR_EVENTS.UPDATE,
    state: state(0, 0, 0, 0, 0),
    format: null,
    resourceWidth: 0,
    resourceHeight: 0,
    pixels: new Uint32Array(0),
  });
  assert.equal(hidden.kind, "hidden");
  assert.equal(target.children.length, 0);
  assert.equal(target.style.cursor, "auto");
  assert.equal(controller.snapshot().resourceId, 0);

  controller.reset();
  controller.reset();
  assert.equal(target.children.length, 0);
  assert.equal(target.style.cursor, "auto");
  assert.equal(controller.snapshot().overlayAttached, false);
  controller.dispose();
  assert.equal(target.children.length, 0);
});

test("invalid mode/move state fails closed without disturbing the copied cursor", () => {
  const { target, documentTarget } = makeDom();
  const diagnostics = [];
  const controller = new CursorController({
    target,
    documentTarget,
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  const descriptor = update(controller);
  assert.throws(() => controller.setPointerState({ mode: "diagonal" }), /unknown cursor mode/);
  assert.equal(controller.handle({
    type: CURSOR_EVENTS.MOVE,
    state: state(99, 10, 3, 1, 2),
    pixels: new Uint32Array(0),
  }), false);
  assert.equal(target.style.cursor, controller.descriptor().css);
  assert.equal(target.children.length, 0);
  assert.ok(diagnostics.some((entry) => entry.reason === "cursor-move-rejected"));
});

test("1,000 alternating mode/resource transitions stay bounded and return to a clean host state", () => {
  const { target, documentTarget } = makeDom();
  const controller = new CursorController({ target, documentTarget });
  for (let index = 0; index < 1_000; index += 1) {
    const resourceId = index + 1;
    update(controller, resourceId, index % 2 === 0 ? 64 : 256, index % 2 === 0 ? 64 : 256,
      index % 2 === 0 ? 10 : 255, index % 2 === 0 ? 3 : 255, index, index + 1);
    controller.setPointerState({
      mode: index % 2 === 0 ? CURSOR_MODES.ABSOLUTE : CURSOR_MODES.RELATIVE,
      pointerLocked: index % 2 === 1,
    });
    controller.handle({
      type: CURSOR_EVENTS.MOVE,
      state: state(resourceId, index % 2 === 0 ? 10 : 255, index % 2 === 0 ? 3 : 255, index + 2, index + 3),
      pixels: new Uint32Array(0),
    });
    if (index % 5 === 0) {
      controller.handle({
        type: CURSOR_EVENTS.UPDATE,
        state: state(0, 0, 0, 0, 0),
        format: null,
        resourceWidth: 0,
        resourceHeight: 0,
        pixels: new Uint32Array(0),
      });
      assert.equal(target.children.length, 0);
    }
  }
  controller.reset();
  assert.equal(target.children.length, 0);
  assert.equal(target.style.cursor, "auto");
  assert.equal(controller.snapshot().resourceId, 0);
  assert.equal(controller.snapshot().diagnostics, 0);
});
