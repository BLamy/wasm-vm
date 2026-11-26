// E5-T36a verifier round 4: for each of my mutants that the worker's tests do not notice and
// that is behaviour, the sequence that tells it from the code as written. Run once against the
// sources and once per mutant (SINK_DIR=<scratch copy with the one mutant applied>):
//   node mutants-r4-vs-my-attacks.mjs
import { makeRig, makeGuest, settleFirst, watch, wrongOf, J, HOTS, HOTSPOT_REST_MS, HOTSPOT_POLL_MS } from "./harness-r4.mjs";
const REST = HOTSPOT_REST_MS + 4 * HOTSPOT_POLL_MS;
const out = {};
// S1 — the size door: the output size changes on ONE position, the pointer rests there, the
// guest is idle; then an even run from that position, the plane re-reported before the first move.
{
  const r = watch(makeRig({ size: 64 })); r.hots = HOTS; r.plane = [0, 0]; const g = makeGuest(r);
  await settleFirst(r);
  g.send(300, 400, 1280, 800); g.act(1, "hand"); await r.wait(16);
  g.send(302, 400, 1280, 801); g.act(); await r.wait(3 * HOTSPOT_POLL_MS);      // the size change, on this position; idle after it
  const settled = !r.settling();
  let x = 302;
  x += 6; g.send(x, 400, 1280, 801); await r.wait(5); g.report();                 // the plane where it stands
  for (let i = 1; i < 8; i += 1) { await r.wait(11); x += 6; g.send(x, 400, 1280, 801); await r.wait(4); g.act(1); }
  await r.wait(20); g.act(); await r.wait(REST + 3000);
  out["S1 size change on one position at rest, then an even run"] = { settledBeforeTheRun: settled, wrongShown: wrongOf(r), atRest: r.hot() };
}
// S2 — the hook AFTER a mode change: the page is settling; the hook must leave that alone.
{
  const r = watch(makeRig({ size: 64 })); r.hots = HOTS; r.plane = [0, 0]; const g = makeGuest(r);
  await settleFirst(r);
  g.send(300, 400); g.act(1, "hand"); await r.wait(16);
  r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" });
  r.controller.resetHotspotInference();
  const settlingAfterHook = r.settling();
  let x = 300;
  x += 6; g.send(x, 400); await r.wait(5); g.report();
  for (let i = 1; i < 8; i += 1) { await r.wait(11); x += 6; g.send(x, 400); await r.wait(4); g.act(1); }
  await r.wait(20); g.act(); await r.wait(REST + 3000);
  out["S2 mode change, then the hook, then an even run from the rest position"] = { settlingAfterHook, wrongShown: wrongOf(r), atRest: r.hot() };
}
// S3 — a count that goes DOWN is not an idle wait (a guest replaced under the page, a counter reset).
{
  let n = 100;
  const r = watch(makeRig({ size: 64, counter: () => async () => { n -= 1; return n; } })); r.hots = HOTS; r.plane = [0, 0]; const g = makeGuest(r);
  g.send(300, 400); await r.wait(5000);
  out["S3 a count that goes down"] = { settling: r.settling() };
}
// S4 — an output that changes WIDTH only restarts too.
{
  const r = watch(makeRig({ size: 64 })); r.hots = HOTS; r.plane = [0, 0]; const g = makeGuest(r);
  await settleFirst(r);
  g.send(300, 400, 1280, 800); g.act(1, "hand"); await r.wait(16);
  g.send(306, 400, 1281, 800);
  out["S4 a width-only change of output size"] = { settlingRightAfter: r.settling() };
}
console.log(J(out));
