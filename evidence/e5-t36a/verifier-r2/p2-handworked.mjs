// P2 of predictions.txt: the hand-worked sequence, through the real CursorController.
// 24x24 images, arrow (1,1), hand (9,4); the guest one position behind; device order.
import { makeRig } from "./harness.mjs";

function base() {
  const r = makeRig({ size: 24 });
  const log = [];
  const note = (what) => log.push(`  t=${String(r.now).padStart(4)}  ${what.padEnd(58)} shown=${r.shown ?? "-"} inferred=${JSON.stringify(r.hot())} css=${JSON.stringify(r.css())}`);
  r.onRest = () => note("rest timer fired");
  r.at(0).S(300, 200); note("S(300,200)");
  r.at(16).S(290, 200).U("arrow", 500, 500).M("arrow", 299, 199); note("S(290,200) U(arrow@500,500) M(arrow,299,199)");
  r.at(32).S(280, 200).U("arrow", 299, 199).M("arrow", 289, 199); note("S(280,200) U(arrow@299,199) M(arrow,289,199)");
  r.at(48).S(270, 200).U("arrow", 289, 199).M("arrow", 279, 199); note("S(270,200) U(arrow@289,199) M(arrow,279,199)");
  r.at(64).S(260, 200).U("hand", 279, 199); note("S(260,200) U(hand@279,199)");
  r.M("hand", 261, 196); note("M(hand,261,196)");
  r.at(80).S(250, 200).U("hand", 261, 196).M("hand", 251, 196); note("S(250,200) U(hand@261,196) M(hand,251,196)");
  return { r, log, note };
}

{
  const { r, log, note } = base();
  r.at(96).U("hand", 251, 196).M("hand", 241, 196); note("U(hand@251,196) M(hand,241,196)");
  r.at(1000); note("(pointer at rest)");
  console.log("MAIN — the guest catches up before the rest wait\n" + log.join("\n"));
  console.log(`  => hand ${JSON.stringify(r.hot())} (true (9,4))\n`);
}
{
  const { r, log, note } = base();
  r.at(379); note("(guest silent since t=80)");
  r.at(381); note("(after the rest wait)");
  r.at(500).U("hand", 251, 196).M("hand", 241, 196); note("U(hand@251,196) M(hand,241,196)  [guest catches up]");
  r.at(2000); note("(pointer at rest)");
  console.log("E1 — the rest wait fires while the guest is one position behind; nothing more sent\n" + log.join("\n"));
  console.log(`  => hand ${JSON.stringify(r.hot())} (true (9,4))\n`);
}
{
  const { r, log, note } = base();
  r.at(381); note("(after the rest wait)");
  r.at(450).S(240, 200); note("S(240,200)  [the user nudges on along the line]");
  r.at(500).U("hand", 251, 196).M("hand", 241, 196); note("U(hand@251,196) M(hand,241,196)  [guest reports (250,200)]");
  r.at(516).U("hand", 241, 196).M("hand", 231, 196); note("U(hand@241,196) M(hand,231,196)  [guest reports (240,200)]");
  r.at(600).U("hand", 231, 196).M("hand", 231, 196); note("U(hand@231,196) M(hand,231,196)  [same image, same place]");
  r.at(10_000); note("(pointer at rest for 9 s)");
  console.log("E2 — the same, but one more position is sent before the guest catches up\n" + log.join("\n"));
  console.log(`  => hand ${JSON.stringify(r.hot())} at rest, css ${JSON.stringify(r.css())} (true (9,4)); rest timers armed: ${r.timers.size}`);
  // How long does it stay? The user goes on along the same line, 10 px a step, guest one behind.
  let x = 240; let steps = 0;
  for (; steps < 20; steps += 1) {
    x -= 10; r.wait(16).S(x, 200).U("hand", x + 20 - 9, 196).M("hand", x + 10 - 9, 196);
  }
  r.wait(16).U("hand", x + 10 - 9, 196).M("hand", x - 9, 196);
  r.wait(5000);
  console.log(`  after 20 more positions along the same line and 5 s of rest: hand ${JSON.stringify(r.hot())}, css ${JSON.stringify(r.css())}`);
  // And then three moves somewhere else.
  const seq = [[400, 400], [520, 330], [610, 470], [700, 380]];
  for (const [px, py] of seq) { const before = r.guestPlane ?? [x - 9, 196]; r.wait(400).S(px, py).U("hand", before[0], before[1]).M("hand", px - 9, py - 4); r.guestPlane = [px - 9, py - 4];
    console.log(`  jump to (${px},${py}): hand ${JSON.stringify(r.hot())}`); }
  r.wait(1000);
  console.log(`  at rest: hand ${JSON.stringify(r.hot())}\n`);
}

// ── Added after the predictions were checked (not a prediction). I expected the same failure
// with the desktop's 64x64 images on a DECELERATING approach to the right onto the terminal
// (text caret, true hotspot (4,8)). It does not fail: the caret's two unevenly spaced moves
// settle (4,8) before the guest stalls, and an answer by moves is not second-guessed at rest.
// Kept as the counter-case: the failure needs the image still undecided when the guest stalls
// (one move since it appeared, or evenly spaced ones).
{
  const r = makeRig({ size: 64 });
  const log = [];
  const note = (what) => log.push(`  t=${String(Math.round(r.now)).padStart(5)}  ${what.padEnd(64)} shown=${r.shown ?? "-"} inferred=${JSON.stringify(r.hot())} css=${JSON.stringify(r.css())}`);
  r.onRest = () => note("rest wait fired");
  // The arrow is known (two far-apart moves).
  r.at(0).S(400, 500).U("arrow", 99, 99).M("arrow", 399, 499); r.at(400).S(700, 300).U("arrow", 399, 499).M("arrow", 699, 299); note("arrow known");
  const xs = [760, 785, 806, 822, 834, 842, 847, 850]; let t = 1000; let plane = [699, 299];
  const commit = (name, x, hot) => { r.U(name, plane[0], plane[1]); plane = [x - hot[0], 300 - hot[1]]; r.M(name, plane[0], plane[1]); };
  // Guest one position behind; the terminal's edge is at x = 795; the caret appears one commit late.
  xs.forEach((x, i) => {
    t += 16; r.at(t).S(x, 300);
    if (i === 0) return;
    const gx = xs[i - 1];
    if (i <= 3) commit("arrow", gx, [1, 1]);          // guest at 760, 785, 806 with the arrow
    else if (i <= 5) commit("caret", gx, [4, 8]);     // guest at 822, 834 with the caret: two caret moves
    // i = 6, 7: the guest is silent (stalled) from here on
    note(`S(${x},300); guest ${i <= 5 ? `reports (${gx},300)` : "silent"}`);
  });
  r.at(t + 299); note("299 ms after the last sent position");
  r.at(t + 301); note("(rest: plane stands for (834,300), last sent (850,300))");
  r.at(t + 380).S(852, 301); note("S(852,301): a 2 px nudge while the guest is still silent");
  r.at(t + 450); commit("caret", 852, [4, 8]); plane[1] = 301 - 8; note("guest resumes: one commit at its latest position (852,301)");
  r.U("caret", plane[0], 292); r.M("caret", 848, 293); note("(the same commit, exact plane (848,293))");
  r.at(t + 5000); note("pointer at rest 4.5 s");
  console.log("E3 — 64x64 caret, decelerating approach to the right, guest stalls two positions behind, one nudge\n" + log.join("\n"));
  console.log(`  => caret ${JSON.stringify(r.hot())} at rest (true (4,8)); rest waits armed: ${r.timers.size}\n`);
}
