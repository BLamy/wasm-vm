// E5-T36a verifier round 5 — P7: is round 4's M1 still behaviour? Round 4's S1 (the size changes on
// ONE position, the pointer rests there, the guest idle; then an even run from that position
// with the plane re-reported before the first move, the guest one position behind), through
// harness-r5.mjs. Run against the sources and with SINK_DIR=<M1>.
import { makeRig, wrong, J, REST, HOTSPOT_POLL_MS, sinkDir } from "./harness-r5.mjs";
const out = { sink: sinkDir.replace(/^.*\/(web\/src\/sink|sinks\/[^/]+)$/, "$1") };
for (const [label, w, h] of [["rows 800 -> 801", 1280, 801], ["columns 1280 -> 1281", 1281, 800]]) {
  const r = makeRig(); await r.settle(); const g = r.guest;
  r.S(300, 400); g.act(1, "hand"); await r.wait(16);
  r.S(302, 400, w, h); g.act(); await r.wait(3 * HOTSPOT_POLL_MS);
  const settlingAfterTheSizePosition = r.settling();
  let x = 302; const shown = [];
  x += 6; r.S(x, 400, w, h); await r.wait(5); g.commit();
  for (let i = 1; i < 8; i += 1) { await r.wait(11); x += 6; r.S(x, 400, w, h); await r.wait(4); g.act(1); shown.push(r.hot()); }
  await r.wait(20); g.act(); const caughtUp = r.hot(); await r.wait(REST + 3000);
  const atRest = r.hot();
  r.S(420, 520, w, h); g.act(); await r.wait(REST);
  out[label] = { settlingAfterTheSizePosition, duringTheRun: shown.map((v) => J(v)).join(" "), caughtUp, atRest, afterOneMorePosition: r.hot(), wrongShown: wrong(r).map((v) => v.hot), sentHistory: r.estimator._sent.length };
}
console.log(J(out));
