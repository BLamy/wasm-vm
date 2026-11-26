// P6 of predictions.txt: can "settling" end without the guest having been idle after a position
// sent since it began? The real CursorController; the readings of the guest's idle count are
// delivered BY HAND (each call to guestIdleCount returns a promise this script resolves), so
// that a restart, a reset or a position can fall between any two of them.
import { makeRig, J, HOTSPOT_POLL_MS } from "./harness-r4.mjs";

let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; console.log(`  ${ok ? "HELD  " : "FAILED"} ${what}`); };
function manual() {
  const pending = []; let asked = 0;
  const r = makeRig({ size: 64, counter: () => () => { asked += 1; return new Promise((resolve, reject) => pending.push({ resolve, reject, n: asked })); } });
  r.pending = pending; r.asked = () => asked;
  r.deliver = async (value, which = 0) => { const [p] = pending.splice(which, 1); if (!p) throw new Error("no reading in flight"); p.resolve(value); await r.flush(); };
  r.mode = () => { r.controller.setPointerState({ mode: "relative" }); r.controller.setPointerState({ mode: "absolute" }); };
  r.polls = () => [...r.timers.values()].length;
  return r;
}
const st = (r) => `settling=${r.settling()} readings-in-flight=${r.pending.length} timers=${r.polls()} asked=${r.asked()}`;

console.log("a. start over while the question's FIRST reading is in flight");
{
  const r = manual();
  r.S(100, 100); await r.flush();
  const inFlight = r.pending.length;
  r.mode();
  await r.deliver(5);
  const afterReading = st(r);
  await r.wait(10_000);
  check(inFlight === 1 && r.settling() === true && r.pending.length === 0 && r.polls() === 0 && r.asked() === 1,
    `one reading was in flight (${inFlight}); after it arrived: ${afterReading}; 10 s later: ${st(r)} — no poll for a question that is over`);
  r.S(200, 100); await r.flush(); await r.deliver(5); await r.wait(HOTSPOT_POLL_MS); await r.deliver(5); await r.wait(HOTSPOT_POLL_MS);
  const notYet = r.settling();
  await r.deliver(6);
  check(notYet === true && r.settling() === false, `a position sent since, the count unchanged: settling ${notYet}; the count moved on: settling ${r.settling()}`);
}

console.log("b. start over during the poll wait");
{
  const r = manual();
  r.S(100, 100); await r.flush(); await r.deliver(5);
  const polling = r.polls();
  r.mode(); await r.flush();
  await r.wait(10_000);
  check(polling === 1 && r.settling() === true && r.pending.length === 0 && r.polls() === 0 && r.asked() === 1, `a poll wait was armed (${polling}); 10 s after starting over: ${st(r)}`);
}

console.log("c. start over while the SECOND reading is in flight, and it comes back greater");
{
  const r = manual();
  r.S(100, 100); await r.flush(); await r.deliver(5); await r.wait(HOTSPOT_POLL_MS);
  const second = r.pending.length;
  r.mode();
  await r.deliver(6);
  await r.wait(10_000);
  check(second === 1 && r.settling() === true && r.polls() === 0 && r.pending.length === 0, `second reading in flight (${second}); it said "idle since" after the page started over: ${st(r)}`);
  // ... and with a position sent BEFORE the stale reading arrives (the dangerous order): the
  // new question's first reading is asked while the old one's answer is still on its way.
  const s = manual();
  s.S(100, 100); await s.flush(); await s.deliver(5); await s.wait(HOTSPOT_POLL_MS);   // old loop: second reading in flight
  s.mode(); s.S(200, 100); await s.flush();                                            // new loop: first reading in flight
  const two = s.pending.length;
  await s.deliver(9);                // the OLD loop's second reading: far greater than its first
  const afterOld = s.settling();
  await s.deliver(9);                // the new loop's first reading
  await s.wait(HOTSPOT_POLL_MS); await s.deliver(9);
  const sameCount = s.settling();
  await s.wait(HOTSPOT_POLL_MS); await s.deliver(10);
  check(two === 2 && afterOld === true && sameCount === true && s.settling() === false,
    `two readings in flight (${two}); the old loop's "idle since" ends nothing (${afterOld}); the new loop with an unchanged count: ${sameCount}; with its own later idle wait: settling ${s.settling()}`);
}

console.log("d. start over three times back to back (mode, size, mode), a reading in flight for each");
{
  for (const order of [[0, 0, 0], [2, 0, 0], [1, 1, 0], [2, 1, 0]]) {
    const r = manual();
    r.S(100, 100); await r.flush();                   // q1 first reading
    r.mode(); r.S(200, 100); await r.flush();         // q2 first reading
    r.S(300, 100, 1280, 801); await r.flush();        // q3 (size): first reading
    const inFlight = r.pending.length;
    // q1 and q2 get wildly "idle" answers, q3 gets its own first reading
    const values = { 1: 50, 2: 60, 3: 7 };
    for (const which of order) { const n = r.pending[which].n; await r.deliver(values[n], which); }
    const afterFirsts = st(r);
    await r.wait(HOTSPOT_POLL_MS);
    const live = r.pending.length;
    const before = r.settling();
    await r.deliver(8);
    check(inFlight === 3 && live === 1 && before === true && r.settling() === false && r.asked() === 4,
      `delivery order ${J(order)}: ${inFlight} first readings in flight; after them: ${afterFirsts}; exactly one loop polls on (${live}); it ends settling only on its own second reading (${before} -> ${r.settling()}); readings asked in all: ${r.asked()}`);
  }
  // The last restart is NOT followed by a position: nothing may end settling.
  const r = manual();
  r.S(100, 100); await r.flush(); r.mode(); r.S(200, 100); await r.flush(); r.mode();
  while (r.pending.length) await r.deliver(1000);
  await r.wait(10_000);
  check(r.settling() === true && r.polls() === 0 && r.pending.length === 0, `two questions in flight, then a restart with no position after it; both answered "1000": ${st(r)}`);
}

console.log("e. controller.reset() (a guest reset) in the middle of a question");
{
  for (const when of ["first reading in flight", "poll wait", "second reading in flight"]) {
    const r = manual(); r.hots = { hand: [9, 4] }; r.plane = [0, 0];
    r.S(100, 100); await r.flush();
    if (when !== "first reading in flight") await r.deliver(5);
    if (when === "second reading in flight") await r.wait(HOTSPOT_POLL_MS);
    r.controller.reset();
    while (r.pending.length) await r.deliver(99);
    await r.wait(5_000);
    // the new guest's cursor shows up and moves about by itself
    r.commit("hand", 640, 400, 0); r.commit("hand", 500, 300, 0);
    await r.wait(5_000);
    check(r.settling() === true && r.hot() === null && r.polls() === 0 && r.pending.length === 0, `${when}: ${st(r)}, shown ${J(r.hot())}`);
  }
}

console.log("f. a counter that misbehaves");
{
  const cases = {
    "goes down": (i) => 100 - i, "stays": () => 5, "NaN after the first": (i) => (i === 0 ? 5 : NaN), "NaN": () => NaN, "Infinity": () => Infinity,
    "a string that grows": (i) => String(5 + i), "a BigInt that grows": (i) => BigInt(5 + i), "null": () => null, "undefined": () => undefined,
    "an object": () => ({ valueOf: () => 1e9 }), "alternates a number and null": (i) => (i % 2 ? null : 5 + i),
    "rejects": () => { throw new Error("stats failed"); }, "negative, growing towards zero": (i) => -1000 + i * 0 - 1 / (i + 1),
  };
  for (const [name, value] of Object.entries(cases)) {
    let i = 0; let maxTimers = 0;
    const r = makeRig({ size: 64, counter: () => async () => { const v = value(i); i += 1; return v; } }); r.hots = { hand: [9, 4] }; r.plane = [0, 0];
    r.onTick = () => { maxTimers = Math.max(maxTimers, r.timers.size); };
    r.S(100, 100); r.commit("hand", 100, 100, 1);
    let threw = null;
    try { await r.wait(20_000); r.S(140, 120); r.commit("hand", 140, 120, 1); await r.wait(20_000); } catch (error) { threw = error; }
    const expectSettled = name === "negative, growing towards zero" || name === "alternates a number and null";
    const line = `${name}: settling ${r.settling()}, shown ${J(r.hot())}, readings ${i} in 40 s, most timers armed at once ${maxTimers}, diagnostics ${r.diagnostics.length}${threw ? `, THREW ${threw}` : ""}`;
    if (name === "negative, growing towards zero") check(threw === null && r.settling() === false, `${line} (a finite count that moves on IS an idle wait: settling ends, as it should)`);
    else if (name === "alternates a number and null") check(threw === null && r.settling() === true && maxTimers <= 1, `${line} (every question meets a null: never concluded)`);
    else check(threw === null && r.settling() === true && r.hot() === null && maxTimers <= 1 && i <= 40_000 / HOTSPOT_POLL_MS + 50, line);
    void expectSettled;
  }
  // never answers
  const r = manual(); r.S(100, 100); await r.flush(); await r.wait(60_000); r.S(120, 100); await r.flush(); await r.wait(60_000);
  check(r.settling() === true && r.asked() === 1 && r.polls() === 0, `never answers: ${st(r)} after 120 s and a second position (one question per epoch)`);
}

console.log("g. the first reading is asked after the position is noted");
{
  let sendsAtAsk = null; let est = null;
  const r = makeRig({ size: 64, counter: () => async () => { sendsAtAsk ??= est.sends; return 1; } });
  est = r.controller._hotspots;
  const before = est.sends;
  r.S(100, 100); await r.flush();
  check(before === 0 && sendsAtAsk === 1, `sends when the guest was first asked: ${sendsAtAsk} (before the position: ${before})`);
}
console.log(failures === 0 ? "\nALL PREDICTIONS HELD" : `\n${failures} PREDICTION(S) FAILED`);
