// E5-T36a verifier round 5 — hand-worked sequences through the real CursorController
// (harness-r5.mjs: the device's order, a kernel that drops unchanged axes, the device's own hide).
//   node unit-r5.mjs                      the sources
//   SINK_DIR=<mutant dir> node unit-r5.mjs   a mutant (the FAILED lines are how it differs)
import { makeRig, wrong, J, HOTS, REST, HOTSPOT_POLL_MS, HOTSPOT_CAUGHT_UP_TIMEOUT_MS, sinkDir } from "./harness-r5.mjs";

let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };
console.log(`sink files: ${sinkDir}`);

console.log("\nP4 — round 4's P9: relative motion, then the mouse back on the pixel it left (the kernel passes it on to nobody)");
for (const scenario of ["the arrow forgotten by the hook", "a caret first met during relative motion"]) {
  for (const [label, back] of [["the return to the same pixel", [400, 640]], ["CONTROL: the return one pixel away", [401, 640]]]) {
    const r = makeRig(); await r.settle(); const g = r.guest;
    const shape = scenario.startsWith("the arrow") ? "arrow" : "caret"; const truth = HOTS[shape];
    r.go(300, 600, "arrow"); r.go(400, 640, "arrow"); await r.wait(REST);
    const before = r.hot();
    if (shape === "arrow") r.hook();
    r.setMode("relative"); g.rel(-7, -5); if (shape === "caret") g.show("caret"); await r.wait(300);
    r.setMode("absolute");
    r.S(back[0], back[1]); g.act();
    const pointerAfter = [...g.pointer];
    await r.wait(5000);
    const settlingAfter5s = r.settling(); const asked = r.pollTimers();
    for (let i = 0; i < 3; i += 1) { g.commit(); await r.wait(100); }
    await r.wait(REST + 5000);
    const atRest = r.hot();
    r.S(back[0], back[1]); g.act(); await r.wait(1000);
    const settlingAfterRepeat = r.settling();
    r.S(back[0], back[1] + 6); g.act();              // one axis only
    const pointerOneAxis = [...g.pointer];
    await r.wait(REST);
    const settledAfterOneAxis = !r.settling();
    r.S(back[0] + 12, back[1] + 4); g.act(); await r.wait(REST);
    const final = r.hot();
    const line = `${scenario} — ${label}: arrow before ${J(before)}; guest pointer after the return ${J(pointerAfter)} (dropped ${g.dropped}); settling 5 s later ${settlingAfter5s}, questions in flight ${asked}; after 3 commits and 5 s at rest ${J(atRest)}; settling after the same pixel again ${settlingAfterRepeat}; after (0,+6): guest pointer ${J(pointerOneAxis)}, settled ${settledAfterOneAxis}; finally ${J(final)} for a true ${J(truth)}; wrong shown ${J(wrong(r))}; moves to the estimator while settling ${r.estimator.calls.moveWhileSettling}`;
    if (back[0] === 400) check(J(pointerAfter) === "[393,635]" && settlingAfter5s === true && asked === 0 && atRest === null && settlingAfterRepeat === true && settledAfterOneAxis && J(final) === J(truth) && wrong(r).length === 0 && r.estimator.calls.moveWhileSettling === 0, line);
    else check(J(pointerAfter) === J(back) && settlingAfter5s === false && J(final) === J(truth) && wrong(r).length === 0, line);
  }
}
{
  // Round 4's plans without the hook: the session's FIRST position, relative mode, relative motion, back, the same pixel.
  const r = makeRig(); const g = r.guest; g.show("arrow", 100, 100);
  r.S(420, 670); g.act(); await r.wait(REST);
  const afterFirst = r.settling();
  r.setMode("relative"); g.rel(-4, -3); await r.wait(300); r.setMode("absolute");
  r.S(420, 670); g.act(); await r.wait(3000);
  for (let i = 0; i < 3; i += 1) { g.commit(); await r.wait(100); }
  await r.wait(REST + 5000);
  const atRest = r.hot(); const settling = r.settling();
  r.S(426, 672); g.act(); await r.wait(16); r.S(432, 674); g.act(); await r.wait(REST + 5000);
  // (First version of this script expected (1,1) here. Both moves came within 16 ms, before the
  // 40 ms poll could end settling, so nothing was known yet: the claim's "nothing is known about
  // the image shown until it is reported again". My expectation was wrong, not the page.)
  const beforeReport = r.hot(); const settledBeforeReport = !r.settling();
  g.commit(); await r.wait(REST);
  check(afterFirst === true && settling === true && atRest === null && wrong(r).length === 0 && beforeReport === null && settledBeforeReport && J(r.hot()) === "[1,1]",
    `no hook, the session's first position, relative motion (-4,-3), the same pixel: settling after the first position ${afterFirst}; after the return and 5 s ${settling}, shown ${J(atRest)}; after two more positions 16 ms apart and 5 s: settled ${settledBeforeReport}, shown ${J(beforeReport)}; after one commit of the guest's own and a rest ${J(r.hot())}; wrong ${J(wrong(r))}`);
}

console.log("\nP6b — a hide in the device's own order (cursor-update with resource 0), the guest's pointer elsewhere when the cursor is shown again");
for (const [label, how] of [["a client's pointer lock in the guest (tablet frames read and ignored)", "lock"], ["the compositor restarted under the page ((100,100))", "compositor"],
  ["CONTROL: the worker's test guest's hide (a cursor-move with resource 0), pointer lock", "lock-by-move"]]) {
  const r = makeRig(); await r.settle(); const g = r.guest;
  r.go(300, 600, "arrow"); r.go(400, 640, "arrow"); await r.wait(REST);
  r.hook();                                              // the arrow not settled (any shape not met yet would do)
  const settlingBefore = r.settling();
  let parked;
  if (how === "compositor") { g.compositorStop(); r.S(300, 300); r.S(120, 110); g.act(); parked = [120, 110]; }
  else {
    if (how === "lock-by-move") { g.hideByMove(); g.locked = true; } else g.lock();
    r.S(420, 650); r.S(407, 645); g.act(); parked = [407, 645];
  }
  await r.wait(REST + 1000);
  const settlingHidden = r.settling();
  if (how === "compositor") g.compositorStart("arrow"); else g.unlock("arrow");
  const settlingShown = r.settling(); const plane = [...g.plane];
  for (let i = 0; i < 3; i += 1) { g.commit(); await r.wait(100); }
  await r.wait(REST + 5000);
  const atRest = r.hot(); const wouldBe = [parked[0] - plane[0], parked[1] - plane[1]];
  r.S(parked[0], parked[1]); g.act(); await r.wait(1000);
  const afterSamePixel = [r.settling(), r.hot()];
  r.S(parked[0], parked[1] + 6); g.act(); await r.wait(REST);
  r.S(parked[0] + 60, parked[1] + 40); g.act(); await r.wait(REST);
  check(settlingBefore === false && settlingHidden === false && settlingShown === true && atRest === null && afterSamePixel[0] === true && wrong(r).length === 0 && J(r.hot()) === "[1,1]",
    `${label}: settling before ${settlingBefore}, while hidden ${settlingHidden}, when shown again ${settlingShown}; the plane at ${J(plane)} with the mouse on ${J(parked)} (a page that had not started over would answer ${J(wouldBe)}); after 3 commits and 5 s at rest ${J(atRest)}; the same pixel again: settling ${afterSamePixel[0]}, shown ${J(afterSamePixel[1])}; finally ${J(r.hot())}; wrong shown ${J(wrong(r).map((v) => v.hot))}`);
}
{
  // A client hides the cursor and shows it again, nothing else: what was settled stays, the rest starts over.
  const r = makeRig(); await r.settle(); const g = r.guest;
  r.go(400, 300, "arrow"); r.go(520, 360, "arrow"); r.go(600, 420, "hand");
  g.hide(); r.S(700, 500); g.act(); g.show("hand");
  const s1 = r.settling(); g.show("arrow"); const arrow = r.hot(); g.show("hand");
  r.S(760, 540); g.act(); const notYet = r.hot(); await r.wait(REST);
  r.S(820, 500); g.act(); await r.wait(REST);
  check(s1 === true && J(arrow) === "[1,1]" && notYet === null && J(r.hot()) === "[9,4]" && wrong(r).length === 0,
    `hide (update, resource 0) and show with the pointer following: settling when shown ${s1}; the settled arrow ${J(arrow)}; the hand after one move ${J(notYet)}, in the end ${J(r.hot())}`);
}

console.log("\nP16/V10 — a cold boot: two positions before any compositor, the guest busy (question in flight), the compositor starts, the guest idles");
{
  const r = makeRig(); const g = r.guest; g.up = false;
  r.busy = true;
  r.S(300, 300); r.S(120, 110); g.act();
  await r.wait(500);
  const inFlight = r.pollTimers(); const settling0 = r.settling();
  g.compositorStart("arrow");
  const settlingAtShow = r.settling(); const plane = [...g.plane];
  r.busy = false; await r.wait(REST + HOTSPOT_CAUGHT_UP_TIMEOUT_MS);
  const settlingIdle = r.settling();
  for (let i = 0; i < 3; i += 1) { g.commit(); await r.wait(100); }
  await r.wait(REST + 5000);
  const atRest = r.hot();
  r.S(126, 112); g.act(); await r.wait(REST); g.commit(); await r.wait(REST);
  check(inFlight === 1 && settling0 === true && settlingAtShow === true && settlingIdle === true && atRest === null && J(r.hot()) === "[1,1]" && wrong(r).length === 0,
    `question in flight before the compositor: ${inFlight}; settling then ${settling0}, at the first image ${settlingAtShow} (plane ${J(plane)}, mouse on [120,110]), after the guest idled ${settlingIdle}; after 3 commits and 5 s ${J(atRest)} (would be [21,11]); after the first move ${J(r.hot())}; wrong shown ${J(wrong(r).map((v) => v.hot))}`);
}

console.log("\nP9 — settling ends only after a position that differs from the one before it at the same size, in the live epoch, and an idle reading after it (readings delivered by hand)");
{
  const startOver = (d) => { d.setMode("relative"); d.setMode("absolute"); };
  for (const phase of ["the first reading in flight", "the poll wait", "the second reading in flight"]) {
    const d = makeRig({ counter: "manual" }); d.guest.show("arrow", 640, 400);
    d.S(90, 100); await d.flush();
    const askedAfterFirst = d.pending.length;
    d.S(100, 100); await d.flush();
    const askedAfterSecond = d.pending.length;
    if (phase !== "the first reading in flight") { await d.reading(5); }
    if (phase === "the second reading in flight") { await d.wait(HOTSPOT_POLL_MS); }
    startOver(d);
    while (d.pending.length) await d.reading(99);       // whatever was in flight answers "idle since"
    await d.wait(10 * HOTSPOT_POLL_MS);
    const afterOld = [d.settling(), d.pending.length, d.pollTimers()];
    d.S(100, 100); d.S(100, 100); await d.wait(5000);    // the same pixel, twice
    const afterRepeat = [d.settling(), d.pending.length, d.pollTimers()];
    d.S(100, 106); await d.flush();                      // one axis
    const askedOneAxis = d.pending.length;
    await d.reading(200); await d.wait(HOTSPOT_POLL_MS); await d.reading(200);
    const notYet = d.settling();
    await d.wait(HOTSPOT_POLL_MS); await d.reading(201);
    check(askedAfterFirst === 0 && askedAfterSecond === 1 && J(afterOld) === "[true,0,0]" && J(afterRepeat) === "[true,0,0]" && askedOneAxis === 1 && notYet === true && d.settling() === false,
      `(a,b) started over with ${phase}: asked after the first position ${askedAfterFirst}, after the second ${askedAfterSecond}; old readings answered "idle": [settling, readings, polls] ${J(afterOld)}; the same pixel twice ${J(afterRepeat)}; (0,+6) asked ${askedOneAxis}; a count that stays: settling ${notYet}; +1: settling ${d.settling()}`);
  }
  {
    const d = makeRig({ counter: "manual" }); d.guest.show("arrow", 640, 400);
    for (let i = 0; i < 6; i += 1) d.S(300, 300, 1280, i % 2 ? 801 : 800);
    await d.wait(3000); const samePixel = [d.settling(), d.pending.length];
    for (let i = 0; i < 6; i += 1) d.S(310 + 9 * i, 300 + 5 * i, 1280, i % 2 ? 801 : 800);
    await d.wait(3000); const otherPixels = [d.settling(), d.pending.length];
    for (let i = 0; i < 4; i += 1) d.S(400 + 9 * i, 300, i % 2 ? 1281 : 1280, 800);
    await d.wait(3000); const widthOnly = [d.settling(), d.pending.length];
    d.S(500, 300, 1280, 800); d.S(501, 300, 1280, 800); await d.flush();
    check(J(samePixel) === "[true,0]" && J(otherPixels) === "[true,0]" && J(widthOnly) === "[true,0]" && d.pending.length === 1,
      `(c) every position at another output size than the one before: one pixel, rows 800/801 alternating ${J(samePixel)}; different pixels ${J(otherPixels)}; columns 1280/1281 alternating ${J(widthOnly)}; then two at one size: asked ${d.pending.length}`);
  }
  {
    const d = makeRig({ counter: "manual" }); d.guest.show("arrow", 640, 400);
    d.S(200, 200); d.reboot().show("arrow", 640, 400); d.S(260, 240); await d.wait(3000);
    const afterReset = [d.settling(), d.pending.length];
    d.S(270, 240); await d.flush();
    check(J(afterReset) === "[true,0]" && d.pending.length === 1, `(d) a guest reset between two different positions: ${J(afterReset)}; the next different one: asked ${d.pending.length}`);
  }
  {
    const d = makeRig({ counter: "manual" }); const g = d.guest; g.show("arrow", 640, 400);
    d.S(200, 200); d.S(260, 240); await d.flush(); await d.reading(5); await d.wait(HOTSPOT_POLL_MS);
    g.hide(); g.show("arrow");
    await d.reading(6); await d.wait(10 * HOTSPOT_POLL_MS);
    const afterShow = [d.settling(), d.pending.length, d.pollTimers()];
    d.S(260, 240); await d.wait(3000);
    const samePixel = [d.settling(), d.pending.length];
    d.S(266, 240); await d.flush(); const asked = d.pending.length;
    await d.reading(6); await d.wait(HOTSPOT_POLL_MS); await d.reading(7);
    check(J(afterShow) === "[true,0,0]" && J(samePixel) === "[true,0]" && asked === 1 && d.settling() === false,
      `(e) hide and show (the device's order) while the second reading is in flight, answered "idle": ${J(afterShow)}; the same pixel ${J(samePixel)}; a different one asked ${asked}, settled ${!d.settling()}`);
  }
  {
    const rows = [];
    for (const [name, make] of [["goes down", () => { let n = 100; return async () => { n -= 1; return n; }; }], ["stays", () => async () => 7],
      ["NaN", () => async () => NaN], ["null", () => async () => null], ["a string", () => async () => "9"], ["throws", () => async () => { throw new Error("no"); }],
      ["Infinity", () => async () => Infinity], ["alternates with null", () => { let n = 0; return async () => { n += 1; return n % 2 ? n : null; }; }]]) {
      const d = makeRig({ counter: () => make() }); d.guest.show("arrow", 640, 400);
      d.S(200, 200); d.S(260, 240); d.guest.act(); await d.wait(3 * HOTSPOT_CAUGHT_UP_TIMEOUT_MS);
      d.guest.commit(); await d.wait(REST + 1000);
      rows.push(`${name}: settling ${d.settling()}, shown ${J(d.hot())}`);
      if (!d.settling() || d.hot() !== null) failures += 1;
    }
    console.log(`  ${rows.every((row) => /settling true, shown null/.test(row)) ? "HELD  " : "FAILED"} (f) a counter that ${rows.join("; ")}`);
  }
}
console.log(`\n${failures} check(s) failed`);
