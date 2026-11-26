// P3 of predictions.txt: my own hand-worked sequence, through the real CursorController, in the
// device's order, with an idle counter that moves only while the guest has nothing outstanding.
//
// The guest is NOT behind when inference starts over (pointer at rest, guest idle: settling ends
// at the first poll). The restart forgot every sent position — also the one the plane stands
// for. The next commit that does not move the plane re-reports the plane's place (the device
// reports UPDATE and MOVE on every commit), and that MOVE is taken as evidence against a history
// that holds only what was sent after the restart.
import { makeRig, J } from "./harness-r3.mjs";

const HOTS = { arrow: [1, 1], hand: [9, 4], caret: [4, 8] };
let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };

function tracked(r, log) {
  let last = J(r.hot()) + r.shown;
  const note = (what) => log.push(`  t=${String(Math.round(r.now)).padStart(5)}  ${what.padEnd(66)} shown=${r.shown ?? "-"} inferred=${J(r.hot())} css=${J(r.css())} outstanding=${r.outstanding} settling=${r.settling()}`);
  r.answers = [];
  const sample = () => { const key = J(r.hot()) + r.shown; if (key !== last) { last = key; r.answers.push([Math.round(r.now), r.shown, r.hot()]); note("  (answer changed)"); } };
  r.onTick = sample;
  return { note: (what) => { sample(); note(what); } };
}

const RESTARTS = {
  "resetHotspotInference()": (r) => r.controller.resetHotspotInference(),
  "relative mode and back": (r) => { r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); },
};

// ── A: the even run that starts from the rest position ──
for (const [way, restart] of Object.entries(RESTARTS)) {
  for (const [image, step] of [["hand", [6, 0]], ["arrow", [5, 3]], ["caret", [-4, -2]]]) {
    const truth = HOTS[image];
    const r = makeRig({ size: 64 }); r.hots = HOTS; r.plane = [0, 0];
    const log = []; const { note } = tracked(r, log);
    let [x, y] = [300, 400];
    (await r.at(0)).S(x, y).commit(image, x, y, 1); note(`S(${x},${y}); guest reports it`);
    await r.at(900); note("(at rest: settled by the rest rule)");
    const before = r.hot();
    await r.at(1000); restart(r); note(`RESTART by ${way} — pointer at rest, guest idle`);
    await r.at(1900); note("(0.9 s later)");
    const settledAfter = r.settling();
    const afterRestart = r.hot();
    // The user starts an even run. The guest is one position behind; before it has read the
    // first new position it commits a frame for another reason (plane unmoved).
    let t = 2000;
    x += step[0]; y += step[1]; (await r.at(t)).S(x, y); note(`S(${x},${y})  [first position after the restart]`);
    (await r.at(t + 5)).commit(image, x - step[0], y - step[1], 0); note("guest commits for another reason: plane re-reported where it is");
    const afterStale = r.hot();
    const N = 12;
    for (let i = 1; i < N; i += 1) {
      t += 16; x += step[0]; y += step[1];
      (await r.at(t)).S(x, y);
      (await r.at(t + 4)).commit(image, x - step[0], y - step[1], 1);
      if (i <= 2) note(`S(${x},${y}); guest reports (${x - step[0]},${y - step[1]})`);
    }
    const duringRun = r.hot();
    (await r.at(t + 20)).commit(image, x, y, 1); note(`guest reports the last position (${x},${y}): caught up`);
    await r.at(t + 5000); note("(pointer at rest for 5 s)");
    const atRest = r.hot(); const cssAtRest = r.css(); const armed = r.timers.size;
    // How long does it last? An idle guest, three more positions elsewhere (zero lag).
    const later = [];
    for (const [px, py] of [[520, 330], [610, 470], [700, 380], [640, 300]]) {
      (await r.wait(400)).S(px, py).commit(image, px, py, 1); later.push(J(r.hot()));
    }
    await r.wait(1000);
    const predicted = [truth[0] + step[0], truth[1] + step[1]];
    console.log(`A — ${image} (true ${J(truth)}), restart by ${way}, even run of ${J(step)} from rest\n` + log.join("\n"));
    console.log(`  before the restart ${J(before)}; 0.9 s after it ${J(afterRestart)}, settling ${settledAfter}; after the re-report ${J(afterStale)}; during the run ${J(duringRun)}`);
    console.log(`  AT REST 5 s: inferred ${J(atRest)}, css ${J(cssAtRest)}, timers armed ${armed}; after each later jump: ${later.join(" ")}; finally ${J(r.hot())}`);
    if (way.startsWith("relative")) console.log("  (this row starts from a SETTLED image — my script settles it by rest before the restart — and a mode change keeps settled hotspots; predictions.txt said \"nothing settled\": see M below for the unsettled case)");
    check(J(atRest) === J(predicted) && J(cssAtRest) === J(predicted),
      `predicted a WRONG hotspot at rest = truth + step = ${J(predicted)}: observed ${J(atRest)} — ${J(atRest) === J(truth) ? "the code is RIGHT here, my prediction failed" : "wrong hotspot shown at rest"}`);
    console.log();
  }
}

// ── M: the same by a user's own actions — relative mode and back on an image NOT yet settled ──
// (A's relative-mode rows above start from a SETTLED image, which a mode change keeps: right.)
// The guest is busy with other work when the pointer arrives and rests (no rest answer: the
// claim's limit 1); the user toggles relative mode and back at rest (or Pointer Lock is denied);
// the guest becomes idle; the user moves on in an even run.
{
  const r = makeRig({ size: 64 }); r.hots = HOTS; r.plane = [0, 0];
  const log = []; const { note } = tracked(r, log);
  let [x, y] = [300, 400];
  r.busy = true;
  (await r.at(0)).S(x, y).commit("hand", x, y, 1); note("S(300,400); guest reports it — and stays busy with other work");
  await r.at(800); note("(0.8 s at rest, guest busy: no rest answer)");
  const before = r.hot();
  r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); note("RESTART: relative mode and back, no relative motion");
  await r.at(1000); r.busy = false; note("(the guest goes idle)");
  await r.at(1900); note("(0.9 s later)");
  const settling = r.settling();
  let t = 2000; const step = [6, 0];
  x += 6; (await r.at(t)).S(x, y); (await r.at(t + 5)).commit("hand", x - 6, y, 0); note("S(306,400); guest commits for another reason: plane re-reported");
  for (let i = 1; i < 12; i += 1) { t += 16; x += 6; (await r.at(t)).S(x, y); (await r.at(t + 4)).commit("hand", x - 6, y, 1); }
  (await r.at(t + 20)).commit("hand", x, y, 1); note("guest caught up");
  await r.at(t + 5000); note("(pointer at rest for 5 s)");
  console.log("M — relative mode and back at rest on an unsettled image, then an even run\n" + log.join("\n"));
  check(before === null && settling === false && J(r.hot()) === "[15,4]", `predicted (after seeing A; not in predictions.txt in this form): none before (${J(before)}), settling over (${settling}), hand (15,4) at rest: ${J(r.hot())} css ${J(r.css())} (true (9,4))`);
  console.log();
}

// ── B: no even run — the image flips away and back at the stale place ──
{
  const r = makeRig({ size: 64 }); r.hots = HOTS; r.plane = [0, 0];
  const log = []; const { note } = tracked(r, log);
  (await r.at(0)).S(300, 400).commit("hand", 300, 400, 1); note("S(300,400); guest reports it (hand)");
  await r.at(1000); r.controller.resetHotspotInference(); note("RESTART — pointer at rest, guest idle");
  (await r.at(2000)).S(306, 400); note("S(306,400)");
  (await r.at(2003)).commit("hand", 300, 400, 0); note("guest commits for another reason (hand re-reported)");
  (await r.at(2006)).commit("arrow", 300, 400, 0); note("the image flips to the arrow at the same pointer position");
  (await r.at(2009)).commit("hand", 300, 400, 0); note("... and back to the hand");
  const afterFlip = r.hot();
  (await r.at(2020)).commit("hand", 306, 400, 1); note("guest reports (306,400): caught up");
  await r.at(7000); note("(rest 5 s)");
  console.log("B — the image flips away and back at the stale place\n" + log.join("\n"));
  check(J(afterFlip) === "[15,4]" && J(r.hot()) === "[15,4]", `predicted hand (15,4) from the second report and at rest: after the flip ${J(afterFlip)}, at rest ${J(r.hot())} (true (9,4))`);
  console.log();
}

// ── C: control — the restart by an output-size change happens ON the first sent position ──
{
  const r = makeRig({ size: 64 }); r.hots = HOTS; r.plane = [0, 0];
  const log = []; const { note } = tracked(r, log);
  (await r.at(0)).S(300, 400).commit("hand", 300, 400, 1); note("S(300,400); guest reports it (hand)");
  // (not settled before: keep the hand unsettled by restarting at once through the explicit hook,
  // then let the size change be the restart under test)
  await r.at(1000); r.controller.resetHotspotInference(); await r.at(1900);
  let [x, y] = [306, 400]; let t = 2000;
  (await r.at(t)).S(x, y, 1280, 801); note("S(306,400) at 801 rows: the restart by size, on this position");
  (await r.at(t + 5)).commit("hand", 300, 400, 0); note("guest commits for another reason: plane re-reported");
  for (let i = 1; i < 12; i += 1) { t += 16; x += 6; (await r.at(t)).S(x, y, 1280, 801); (await r.at(t + 4)).commit("hand", x - 6, y, 1); }
  (await r.at(t + 20)).commit("hand", x, y, 1); note("guest caught up");
  await r.at(t + 5000); note("(rest 5 s)");
  const atRest = r.hot();
  (await r.wait(100)).S(x + 9, y + 5, 1280, 801).commit("hand", x + 9, y + 5, 1); await r.wait(1000); note("one more position, rest");
  console.log("C — control: restart by output size on the first position of the same run\n" + log.join("\n"));
  const wrong = r.answers.filter(([, image, hot]) => hot && (Math.abs(hot[0] - 9) > 1 || Math.abs(hot[1] - 4) > 1));
  check(wrong.length === 0 && J(r.hot()) === "[9,4]", `predicted never wrong: answers shown ${J(r.answers.filter((a) => a[2]))}; at rest after the run ${J(atRest)}; finally ${J(r.hot())}`);
  console.log();
}

// ── D: the same sequence as A WITHOUT the restart (history intact) — the control for the cause ──
{
  const r = makeRig({ size: 64 }); r.hots = HOTS; r.plane = [0, 0];
  const log = []; const { note } = tracked(r, log);
  let [x, y] = [300, 400]; let t = 2000;
  (await r.at(0)).S(x, y).commit("hand", x, y, 1);
  // keep it unsettled without a restart: a second image never rested on. Use a fresh image at the
  // same place after the first position (the caret appears with no sent position in between).
  (await r.at(50)).commit("caret", x, y, 0); note("caret installed at rest (first move of the caret)");
  x += 6; (await r.at(t)).S(x, y); (await r.at(t + 5)).commit("caret", x - 6, y, 0); note("S(306,400); re-report of the caret's place");
  for (let i = 1; i < 12; i += 1) { t += 16; x += 6; (await r.at(t)).S(x, y); (await r.at(t + 4)).commit("caret", x - 6, y, 1); }
  (await r.at(t + 20)).commit("caret", x, y, 1); await r.at(t + 5000); note("(rest 5 s)");
  console.log("D — control: the same re-report with the history intact (no restart)\n" + log.join("\n"));
  const wrong = r.answers.filter(([, image, hot]) => image === "caret" && hot && (Math.abs(hot[0] - 4) > 1 || Math.abs(hot[1] - 8) > 1));
  check(wrong.length === 0 && J(r.hot()) === "[4,8]", `predicted right: caret answers ${J(r.answers.filter((a) => a[1] === "caret" && a[2]))}, at rest ${J(r.hot())} (true (4,8))`);
  console.log();
}
console.log(failures === 0 ? "ALL PREDICTIONS HELD (i.e. the wrong hotspots I predicted are shown)" : `${failures} PREDICTION(S) FAILED`);
