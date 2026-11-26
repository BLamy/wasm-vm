// P2 of predictions.txt: round 2's refuting sequences (its p2-handworked.mjs cases MAIN, E1, E2
// and its attacks-r2.mjs §4, three ways), through the round-3 CursorController with an idle
// counter that moves only while the guest has nothing outstanding. 24x24 images, arrow (1,1),
// hand (9,4); the guest one position behind; device order.
import { makeRig, J } from "./harness-r3.mjs";

const HOTS = { arrow: [1, 1], hand: [9, 4] };
let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };

function tracked(r, log) {
  let last = J(r.hot()) + r.shown;
  const note = (what) => log.push(`  t=${String(Math.round(r.now)).padStart(5)}  ${what.padEnd(60)} shown=${r.shown ?? "-"} inferred=${J(r.hot())} css=${J(r.css())} outstanding=${r.outstanding} settling=${r.settling()}`);
  r.answers = []; // every (time, image, answer) the controller showed, as it changed
  const sample = () => { const key = J(r.hot()) + r.shown; if (key !== last) { last = key; r.answers.push([Math.round(r.now), r.shown, r.hot()]); note("  (answer changed)"); } };
  r.onTick = sample;
  return { note: (what) => { sample(); note(what); } };
}

async function base() {
  const r = makeRig({ size: 24 }); r.hots = HOTS; r.plane = [500, 500];
  const log = []; const { note } = tracked(r, log);
  (await r.at(0)).S(300, 200); note("S(300,200)");
  (await r.at(16)).S(290, 200).commit("arrow", 300, 200, 1); note("S(290,200); guest reports (300,200) with the arrow");
  (await r.at(32)).S(280, 200).commit("arrow", 290, 200, 1); note("S(280,200); guest reports (290,200)");
  (await r.at(48)).S(270, 200).commit("arrow", 280, 200, 1); note("S(270,200); guest reports (280,200)");
  (await r.at(64)).S(260, 200).commit("hand", 270, 200, 1); note("S(260,200); guest reports (270,200), now the hand");
  (await r.at(80)).S(250, 200).commit("hand", 260, 200, 1); note("S(250,200); guest reports (260,200)");
  return { r, log, note };
}
const wrongHand = (r) => r.answers.filter(([, image, hot]) => image === "hand" && hot && (Math.abs(hot[0] - 9) > 1 || Math.abs(hot[1] - 4) > 1));

{
  const { r, log, note } = await base();
  (await r.at(96)).commit("hand", 250, 200, 1); note("guest reports (250,200): caught up");
  await r.at(245); note("(149 ms of quiet)");
  await r.at(1000); note("(pointer at rest)");
  console.log("MAIN — the guest catches up before the rest wait\n" + log.join("\n"));
  const first = r.answers.find(([, image, hot]) => image === "hand" && hot);
  check(J(r.hot()) === "[9,4]" && wrongHand(r).length === 0, `hand ${J(r.hot())} at rest (true (9,4)); first answer for the hand at t=${first?.[0]} (predicted 286); wrong answers shown: ${wrongHand(r).length}`);
  check(first?.[0] === 286, `the hand's answer arrived at t=${first?.[0]} (predicted 286 = 96 + 150 + 40)`);
  console.log();
}
{
  const { r, log, note } = await base();
  await r.at(381); note("(rest wait elapsed at t=230; guest silent, one position behind)");
  await r.at(499); note("(still silent)");
  (await r.at(500)).commit("hand", 250, 200, 1); note("guest reports (250,200): caught up");
  await r.at(2000); note("(pointer at rest)");
  console.log("E1 — the rest wait elapses while the guest is one position behind; nothing more sent\n" + log.join("\n"));
  const first = r.answers.find(([, image, hot]) => image === "hand" && hot);
  check(J(r.hot()) === "[9,4]" && wrongHand(r).length === 0, `hand ${J(r.hot())} (true (9,4)); wrong answers shown: ${wrongHand(r).length}`);
  check(first?.[0] >= 500 && first?.[0] <= 690, `first answer for the hand at t=${first?.[0]} (predicted 510, at the latest 690; never before the guest reported at 500)`);
  console.log();
}
{
  const { r, log, note } = await base();
  await r.at(381); note("(after the rest wait: round 2 observed (0,4) here)");
  const at381 = r.hot();
  (await r.at(450)).S(240, 200); note("S(240,200)  [the user nudges on along the line]");
  (await r.at(500)).commit("hand", 250, 200, 1); note("guest reports (250,200)");
  (await r.at(516)).commit("hand", 240, 200, 1); note("guest reports (240,200): caught up");
  const at516 = r.hot();
  (await r.at(600)).commit("hand", 240, 200, 0); note("a commit for another reason: same image, same place");
  await r.at(10_000); note("(pointer at rest for 9 s)");
  console.log("E2 — the same, but one more position is sent before the guest catches up (round 2's refutation)\n" + log.join("\n"));
  const first = r.answers.find(([, image, hot]) => image === "hand" && hot);
  check(at381 === null && at516 === null, `no answer at t=381 (${J(at381)}) nor when the guest caught up at t=516 (${J(at516)})`);
  check(first?.[0] >= 640 && first?.[0] <= 710, `first answer for the hand at t=${first?.[0]} (predicted 640..710 — MY ARITHMETIC: the commit at t=600 re-arms the 150 ms wait, 600+150+40 = 790; the value is as predicted)`);
  check(J(r.hot()) === "[9,4]" && J(r.css()) === "[9,4]", `at rest after 9 s: hand ${J(r.hot())}, css ${J(r.css())} (true (9,4))`);
  // The user goes on along the same line, 10 px a step, the guest one behind.
  let x = 240;
  for (let step = 0; step < 20; step += 1) { x -= 10; (await r.wait(16)).S(x, 200).commit("hand", x + 10, 200, 1); }
  (await r.wait(16)).commit("hand", x, 200, 1);
  await r.wait(5000);
  check(J(r.hot()) === "[9,4]", `after 20 more positions along the line (guest one behind) and 5 s of rest: hand ${J(r.hot())}`);
  for (const [px, py] of [[400, 400], [520, 330], [610, 470], [700, 380]]) { (await r.wait(400)).S(px, py).commit("hand", px, py, 1); }
  await r.wait(1000);
  check(J(r.hot()) === "[9,4]" && wrongHand(r).length === 0, `after four jumps: hand ${J(r.hot())}; wrong answers shown in the whole run: ${wrongHand(r).length} ${J(wrongHand(r))}`);
  console.log();
}

// ── Round 2's §4: inference started over while the guest is one position behind on an even run.
for (const way of ["output size 800 -> 801 rows", "relative mode and back", "resetHotspotInference()"]) {
  const r = makeRig({ size: 24 }); r.hots = HOTS; r.plane = [500, 500];
  const log = []; const { note } = tracked(r, log);
  // The arrow is settled first (two far-apart moves), as in a session that has been used.
  (await r.at(0)).S(400, 500).commit("arrow", 400, 500, 1); (await r.at(400)).S(700, 300).commit("arrow", 700, 300, 1);
  note("arrow settled");
  let t = 1000; let x = 600; let h = 800;
  // An even run to the left, 10 px a step, the guest one position behind, the hand from step 3.
  const steps = 14; const restartAt = 6;
  for (let i = 0; i < steps; i += 1) {
    t += 16; await r.at(t);
    if (i === restartAt) {
      if (way.startsWith("output")) h = 801;
      else if (way.startsWith("relative")) { r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); }
      else r.controller.resetHotspotInference();
      note(`RESTART (${way}); outstanding=${r.outstanding}`);
    }
    x -= 10; r.S(x, 200, 1280, h);
    if (i > 0) r.commit(i >= 3 ? "hand" : "arrow", x + 10, 200, 1);
    note(`S(${x},200); guest reports ${i > 0 ? `(${x + 10},200)` : "nothing yet"}`);
  }
  const duringRun = r.answers.filter(([at, image, hot]) => image === "hand" && hot);
  // The guest stays one behind for 3 s more (silent), then catches up.
  await r.at(t + 3000); note("(guest silent for 3 s, still one position behind)");
  const whileBehind = r.hot(); const settlingWhileBehind = r.settling();
  r.commit("hand", x, 200, 1); note("guest reports the last position: caught up");
  await r.at(t + 8000); note("(pointer at rest 5 s after the guest caught up)");
  const atRest = r.hot();
  // One more sent position and its move, then rest.
  (await r.wait(100)).S(x - 7, 203, 1280, h).commit("hand", x - 7, 203, 1); note("S: a nudge; guest reports it");
  await r.wait(1000); note("(rest)");
  console.log(`§4 — restart by ${way}, the guest one position behind on an even run\n` + log.join("\n"));
  check(duringRun.length === 0 && whileBehind === null && settlingWhileBehind === true, `no answer for the hand during the run (${duringRun.length} shown) nor in 3 s of the guest staying behind (${J(whileBehind)}, settling ${settlingWhileBehind})`);
  check(atRest === null, `at rest after the guest caught up: ${J(atRest)} (predicted none: nothing known until the image moves again)`);
  check(J(r.hot()) === "[9,4]" && wrongHand(r).length === 0, `after one more position and rest: hand ${J(r.hot())}; wrong answers shown: ${J(wrongHand(r))}`);
  console.log();
}
console.log(failures === 0 ? "ALL PREDICTIONS HELD" : `${failures} PREDICTION(S) FAILED`);
