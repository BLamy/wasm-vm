// E5-T36a verifier round 5 — P10: random sessions through the real CursorController with the
// guest of harness-r5.mjs (the device as I read it). What a session may contain:
//   positions (near the last, the SAME pixel again, one axis only, far, back on an earlier one),
//   the guest acting late (FIFO lag) or not at all for a while (busy), commits of its own, image
//   flips, rests, the hook, pointer mode relative with relative motion and back, output-size
//   changes, guest resets, and — the device's own hide, an UPDATE with resource 0 — a client
//   hiding and showing the cursor, a client's pointer lock (the pointer held while positions
//   arrive), a compositor that goes away and starts again at (100,100); a cold boot (positions
//   before any compositor, some before the page notes any).
// What it never contains (the claim's stated limit): the guest's pointer put or held somewhere
// by the guest itself WHILE its cursor is shown and the pointer mode is absolute.
//
// Checked after every event and timer tick:
//   * no hotspot more than one pixel from the truth of the image shown; none while none is shown;
//   * the CSS cursor shows what the controller inferred;
//   * nothing reaches the estimator (noteMove / noteRest) while the controller is settling;
//   * the premise: not settling, a cursor shown, absolute mode => the guest's pointer stands on
//     a position the page remembers.
// And at the end of each session, after three positions far away with rests: known and right.
//
//   node fuzz-r5.mjs [sessions=2000] [seed=0x5eed5]        SINK_DIR=<mutant dir> for a control
import { makeRig, wrong, rng, J, HOTS, REST, sinkDir } from "./harness-r5.mjs";

const SESSIONS = Number(process.argv[2] ?? 2000);
const random = rng(Number(process.argv[3] ?? 0x5eed5));
const int = (n) => Math.floor(random() * n);
const pick = (list) => list[int(list.length)];
const NAMES = ["arrow", "hand", "caret", "cross"];
const tally = { sessions: 0, events: 0, positions: 0, samePixel: 0, oneAxis: 0, relative: 0, relativeMotions: 0, hooks: 0, sizes: 0, resets: 0, hides: 0, locks: 0,
  compositorRestarts: 0, coldBoots: 0, unnoted: 0, commits: 0, flips: 0, dropped: 0, answersShown: 0, wrongSessions: 0, wrongAnswers: 0, otherViolations: 0,
  moveWhileSettling: 0, restWhileSettling: 0, noteMove: 0, noteRest: 0, premiseSessions: 0, premiseSamples: 0, unknownInTheEnd: 0, wrongInTheEnd: 0, diagnostics: 0 };
const examples = []; const reasons = {};
for (let session = 0; session < SESSIONS; session += 1) {
  const r = makeRig({ size: pick([16, 24, 64]), tablet: [int(1280), int(800)] });
  let g = r.guest; const trace = [];
  const note = (what) => { trace.push(`${Math.round(r.now)} ${what}`); tally.events += 1; };
  let at = [200 + int(800), 200 + int(400)]; const visited = [];
  const cold = int(4) === 0;
  if (cold) {
    tally.coldBoots += 1; g.up = false; note("cold boot: no compositor yet");
    // Positions the page sends before it has presented a frame are delivered and not noted.
    for (let i = int(3); i > 0; i -= 1) { at = [150 + int(900), 150 + int(500)]; g.queue.push([...at]); tally.unnoted += 1; note(`unnoted ${at}`); }
  } else { g.show(pick(NAMES), 150 + int(900), 150 + int(500)); note(`session up, ${g.shown} at ${g.pointer}`); }
  // How eventful a session is: in a third of them the ways of starting over come as often as
  // the positions' share allows, in the others a third or an eighth as often (so that inference
  // has time to finish between them).
  const calm = pick([1, 0.35, 0.12]);
  const steps = 60 + int(100) + (calm < 1 ? 120 : 0);
  for (let step = 0; step < steps; step += 1) {
    let roll = random();
    if (roll >= 0.79 && random() > calm) roll = random() * 0.79;
    if (roll < 0.34) {
      if (r.mode !== "absolute") continue;
      const kind = random();
      if (kind < 0.18) { tally.samePixel += 1; }
      else if (kind < 0.34) { at = int(2) ? [at[0] + (int(15) - 7 || 3), at[1]] : [at[0], at[1] + (int(15) - 7 || 3)]; tally.oneAxis += 1; }
      else if (kind < 0.74) at = [at[0] + int(21) - 10, at[1] + int(21) - 10];
      else if (kind < 0.86 && visited.length) at = [...pick(visited)];
      else at = [150 + int(900), 150 + int(500)];
      at = [Math.min(1200, Math.max(80, at[0])), Math.min(740, Math.max(80, at[1]))];
      r.S(at[0], at[1]); visited.push([...at]); if (visited.length > 12) visited.shift();
      tally.positions += 1; note(`S ${at} @${r.output}`);
      if (int(3)) { g.act(1 + int(2)); }
    } else if (roll < 0.46) { g.act(int(4) ? 1 + int(3) : Infinity); note(`act -> pointer ${g.pointer} queue ${g.queue.length}`); }
    else if (roll < 0.56) { if (g.shown && g.up) { g.commit(); tally.commits += 1; note("commit"); } }
    else if (roll < 0.61) { if (g.shown && g.up && !g.locked) { g.commit(pick(NAMES)); tally.flips += 1; note(`flip to ${g.shown}`); } }
    else if (roll < 0.76) { const ms = pick([5, 16, 16, 40, 100, 200, 400, 2500]); await r.wait(ms); note(`wait ${ms}`); }
    else if (roll < 0.79) { r.busy = !r.busy; note(`busy ${r.busy}`); }
    else if (roll < 0.84) {
      if (r.mode !== "absolute") continue;
      tally.relative += 1; r.setMode("relative"); note("relative mode");
      for (let i = int(3); i > 0; i -= 1) { g.rel(int(25) - 12, int(25) - 12); tally.relativeMotions += 1; note(`rel -> pointer ${g.pointer}`); if (int(2)) await r.wait(pick([16, 100])); }
      if (int(3) === 0) { g.act(); }
      r.setMode("absolute"); note("absolute mode");
    } else if (roll < 0.87) { r.hook(); tally.hooks += 1; note("hook"); }
    else if (roll < 0.90) { r.output = pick([[1280, 800], [1280, 801], [1281, 800]]); tally.sizes += 1; note(`output ${r.output}`); }
    else if (roll < 0.915) {
      tally.resets += 1; g = r.reboot([int(1280), int(800)]); note("guest reset");
      if (int(3)) { g.show(pick(NAMES), 150 + int(900), 150 + int(500)); note(`restored session shows ${g.shown} at ${g.pointer}`); } else { g.up = false; note("no compositor yet"); }
    } else {
      // Something to do with the cursor being shown or not.
      if (!g.up) { g.act(); g.compositorStart(pick(NAMES)); tally.compositorRestarts += 1; note(`compositor starts, ${g.shown} at ${g.pointer}, tablet ${g.tablet}`); }
      else if (g.locked) { g.unlock(pick(NAMES)); note(`unlocked, ${g.shown} at ${g.pointer}, tablet ${g.tablet}`); }
      else if (g.shown === null) { g.show(pick(NAMES)); note(`shown again, ${g.shown} at ${g.pointer}`); }
      else {
        const what = int(3);
        if (what === 0) { g.hide(); tally.hides += 1; note("hidden by a client"); }
        else if (what === 1) { g.lock(); tally.locks += 1; note("pointer lock in the guest: hidden and held"); }
        else { g.compositorStop(); note("compositor gone"); }
      }
    }
  }
  // The end: a session in its normal state, three positions far from everything, rests.
  if (r.mode !== "absolute") r.setMode("absolute");
  r.busy = false; g.act();
  if (!g.up) g.compositorStart("arrow"); else if (g.locked) g.unlock("arrow"); else if (g.shown === null) g.show("arrow");
  const end = g.shown;
  for (const p of [[1230 - int(20), 760 - int(10)], [1150 - int(20), 770 - int(10)], [1240 - int(20), 780 - int(10)]]) { r.S(p[0], p[1]); g.act(); await r.wait(REST); note(`end S ${p}`); }
  const final = r.hot(); const truth = HOTS[end];
  tally.sessions += 1; tally.dropped += g.dropped;
  // (The rig has no DOM: the overlay of relative mode cannot be made. Not the page's.)
  r.diagnostics = r.diagnostics.filter((d) => d.error !== "cursor overlay DOM is unavailable");
  tally.diagnostics += r.diagnostics.length;
  for (const d of r.diagnostics) { const k = `${d.reason}${d.error ? `: ${d.error}` : ""}`; reasons[k] = (reasons[k] ?? 0) + 1; }
  tally.answersShown += r.answers.filter((a) => a.hot).length;
  tally.noteMove += r.estimator.calls.noteMove; tally.noteRest += r.estimator.calls.noteRest;
  tally.moveWhileSettling += r.estimator.calls.moveWhileSettling; tally.restWhileSettling += r.estimator.calls.restWhileSettling;
  const w = wrong(r);
  if (w.length) { tally.wrongSessions += 1; tally.wrongAnswers += r.answers.filter((a) => a.hot && a.image && Math.max(Math.abs(a.hot[0] - HOTS[a.image][0]), Math.abs(a.hot[1] - HOTS[a.image][1])) > 1).length; }
  tally.otherViolations += r.violations.length - w.length;
  if (r.premise) { tally.premiseSessions += 1; tally.premiseSamples += r.premise; }
  const knownRight = final !== null && Math.max(Math.abs(final[0] - truth[0]), Math.abs(final[1] - truth[1])) <= 1;
  if (final === null) tally.unknownInTheEnd += 1; else if (!knownRight) tally.wrongInTheEnd += 1;
  if ((w.length || r.premise || !knownRight || r.violations.length > w.length || r.estimator.calls.moveWhileSettling) && examples.length < 3) {
    examples.push({ session, size: r.size, firstWrong: w[0] ?? null, firstPremise: r.firstPremise ?? null, otherViolation: r.violations.find((v) => v.what !== "wrong hotspot") ?? null,
      final, end, truth, trace: trace.slice(-40) });
  }
  r.controller.dispose();
}
console.log(J({ sinkDir: sinkDir.replace(/^.*\/(web\/src\/sink|sinks\/[^/]+)$/, "$1"), ...tally , diagnosticReasons: reasons }));
for (const example of examples) console.log(`EXAMPLE ${J(example)}`);
