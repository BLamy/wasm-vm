#!/usr/bin/env node
// E5-T36a verifier — replay a recorded device/page event log (DIR/events.json from
// continuous-path-browser.mjs --instrument: S = position the page noted, U = UPDATE_CURSOR,
// M = MOVE_CURSOR, each with the image id and the controller's inferred hotspot after the event)
// through the real CursorHotspotEstimator, making the calls the controller makes
// (cursor-controller.js:370, 388-410). It checks that the replay reproduces the hotspot the page
// logged after every event, and prints the candidate sets around each image's first answer.
//
//   node evidence/e5-t36a/verifier/replay-events.mjs DIR/events.json [--truth IMG=X,Y ...]
import { readFileSync } from "node:fs";
import { CursorHotspotEstimator } from "../../../web/src/sink/cursor-hotspot.js";

const [file, ...rest] = process.argv.slice(2);
const events = JSON.parse(readFileSync(file, "utf8"));
const e = new CursorHotspotEstimator(); let key = null; let hot = null;
const fmt = (h) => (h ? `(${h.x},${h.y})` : "null");
const cands = (k) => (e._images.get(k)?.candidates ?? []).map((c) => `${c.x},${c.y}`).join(" ");
const infer = (ev) => { const h = e.noteMove(key, 64, 64, ev.x >>> 0, ev.y >>> 0); if (h === null || (h.x === 0 && h.y === 0)) return; hot = h; };
let mismatches = 0; let compared = 0; const firstAnswer = new Map(); const lines = [];
events.forEach((ev, index) => {
  if (ev.k === "S") { e.notePointer(ev.x, ev.y); lines.push(`#${index} t=${ev.t} S (${ev.x},${ev.y})`); return; }
  if (ev.k === "U") { key = ev.img; hot = e.hotspot(key); if (hot === null) infer(ev); }
  else if (key !== null && hot === null) infer(ev);
  const logged = ev.hot ? { x: ev.hot[0], y: ev.hot[1] } : null;
  const mine = hot && !(hot.x === 0 && hot.y === 0) ? hot : (hot ?? null);
  compared += 1;
  if (fmt(logged) !== fmt(mine) && !(logged === null && mine && mine.x === 0 && mine.y === 0)) mismatches += 1;
  lines.push(`#${index} t=${ev.t} ${ev.k} img ${ev.img} plane (${ev.x},${ev.y}) -> page ${fmt(logged)} replay ${fmt(mine)}  candidates [${cands(key)}]`);
  if (mine && !firstAnswer.has(key)) firstAnswer.set(key, { index, hot: { ...mine } });
});
console.log(`${events.length} events (${events.filter((x) => x.k === "S").length} sent, ${events.filter((x) => x.k === "U").length} updates, ${events.filter((x) => x.k === "M").length} moves)`);
console.log(`replay vs the hotspot the page logged after each cursor event: ${compared - mismatches}/${compared} equal`);
// Every update arrives at the plane position of the event before it.
let stale = 0; let updates = 0; let prev = null; let changes = 0; let prevImg = null;
for (const ev of events) {
  if (ev.k === "S") continue;
  if (ev.k === "U") { updates += 1; if (prev && prev.x === ev.x && prev.y === ev.y) stale += 1; if (prevImg !== null && ev.img !== prevImg) changes += 1; prevImg = ev.img; }
  prev = ev;
}
console.log(`updates that carry the previous event's plane position: ${stale}/${updates}; image changes: ${changes}`);
for (const [img, first] of firstAnswer) {
  console.log(`\nimage ${img}: first answer ${fmt(first.hot)} at event #${first.index}`);
  const from = Math.max(0, first.index - 14);
  for (const line of lines.slice(from, first.index + 2)) console.log(`   ${line.length > 260 ? `${line.slice(0, 260)}…` : line}`);
}
for (const arg of rest) {
  const m = /^(\w+)=(\d+),(\d+)$/.exec(arg); if (!m) continue;
  const got = e.hotspot(m[1]);
  console.log(`\ntruth for ${m[1]} is (${m[2]},${m[3]}); estimator holds ${fmt(got)}${got && (Math.abs(got.x - m[2]) > 1 || Math.abs(got.y - m[3]) > 1) ? "  <-- WRONG" : ""}`);
}
