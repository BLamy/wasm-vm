#!/usr/bin/env node
// E5-T36a verifier (round 2): replay a recorded page/device event log (S = position the page
// sent, U = cursor update, M = cursor move; page timestamps in ms) through the NEW
// CursorController, its rest timer driven from the recorded timestamps, and report every hotspot
// the page would have shown, per image, against the truth.
//
//   node replay-log.mjs EVENTS.json [--label-by-truth] [--size 64] [--verbose]
//
// --label-by-truth: the log's `img` column is unusable (round 1's `natural` log): image identity
// is reconstructed per run of one resource id, as the known hotspot that explains most of the
// run's moves. (Every image change in the log that has a usable column comes with a change of
// resource id.)
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { makeRig } from "./harness.mjs";

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: {
  "label-by-truth": { type: "boolean", default: false }, size: { type: "string", default: "64" }, verbose: { type: "boolean", default: false },
  // result.json of the run the log came from: its `reset` steps (window.__cursor.resetHotspotInference()) are replayed at their page times.
  resets: { type: "string" },
  // Feed updates too? never: this is the page as built. (--old-order-check prints what a naive reading would give.)
} });
const events = JSON.parse(readFileSync(positionals[0], "utf8"));
const TRUTH = { arrow: [1, 1], hand: [9, 4], caret: [4, 8] };
// round 1's logs name an image by an FNV hash of its data URL, this round's by the URL's last 24 characters.
const BY_HASH = { dae41499: "arrow", effa3871: "hand", "3554aee5": "caret",
  "9zFk9QAAAABJRU5ErkJggg==": "arrow", "rPsb6QAAAABJRU5ErkJggg==": "hand", "d5f44QAAAABJRU5ErkJggg==": "caret" };
const near = (a, b, t = 1) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t;

// ── image labels ──
const labels = new Array(events.length).fill(null);
if (!opt["label-by-truth"]) {
  for (let i = 0; i < events.length; i += 1) if (events[i].k !== "S") {
    labels[i] = BY_HASH[events[i].img] ?? null;
    if (!labels[i]) throw new Error(`unknown image ${events[i].img} at #${i}`);
  }
} else {
  // Runs of one resource id (split at updates).
  const runs = []; let run = null; const sent = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.k === "S") { sent.push([e.x, e.y]); if (sent.length > 128) sent.shift(); continue; }
    if (e.k === "U" && (!run || run.rid !== e.rid)) { run = { rid: e.rid, idx: [], score: { arrow: 0, hand: 0, caret: 0 }, moves: 0 }; runs.push(run); }
    run.idx.push(i);
    if (e.k === "M") {
      run.moves += 1;
      for (const [name, hot] of Object.entries(TRUTH)) if (sent.some((s) => near([s[0] - e.x, s[1] - e.y], hot))) run.score[name] += 1;
    }
  }
  let previous = "arrow";
  for (const r of runs) {
    const ranked = Object.entries(r.score).sort((a, b) => b[1] - a[1]);
    // A run with no explained move (before the first sent position) keeps the label before it.
    r.label = ranked[0][1] === 0 ? previous : (ranked[0][1] === ranked[1][1] && [ranked[0][0], ranked[1][0]].includes(previous) ? previous : ranked[0][0]);
    r.ambiguous = ranked[0][1] === ranked[1][1] && ranked[0][1] > 0;
    previous = r.label;
    for (const i of r.idx) labels[i] = r.label;
  }
  console.log(`labels by truth: ${runs.length} runs of one resource id; ${runs.filter((r) => r.ambiguous).length} ambiguous (kept the label before them)`);
  if (opt.verbose) for (const r of runs) console.log(`  run rid ${r.rid} #${r.idx[0]}..#${r.idx.at(-1)} moves ${r.moves} ${JSON.stringify(r.score)} -> ${r.label}${r.ambiguous ? " (ambiguous)" : ""}`);
}

// ── device-order statistics (independent of the controller) ──
{
  let updates = 0, updatesAtPrevious = 0, moves = 0, explained = 0, lagMsMax = 0; const lagPositions = new Map(); const unexplained = [];
  let plane = null; const sent = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.k === "S") { sent.push({ x: e.x, y: e.y, t: e.t }); continue; }
    if (e.k === "U") { updates += 1; if (plane && plane[0] === e.x && plane[1] === e.y) updatesAtPrevious += 1; plane = [e.x, e.y]; continue; }
    moves += 1; plane = [e.x, e.y];
    if (sent.length === 0) continue;
    const hot = TRUTH[labels[i]];
    let found = -1;
    for (let j = sent.length - 1; j >= 0 && j >= sent.length - 400; j -= 1) if (near([sent[j].x - e.x, sent[j].y - e.y], hot)) { found = j; break; }
    if (found < 0) { unexplained.push(i); continue; }
    explained += 1;
    const behind = sent.length - 1 - found;
    lagPositions.set(behind, (lagPositions.get(behind) ?? 0) + 1);
    // Lag in time: how long ago the NEXT position after the matched one was sent (0 if none).
    if (behind > 0) lagMsMax = Math.max(lagMsMax, e.t - sent[found + 1].t);
  }
  console.log(`device order: ${updates} updates, ${updatesAtPrevious} at the plane position of the event before; ${moves} moves, ` +
    `${explained} = (a sent position) - (true hotspot of the image shown) within a pixel, ${unexplained.length} not` +
    `${unexplained.length ? ` (#${unexplained.slice(0, 12).join(", #")}${unexplained.length > 12 ? ", …" : ""})` : ""}`);
  console.log(`  positions the plane was behind at a move (latest match): ${[...lagPositions].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  longest time a move trailed the next sent position: ${lagMsMax.toFixed(1)} ms`);
}

// ── the replay ──
const rig = makeRig({ size: Number(opt.size) });
const shownHot = new Map(); // image -> [{hot, t, why}]
let wrong = 0, checks = 0; const wrongRows = [];
let lastSent = null, lastPlane = null, sinceInstallMoves = 0;
const restReport = [];
function record(why, t) {
  const image = rig.shown; if (!image) return;
  const hot = rig.hot(); const css = rig.css();
  if (JSON.stringify(hot ?? [0, 0]) !== JSON.stringify(css)) throw new Error(`css ${JSON.stringify(css)} does not show inferred ${JSON.stringify(hot)} at ${t}`);
  const list = shownHot.get(image) ?? []; shownHot.set(image, list);
  const key = JSON.stringify(hot);
  if (list.at(-1)?.key !== key) list.push({ key, hot, t, why });
  if (hot !== null) { checks += 1; if (!near(hot, TRUTH[image])) { wrong += 1; if (wrongRows.length < 40) wrongRows.push(`  WRONG t=${t} ${image} shows ${key} (${why})`); } }
}
rig.onRest = (t) => {
  // What was true when the page declared rest.
  const image = rig.shown; const truth = TRUTH[image];
  const onLast = lastSent && lastPlane ? near([lastSent[0] - lastPlane[0], lastSent[1] - lastPlane[1]], truth) : null;
  restReport.push({ t, image, answer: rig.hot(), planeOnLastSent: onLast, movesSinceInstall: sinceInstallMoves });
  record("rest", t);
};
let previousLabel = null; let pageLooks = 0, pageDiffers = 0;
const resets = opt.resets ? JSON.parse(readFileSync(opt.resets, "utf8")).steps.filter((step) => step.op === "reset").map((step) => step.t) : [];
for (let i = 0; i < events.length; i += 1) {
  const e = events[i];
  while (resets.length && resets[0] <= e.t) { rig.at(resets.shift()); rig.controller.resetHotspotInference(); }
  rig.at(e.t);
  if (e.k === "S") { rig.S(e.x, e.y); lastSent = [e.x, e.y]; continue; }
  const label = labels[i];
  if (e.k === "U") { rig.U(label, e.x, e.y, e.rid); if (label !== previousLabel) sinceInstallMoves = 0; previousLabel = label; }
  else { rig.M(label, e.x, e.y, e.rid); lastPlane = [e.x, e.y]; sinceInstallMoves += 1; }
  record(`${e.k} #${i}`, e.t);
  // What the page itself showed after this event (logs of THIS round's instrumented runs carry it).
  if (opt.resets) { pageLooks += 1; if (JSON.stringify(e.hot ?? null) !== JSON.stringify(rig.hot())) { pageDiffers += 1; if (pageDiffers <= 5) console.log(`  page/replay differ at #${i} t=${e.t}: page ${JSON.stringify(e.hot)} replay ${JSON.stringify(rig.hot())}`); } }
}
if (opt.resets) console.log(`page vs replay: after ${pageLooks} cursor events the page's own inferred hotspot differs from the replay's on ${pageDiffers}`);
rig.wait(2000);
console.log(`replay: ${events.length} events, ${checks} looks at a shown answer, ${wrong} further than one pixel from the truth; diagnostics ${rig.diagnostics.length}`);
for (const row of wrongRows) console.log(row);
for (const [image, list] of shownHot) {
  console.log(`  ${image} (true ${JSON.stringify(TRUTH[image])}): ${list.map((x) => `${x.key}@${x.t}[${x.why}]`).join(" -> ")}`);
}
const fired = restReport.length;
const behind = restReport.filter((r) => r.planeOnLastSent === false);
console.log(`rest waits that fired with no answer yet: ${fired}; answered ${restReport.filter((r) => r.answer).length}; ` +
  `fired while the plane was NOT on the last sent position: ${behind.length}`);
for (const r of restReport) if (opt.verbose || r.planeOnLastSent === false || !r.answer) console.log(`  rest t=${r.t} ${r.image} answer ${JSON.stringify(r.answer)} planeOnLastSent=${r.planeOnLastSent} movesSinceInstall=${r.movesSinceInstall}`);
