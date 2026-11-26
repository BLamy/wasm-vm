// E5-T36a verifier round 3: unit attacks on the new asynchronous rules, through the REAL
// CursorController in the device's order (harness-r3.mjs). P6 of predictions.txt, plus a check
// of what my surviving mutants would do (is the code as written right where the tests are
// silent?).   node attacks-r3.mjs [section]
import { makeRig, rng, J, off, HOTSPOT_REST_MS, HOTSPOT_POLL_MS, HOTSPOT_CAUGHT_UP_TIMEOUT_MS, HOTSPOT_SETTLE_FALLBACK_MS } from "./harness-r3.mjs";

const only = process.argv[2] ?? null;
const HOTS = { arrow: [1, 1], hand: [9, 4], caret: [4, 8] };
let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };
const section = async (id, title, fn) => { if (only && only !== id) return; console.log(`\n§${id} ${title}`); await fn(); };
const fresh = (o = {}) => { const r = makeRig({ size: 64, ...o }); r.hots = HOTS; r.plane = [0, 0]; return r; };
// Every answer shown, as it changes: [t, image, hot]
function watch(r) { r.answers = []; let last = "null"; r.onTick = () => { const k = J(r.hot()) + r.shown; if (k !== last) { last = k; r.answers.push([Math.round(r.now), r.shown, r.hot()]); } }; return r; }
const wrong = (r) => r.answers.filter(([, image, hot]) => hot && off(hot, HOTS[image]) > 1);

await section("a", "a restart while a rest question is in flight", async () => {
  for (const way of ["reset", "mode", "size"]) {
    const r = watch(fresh());
    // The caret undecided: two moves on an even run to the LEFT (the positions sent before keep
    // explaining its plane: 4, 10 and 16 px), the guest keeping up, then busy with other work.
    (await r.at(0)).S(930, 300).commit("arrow", 930, 300, 1); (await r.at(16)).S(924, 300).commit("arrow", 924, 300, 1);
    (await r.at(32)).S(918, 300).commit("caret", 918, 300, 1); (await r.at(48)).S(912, 300).commit("caret", 912, 300, 1);
    const undecided = r.hot() === null;
    r.busy = true;
    await r.at(48 + HOTSPOT_REST_MS + 2 * HOTSPOT_POLL_MS); // the question is out, the guest is busy
    const asked = r.asked;
    if (way === "reset") r.controller.resetHotspotInference();
    else if (way === "mode") { r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); }
    else r.S(912, 300, 1280, 801).commit("caret", 912, 300, 1); // same pixel, another output size
    r.busy = false;
    await r.wait(3000);
    check(undecided && r.hot() === null && wrong(r).length === 0 && asked > 0, `${way}: undecided before (${undecided}); the question in flight (${asked} readings so far) answers nothing after the restart: ${J(r.hot())}; wrong shown ${wrong(r).length}; timers left ${r.timers.size}`);
    // control: the same without the restart is answered (so the question really was in flight)
    if (way === "reset") {
      const c = watch(fresh());
      (await c.at(0)).S(930, 300).commit("arrow", 930, 300, 1); (await c.at(16)).S(924, 300).commit("arrow", 924, 300, 1);
      (await c.at(32)).S(918, 300).commit("caret", 918, 300, 1); (await c.at(48)).S(912, 300).commit("caret", 912, 300, 1);
      c.busy = true; await c.at(48 + HOTSPOT_REST_MS + 2 * HOTSPOT_POLL_MS); c.busy = false; await c.wait(3000);
      check(J(c.hot()) === "[4,8]", `control without the restart: the question in flight is answered once the guest is idle: ${J(c.hot())}`);
    }
  }
});

await section("b", "two images alternating at rest (no restart)", async () => {
  let shownWrong = 0; let answered = 0; let total = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const R = rng(seed * 7919); const r = watch(fresh());
    // approach: an even or uneven run of 3..10 positions, guest lag 0..2, then rest; then the image
    // alternates hand <-> caret k times at rest (each a commit: update at the other's plane, move).
    let x = 300 + Math.floor(R() * 400); let y = 200 + Math.floor(R() * 300); let t = 0;
    const n = 3 + Math.floor(R() * 8); const step = [Math.round(R() * 16 - 8), Math.round(R() * 10 - 5)]; const lag = Math.floor(R() * 3);
    const sent = [];
    for (let i = 0; i < n; i += 1) {
      x += R() < 0.7 ? step[0] : Math.round(R() * 20 - 10); y += R() < 0.7 ? step[1] : Math.round(R() * 20 - 10);
      t += 16; (await r.at(t)).S(x, y); sent.push([x, y]);
      const g = sent[sent.length - 1 - lag]; if (g) r.commit("hand", g[0], g[1], 1);
    }
    for (let i = lag; i > 0; i -= 1) { t += 10; const g = sent[sent.length - i]; (await r.at(t)).commit("hand", g[0], g[1], 1); }
    const flips = 1 + Math.floor(R() * 6);
    for (let i = 0; i < flips; i += 1) { t += 20 + Math.floor(R() * 200); (await r.at(t)).commit(i % 2 ? "hand" : "caret", x, y, 0); }
    await r.at(t + 1500);
    total += 1; if (r.hot()) answered += 1; shownWrong += wrong(r).length;
    if (wrong(r).length) console.log(`   seed ${seed}: ${J(wrong(r))}`);
  }
  check(shownWrong === 0, `300 approaches, then 1..6 flips hand <-> caret at rest: wrong answers shown ${shownWrong}; answered at the end ${answered} of ${total}`);
});

await section("c", "the image changes at rest while the guest is being asked about the image before (my mutant V1: no key check)", async () => {
  const r = watch(fresh());
  // The caret undecided (an even run to the left, the guest keeping up: 4, 10 and 16 px fit); the
  // pointer stops; the guest is busy; the question about the CARET is out; then the client
  // changes the cursor to the hand where the pointer rests; then the guest goes idle.
  (await r.at(0)).S(930, 300).commit("arrow", 930, 300, 1); (await r.at(16)).S(924, 300).commit("arrow", 924, 300, 1);
  (await r.at(32)).S(918, 300).commit("caret", 918, 300, 1); (await r.at(48)).S(912, 300).commit("caret", 912, 300, 1);
  const undecided = r.hot() === null;
  r.busy = true;
  await r.at(48 + HOTSPOT_REST_MS + 2 * HOTSPOT_POLL_MS); const asked = r.asked; // the caret's question is polling
  (await r.at(300)).commit("hand", 912, 300, 0);                                 // the hand, same pointer position
  const afterInstall = r.hot();
  await r.at(330); r.busy = false; await r.at(3000);
  const onHand = r.answers.filter(([, image, hot]) => image === "hand" && hot);
  check(undecided && asked > 0 && afterInstall === null && J(r.hot()) === "[9,4]" && wrong(r).length === 0,
    `caret undecided (${undecided}), its question out (${asked} readings); hand ${J(r.hot())} (true (9,4)); answers shown for the hand ${J(onHand)}; the caret's (4,8) was never put on the hand`);
  // back over text: the caret's own question was void, it is asked again and answered right
  (await r.wait(100)).S(906, 300).commit("caret", 906, 300, 1); await r.wait(1000);
  check(J(r.hot()) === "[4,8]" && wrong(r).length === 0, `caret afterwards ${J(r.hot())}; wrong shown ${J(wrong(r))}`);
});

await section("d", "settled hotspots kept across a mode or size change are still right; unsettled ones are forgotten", async () => {
  for (const way of ["mode", "size"]) {
    const r = watch(fresh()); let h = 800;
    (await r.at(0)).S(300, 400).commit("hand", 300, 400, 1); await r.at(500);
    (await r.wait(10)).S(520, 330).commit("arrow", 520, 330, 1); await r.wait(500);
    const before = [r.hot()];
    if (way === "mode") { r.controller.setPointerState({ mode: "relative" }); r.M("arrow", 700, 100); r.M("arrow", 650, 140); r.controller.setPointerState({ mode: "absolute" }); r.plane = [650, 140]; }
    else h = 900;
    await r.wait(500);
    (await r.wait(10)).S(100, 100, 1280, h).commit("arrow", 100, 100, 1); const arrow = r.hot();
    (await r.wait(300)).S(110, 520, 1280, h).commit("hand", 110, 520, 1); const hand = r.hot();
    await r.wait(1000);
    check(J(before[0]) === "[1,1]" && J(arrow) === "[1,1]" && J(hand) === "[9,4]" && wrong(r).length === 0, `${way}: arrow ${J(arrow)}, hand ${J(hand)} right at once after the restart; wrong shown ${wrong(r).length}`);
  }
});

await section("e", "a guest more than 512 positions behind in a small area (limit 3): what is shown, and what is left at rest", async () => {
  let dropped = 0; let wrongShown = 0; let wrongAtRest = 0; let noneAtRest = 0; let wrongMs = 0; const runs = 40;
  for (let seed = 1; seed <= runs; seed += 1) {
    const R = rng(seed * 104729); const r = watch(fresh());
    // settle the hand, then wiggle in a 40x30 px area for 700..1100 positions while the guest is
    // `lag` positions behind (600..900), then stop; the guest catches up one position per 4 ms.
    (await r.at(0)).S(300, 400).commit("hand", 300, 400, 1); (await r.at(300)).S(420, 460).commit("hand", 420, 460, 1); await r.at(600);
    const lag = 600 + Math.floor(R() * 300); const n = lag + 100 + Math.floor(R() * 200);
    const sent = []; let t = 1000; let x = 400; let y = 450;
    for (let i = 0; i < n; i += 1) {
      x = Math.min(440, Math.max(400, x + Math.round(R() * 10 - 5))); y = Math.min(480, Math.max(450, y + Math.round(R() * 8 - 4)));
      t += 16; (await r.at(t)).S(x, y); sent.push([x, y]);
      const g = sent[i - lag]; if (g) r.commit("hand", g[0], g[1], 1);
    }
    for (let i = Math.max(0, n - lag); i < n; i += 1) { t += 4; (await r.at(t)).commit("hand", sent[i][0], sent[i][1], 1); }
    r.outstanding = 0;
    await r.at(t + 3000);
    const w = wrong(r);
    { const firstKnown = r.answers.findIndex(([, , hot]) => hot); if (firstKnown >= 0 && r.answers.slice(firstKnown).some(([, , hot]) => hot === null)) dropped += 1; }
    if (w.length) wrongShown += 1;
    for (let i = 0; i < r.answers.length; i += 1) { const a = r.answers[i]; if (a[2] && off(a[2], HOTS.hand) > 1) wrongMs += (r.answers[i + 1]?.[0] ?? t + 3000) - a[0]; }
    if (r.hot() === null) noneAtRest += 1; else if (off(r.hot(), HOTS.hand) > 1) { wrongAtRest += 1; console.log(`   seed ${seed}: at rest ${J(r.hot())}`); }
  }
  console.log(`  ${runs} runs: the right answer was dropped in ${dropped}; a wrong hotspot was SHOWN in ${wrongShown} (for ${Math.round(wrongMs / Math.max(1, wrongShown))} ms a run on average); at rest 3 s after the guest caught up: wrong ${wrongAtRest}, none ${noneAtRest}, right ${runs - wrongAtRest - noneAtRest}`);
  check(wrongAtRest <= runs * 0.05, `at rest after catching up the wrong one is gone in >= 95 % (wrong ${wrongAtRest} of ${runs})`);
});

await section("f", "no idle counter: no rest answers; a restart trusts moves after exactly one second", async () => {
  const r = watch(fresh({ counter: "none" }));
  (await r.at(0)).S(300, 400).commit("hand", 300, 400, 1); await r.at(3000);
  check(r.hot() === null && r.timers.size === 0, `one move and 3 s of rest: ${J(r.hot())} (no rest rule), timers armed ${r.timers.size}`);
  r.controller.resetHotspotInference();
  await r.at(3000 + HOTSPOT_SETTLE_FALLBACK_MS - 1); const before = r.settling();
  await r.at(3000 + HOTSPOT_SETTLE_FALLBACK_MS + 1); const after = r.settling();
  check(before === true && after === false, `settling ${before} at 999 ms, ${after} at 1001 ms`);
  // a guest more than a second behind at the restart (the stated limit): round 2's sequence
  const s = watch(fresh({ counter: "none" })); let x = 600; let t = 0;
  for (let i = 0; i < 6; i += 1) { t += 16; x -= 10; (await s.at(t)).S(x, 200); if (i > 0) s.commit("hand", x + 10, 200, 1); }
  s.controller.resetHotspotInference(); // guest one position behind, and silent for 1.2 s
  await s.at(t + 1200);
  for (let i = 0; i < 6; i += 1) { t += 16; x -= 10; (await s.at(t + 1200)).S(x, 200).commit("hand", x + 10, 200, 1); }
  (await s.at(t + 1300)).commit("hand", x, 200, 1); await s.at(t + 5000);
  console.log(`  a guest one position behind and silent for 1.2 s across the restart, no counter: hand ${J(s.hot())} at rest (true (9,4)); shown ${J(s.answers.filter((a) => a[2]))}`);
  check(s.hot() !== null && off(s.hot(), HOTS.hand) > 1, "predicted WRONG here (stated limit 4: \"a restart trusts moves after one second\")");
});

await section("g", "a count that misbehaves: down, NaN, Infinity, a string, a rejected promise, never resolving", async () => {
  const kinds = {
    down: (rig) => { let v = 1000; return async () => { v -= 1; return v; }; },
    nan: () => async () => NaN, infinity: () => async () => Infinity, string: () => async () => "12",
    rejects: () => async () => { throw new Error("worker gone"); },
    hangs: () => () => new Promise(() => {}),
    alternates: () => { let i = 0; return async () => { i += 1; return i % 2 ? 5 : null; }; },
  };
  for (const [name, make] of Object.entries(kinds)) {
    const r = watch(fresh({ counter: make }));
    (await r.at(0)).S(500, 300).commit("arrow", 500, 300, 1); (await r.at(16)).S(506, 300).commit("caret", 506, 300, 1);
    (await r.at(32)).S(512, 300).commit("caret", 512, 300, 1);
    await r.at(5000);
    r.controller.resetHotspotInference(); await r.wait(5000);
    const timersLeft = r.timers.size; const diag = r.diagnostics.length;
    check(wrong(r).length === 0 && r.hot() === null, `${name}: no answer (${J(r.hot())}), settling ${r.settling()} after 5 s, timers armed ${timersLeft}, diagnostics ${diag}`);
  }
});

await section("h", "a restart while an earlier restart's question is still in flight (my mutants V5, V6, V10)", async () => {
  // A counter whose answers take 30 ms (an RPC under load), so that a restart can fall between
  // a question and its answer.
  const slow = (rig) => async () => { rig.asked += 1; const moved = rig.outstanding === 0 && !rig.busy; await new Promise((resolve) => rig.late.push(resolve)); if (moved) rig.idleWaits += 1; return rig.idleWaits; };
  const r = watch(fresh({ counter: slow })); r.late = [];
  const answerAll = async () => { const waiting = r.late.splice(0); for (const f of waiting) f(); await r.flush(); };
  let x = 600; let t = 0;
  for (let i = 0; i < 6; i += 1) { t += 16; x -= 10; (await r.at(t)).S(x, 200); if (i > 0) r.commit("hand", x + 10, 200, 1); }
  r.controller.resetHotspotInference();         // restart 1: its first reading is in flight...
  await r.flush();
  for (let i = 0; i < 3; i += 1) { t += 16; x -= 10; (await r.at(t)).S(x, 200).commit("hand", x + 10, 200, 1); }
  r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); // restarts 2 and 3
  await answerAll();
  // the guest is still one position behind; the run goes on
  const shownDuring = [];
  for (let i = 0; i < 8; i += 1) { t += 16; x -= 10; (await r.at(t)).S(x, 200).commit("hand", x + 10, 200, 1); await answerAll(); shownDuring.push(J(r.hot())); }
  const settlingBehind = r.settling();
  (await r.at(t + 50)).commit("hand", x, 200, 1);
  for (let i = 0; i < 80; i += 1) { await r.wait(25); await answerAll(); }
  check(settlingBehind === true && shownDuring.every((v) => v === "null") && wrong(r).length === 0 && r.settling() === false,
    `three restarts back to back with answers in flight: settling while behind ${settlingBehind}; shown during the run ${[...new Set(shownDuring)]}; wrong ${wrong(r).length}; settling at the end ${r.settling()}; questions still polling: timers ${r.timers.size}, unanswered ${r.late.length}`);
});

await section("i", "P3 by model: after a restart at rest, ONE re-report of the plane after the first new position; even runs of n positions, the guest `lag` positions behind, then rest", async () => {
  // Conditional on that one re-report (in my browser runs under guest load it happened in 4 of
  // 32 and 5 of 48 trials). 200 seeds a row: random image, random step that keeps truth + step inside the image.
  for (const n of [2, 3, 4, 6, 10]) for (const lag of [0, 1, 2]) {
    let shown = 0; let atRest = 0; let worst = 0; const trials = 200;
    for (let seed = 1; seed <= trials; seed += 1) {
      const R = rng(seed * 2654435761 + n * 97 + lag); const image = ["arrow", "hand", "caret"][Math.floor(R() * 3)]; const truth = HOTS[image];
      const step = [Math.round(R() * 14 - 4), Math.round(R() * 10 - 3)]; if (step[0] === 0 && step[1] === 0) step[0] = 3;
      const r = watch(fresh()); let x = 300 + Math.floor(R() * 300); let y = 300 + Math.floor(R() * 200);
      { const commit = r.commit; r.commit = (...args) => { const out = commit(...args); r.onTick(r.now); return out; }; } // sample after every commit too
      (await r.at(0)).S(x, y).commit(image, x, y, 1); await r.at(600);
      r.controller.resetHotspotInference(); await r.at(1500);
      let t = 2000; const sent = [];
      for (let i = 0; i < n; i += 1) {
        x += step[0]; y += step[1]; (await r.at(t)).S(x, y); sent.push([x, y]);
        if (i === 0) (await r.at(t + 3)).commit(image, x - step[0], y - step[1], 0); // the re-report
        const g = sent[i - lag]; if (g && !(i === 0 && lag === 0 && false)) (await r.at(t + 6)).commit(image, g[0], g[1], 1);
        t += 16;
      }
      for (let i = Math.max(0, n - lag); i < n; i += 1) { t += 8; (await r.at(t)).commit(image, sent[i][0], sent[i][1], 1); }
      r.outstanding = 0;
      await r.at(t + 3000);
      const w = r.answers.filter(([at, , hot]) => at >= 2000 && hot && off(hot, truth) > 1);
      if (w.length) shown += 1;
      if (r.hot() && off(r.hot(), truth) > 1) { atRest += 1; worst = Math.max(worst, off(r.hot(), truth)); }
    }
    console.log(`  n=${String(n).padStart(2)} lag=${lag}: a wrong hotspot shown in ${String(shown).padStart(3)} of ${trials}; still shown after 3 s of rest in ${String(atRest).padStart(3)} (worst ${worst} px)`);
  }
});

console.log(failures === 0 ? "\nALL CHECKS HELD" : `\n${failures} CHECK(S) FAILED`);
