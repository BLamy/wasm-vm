// P7 and P8 of predictions.txt, through the real CursorController in the device's order.
//   P7: nothing reaches the estimator while the page is settling (noteMove, noteRest counted by
//       a wrapped estimator), no rest answer is read off a plane that is not the pointer's.
//   P8: the hook keeps the positions sent — random runs with the hook at random moments.
// The guest here always goes where it is sent (the worker's premise); P9 attacks the premise.
import { makeRig, makeGuest, settleFirst, watch, wrongOf, rng, J, HOTS, HOTSPOT_REST_MS, HOTSPOT_POLL_MS, CursorHotspotEstimator } from "./harness-r4.mjs";

let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };

/** A rig whose estimator counts what reaches it while the controller says it is settling. */
function countedRig(options = {}) {
  const estimator = new CursorHotspotEstimator();
  const counts = { moves: 0, rests: 0, movesWhileSettling: 0, restsWhileSettling: 0, restAnswersWhileSettling: 0 };
  let controller = null;
  const noteMove = estimator.noteMove.bind(estimator); const noteRest = estimator.noteRest.bind(estimator);
  estimator.noteMove = (...a) => { counts.moves += 1; if (controller.snapshot().hotspotSettling) counts.movesWhileSettling += 1; return noteMove(...a); };
  estimator.noteRest = (...a) => { counts.rests += 1; const v = noteRest(...a); if (controller.snapshot().hotspotSettling) { counts.restsWhileSettling += 1; if (v) counts.restAnswersWhileSettling += 1; } return v; };
  const r = makeRig({ size: 64, options: { hotspotEstimator: estimator }, ...options }); r.hots = HOTS; r.plane = [0, 0];
  controller = r.controller; r.counts = counts; r.estimator = estimator;
  return r;
}

console.log("P7/P8 — random sessions: runs, lag, commits of the guest's own, cursor flips, hides, and every way of starting over at any moment");
{
  const total = { sessions: 0, wrong: 0, moves: 0, rests: 0, movesWhileSettling: 0, restsWhileSettling: 0, restAnswersWhileSettling: 0, hooks: 0, hooksMidQuestion: 0, restarts: 0, resets: 0, knownAtEnd: 0, answers: 0, hidden: 0, diagnostics: 0, reasons: {} };
  const firstWrong = [];
  for (let seed = 1; seed <= 2000; seed += 1) {
    const R = rng(seed * 2654435761); const int = (n) => Math.floor(R() * n);
    const r = watch(countedRig({ size: [24, 32, 64][int(3)] }));
    let g = makeGuest(r);
    const names = ["arrow", "hand", "caret", "cross"];
    let rows = 800; let t = 0; let x = 200 + int(800); let y = 150 + int(500);
    // (Sample what the page shows before and after every step: an answer that appears in a
    // handler, with no timer due afterwards, is otherwise seen only at the next tick. My first
    // version sampled on timer ticks and once per position.)
    const step = async () => { r.sample(); t += 4 + int(30); await r.at(t); r.sample(); return r; };
    if (int(4)) { await settleFirst(r); t = r.now; }
    g.pointer = [x, y];
    const script = [];
    for (let leg = 0, legs = 2 + int(5); leg < legs; leg += 1) {
      // a run: even or ragged, the guest up to 3 positions behind
      const even = R() < 0.6; const d = [(1 + int(9)) * (int(2) ? 1 : -1), int(11) - 5]; const n = 1 + int(12); const lag = int(4);
      const name = names[int(names.length)];
      for (let i = 0; i < n; i += 1) {
        x = Math.max(70, Math.min(1200, x + (even ? d[0] : int(41) - 20))); y = Math.max(70, Math.min(720, y + (even ? d[1] : int(31) - 15)));
        await step(); g.send(x, y, 1280, rows);
        if (g.image && R() < 0.3) { await step(); g.report(); }                                  // a commit of its own
        if (g.image && R() < 0.1) { await step(); const was = g.image; g.report(names[int(names.length)]); await step(); g.report(was); }   // a flip and back
        if (g.image && R() < 0.03) { await step(); g.hide(); total.hidden += 1; g.image = null; }
        while (g.queue.length > lag) { await step(); g.act(1, g.image ?? name); }
        // starting over, at any moment
        const p = R();
        if (p < 0.06) { r.controller.resetHotspotInference(); total.hooks += 1; if (r.timers.size) total.hooksMidQuestion += 1; }
        else if (p < 0.09) { r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); total.restarts += 1; }
        else if (p < 0.11) { rows = rows === 800 ? 801 : 800; total.restarts += 1; }             // takes effect on the next position
        else if (p < 0.12) { r.controller.reset(); total.resets += 1; r.plane = [0, 0]; r.shown = null; r.outstanding = 0; g = makeGuest(r, { pointer: [640, 400] }); x = 640; y = 400; }
        r.sample();
      }
      // the pointer pauses: sometimes long enough for the rest wait while the guest is behind
      t += [0, 60, 200, 400, 900][int(5)]; await r.at(t);
      if (R() < 0.7) { while (g.queue.length) { await step(); g.act(1, g.image ?? name); } }
      t += [0, 100, 300, 800][int(4)]; await r.at(t);
    }
    // the end: caught up, one position far from the others with a fresh shape, rest
    while (g.queue.length) { await step(); g.act(1, g.image ?? "arrow"); }
    t += 600; await r.at(t);
    await step(); g.send(1150 - int(30), 760 - int(20), 1280, rows); g.act(Infinity, "hand");
    t += HOTSPOT_REST_MS + 10 * HOTSPOT_POLL_MS; await r.at(t);
    await step(); g.send(1100 - int(30), 700 - int(20), 1280, rows); g.act(Infinity, "hand");
    t += HOTSPOT_REST_MS + 10 * HOTSPOT_POLL_MS; await r.at(t);
    r.sample();
    const w = wrongOf(r);
    total.sessions += 1; total.wrong += w.length; total.answers += r.answers.filter((a) => a[2]).length;
    for (const k of ["moves", "rests", "movesWhileSettling", "restsWhileSettling", "restAnswersWhileSettling"]) total[k] += r.counts[k];
    total.diagnostics += r.diagnostics.length;
    for (const d of r.diagnostics) { const k = `${d.reason}: ${d.error ?? ""}`; total.reasons[k] = (total.reasons[k] ?? 0) + 1; }
    if (r.hot() && !w.length) total.knownAtEnd += 1;
    if (w.length && firstWrong.length < 5) firstWrong.push({ seed, wrong: w.slice(0, 3) });
    void script;
  }
  console.log("  " + J(total));
  check(total.wrong === 0, `never an answer more than a pixel from the truth: ${total.wrong} wrong in ${total.answers} answers shown over ${total.sessions} sessions ${firstWrong.length ? J(firstWrong) : ""}`);
  check(total.movesWhileSettling === 0, `moves given to the estimator while settling: ${total.movesWhileSettling} of ${total.moves}`);
  check(total.restAnswersWhileSettling === 0, `rest answers taken while settling: ${total.restAnswersWhileSettling} (noteRest called while settling ${total.restsWhileSettling} times of ${total.rests}: a question that was in flight when the page started over)`);
  check(total.knownAtEnd >= total.sessions * 0.95, `known and right in the end (two positions and rests, idle guest): ${total.knownAtEnd} of ${total.sessions}`);
  // (My rig has no DOM: relative mode's overlay cannot be made, one "cursor-mode-dom-error" per mode change.
  // Not the page's: nothing to do with inference. My first version of this check counted them.)
  const hotspotDiagnostics = Object.entries(total.reasons).filter(([k]) => k.startsWith("cursor-hotspot")).reduce((n, [, v]) => n + v, 0);
  check(hotspotDiagnostics === 0, `hotspot diagnostics: ${hotspotDiagnostics} (all diagnostics: ${J(total.reasons)})`);
}

console.log("P7 (i) — the cursor is hidden by a move with resource 0 while a rest question is in flight, and shown again elsewhere");
{
  for (const variant of ["shown again, update only seen before the answer", "shown again with its move before the answer", "stays hidden"]) {
    const pending = [];
    const r = watch(makeRig({ size: 64, counter: () => () => new Promise((resolve) => pending.push(resolve)) })); r.hots = HOTS; r.plane = [0, 0];
    const g = makeGuest(r);
    const deliver = async (v) => { pending.shift()(v); await r.flush(); };
    g.send(1270, 10); g.act(); await r.flush(); await deliver(1); await r.wait(HOTSPOT_POLL_MS); await deliver(2);      // settled
    const settled = !r.settling();
    // the caret, undecided (a straight approach), pointer at rest: the rest question goes out
    for (const px of [930, 924]) { g.send(px, 300); g.act(1, "arrow"); await r.wait(16); }
    for (const px of [918, 912]) { g.send(px, 300); g.act(1, "caret"); await r.wait(16); }
    await r.wait(HOTSPOT_REST_MS + 5);
    const asked = pending.length;
    g.hide(); g.image = null;
    // the guest's pointer is moved while hidden (a position the page sent; the guest acts, shows nothing)
    if (variant !== "stays hidden") {
      // NO position is sent (that alone would void the answer): the cursor comes back where the
      // pointer is, but the plane had been parked elsewhere while hidden.
      r.plane = [40, 40];
      if (variant.includes("update only")) r.U("caret", r.plane[0], r.plane[1]);
      else g.report("caret");
    }
    await deliver(7); await r.wait(HOTSPOT_POLL_MS); if (pending.length) await deliver(8);
    await r.wait(50);
    const shown = r.hot();
    check(settled && asked === 1 && wrongOf(r).length === 0 && (shown === null || J(shown) === "[4,8]"),
      `${variant}: question in flight (${asked}); after its answer the page shows ${J(shown)} for the caret (true (4,8)); wrong shown: ${J(wrongOf(r))}`);
  }
}

console.log("P7 (ii) — the hook while a rest question is in flight, then one re-report, then the answer");
{
  const pending = [];
  const r = watch(makeRig({ size: 64, counter: () => () => new Promise((resolve) => pending.push(resolve)) })); r.hots = HOTS; r.plane = [0, 0];
  const g = makeGuest(r);
  const deliver = async (v) => { pending.shift()(v); await r.flush(); };
  g.send(1270, 10); g.act(); await r.flush(); await deliver(1); await r.wait(HOTSPOT_POLL_MS); await deliver(2);
  for (const px of [930, 924]) { g.send(px, 300); g.act(1, "arrow"); await r.wait(16); }
  for (const px of [918, 912]) { g.send(px, 300); g.act(1, "caret"); await r.wait(16); }
  await r.wait(HOTSPOT_REST_MS + 5);
  const asked = pending.length;
  r.controller.resetHotspotInference();
  g.report();                                   // the plane where it stands, after the hook
  await deliver(7); await r.wait(HOTSPOT_POLL_MS); await deliver(8); await r.wait(20);
  check(asked === 1 && J(r.hot()) === "[4,8]" && wrongOf(r).length === 0, `question in flight (${asked}); shown after the answer: ${J(r.hot())} (true (4,8))`);
  // the same with the guest one position BEHIND when the hook falls: the answer must wait
  const s = watch(makeRig({ size: 64 })); s.hots = HOTS; s.plane = [0, 0]; const h = makeGuest(s);
  await settleFirst(s);
  for (const px of [930, 924]) { h.send(px, 300); h.act(1, "arrow"); await s.wait(16); }
  h.send(918, 300); h.act(1, "caret"); await s.wait(16); h.send(912, 300);            // one behind
  await s.wait(HOTSPOT_REST_MS + 5);
  s.controller.resetHotspotInference(); h.report();
  await s.wait(3000);
  const behind = s.hot();
  h.act(); await s.wait(HOTSPOT_REST_MS + 3 * HOTSPOT_POLL_MS + 2000);
  check(behind === null && J(s.hot()) === "[4,8]" && wrongOf(s).length === 0, `guest a position behind at the hook: nothing for 3 s (${J(behind)}); (4,8) once it caught up: ${J(s.hot())}`);
}
console.log(failures === 0 ? "\nALL PREDICTIONS HELD" : `\n${failures} PREDICTION(S) FAILED`);
