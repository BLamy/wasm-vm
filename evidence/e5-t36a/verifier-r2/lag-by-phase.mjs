#!/usr/bin/env node
// E5-T36a verifier (round 2): how far behind the pointer the guest's cursor plane was, per phase
// of an instrumented run. For every position the page sent: the time until a cursor MOVE put the
// plane on it (or on a later position) = how long the plane was "behind" after that send.
//   node lag-by-phase.mjs DIR   (DIR/events.json, DIR/result.json)
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const events = JSON.parse(readFileSync(path.join(dir, "events.json"), "utf8"));
const steps = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8")).steps;
const TRUTH = { "9zFk9QAAAABJRU5ErkJggg==": [1, 1], "rPsb6QAAAABJRU5ErkJggg==": [9, 4], "d5f44QAAAABJRU5ErkJggg==": [4, 8] };
const near = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
// Phase boundaries: the `reset` steps carry the phase name in `name` ("L1 … .2").
const marks = steps.filter((s) => s.op === "reset").map((s) => ({ t: s.t, phase: String(s.name).split(".")[0].split(" ")[0] }));
const phaseAt = (t) => { let p = "before"; for (const m of marks) if (m.t <= t) p = m.phase; return p; };
const sent = []; const stats = new Map();
const stat = (p) => { if (!stats.has(p)) stats.set(p, { sends: 0, caught: [], gaps: [], restBehind: 0, quietBehind: [] }); return stats.get(p); };
let pending = []; // sends not yet covered by a move
let lastEventT = null; let lastCursorT = null;
for (const e of events) {
  if (e.k === "S") {
    // The page's rest wait would have fired at lastEventT + 300 if nothing happened until now.
    if (lastEventT !== null && e.t - lastEventT >= 300 && pending.length) stat(phaseAt(lastEventT)).restBehind += 1;
    sent.push(e); pending.push({ i: sent.length - 1, t: e.t }); stat(phaseAt(e.t)).sends += 1; lastEventT = e.t; continue;
  }
  if (lastCursorT !== null && pending.length) stat(phaseAt(e.t)).quietBehind.push(e.t - Math.max(lastCursorT, pending[0].t));
  if (lastEventT !== null && e.t - lastEventT >= 300 && pending.length) stat(phaseAt(lastEventT)).restBehind += 1;
  lastEventT = e.t; lastCursorT = e.t;
  if (e.k !== "M") continue;
  const hot = TRUTH[e.img]; if (!hot) continue;
  // The latest sent position this plane position stands for.
  let found = -1;
  for (let j = sent.length - 1; j >= Math.max(0, sent.length - 400); j -= 1) if (near([sent[j].x - e.x, sent[j].y - e.y], hot)) { found = j; break; }
  if (found < 0) continue;
  const still = [];
  for (const p of pending) { if (p.i <= found) stat(phaseAt(p.t)).caught.push(e.t - p.t); else still.push(p); }
  pending = still;
}
const q = (a, f) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))] : NaN);
console.log("phase     sends  ms from a send to the plane standing for it: median  p90   p99   max   | longest cursor silence while behind | rest waits (300 ms quiet) that would fire while behind");
for (const [p, s] of stats) {
  console.log(`${p.padEnd(8)} ${String(s.sends).padStart(6)}  ${" ".repeat(40)}${q(s.caught, 0.5).toFixed(0).padStart(6)} ${q(s.caught, 0.9).toFixed(0).padStart(5)} ${q(s.caught, 0.99).toFixed(0).padStart(5)} ${Math.max(...s.caught, 0).toFixed(0).padStart(5)}   | ${Math.max(...s.quietBehind, 0).toFixed(0).padStart(6)} ms${" ".repeat(26)}| ${s.restBehind}`);
}
