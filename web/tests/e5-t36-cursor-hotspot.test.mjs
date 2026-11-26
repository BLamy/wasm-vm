// E5-T36 — hotspot inference for a cursor image the device did not describe.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CursorController, HOTSPOT_CAUGHT_UP_TIMEOUT_MS, HOTSPOT_POLL_MS, HOTSPOT_REST_MS, HOTSPOT_SETTLE_FALLBACK_MS } from "../src/sink/cursor-controller.js";
import { CursorHotspotEstimator } from "../src/sink/cursor-hotspot.js";

// ── The estimator, fed only what it may be fed: plane positions the guest MOVED the plane to ──

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

test("the edges of what counts: one place twice, offsets outside the image, offsets three pixels apart", () => {
  // The same plane position reported twice is one piece of evidence, not two.
  const once = new CursorHotspotEstimator();
  once.notePointer(300, 200);
  assert.equal(once.noteMove("a", 64, 64, 296, 197), null);
  assert.equal(once.noteMove("a", 64, 64, 296, 197), null);
  assert.equal(once.hotspot("a"), null);
  // An offset is a candidate only inside the image, give or take the one pixel of rounding:
  // 17 px into a 16 px image is not one, however often it repeats.
  const outside = new CursorHotspotEstimator();
  for (const [x, y] of [[117, 100], [317, 240], [217, 400]]) { outside.notePointer(x, y); assert.equal(outside.noteMove("b", 16, 16, x - 17, y), null); }
  assert.equal(outside.hotspot("b"), null);
  // 16 px (one past the last column, the rounding slack) is a candidate and is clamped into
  // the image; so is -1.
  const edge = new CursorHotspotEstimator();
  for (const [x, y] of [[100, 100], [300, 200]]) { edge.notePointer(x, y); edge.noteMove("c", 16, 16, x - 16, y - 16); }
  assert.deepEqual({ ...edge.hotspot("c") }, { x: 15, y: 15 });
  for (const [x, y] of [[500, 100], [700, 200]]) { edge.notePointer(x, y); edge.noteMove("d", 16, 16, x + 1, y + 1); }
  assert.deepEqual({ ...edge.hotspot("d") }, { x: 0, y: 0 });
  // Two offsets three pixels apart are two answers, not one: no guess while both fit.
  const apart = new CursorHotspotEstimator();
  apart.notePointer(100, 500); apart.notePointer(103, 500);
  assert.equal(apart.noteMove("e", 64, 64, 91, 496), null);
  apart.notePointer(203, 520); apart.notePointer(206, 520);
  assert.equal(apart.noteMove("e", 64, 64, 194, 516), null, "(9,4) and (12,4) both explain both moves");
  assert.equal(apart.hotspot("e"), null);
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

test("a straight sweep alone does not guess; the pointer at rest settles it", () => {
  const estimator = new CursorHotspotEstimator();
  const hot = { x: 4, y: 4 };
  const g = guest(estimator, "arrow", 64, 64, hot, { lag: 3 });
  // Along a perfectly straight, evenly spaced line every lag looks the same: several offsets
  // explain every plane position, so nothing may be reported.
  let resolved = null;
  for (let i = 0; i < 30; i += 1) resolved = g.pointer(100 + 10 * i, 100 + 10 * i) ?? resolved;
  assert.equal(resolved, null);
  assert.equal(estimator.hotspot("arrow"), null);
  // The pointer stops and the guest catches up: its lag shrinks from three positions to none,
  // and only the true offset explains the plane at every lag.
  for (const i of [27, 28, 29]) resolved = estimator.noteMove("arrow", 64, 64, 100 + 10 * i - hot.x, 100 + 10 * i - hot.y) ?? resolved;
  assert.deepEqual({ ...resolved }, hot);
  assert.deepEqual({ ...estimator.noteRest("arrow", 64, 64) }, hot, "rest confirms what is already known");
});

test("a rest answer needs a move of this image since it was installed, and never overrides evidence", () => {
  const e = new CursorHotspotEstimator();
  assert.equal(e.noteRest("never-seen", 64, 64), null);
  e.notePointer(300, 300);
  assert.equal(e.noteMove("hand", 64, 64, 291, 296), null);
  // Re-installed (the pointer left and came back): the plane position remembered from the
  // earlier showing is no longer where the plane is.
  e.noteInstall("hand");
  e.notePointer(520, 410);
  assert.equal(e.noteRest("hand", 64, 64), null, "no move since the install");
  e.noteInstall("not-an-image-yet"); // unknown keys are fine
  // One move since the install, in the middle of a run of sent positions: two offsets fit.
  e.notePointer(540, 410);
  assert.equal(e.noteMove("caret", 64, 64, 516, 402), null, "(4,8) and (24,8) both explain it");
  assert.deepEqual({ ...e.noteRest("caret", 64, 64) }, { x: 24, y: 8 },
    "at rest the last position sent is the one the plane stands for");
  // (The hand's two moves, one before and one after its install, agree on (9,4) by themselves.)
  assert.deepEqual({ ...e.noteMove("hand", 64, 64, 511, 406) }, { x: 9, y: 4 });
  // The plane position of an earlier showing is not where the plane is after the image came
  // back, even when the last position sent would fit it.
  const back = new CursorHotspotEstimator();
  back.notePointer(300, 300); back.notePointer(310, 300);
  assert.equal(back.noteMove("hand", 64, 64, 291, 296), null, "(9,4) and (19,4)");
  back.noteInstall("hand");
  assert.equal(back.noteRest("hand", 64, 64), null, "(310,300) - (291,296) = (19,4) fits, but that plane position is history");
  // A rest position no move allows is not an answer: here the guest moved the plane for an
  // older position and nothing sent since explains it within the image.
  const f = new CursorHotspotEstimator();
  f.notePointer(100, 100);
  assert.equal(f.noteMove("caret", 32, 32, 96, 92), null);
  f.notePointer(400, 400);
  assert.equal(f.noteRest("caret", 32, 32), null, "(304,308) is outside the image");
  f.notePointer(110, 104);
  assert.equal(f.noteRest("caret", 32, 32), null, "(14,12) is inside the image but no move allowed it");
  assert.throws(() => f.noteRest("caret", 0, 32), RangeError);
});

test("rest is the caller's knowledge: read off a plane still on its way, it is simply wrong", () => {
  // The estimator cannot know whether the guest has caught up; `noteRest` says so and leaves it
  // to the caller (the controller asks the guest's idle counter). This is what the rule would
  // answer without that knowledge — the reason it must never be called on quiet alone.
  const e = new CursorHotspotEstimator();
  const hot = { x: 9, y: 4 };
  const xs = [100, 110, 120, 130, 140, 150]; // an even run; the guest is two positions behind
  for (const x of xs) e.notePointer(x, 500);
  assert.equal(e.sends, 6);
  e.notePointer(150, 500);
  assert.equal(e.sends, 6, "the same position again is not a new one");
  for (const x of xs.slice(0, 4)) assert.equal(e.noteMove("hand", 64, 64, x - hot.x, 500 - hot.y), null);
  assert.deepEqual({ ...e.noteRest("hand", 64, 64) }, { x: 29, y: 4 }, "(150,500) - (121,496): an offset every move allowed");
  // Asked when the guest HAS caught up, the same question has the right answer. (An even run
  // to the left, the guest keeping up: the positions sent before the hand appeared keep
  // explaining its plane with 19, 29 and 39 px, so the moves alone decide nothing.)
  const f = new CursorHotspotEstimator();
  for (const x of [160, 150, 140]) f.notePointer(x, 500);
  for (const x of [130, 120, 110, 100]) { f.notePointer(x, 500); assert.equal(f.noteMove("hand", 64, 64, x - hot.x, 500 - hot.y), null, "an even run decides nothing"); }
  assert.deepEqual({ ...f.noteRest("hand", 64, 64) }, hot);
  // Rest never answers without a move that left candidates, and clamps like any answer.
  const g = new CursorHotspotEstimator();
  g.notePointer(300, 300);
  assert.equal(g.noteMove("far", 16, 16, 100, 100), null, "nothing sent explains this plane");
  g.notePointer(110, 108);
  assert.equal(g.noteRest("far", 16, 16), null, "no candidates at all: (10,8) is not an answer");
  const h = new CursorHotspotEstimator();
  h.notePointer(200, 200); h.notePointer(216, 216);
  assert.equal(h.noteMove("edge", 16, 16, 200, 200), null, "(0,0) and (16,16)");
  assert.deepEqual({ ...h.noteRest("edge", 16, 16) }, { x: 15, y: 15 }, "one past the last column is the rounding slack, clamped");
});

test("an answer the guest contradicts three moves in a row is dropped and inferred again", () => {
  const e = new CursorHotspotEstimator();
  const wrong = { x: 20, y: 10 };
  const truth = { x: 9, y: 4 };
  // Two moves that agree on a wrong hotspot (evidence that did not belong to this image).
  for (const [x, y] of [[300, 300], [420, 380]]) { e.notePointer(x, y); e.noteMove("hand", 64, 64, x - wrong.x, y - wrong.y); }
  assert.deepEqual({ ...e.hotspot("hand") }, wrong);
  // The guest's real moves: each is explained by a sent position, none by the answer.
  const moves = [[500, 200], [640, 330], [710, 250], [800, 400]];
  const answers = moves.map(([x, y]) => { e.notePointer(x, y); return e.noteMove("hand", 64, 64, x - truth.x, y - truth.y); });
  assert.deepEqual({ ...answers[0] }, wrong, "one contradiction is not enough");
  assert.deepEqual({ ...answers[1] }, wrong);
  assert.equal(answers[2], null, "the third drops it");
  assert.deepEqual({ ...answers[3] }, truth, "and the next move settles the true one");

  // A right answer survives what a lagging guest does to it.
  const g = new CursorHotspotEstimator({ history: 8 });
  const sent = [];
  const send = (x, y) => { g.notePointer(x, y); sent.push([x, y]); };
  const report = (i) => g.noteMove("arrow", 64, 64, sent[i][0] - 1, sent[i][1] - 1);
  send(100, 100); report(0); send(300, 180); assert.deepEqual({ ...report(1) }, { x: 1, y: 1 });
  // The same place twice; a move one sent position explains; then the guest falls so far
  // behind that nothing in the history explains its plane at all — no evidence either way.
  assert.deepEqual({ ...report(1) }, { x: 1, y: 1 });
  for (let i = 0; i < 20; i += 1) send(1000 + 13 * i, 20 + 31 * (i % 7));
  for (const i of [2, 3, 4, 5, 6]) assert.deepEqual({ ...report(i) }, { x: 1, y: 1 }, `report ${i}`);
  // Two contradictions and then an explained move: the count starts over.
  send(500, 500); g.noteMove("arrow", 64, 64, 480, 480);
  send(520, 560); g.noteMove("arrow", 64, 64, 500, 540);
  send(600, 600); assert.deepEqual({ ...g.noteMove("arrow", 64, 64, 599, 599) }, { x: 1, y: 1 });
  send(700, 640); g.noteMove("arrow", 64, 64, 680, 620);
  send(720, 700); assert.deepEqual({ ...g.noteMove("arrow", 64, 64, 700, 680) }, { x: 1, y: 1 }, "two again, not three");
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

test("positions nothing recent explains are ignored; reset forgets positions and images", () => {
  const estimator = new CursorHotspotEstimator({ history: 4 });
  estimator.notePointer(100, 100);
  assert.equal(estimator.noteMove("a", 32, 32, 900, 900), null, "no sent position is within the image");
  assert.equal(estimator.noteMove("a", 32, 32, 96, 97), null);
  estimator.notePointer(300, 310);
  assert.deepEqual({ ...estimator.noteMove("a", 32, 32, 296, 307) }, { x: 4, y: 3 });
  estimator.reset();
  assert.equal(estimator.hotspot("a"), null);
  // Nothing sent before the reset explains anything after it.
  assert.equal(estimator.noteMove("a", 32, 32, 290, 300), null);
  assert.equal(estimator.noteRest("a", 32, 32), null);
  estimator.notePointer(20, 20);
  assert.equal(estimator.noteMove("a", 32, 32, 10, 12), null);
  estimator.notePointer(200, 90);
  assert.deepEqual({ ...estimator.noteMove("a", 32, 32, 190, 82) }, { x: 10, y: 8 });
  assert.throws(() => estimator.noteMove("a", 0, 32, 1, 1), RangeError);
  assert.throws(() => estimator.notePointer(NaN, 1), RangeError);
  for (const options of [{ history: 1 }, { tolerance: -1 }, { confirmations: 1 }, { maxImages: 0 }, { contradictions: 0 }]) {
    assert.throws(() => new CursorHotspotEstimator(options), RangeError, JSON.stringify(options));
  }
});

test("restart forgets the positions sent and what is not settled, and keeps what is", () => {
  const e = new CursorHotspotEstimator();
  // Settled: the arrow. Not settled: the caret, with one move that allows only (10,8).
  for (const [x, y] of [[100, 100], [300, 180]]) { e.notePointer(x, y); e.noteMove("arrow", 64, 64, x - 1, y - 1); }
  e.notePointer(500, 300);
  assert.equal(e.noteMove("caret", 64, 64, 490, 292), null);
  // Two contradictions against the arrow are on the books.
  for (const [x, y] of [[700, 100], [760, 180]]) { e.notePointer(x, y); e.noteMove("arrow", 64, 64, x - 30, y - 30); }
  e.restart();
  assert.deepEqual({ ...e.hotspot("arrow") }, { x: 1, y: 1 }, "a settled hotspot belongs to its image");
  assert.equal(e.hotspot("caret"), null);
  // A plane that only a position sent BEFORE the restart explains is explained by nothing.
  assert.equal(e.noteMove("caret", 64, 64, 760 - 10, 180 - 8), null);
  e.notePointer(900, 400);
  assert.equal(e.noteMove("caret", 64, 64, 890, 392), null, "the first move that counts, not the second");
  // What the caret's move before the restart allowed is gone: this move alone allows (10,8)
  // and (4,8), and nothing is settled by agreeing with the past.
  const f = new CursorHotspotEstimator();
  f.notePointer(500, 300);
  assert.equal(f.noteMove("caret", 64, 64, 490, 292), null);
  f.restart();
  f.notePointer(206, 100); f.notePointer(200, 100);
  assert.equal(f.noteMove("caret", 64, 64, 196, 92), null);
  assert.equal(f.hotspot("caret"), null);
  // The miss count starts over with the evidence: two more contradictions do not drop the arrow.
  for (const [x, y] of [[1000, 500], [1060, 580]]) { e.notePointer(x, y); e.noteMove("arrow", 64, 64, x - 30, y - 30); }
  assert.deepEqual({ ...e.hotspot("arrow") }, { x: 1, y: 1 });
});

test("the number of remembered images is bounded; a forgotten one is inferred again", () => {
  const e = new CursorHotspotEstimator({ maxImages: 3, history: 64 });
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
  // A long run of distinct images never holds more than the cap, and the sent history stays
  // at its own bound.
  for (let i = 0; i < 500; i += 1) { e.notePointer(100 + (i % 7) * 31, 100 + (i % 5) * 17); e.noteMove(`anim-${i}`, 32, 32, 90, 90); }
  assert.equal(e._images.size, 3);
  assert.equal(e._sent.length, 64);
  assert.equal(new CursorHotspotEstimator()._history, 512);
});

test("source and no-bundler projections of both sink files stay byte-identical", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/sink");
  for (const name of ["cursor-hotspot", "cursor-controller"]) {
    assert.equal(readFileSync(path.join(dir, `${name}.ts`), "utf8"), readFileSync(path.join(dir, `${name}.js`), "utf8"), name);
  }
});

// ── The controller, driven in the order the device really reports (legacy KMS) ──
//
// A commit that changes the cursor image is "set image" at the plane's PREVIOUS position — the
// one computed with the previous image's hotspot — followed by a move to pointer minus the new
// hotspot. Recorded on the Replay desktop: 559 of 560 updates carried the plane position of
// the event before them. `LegacyKmsGuest` reports exactly that, and acts on the positions the
// page sends only when the test lets it (`pump`), so it can be behind.

function cursorTarget() {
  return { style: { cursor: "auto" }, appendChild() {}, removeChild() {} };
}
const hotspotOf = (css) => css.match(/\) (\d+) (\d+),/).slice(1).map(Number);
const inferred = (controller) => {
  const s = controller.snapshot();
  return s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY];
};
// Timers on a clock the test moves.
function timers() {
  const armed = new Set(); const t = { now: 0, armed };
  t.setTimer = (fn, ms) => { const timer = { fn, ms, at: t.now + ms }; armed.add(timer); return timer; };
  t.clearTimer = (timer) => { armed.delete(timer); };
  // Let promise continuations run.
  t.flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  // Move the clock to `until`, firing every timer due on the way, in order.
  t.advance = async (until) => {
    await t.flush();
    for (;;) {
      const due = [...armed].filter((timer) => timer.at <= until).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      armed.delete(due); t.now = due.at; due.fn();
      await t.flush();
    }
    t.now = until;
  };
  t.pass = (ms) => t.advance(t.now + ms);
  return t;
}
const IMAGES = { arrow: { hot: [1, 1], fill: 0xff0000ff, id: 11 }, hand: { hot: [9, 4], fill: 0xff00ff00, id: 12 },
  caret: { hot: [4, 8], fill: 0xffff0000, id: 13 }, cross: { hot: [0, 0], fill: 0xff00ffff, id: 14 },
  described: { hot: [2, 6], fill: 0xffffff00, id: 15, reports: true } };
class LegacyKmsGuest {
  constructor(controller, { size = 16 } = {}) {
    this.controller = controller; this.size = size; this.image = null; this.plane = { x: 0, y: 0 }; this.pointer = { x: 0, y: 0 };
    this.queue = [];   // positions sent to the guest that it has not acted on yet
    this.idleWaits = 0;
  }
  _state(image, x, y) {
    const [hotX, hotY] = image.reports ? image.hot : [0, 0];
    return { resourceId: image.id, hotX, hotY, pos: { scanoutId: 0, x, y } };
  }
  update(image = this.image) {
    assert.ok(this.controller.handle({ type: "cursor-update", state: this._state(image, this.plane.x, this.plane.y),
      format: 1, resourceWidth: this.size, resourceHeight: this.size, pixels: new Uint32Array(this.size * this.size).fill(image.fill) }));
  }
  // The guest's pointer is at (x, y) and its cursor is `name`: one commit.
  show(name, x = this.pointer.x, y = this.pointer.y) {
    const image = IMAGES[name];
    this.pointer = { x, y };
    if (this.image !== image) { this.update(image); this.image = image; } // set image: at the plane's previous position
    const target = { x: x - image.hot[0], y: y - image.hot[1] };
    if (target.x !== this.plane.x || target.y !== this.plane.y) {
      this.plane = target;
      assert.ok(this.controller.handle({ type: "cursor-move", state: this._state(image, target.x, target.y) }));
    }
  }
  // Act on up to `n` queued positions with cursor `name` (default: the one shown).
  pump(n = Infinity, name = null) {
    for (let i = 0; i < n && this.queue.length; i += 1) {
      const [x, y] = this.queue.shift();
      this.show(name ?? Object.keys(IMAGES).find((key) => IMAGES[key] === this.image), x, y);
    }
  }
  // The paced clock's counter: an idle wait is taken only with nothing left to act on.
  async idleCount() {
    if (this.queue.length === 0) this.idleWaits += 1;
    return this.idleWaits;
  }
}
function rig({ idle = true, ...options } = {}) {
  const target = cursorTarget(); const t = timers();
  let guestOs = null;
  const controller = new CursorController({ target, documentTarget: null, setTimer: t.setTimer, clearTimer: t.clearTimer,
    ...(idle ? { guestIdleCount: () => guestOs.idleCount() } : {}), ...options });
  guestOs = new LegacyKmsGuest(controller);
  // The page sends a position; the guest has it queued.
  const send = (x, y, w = 1280, h = 800) => { controller.notePointer(x, y, w, h); guestOs.queue.push([x, y]); };
  // Send a position and let the guest act on everything queued at once.
  const go = (name, x, y) => { send(x, y); guestOs.pump(Infinity, name); };
  // The pointer rests long enough for the rest wait and the question to the guest.
  const rest = () => t.pass(HOTSPOT_REST_MS + 3 * HOTSPOT_POLL_MS);
  return { target, t, controller, guest: guestOs, send, go, rest };
}

// The caret appears in the middle of an even run to the left with the guest keeping up: the
// positions sent before it keep explaining its plane (4, 10 and 16 px), so its moves decide
// nothing, however many, until the pointer turns — or rests.
function ambiguousCaret(r) {
  r.go("arrow", 930, 300); r.go("arrow", 924, 300);
  r.send(918, 300); r.guest.pump(1, "caret");
  r.send(912, 300); r.guest.pump(1);
  assert.equal(inferred(r.controller), null);
  assert.equal(r.guest.queue.length, 0);
}

test("the update that installs an image is not evidence for it: its position belongs to the image before", () => {
  const r = rig();
  r.go("arrow", 400, 300); r.go("arrow", 520, 360);
  assert.deepEqual(inferred(r.controller), [1, 1]);
  // The pointer moves onto the button; the guest's cursor changes in a commit of its own,
  // after the motion: set image at the ARROW's plane (pointer - (1,1)), then move.
  r.go("arrow", 150, 500);
  r.guest.show("hand");
  assert.equal(inferred(r.controller), null, "one move of the hand decides nothing");
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  // (Fed the update's position — (149,499), eight pixels from the hand's own (141,496) — the
  // next move would have left (1,1)-ish offsets and the true (9,4) could not survive.)
  r.go("hand", 120, 520);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  // Back over the page: the arrow is installed at the HAND's plane and is still (1,1).
  r.go("hand", 100, 510); r.go("hand", 300, 600);
  r.guest.show("arrow");
  assert.deepEqual(inferred(r.controller), [1, 1], "remembered, whatever position the update carried");
  r.go("arrow", 340, 620);
  assert.deepEqual(inferred(r.controller), [1, 1]);
});

test("a recorded glide onto the button (Replay desktop, legacy KMS) ends with the hand's true hotspot", async () => {
  // Page timestamps (ms), S = guest position the page sent, U / M = the device's cursor update
  // / move with the plane position it carried, and the image shown. Recorded by the E5-T36a
  // verifier on the committed bundle: the pointer rests in the page body, glides straight onto
  // the "Run again" button in a third of a second and rests. With an update's position taken as
  // evidence this log left the hand at (45,7) — 36 px off — for the rest of the session.
  const LOG = [
    [40808.9, "U", 261, 521, "arrow"], [40808.9, "M", 258, 518, "arrow"], [40823.4, "S", 257, 517],
    [40838.2, "U", 258, 518, "arrow"], [40838.2, "M", 256, 516, "arrow"], [40840.5, "S", 256, 516],
    [40849.9, "U", 256, 516, "arrow"], [40849.9, "M", 255, 515, "arrow"], [40856.3, "S", 255, 515],
    [40865.3, "U", 255, 515, "arrow"], [40865.3, "M", 254, 514, "arrow"], [41710.9, "S", 254, 515],
    [41713.7, "U", 254, 514, "arrow"], [41713.8, "M", 253, 514, "arrow"], [41739.7, "S", 252, 515],
    [41746.2, "U", 253, 514, "arrow"], [41746.3, "M", 251, 514, "arrow"], [41756.8, "S", 249, 514],
    [41770.3, "U", 251, 514, "arrow"], [41770.3, "M", 248, 513, "arrow"], [41773.4, "S", 244, 514],
    [41784.6, "U", 248, 513, "arrow"], [41784.6, "M", 243, 513, "arrow"], [41789.5, "S", 237, 513],
    [41800.5, "U", 243, 513, "arrow"], [41800.5, "M", 236, 512, "arrow"], [41806.1, "S", 229, 512],
    [41813.8, "U", 236, 512, "arrow"], [41813.8, "M", 228, 511, "arrow"], [41823.2, "S", 220, 511],
    [41838.5, "U", 228, 511, "arrow"], [41839.9, "S", 211, 509], [41840.6, "M", 219, 510, "arrow"],
    [41854.3, "U", 219, 510, "arrow"], [41854.3, "M", 210, 508, "arrow"], [41855.7, "S", 201, 508],
    [41863.2, "U", 210, 508, "arrow"], [41863.3, "M", 200, 507, "arrow"], [41873.5, "S", 190, 507],
    [41886, "U", 200, 507, "arrow"], [41886, "M", 189, 506, "arrow"], [41888.4, "S", 181, 505],
    [41898.8, "U", 189, 506, "arrow"], [41898.8, "M", 180, 504, "arrow"], [41906.7, "S", 172, 504],
    [41917.1, "U", 180, 504, "arrow"], [41917.2, "M", 171, 503, "arrow"], [41923.2, "S", 164, 503],
    [41927.3, "U", 171, 503, "arrow"], [41927.4, "M", 163, 502, "arrow"], [41939.2, "S", 157, 502],
    [41947.1, "U", 163, 502, "arrow"], [41947.2, "M", 156, 501, "arrow"], [41955.5, "S", 152, 502],
    [41960.7, "U", 156, 501, "arrow"], [41960.7, "M", 151, 501, "arrow"], [41972, "S", 149, 501],
    [41990.1, "S", 147, 501], [42006.8, "S", 146, 501], [42013.7, "U", 151, 501, "arrow"],
    [42013.8, "M", 145, 500, "arrow"], [42018.6, "U", 145, 500, "hand"], [42018.8, "M", 137, 497, "hand"],
    [42079.8, "U", 137, 497, "hand"], [42079.8, "M", 137, 497, "hand"],
  ];
  const HOT = { arrow: [1, 1], hand: [9, 4] };
  const FILL = { arrow: 0xff0000ff, hand: 0xff00ff00 };
  const ID = { arrow: 9, hand: 6 };
  const t = timers(); t.now = LOG[0][0];
  const target = cursorTarget();
  // In the recording the plane was never more than 38 ms behind a sent position: the guest is
  // idle whenever it is asked.
  let idleWaits = 0;
  const controller = new CursorController({ target, documentTarget: null, setTimer: t.setTimer, clearTimer: t.clearTimer,
    guestIdleCount: async () => { idleWaits += 1; return idleWaits; } });
  let shown = null; const answers = [];
  const record = (why) => {
    const hot = inferred(controller);
    if (hot === null) return;
    assert.ok(Math.abs(hot[0] - HOT[shown][0]) <= 1 && Math.abs(hot[1] - HOT[shown][1]) <= 1, `${why}: ${JSON.stringify(hot)} for the ${shown}`);
    if (answers.at(-1)?.[0] !== shown) answers.push([shown, hot, why]);
  };
  for (const [at, kind, x, y, image] of LOG) {
    await t.advance(at); record(`before ${at}`);
    if (kind === "S") { controller.notePointer(x, y, 1280, 800); continue; }
    const state = { resourceId: ID[image], hotX: 0, hotY: 0, pos: { scanoutId: 0, x, y } };
    if (kind === "U") {
      shown = image;
      assert.ok(controller.handle({ type: "cursor-update", state, format: 1, resourceWidth: 64, resourceHeight: 64, pixels: new Uint32Array(4096).fill(FILL[image]) }));
    } else assert.ok(controller.handle({ type: "cursor-move", state }));
    record(`${kind} at ${at}`);
  }
  assert.equal(shown, "hand");
  assert.equal(inferred(controller), null, "one move of the hand: 9, 10, 12 and 15 px all explain it");
  await t.pass(1000); record("rest");
  assert.deepEqual(inferred(controller), [9, 4], "at rest");
  assert.deepEqual(hotspotOf(target.style.cursor), [9, 4]);
  assert.deepEqual(answers.map(([image, hot]) => [image, hot]), [["arrow", [1, 1]], ["hand", [9, 4]]]);
});

test("random approaches across an image change, in the device's order: never a wrong hotspot, right at rest", async () => {
  // The first refuted behaviour: about one straight glide in eight left the hand wrong at rest.
  // The second: a rest answer read while the guest was behind. Here the guest falls behind by a
  // varying number of positions, stalls at random (the page's rest wait then elapses with the
  // plane still on its way), and the image changes late.
  let state = 0x9e3779b9;
  const random = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
  const minJerk = (f) => f * f * f * (10 - 15 * f + 6 * f * f);
  const names = ["hand", "caret", "cross"];
  let settledAtRest = 0, stalls = 0, restsWhileBehind = 0, trials = 0;
  for (let trial = 0; trial < 400; trial += 1) {
    const r = rig();
    const other = names[trial % names.length];
    // Left of x = 166 the guest shows `other`, right of it the arrow (the button's edge).
    const shape = (x) => (x < 166 ? other : "arrow");
    const shown = () => Object.keys(IMAGES).find((key) => IMAGES[key] === r.guest.image);
    r.go("arrow", 600, 300); r.go("arrow", 700 - Math.floor(random() * 300), 420 + Math.floor(random() * 200));
    const from = [200 + Math.floor(random() * 300), 430 + Math.floor(random() * 250)];
    const to = [30 + Math.floor(random() * 125), 480 + Math.floor(random() * 60)];
    const steps = 8 + Math.floor(random() * 30);
    const maxLag = Math.floor(random() * 5);       // positions the guest may be behind
    const imageDelay = Math.floor(random() * 4);   // positions between crossing the edge and the image change
    const curve = random() < 0.5 ? (f) => f : minJerk;
    r.go("arrow", from[0], from[1]);
    let sinceCrossing = null;
    const check = (where) => {
      const now = inferred(r.controller);
      if (now === null) return;
      const truth = r.guest.image.hot;
      assert.ok(Math.abs(now[0] - truth[0]) <= 1 && Math.abs(now[1] - truth[1]) <= 1,
        `trial ${trial} ${where}: ${JSON.stringify(now)} for a true ${JSON.stringify(truth)} (lag ${maxLag}, delay ${imageDelay}, ${steps} steps)`);
    };
    // The guest acts on one queued position; its cursor image follows the pointer late.
    const guestStep = () => {
      if (!r.guest.queue.length) return;
      r.guest.pump(1);
      if (shape(r.guest.pointer.x) !== shown()) {
        sinceCrossing ??= 0;
        if (sinceCrossing >= imageDelay) { r.guest.show(shape(r.guest.pointer.x)); sinceCrossing = null; } else sinceCrossing += 1;
      }
    };
    for (let i = 1; i <= steps; i += 1) {
      const f = curve(i / steps);
      r.send(Math.round(from[0] + (to[0] - from[0]) * f), Math.round(from[1] + (to[1] - from[1]) * f));
      while (r.guest.queue.length > maxLag) guestStep();
      check(`step ${i}`);
      await r.t.pass(16);
      check(`step ${i}, 16 ms on`);
      // Now and then the guest stalls with positions outstanding while the pointer pauses:
      // the page's rest wait elapses, the guest is asked, and it is not idle.
      if (r.guest.queue.length && random() < 0.08) {
        stalls += 1;
        if (r.t.armed.size) restsWhileBehind += 1;
        await r.rest(); check(`step ${i}, stalled`);
        // The pointer nudges on before the guest reports anything (the verifier's sequence).
        if (random() < 0.5) { r.send(r.guest.queue.at(-1)[0] - 2, r.guest.queue.at(-1)[1] + 1); check(`step ${i}, nudged`); await r.t.pass(16); }
      }
    }
    // The pointer stops; the guest catches up and its image settles.
    while (r.guest.queue.length) { guestStep(); check("catching up"); }
    while (shape(r.guest.pointer.x) !== shown()) r.guest.show(shape(r.guest.pointer.x));
    check("caught up");
    trials += 1;
    await r.rest();
    check("at rest");
    if (inferred(r.controller) !== null) settledAtRest += 1;
    // A few more moves inside the same shape never make it wrong either.
    for (let i = 0; i < 3; i += 1) { r.go(other, 40 + Math.floor(random() * 100), 485 + Math.floor(random() * 50)); check("after"); }
    assert.notEqual(inferred(r.controller), null, `trial ${trial}: known after moving about inside the shape`);
    r.controller.dispose();
  }
  assert.ok(settledAtRest >= trials * 0.9, `${settledAtRest} of ${trials} settled at rest`);
  assert.ok(stalls >= 100 && restsWhileBehind >= 20, `${stalls} stalls, ${restsWhileBehind} with a rest wait armed`);
});

test("the rest wait elapses while the guest is behind and the pointer moves on: no answer until it has caught up", async () => {
  // Round 2's refutation, in its own numbers: 24x24 images, an even 10 px run, the guest one
  // position behind, the hand appearing in the middle. A rest answer read then is (0,4).
  const r = rig();
  r.guest.size = 24;
  r.go("arrow", 400, 300); r.go("arrow", 340, 380);
  const xs = [300, 290, 280, 270, 260, 250];
  r.send(xs[0], 500);
  for (let i = 1; i < xs.length; i += 1) { r.send(xs[i], 500); r.guest.pump(1, i >= 4 ? "hand" : "arrow"); }
  assert.equal(r.guest.queue.length, 1, "one position behind");
  assert.equal(inferred(r.controller), null);
  // Quiet on the page for as long as it likes: the guest has not been idle since.
  await r.t.pass(HOTSPOT_REST_MS + HOTSPOT_CAUGHT_UP_TIMEOUT_MS + 500);
  assert.equal(inferred(r.controller), null, "no rest answer off a plane still on its way");
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  // One more position is sent, then the guest reports its two outstanding positions.
  r.send(240, 500);
  r.guest.pump();
  assert.ok(inferred(r.controller) === null || inferred(r.controller).join() === "9,4");
  // 20 more positions along the same line, the guest keeping up, then rest.
  for (let x = 230; x > 30; x -= 10) r.go("hand", x, 500);
  await r.rest();
  assert.deepEqual(inferred(r.controller), [9, 4]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
});

test("a hotspot-less CSS cursor gets its inferred hotspot with one style write and keeps it", () => {
  const r = rig();
  r.go("hand", 100, 100);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0], "nothing can be inferred from one position");
  const before = r.controller.snapshot().styleWrites;
  r.go("hand", 160, 140);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  assert.equal(r.controller.snapshot().styleWrites, before + 1, "one style write for the hotspot");
  assert.deepEqual([r.controller.snapshot().hotX, r.controller.snapshot().hotY], [0, 0], "the device's own report is unchanged");
  for (const [x, y] of [[200, 200], [230, 180], [90, 300]]) r.go("hand", x, y);
  // The guest sets the same image again on most commits: a known image comes back with its
  // hotspot at once, and nothing is written.
  for (let i = 0; i < 5; i += 1) { r.guest.update(); assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]); }
  assert.equal(r.controller.snapshot().styleWrites, before + 1, "later moves and re-sets write no style");
  assert.equal(r.t.armed.size, 0, "no rest wait once the hotspot is known");
  // An image whose hotspot really is (0,0) is an answer like any other.
  r.go("cross", 300, 300); r.go("cross", 420, 350);
  assert.deepEqual(inferred(r.controller), [0, 0]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  assert.equal(r.t.armed.size, 0);
});

test("a device that reports a hotspot is never second-guessed", () => {
  const r = rig();
  r.go("described", 50, 50); r.go("described", 90, 70); r.go("described", 400, 300);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [2, 6]);
  assert.equal(inferred(r.controller), null);
  assert.equal(r.t.armed.size, 0, "nothing to infer, nothing to wait for");
  // Switching between a described image and an undescribed one keeps each to its own rule.
  r.go("hand", 420, 310); r.go("hand", 500, 380);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  r.go("described", 520, 400);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [2, 6]);
  assert.equal(inferred(r.controller), null);
  r.go("hand", 560, 420);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
});

test("the pointer at rest with the guest caught up settles the hotspot after a straight approach", async () => {
  const r = rig();
  r.go("arrow", 600, 400); r.go("arrow", 232, 500);
  // A straight, evenly spaced approach (3 px a step, leftwards onto the button at x < 166) with
  // the guest two positions behind; its cursor becomes the hand when its pointer crosses.
  for (let x = 229; x >= 100; x -= 3) {
    r.send(x, 500);
    while (r.guest.queue.length > 2) r.guest.pump(1, r.guest.queue[0][0] < 166 ? "hand" : "arrow");
  }
  r.guest.pump();
  assert.equal(inferred(r.controller), null, "a straight even approach decides nothing by itself");
  // The guest sets the same image again where the plane already is: that changes nothing
  // about what the plane stands for.
  r.guest.update();
  assert.equal([...r.t.armed].filter((timer) => timer.ms === HOTSPOT_REST_MS).length, 1, "one rest wait is armed");
  const before = r.controller.snapshot().styleWrites;
  await r.t.pass(HOTSPOT_REST_MS - 1);
  assert.equal(inferred(r.controller), null, "not before the pointer has been quiet for the rest time");
  await r.t.pass(1 + 2 * HOTSPOT_POLL_MS);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  assert.equal(r.controller.snapshot().styleWrites, before + 1);
  assert.equal(r.t.armed.size, 0);

  // An image that comes back without a move of its own (its plane position happens to be the
  // one the image before it left) is not at the plane position of its earlier showing.
  const b = rig();
  b.send(300, 300); b.send(305, 300);
  b.guest.queue.length = 0;
  b.guest.show("hand", 300, 300); // plane (291,296): (9,4) and (14,4) both fit the 16 px image
  b.go("arrow", 297, 297);        // the arrow's plane is (296,296)
  b.send(305, 300); b.guest.queue.length = 0;
  b.guest.show("hand", 305, 300); // the hand's plane is (296,296) too: an update, no move
  assert.deepEqual(b.guest.plane, { x: 296, y: 296 });
  await b.rest();
  assert.equal(inferred(b.controller), null, "(305,300) - (291,296) = (14,4) would be read off the earlier showing");

  // Every send and every cursor event replaces the armed rest wait (one at most); a position
  // sent while the guest is being asked means the pointer was not at rest.
  const s = rig();
  const restWaits = () => [...s.t.armed].filter((timer) => timer.ms === HOTSPOT_REST_MS);
  assert.equal(s.t.armed.size, 0, "nothing to wait for before a cursor exists");
  ambiguousCaret(s);
  assert.equal(restWaits().length, 1);
  const first = restWaits()[0];
  s.send(906, 300);
  assert.equal(restWaits().length, 1); assert.notEqual(restWaits()[0], first);
  const second = restWaits()[0];
  s.guest.pump(1);
  assert.equal(inferred(s.controller), null, "an even run: three offsets still fit");
  assert.equal(restWaits().length, 1); assert.notEqual(restWaits()[0], second);
  // A stale callback (one that fires although it was replaced) does nothing.
  const stale = restWaits()[0];
  s.send(900, 300); s.guest.pump(1);
  stale.fn();
  await s.t.flush();
  assert.equal(inferred(s.controller), null);
  // The rest wait elapses and the guest is asked — and a position is sent, and acted on,
  // before it answers: the pointer was not at rest, so this question gets no answer.
  await s.t.pass(HOTSPOT_REST_MS);
  s.send(894, 300); s.guest.pump(1);
  await s.t.pass(2 * HOTSPOT_POLL_MS);
  assert.equal(inferred(s.controller), null);
  await s.rest();
  assert.deepEqual(inferred(s.controller), [4, 8], "the wait that position armed gets the answer");
  // Starting inference over ends a question in flight at once; so does dispose.
  const o = rig();
  ambiguousCaret(o);
  await o.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
  assert.ok(o.t.armed.size > 0, "asking the guest");
  o.controller.resetHotspotInference();
  assert.equal(o.t.armed.size, 0, "nothing of the old question is left waiting");
  const d = rig();
  ambiguousCaret(d);
  await d.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
  assert.ok(d.t.armed.size > 0, "asking the guest");
  d.controller.dispose();
  assert.equal(d.t.armed.size, 0);
  await d.t.pass(5000);
  assert.equal(inferred(d.controller), null);
  assert.throws(() => new CursorController({ target: cursorTarget(), documentTarget: null, hotspotRestMs: 0 }), RangeError);
  assert.throws(() => new CursorController({ target: cursorTarget(), documentTarget: null, guestIdleCount: 5 }), TypeError);
});

test("without an idle counter there is no rest answer; a counter that fails or says nothing gives none either", async () => {
  // No paced clock: nothing tells the page the guest has caught up, so rest decides nothing.
  const u = rig({ idle: false });
  ambiguousCaret(u);
  assert.equal(u.t.armed.size, 0, "no rest wait is even armed");
  await u.t.pass(5000);
  assert.equal(inferred(u.controller), null);
  u.go("caret", 700, 420);
  assert.deepEqual(inferred(u.controller), [4, 8], "moves still settle it");
  // A counter that reports no number, and one that throws.
  for (const [counter, diagnostic] of [[async () => null, null], [async () => "7", null], [async () => { throw new Error("rpc"); }, "cursor-hotspot-idle-error"]]) {
    const diagnostics = [];
    const r = rig({ guestIdleCount: counter, onDiagnostic: (d) => diagnostics.push(d.reason ?? d) });
    ambiguousCaret(r);
    await r.t.pass(5000);
    assert.equal(inferred(r.controller), null);
    assert.equal(diagnostics.includes("cursor-hotspot-idle-error"), diagnostic !== null);
    assert.equal(r.t.armed.size, 0);
  }
  // A guest that takes ten polls to go idle (busy with something else, no cursor events): the
  // same question still gets its answer.
  const slow = rig();
  ambiguousCaret(slow);
  slow.guest.queue.push([912, 300]); // outstanding work that moves nothing (its pointer is there already)
  await slow.t.pass(HOTSPOT_REST_MS + 10 * HOTSPOT_POLL_MS);
  assert.equal(inferred(slow.controller), null);
  slow.guest.queue.length = 0;
  await slow.t.pass(2 * HOTSPOT_POLL_MS);
  assert.deepEqual(inferred(slow.controller), [4, 8]);
  // A guest that is never idle within the timeout: asked for two seconds, then left alone.
  const busy = rig();
  ambiguousCaret(busy);
  busy.guest.queue.push([1, 1]); // something it never gets to
  await busy.t.pass(HOTSPOT_REST_MS + HOTSPOT_CAUGHT_UP_TIMEOUT_MS + 5 * HOTSPOT_POLL_MS);
  assert.equal(inferred(busy.controller), null);
  assert.equal(busy.t.armed.size, 0, "it stops asking");
  // ... and the answer comes with the next rest once it is idle again.
  busy.guest.queue.length = 0;
  busy.send(906, 300); busy.guest.pump(1);
  await busy.rest();
  assert.deepEqual(inferred(busy.controller), [4, 8]);
});

test("relative mode is not evidence; changing mode restarts the evidence and keeps what is settled", async () => {
  const r = rig();
  r.go("hand", 300, 300); r.go("hand", 380, 340);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // Pointer lock: the page sends no absolute positions; the guest's pointer wanders by deltas.
  r.controller.setPointerState({ mode: "relative", pointerLocked: true });
  assert.deepEqual(inferred(r.controller), [9, 4], "a settled hotspot belongs to its image, whatever the mode");
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, false, "the guest has been idle since");
  r.guest.show("caret", 500, 500); r.guest.show("caret", 388, 351); r.guest.show("caret", 309, 311); r.guest.show("caret", 395, 356);
  assert.equal(inferred(r.controller), null, "moves in relative mode are not compared with anything");
  // Even a caller that notes positions in relative mode gets nothing inferred from them.
  for (const [x, y] of [[600, 300], [650, 380], [720, 330]]) { r.controller.notePointer(x, y, 1280, 800); r.guest.show("caret", x, y); }
  assert.equal(inferred(r.controller), null);
  await r.t.pass(1000);
  assert.equal([...r.t.armed].filter((timer) => timer.ms === HOTSPOT_REST_MS).length, 0, "and no rest is waited for");
  // Back in absolute mode the guest is still acting on relative motion: until it has been
  // idle, its moves are not evidence — not even ones a newly sent position would explain.
  r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
  r.guest.queue.push([0, 0]); // outstanding work
  r.controller.notePointer(700, 200, 1280, 800); r.guest.show("caret", 690, 200);
  r.controller.notePointer(640, 260, 1280, 800); r.guest.show("caret", 630, 260);
  assert.equal(inferred(r.controller), null, "(10,8) twice — but the guest has not caught up since the restart");
  r.guest.queue.length = 0;
  await r.rest();
  r.go("caret", 700, 200); r.go("caret", 640, 260);
  assert.deepEqual(inferred(r.controller), [4, 8]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [4, 8]);
  // The hand, settled before all this, comes back with its hotspot at once.
  r.guest.show("hand");
  assert.deepEqual(inferred(r.controller), [9, 4]);
});

test("inference started over while the guest is a position behind: its outstanding moves are not evidence", async () => {
  // Round 2's second sequence: an even run, the guest one position behind, the output size
  // changing on the next sent position. The guest's next move stands for a position sent
  // BEFORE the restart; explained by positions sent after it, two such moves agreed on (0,4).
  for (const restart of ["size", "mode", "explicit"]) {
    const r = rig();
    r.guest.size = 24;
    r.go("arrow", 400, 300); r.go("arrow", 340, 380);
    const xs = [300, 290, 280, 270, 260, 250, 240, 230, 220, 210];
    r.send(xs[0], 500);
    for (let i = 1; i < 5; i += 1) { r.send(xs[i], 500); r.guest.pump(1, i >= 3 ? "hand" : "arrow"); }
    assert.equal(r.guest.queue.length, 1, restart);
    if (restart === "mode") { r.controller.setPointerState({ mode: "relative", pointerLocked: true }); r.controller.setPointerState({ mode: "absolute", pointerLocked: false }); }
    if (restart === "explicit") r.controller.resetHotspotInference();
    const rows = restart === "size" ? 801 : 800;
    for (let i = 5; i < xs.length; i += 1) {
      r.send(xs[i], 500, 1280, rows); r.guest.pump(1, "hand");
      assert.equal(inferred(r.controller), null, `${restart}: after the move for position ${i - 1}`);
      await r.t.pass(16);
    }
    await r.t.pass(5000); // at rest, one position still outstanding: the guest is never idle
    assert.equal(inferred(r.controller), null, `${restart}: nothing while the guest is behind`);
    // Still a position behind long after the question timed out: it is asked again, and its
    // moves stay out of the evidence however long that takes.
    // (These two moves stand for positions sent after the restart and would settle (9,4) — a
    // guest that is behind cannot be told from one whose moves are older than the restart.)
    for (const [x, y] of [[150, 520], [90, 505]]) { r.send(x, y, 1280, rows); r.guest.pump(1, "hand"); }
    assert.equal(inferred(r.controller), null, `${restart}: still behind after the first question gave up`);
    await r.t.pass(3000);
    r.guest.pump();
    await r.rest();       // caught up: its moves count again
    for (const [x, y] of [[160, 530], [70, 500]]) { r.send(x, y, 1280, rows); r.guest.pump(Infinity, "hand"); }
    assert.deepEqual(inferred(r.controller), [9, 4], restart);
  }
  // Without an idle counter the restart waits a fixed time instead.
  const u = rig({ idle: false });
  u.go("hand", 300, 300); u.go("hand", 380, 340);
  assert.deepEqual(inferred(u.controller), [9, 4]);
  u.controller.resetHotspotInference();
  u.go("hand", 420, 300); u.go("hand", 500, 360);
  assert.equal(inferred(u.controller), null, "moves within the wait are not evidence");
  await u.t.pass(HOTSPOT_SETTLE_FALLBACK_MS - 1);
  u.go("hand", 440, 310); u.go("hand", 530, 350);
  assert.equal(inferred(u.controller), null, "one millisecond short of the wait: still not");
  await u.t.pass(1);
  u.go("hand", 520, 380); u.go("hand", 600, 330);
  assert.deepEqual(inferred(u.controller), [9, 4]);
});

test("a change of guest output size restarts the evidence and keeps what is settled", async () => {
  const r = rig();
  r.go("hand", 300, 300); r.go("hand", 380, 340);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  ambiguousCaret(r); // 4, 10 and 16 px all fit its two moves
  // The output becomes 1920x1200: positions computed for 1280x800 no longer compare. What the
  // caret's moves allowed is forgotten; the hand's settled hotspot is not.
  r.send(906, 300, 1920, 1200);
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  r.guest.pump();
  await r.rest();
  assert.equal(inferred(r.controller), null, "nothing to read a rest answer off: the caret starts from nothing");
  for (const [x, y] of [[900, 640], [820, 700]]) { r.send(x, y, 1920, 1200); r.guest.pump(); }
  assert.deepEqual(inferred(r.controller), [4, 8]);
  r.guest.show("hand");
  assert.deepEqual(inferred(r.controller), [9, 4], "kept across the change of size");
  // The same size again changes nothing; positions without a size are taken as they are.
  r.send(910, 650, 1920, 1200);
  r.controller.notePointer(920, 660);
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // The explicit reset forgets settled answers too.
  r.controller.resetHotspotInference();
  assert.equal(inferred(r.controller), null);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
});

test("a contradicted hotspot is taken back from the page, and a guest reset forgets everything", () => {
  const estimator = new CursorHotspotEstimator();
  const r = rig({ hotspotEstimator: estimator });
  r.go("hand", 300, 300);
  // Plant a wrong answer for the hand as bad evidence would have (the image's key is its data URL).
  const key = r.controller.descriptor().dataUrl;
  estimator.notePointer(420, 380); estimator.noteMove(key, 16, 16, 420 - 14, 380 - 2);
  estimator.notePointer(520, 300); estimator.noteMove(key, 16, 16, 520 - 14, 300 - 2);
  r.guest.plane = { x: 506, y: 298 }; r.guest.pointer = { x: 520, y: 300 };
  r.go("hand", 600, 420);
  assert.deepEqual(inferred(r.controller), [14, 2], "the page shows the estimator's answer");
  r.go("hand", 640, 300);
  const before = r.controller.snapshot().styleWrites;
  r.go("hand", 700, 380);
  assert.equal(inferred(r.controller), null, "three moves it cannot explain: taken back");
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  assert.equal(r.controller.snapshot().styleWrites, before + 1);
  r.go("hand", 760, 300);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // A guest reset: no cursor, no history, nothing in flight.
  assert.deepEqual({ ...estimator.hotspot(key) }, { x: 9, y: 4 });
  r.controller.reset();
  assert.equal(inferred(r.controller), null);
  assert.equal(estimator.hotspot(key), null);
  assert.equal(r.t.armed.size, 0);
  // ... and no settling to wait for, even when inference had just been started over: the
  // reset guest's moves are evidence at once.
  r.controller.resetHotspotInference();
  r.controller.reset();
  const fresh = new LegacyKmsGuest(r.controller);
  r.controller.notePointer(100, 100, 1280, 800); fresh.show("hand", 100, 100);
  assert.equal(inferred(r.controller), null);
  r.controller.notePointer(180, 150, 1280, 800); fresh.show("hand", 180, 150);
  assert.deepEqual(inferred(r.controller), [9, 4], "the reset guest's moves are evidence at once");
});

test("estimator failures become diagnostics, never a broken cursor", async () => {
  const diagnostics = [];
  const broken = { notePointer() { throw new Error("np"); }, noteInstall() { throw new Error("ni"); }, hotspot: () => null,
    noteMove() { throw new Error("nm"); }, noteRest() { throw new Error("nr"); }, reset() { throw new Error("rs"); },
    get sends() { return 0; } };
  const r = rig({ hotspotEstimator: broken, onDiagnostic: (d) => diagnostics.push(d.reason ?? d) });
  r.go("hand", 100, 100); r.go("hand", 160, 140);
  await r.rest();
  assert.equal(inferred(r.controller), null);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0], "the cursor is still the guest's image");
  r.controller.resetHotspotInference();
  r.controller.reset();
  for (const reason of ["cursor-hotspot-pointer-error", "cursor-hotspot-error"]) assert.ok(diagnostics.includes(reason), reason);
  assert.ok(diagnostics.filter((reason) => reason === "cursor-hotspot-error").length >= 4, "install, move, rest and reset each reported");
});
