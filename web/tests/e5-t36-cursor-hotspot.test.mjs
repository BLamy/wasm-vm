// E5-T36 — hotspot inference for a cursor image the device did not describe.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CursorController, HOTSPOT_CAUGHT_UP_TIMEOUT_MS, HOTSPOT_POLL_MS, HOTSPOT_REST_MS } from "../src/sink/cursor-controller.js";
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

test("a report from where the plane stands is right with the position in the history and wrong without it", () => {
  // The device reports the plane's place on every commit. The pointer rests at (300,500) under
  // a hand, then an even run of 6 px steps starts and the guest, one position behind, commits
  // once before it acts on the first of them.
  const hot = { x: 9, y: 4 };
  const run = (startOver) => {
    const e = new CursorHotspotEstimator();
    e.notePointer(400, 300); e.notePointer(300, 500);
    e.noteMove("hand", 64, 64, 300 - hot.x, 500 - hot.y);
    startOver(e);
    const xs = [306, 312, 318, 324, 330];
    const answers = [];
    e.notePointer(xs[0], 500);
    answers.push(e.noteMove("hand", 64, 64, 300 - hot.x, 500 - hot.y)); // where it stood
    for (let i = 1; i < xs.length; i += 1) { e.notePointer(xs[i], 500); answers.push(e.noteMove("hand", 64, 64, xs[i - 1] - hot.x, 500 - hot.y)); }
    answers.push(e.noteMove("hand", 64, 64, xs.at(-1) - hot.x, 500 - hot.y)); // caught up
    return answers.map((answer) => (answer ? [answer.x, answer.y] : null));
  };
  // `forget` keeps the positions: (300,500) still explains the report, the truth is a
  // candidate of every move, and nothing is answered until it is the only one.
  assert.deepEqual(run((e) => e.forget()), [null, null, null, null, null, [9, 4]]);
  // `restart` and `reset` forget them: the same report is then explained only by the position
  // sent after it, and every later move agrees on the truth plus one step. This is why a
  // caller must not give `noteMove` anything until the guest has acted on a position noted
  // since (the controller's settling).
  assert.deepEqual(run((e) => e.restart()), [null, [15, 4], [15, 4], [15, 4], [15, 4], [15, 4]]);
  assert.deepEqual(run((e) => e.reset()), [null, [15, 4], [15, 4], [15, 4], [15, 4], [15, 4]]);
  // `forget` forgets settled images too, and only images.
  const f = new CursorHotspotEstimator();
  for (const [x, y] of [[100, 100], [300, 180]]) { f.notePointer(x, y); f.noteMove("arrow", 64, 64, x - 1, y - 1); }
  assert.deepEqual({ ...f.hotspot("arrow") }, { x: 1, y: 1 });
  f.forget();
  assert.equal(f.hotspot("arrow"), null);
  assert.equal(f.noteRest("arrow", 64, 64), null, "no move of it is remembered");
  assert.equal(f._sent.length, 2);
  assert.equal(f.noteMove("arrow", 64, 64, 299, 179), null, "one place again");
  assert.deepEqual({ ...f.noteRest("arrow", 64, 64) }, { x: 1, y: 1 }, "the position the plane stands for was not forgotten");
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
// Every commit of the guest's compositor is "set image" at the plane's PREVIOUS position — the
// one computed with the previous image's hotspot — followed by a move to pointer minus the
// hotspot of the image now shown: also when the image is the one already shown, and also when
// the plane stays where it stood (the compositor commits for other reasons than the pointer).
// Recorded on the Replay desktop: 559 of 560 updates carried the plane position of the event
// before them, and 767 of 2847 moves reported the plane where it already was. `LegacyKmsGuest`
// reports exactly that, and acts on the positions the page sends only when the test lets it
// (`pump`), so it can be behind.
//
// And it does not act on every position. Linux's input core passes on only the axes whose value
// changed (`input_handle_abs_event`), so an absolute position equal to the tablet's last one
// reaches nobody: the pointer stays where it is and nothing is committed. Relative motion comes
// from another device and leaves the tablet's values alone. Recorded on the Replay desktop by
// the round-4 verifier: after relative motion, the mouse back on the pixel it had left moved
// the kernel's cursor plane by (0,0) in 10 of 10 trials.

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
    this.queue = [];   // positions sent to the guest that it has not handled yet
    this.tablet = { x: 0, y: 0 }; // the absolute position its kernel last passed on
    this.busy = false; // other work: it takes no idle wait while this is set
    this.idleWaits = 0;
  }
  _state(image, x, y) {
    const [hotX, hotY] = image.reports ? image.hot : [0, 0];
    return { resourceId: image.id, hotX, hotY, pos: { scanoutId: 0, x, y } };
  }
  name() {
    return Object.keys(IMAGES).find((key) => IMAGES[key] === this.image) ?? null;
  }
  // "Set image", alone: where the plane is. (Half a commit; `show` is a whole one.)
  update(image = this.image) {
    assert.ok(this.controller.handle({ type: "cursor-update", state: this._state(image, this.plane.x, this.plane.y),
      format: 1, resourceWidth: this.size, resourceHeight: this.size, pixels: new Uint32Array(this.size * this.size).fill(image.fill) }));
  }
  // The guest's pointer is at (x, y) and its cursor is `name`: one commit — set image at the
  // plane's previous position, then move, whether or not anything changed.
  show(name, x = this.pointer.x, y = this.pointer.y) {
    const image = IMAGES[name];
    this.pointer = { x, y };
    this.update(image); this.image = image;
    this.plane = { x: x - image.hot[0], y: y - image.hot[1] };
    assert.ok(this.controller.handle({ type: "cursor-move", state: this._state(image, this.plane.x, this.plane.y) }));
  }
  // A commit for a reason of the compositor's own: the same image, the plane where it stands.
  commit() {
    this.show(this.name());
  }
  // The cursor is hidden (a client hides it, the compositor goes away): a move with resource 0.
  hide() {
    assert.ok(this.controller.handle({ type: "cursor-move", state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: this.plane.x, y: this.plane.y } } }));
    this.image = null;
  }
  // Handle up to `n` queued positions with cursor `name` (default: the one shown; a guest
  // that shows no cursor yet has nothing to report). One that repeats the tablet's last
  // position is handled and acted on by nobody.
  pump(n = Infinity, name = null) {
    for (let i = 0; i < n && this.queue.length; i += 1) {
      const [x, y] = this.queue.shift();
      if (x === this.tablet.x && y === this.tablet.y) continue;
      this.tablet = { x, y };
      const shown = name ?? this.name();
      if (shown === null) this.pointer = { x, y }; else this.show(shown, x, y);
    }
  }
  // Relative motion, from another device: the pointer moves, the tablet's values stay.
  relative(dx, dy) {
    const x = this.pointer.x + dx; const y = this.pointer.y + dy;
    if (this.image === null) this.pointer = { x, y }; else this.show(this.name(), x, y);
  }
  // The paced clock's counter: an idle wait is taken only with nothing left to handle.
  async idleCount() {
    if (this.queue.length === 0 && !this.busy) this.idleWaits += 1;
    return this.idleWaits;
  }
}
// Where a rig's pointer starts: further than an image is wide from every position a test uses.
const FAR = [1270, 10];
async function rig({ idle = true, settle = idle, size = 16, ...options } = {}) {
  const target = cursorTarget(); const t = timers();
  let guestOs = null;
  const controller = new CursorController({ target, documentTarget: null, setTimer: t.setTimer, clearTimer: t.clearTimer,
    ...(idle ? { guestIdleCount: () => guestOs.idleCount() } : {}), ...options });
  guestOs = new LegacyKmsGuest(controller, { size });
  const r = { target, t, controller,
    get guest() { return guestOs; },
    // The page sends a position; the guest has it queued.
    send(x, y, w = 1280, h = 800) { controller.notePointer(x, y, w, h); guestOs.queue.push([x, y]); },
    // Send a position and let the guest act on everything queued at once.
    go(name, x, y) { r.send(x, y); guestOs.pump(Infinity, name); },
    // The pointer rests long enough for the rest wait and the question to the guest.
    rest: () => t.pass(HOTSPOT_REST_MS + 3 * HOTSPOT_POLL_MS),
    // The machine is reset: the page's controller with it, and a new guest takes its place.
    reboot() { controller.reset(); guestOs = new LegacyKmsGuest(controller, { size: guestOs.size }); return guestOs; },
    // Two different positions (the guest acts on the second whatever its tablet held), and
    // the guest idle after them: from here on its pointer stands on positions the page
    // remembers, and its cursor moves are evidence.
    async settle(x = FAR[0], y = FAR[1]) {
      r.send(x - 8, y); r.send(x, y); guestOs.pump();
      await t.pass(2 * HOTSPOT_POLL_MS);
      assert.equal(controller.snapshot().hotspotSettling, false);
    },
  };
  // A session shows a cursor from its start. (One that appears later, where none was shown,
  // starts the page's settling over: a rig that settles shows its arrow first.)
  if (settle) { guestOs.show("arrow", FAR[0] - 16, FAR[1]); await r.settle(); }
  return r;
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

test("the update that installs an image is not evidence for it: its position belongs to the image before", async () => {
  const r = await rig();
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
    // This page had sent nothing before the log starts: the moves up to the guest's first idle
    // wait after the second position (one poll after 40840.5; the first may have repeated what
    // the tablet held) are not evidence.
    assert.equal(controller.snapshot().hotspotSettling, at < 40840.5 + HOTSPOT_POLL_MS, `settling at ${at}`);
  }
  assert.equal(shown, "hand");
  assert.equal(inferred(controller), null, "one move of the hand: 9, 10, 12 and 15 px all explain it");
  await t.pass(1000); record("rest");
  assert.deepEqual(inferred(controller), [9, 4], "at rest");
  assert.deepEqual(hotspotOf(target.style.cursor), [9, 4]);
  // (The arrow is settled by the glide's own moves, to the pixel's tolerance: the page was
  // still settling when the pointer rested before it. The hand is settled at rest, exactly.)
  assert.deepEqual(answers.map(([image]) => image), ["arrow", "hand"]);
  assert.deepEqual(answers[1][1], [9, 4]);
});

// A small deterministic generator for the random tests.
function xorshift(seed) {
  let state = seed;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
}

test("random approaches across an image change, in the device's order: never a wrong hotspot, right at rest", async () => {
  // The first refuted behaviour: about one straight glide in eight left the hand wrong at rest.
  // The second: a rest answer read while the guest was behind. Here the guest falls behind by a
  // varying number of positions, stalls at random (the page's rest wait then elapses with the
  // plane still on its way), commits now and then for reasons of its own (the plane reported
  // where it stands), and the image changes late.
  const random = xorshift(0x9e3779b9);
  const minJerk = (f) => f * f * f * (10 - 15 * f + 6 * f * f);
  const names = ["hand", "caret", "cross"];
  let settledAtRest = 0, stalls = 0, restsWhileBehind = 0, trials = 0, idleCommits = 0;
  for (let trial = 0; trial < 400; trial += 1) {
    const r = await rig();
    const other = names[trial % names.length];
    // Left of x = 166 the guest shows `other`, right of it the arrow (the button's edge).
    const shape = (x) => (x < 166 ? other : "arrow");
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
      if (random() < 0.15) { idleCommits += 1; r.guest.commit(); check("a commit of the guest's own"); }
      r.guest.pump(1);
      if (shape(r.guest.pointer.x) !== r.guest.name()) {
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
    while (shape(r.guest.pointer.x) !== r.guest.name()) r.guest.show(shape(r.guest.pointer.x));
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
  assert.ok(stalls >= 100 && restsWhileBehind >= 20 && idleCommits >= 500, `${stalls} stalls, ${restsWhileBehind} with a rest wait armed, ${idleCommits} commits of the guest's own`);
});

test("a run from where the pointer rests after each way of starting over: the plane reported where it stands is no evidence", async () => {
  // Round 3's refutation. After the page forgot the position the guest's pointer stands on, the
  // report of the plane where it stands is explained only by a position sent later; with an
  // even run of 6 px steps and the guest one position behind, every move that followed agreed
  // on the truth plus one step — the hand drawn with (15,4), and kept at rest.
  for (const kind of ["page start", "guest reset", "mode", "mode, with relative motion", "mode, then the hook", "size", "size, at rest", "hook"]) {
    for (const flip of [false, true]) {
      const label = `${kind}${flip ? ", the image flipped where the plane stands" : ""}`;
      const r = await rig({ size: 64, settle: kind !== "page start" });
      const check = (where, expectNone = kind !== "hook") => {
        const now = inferred(r.controller);
        if (expectNone) assert.equal(now, null, `${label}: ${where}`);
        else if (now !== null) assert.deepEqual(now, r.guest.image.hot, `${label}: ${where}`);
      };
      if (kind === "page start") {
        // The page has sent nothing; the guest's pointer rests where the session left it.
        r.guest.show("hand", 300, 500);
      } else {
        // The hand, met and not settled: one move, where the pointer came to rest.
        r.go("arrow", 400, 300); r.go("arrow", 300, 500);
        r.guest.show("hand");
        assert.equal(inferred(r.controller), null, label);
      }
      if (kind === "guest reset") r.reboot().show("hand", 300, 500);
      if (kind.startsWith("mode")) {
        r.controller.setPointerState({ mode: "relative", pointerLocked: true });
        // (The guest's pointer wanders off and comes back, by a device the page's positions
        // are not for: where the plane stands is the same, what the page knows is not.)
        if (kind === "mode, with relative motion") { r.guest.relative(-7, -5); r.guest.relative(7, 5); }
        r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
      }
      // The hook forgets hotspots; it does not make the page know where the guest's pointer is.
      if (kind === "hook" || kind === "mode, then the hook") r.controller.resetHotspotInference();
      // The size changes on ONE position and the pointer rests there, the guest idle: that
      // position does not compare with the one before it, so the page is still settling.
      if (kind === "size, at rest") { r.send(300, 500, 1280, 801); r.guest.pump(); await r.rest(); }
      assert.equal(r.controller.snapshot().hotspotSettling, kind !== "hook" && kind !== "size", label);
      const rows = kind.startsWith("size") ? 801 : 800;
      // The run. The guest commits once before it acts on the first position — or its client
      // changes the cursor and changes it back — and then stays one position behind.
      const xs = [306, 312, 318, 324, 330, 336, 342, 348];
      r.send(xs[0], 500, 1280, rows);
      assert.equal(r.controller.snapshot().hotspotSettling, kind !== "hook", label);
      if (flip) { r.guest.show("arrow"); r.guest.show("hand"); } else r.guest.commit();
      check("the plane reported where it stands");
      for (let i = 1; i < xs.length; i += 1) {
        r.send(xs[i], 500, 1280, rows); r.guest.pump(1);
        check(`the move for position ${i - 1}`);
        await r.t.pass(16);
        check(`the move for position ${i - 1}, 16 ms on`);
      }
      await r.t.pass(3000); // the pointer rests; the guest is still a position behind
      check("at rest with the guest a position behind");
      r.guest.pump();
      check("caught up");
      // With the history kept (the hook) the moves have decided by now: the last one is
      // explained by the last position alone.
      if (kind === "hook") assert.deepEqual(inferred(r.controller), [9, 4], label);
      await r.rest();
      check("at rest");
      assert.equal(r.controller.snapshot().hotspotSettling, false, `${label}: the guest has been idle after a position sent since`);
      // Whatever was known: one more position and the pointer at rest settle it.
      r.send(420, 520, 1280, rows); r.guest.pump();
      check("one move since", false);
      await r.rest();
      assert.deepEqual(inferred(r.controller), [9, 4], label);
      assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4], label);
    }
  }
});

test("random runs from the rest position after random ways of starting over: never a wrong hotspot, right in the end", async () => {
  const random = xorshift(0x51f15eed);
  const int = (n) => Math.floor(random() * n);
  const kinds = ["hook", "mode", "size", "guest reset", "none"];
  const names = ["hand", "caret", "cross"];
  let learnedByMoves = 0, reportsInPlace = 0, relativeMotions = 0, repeats = 0;
  for (let trial = 0; trial < 500; trial += 1) {
    const kind = kinds[trial % kinds.length];
    const name = names[int(names.length)];
    const r = await rig({ size: [16, 24, 64][int(3)] });
    const label = () => `trial ${trial} (${kind}, ${name}, ${r.guest.size} px)`;
    const check = (where) => {
      const now = inferred(r.controller);
      if (now === null) return false;
      const truth = r.guest.image.hot;
      assert.ok(Math.abs(now[0] - truth[0]) <= 1 && Math.abs(now[1] - truth[1]) <= 1, `${label()} ${where}: ${JSON.stringify(now)} for a true ${JSON.stringify(truth)}`);
      return true;
    };
    const from = [200 + int(600), 200 + int(400)];
    r.go("arrow", 100 + int(60), 100 + int(60)); r.go("arrow", from[0], from[1]);
    // The shape under the pointer: never met, met once (one move), or settled by moving about.
    const met = int(3);
    if (met >= 1) r.guest.show(name);
    if (met === 2) { r.go(name, from[0] + 70, from[1] + 5); r.go(name, from[0] - 3, from[1] + 90); r.go(name, from[0], from[1]); assert.ok(check("settled before")); }
    // Does the page keep an answer for the shape across what comes next?
    const kept = met === 2 && (kind === "none" || kind === "mode" || kind === "size");
    if (int(2)) await r.rest(); // the pointer may have rested before starting over, or not
    check("before starting over");
    if (kind === "hook") r.controller.resetHotspotInference();
    if (kind === "mode") {
      r.controller.setPointerState({ mode: "relative", pointerLocked: true });
      // Relative motion in two trials of three: the guest's pointer is left near the mouse.
      if (int(3)) { relativeMotions += 1; r.guest.relative(int(25) - 12, int(25) - 12); check("relative motion"); }
      r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
    }
    if (kind === "guest reset") { const next = r.reboot(); next.show(met >= 1 ? name : "arrow", from[0], from[1]); }
    // One run in three begins with the position the mouse was left on: the guest's kernel
    // passes that on to nobody.
    const first = int(3) ? 1 : 0;
    if (first === 0) repeats += 1;
    const rows = kind === "size" ? 801 : 800;
    // An even run from the rest position: small steps, the guest up to two positions behind,
    // commits of its own and cursor flips in between.
    const step = [(1 + int(8)) * (int(2) ? 1 : -1), int(9) - 4];
    const steps = 2 + int(9);
    const lag = int(3);
    for (let i = first; i <= steps; i += 1) {
      r.send(from[0] + i * step[0], from[1] + i * step[1], 1280, rows);
      if (r.guest.image && random() < 0.4) { reportsInPlace += 1; r.guest.commit(); check(`step ${i}, a commit of the guest's own`); }
      if (r.guest.image && random() < 0.15) { const shown = r.guest.name(); r.guest.show(shown === "arrow" ? name : "arrow"); check(`step ${i}, flipped`); r.guest.show(shown); check(`step ${i}, flipped back`); }
      while (r.guest.queue.length > lag) { r.guest.pump(1); check(`step ${i}`); }
      if (int(2)) { await r.t.pass(16); check(`step ${i}, 16 ms on`); }
    }
    if (int(2)) { await r.t.pass(300); check("paused with the guest behind"); }
    while (r.guest.queue.length) { r.guest.pump(1); check("catching up"); }
    if (!kept && check("caught up")) learnedByMoves += 1;
    await r.rest();
    check("at rest");
    assert.equal(r.controller.snapshot().hotspotSettling, false, label());
    // One more position, far from all the others, and the pointer at rest: known and right.
    r.send(1150 - int(40), 760 - int(20), 1280, rows); r.guest.pump(Infinity, name);
    check("one move since");
    await r.rest();
    assert.ok(check("in the end"), `${label()}: known in the end`);
    r.controller.dispose();
  }
  assert.ok(learnedByMoves >= 150 && reportsInPlace >= 1000 && relativeMotions >= 50 && repeats >= 120,
    `${learnedByMoves} learned by moves alone, ${reportsInPlace} reports in place, ${relativeMotions} relative motions, ${repeats} runs beginning with a repeated position`);
});

test("the page starts not knowing where the guest's pointer stands: no evidence until the guest was idle after a position it acts on", async () => {
  const r = await rig({ settle: false });
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  assert.equal(r.t.armed.size, 0, "nothing to ask the guest about before a position was sent");
  // The guest's cursor is up and moves about (its own start-up, a session restored from a
  // snapshot): compared with nothing.
  r.guest.show("hand", 640, 400); r.guest.show("hand", 500, 300); r.guest.commit();
  await r.t.pass(5000);
  assert.equal(r.t.armed.size, 0, "and no rest wait either");
  assert.equal(inferred(r.controller), null);
  // The first position. The page cannot know that the guest acts on it — its tablet may hold
  // the very same values — so it does not ask.
  r.send(506, 300); r.guest.pump();
  await r.t.pass(1000);
  assert.equal(r.controller.snapshot().hotspotSettling, true, "idle, after a position the guest may not have acted on");
  assert.equal(r.t.armed.size, 0, "not asked");
  // The second, a different one: the guest acts on that whatever came before. It has other
  // work, so it is not idle.
  r.guest.busy = true;
  r.send(700, 420); r.guest.pump();
  assert.equal(inferred(r.controller), null, "(9,4) twice, from a guest the page knows nothing about yet");
  await r.t.pass(HOTSPOT_CAUGHT_UP_TIMEOUT_MS + 500);
  assert.equal(r.controller.snapshot().hotspotSettling, true, "asked again after the first question timed out");
  assert.equal([...r.t.armed].filter((timer) => timer.ms === HOTSPOT_POLL_MS).length, 1);
  // Idle at last: from here on its moves count.
  r.guest.busy = false;
  await r.t.pass(2 * HOTSPOT_POLL_MS);
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  assert.equal(r.t.armed.size, 0, "nothing is known about the hand until it is reported again");
  r.guest.commit();
  assert.equal(inferred(r.controller), null, "one place");
  await r.rest();
  assert.deepEqual(inferred(r.controller), [9, 4], "at rest: the plane stands for the last position sent");
  // Further positions while settling start no second loop of questions.
  const s = await rig({ settle: false });
  s.guest.busy = true;
  for (const x of [100, 110, 120, 130]) s.controller.notePointer(x, 100, 1280, 800);
  await s.t.flush();
  assert.equal(s.t.armed.size, 1, "one question in flight");
  // Starting over while the guest is being asked drops that question. The position that
  // carried the change of size is not one to ask about (its pixel does not compare with the
  // one before); the next is.
  s.controller.notePointer(140, 100, 1280, 801);
  await s.t.pass(10 * HOTSPOT_POLL_MS);
  assert.equal(s.t.armed.size, 0, "the old question is over and no new one is asked yet");
  s.controller.notePointer(140, 100, 1280, 801);
  await s.t.flush();
  assert.equal(s.t.armed.size, 0, "the same position again: nobody in the guest sees it");
  s.controller.notePointer(150, 100, 1280, 801);
  await s.t.pass(10 * HOTSPOT_POLL_MS);
  assert.equal(s.t.armed.size, 1, "one question in flight: the new one");
  s.guest.busy = false;
  await s.t.pass(2 * HOTSPOT_POLL_MS);
  assert.equal(s.controller.snapshot().hotspotSettling, false);
  assert.equal(s.t.armed.size, 0);
  // Starting over while a reading of the count is on its way back from the guest: the reading
  // belongs to the question before. It is not polled for again, and "idle since" says nothing
  // about a position sent after it was asked for.
  const pending = [];
  const d = await rig({ settle: false, guestIdleCount: () => new Promise((resolve) => pending.push(resolve)) });
  const reading = async (count) => { assert.equal(pending.length, 1); pending.shift()(count); await d.t.flush(); };
  const startOver = () => { d.controller.setPointerState({ mode: "relative", pointerLocked: true }); d.controller.setPointerState({ mode: "absolute", pointerLocked: false }); };
  d.controller.notePointer(90, 100, 1280, 800);
  await d.t.flush();
  assert.equal(pending.length, 0, "the first position of a page asks nothing");
  d.controller.notePointer(100, 100, 1280, 800);
  await reading(5);
  await d.t.pass(HOTSPOT_POLL_MS);                    // one poll on: the second reading is asked for
  startOver();
  await reading(5);                                   // "not idle yet", for the epoch before
  assert.equal(d.t.armed.size, 0, "no further poll for a question that is over");
  d.controller.notePointer(200, 100, 1280, 800);
  await reading(5);
  await d.t.pass(HOTSPOT_POLL_MS);
  startOver();
  await reading(6);                                   // "idle since" — since a position of the epoch before
  assert.equal(d.controller.snapshot().hotspotSettling, true);
  assert.equal(d.t.armed.size, 0);
  d.controller.notePointer(300, 100, 1280, 800);      // a position since, and not the one before it: asked anew
  await reading(6); await d.t.pass(HOTSPOT_POLL_MS);
  await reading(4);                                   // a count that went DOWN (a counter reset) is no idle wait
  assert.equal(d.controller.snapshot().hotspotSettling, true);
  await d.t.pass(HOTSPOT_POLL_MS); await reading(6);  // nor one that is back where it was
  assert.equal(d.controller.snapshot().hotspotSettling, true);
  await d.t.pass(HOTSPOT_POLL_MS); await reading(7);
  assert.equal(d.controller.snapshot().hotspotSettling, false);
});

test("a position that repeats the tablet's last one moves nothing in the guest: it does not end settling", async () => {
  // Round 4's open finding. The pointer rests on (400,640); pointer lock, relative motion of
  // (-7,-5), back in absolute mode with the mouse on the pixel it left. The guest's kernel
  // passes that position on to nobody, its pointer stays at (393,635) — and the page, having
  // "sent a position since", took the next idle wait for the guest standing on (400,640): the
  // arrow was drawn with (8,6) for its (1,1), at rest.
  for (const forgotten of ["by the hook", "a shape first met during relative motion"]) {
    const r = await rig({ size: 64 });
    const shape = forgotten === "by the hook" ? "arrow" : "caret";
    const truth = IMAGES[shape].hot;
    const check = (where) => { const now = inferred(r.controller); if (now !== null) assert.deepEqual(now, truth, `${forgotten}: ${where}`); return now; };
    r.go("arrow", 300, 600); r.go("arrow", 400, 640);
    assert.deepEqual(inferred(r.controller), [1, 1]);
    if (shape === "arrow") r.controller.resetHotspotInference();
    r.controller.setPointerState({ mode: "relative", pointerLocked: true });
    r.guest.relative(-7, -5);
    if (shape === "caret") r.guest.show("caret");
    r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
    r.send(400, 640); r.guest.pump();
    assert.deepEqual(r.guest.pointer, { x: 393, y: 635 }, "the guest did not act on the position");
    assert.equal(r.guest.queue.length, 0);
    await r.t.pass(5000);
    assert.equal(r.controller.snapshot().hotspotSettling, true, `${forgotten}: idle, but after a position the guest does not act on`);
    assert.equal(r.t.armed.size, 0, "and it is not asked about it");
    // The guest commits for reasons of its own, the plane where it stands; the pointer rests.
    for (let i = 0; i < 3; i += 1) { r.guest.commit(); await r.t.pass(100); }
    await r.t.pass(5000);
    assert.equal(inferred(r.controller), null, `${forgotten}: (400,640) minus the plane is not this shape's hotspot`);
    // The same position once more changes nothing; the next different one the guest acts on.
    r.send(400, 640); r.guest.pump();
    await r.t.pass(1000);
    assert.equal(r.controller.snapshot().hotspotSettling, true);
    // (One axis is enough: straight below the last position is another position.)
    r.send(400, 646); r.guest.pump();
    assert.deepEqual(r.guest.pointer, { x: 400, y: 646 });
    check("the move for the position it acted on");
    await r.rest();
    assert.equal(r.controller.snapshot().hotspotSettling, false);
    r.send(412, 644); r.guest.pump();
    check("one move since");
    await r.rest();
    assert.deepEqual(inferred(r.controller), truth, forgotten);
  }
  // In absolute mode a repeated position is harmless: the pointer stands on it already, and
  // "the last position sent" is that position.
  const a = await rig({ size: 64 });
  a.go("arrow", 300, 600); a.go("arrow", 400, 640);
  a.controller.resetHotspotInference();
  a.send(400, 640); a.guest.pump(); a.guest.commit();
  assert.equal(inferred(a.controller), null, "one place");
  await a.rest();
  assert.deepEqual(inferred(a.controller), [1, 1]);
  // A guest whose tablet holds the page's first position (here: its initial 0,0).
  const z = await rig({ settle: false, size: 64 });
  z.guest.show("arrow", 9, 7);                        // where the session left its pointer
  z.send(0, 0); z.guest.pump();
  assert.deepEqual(z.guest.pointer, { x: 9, y: 7 });
  await z.t.pass(3000);
  z.send(6, 4); z.guest.commit();                     // the plane where it stands, before it acts on (6,4)
  assert.equal(z.controller.snapshot().hotspotSettling, true);
  z.send(12, 8); z.guest.pump(1);
  z.send(18, 12); z.guest.pump(1);
  assert.equal(inferred(z.controller), null, "nothing from a guest that has not been idle since");
  z.guest.pump();
  await z.rest();
  assert.equal(z.controller.snapshot().hotspotSettling, false);
  z.send(60, 40); z.guest.pump();
  await z.rest();
  assert.deepEqual(inferred(z.controller), [1, 1]);
});

test("a cursor that appears where none was shown starts over: the page does not know where that pointer stands", async () => {
  // A cold boot with the mouse over the canvas. Positions are sent before any compositor reads
  // the tablet, the guest idles: by every rule so far the page is settled.
  const r = await rig({ settle: false, size: 64 });
  r.send(300, 300); r.send(120, 110); r.guest.pump();
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, false, "idle after a position that differs from the one before it");
  // The compositor starts. Its pointer is where IT puts it — (100,100) on the Replay desktop,
  // the plane at (99,99) before any position was sent — whatever the tablet holds. The mouse
  // is parked twenty pixels away: inside the image, seen from that plane.
  r.guest.pointer = { x: 100, y: 100 };
  r.guest.show("arrow");
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  for (let i = 0; i < 3; i += 1) { r.guest.commit(); await r.t.pass(100); }
  await r.t.pass(5000);
  assert.equal(inferred(r.controller), null, "(120,110) minus the plane (99,99) is not the arrow's hotspot");
  assert.equal(r.t.armed.size, 0);
  // The mouse still on its pixel changes nothing (the tablet holds it); its first move does.
  r.send(120, 110); r.guest.pump();
  assert.deepEqual(r.guest.pointer, { x: 100, y: 100 });
  await r.t.pass(1000);
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  r.send(126, 112); r.guest.pump();
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  r.guest.commit();
  await r.rest();
  assert.deepEqual(inferred(r.controller), [1, 1]);
  // A client hides the cursor (a terminal does while one types) and shows it again: what the
  // page has settled stays with its image; what it had not, and what it knew of the pointer,
  // starts over.
  const h = await rig({ size: 64 });
  h.go("arrow", 400, 300); h.go("arrow", 520, 360);
  h.go("hand", 600, 420);
  assert.equal(inferred(h.controller), null, "one move of the hand");
  h.guest.hide();
  assert.equal(h.controller.snapshot().hotspotSettling, false, "hiding changes nothing by itself");
  h.send(700, 500); h.guest.pump();                   // acted on; there is nothing to report
  h.guest.show("hand");
  assert.equal(h.controller.snapshot().hotspotSettling, true, "shown again");
  assert.equal(inferred(h.controller), null);
  h.guest.show("arrow");
  assert.deepEqual(inferred(h.controller), [1, 1], "a settled hotspot belongs to its image");
  h.guest.show("hand");
  h.send(760, 540); h.guest.pump();
  assert.equal(inferred(h.controller), null, "not evidence yet");
  await h.rest();
  assert.equal(h.controller.snapshot().hotspotSettling, false);
  h.send(820, 500); h.guest.pump();
  await h.rest();
  assert.deepEqual(inferred(h.controller), [9, 4]);
  // An image that replaces another is no appearance: nothing starts over.
  const k = await rig({ size: 64 });
  k.go("arrow", 400, 300); k.go("hand", 520, 360); k.go("caret", 600, 420);
  assert.equal(k.controller.snapshot().hotspotSettling, false);
});

test("the rest wait elapses while the guest is behind and the pointer moves on: no answer until it has caught up", async () => {
  // Round 2's refutation, in its own numbers: 24x24 images, an even 10 px run, the guest one
  // position behind, the hand appearing in the middle. A rest answer read then is (0,4).
  const r = await rig({ size: 24 });
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

test("a hotspot-less CSS cursor gets its inferred hotspot with one style write and keeps it", async () => {
  const r = await rig();
  r.go("hand", 100, 100);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0], "nothing can be inferred from one position");
  // The plane reported from the same place again and again (every commit does) is still one
  // piece of evidence, although only (9,4) explains it.
  for (let i = 0; i < 3; i += 1) r.guest.commit();
  assert.equal(inferred(r.controller), null, "one place, however often reported");
  const before = r.controller.snapshot().styleWrites;
  r.go("hand", 160, 140);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  assert.equal(r.controller.snapshot().styleWrites, before + 1, "one style write for the hotspot");
  assert.deepEqual([r.controller.snapshot().hotX, r.controller.snapshot().hotY], [0, 0], "the device's own report is unchanged");
  for (const [x, y] of [[200, 200], [230, 180], [90, 300]]) r.go("hand", x, y);
  // The guest sets the same image again on every commit: a known image comes back with its
  // hotspot at once, and nothing is written.
  for (let i = 0; i < 5; i += 1) { r.guest.commit(); assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]); }
  assert.equal(r.controller.snapshot().styleWrites, before + 1, "later moves and re-sets write no style");
  assert.equal(r.t.armed.size, 0, "no rest wait once the hotspot is known");
  // An image whose hotspot really is (0,0) is an answer like any other.
  r.go("cross", 300, 300); r.go("cross", 420, 350);
  assert.deepEqual(inferred(r.controller), [0, 0]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  assert.equal(r.t.armed.size, 0);
});

test("a device that reports a hotspot is never second-guessed", async () => {
  const r = await rig();
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
  const r = await rig();
  r.go("arrow", 600, 400); r.go("arrow", 232, 500);
  // A straight, evenly spaced approach (3 px a step, leftwards onto the button at x < 166) with
  // the guest two positions behind; its cursor becomes the hand when its pointer crosses.
  for (let x = 229; x >= 100; x -= 3) {
    r.send(x, 500);
    while (r.guest.queue.length > 2) r.guest.pump(1, r.guest.queue[0][0] < 166 ? "hand" : "arrow");
  }
  r.guest.pump();
  assert.equal(inferred(r.controller), null, "a straight even approach decides nothing by itself");
  // The guest commits again where the plane already is: that changes nothing about what the
  // plane stands for.
  r.guest.commit();
  assert.equal([...r.t.armed].filter((timer) => timer.ms === HOTSPOT_REST_MS).length, 1, "one rest wait is armed");
  const before = r.controller.snapshot().styleWrites;
  await r.t.pass(HOTSPOT_REST_MS - 1);
  assert.equal(inferred(r.controller), null, "not before the pointer has been quiet for the rest time");
  await r.t.pass(1 + 2 * HOTSPOT_POLL_MS);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  assert.equal(r.controller.snapshot().styleWrites, before + 1);
  assert.equal(r.t.armed.size, 0);

  // An order legacy KMS does not produce but another device might: an image that comes back
  // with an update and no move (its plane position happens to be the one the image before it
  // left). It is not at the plane position of its earlier showing.
  const b = await rig();
  b.send(300, 300); b.send(305, 300);
  b.guest.queue.length = 0;
  b.guest.show("hand", 300, 300); // plane (291,296): (9,4) and (14,4) both fit the 16 px image
  b.go("arrow", 297, 297);        // the arrow's plane is (296,296)
  b.send(305, 300); b.guest.queue.length = 0;
  b.guest.pointer = { x: 305, y: 300 }; b.guest.image = IMAGES.hand;
  b.guest.update();               // the hand's plane is (296,296) too: an update, no move
  assert.deepEqual(b.guest.plane, { x: 296, y: 296 });
  await b.rest();
  assert.equal(inferred(b.controller), null, "(305,300) - (291,296) = (14,4) would be read off the earlier showing");
  // In the same order, the image already shown set again: the plane stands where it stood, and
  // the rest wait starts over like after any cursor event.
  const c = await rig();
  ambiguousCaret(c);
  await c.t.pass(HOTSPOT_REST_MS - 10);
  c.guest.update();
  assert.deepEqual([...c.t.armed].map((timer) => [timer.ms, timer.at - c.t.now]), [[HOTSPOT_REST_MS, HOTSPOT_REST_MS]], "one rest wait, from now");
  await c.rest();
  assert.deepEqual(inferred(c.controller), [4, 8]);

  // Every send and every cursor event replaces the armed rest wait (one at most); a position
  // sent while the guest is being asked means the pointer was not at rest.
  const s = await rig();
  const restWaits = () => [...s.t.armed].filter((timer) => timer.ms === HOTSPOT_REST_MS);
  assert.equal(s.t.armed.size, 0, "nothing to wait for: nothing was reported since the page settled");
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
  // Starting inference over ends a question in flight at once; so do a guest reset and dispose.
  for (const end of ["mode", "size", "guest reset", "dispose"]) {
    const o = await rig();
    ambiguousCaret(o);
    await o.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
    assert.ok(o.t.armed.size > 0, "asking the guest");
    if (end === "mode") o.controller.setPointerState({ mode: "relative", pointerLocked: true });
    if (end === "size") o.controller.notePointer(906, 300, 1280, 801);
    if (end === "guest reset") o.controller.reset();
    if (end === "dispose") o.controller.dispose();
    await o.t.flush();
    assert.equal(o.t.armed.size, 0, `${end}: nothing of the old question is left waiting`);
    await o.t.pass(5000);
    assert.equal(inferred(o.controller), null, end);
  }
  // The proof's hook forgets the images and nothing else: a question in flight is answered,
  // for an image no move of which is remembered — no answer — and the next report and rest
  // settle it from the positions that were kept.
  const h = await rig();
  ambiguousCaret(h);
  await h.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
  h.controller.resetHotspotInference();
  assert.equal(h.controller.snapshot().hotspotSettling, false);
  await h.t.pass(5000);
  assert.equal(inferred(h.controller), null);
  h.guest.commit();
  await h.rest();
  assert.deepEqual(inferred(h.controller), [4, 8]);
  // A move that hides the cursor (resource 0) ends the wait for the image that was shown:
  // there is no image to give an answer to.
  for (const when of ["before the guest is asked", "while the guest is asked"]) {
    const diagnostics = [];
    const g = await rig({ onDiagnostic: (entry) => diagnostics.push(entry.reason) });
    ambiguousCaret(g);
    g.guest.busy = true;
    if (when === "while the guest is asked") await g.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
    assert.ok(g.controller.handle({ type: "cursor-move", state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: 908, y: 292 } } }));
    assert.equal([...g.t.armed].filter((timer) => timer.ms === HOTSPOT_REST_MS).length, 0, when);
    g.guest.busy = false;
    await g.t.pass(5000);
    assert.equal(inferred(g.controller), null, when);
    assert.deepEqual(diagnostics, [], when);
    assert.equal(g.t.armed.size, 0, when);
  }
  assert.throws(() => new CursorController({ target: cursorTarget(), documentTarget: null, hotspotRestMs: 0 }), RangeError);
  assert.throws(() => new CursorController({ target: cursorTarget(), documentTarget: null, guestIdleCount: 5 }), TypeError);
});

test("the client changes the cursor while the guest is being asked: the answer is not given to the new image", async () => {
  // The ordinary order on a button: the pointer arrives and rests, the guest is asked, and the
  // client changes the cursor (Chrome does 55-240 ms after the pointer arrived) before the
  // guest has answered. The answer was the caret's.
  const r = await rig();
  ambiguousCaret(r);                       // the caret rests at (912,300): 4, 10 and 16 px fit
  r.guest.busy = true;                     // the guest has other work: it is not idle yet
  await r.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
  assert.equal([...r.t.armed].filter((timer) => timer.ms === HOTSPOT_POLL_MS).length, 1, "the caret's question is being asked");
  r.guest.show("hand");                    // plane (903,296): 9 and 15 px fit
  r.guest.busy = false;
  await r.t.pass(HOTSPOT_POLL_MS);         // the guest answers: idle since
  assert.equal(inferred(r.controller), null, "the caret's (4,8) is not the hand's hotspot");
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  await r.rest();
  assert.deepEqual(inferred(r.controller), [9, 4], "the hand's own rest wait gets the hand's answer");
  // ... and the caret, back under the pointer, is still not settled by the answer it missed.
  r.guest.show("caret");
  assert.equal(inferred(r.controller), null);
  await r.rest();
  assert.deepEqual(inferred(r.controller), [4, 8]);
});

test("without an idle counter nothing is inferred; one that fails or says nothing is asked again later", async () => {
  // No paced clock: nothing ever tells the page that the guest has caught up, so it never
  // knows where the guest's pointer stands.
  const u = await rig({ idle: false });
  u.go("hand", 300, 300); u.go("hand", 380, 340); u.go("hand", 500, 420);
  assert.equal(inferred(u.controller), null, "three moves that agree, compared with nothing the page can vouch for");
  assert.equal(u.controller.snapshot().hotspotSettling, true);
  assert.equal(u.t.armed.size, 0, "and nothing is waited for");
  await u.t.pass(5000);
  assert.equal(u.t.armed.size, 0, "nor looked for");
  assert.equal(inferred(u.controller), null);
  assert.deepEqual(hotspotOf(u.target.style.cursor), [0, 0], "the cursor is the guest's image at the device's hotspot");
  // A counter that reports no number, and one that throws: looked at again every two seconds.
  for (const [counter, diagnostic] of [[async () => null, false], [async () => "7", false], [async () => { throw new Error("rpc"); }, true]]) {
    const diagnostics = [];
    let asked = 0;
    const r = await rig({ settle: false, guestIdleCount: () => { asked += 1; return counter(); }, onDiagnostic: (d) => diagnostics.push(d.reason ?? d) });
    r.go("hand", 300, 300); r.go("hand", 380, 340);
    await r.t.pass(2 * HOTSPOT_CAUGHT_UP_TIMEOUT_MS + 500);
    assert.equal(inferred(r.controller), null);
    assert.equal(r.controller.snapshot().hotspotSettling, true);
    assert.equal(asked, 3, "at the first position and every two seconds since");
    assert.equal(diagnostics.includes("cursor-hotspot-idle-error"), diagnostic);
    assert.deepEqual([...r.t.armed].map((timer) => timer.ms), [HOTSPOT_CAUGHT_UP_TIMEOUT_MS]);
    // Starting over ends that wait; the next position asks anew.
    r.controller.setPointerState({ mode: "relative", pointerLocked: true });
    assert.equal(r.t.armed.size, 0);
    r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
    await r.t.pass(5000);
    assert.equal(asked, 3, "nothing to ask about until a position is sent");
    r.send(400, 400);
    await r.t.flush();
    assert.equal(asked, 4);
  }
  // A counter that appears later (the paced clock starts after the page does), goes away in
  // the middle of a question, and comes back.
  let state = "none"; let count = 0;
  const late = await rig({ settle: false, guestIdleCount: async () => (state === "none" ? null : (count += 1)) });
  late.go("hand", 300, 300); late.go("hand", 380, 340);
  await late.t.pass(HOTSPOT_CAUGHT_UP_TIMEOUT_MS - 1);
  assert.equal(late.controller.snapshot().hotspotSettling, true);
  state = "counting";
  await late.t.pass(1);                    // looked at again: a first reading
  state = "none";
  await late.t.pass(HOTSPOT_POLL_MS);      // gone at the second
  assert.equal(late.controller.snapshot().hotspotSettling, true, "a count that went away answered nothing");
  assert.deepEqual([...late.t.armed].map((timer) => timer.ms), [HOTSPOT_CAUGHT_UP_TIMEOUT_MS]);
  state = "counting";
  await late.t.pass(HOTSPOT_CAUGHT_UP_TIMEOUT_MS + HOTSPOT_POLL_MS);
  assert.equal(late.controller.snapshot().hotspotSettling, false);
  late.go("hand", 420, 300); late.go("hand", 500, 360);
  assert.deepEqual(inferred(late.controller), [9, 4]);
  // A rest question whose counter goes away gets no answer either.
  const gone = await rig();
  let there = true;
  const real = gone.guest.idleCount.bind(gone.guest);
  gone.guest.idleCount = async () => (there ? real() : null);
  ambiguousCaret(gone);
  gone.guest.busy = true;
  await gone.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
  there = false; gone.guest.busy = false;
  await gone.t.pass(5000);
  assert.equal(inferred(gone.controller), null);
  assert.equal(gone.t.armed.size, 0);
  // A guest that takes ten polls to go idle (busy with something else, no cursor events): the
  // same question still gets its answer.
  const slow = await rig();
  ambiguousCaret(slow);
  slow.guest.busy = true;
  await slow.t.pass(HOTSPOT_REST_MS + 10 * HOTSPOT_POLL_MS);
  assert.equal(inferred(slow.controller), null);
  slow.guest.busy = false;
  await slow.t.pass(2 * HOTSPOT_POLL_MS);
  assert.deepEqual(inferred(slow.controller), [4, 8]);
  // A guest that is never idle within the timeout: asked for two seconds, then left alone.
  const busy = await rig();
  ambiguousCaret(busy);
  busy.guest.busy = true;
  await busy.t.pass(HOTSPOT_REST_MS + HOTSPOT_CAUGHT_UP_TIMEOUT_MS + 5 * HOTSPOT_POLL_MS);
  assert.equal(inferred(busy.controller), null);
  assert.equal(busy.t.armed.size, 0, "it stops asking");
  // ... and the answer comes with the next rest once it is idle again.
  busy.guest.busy = false;
  busy.send(906, 300); busy.guest.pump(1);
  await busy.rest();
  assert.deepEqual(inferred(busy.controller), [4, 8]);
});

test("relative mode is not evidence; changing mode restarts the evidence and keeps what is settled", async () => {
  const r = await rig();
  r.go("hand", 300, 300); r.go("hand", 380, 340);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // Pointer lock: the page sends no absolute positions; the guest's pointer wanders by deltas.
  r.controller.setPointerState({ mode: "relative", pointerLocked: true });
  assert.deepEqual(inferred(r.controller), [9, 4], "a settled hotspot belongs to its image, whatever the mode");
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  await r.t.pass(5000);
  assert.equal(r.controller.snapshot().hotspotSettling, true, "for as long as the mode lasts: no position the page sends is one the plane stands for");
  assert.equal(r.t.armed.size, 0, "and the guest is not asked anything");
  r.guest.show("caret", 500, 500); r.guest.show("caret", 388, 351); r.guest.show("caret", 309, 311); r.guest.show("caret", 395, 356);
  assert.equal(inferred(r.controller), null, "moves in relative mode are not compared with anything");
  // Even a caller that notes positions in relative mode gets nothing inferred from them.
  for (const [x, y] of [[600, 300], [650, 380], [720, 330]]) { r.controller.notePointer(x, y, 1280, 800); r.guest.show("caret", x, y); }
  assert.equal(inferred(r.controller), null);
  await r.t.pass(1000);
  assert.equal(r.t.armed.size, 0, "and no rest is waited for");
  assert.equal(r.controller.snapshot().hotspotSettling, true, "nor is the guest asked about such a position");
  for (const [x, y] of [[610, 310], [660, 390], [730, 340]]) { r.controller.notePointer(x, y, 1280, 800); r.guest.show("caret", x, y); }
  assert.equal(inferred(r.controller), null);
  // Back in absolute mode the guest is still acting on relative motion: until it has been
  // idle after an absolute position, its moves are not evidence — not even ones a newly sent
  // position would explain.
  r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
  await r.t.pass(1000);
  assert.equal(r.controller.snapshot().hotspotSettling, true, "idle, but no absolute position was sent yet");
  r.guest.busy = true; // other work: it acts on the positions and is not idle
  r.send(700, 200); r.guest.pump();
  r.send(640, 260); r.guest.pump();
  assert.equal(inferred(r.controller), null, "(4,8) twice — but the guest has not been idle since the restart");
  r.guest.busy = false;
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
  for (const restart of ["size", "mode"]) {
    const r = await rig({ size: 24 });
    r.go("arrow", 400, 300); r.go("arrow", 340, 380);
    const xs = [300, 290, 280, 270, 260, 250, 240, 230, 220, 210];
    r.send(xs[0], 500);
    for (let i = 1; i < 5; i += 1) { r.send(xs[i], 500); r.guest.pump(1, i >= 3 ? "hand" : "arrow"); }
    assert.equal(r.guest.queue.length, 1, restart);
    if (restart === "mode") { r.controller.setPointerState({ mode: "relative", pointerLocked: true }); r.controller.setPointerState({ mode: "absolute", pointerLocked: false }); }
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
  // The proof's hook keeps the positions sent, so the same outstanding moves are explained by
  // the positions they stand for: never a wrong answer, and the right one from moves alone.
  const r = await rig({ size: 24 });
  r.go("arrow", 400, 300); r.go("arrow", 340, 380);
  const xs = [300, 290, 280, 270, 260, 250, 240, 230, 220, 210];
  r.send(xs[0], 500);
  for (let i = 1; i < 5; i += 1) { r.send(xs[i], 500); r.guest.pump(1, i >= 3 ? "hand" : "arrow"); }
  r.controller.resetHotspotInference();
  for (let i = 5; i < xs.length; i += 1) {
    r.send(xs[i], 500); r.guest.pump(1, "hand");
    assert.equal(inferred(r.controller), null, `hook: 9 and 19 px both explain the move for position ${i - 1}`);
    await r.t.pass(16);
  }
  await r.t.pass(5000);
  assert.equal(inferred(r.controller), null, "hook: no rest answer while the guest is behind");
  r.send(150, 520); r.guest.pump(1, "hand");
  assert.equal(inferred(r.controller), null);
  r.send(90, 505); r.guest.pump(1, "hand"); // the move for (150,520): only (9,4) explains it
  assert.deepEqual(inferred(r.controller), [9, 4]);
});

test("a change of guest output size restarts the evidence and keeps what is settled", async () => {
  const r = await rig();
  r.go("hand", 300, 300); r.go("hand", 380, 340);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  ambiguousCaret(r); // 4, 10 and 16 px all fit its two moves
  // The output becomes 1920x1200: positions computed for 1280x800 no longer compare. What the
  // caret's moves allowed is forgotten; the hand's settled hotspot is not.
  r.send(906, 300, 1920, 1200);
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  r.guest.pump();
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, true, "the position that carried the change does not compare with the one before it");
  r.send(900, 640, 1920, 1200); r.guest.pump();
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  assert.equal(inferred(r.controller), null, "nothing to read a rest answer off: the caret starts from nothing");
  for (const [x, y] of [[880, 600], [820, 700]]) { r.send(x, y, 1920, 1200); r.guest.pump(); }
  assert.deepEqual(inferred(r.controller), [4, 8]);
  r.guest.show("hand");
  assert.deepEqual(inferred(r.controller), [9, 4], "kept across the change of size");
  // The same size again changes nothing; positions without a size are taken as they are.
  r.send(910, 650, 1920, 1200);
  r.controller.notePointer(920, 660);
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // The proof's hook forgets settled answers too.
  r.controller.resetHotspotInference();
  assert.equal(inferred(r.controller), null);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  r.guest.show("caret");
  assert.equal(inferred(r.controller), null, "the caret's as well");
  // A change of width alone, or of height alone, is a change of size.
  r.send(930, 660, 1921, 1200);
  assert.equal(r.controller.snapshot().hotspotSettling, true, "width");
  r.send(940, 660, 1921, 1200); r.guest.pump();
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  r.send(950, 660, 1921, 1201);
  assert.equal(r.controller.snapshot().hotspotSettling, true, "height");
});

test("a contradicted hotspot is taken back from the page, and a guest reset forgets everything", async () => {
  const estimator = new CursorHotspotEstimator();
  const r = await rig({ hotspotEstimator: estimator });
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
  // A guest reset: no cursor, no history, nothing in flight — and a guest whose pointer the
  // page has never placed.
  assert.deepEqual({ ...estimator.hotspot(key) }, { x: 9, y: 4 });
  ambiguousCaret(r);
  await r.t.pass(HOTSPOT_REST_MS + HOTSPOT_POLL_MS / 2);
  assert.ok(r.t.armed.size > 0, "a question in flight");
  const next = r.reboot();
  assert.equal(inferred(r.controller), null);
  assert.equal(estimator.hotspot(key), null);
  assert.equal(estimator._sent.length, 0);
  assert.equal(r.t.armed.size, 0);
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  // What the old guest's tablet held says nothing about the new one's: the first position
  // sent to it may be the one it holds (here it is: 0,0), and is not asked about.
  r.send(0, 0); next.pump();
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, true);
  assert.equal(r.t.armed.size, 0);
  // The new guest's moves are evidence once it has been idle after a position it acts on.
  next.busy = true;
  r.send(100, 100); next.pump(Infinity, "hand");
  r.send(180, 150); next.pump();
  assert.equal(inferred(r.controller), null, "not yet");
  next.busy = false;
  await r.rest();
  assert.equal(r.controller.snapshot().hotspotSettling, false);
  r.go("hand", 260, 210); r.go("hand", 330, 180);
  assert.deepEqual(inferred(r.controller), [9, 4]);
});

test("estimator failures become diagnostics, never a broken cursor", async () => {
  const diagnostics = [];
  let failing = false;
  const fail = (what) => { if (failing) throw new Error(what); };
  const broken = { notePointer() { fail("np"); }, noteInstall() { fail("ni"); }, hotspot: () => null,
    noteMove() { fail("nm"); return null; }, noteRest() { fail("nr"); return null; }, restart() { fail("rs"); }, forget() { fail("fg"); }, reset() { fail("rt"); },
    get sends() { return 0; } };
  const r = await rig({ hotspotEstimator: broken, onDiagnostic: (d) => diagnostics.push(`${d.reason}: ${d.error}`) });
  assert.deepEqual(diagnostics, []);
  failing = true;
  r.go("hand", 100, 100); r.go("hand", 160, 140);
  await r.rest();
  assert.equal(inferred(r.controller), null);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0], "the cursor is still the guest's image");
  r.controller.resetHotspotInference();
  r.controller.setPointerState({ mode: "relative", pointerLocked: true });
  r.controller.reset();
  for (const reason of ["cursor-hotspot-pointer-error: np", "cursor-hotspot-error: ni", "cursor-hotspot-error: nm", "cursor-hotspot-error: nr",
    "cursor-hotspot-error: fg", "cursor-hotspot-error: rs", "cursor-hotspot-error: rt"]) assert.ok(diagnostics.includes(reason), reason);
});
