// E5-T36a verifier round 5: what an `appear` run recorded (browser-r5.mjs, plan-r5-appear.json).
//   node analyze-appear.mjs DIR
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const r = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8"));
const ev = JSON.parse(readFileSync(path.join(dir, "events.json"), "utf8"));
const J = JSON.stringify;
console.log(`${dir}: ran ${r.ran}, mutant ${r.mutant ?? "none"}${r.mutantApplied ? " (applied in memory)" : ""}, ${r.browser}, first restart ${r.sessionRestartSeconds} s, ${r.swayEnv}`);
console.log(`errors ${J(r.errors)} diagnostics ${J(r.cursorDiagnostics)} events ${ev.length}`);
for (const s of r.steps.filter((x) => x.op === "session-stop" || x.op === "session-start" || x.op === "settle")) console.log(`step ${s.op} at t=${s.t}: ${J({ ...s, op: undefined, t: undefined })}`);
for (const s of r.shell) console.log(`sh  ${s.cmd.slice(0, 110)}\n    -> ${s.stdout.trim().slice(0, 200)}`);
console.log("\nprobes");
for (const p of r.probes) console.log(`  t=${String(p.t).padStart(9)} ${(p.trial ?? "").padEnd(4)} ${p.label.padEnd(52).slice(0, 52)} plane ${p.plane ? `${p.plane.x},${p.plane.y}` : "none   "} sent ${p.sent ? p.sent.join(",") : "-"} kind ${p.kind} inferred ${J(p.inferred)} settling ${p.settling} updates ${p.updates} moves ${p.moves}`);
console.log("\nreads");
for (const q of r.reads) console.log(`  t=${q.t} ${q.phase}: ${q.name}: image ${q.image} sent ${J(q.sent)} plane ${q.plane ? `${q.plane.x},${q.plane.y}` : "none"} answer ${J(q.answer)} settling ${q.settling} tip error ${J(q.tipError ?? null)} -> ${q.verdict}`);
console.log(`\ntimeline: ${J(r.timeline)}`);
// The device's own words: every cursor event with resource 0, and what came right before and after.
const cursor = ev.map((e, i) => ({ ...e, i })).filter((e) => e.k === "U" || e.k === "M");
const hides = cursor.filter((e) => e.rid === 0);
console.log(`\ncursor events: ${cursor.filter((e) => e.k === "U").length} updates, ${cursor.filter((e) => e.k === "M").length} moves; with resource 0: ${hides.filter((e) => e.k === "U").length} updates, ${hides.filter((e) => e.k === "M").length} moves; rejected: ${cursor.filter((e) => e.ok === false).length}`);
// Runs of hidden: first hide of a run and the first image after it.
let hidden = false; let n = 0;
for (let c = 0; c < cursor.length; c += 1) {
  const e = cursor[c];
  if (e.rid === 0 && !hidden) { hidden = true; n += 1; const before = cursor[c - 1];
    console.log(`  hide #${n}: event ${e.i} t=${e.t} ${e.k} rid 0 at ${e.x},${e.y} (before it: event ${before?.i} ${before?.k} rid ${before?.rid} at ${before?.x},${before?.y}; settling ${before?.st})`); }
  else if (e.rid !== 0 && hidden) { hidden = false; const next = cursor[c + 1];
    const between = ev.slice(hides.find((h) => h.i < e.i && h.i >= (cursor[c - 1]?.i ?? 0))?.i ?? 0, e.i).filter((x) => x.k === "S").length;
    console.log(`  shown again: event ${e.i} t=${e.t} ${e.k} rid ${e.rid} at ${e.x},${e.y}; settling after it ${e.st}; then event ${next?.i} ${next?.k} at ${next?.x},${next?.y} settling ${next?.st}`); }
}
// What the page showed (H events) with times.
console.log(`\nshown hotspot changes (H): ${ev.filter((e) => e.k === "H").map((e) => `t=${e.t} ${J(e.hot)}`).join("; ")}`);
// Questions and conclusions after each show.
const q = ev.filter((e) => e.k === "Q" || e.k === "C");
console.log(`questions ${q.filter((e) => e.k === "Q").length} (restart ${q.filter((e) => e.k === "Q" && e.why === "restart").length}, rest ${q.filter((e) => e.k === "Q" && e.why === "rest").length}); conclusions true ${q.filter((e) => e.k === "C" && e.r === true).length}, false ${q.filter((e) => e.k === "C" && e.r === false).length}, null ${q.filter((e) => e.k === "C" && e.r === null).length}`);
