#!/usr/bin/env node
// E5-T36a verifier (round 2): unit attacks on the new rules, all through the real
// CursorController, all in the device's order (every commit: UPDATE at the plane's previous
// position, then MOVE). 64x64 cursor images as on the Replay desktop; arrow (1,1), hand (9,4),
// caret (4,8). `node attacks-r2.mjs` prints every section; nothing here asserts — it reports.
import { makeRig, DeviceGuest, rng, minJerk, off } from "./harness.mjs";

const HOT = { arrow: [1, 1], hand: [9, 4], caret: [4, 8], cross: [0, 0], corner: [63, 63] };
const fmt = (v) => JSON.stringify(v);
// `node attacks-r2.mjs 67` runs only sections 6 and 7.
const want = (n) => !process.argv[2] || process.argv[2].includes(String(n));
const pct = (n, d) => `${n} of ${d} (${((100 * n) / d).toFixed(1)}%)`;

// ───────────────────────────────────────────────────────────────────────────────────────────
// A timed model of the page + guest. The pointer follows `path` ([t, x, y] rows, page time in
// ms). The guest commits on its own frame clock (every `frameMs`), `lagMs` behind the page; a
// commit happens when its pointer or its image changed; the image follows the shape under the
// guest's pointer `imageDelayMs` after the crossing. During [stall.from, stall.to) the guest
// commits nothing; afterwards it commits the latest position (queued input is coalesced, as a
// compositor does) unless `replayQueue` (it then reports every queued position, one a frame).
function run({ path, shapeAt, stall = null, frameMs = 16.7, lagMs = 20, imageDelayMs = 120, until, replayQueue = false,
  garbageUpdates = null, startImage = "arrow", rounding = undefined }) {
  const rig = makeRig({ size: 64 });
  const guest = new DeviceGuest(rig, HOT, { rounding });
  if (garbageUpdates) {
    // Same events, but every update carries a position unrelated to anything.
    const realU = rig.U; rig.U = (name, _x, _y, rid) => realU(name, Math.floor(garbageUpdates() * 1280), Math.floor(garbageUpdates() * 800), rid);
  }
  const shown = []; // [t, image, answer]
  const look = () => { const a = rig.hot(); const last = shown.at(-1); const k = `${rig.shown}|${fmt(a)}`; if (!last || last[3] !== k) shown.push([rig.now, rig.shown, a, k]); };
  rig.onRest = look;
  let pi = 0; let guestPointer = null; let image = startImage; let wantSince = null; let queue = [];
  const end = until ?? path.at(-1)[0] + 3000;
  let frame = 5;
  const events = [];
  for (;;) {
    const nextS = pi < path.length ? path[pi][0] : Infinity;
    const next = Math.min(nextS, frame);
    if (next > end) break;
    rig.at(next); look();
    if (nextS <= frame) {
      const [t, x, y] = path[pi]; pi += 1;
      rig.S(x, y); queue.push([t, x, y]); look();
      continue;
    }
    // A guest frame.
    const t = frame; frame += frameMs;
    if (stall && t >= stall.from && t < stall.to) continue;
    let moved = false;
    if (replayQueue) { if (queue.length && queue[0][0] + lagMs <= t) { const q = queue.shift(); guestPointer = [q[1], q[2]]; moved = true; } }
    else { while (queue.length && queue[0][0] + lagMs <= t) { const q = queue.shift(); guestPointer = [q[1], q[2]]; moved = true; } }
    if (!guestPointer) continue;
    const want = shapeAt(guestPointer[0], guestPointer[1]);
    let changed = false;
    if (want !== image) { wantSince ??= t; if (t - wantSince >= imageDelayMs) { image = want; wantSince = null; changed = true; } } else wantSince = null;
    if (moved || changed || guest.image === null) { guest.commit(image, guestPointer[0], guestPointer[1]); events.push(t); look(); }
  }
  rig.at(end); look();
  return { rig, shown, guest, commits: events.length };
}

function glide(from, to, ms, t0, hz = 60, ease = minJerk) {
  const rows = []; const n = Math.max(1, Math.round((ms * hz) / 1000)); let at = from;
  for (let i = 1; i <= n; i += 1) {
    const s = ease(i / n);
    const p = [Math.round(from[0] + (to[0] - from[0]) * s), Math.round(from[1] + (to[1] - from[1]) * s)];
    if (p[0] !== at[0] || p[1] !== at[1]) { rows.push([t0 + (i * 1000) / hz, p[0], p[1]]); at = p; }
  }
  return rows;
}
// The page of the Replay desktop, roughly: the button is the hand's, the rest the arrow's.
const BUTTON = { x0: 22, x1: 163, y0: 491, y1: 541 };
const inButton = (x, y) => x >= BUTTON.x0 && x <= BUTTON.x1 && y >= BUTTON.y0 && y <= BUTTON.y1;
const shapeAt = (x, y) => (inButton(x, y) ? "hand" : "arrow");

function summarize(shown, endT) {
  // Time during which a wrong answer was shown, per image; and the last answer for the hand.
  let wrongMs = 0, worst = 0, wrongAtEnd = false, everWrong = false;
  for (let i = 0; i < shown.length; i += 1) {
    const [t, image, answer] = shown[i]; if (!image || answer === null) continue;
    const d = off(answer, HOT[image]);
    if (d > 1) { everWrong = true; worst = Math.max(worst, d); wrongMs += (shown[i + 1]?.[0] ?? endT) - t; if (i === shown.length - 1) wrongAtEnd = true; }
  }
  return { everWrong, wrongAtEnd, wrongMs, worst, last: shown.at(-1) };
}

// ── §1 the rest rule while the guest is behind ─────────────────────────────────────────────
console.log("§1 The rest wait firing while the guest is behind (a stalled guest), then ordinary use");
console.log("   One straight min-jerk glide at 60 Hz from the page body onto the button; the guest stalls for");
console.log("   `stall` ms starting within the last 150 ms of the glide; afterwards the user does `after`.");
console.log("   Reported: trials in which the page showed a hotspot more than one pixel from the truth at any");
console.log("   time / still at the end (pointer at rest for 3 s), the longest it was shown, the worst error.");
if (want(1)) {
  const afters = {
    "stays at rest": () => [],
    // One more position 330-700 ms after stopping (a nudge of 1-6 px), then rest.
    "one nudge 330-700 ms after stopping": (random, to, tStop) => {
      const dt = 330 + random() * 370; return [[tStop + dt, to[0] + Math.round(random() * 12 - 6) || to[0] + 2, to[1] + Math.round(random() * 6 - 3)]];
    },
    "two nudges": (random, to, tStop) => {
      const a = [tStop + 330 + random() * 200, to[0] + 3, to[1] + 1]; return [a, [a[0] + 120 + random() * 200, to[0] + 5, to[1] - 1]];
    },
    // Keeps moving about inside the button: 4 short glides with pauses.
    "moves about inside the button (4 short glides)": (random, to, tStop) => {
      const rows = []; let at = to; let t = tStop + 330 + random() * 300;
      for (let i = 0; i < 4; i += 1) {
        const next = [BUTTON.x0 + 8 + Math.floor(random() * 125), BUTTON.y0 + 6 + Math.floor(random() * 38)];
        const ms = 150 + random() * 250; rows.push(...glide(at, next, ms, t)); t += ms + 100 + random() * 500; at = next;
      }
      return rows;
    },
    "leaves for the page body and comes back": (random, to, tStop) => {
      const t1 = tStop + 330 + random() * 300; const out = [300 + Math.floor(random() * 200), 600 + Math.floor(random() * 80)];
      const back = [BUTTON.x0 + 20 + Math.floor(random() * 100), BUTTON.y0 + 10 + Math.floor(random() * 30)];
      return [...glide(to, out, 500, t1), ...glide(out, back, 600, t1 + 1500)];
    },
  };
  for (const stallMs of [0, 200, 320, 400, 600, 1000, 2000]) {
    for (const [afterName, after] of Object.entries(afters)) {
      if (stallMs === 0 && afterName !== "one nudge 330-700 ms after stopping" && afterName !== "moves about inside the button (4 short glides)") continue;
      const random = rng(0xc0ffee ^ (stallMs * 7919) ^ afterName.length);
      let n = 0, ever = 0, atEnd = 0, longest = 0, worst = 0, known = 0; let example = null;
      for (let trial = 0; trial < 400; trial += 1) {
        const from = [200 + Math.floor(random() * 300), 430 + Math.floor(random() * 250)];
        const to = [BUTTON.x0 + 10 + Math.floor(random() * 120), BUTTON.y0 + 8 + Math.floor(random() * 34)];
        const ms = 250 + random() * 650;
        // Warm-up so the arrow is known, as in every browser plan: two jumps with rests.
        const path = [[100, 600, 300], [700, from[0] + 40, from[1] + 30], [1400, from[0], from[1]], ...glide(from, to, ms, 2200)];
        const tStop = path.at(-1)[0];
        const stallFrom = tStop - random() * 150;
        path.push(...after(random, to, tStop));
        path.sort((a, b) => a[0] - b[0]);
        const r = run({ path, shapeAt, stall: stallMs ? { from: stallFrom, to: stallFrom + stallMs } : null,
          lagMs: 10 + random() * 30, imageDelayMs: 55 + random() * 185, until: path.at(-1)[0] + 3000 });
        const s = summarize(r.shown, r.rig.now);
        n += 1; ever += s.everWrong; atEnd += s.wrongAtEnd; longest = Math.max(longest, s.wrongMs); worst = Math.max(worst, s.worst);
        if (r.rig.hot() !== null) known += 1;
        if (s.wrongAtEnd && !example) example = { trial, to, shown: r.shown.filter((x) => x[1] === "hand").map((x) => `${x[0].toFixed(0)}:${fmt(x[2])}`).join(" ") };
      }
      console.log(`   stall ${String(stallMs).padStart(4)} ms, ${afterName.padEnd(46)}: wrong shown ${pct(ever, n).padEnd(18)} wrong at the end ${pct(atEnd, n).padEnd(18)} longest ${Math.round(longest)} ms, worst ${worst} px; known at the end ${known}`);
      if (example) console.log(`        e.g. trial ${example.trial}, stop at ${fmt(example.to)}: hand ${example.shown}`);
    }
  }
}

// ── §8 the same as §1, approaching the terminal (text caret, hotspot (4,8)) moving right and down ──
// In §1 the pointer moves left onto the button: the plane trails to the RIGHT of where it will
// be, so "last sent - plane" is mostly negative and outside the image — no rest answer. Moving
// right/down the same lag gives an offset inside the 64 px image.
console.log("\n§8 As §1, but the pointer approaches the terminal moving right and down (the caret's plane trails up-left)");
if (want(8)) {
  const TERM = { x0: 795, y0: 30 };
  const shapeT = (x, y) => (x >= TERM.x0 && y >= TERM.y0 ? "caret" : "arrow");
  const afters = {
    "stays at rest": () => [],
    "one nudge 330-700 ms after stopping": (random, to, tStop) => [[tStop + 330 + random() * 370, to[0] + 1 + Math.floor(random() * 6), to[1] + Math.floor(random() * 4)]],
    "two nudges": (random, to, tStop) => { const a = [tStop + 330 + random() * 200, to[0] + 3, to[1] + 1]; return [a, [a[0] + 120 + random() * 200, to[0] + 6, to[1] + 2]]; },
    "moves about inside the terminal (4 short glides)": (random, to, tStop) => {
      const rows = []; let at = to; let t = tStop + 330 + random() * 300;
      for (let i = 0; i < 4; i += 1) { const next = [820 + Math.floor(random() * 400), 60 + Math.floor(random() * 600)]; const ms = 150 + random() * 250; rows.push(...glide(at, next, ms, t)); t += ms + 100 + random() * 500; at = next; }
      return rows;
    },
  };
  // `node attacks-r2.mjs 8 loaded`: the guest as measured under load (a report 100-300 ms after
  // the send it stands for) instead of idle (10-40 ms).
  const loaded = process.argv[3] === "loaded";
  console.log(`   guest latency: ${loaded ? "100-300 ms (as measured under load)" : "10-40 ms (idle)"}`);
  for (const stallMs of [0, 320, 400, 600, 1000]) {
    for (const [afterName, after] of Object.entries(afters)) {
      if (stallMs === 0 && afterName !== "one nudge 330-700 ms after stopping") continue;
      const random = rng(0xbeef ^ (stallMs * 7919) ^ afterName.length);
      let n = 0, ever = 0, atEnd = 0, longest = 0, worst = 0; let example = null;
      for (let trial = 0; trial < 400; trial += 1) {
        // From the Chromium window, 20-300 px left of the terminal's edge and above the target,
        // to a point 5-120 px inside it.
        const to = [TERM.x0 + 5 + Math.floor(random() * 115), 200 + Math.floor(random() * 400)];
        const from = [TERM.x0 - 20 - Math.floor(random() * 280), to[1] - 20 - Math.floor(random() * 150)];
        const ms = 250 + random() * 900;
        const path = [[100, 300, 300], [700, from[0] - 40, from[1] + 30], [1400, from[0], from[1]], ...glide(from, to, ms, 2200)];
        const tStop = path.at(-1)[0];
        const stallFrom = tStop - random() * 150;
        path.push(...after(random, to, tStop)); path.sort((a, b) => a[0] - b[0]);
        const r = run({ path, shapeAt: shapeT, stall: stallMs ? { from: stallFrom, to: stallFrom + stallMs } : null,
          lagMs: loaded ? 100 + random() * 200 : 10 + random() * 30, imageDelayMs: 55 + random() * 185, until: path.at(-1)[0] + 3000 });
        const s = summarize(r.shown, r.rig.now);
        n += 1; ever += s.everWrong; atEnd += s.wrongAtEnd; longest = Math.max(longest, s.wrongMs); worst = Math.max(worst, s.worst);
        if (s.wrongAtEnd && (!example || s.worst > example.worst)) example = { trial, to, worst: s.worst, shown: r.shown.filter((x) => x[1] === "caret").map((x) => `${x[0].toFixed(0)}:${fmt(x[2])}`).join(" ") };
      }
      console.log(`   stall ${String(stallMs).padStart(4)} ms, ${afterName.padEnd(48)}: wrong shown ${pct(ever, n).padEnd(18)} wrong at the end ${pct(atEnd, n).padEnd(18)} longest ${Math.round(longest)} ms, worst ${worst} px`);
      if (example) console.log(`        worst kept: trial ${example.trial}, stop at ${fmt(example.to)}: caret ${example.shown}`);
    }
  }
}

// ── §2 an image that comes back while the pointer rests ────────────────────────────────────
console.log("\n§2 An image that comes back while the pointer rests (a rest answer, nothing sent since)");
if (want(2)) {
  const r = makeRig({ size: 64 }); const g = new DeviceGuest(r, HOT); const rows = [];
  const note = (what) => rows.push(`   t=${String(Math.round(r.now)).padStart(5)} ${what.padEnd(52)} shown ${r.shown} answer ${fmt(r.hot())} css ${fmt(r.css())} style writes ${r.controller.snapshot().styleWrites}`);
  r.onRest = () => note("rest wait fired");
  r.at(0).S(600, 300); g.commit("arrow", 600, 300); r.at(400).S(400, 520); g.commit("arrow", 400, 520); note("arrow known by two moves");
  // One straight even approach onto the button, the guest one behind; the hand appears at the end.
  let t = 1000; const xs = [300, 280, 260, 240, 220, 200, 180, 160, 140, 120];
  xs.forEach((x, i) => { t += 16; r.at(t).S(x, 515); if (i > 0) g.commit("arrow", xs[i - 1], 515); });
  t += 16; r.at(t); g.commit("arrow", 120, 515); t += 100; r.at(t); g.commit("hand", 120, 515); note("hand installed after the stop: one move");
  r.at(t + 1000); note("pointer at rest 1 s");
  // The user clicks without moving; the page under the pointer re-renders: arrow for a moment, hand again.
  r.at(t + 2000); g.commit("arrow", 120, 515); note("guest shows the arrow where the pointer rests");
  r.at(t + 2100); g.commit("hand", 120, 515); note("guest shows the hand again (U at the arrow's plane, M)");
  r.at(t + 2390); note("290 ms later");
  r.at(t + 3000); note("600 ms after that");
  console.log(rows.join("\n"));
}

// ── §3 update positions are never evidence ────────────────────────────────────────────────
console.log("\n§3 Update positions are never used: the same 300 random runs with every update's position replaced by noise");
if (want(3)) {
  let same = 0, n = 0, wrong = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const mk = (garbage) => {
      const random = rng(0xabc000 + trial);
      const from = [200 + Math.floor(random() * 300), 430 + Math.floor(random() * 250)];
      const to = [BUTTON.x0 + 10 + Math.floor(random() * 120), BUTTON.y0 + 8 + Math.floor(random() * 34)];
      const path = [[100, 600, 300], [700, from[0] + 40, from[1] + 30], [1400, from[0], from[1]], ...glide(from, to, 250 + random() * 650, 2200)];
      const out = [300 + Math.floor(random() * 200), 600 + Math.floor(random() * 80)];
      path.push(...glide(to, out, 500, path.at(-1)[0] + 900), ...glide(out, [90, 515], 600, path.at(-1)[0] + 2500));
      const noise = garbage ? rng(0x5eed + trial) : null;
      return run({ path, shapeAt, lagMs: 10 + random() * 30, imageDelayMs: 55 + random() * 185, garbageUpdates: noise });
    };
    const a = mk(false), b = mk(true);
    n += 1; same += fmt(a.shown.map((x) => [x[0], x[1], x[2]])) === fmt(b.shown.map((x) => [x[0], x[1], x[2]]));
    wrong += summarize(a.shown, a.rig.now).everWrong;
  }
  console.log(`   identical timelines of shown answers: ${pct(same, n)}; runs with a wrong answer shown (no stall): ${wrong}`);
}

// ── §4 inference started over while the guest is behind (history cleared under a lagging guest) ──
console.log("\n§4 Inference started over while the guest is a position behind (mode change, output-size change, the");
console.log("   page hook): the next move stands for a position that is no longer in the history");
if (want(4)) {
  for (const [name, restart] of [
    ["resetHotspotInference()", (r) => r.controller.resetHotspotInference()],
    ["relative mode and back", (r) => { r.controller.setPointerState({ mode: "relative", pointerLocked: true }); r.controller.setPointerState({ mode: "absolute", pointerLocked: false }); }],
    ["output size 1280x800 -> 1280x801 on the next sent position", (r) => { r.sizeH = 801; }],
  ]) {
    const r = makeRig({ size: 64 }); const g = new DeviceGuest(r, HOT); r.sizeH = 800; const rows = [];
    const S = (x, y) => r.controller.notePointer(x, y, 1280, r.sizeH);
    let t = 0;
    // An even straight run inside the button (the hand throughout), the guest one position behind.
    const xs = [150, 140, 130, 120, 110, 100, 90, 80, 70, 60];
    xs.forEach((x, i) => {
      t += 16; r.at(t);
      if (i === 4) restart(r);
      S(x, 515); if (i > 0) g.commit("hand", xs[i - 1], 515);
      rows.push(`${x}:${fmt(r.hot())}`);
    });
    t += 16; r.at(t); g.commit("hand", 60, 515); rows.push(`caught up:${fmt(r.hot())}`);
    r.at(t + 5000); rows.push(`at rest 5 s:${fmt(r.hot())}`);
    // Later: three more places, far apart.
    const later = [];
    for (const [x, y] of [[400, 300], [520, 420], [640, 350], [700, 500]]) { t += 6000; r.at(t); S(x, y); g.commit("hand", x, y); later.push(fmt(r.hot())); }
    console.log(`   ${name}: sent x -> answer for the hand (true [9,4]): ${rows.join(" ")}; then jumps: ${later.join(" ")}`);
  }
}

// ── §5 a guest behind by more than the history, pointer wandering in a small area ─────────
console.log("\n§5 A guest further behind than the 128-position history while the pointer wanders in a small area");
if (want(5)) {
  for (const lag of [0, 60, 120, 140, 200, 400]) {
    let n = 0, dropped = 0, wrongEver = 0, wrongEnd = 0, wrongMoves = 0, moves = 0;
    for (let trial = 0; trial < 60; trial += 1) {
      const random = rng(0x777 + trial * 31 + lag);
      const r = makeRig({ size: 64 }); const g = new DeviceGuest(r, HOT);
      // The hand is known (two far-apart moves).
      let t = 0; r.at(t).S(100, 510); g.commit("hand", 100, 510); t += 400; r.at(t).S(60, 530); g.commit("hand", 60, 530);
      const sent = []; let at = [60, 530]; let wasDropped = false; let ever = false;
      for (let seg = 0; seg < 40; seg += 1) {
        const next = [BUTTON.x0 + 5 + Math.floor(random() * 130), BUTTON.y0 + 4 + Math.floor(random() * 42)];
        for (const [, x, y] of glide(at, next, 120 + random() * 250, 0)) {
          t += 16.7; r.at(t).S(x, y); sent.push([x, y]);
          const q = sent[sent.length - 1 - lag];
          if (q) { g.commit("hand", q[0], q[1]); moves += 1; const a = r.hot(); if (a === null) wasDropped = true; else if (off(a, HOT.hand) > 1) { ever = true; wrongMoves += 1; } }
        }
        at = next;
      }
      // The pointer stops; the guest catches up, one position a frame.
      for (let i = Math.max(0, sent.length - lag); i < sent.length; i += 1) { t += 16.7; r.at(t); g.commit("hand", sent[i][0], sent[i][1]); const a = r.hot(); if (a !== null && off(a, HOT.hand) > 1) ever = true; }
      r.at(t + 3000);
      const end = r.hot();
      n += 1; dropped += wasDropped; wrongEver += ever; wrongEnd += end !== null && off(end, HOT.hand) > 1;
    }
    console.log(`   lag ${String(lag).padStart(3)} positions: the known answer was dropped in ${pct(dropped, n)}; a wrong one shown in ${pct(wrongEver, n)} (on ${wrongMoves} of ${moves} moves); wrong at rest after catching up ${pct(wrongEnd, n)}`);
  }
}

// ── §6 edges ───────────────────────────────────────────────────────────────────────────────
console.log("\n§6 Edges: hotspot (0,0), hotspot at the far corner (63,63), many images, relative mode in the middle");
if (want(6)) {
  for (const name of ["cross", "corner"]) {
    let wrong = 0, known = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const random = rng(0x1234 + trial);
      const from = [200 + Math.floor(random() * 300), 430 + Math.floor(random() * 250)];
      const to = [BUTTON.x0 + 10 + Math.floor(random() * 120), BUTTON.y0 + 8 + Math.floor(random() * 34)];
      const path = [[100, 600, 300], [700, from[0] + 40, from[1] + 30], [1400, from[0], from[1]], ...glide(from, to, 250 + random() * 650, 2200)];
      const r = run({ path, shapeAt: (x, y) => (inButton(x, y) ? name : "arrow"), lagMs: 10 + random() * 30, imageDelayMs: 55 + random() * 185 });
      const s = summarize(r.shown, r.rig.now); wrong += s.everWrong; known += r.rig.hot() !== null && r.rig.shown === name;
    }
    console.log(`   ${name} ${fmt(HOT[name])}: wrong shown in ${wrong} of 200 approaches; known at rest ${known}`);
  }
  // Many images.
  const r = makeRig({ size: 64 }); const hots = {}; const g = new DeviceGuest(r, hots); let t = 0; const random = rng(99);
  for (let i = 0; i < 3000; i += 1) { const name = `img-${i}`; hots[name] = [i % 60, (i * 7) % 60]; for (let k = 0; k < 3; k += 1) { t += 20; const x = 100 + Math.floor(random() * 1000), y = 100 + Math.floor(random() * 600); r.at(t).S(x, y); g.commit(name, x, y); } }
  console.log(`   3000 images, 3 moves each: estimator remembers ${r.controller._hotspots._images.size} images, ${r.controller._hotspots._sent.length} positions; diagnostics ${r.diagnostics.length}`);
  // Relative mode in the middle of an approach.
  const m = makeRig({ size: 64 }); const mg = new DeviceGuest(m, HOT); let mt = 0; const out = [];
  [[300, 515], [280, 515], [260, 515]].forEach(([x, y]) => { mt += 16; m.at(mt).S(x, y); mg.commit("arrow", x, y); });
  m.controller.setPointerState({ mode: "relative", pointerLocked: true });
  [[240, 515], [200, 500], [150, 510], [120, 515]].forEach(([x, y]) => { mt += 16; m.at(mt).S(x, y); mg.commit(shapeAt(x, y), x, y); out.push(fmt(m.hot())); });
  m.at(mt + 1000); out.push(`rest:${fmt(m.hot())}`);
  m.controller.setPointerState({ mode: "absolute", pointerLocked: false });
  mt += 2000; m.at(mt); mg.commit("hand", 120, 515); out.push(`back in absolute, stale move:${fmt(m.hot())}`);
  m.at(mt + 1000); out.push(`rest:${fmt(m.hot())}`);
  mt += 2000; m.at(mt).S(100, 520); mg.commit("hand", 100, 520); m.at(mt + 400); out.push(`one position + rest:${fmt(m.hot())}`);
  console.log(`   relative mode mid-approach: ${out.join(" ")}`);
}

// ── §7 a MOVE with resource id 0, then the armed rest wait ───────────────────────────────
console.log("\n§7 A hidden-cursor MOVE (resource id 0) without an UPDATE, while a rest wait is armed");
if (want(7)) {
  const r = makeRig({ size: 64 }); const g = new DeviceGuest(r, HOT);
  r.at(0).S(300, 300).S(305, 300); g.commit("hand", 300, 300);
  r.controller.handle({ type: "cursor-move", state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: 0, y: 0 } } });
  r.at(1000);
  console.log(`   diagnostics: ${fmt(r.diagnostics.map((d) => `${d.reason}: ${d.error}`))}`);
}
