#!/usr/bin/env node
// E5-T36a verifier round 3: for a run of plan-r3-stale.json (instrumented), what happened after
// each reset: was the plane re-reported where it stood AFTER the first new position was sent
// (and before the guest acted on it), and what did the page show for the arrow afterwards?
//   node analyze-stale.mjs DIR
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const log = JSON.parse(readFileSync(path.join(dir, "events.json"), "utf8"));
const result = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8"));
const ARROW = "9zFk9QAAAABJRU5ErkJggg=="; const truth = [1, 1];
const resets = result.steps.filter((s) => s.op === "reset").map((s) => ({ t: s.t, name: s.name }));
const rows = []; const tally = {};
for (let k = 0; k < resets.length; k += 1) {
  const from = resets[k].t; const to = resets[k + 1]?.t ?? Infinity;
  const ev = log.filter((e) => e.t >= from && e.t < to);
  const phase = resets[k].name.replace(/\.\d+$/, "");
  const firstS = ev.findIndex((e) => e.k === "S");
  if (firstS < 0) continue;
  // the plane as last reported before the reset
  const before = [...log].reverse().find((e) => e.k === "M" && e.t < from);
  const settleEnd = ev.find((e) => e.k === "C" && e.r === true)?.t ?? null;
  const movesBeforeFirstS = ev.slice(0, firstS).filter((e) => e.k === "M" && settleEnd !== null && e.t >= settleEnd && e.st === false).length;
  // moves after the first S that leave the plane where it stood, before the first move elsewhere
  let stale = 0; let lag = null;
  for (let i = firstS + 1; i < ev.length; i += 1) {
    const e = ev[i];
    if (e.k !== "M") continue;
    if (before && e.x === before.x && e.y === before.y) { if (e.st === false) stale += 1; } else { lag = ev.slice(firstS, i).filter((x) => x.k === "S").length; break; }
  }
  const answers = ev.filter((e) => e.k === "H" && e.hot && e.img === ARROW).map((e) => e.hot);
  const wrong = answers.filter((h) => Math.abs(h[0] - truth[0]) > 1 || Math.abs(h[1] - truth[1]) > 1);
  const final = [...ev].reverse().find((e) => (e.k === "M" || e.k === "U") && e.img === ARROW)?.hot ?? null;
  rows.push({ name: resets[k].name, settledBeforeFirstS: settleEnd !== null && settleEnd < ev[firstS].t, movesBetweenSettleAndFirstS: movesBeforeFirstS, staleAfterFirstS: stale, sentBeforeGuestFirstMoved: lag, answers, wrong, final });
  tally[phase] ??= { trials: 0, staleReReportTaken: 0, wrongShown: 0, wrongAtEnd: 0, noneAtEnd: 0 };
  tally[phase].trials += 1; if (stale > 0 && movesBeforeFirstS === 0) tally[phase].staleReReportTaken += 1; if (wrong.length) tally[phase].wrongShown += 1;
  if (final === null) tally[phase].noneAtEnd += 1; else if (Math.abs(final[0] - truth[0]) > 1 || Math.abs(final[1] - truth[1]) > 1) tally[phase].wrongAtEnd += 1;
}
for (const r of rows) console.log(JSON.stringify(r));
console.log(JSON.stringify(tally, null, 1));
console.log("timeline:", JSON.stringify(result.timeline));
console.log("reads:", JSON.stringify(result.reads.reduce((a, r) => { const k = `${r.phase} ${r.verdict}`; a[k] = (a[k] ?? 0) + 1; return a; }, {})));
for (const r of result.reads.filter((x) => x.verdict === "WRONG")) console.log("WRONG READ", r.name, JSON.stringify(r.answer), "sent", JSON.stringify(r.sent));
