// E5-T36 — hotspot inference for a cursor image the device did not describe.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CursorController, HOTSPOT_REST_MS } from "../src/sink/cursor-controller.js";
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

test("a rest answer read off a plane that was still on its way is dropped by the plane's next move", () => {
  const e = new CursorHotspotEstimator();
  const hot = { x: 9, y: 4 };
  // An even straight run to the right; the guest is two positions behind when the pointer stops.
  const xs = [100, 110, 120, 130, 140, 150];
  for (const x of xs) e.notePointer(x, 500);
  for (const x of xs.slice(0, 4)) assert.equal(e.noteMove("hand", 64, 64, x - hot.x, 500 - hot.y), null);
  // "Rest" is declared too early: the plane still stands for the position sent two moves ago,
  // and on an even run that offset is one every move allowed.
  assert.deepEqual({ ...e.noteRest("hand", 64, 64) }, { x: 29, y: 4 }, "(150,500) - (121,496): allowed, and wrong");
  // The plane moves again although nothing was sent: that answer was not read at rest.
  assert.equal(e.noteMove("hand", 64, 64, 140 - hot.x, 500 - hot.y), null);
  assert.equal(e.hotspot("hand"), null);
  assert.equal(e.noteMove("hand", 64, 64, 150 - hot.x, 500 - hot.y), null, "two offsets still fit");
  assert.deepEqual({ ...e.noteRest("hand", 64, 64) }, hot, "now it is at rest");
  // After something new is sent, an ordinary move does not disturb a rest answer.
  e.notePointer(300, 420);
  assert.deepEqual({ ...e.noteMove("hand", 64, 64, 291, 416) }, hot);
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

test("the number of remembered images is bounded; a forgotten one is inferred again", () => {
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
  // A long run of distinct images never holds more than the cap, and the sent history stays
  // at its own bound.
  for (let i = 0; i < 500; i += 1) { e.notePointer(100 + (i % 7) * 31, 100 + (i % 5) * 17); e.noteMove(`anim-${i}`, 32, 32, 90, 90); }
  assert.equal(e._images.size, 3);
  assert.ok(e._sent.length <= 128);
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
// the event before them. `LegacyKmsGuest` reports exactly that.

function cursorTarget() {
  return { style: { cursor: "auto" }, appendChild() {}, removeChild() {} };
}
const hotspotOf = (css) => css.match(/\) (\d+) (\d+),/).slice(1).map(Number);
const inferred = (controller) => {
  const s = controller.snapshot();
  return s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY];
};
function timers() {
  const armed = new Map(); let next = 1;
  return { armed,
    setTimer: (fn, ms) => { const id = next; next += 1; armed.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { armed.delete(id); },
    // Fire every armed timer (the rest period passed with nothing happening).
    elapse() { const due = [...armed.entries()]; armed.clear(); for (const [, timer] of due) timer.fn(); return due.length; } };
}
const IMAGES = { arrow: { hot: [1, 1], fill: 0xff0000ff, id: 11 }, hand: { hot: [9, 4], fill: 0xff00ff00, id: 12 },
  caret: { hot: [4, 8], fill: 0xffff0000, id: 13 }, cross: { hot: [0, 0], fill: 0xff00ffff, id: 14 },
  described: { hot: [2, 6], fill: 0xffffff00, id: 15, reports: true } };
class LegacyKmsGuest {
  constructor(controller, { size = 16 } = {}) {
    this.controller = controller; this.size = size; this.image = null; this.plane = { x: 0, y: 0 }; this.pointer = { x: 0, y: 0 };
  }
  _state(image, x, y) {
    const [hotX, hotY] = image.reports ? image.hot : [0, 0];
    return { resourceId: image.id, hotX, hotY, pos: { scanoutId: 0, x, y } };
  }
  // The guest's pointer is at (x, y) and its cursor is `name`: one commit.
  show(name, x = this.pointer.x, y = this.pointer.y) {
    const image = IMAGES[name];
    this.pointer = { x, y };
    if (this.image !== image) {
      // Set image: at the plane's previous position.
      assert.ok(this.controller.handle({ type: "cursor-update", state: this._state(image, this.plane.x, this.plane.y),
        format: 1, resourceWidth: this.size, resourceHeight: this.size, pixels: new Uint32Array(this.size * this.size).fill(image.fill) }));
      this.image = image;
    }
    const target = { x: x - image.hot[0], y: y - image.hot[1] };
    if (target.x !== this.plane.x || target.y !== this.plane.y) {
      this.plane = target;
      assert.ok(this.controller.handle({ type: "cursor-move", state: this._state(image, target.x, target.y) }));
    }
  }
}
function rig(options = {}) {
  const target = cursorTarget(); const t = timers();
  const controller = new CursorController({ target, documentTarget: null, setTimer: t.setTimer, clearTimer: t.clearTimer, ...options });
  const guestOs = new LegacyKmsGuest(controller);
  const send = (x, y, w = 1280, h = 800) => controller.notePointer(x, y, w, h);
  // Send a position and let the guest act on it at once.
  const go = (name, x, y) => { send(x, y); guestOs.show(name, x, y); };
  return { target, t, controller, guest: guestOs, send, go };
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

test("a recorded glide onto the button (Replay desktop, legacy KMS) ends with the hand's true hotspot", () => {
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
  let now = LOG[0][0]; let timer = null;
  const target = cursorTarget();
  const controller = new CursorController({ target, documentTarget: null,
    setTimer: (fn, ms) => { timer = { fn, at: now + ms }; return timer; }, clearTimer: (handle) => { if (timer === handle) timer = null; } });
  let shown = null; const answers = [];
  const record = (why) => {
    const hot = inferred(controller);
    if (hot === null) return;
    assert.ok(Math.abs(hot[0] - HOT[shown][0]) <= 1 && Math.abs(hot[1] - HOT[shown][1]) <= 1, `${why}: ${JSON.stringify(hot)} for the ${shown}`);
    if (answers.at(-1)?.[0] !== shown) answers.push([shown, hot, why]);
  };
  const elapse = (until) => { if (timer && until >= timer.at) { const due = timer; timer = null; now = due.at; due.fn(); record("rest"); } };
  for (const [t, kind, x, y, image] of LOG) {
    elapse(t);
    now = t;
    if (kind === "S") { controller.notePointer(x, y, 1280, 800); continue; }
    const state = { resourceId: ID[image], hotX: 0, hotY: 0, pos: { scanoutId: 0, x, y } };
    if (kind === "U") {
      shown = image;
      assert.ok(controller.handle({ type: "cursor-update", state, format: 1, resourceWidth: 64, resourceHeight: 64, pixels: new Uint32Array(4096).fill(FILL[image]) }));
    } else assert.ok(controller.handle({ type: "cursor-move", state }));
    record(`${kind} at ${t}`);
  }
  assert.equal(shown, "hand");
  assert.equal(inferred(controller), null, "one move of the hand: 9, 10, 12 and 15 px all explain it");
  elapse(now + 1000);
  assert.deepEqual(inferred(controller), [9, 4], "at rest");
  assert.deepEqual(hotspotOf(target.style.cursor), [9, 4]);
  assert.deepEqual(answers.map(([image, hot]) => [image, hot]), [["arrow", [1, 1]], ["hand", [9, 4]]]);
});

test("random approaches across an image change, in the device's order: never a wrong hotspot, right at rest", () => {
  // The refuted behaviour: about one straight glide in eight left the hand wrong at rest.
  let state = 0x9e3779b9;
  const random = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
  const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
  const names = ["hand", "caret", "cross"];
  let settledAtRest = 0, settledBefore = 0, trials = 0;
  for (let trial = 0; trial < 600; trial += 1) {
    const r = rig();
    const other = names[trial % names.length];
    // Left of x = 166 the guest shows `other`, right of it the arrow (the button's edge).
    const shape = (x) => (x < 166 ? other : "arrow");
    r.go("arrow", 600, 300); r.go("arrow", 700 - Math.floor(random() * 300), 420 + Math.floor(random() * 200));
    const from = [200 + Math.floor(random() * 300), 430 + Math.floor(random() * 250)];
    const to = [30 + Math.floor(random() * 125), 480 + Math.floor(random() * 60)];
    const steps = 8 + Math.floor(random() * 30);
    const lag = Math.floor(random() * 4);          // positions the guest is behind
    const imageDelay = Math.floor(random() * 4);   // positions between crossing the edge and the image change
    const curve = random() < 0.5 ? (t) => t : minJerk;
    r.go("arrow", from[0], from[1]);
    const sent = [];
    const guestQueue = [];
    let crossedAt = null;
    const check = (where) => {
      const now = inferred(r.controller);
      if (now === null) return;
      const truth = r.guest.image.hot;
      assert.ok(Math.abs(now[0] - truth[0]) <= 1 && Math.abs(now[1] - truth[1]) <= 1,
        `trial ${trial} ${where}: ${JSON.stringify(now)} for a true ${JSON.stringify(truth)} (lag ${lag}, delay ${imageDelay}, ${steps} steps)`);
    };
    const guestStep = () => {
      const p = guestQueue.shift();
      if (!p) return;
      // The guest moves its pointer; the cursor image follows `imageDelay` positions later.
      r.guest.show(r.guest.image === IMAGES.arrow ? "arrow" : other, p[0], p[1]);
      if (shape(p[0]) !== (r.guest.image === IMAGES.arrow ? "arrow" : other)) {
        crossedAt ??= 0;
        if (crossedAt >= imageDelay) { r.guest.show(shape(p[0])); crossedAt = null; } else crossedAt += 1;
      }
    };
    for (let i = 1; i <= steps; i += 1) {
      const s = curve(i / steps);
      const p = [Math.round(from[0] + (to[0] - from[0]) * s), Math.round(from[1] + (to[1] - from[1]) * s)];
      r.send(p[0], p[1]); sent.push(p); guestQueue.push(p);
      if (guestQueue.length > lag) guestStep();
      check(`step ${i}`);
    }
    // The pointer stops; the guest catches up and its image settles.
    while (guestQueue.length) { guestStep(); check("catching up"); }
    for (let i = 0; i <= imageDelay && r.guest.image.hot !== IMAGES[shape(to[0])].hot; i += 1) r.guest.show(shape(to[0]));
    check("caught up");
    trials += 1;
    if (inferred(r.controller) !== null) settledBefore += 1;
    r.t.elapse();
    check("at rest");
    if (inferred(r.controller) !== null) settledAtRest += 1;
    // A few more moves inside the same shape never make it wrong either.
    for (let i = 0; i < 3; i += 1) { r.go(other, 40 + Math.floor(random() * 100), 485 + Math.floor(random() * 50)); check("after"); }
    assert.notEqual(inferred(r.controller), null, `trial ${trial}: known after moving about inside the shape`);
  }
  // At rest the hotspot is known whenever the image was moved at all after its install.
  assert.ok(settledAtRest >= trials * 0.9, `${settledAtRest} of ${trials} settled at rest (${settledBefore} before it)`);
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
  assert.equal(r.controller.snapshot().styleWrites, before + 1, "later moves write no style");
  assert.equal(r.t.armed.size, 0, "no rest timer once the hotspot is known");
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

test("the pointer at rest settles the hotspot after a straight approach; sends and cursor events restart the wait", () => {
  const r = rig();
  r.go("arrow", 600, 400); r.go("arrow", 232, 500);
  // A straight, evenly spaced approach (3 px a step, leftwards onto the button at x < 166) with
  // the guest two positions behind; its cursor becomes the hand when its pointer crosses.
  const xs = [];
  for (let x = 229; x >= 100; x -= 3) xs.push(x);
  for (let i = 0; i < xs.length; i += 1) {
    r.send(xs[i], 500);
    if (i >= 2) r.guest.show(xs[i - 2] < 166 ? "hand" : "arrow", xs[i - 2], 500);
  }
  for (const x of xs.slice(-2)) r.guest.show("hand", x, 500);
  assert.equal(inferred(r.controller), null, "a straight even approach decides nothing by itself");
  assert.equal(r.t.armed.size, 1, "one wait for rest is armed");
  assert.equal([...r.t.armed.values()][0].ms, HOTSPOT_REST_MS);
  const before = r.controller.snapshot().styleWrites;
  assert.equal(r.t.elapse(), 1);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [9, 4]);
  assert.equal(r.controller.snapshot().styleWrites, before + 1);
  assert.equal(r.t.armed.size, 0);

  // Every send and every cursor event replaces the armed wait (a debounce, one timer at most).
  const s = rig();
  assert.equal(s.t.armed.size, 0, "nothing to wait for before a cursor exists");
  s.send(900, 300); s.send(906, 300);
  s.guest.show("caret", 900, 300); // (4,8) and (10,8) both explain the plane
  assert.equal(inferred(s.controller), null);
  assert.equal(s.t.armed.size, 1);
  const first = [...s.t.armed.keys()][0];
  s.send(912, 300);
  assert.equal(s.t.armed.size, 1); assert.notEqual([...s.t.armed.keys()][0], first);
  const second = [...s.t.armed.keys()][0];
  s.guest.show("caret", 906, 300);
  assert.equal(inferred(s.controller), null, "an even run: both offsets still fit");
  assert.equal(s.t.armed.size, 1); assert.notEqual([...s.t.armed.keys()][0], second);
  // A stale callback (one that fires although it was replaced) does nothing.
  const stale = { ...[...s.t.armed.values()][0] };
  s.send(918, 300);
  stale.fn();
  assert.equal(inferred(s.controller), null);
  // Dispose cancels it.
  s.controller.dispose();
  assert.equal(s.t.armed.size, 0);
  assert.throws(() => new CursorController({ target: cursorTarget(), documentTarget: null, hotspotRestMs: 0 }), RangeError);
});

test("relative mode is not evidence, and changing mode starts inference over", () => {
  const r = rig();
  r.go("hand", 300, 300); r.go("hand", 380, 340);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // Pointer lock: the page sends no absolute positions; the guest's pointer wanders by deltas.
  r.controller.setPointerState({ mode: "relative", pointerLocked: true });
  assert.equal(inferred(r.controller), null, "what was inferred in absolute mode is not carried across");
  r.guest.show("caret", 500, 500); r.guest.show("caret", 388, 351); r.guest.show("caret", 309, 311); r.guest.show("caret", 395, 356);
  assert.equal(inferred(r.controller), null, "moves in relative mode are not compared with anything");
  assert.equal(r.t.armed.size, 0, "and no rest is waited for");
  // Back in absolute mode the stale positions from before the lock explain nothing.
  r.controller.setPointerState({ mode: "absolute", pointerLocked: false });
  r.guest.show("caret", 392, 352);
  assert.equal(inferred(r.controller), null);
  r.go("caret", 700, 200); r.go("caret", 640, 260);
  assert.deepEqual(inferred(r.controller), [4, 8]);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [4, 8]);
});

test("a change of guest output size starts inference over", () => {
  const r = rig();
  r.go("hand", 300, 300); r.go("hand", 380, 340);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // The output becomes 1920x1200: positions computed for 1280x800 no longer compare.
  r.send(600, 500, 1920, 1200);
  assert.equal(inferred(r.controller), null);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0]);
  r.guest.show("hand", 600, 500);
  r.send(900, 640, 1920, 1200); r.guest.show("hand", 900, 640);
  assert.deepEqual(inferred(r.controller), [9, 4]);
  // The same size again changes nothing; positions without a size are taken as they are.
  r.send(910, 650, 1920, 1200);
  r.controller.notePointer(920, 660);
  assert.deepEqual(inferred(r.controller), [9, 4]);
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
  // A guest reset: no cursor, no history.
  r.controller.reset();
  assert.equal(inferred(r.controller), null);
  assert.equal(estimator.hotspot(key), null);
  assert.equal(r.t.armed.size, 0);
  const fresh = new LegacyKmsGuest(r.controller);
  r.send(100, 100); fresh.show("hand", 100, 100);
  assert.equal(inferred(r.controller), null);
});

test("estimator failures become diagnostics, never a broken cursor", () => {
  const diagnostics = [];
  const broken = { notePointer() { throw new Error("np"); }, noteInstall() { throw new Error("ni"); }, hotspot: () => null,
    noteMove() { throw new Error("nm"); }, noteRest() { throw new Error("nr"); }, reset() { throw new Error("rs"); } };
  const r = rig({ hotspotEstimator: broken, onDiagnostic: (d) => diagnostics.push(d.reason ?? d) });
  r.go("hand", 100, 100); r.go("hand", 160, 140);
  r.t.elapse();
  assert.equal(inferred(r.controller), null);
  assert.deepEqual(hotspotOf(r.target.style.cursor), [0, 0], "the cursor is still the guest's image");
  r.controller.reset();
  for (const reason of ["cursor-hotspot-pointer-error", "cursor-hotspot-error"]) assert.ok(diagnostics.includes(reason), reason);
});
