#!/usr/bin/env node
// E5-T36a verifier — the estimator and controller against the event order the device REALLY
// delivers on legacy KMS. Measured in the browser (natural-instrumented/events.json, 560 updates
// and 560 moves; approach-C-instrumented/events.json):
//   * every guest commit is  UPDATE_CURSOR(image, pos = the plane's PREVIOUS position)  followed by
//     MOVE_CURSOR(new position)   (wlroots legacy_crtc_commit: drmModeSetCursor, then
//     drmModeMoveCursor; virtio-gpu reports a new framebuffer as UPDATE_CURSOR at the plane's
//     current position). At an image change the first position the page attributes to the NEW
//     image was therefore computed with the OLD image's hotspot;
//   * the client changes the image some time after the guest pointer crossed into the region
//     (about 55 ms for page text, about 240 ms for the button), in a commit of its own (pointer
//     unchanged) or together with a motion.
//
//   node evidence/e5-t36a/verifier/attacks-legacy-order.mjs
//
// A WRONG answer is a hotspot more than one pixel from the truth on either axis.
//
// History, for honesty: my first model changed the image in the very commit that crossed the
// region's edge. It predicted (22,1) for plan-approach-from-right.json; the browser showed
// "unresolved at rest, then (9,4)" (approach-from-right-1/result.json) — that prediction FAILED.
// The model below adds the measured delay; its predictions for plans A and C were written into
// the plan files before those runs and held ((12,3) and (45,7)).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CursorHotspotEstimator } from "../../../web/src/sink/cursor-hotspot.js";
import { CursorController } from "../../../web/src/sink/cursor-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHAPES = { arrow: { hot: { x: 1, y: 1 }, fill: 0xff0000ff }, hand: { hot: { x: 9, y: 4 }, fill: 0xff00ff00 }, caret: { hot: { x: 4, y: 8 }, fill: 0xffff0000 } };
const isWrong = (got, hot) => got != null && (Math.abs(got.x - hot.x) > 1 || Math.abs(got.y - hot.y) > 1);
const fmt = (p) => (p ? `(${p.x},${p.y})` : "null");
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lines = []; const say = (s = "") => { lines.push(s); console.log(s); };

// ── hosts: the real controller, and the calls it makes on its estimator ───────────────────────
const pixels = Object.fromEntries(Object.entries(SHAPES).map(([name, s]) => [name, new Uint32Array(64 * 64).fill(s.fill)]));
const ev = (type, shape, x, y) => ({ type, state: { resourceId: 6, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: x >>> 0, y: y >>> 0 } },
  ...(type === "cursor-update" ? { format: 1, resourceWidth: 64, resourceHeight: 64, pixels: pixels[shape] } : {}) });
class RealController {
  constructor() { this.target = { style: { cursor: "auto" }, appendChild() {}, removeChild() {} }; this.c = new CursorController({ target: this.target, documentTarget: null }); }
  sent(x, y) { this.c.notePointer(x, y); }
  update(shape, x, y) { this.c.handle(ev("cursor-update", shape, x, y)); }
  move(shape, x, y) { this.c.handle(ev("cursor-move", shape, x, y)); }
  hot() { const s = this.c.snapshot(); return s.inferredHotX === null ? null : { x: s.inferredHotX, y: s.inferredHotY }; }
  css() { const m = /\) (\d+) (\d+),/.exec(this.target.style.cursor); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; }
}
// cursor-controller.js:370 and 388-410 without the PNG encoding, for the large runs.
class Replica {
  constructor() { this.e = new CursorHotspotEstimator(); this.key = null; this._hot = null; }
  sent(x, y) { this.e.notePointer(x, y); }
  _infer(x, y) { const h = this.e.noteMove(this.key, 64, 64, x >>> 0, y >>> 0); if (h === null || (h.x === 0 && h.y === 0)) return; this._hot = h; }
  update(shape, x, y) { this.key = shape; this._hot = this.e.hotspot(shape); if (this._hot === null) this._infer(x, y); }
  move(shape, x, y) { if (this.key !== null && this._hot === null) this._infer(x, y); }
  hot() { return this._hot && !(this._hot.x === 0 && this._hot.y === 0) ? this._hot : null; }
}

// ── the guest ─────────────────────────────────────────────────────────────────────────────────
// Guest pixels of the published desktop: the "Run again" button, the terminal; everything else
// used here is page body.
const LAYOUT = (x, y) => (x >= 22 && x < 164 && y >= 491 && y < 542 ? "hand" : x >= 795 ? "caret" : "arrow");
const minjerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
function glide(t0, from, to, ms, hz = 60) { // the positions continuous-path-browser.mjs sends
  const n = Math.max(1, Math.round((ms * hz) / 1000)); const out = []; let last = from;
  for (let i = 1; i <= n; i += 1) {
    const s = minjerk(i / n); const p = { x: Math.round(from.x + (to.x - from.x) * s), y: Math.round(from.y + (to.y - from.y) * s) };
    if (p.x !== last.x || p.y !== last.y) { out.push({ t: t0 + (i * 1000) / hz, ...p }); last = p; }
  }
  return out;
}
// sends: [{t, x, y}] in time order; marks: [{t, name}]. order "legacy" is the device as recorded;
// "ideal" is a device whose update carries the new image's own position.
function simulate(host, sends, { tau = () => 150, delay = () => 8, order = "legacy", marks = [], trace = null } = {}) {
  const timeline = []; let region = "arrow"; let g = -1;
  for (const s of sends) {
    timeline.push({ t: s.t, kind: "S", p: s });
    g = Math.max(g + 0.5, s.t + delay()); timeline.push({ t: g, kind: "G", p: s });
    const now = LAYOUT(s.x, s.y); if (now !== region) { timeline.push({ t: g + tau(now), kind: "C", shape: now }); region = now; }
  }
  for (const m of marks) timeline.push({ t: m.t, kind: "R", name: m.name });
  const rank = { S: 0, G: 1, C: 2, R: 3 };
  timeline.sort((a, b) => a.t - b.t || rank[a.kind] - rank[b.kind]);
  let plane = { x: 99, y: 99 }; let shape = "arrow"; let shown = null; let pointer = { x: 100, y: 100 }; let pending = null; let pendingAt = 0;
  const first = {}; const reads = {};
  const commit = (why) => {
    const hot = SHAPES[shape].hot; const next = { x: pointer.x - hot.x, y: pointer.y - hot.y };
    if (order === "legacy") { host.update(shape, plane.x, plane.y); host.move(shape, next.x, next.y); }
    else if (shape !== shown) host.update(shape, next.x, next.y);
    else host.move(shape, next.x, next.y);
    trace?.push(`${why.padEnd(6)} ${shape.padEnd(5)} UPDATE at (${plane.x},${plane.y}), MOVE to (${next.x},${next.y}) -> page's hotspot ${fmt(host.hot())}`);
    plane = next; shown = shape; const got = host.hot(); if (got && !first[shape]) first[shape] = { ...got };
  };
  for (const x of timeline) {
    if (pending && x.t - pendingAt > 3) { shape = pending; pending = null; commit("static"); }
    if (x.kind === "S") { host.sent(x.p.x, x.p.y); trace?.push(`sent   (${x.p.x},${x.p.y})`); }
    else if (x.kind === "G") { pointer = x.p; let why = "motion"; if (pending) { shape = pending; pending = null; why = "merged"; } commit(why); }
    else if (x.kind === "C") { if (x.shape !== shape || pending) { pending = x.shape; pendingAt = x.t; } }
    else reads[x.name] = { shape, hot: host.hot() ? { ...host.hot() } : null };
  }
  if (pending) { shape = pending; commit("static"); }
  return { first, reads };
}
const timing = (seed, tauLo = 60, tauHi = 300) => { const a = rng(seed * 101 + 5); const b = rng(seed * 211 + 9); return { tau: () => tauLo + a() * (tauHi - tauLo), delay: () => 4 + b() * 10 }; };

// ── 1. predictions.txt case E, through the real controller ─────────────────────────────────────
// An image change that arrives together with a motion (2 of the 5 changes in
// natural-instrumented/events.json did: e.g. t=49284.2 UPDATE at (193,488), MOVE to (212,490)).
{
  const run = (order, extra = []) => {
    const host = new RealController(); const trace = []; let plane = { x: 99, y: 99 }; let shown = null;
    const commit = (shape, p) => {
      host.sent(p.x, p.y); trace.push(`sent   (${p.x},${p.y})`);
      const hot = SHAPES[shape].hot; const next = { x: p.x - hot.x, y: p.y - hot.y };
      if (order === "legacy") { host.update(shape, plane.x, plane.y); host.move(shape, next.x, next.y); }
      else if (shape !== shown) host.update(shape, next.x, next.y); else host.move(shape, next.x, next.y);
      trace.push(`${shape.padEnd(5)} UPDATE at (${plane.x},${plane.y}), MOVE to (${next.x},${next.y}) -> page's hotspot ${fmt(host.hot())}`);
      plane = next; shown = shape;
    };
    for (const [shape, x, y] of [["arrow", 600, 600], ["arrow", 590, 640], ["arrow", 300, 400], ["arrow", 18, 500], ["hand", 22, 502], ...extra]) commit(shape, { x, y });
    return { host, trace };
  };
  const a = run("legacy");
  say("1. Case E (predictions.txt, written before any run): the arrow resolves; a jump to just left of the button; one step of (4,2) onto it, the hand arriving with that step");
  for (const t of a.trace) say(`     ${t}`);
  say(`   the controller's CSS cursor for the hand: hotspot ${fmt(a.host.css())}; truth (9,4) -> ${isWrong(a.host.css(), SHAPES.hand.hot) ? "WRONG" : "ok"}   [predicted (5,3)]`);
  const more = [["hand", 60, 510], ["hand", 100, 520], ["hand", 140, 505], ["hand", 93, 516]];
  say(`   after four more scattered moves inside the button (the worker's own points): ${fmt(run("legacy", more).host.css())} — a resolved image is never revisited`);
  say(`   the same pointer path on a device whose update carries the new image's own position: ${fmt(run("ideal", more).host.css())}`);
  say();
}

// ── sessions ───────────────────────────────────────────────────────────────────────────────────
function approachSession(start, end, ms, hz, wander = []) {
  const sends = [{ t: 0, x: 450, y: 700 }]; let t = 1500;
  sends.push(...glide(t, { x: 450, y: 700 }, { x: 380, y: 640 }, 400, hz)); t += 400 + 800 + 1600;
  sends.push(...glide(t, { x: 380, y: 640 }, start, 500, hz)); t += 500 + 800;
  sends.push(...glide(t, start, end, ms, hz)); t += ms + 300;
  const marks = [{ t: t + 1500, name: "at rest" }]; t += 1600;
  let p = end; for (const to of wander) { sends.push(...glide(t, p, to, 300, hz)); t += 300 + 500; p = to; }
  return { sends, marks };
}

// ── 2. the replica decides like the real controller ────────────────────────────────────────────
{
  let same = 0; let n = 0;
  for (let seed = 1; seed <= 150; seed += 1) {
    const r = rng(seed * 2654435761); const end = { x: 34 + Math.floor(r() * 118), y: 497 + Math.floor(r() * 38) };
    const angle = r() * 2 * Math.PI; const dist = 40 + r() * 200;
    const start = { x: Math.min(780, Math.max(2, Math.round(end.x + Math.cos(angle) * dist))), y: Math.min(790, Math.max(465, Math.round(end.y + Math.sin(angle) * dist))) };
    const wander = [0, 1, 2].map(() => ({ x: 34 + Math.floor(r() * 118), y: 497 + Math.floor(r() * 38) }));
    const { sends } = approachSession(start, end, 250 + r() * 900, 60, wander);
    const a = simulate(new RealController(), sends, timing(seed)).first; const b = simulate(new Replica(), sends, timing(seed)).first;
    n += 1; if (JSON.stringify(a) === JSON.stringify(b)) same += 1;
  }
  say(`2. replica == real controller on ${same}/${n} random sessions (first hotspot answered for every image)`);
  say();
}

// ── 3. how often: one straight min-jerk glide from the page body onto the button ───────────────
say("3. one straight min-jerk glide from the page body onto the button (random start in the body, random end on the button, 0.25-1.15 s),");
say("   the image changing 60-300 ms after the guest pointer crossed the edge; then three short glides inside the button");
for (const cfg of [
  { name: "device as recorded, 60 Hz", order: "legacy", hz: 60 },
  { name: "device as recorded, 100 Hz", order: "legacy", hz: 100 },
  { name: "update carries the new position, 60 Hz", order: "ideal", hz: 60 },
  { name: "update carries the new position, 100 Hz", order: "ideal", hz: 100 },
]) {
  let total = 0; let wrongRest = 0; let nullRest = 0; let wrongEnd = 0; let worst = { err: 0 };
  for (let seed = 1; seed <= 6000; seed += 1) {
    const r = rng(seed * 40503); const end = { x: 34 + Math.floor(r() * 118), y: 497 + Math.floor(r() * 38) };
    const angle = r() * 2 * Math.PI; const dist = 40 + r() * 260;
    const start = { x: Math.round(end.x + Math.cos(angle) * dist), y: Math.round(end.y + Math.sin(angle) * dist) };
    const ms = 250 + r() * 900; const wander = [0, 1, 2].map(() => ({ x: 34 + Math.floor(r() * 118), y: 497 + Math.floor(r() * 38) }));
    if (start.x < 2 || start.x > 780 || start.y < 465 || start.y > 790 || LAYOUT(start.x, start.y) !== "arrow") continue;
    const { sends, marks } = approachSession(start, end, ms, cfg.hz, wander);
    const s = simulate(new Replica(), sends, { ...timing(seed), order: cfg.order, marks });
    total += 1; const rest = s.reads["at rest"]; const hand = s.first.hand ?? null;
    if (rest.shape === "hand" && rest.hot === null) nullRest += 1;
    if (rest.shape === "hand" && isWrong(rest.hot, SHAPES.hand.hot)) wrongRest += 1;
    if (isWrong(hand, SHAPES.hand.hot)) { wrongEnd += 1; const err = Math.max(Math.abs(hand.x - 9), Math.abs(hand.y - 4)); if (err > worst.err) worst = { err, hand, start, end, ms: Math.round(ms) }; }
  }
  say(`   ${cfg.name.padEnd(40)} ${total} glides: hand WRONG at rest ${wrongRest} (${(100 * wrongRest / total).toFixed(1)} %), still unanswered at rest ${nullRest} (${(100 * nullRest / total).toFixed(1)} %), WRONG at the end ${wrongEnd} (${(100 * wrongEnd / total).toFixed(1)} %)${worst.err ? `; worst ${fmt(worst.hand)}` : ""}`);
}
say();

// ── 4. predictions for the browser plans ───────────────────────────────────────────────────────
function planSession(file) {
  const plan = JSON.parse(readFileSync(path.join(here, file), "utf8")); const sends = []; const marks = []; let t = 0; let at = null;
  for (const step of plan.steps) {
    if (step.op === "jump") { sends.push({ t, x: step.to[0], y: step.to[1] }); at = { x: step.to[0], y: step.to[1] }; }
    else if (step.op === "glide") { const to = { x: step.to[0], y: step.to[1] }; sends.push(...glide(t, at, to, step.ms, step.hz ?? 100)); t += step.ms; at = to; }
    else if (step.op === "read") { t += step.settleMs ?? 1500; marks.push({ t, name: step.name }); t += 400; }
    t += step.restMs ?? 0;
  }
  return { sends, marks, names: plan.steps.filter((s) => s.op === "read").map((s) => s.name) };
}
say("4. what the model says the page shows at each `read` of the browser plans (60 timing draws each: image change 60-300 ms after the crossing, guest 4-14 ms behind)");
for (const file of ["plan-approach-from-right.json", "plan-approach-A.json", "plan-approach-C.json"]) {
  const { sends, marks, names } = planSession(file);
  say(`   ${file}`);
  for (const name of names.filter((n) => /^hand/.test(n))) {
    const tally = {};
    for (let j = 0; j < 60; j += 1) { const s = simulate(new Replica(), sends, { ...timing(j + 1), marks }); const k = fmt(s.reads[name].hot); tally[k] = (tally[k] ?? 0) + 1; }
    say(`      ${name}: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} x${v}`).join(", ")}`);
  }
}
say();
writeFileSync(path.join(here, "attacks-legacy-order.log"), `${lines.join("\n")}\n`);
