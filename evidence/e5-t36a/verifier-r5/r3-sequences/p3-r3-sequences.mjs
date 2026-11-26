// P3 of predictions.txt: round 3's refuting sequences (verifier-r3/p3-stale-rereport.mjs, cases
// A, M, B, C, D — the same positions, times and device order) against round 4's controller.
// The harness is adapted, not the product: the page is settled first (one position far away,
// the guest idle after it), and every time is shifted by T0. Checks are MY round-4 predictions.
import { settledRig, J, HOTS } from "./harness-r4.mjs";

let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };
const T0 = 200;
function tracked(r, log) {
  let last = J(r.hot()) + r.shown;
  const note = (what) => log.push(`  t=${String(Math.round(r.now - T0)).padStart(5)}  ${what.padEnd(66)} shown=${r.shown ?? "-"} inferred=${J(r.hot())} css=${J(r.css())} outstanding=${r.outstanding} settling=${r.settling()}`);
  r.answers = [];
  const sample = () => { const key = J(r.hot()) + r.shown; if (key !== last) { last = key; r.answers.push([Math.round(r.now - T0), r.shown, r.hot()]); note("  (answer changed)"); } };
  r.onTick = sample;
  return { note: (what) => { sample(); note(what); } };
}
const wrong = (r) => r.answers.filter(([, image, hot]) => hot && (Math.abs(hot[0] - HOTS[image][0]) > 1 || Math.abs(hot[1] - HOTS[image][1]) > 1));
const RESTARTS = {
  "resetHotspotInference()": (r) => r.controller.resetHotspotInference(),
  "relative mode and back": (r) => { r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); },
};

// ── A: the even run that starts from the rest position ──
for (const [way, restart] of Object.entries(RESTARTS)) {
  for (const [image, step] of [["hand", [6, 0]], ["arrow", [5, 3]], ["caret", [-4, -2]]]) {
    const truth = HOTS[image];
    const r = await settledRig();
    const log = []; const { note } = tracked(r, log);
    let [x, y] = [300, 400];
    (await r.at(T0)).S(x, y).commit(image, x, y, 1); note(`S(${x},${y}); guest reports it`);
    await r.at(T0 + 900); note("(at rest)");
    const before = r.hot();
    await r.at(T0 + 1000); restart(r); note(`START OVER by ${way} — pointer at rest, guest idle`);
    await r.at(T0 + 1900); note("(0.9 s later)");
    const settlingAfter = r.settling(); const afterRestart = r.hot();
    let t = T0 + 2000;
    x += step[0]; y += step[1]; (await r.at(t)).S(x, y); note(`S(${x},${y})  [first position after starting over]`);
    (await r.at(t + 5)).commit(image, x - step[0], y - step[1], 0); note("guest commits for another reason: plane re-reported where it is");
    const afterStale = r.hot();
    const during = [];
    for (let i = 1; i < 12; i += 1) {
      t += 16; x += step[0]; y += step[1];
      (await r.at(t)).S(x, y);
      (await r.at(t + 4)).commit(image, x - step[0], y - step[1], 1); during.push(J(r.hot()));
      if (i <= 2) note(`S(${x},${y}); guest reports (${x - step[0]},${y - step[1]})`);
    }
    (await r.at(t + 20)).commit(image, x, y, 1); note(`guest reports the last position (${x},${y}): caught up`);
    const atCatchUp = r.hot();
    await r.at(t + 5000); note("(pointer at rest for 5 s)");
    const atRest = r.hot(); const cssAtRest = r.css();
    const later = [];
    for (const [px, py] of [[520, 330], [610, 470], [700, 380], [640, 300]]) {
      (await r.wait(400)).S(px, py).commit(image, px, py, 1); later.push(J(r.hot()));
    }
    await r.wait(1000);
    const roundThree = [truth[0] + step[0], truth[1] + step[1]];
    console.log(`A — ${image} (true ${J(truth)}), start over by ${way}, even run of ${J(step)} from rest\n` + log.join("\n"));
    console.log(`  before ${J(before)}; 0.9 s after ${J(afterRestart)}, settling ${settlingAfter}; after the re-report ${J(afterStale)}; during the run ${[...new Set(during)].join(" ")}; at catch-up ${J(atCatchUp)}`);
    console.log(`  AT REST 5 s: inferred ${J(atRest)}, css ${J(cssAtRest)}; after each later jump: ${later.join(" ")}; finally ${J(r.hot())}`);
    check(wrong(r).length === 0, `never a wrong hotspot (round 3 showed ${J(roundThree)}): wrong answers shown ${J(wrong(r))}`);
    if (way.startsWith("reset")) {
      check(settlingAfter === false && afterRestart === null && afterStale === null && during.every((d) => d === "null") && J(atCatchUp) === J(truth) && J(atRest) === J(truth),
        `predicted: the hook starts no settling; nothing during the run; the truth at the move for the last position and at rest`);
    } else {
      check(settlingAfter === true && afterStale === null && during.every((d) => d === "null") && atRest === null && J(r.hot()) === J(truth),
        `predicted: settling from the mode change; nothing during the run, nothing at rest for 5 s, the truth after a later jump and rest: observed after-restart ${J(afterRestart)}, during ${[...new Set(during)].join(" ")}, at rest ${J(atRest)}, finally ${J(r.hot())}`);
    }
    console.log();
  }
}

// ── M: relative mode and back on an image NOT yet settled, guest busy, then the run ──
{
  const r = await settledRig();
  const log = []; const { note } = tracked(r, log);
  let [x, y] = [300, 400];
  r.busy = true;
  (await r.at(T0)).S(x, y).commit("hand", x, y, 1); note("S(300,400); guest reports it — and stays busy with other work");
  await r.at(T0 + 800); note("(0.8 s at rest, guest busy: no rest answer)");
  const before = r.hot();
  r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); note("START OVER: relative mode and back, no relative motion");
  await r.at(T0 + 1000); r.busy = false; note("(the guest goes idle)");
  await r.at(T0 + 1900); note("(0.9 s later)");
  const settling = r.settling();
  let t = T0 + 2000;
  x += 6; (await r.at(t)).S(x, y); (await r.at(t + 5)).commit("hand", x - 6, y, 0); note("S(306,400); guest commits for another reason: plane re-reported");
  for (let i = 1; i < 12; i += 1) { t += 16; x += 6; (await r.at(t)).S(x, y); (await r.at(t + 4)).commit("hand", x - 6, y, 1); }
  (await r.at(t + 20)).commit("hand", x, y, 1); note("guest caught up");
  await r.at(t + 5000); note("(pointer at rest for 5 s)");
  const atRest = r.hot(); const settledThen = r.settling();
  (await r.wait(100)).S(x + 9, y + 5).commit("hand", x + 9, y + 5, 1); await r.wait(1000); note("one more position, rest");
  console.log("M — relative mode and back at rest on an unsettled image, then an even run\n" + log.join("\n"));
  check(before === null && settling === true && wrong(r).length === 0 && atRest === null && settledThen === false && J(r.hot()) === "[9,4]",
    `predicted: none before (${J(before)}), still settling 0.9 s after the mode change (${settling}); never wrong (${J(wrong(r))}); nothing at rest (${J(atRest)}), settled by then (${!settledThen}); (9,4) after one more position: ${J(r.hot())} (round 3: (15,4))`);
  console.log();
}

// ── B: the image flips away and back at the stale place ──
{
  const r = await settledRig();
  const log = []; const { note } = tracked(r, log);
  (await r.at(T0)).S(300, 400).commit("hand", 300, 400, 1); note("S(300,400); guest reports it (hand)");
  await r.at(T0 + 1000); r.controller.resetHotspotInference(); note("HOOK — pointer at rest, guest idle");
  (await r.at(T0 + 2000)).S(306, 400); note("S(306,400)");
  (await r.at(T0 + 2003)).commit("hand", 300, 400, 0); note("guest commits for another reason (hand re-reported)");
  (await r.at(T0 + 2006)).commit("arrow", 300, 400, 0); note("the image flips to the arrow at the same pointer position");
  (await r.at(T0 + 2009)).commit("hand", 300, 400, 0); note("... and back to the hand");
  const afterFlip = r.hot();
  (await r.at(T0 + 2020)).commit("hand", 306, 400, 1); note("guest reports (306,400): caught up");
  const atCatchUp = r.hot();
  await r.at(T0 + 7000); note("(rest 5 s)");
  console.log("B — the image flips away and back at the stale place\n" + log.join("\n"));
  check(afterFlip === null && J(atCatchUp) === "[9,4]" && J(r.hot()) === "[9,4]" && wrong(r).length === 0,
    `predicted nothing after the flip (${J(afterFlip)}), (9,4) when the guest reports (306,400) (${J(atCatchUp)}) and at rest (${J(r.hot())}); round 3: (15,4)`);
  console.log();
}

// ── C: control — the restart by an output-size change happens ON the first sent position ──
{
  const r = await settledRig();
  const log = []; const { note } = tracked(r, log);
  (await r.at(T0)).S(300, 400).commit("hand", 300, 400, 1); note("S(300,400); guest reports it (hand)");
  await r.at(T0 + 1000); r.controller.resetHotspotInference(); await r.at(T0 + 1900);
  let [x, y] = [306, 400]; let t = T0 + 2000;
  (await r.at(t)).S(x, y, 1280, 801); note("S(306,400) at 801 rows: the restart by size, on this position");
  (await r.at(t + 5)).commit("hand", 300, 400, 0); note("guest commits for another reason: plane re-reported");
  for (let i = 1; i < 12; i += 1) { t += 16; x += 6; (await r.at(t)).S(x, y, 1280, 801); (await r.at(t + 4)).commit("hand", x - 6, y, 1); }
  (await r.at(t + 20)).commit("hand", x, y, 1); note("guest caught up");
  await r.at(t + 5000); note("(rest 5 s)");
  const atRest = r.hot();
  (await r.wait(100)).S(x + 9, y + 5, 1280, 801).commit("hand", x + 9, y + 5, 1); await r.wait(1000); note("one more position, rest");
  console.log("C — control: restart by output size on the first position of the same run\n" + log.join("\n"));
  check(wrong(r).length === 0 && J(r.hot()) === "[9,4]", `predicted never wrong: answers shown ${J(r.answers.filter((a) => a[2]))}; at rest after the run ${J(atRest)}; finally ${J(r.hot())}`);
  console.log();
}

// ── D: the same re-report with the history intact (no restart) ──
{
  const r = await settledRig();
  const log = []; const { note } = tracked(r, log);
  let [x, y] = [300, 400]; let t = T0 + 2000;
  (await r.at(T0)).S(x, y).commit("hand", x, y, 1);
  (await r.at(T0 + 50)).commit("caret", x, y, 0); note("caret installed at rest (first move of the caret)");
  x += 6; (await r.at(t)).S(x, y); (await r.at(t + 5)).commit("caret", x - 6, y, 0); note("S(306,400); re-report of the caret's place");
  for (let i = 1; i < 12; i += 1) { t += 16; x += 6; (await r.at(t)).S(x, y); (await r.at(t + 4)).commit("caret", x - 6, y, 1); }
  (await r.at(t + 20)).commit("caret", x, y, 1); await r.at(t + 5000); note("(rest 5 s)");
  console.log("D — control: the same re-report with the history intact (no restart)\n" + log.join("\n"));
  check(wrong(r).length === 0 && J(r.hot()) === "[4,8]", `predicted right: answers ${J(r.answers.filter((a) => a[2]))}, at rest ${J(r.hot())} (true (4,8))`);
  console.log();
}
console.log(failures === 0 ? "ALL PREDICTIONS HELD" : `${failures} PREDICTION(S) FAILED`);
