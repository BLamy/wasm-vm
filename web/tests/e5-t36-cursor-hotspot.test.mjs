// E5-T36 — hotspot inference for a cursor image the device did not describe.

import assert from "node:assert/strict";
import test from "node:test";

import { CursorHotspotEstimator } from "../src/sink/cursor-hotspot.js";

// A guest that places a `w`×`h` cursor plane at pointer minus `hot`, `lag` sent positions late.
function guest(estimator, key, w, h, hot, { lag = 0, jitter = () => 0 } = {}) {
  const sent = [];
  return {
    pointer(x, y) {
      estimator.notePointer(x, y);
      sent.push({ x, y });
      const seenByGuest = sent[sent.length - 1 - lag];
      if (!seenByGuest) return null;
      return estimator.noteMove(key, w, h, seenByGuest.x - hot.x + jitter(), seenByGuest.y - hot.y + jitter());
    },
  };
}

test("an arrow, a hand and a text caret each resolve to their own hotspot after two moves", () => {
  for (const hot of [{ x: 4, y: 3 }, { x: 13, y: 5 }, { x: 32, y: 31 }, { x: 0, y: 0 }, { x: 63, y: 63 }]) {
    const estimator = new CursorHotspotEstimator();
    const g = guest(estimator, "image", 64, 64, hot);
    assert.equal(g.pointer(300, 200), null, "one position cannot decide");
    assert.deepEqual({ ...g.pointer(517, 388) }, hot);
    assert.deepEqual({ ...estimator.hotspot("image") }, hot);
    assert.deepEqual({ ...g.pointer(10, 10) }, hot, "a resolved image keeps its hotspot");
  }
});

test("a guest several moves behind the pointer still resolves to the true hotspot", () => {
  const estimator = new CursorHotspotEstimator();
  const hot = { x: 12, y: 20 };
  const g = guest(estimator, "caret", 48, 48, hot, { lag: 5 });
  let resolved = null;
  // A sweep: neighbouring sent positions are closer together than the image is wide, so every
  // plane position has many plausible explanations until the path bends.
  for (let i = 0; i < 40 && !resolved; i += 1) resolved = g.pointer(100 + 7 * i, 300 + (i % 9) * 11);
  assert.deepEqual({ ...resolved }, hot);
});

test("a straight sweep alone does not guess", () => {
  const estimator = new CursorHotspotEstimator();
  const g = guest(estimator, "arrow", 64, 64, { x: 4, y: 4 }, { lag: 3 });
  // Along a perfectly straight, evenly spaced line every lag looks the same: several offsets
  // explain every plane position, so nothing may be reported...
  let resolved = null;
  for (let i = 0; i < 30; i += 1) resolved = g.pointer(100 + 10 * i, 100 + 10 * i) ?? resolved;
  assert.equal(resolved, null);
  // ...until the pointer rests and the guest catches up: the last sent position then explains
  // the plane with exactly one offset left in common.
  for (let i = 0; i < 4; i += 1) resolved = g.pointer(400 + i, 251) ?? resolved;
  for (let i = 0; i < 4; i += 1) resolved = g.pointer(90, 500 + 30 * i) ?? resolved;
  assert.deepEqual({ ...resolved }, { x: 4, y: 4 });
});

test("one pixel of guest rounding is tolerated; a second image is independent", () => {
  const estimator = new CursorHotspotEstimator();
  let flip = 0;
  const arrow = guest(estimator, "arrow", 64, 64, { x: 6, y: 2 }, { jitter: () => (flip++ % 3) - 1 });
  let resolved = null;
  for (const [x, y] of [[40, 40], [900, 120], [333, 700], [50, 600]]) resolved = arrow.pointer(x, y) ?? resolved;
  assert.ok(Math.abs(resolved.x - 6) <= 1 && Math.abs(resolved.y - 2) <= 1, JSON.stringify(resolved));
  const hand = guest(estimator, "hand", 64, 64, { x: 20, y: 9 });
  hand.pointer(200, 200);
  assert.deepEqual({ ...hand.pointer(260, 410) }, { x: 20, y: 9 });
  assert.ok(estimator.hotspot("arrow") !== null);
});

test("plane positions left of the origin arrive wrapped as u32", () => {
  const estimator = new CursorHotspotEstimator();
  const hot = { x: 30, y: 30 };
  estimator.notePointer(5, 8);
  assert.equal(estimator.noteMove("caret", 64, 64, (5 - hot.x) >>> 0, (8 - hot.y) >>> 0), null);
  estimator.notePointer(400, 2);
  assert.deepEqual({ ...estimator.noteMove("caret", 64, 64, 370, (2 - hot.y) >>> 0) }, hot);
});

test("positions nothing recent explains are ignored, and forgetting an image starts it over", () => {
  const estimator = new CursorHotspotEstimator({ history: 4 });
  estimator.notePointer(100, 100);
  assert.equal(estimator.noteMove("a", 32, 32, 900, 900), null, "no sent position is within the image");
  assert.equal(estimator.noteMove("a", 32, 32, 96, 97), null);
  estimator.notePointer(300, 310);
  assert.deepEqual({ ...estimator.noteMove("a", 32, 32, 296, 307) }, { x: 4, y: 3 });
  estimator.forget("a");
  assert.equal(estimator.hotspot("a"), null);
  estimator.notePointer(20, 20);
  assert.equal(estimator.noteMove("a", 32, 32, 10, 12), null);
  estimator.notePointer(200, 90);
  assert.deepEqual({ ...estimator.noteMove("a", 32, 32, 190, 82) }, { x: 10, y: 8 });
  assert.throws(() => estimator.noteMove("a", 0, 32, 1, 1), RangeError);
});

// ── The controller: a CSS cursor from a device that reports no hotspot gains the inferred one ──
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CursorController } from "../src/sink/cursor-controller.js";

test("the number of remembered images is bounded; a forgotten one is inferred again", () => {
  assert.throws(() => new CursorHotspotEstimator({ maxImages: 0 }), RangeError);
  const e = new CursorHotspotEstimator({ maxImages: 3 });
  const resolve = (key, hot) => {
    let got = null;
    for (const [x, y] of [[200, 200], [260, 240], [310, 205], [240, 280]]) {
      e.notePointer(x, y);
      got = e.noteMove(key, 64, 64, x - hot[0], y - hot[1]) ?? got;
    }
    return got;
  };
  assert.deepEqual(resolve("a", [1, 1]), { x: 1, y: 1 });
  assert.deepEqual(resolve("b", [9, 4]), { x: 9, y: 4 });
  assert.deepEqual(resolve("c", [4, 8]), { x: 4, y: 8 });
  assert.deepEqual(e.hotspot("a"), { x: 1, y: 1 });
  // A fourth image pushes the oldest out; the other three stay.
  assert.deepEqual(resolve("d", [16, 16]), { x: 16, y: 16 });
  assert.equal(e.hotspot("a"), null);
  for (const [key, hot] of [["b", [9, 4]], ["c", [4, 8]], ["d", [16, 16]]]) assert.deepEqual(e.hotspot(key), { x: hot[0], y: hot[1] });
  // The forgotten image comes back like a new one, and may have a different hotspot now.
  assert.deepEqual(resolve("a", [2, 3]), { x: 2, y: 3 });
  assert.equal(e.hotspot("b"), null);
  // A long run of distinct images never holds more than the cap.
  for (let i = 0; i < 500; i++) { e.notePointer(100 + (i % 7) * 31, 100 + (i % 5) * 17); e.noteMove(`anim-${i}`, 32, 32, 90, 90); }
  assert.equal(e._images.size, 3);
});

test("source and no-bundler cursor-hotspot projection stay byte-identical", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/sink");
  assert.equal(readFileSync(path.join(dir, "cursor-hotspot.ts"), "utf8"),
    readFileSync(path.join(dir, "cursor-hotspot.js"), "utf8"));
});

function cursorTarget() {
  return { style: { cursor: "auto" }, appendChild() {}, removeChild() {} };
}
function update(resourceId, hotX, hotY, x, y, fill = 0xff0000ff) {
  return { type: "cursor-update", state: { resourceId, hotX, hotY, pos: { scanoutId: 0, x, y } },
    format: 1, resourceWidth: 8, resourceHeight: 8, pixels: new Uint32Array(64).fill(fill) };
}
function move(resourceId, hotX, hotY, x, y) {
  return { type: "cursor-move", state: { resourceId, hotX, hotY, pos: { scanoutId: 0, x, y } } };
}
const hotspotOf = (css) => css.match(/\) (\d+) (\d+),/).slice(1).map(Number);

test("a hotspot-less CSS cursor gets its inferred hotspot, once, and keeps it across updates", () => {
  const target = cursorTarget();
  const controller = new CursorController({ target, documentTarget: null });
  const hot = { x: 3, y: 5 };
  controller.notePointer(100, 100);
  assert.ok(controller.handle(update(7, 0, 0, 100 - hot.x, 100 - hot.y)));
  assert.deepEqual(hotspotOf(target.style.cursor), [0, 0], "nothing can be inferred from one position");
  controller.notePointer(160, 140);
  const before = controller.snapshot().styleWrites;
  assert.ok(controller.handle(move(7, 0, 0, 160 - hot.x, 140 - hot.y)));
  assert.deepEqual(hotspotOf(target.style.cursor), [hot.x, hot.y]);
  assert.equal(controller.snapshot().styleWrites, before + 1, "one style write for the hotspot");
  assert.deepEqual([controller.snapshot().inferredHotX, controller.snapshot().inferredHotY], [hot.x, hot.y]);
  assert.deepEqual([controller.snapshot().hotX, controller.snapshot().hotY], [0, 0], "the device's own report is unchanged");
  controller.notePointer(200, 200);
  assert.ok(controller.handle(move(7, 0, 0, 200 - hot.x, 200 - hot.y)));
  assert.equal(controller.snapshot().styleWrites, before + 1, "later moves write no style");
  // The same image installed again (another resource id) is recognised at once.
  assert.ok(controller.handle(update(9, 0, 0, 200 - hot.x, 200 - hot.y)));
  assert.deepEqual(hotspotOf(target.style.cursor), [hot.x, hot.y]);
  // A different image starts from scratch.
  assert.ok(controller.handle(update(11, 0, 0, 200, 200, 0xff00ff00)));
  assert.deepEqual(hotspotOf(target.style.cursor), [0, 0]);
  assert.equal(controller.snapshot().inferredHotX, null);
});

test("a device that reports a hotspot is never second-guessed", () => {
  const target = cursorTarget();
  const controller = new CursorController({ target, documentTarget: null });
  controller.notePointer(50, 50);
  assert.ok(controller.handle(update(3, 2, 6, 48, 44)));
  controller.notePointer(90, 70);
  assert.ok(controller.handle(move(3, 2, 6, 85, 60)));
  assert.deepEqual(hotspotOf(target.style.cursor), [2, 6]);
  assert.equal(controller.snapshot().inferredHotX, null);
});
