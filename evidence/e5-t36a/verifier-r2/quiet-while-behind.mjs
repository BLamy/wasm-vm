#!/usr/bin/env node
// E5-T36a verifier (round 2): in an instrumented run's events.json, every stretch of at least
// MIN ms with neither a sent position nor a cursor event (what the page's rest wait measures)
// at whose end the plane was NOT on the last sent position (truth hotspot of the image shown).
//   node quiet-while-behind.mjs DIR/events.json [MIN=250]
import { readFileSync } from "node:fs";
const ev = JSON.parse(readFileSync(process.argv[2], "utf8")); const MIN = Number(process.argv[3] ?? 250);
const TRUTH = { "9zFk9QAAAABJRU5ErkJggg==": ["arrow", [1, 1]], "rPsb6QAAAABJRU5ErkJggg==": ["hand", [9, 4]], "d5f44QAAAABJRU5ErkJggg==": ["caret", [4, 8]] };
let last = null; let n = 0;
for (let i = 0; i < ev.length; i += 1) {
  const e = ev[i];
  if (last && e.t - last.t >= MIN) {
    let s = null, m = null;
    for (let j = i - 1; j >= 0 && (!s || !m); j -= 1) { if (ev[j].k === "S" && !s) s = ev[j]; if (ev[j].k === "M" && !m) m = ev[j]; }
    if (s && m) {
      const [name, hot] = TRUTH[m.img]; const d = [s.x - m.x - hot[0], s.y - m.y - hot[1]];
      if (Math.abs(d[0]) > 1 || Math.abs(d[1]) > 1) {
        n += 1;
        const inImage = s.x - m.x >= -1 && s.x - m.x < 65 && s.y - m.y >= -1 && s.y - m.y < 65;
        console.log(`quiet ${(e.t - last.t).toFixed(0)} ms, ended by #${i} (${e.k}) at t=${e.t}: ${name} shown, the page's answer for it ${JSON.stringify(m.hot)}; last sent (${s.x},${s.y}), plane (${m.x},${m.y}): ` +
          `the plane stands ${d} px from where the last sent position puts it; "last sent - plane" = (${s.x - m.x},${s.y - m.y}) is ${inImage ? "INSIDE" : "outside"} the 64 px image`);
      }
    }
  }
  last = e;
}
console.log(`${n} quiet stretches of >= ${MIN} ms with the plane behind`);
