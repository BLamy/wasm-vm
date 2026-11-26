#!/usr/bin/env node
// E5-T36a verifier round 4: read a run of plan-r4-kernel-drop.json (browser-r4.mjs --instrument).
// For each trial: where the kernel's cursor plane was at rest on P (a), after relative motion
// (b), after the return to the same page point (c, d), what the page concluded and showed, and
// what the drawn tip was off by after two more positions (e).
//   node analyze-kernel-drop.mjs DIR
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const result = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8"));
const log = JSON.parse(readFileSync(path.join(dir, "events.json"), "utf8"));
const ARROW = "9zFk9QAAAABJRU5ErkJggg=="; const TRUTH = [1, 1];
const J = (v) => JSON.stringify(v);
const pl = (p) => (p?.plane ? [p.plane.x, p.plane.y] : null);
console.log(`run: ${result.browser}, session restart ${result.sessionRestartSeconds} s, ran ${result.ran}, errors ${J(result.errors)}, cursor diagnostics ${J(result.cursorDiagnostics)}`);
console.log(`the page's own pointer-mode toggle: ${J(result.ui)}`);
console.log(`timeline: ${J(result.timeline)}`);
const trials = [...new Set(result.probes.map((p) => p.trial))];
const summary = [];
for (const name of trials) {
  const probes = Object.fromEntries(result.probes.filter((p) => p.trial === name).map((p) => [p.label[0], p]));
  const { a, b, c, d, e, f } = probes;
  console.log(`\n${name}`);
  for (const p of result.probes.filter((x) => x.trial === name)) {
    const tip = p.plane && p.css?.hotspot && p.sent ? [p.plane.x + p.css.hotspot[0] - p.sent[0], p.plane.y + p.css.hotspot[1] - p.sent[1]] : null;
    console.log(`  ${p.label.padEnd(44)} t=${p.t} mode=${p.pointer.mode} plane=${J(pl(p))} lastSent=${J(p.sent)} image=${p.css?.imageTail === ARROW ? "arrow" : p.css?.imageTail ?? p.css?.raw} css=${J(p.css?.hotspot ?? null)} inferred=${J(p.inferred)} settling=${p.settling} tip-sent=${J(tip)} idle=${p.idleSleeps}`);
  }
  if (!b || !c) continue;
  const base = a ? pl(a) : null;                      // T1 has no probe at rest on P
  const moved = base && pl(b) ? [pl(b)[0] - base[0], pl(b)[1] - base[1]] : null;
  const returned = pl(c) && pl(b) ? [pl(c)[0] - pl(b)[0], pl(c)[1] - pl(b)[1]] : null;
  const expectedWrong = c.sent && pl(c) ? [c.sent[0] - pl(c)[0], c.sent[1] - pl(c)[1]] : null;   // last sent - plane
  // the events between the two mode changes and the next probe
  const from = b.t; const to = d?.t ?? c.t;
  const ev = log.filter((x) => x.t >= from && x.t <= to);
  const S = ev.filter((x) => x.k === "S"); const C = ev.filter((x) => x.k === "C"); const H = ev.filter((x) => x.k === "H");
  const M = ev.filter((x) => x.k === "M");
  const firstS = S[0]; const settled = C.find((x) => x.r === true && firstS && x.t >= firstS.t);
  const movesAfterSettle = settled ? M.filter((x) => x.t >= settled.t) : [];
  console.log(`  relative motion moved the plane by ${J(moved)}; the return moved it by ${J(returned)}; "last sent - plane" after the return = ${J(expectedWrong)} (arrow's hotspot: ${J(TRUTH)})`);
  console.log(`  events b..d: positions noted ${J(S.map((x) => [x.t, x.x, x.y, x.m]))}; "caught up" ${J(C.map((x) => [x.t, x.r]))}; moves after it ${J(movesAfterSettle.slice(0, 4).map((x) => [x.t, x.x, x.y, x.st]))}${movesAfterSettle.length > 4 ? ` … ${movesAfterSettle.length}` : ""}; answers shown ${J(H.map((x) => [x.t, x.hot]))}`);
  const off = (h) => (h ? Math.max(Math.abs(h[0] - TRUTH[0]), Math.abs(h[1] - TRUTH[1])) : null);
  const row = { trial: name, planeMovedByRelative: moved, planeMovedByReturn: returned, settlingAtC: c.settling, shownAtC: c.inferred, shownAtD: d?.inferred ?? null, shownAtE: e?.inferred ?? null,
    tipErrorAtE: e?.plane && e.css?.hotspot && e.sent ? [e.plane.x + e.css.hotspot[0] - e.sent[0], e.plane.y + e.css.hotspot[1] - e.sent[1]] : null, shownAtF: f?.inferred ?? null,
    wrongAtRest: [c.inferred, d?.inferred, e?.inferred].some((h) => off(h) > 1), wrongAtF: off(f?.inferred) > 1 };
  summary.push(row);
}
console.log("\nSUMMARY");
for (const r of summary) console.log(J(r));
