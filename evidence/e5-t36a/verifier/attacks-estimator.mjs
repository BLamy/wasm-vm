#!/usr/bin/env node
// E5-T36a verifier — the task's attack list at unit level, against the real modules in
// web/src/sink/. Part 1: every plane position is attributed to the image it was computed for
// (plane = guest pointer - that image's hotspot). The device's real event order at an image change
// is attacked separately in attacks-legacy-order.mjs.
//
//   node evidence/e5-t36a/verifier/attacks-estimator.mjs
//
// A WRONG answer is a non-null hotspot more than one pixel from the truth on either axis.
// No answer (null) is only a delay.
import { CursorHotspotEstimator } from "../../../web/src/sink/cursor-hotspot.js";

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const isWrong = (got, hot) => got !== null && (Math.abs(got.x - hot.x) > 1 || Math.abs(got.y - hot.y) > 1);
const fmt = (p) => (p ? `(${p.x},${p.y})` : "null");
const results = [];
function report(name, verdict, detail) {
  results.push({ name, verdict, detail });
  console.log(`${verdict.padEnd(8)} ${name}\n         ${detail}`);
}

// ── hand-worked cases from predictions.txt ────────────────────────────────────────────────────
{
  const e = new CursorHotspotEstimator();
  e.notePointer(200, 300); const a1 = e.noteMove("k", 32, 32, 193, 289);
  e.notePointer(640, 90); const a2 = e.noteMove("k", 32, 32, 633, 79);
  report("P2-A no lag, two teleports, H=(7,11)", a1 === null && fmt(a2) === "(7,11)" ? "HELD" : "FAILED", `first ${fmt(a1)}, second ${fmt(a2)}`);
}
{
  const e = new CursorHotspotEstimator();
  e.notePointer(100, 100); e.notePointer(110, 104); const b1 = e.noteMove("k", 32, 32, 93, 89);
  e.notePointer(130, 100); const b2 = e.noteMove("k", 32, 32, 103, 93);
  report("P2-B lag of one, uneven steps, H=(7,11)", b1 === null && fmt(b2) === "(7,11)" ? "HELD" : "FAILED", `first ${fmt(b1)}, second ${fmt(b2)}`);
}
{
  const e = new CursorHotspotEstimator(); const sent = []; let got = null;
  for (let i = 0; i < 20; i += 1) {
    const p = { x: 100 + 6 * i, y: 200 }; e.notePointer(p.x, p.y); sent.push(p);
    const g = sent[i - 2]; if (g) got = e.noteMove("k", 32, 32, g.x - 7, g.y - 11) ?? got;
  }
  report("P2-C straight even sweep, lag 2, step (6,0), H=(7,11)", got === null ? "HELD" : "FAILED", `answer ${fmt(got)}`);
}
{
  const e = new CursorHotspotEstimator();
  e.notePointer(5, 8); const d1 = e.noteMove("k", 32, 32, (5 - 20) >>> 0, (8 - 20) >>> 0);
  e.notePointer(300, 3); const d2 = e.noteMove("k", 32, 32, 280, (3 - 20) >>> 0);
  report("P2-D u32-wrapped plane position, H=(20,20)", d1 === null && fmt(d2) === "(20,20)" ? "HELD" : "FAILED", `first ${fmt(d1)}, second ${fmt(d2)}`);
}

// ── two images with different hotspots alternating (reports attributed to their own image) ────
{
  let wrongCount = 0; let resolved = 0; let trials = 0; let firstWrong = null;
  for (let seed = 1; seed <= 2000; seed += 1) {
    const r = rng(seed); const e = new CursorHotspotEstimator();
    const hots = { a: { x: int(r, 0, 20), y: int(r, 0, 20) }, b: { x: int(r, 0, 40), y: int(r, 0, 40) } };
    const sent = []; let p = { x: int(r, 100, 1100), y: int(r, 100, 700) }; let consumed = -1; const got = { a: null, b: null };
    for (let i = 0; i < 60; i += 1) {
      // a smooth-ish walk with occasional jumps
      p = r() < 0.15 ? { x: int(r, 0, 1279), y: int(r, 0, 799) }
        : { x: Math.min(1279, Math.max(0, p.x + int(r, -9, 9))), y: Math.min(799, Math.max(0, p.y + int(r, -9, 9))) };
      e.notePointer(p.x, p.y); sent.push(p);
      consumed = Math.max(consumed, i - int(r, 0, 4));
      if (consumed < 0) continue;
      const g = sent[consumed]; const key = Math.floor(i / 3) % 2 ? "a" : "b"; // alternate every three moves
      got[key] = e.noteMove(key, 64, 64, (g.x - hots[key].x) >>> 0, (g.y - hots[key].y) >>> 0) ?? got[key];
    }
    for (const key of ["a", "b"]) {
      trials += 1; if (got[key]) resolved += 1;
      if (isWrong(got[key], hots[key])) { wrongCount += 1; firstWrong ??= { seed, key, got: got[key], hot: hots[key] }; }
    }
  }
  report("two images alternating, own positions only, lag 0..4 (2000 seeds)", wrongCount === 0 ? "HELD" : "FAILED",
    `${resolved}/${trials} resolved, ${wrongCount} wrong${firstWrong ? ` first ${JSON.stringify(firstWrong)}` : ""}`);
}

// ── a hotspot larger than the image ────────────────────────────────────────────────────────────
{
  const run = (hot) => {
    const e = new CursorHotspotEstimator(); let got = null;
    for (const [x, y] of [[300, 300], [520, 410], [700, 220], [240, 610], [900, 500]]) { e.notePointer(x, y); got = e.noteMove("k", 64, 64, x - hot.x, y - hot.y) ?? got; }
    return got;
  };
  const far = run({ x: 70, y: 70 }); const edge = run({ x: 64, y: 10 }); const one = run({ x: 65, y: 10 });
  report("hotspot larger than the image", far === null && one === null && !isWrong(edge, { x: 64, y: 10 }) ? "HELD" : "FAILED",
    `H=(70,70) -> ${fmt(far)}; H=(65,10) -> ${fmt(one)}; H=(64,10) -> ${fmt(edge)} (clamped into the image, one pixel off)`);
}

// ── positions near the output edges ────────────────────────────────────────────────────────────
{
  let wrongCount = 0; let resolved = 0;
  for (let seed = 1; seed <= 1000; seed += 1) {
    const r = rng(seed * 7919); const e = new CursorHotspotEstimator(); const hot = { x: int(r, 0, 63), y: int(r, 0, 63) }; let got = null;
    for (let i = 0; i < 12; i += 1) {
      const p = { x: r() < 0.5 ? int(r, 0, 30) : int(r, 1250, 1279), y: r() < 0.5 ? int(r, 0, 30) : int(r, 770, 799) };
      e.notePointer(p.x, p.y); got = e.noteMove("k", 64, 64, (p.x - hot.x) >>> 0, (p.y - hot.y) >>> 0) ?? got;
    }
    if (got) resolved += 1; if (isWrong(got, hot)) wrongCount += 1;
  }
  report("corners of the output, plane positions wrapped as u32 (1000 seeds)", wrongCount === 0 ? "HELD" : "FAILED", `${resolved}/1000 resolved, ${wrongCount} wrong`);
  // The task file says "clamped plane positions". Neither wlroots, the kernel nor the device
  // (crates/core/src/dev/virtio/gpu/mod.rs:1542 cursor_position passes x/y through) clamps, so
  // this is a hypothetical device; shown for the record only.
  const e = new CursorHotspotEstimator(); const hot = { x: 9, y: 4 };
  e.notePointer(3, 100); const c1 = e.noteMove("k", 64, 64, Math.max(0, 3 - hot.x), 100 - hot.y);
  e.notePointer(3, 300); const c2 = e.noteMove("k", 64, 64, Math.max(0, 3 - hot.x), 300 - hot.y);
  report("hypothetical device that clamps the plane at the left edge", "INFO", `H=(9,4), pointer x=3 twice -> ${fmt(c1)}, ${fmt(c2)} (no such clamp exists in this stack; not a finding)`);
}

// ── a guest that lags by a varying number of moves ─────────────────────────────────────────────
function lagTrial(seed, { maxLag, history, scribble }) {
  const r = rng(seed); const e = new CursorHotspotEstimator(history ? { history } : {});
  const hot = { x: int(r, 0, 31), y: int(r, 0, 31) }; const sent = [];
  let p = { x: int(r, 200, 1000), y: int(r, 200, 600) }; let v = { x: int(r, -6, 6), y: int(r, -6, 6) };
  let consumed = -1; let got = null; let at = -1;
  for (let i = 0; i < 400 && !got; i += 1) {
    if (r() < 0.2) v = { x: int(r, -6, 6), y: int(r, -6, 6) };
    p = { x: p.x + v.x, y: p.y + v.y };
    if (scribble) p = { x: 600 + ((p.x - 600) % 25), y: 400 + ((p.y - 400) % 25) }; // confined to a 50 px box
    p = { x: Math.min(1279, Math.max(0, p.x)), y: Math.min(799, Math.max(0, p.y)) };
    e.notePointer(p.x, p.y); sent.push(p);
    const next = Math.max(consumed, i - int(r, 0, maxLag));
    if (next === consumed || next < 0) continue;
    consumed = next; const g = sent[consumed];
    got = e.noteMove("k", 32, 32, (g.x - hot.x) >>> 0, (g.y - hot.y) >>> 0); at = i;
  }
  return { got, hot, at };
}
for (const cfg of [
  { name: "varying lag 0..20 moves, wandering path", maxLag: 20 },
  { name: "varying lag 0..100 moves, wandering path", maxLag: 100 },
  { name: "varying lag 0..20 moves, scribble inside a 50 px box", maxLag: 20, scribble: true },
  { name: "lag beyond the 128-position history (0..400), scribble inside a 50 px box", maxLag: 400, scribble: true },
]) {
  let wrongCount = 0; let resolved = 0; let firstWrong = null; const N = 3000;
  for (let seed = 1; seed <= N; seed += 1) {
    const { got, hot } = lagTrial(seed * 104729, cfg);
    if (got) resolved += 1;
    if (isWrong(got, hot)) { wrongCount += 1; firstWrong ??= { seed: seed * 104729, got: { ...got }, hot }; }
  }
  report(`${cfg.name} (${N} seeds)`, wrongCount === 0 ? "HELD" : "FAILED", `${resolved}/${N} resolved, ${wrongCount} wrong${firstWrong ? ` first ${JSON.stringify(firstWrong)}` : ""}`);
}

// ── evenly spaced sweeps in one direction must not guess ───────────────────────────────────────
{
  let wrongCount = 0; let answered = 0; let total = 0; let firstWrong = null;
  for (let dx = -12; dx <= 12; dx += 1) for (let dy = -12; dy <= 12; dy += 1) {
    if (dx === 0 && dy === 0) continue;
    for (const lag of [0, 1, 2, 3, 5, 8, 13]) for (const hot of [{ x: 1, y: 1 }, { x: 9, y: 4 }, { x: 4, y: 8 }, { x: 31, y: 31 }, { x: 0, y: 0 }, { x: 63, y: 63 }]) {
      for (const prefill of [false, true]) {
        const e = new CursorHotspotEstimator(); const sent = []; let got = null;
        if (prefill) for (let i = 40; i > 0; i -= 1) { e.notePointer(640 - dx * i, 400 - dy * i); } // the sweep began before this image
        for (let i = 0; i < 40; i += 1) {
          const p = { x: 640 + dx * i, y: 400 + dy * i }; e.notePointer(p.x, p.y); sent.push(p);
          const g = sent[i - lag]; if (g) got = e.noteMove("k", 64, 64, (g.x - hot.x) >>> 0, (g.y - hot.y) >>> 0) ?? got;
        }
        total += 1; if (got) answered += 1;
        if (isWrong(got, hot)) { wrongCount += 1; firstWrong ??= { dx, dy, lag, hot, prefill, got: { ...got } }; }
      }
    }
  }
  report(`evenly spaced sweeps, 624 directions x 7 lags x 6 hotspots x 2 (${total} sweeps)`, wrongCount === 0 ? "HELD" : "FAILED",
    `${answered} answered (all within a pixel of the truth: ${wrongCount === 0}), ${total - answered} silent, ${wrongCount} wrong${firstWrong ? ` first ${JSON.stringify(firstWrong)}` : ""}`);
}

// ── an output resize in the middle of inference ────────────────────────────────────────────────
{
  // The page notes floor(abs * width / 32768) with the presentation's CURRENT size. For a while
  // after the guest changes mode the two sides can disagree. Model: the guest is at 1280x800,
  // the page still believes 1024x640 for the first K moves (or the reverse).
  let wrongCount = 0; let resolved = 0; let firstWrong = null; const N = 3000;
  for (let seed = 1; seed <= N; seed += 1) {
    const r = rng(seed * 31337); const e = new CursorHotspotEstimator(); const hot = { x: int(r, 0, 31), y: int(r, 0, 31) }; let got = null;
    let p = { x: int(r, 0, 32767), y: int(r, 0, 32767) }; const stale = int(r, 1, 6);
    for (let i = 0; i < 30 && !got; i += 1) {
      p = { x: Math.min(32767, Math.max(0, p.x + int(r, -300, 300))), y: Math.min(32767, Math.max(0, p.y + int(r, -300, 300))) };
      const page = i < stale ? { w: 1024, h: 640 } : { w: 1280, h: 800 };
      e.notePointer(Math.floor((p.x * page.w) / 32768), Math.floor((p.y * page.h) / 32768));
      const g = { x: Math.floor((p.x * 1280) / 32768), y: Math.floor((p.y * 800) / 32768) };
      got = e.noteMove("k", 64, 64, (g.x - hot.x) >>> 0, (g.y - hot.y) >>> 0);
    }
    if (got) resolved += 1; if (isWrong(got, hot)) { wrongCount += 1; firstWrong ??= { seed: seed * 31337, got: { ...got }, hot, stale }; }
  }
  report(`page's output size stale for the first 1..6 moves of an image (${N} seeds, whole screen)`, wrongCount === 0 ? "HELD" : "FAILED",
    `${resolved}/${N} resolved, ${wrongCount} wrong${firstWrong ? ` first ${JSON.stringify(firstWrong)}` : ""}`);
}

// ── memory growth over a long session ──────────────────────────────────────────────────────────
{
  const e = new CursorHotspotEstimator(); const r = rng(42); let maxImages = 0; let maxSent = 0; let maxCandidates = 0;
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 400_000; i += 1) {
    e.notePointer(int(r, 0, 1279), int(r, 0, 799));
    if (i % 2 === 0) e.notePointer(600 + (i % 40), 400 + ((i >> 3) % 40));
    const key = `data:image/png;base64,${"A".repeat(2000)}${i % 5000}`;
    e.noteMove(key, 64, 64, 590 + (i % 13), 395 + (i % 7));
    if (i % 997 === 0) {
      maxImages = Math.max(maxImages, e._images.size); maxSent = Math.max(maxSent, e._sent.length);
      for (const image of e._images.values()) maxCandidates = Math.max(maxCandidates, image.candidates?.length ?? 0);
    }
  }
  const after = process.memoryUsage().heapUsed;
  report("400,000 moves over 5,000 distinct images (2 kB keys)", maxImages <= 64 && maxSent <= 128 && maxCandidates <= 128 ? "HELD" : "FAILED",
    `images <= ${maxImages}, sent <= ${maxSent}, candidates per image <= ${maxCandidates}; heapUsed ${Math.round(before / 1e6)} MB -> ${Math.round(after / 1e6)} MB`);
}

const failed = results.filter((r) => r.verdict === "FAILED");
console.log(`\n${results.length} checks: ${results.filter((r) => r.verdict === "HELD").length} held, ${failed.length} failed, ${results.filter((r) => r.verdict === "INFO").length} info`);
