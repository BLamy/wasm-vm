// P9 (the novel attack, at unit level) and P11 (the claim's limits) of predictions.txt.
// The real CursorController in the device's order (harness-r4.mjs).
import { makeRig, makeGuest, watch, wrongOf, J, HOTS, FAR, HOTSPOT_REST_MS, HOTSPOT_POLL_MS } from "./harness-r4.mjs";

let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };
const REST = HOTSPOT_REST_MS + 4 * HOTSPOT_POLL_MS;
async function start({ kernelDrop }) {
  const r = watch(makeRig({ size: 64 })); r.hots = HOTS; r.plane = [0, 0];
  const g = makeGuest(r, { kernelDrop });
  g.send(FAR[0], FAR[1]); g.act(); await r.wait(120);
  if (r.settling()) throw new Error("did not settle");
  return { r, g };
}
const line = (r, what) => console.log(`    t=${String(Math.round(r.now)).padStart(5)} ${what.padEnd(74)} shown=${r.shown ?? "-"} inferred=${J(r.hot())} settling=${r.settling()}`);

console.log("P9 — the guest is idle after a position sent since the restart, and its pointer is NOT on it");
console.log("     (the kernel drops absolute-axis values equal to the device's current ones; relative motion uses another device)");
for (const scenario of ["hook, arrow", "no hook: a shape never met (caret) comes up under the pointer during relative motion"]) {
  for (const [label, kernelDrop, back] of [["the guest's kernel drops the unchanged position", true, [400, 640]],
    ["CONTROL: a guest that acts on every position", false, [400, 640]], ["CONTROL: the return is one pixel away", true, [401, 640]]]) {
    const { r, g } = await start({ kernelDrop });
    console.log(`  ${scenario} — ${label}`);
    g.send(400, 640); g.act(1, "arrow"); await r.wait(REST); line(r, "S(400,640); the guest reports it; at rest");
    const before = r.hot();
    if (scenario.startsWith("hook")) { r.controller.resetHotspotInference(); line(r, "the hook: hotspots forgotten"); }
    r.controller.setPointerState({ mode: "relative" }); line(r, "relative mode");
    const shape = scenario.startsWith("hook") ? "arrow" : "caret";
    g.rel(-7, -5); if (shape === "caret") g.report("caret"); line(r, `relative motion (-7,-5): the guest's pointer at ${J(g.pointer)}, plane ${J(r.plane)}, cursor ${shape}`);
    await r.wait(300);
    r.controller.setPointerState({ mode: "absolute" }); line(r, "absolute mode");
    g.send(back[0], back[1]); g.act(); line(r, `S(${back}) — handled by the guest (dropped by its kernel: ${g.dropped}); pointer at ${J(g.pointer)}`);
    await r.wait(3 * HOTSPOT_POLL_MS); line(r, "the guest has been idle since");
    const settled = !r.settling();
    g.report(); line(r, "a commit of the guest's own: the plane reported where it stands");
    await r.wait(REST); line(r, "at rest");
    const atRest = r.hot(); const truth = HOTS[shape];
    await r.wait(5000); const atRest5 = r.hot();
    g.send(back[0] + 6, back[1] + 2); g.act(); await r.wait(REST); line(r, "one more position (+6,+2), rest");
    const afterOne = r.hot(); const tipAfterOne = afterOne ? [r.plane[0] + afterOne[0] - (back[0] + 6), r.plane[1] + afterOne[1] - (back[1] + 2)] : null;
    g.send(back[0] + 12, back[1] + 4); g.act(); await r.wait(16); g.send(back[0] + 18, back[1] + 6); g.act(); line(r, "two more positions");
    const afterThree = r.hot();
    await r.wait(REST); g.send(520, 600); g.act(); await r.wait(REST); line(r, "a position elsewhere, rest");
    const final = r.hot();
    if (kernelDrop && back[0] === 400) {
      const predicted = [truth[0] + 7, truth[1] + 5];
      check(settled && J(atRest) === J(predicted) && J(atRest5) === J(predicted) && J(afterOne) === J(predicted) && afterThree === null && J(final) === J(truth),
        `predicted: settled (${settled}); at rest ${J(predicted)} for a true ${J(truth)}: observed ${J(atRest)}, 5 s later ${J(atRest5)}; after one more position and a rest ${J(afterOne)} (drawn tip off the sent pixel by ${J(tipAfterOne)}); dropped at the third move it cannot explain (${J(afterThree)}); finally ${J(final)}`);
    } else {
      check(settled && wrongOf(r).length === 0 && J(final) === J(truth), `never wrong (${J(wrongOf(r))}); at rest after the return ${J(atRest)}; finally ${J(final)} (before: ${J(before)})`);
    }
  }
}

console.log("\nP11 — the claim's limits");
console.log("  1. a busy guest");
{
  // not settling: no rest answer while the guest is never idle; moves alone settle a shape when the pointer turns
  const { r, g } = await start({ kernelDrop: false });
  r.busy = true;
  for (const px of [930, 924]) { g.send(px, 300); g.act(1, "arrow"); await r.wait(16); }
  for (const px of [918, 912, 906]) { g.send(px, 300); g.act(1, "caret"); await r.wait(16); }
  await r.wait(10_000);
  const straight = r.hot();
  g.send(900, 330); g.act(); await r.wait(16);
  const turned = r.hot();
  check(straight === null && J(turned) === "[4,8]" && wrongOf(r).length === 0, `not settling, guest never idle: after a straight approach and 10 s at rest ${J(straight)}; after the pointer turned ${J(turned)}`);
  // settling: nothing at all, moves included
  const s = watch(makeRig({ size: 64 })); s.hots = HOTS; s.plane = [0, 0]; const h = makeGuest(s);
  s.busy = true;
  for (const [px, py] of [[930, 300], [900, 340], [860, 290], [820, 360], [790, 300]]) { h.send(px, py); h.act(1, "hand"); await s.wait(300); }
  await s.wait(10_000);
  const busy = [s.hot(), s.settling()];
  s.busy = false; await s.wait(3000);
  const idleNoReport = s.hot();
  h.report(); await s.wait(REST);
  check(busy[0] === null && busy[1] === true && idleNoReport === null && J(s.hot()) === "[9,4]" && wrongOf(s).length === 0,
    `settling, guest never idle: five positions in five directions and 10 s: shown ${J(busy[0])}, settling ${busy[1]}; idle, not reported again: ${J(idleNoReport)}; reported again and at rest: ${J(s.hot())}`);
}
console.log("  2. rest needs 150 ms without a cursor event");
for (const every of [100, 140, 200, 400]) {
  const { r, g } = await start({ kernelDrop: false });
  for (const px of [930, 924]) { g.send(px, 300); g.act(1, "arrow"); await r.wait(16); }
  for (const px of [918, 912, 906]) { g.send(px, 300); g.act(1, "caret"); await r.wait(16); }
  // (the first commit comes `every` ms after the last move of the approach, not 16 ms later than that:
  // my first version waited 16 + every, and with 140 that gap alone was a rest of 156 ms)
  await r.wait(every - 16); g.report();
  for (let t = 0; t < 10_000; t += every) { await r.wait(every); g.report(); }
  const shown = r.hot();
  check(wrongOf(r).length === 0 && (every < HOTSPOT_REST_MS ? shown === null : J(shown) === "[4,8]"), `a guest committing every ${every} ms for 10 s after a straight approach: ${J(shown)}`);
}
console.log("  3. after starting over at rest, nothing is known until the image is reported again");
{
  const { r, g } = await start({ kernelDrop: false });
  g.send(400, 640); g.act(1, "hand"); await r.wait(REST);
  const before = r.hot();
  r.controller.resetHotspotInference(); await r.wait(30_000);
  const quiet = r.hot();
  g.report(); await r.wait(REST);
  check(J(before) === "[9,4]" && quiet === null && J(r.hot()) === "[9,4]", `before ${J(before)}; 30 s after the hook with no report ${J(quiet)}; after one commit of the guest's own and a rest ${J(r.hot())}`);
}
console.log("  7. output size: moves reported between the change and the next position are compared with the old positions");
{
  const { r, g } = await start({ kernelDrop: false });
  g.send(300, 400); g.act(1, "arrow"); await r.wait(16); g.send(310, 400); g.act(1, "arrow"); await r.wait(REST);
  // the guest's output changes size: its pointer lands elsewhere, twice, with a shape not settled
  g.pointer = [297, 399]; g.report("hand"); await r.wait(16);
  g.pointer = [307, 399]; g.report("hand"); await r.wait(16);
  const between = r.hot();
  g.send(500, 500, 1280, 801); g.act(); await r.wait(REST);
  const kept = r.hot();
  check(J(between) === "[12,5]" && J(kept) === "[12,5]", `two reports at the new size against positions of the old one: hand ${J(between)} (true (9,4)); at the next position (restart by size) and at rest: ${J(kept)} — settled in between, kept, as the limit says`);
}
console.log(failures === 0 ? "\nALL PREDICTIONS HELD" : `\n${failures} PREDICTION(S) FAILED`);
