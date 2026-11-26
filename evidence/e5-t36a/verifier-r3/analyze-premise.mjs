#!/usr/bin/env node
// E5-T36a verifier round 3: hold the instrumented device log (events.json written by
// premise-browser-r3.mjs --instrument) against THE PREMISE of the rework:
//
//   "the idle count moved on after the question"  =>  "the guest has acted on every position
//   sent before the question, and its cursor plane is where it will stay".
//
// For every conclusion C with r === true:
//   stood   — the last cursor MOVE before C, plus the TRUE hotspot of the image shown, is within
//             a pixel of the last position sent before the question (or of one sent between the
//             question and the conclusion: the guest may be ahead of the question, never behind);
//   late    — after C and before the next position is sent, a MOVE takes the plane somewhere
//             else. With the same image: a move for an earlier position that arrived AFTER the
//             conclusion — a violation. Preceded by an UPDATE installing another image: the
//             client changed its cursor (the claim's limit 2), not a violation.
// Also counted: MOVEs that re-report an unchanged plane position after a newer position was
// sent (the precondition of my P3), and what each rest conclusion led to.
//
//   node analyze-premise.mjs DIR [--phases]
import { readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const log = JSON.parse(readFileSync(path.join(dir, "events.json"), "utf8"));
let result = null; try { result = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8")); } catch { /* optional */ }
const TRUTH = { "9zFk9QAAAABJRU5ErkJggg==": ["arrow", [1, 1]], "rPsb6QAAAABJRU5ErkJggg==": ["hand", [9, 4]], "d5f44QAAAABJRU5ErkJggg==": ["caret", [4, 8]] };
const near = (a, b, tol = 1) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

// Phase of a page time, from the plan's steps (resets carry the approach's name).
const marks = (result?.steps ?? []).filter((s) => s.op === "reset" && s.name).map((s) => [s.t, String(s.name).replace(/\.\d+$/, "")]);
const phaseAt = (t) => { let p = "start"; for (const [at, name] of marks) { if (at <= t) p = name; else break; } return p; };

const questions = new Map();
const counts = { S: 0, U: 0, M: 0, Q: 0, N: 0, C: 0, H: 0 };
for (const e of log) counts[e.k] = (counts[e.k] ?? 0) + 1;
const byPhase = {};
const tally = (phase, key, n = 1) => { byPhase[phase] ??= {}; byPhase[phase][key] = (byPhase[phase][key] ?? 0) + n; };

// Walk the log in order, keeping what the device last said.
let lastS = null; let lastSIndex = -1; let lastM = null; let image = null;
const violations = []; const notStood = []; const imageChangeAfter = []; const conclusions = [];
let staleRereports = 0; let movesTotal = 0; let sSinceLastM = [];
for (let i = 0; i < log.length; i += 1) {
  const e = log[i];
  if (e.k === "S") { lastS = [e.x, e.y]; lastSIndex = i; sSinceLastM.push([e.x, e.y]); }
  else if (e.k === "U") { image = e.img; }
  else if (e.k === "M") {
    movesTotal += 1;
    if (lastM && lastM.x === e.x && lastM.y === e.y && lastM.img === e.img && sSinceLastM.some((s) => s[0] !== lastM.sx || s[1] !== lastM.sy)) {
      // the plane is re-reported where it was although something newer has been sent since
      const truth = TRUTH[e.img]?.[1];
      if (truth && !sSinceLastM.some((s) => near([e.x + truth[0], e.y + truth[1]], s))) { staleRereports += 1; tally(phaseAt(e.t), "stale re-reports"); }
    }
    lastM = { x: e.x, y: e.y, img: e.img, t: e.t, i, sx: lastS?.[0], sy: lastS?.[1] }; sSinceLastM = [];
  } else if (e.k === "Q") { questions.set(e.q, { ...e, i, lastS, lastSIndex }); }
  else if (e.k === "C") {
    const q = questions.get(e.q); if (!q) continue;
    const phase = phaseAt(q.t);
    tally(phase, `${q.why} questions`);
    tally(phase, `${q.why} -> ${e.r}`);
    if (e.r !== true) continue;
    const sentBetween = log.slice(q.i, i).filter((x) => x.k === "S").map((x) => [x.x, x.y]);
    const entry = { q: e.q, why: q.why, phase, tq: q.t, tc: e.t, ms: Math.round(e.t - q.t), lastSentBeforeQ: q.lastS, sentBetween: sentBetween.length, plane: lastM ? [lastM.x, lastM.y] : null, img: lastM?.img ?? null, live: e.live };
    conclusions.push(entry);
    const truth = TRUTH[lastM?.img]?.[1];
    if (!lastM || !truth || !q.lastS) { entry.stood = "unverifiable"; tally(phase, "conclusions unverifiable (unknown image / nothing sent)"); }
    else {
      const guest = [lastM.x + truth[0], lastM.y + truth[1]];
      entry.guest = guest;
      entry.stood = near(guest, q.lastS) || sentBetween.some((s) => near(guest, s));
      tally(phase, entry.stood ? "conclusions: plane stood for the last position" : "conclusions: PLANE BEHIND");
      if (!entry.stood) notStood.push(entry);
    }
    // After the conclusion, until the next sent position: does the plane move?
    let installed = false;
    for (let j = i + 1; j < log.length; j += 1) {
      const x = log[j];
      if (x.k === "S") break;
      if (x.k === "U" && x.img !== (lastM?.img ?? null)) installed = true;
      if (x.k === "M" && lastM && (x.x !== lastM.x || x.y !== lastM.y)) {
        const item = { ...entry, moveAt: x.t, afterMs: Math.round(x.t - e.t), to: [x.x, x.y], toImg: x.img };
        if (sentBetween.length === 0 && !installed && x.img === lastM.img) { violations.push(item); tally(phase, "LATE MOVE after a conclusion (same image, nothing sent)"); }
        else if (installed || x.img !== lastM.img) { imageChangeAfter.push(item); tally(phase, "image changed after a conclusion (limit 2)"); }
        else tally(phase, "move after a conclusion for a position sent during the question");
        break;
      }
    }
  }
}
// What did each rest conclusion lead to? (an H right after the C, before any other event)
let restAnswers = 0;
for (let i = 0; i < log.length; i += 1) if (log[i].k === "C" && log[i].r === true && log[i + 1]?.k === "H" && log[i + 1].hot) restAnswers += 1;

const trueC = conclusions.length;
console.log(`log ${dir}: ${log.length} entries ${JSON.stringify(counts)}`);
console.log(`conclusions "caught up": ${trueC} (rest ${conclusions.filter((c) => c.why === "rest").length}, restart ${conclusions.filter((c) => c.why === "restart").length}); answered at rest right after: ${restAnswers}`);
const ver = conclusions.filter((c) => c.stood !== "unverifiable");
console.log(`  of ${ver.length} with a known image and a sent position: plane stood for the last position sent in ${ver.filter((c) => c.stood === true).length}, BEHIND in ${notStood.length}`);
console.log(`  LATE MOVES after a conclusion (same image, nothing sent since the question): ${violations.length}`);
console.log(`  image changed after a conclusion, then moved (limit 2): ${imageChangeAfter.length}`);
const waits = conclusions.map((c) => c.ms).sort((a, b) => a - b);
if (waits.length) console.log(`  question -> conclusion: median ${waits[waits.length >> 1]} ms, p90 ${waits[Math.floor(waits.length * 0.9)]} ms, max ${waits.at(-1)} ms`);
console.log(`moves ${movesTotal}; re-reports of an unchanged plane position while a newer position had been sent and not acted on: ${staleRereports}`);
for (const v of violations.slice(0, 20)) console.log("  VIOLATION", JSON.stringify(v));
for (const v of notStood.slice(0, 20)) console.log("  BEHIND   ", JSON.stringify(v));
for (const v of imageChangeAfter.slice(0, 6)) console.log("  image-change", JSON.stringify({ q: v.q, why: v.why, phase: v.phase, afterMs: v.afterMs, img: TRUTH[v.img]?.[0] ?? v.img, toImg: TRUTH[v.toImg]?.[0] ?? v.toImg, plane: v.plane, to: v.to }));
if (process.argv.includes("--phases")) {
  console.log("by phase:");
  for (const [phase, t] of Object.entries(byPhase)) console.log(`  ${phase.padEnd(12)} ${Object.entries(t).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
}
