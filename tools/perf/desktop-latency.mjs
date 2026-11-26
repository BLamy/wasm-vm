#!/usr/bin/env node
// Replay desktop interaction-latency benchmark: real DOM pointer/keyboard events into the
// in-browser desktop, timed against the moment the affected pixels change on the host canvas.
// Nothing is typed or read through the serial console while a latency is being timed, so the
// measurement itself adds no guest work.
//
//   bash tools/serve-dev.sh 8123 &
//   node tools/perf/desktop-latency.mjs --label baseline --out evidence/desktop-latency/baseline.json
//
// Options: --url BASE (default http://127.0.0.1:8123)  --app PATH (default /)
//          --query "&jit=0"   extra query string for the page under test
//          --scenarios idle,click,sweep,type,node,mips (default: all)   --n 5 (trials per scenario)
//          --headed            run a visible browser
//
// Scenarios (all wall-clock milliseconds, measured in the page with performance.now()):
//   idle    guest MIPS and presents while nobody touches the desktop (--idle-s seconds, default 8),
//           the share of wall time inside run slices and guest seconds per real second
//   click   pointer resting on Chrome's "Run again" (moved there, and drawn there by the guest,
//           beforehand); press+release; time to the "runs" line changing (result). A repaint of
//           the button before the result is reported as an optional pressed-state frame.
//   sweep   a human-like 0.5 s pointer sweep from the terminal to the button, then an immediate
//           click; time from the press to the "runs" line changing (shows motion backlog)
//   type    one key into the focused foot terminal; time to the glyph appearing
//   node    `node -e 'console.log(6*7)'` in the terminal; time from Enter to the next prompt
//   mips    a CPU-bound Node loop driven over the serial shell; retired instructions / wall
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:8123" }, app: { type: "string", default: "/" },
  query: { type: "string", default: "" }, label: { type: "string", default: "run" },
  out: { type: "string" }, scenarios: { type: "string", default: "idle,click,sweep,type,node,mips" },
  n: { type: "string", default: "5" }, headed: { type: "boolean", default: false },
  "ready-timeout-min": { type: "string", default: "60" }, "trial-timeout-s": { type: "string", default: "180" },
  "idle-s": { type: "string", default: "8" },
  chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
} });
const N = Number(opt.n);
const TRIAL_TIMEOUT_MS = Number(opt["trial-timeout-s"]) * 1000;
const scenarios = opt.scenarios.split(",").map((s) => s.trim()).filter(Boolean);
const log = (...a) => console.log(`[desktop-latency ${new Date().toISOString().slice(11, 23)}]`, ...a);

// Guest output geometry (1280x800): Chrome tiled left, foot right. See tools/replay-desktop.
const GUEST = { w: 1280, h: 800 };
const BUTTON = { x: 93, y: 516 };
const TERMINAL = { x: 1036, y: 420 };
const ROW = (r) => 31 + 17 * r, COL = (c) => 801 + 8 * c; // foot: pad 6, 8x17 cells
const REGIONS = {
  button: { x: 22, y: 490, w: 144, h: 54 },
  runs: { x: 36, y: 252, w: 110, h: 20 },
  // The terminal's first rows, split per row so a prompt on row r can be told from its echo.
  ...Object.fromEntries(Array.from({ length: 6 }, (_, r) => [`row${r}`, { x: 797, y: ROW(r), w: 480, h: 17 }])),
  // Columns 9.. of row 2: changes only once the shell prompt after Node's output is drawn.
  prompt2: { x: COL(9) - 2, y: ROW(2), w: 14, h: 17 },
};

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: opt.chrome, headless: !opt.headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) consoleErrors.push(m.text().slice(0, 500)); });
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 500)));
await page.addInitScript(() => {
  window.addEventListener("wvm:desktop-ready", () => { window.__latDesktopReadyAt = performance.now(); });
});
const url = `${opt.url.replace(/\/+$/u, "")}${opt.app}?guest=replay-desktop&desktop=1${opt.query}#ide`;
log("open", url);
const tOpen = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__latDesktopReadyAt !== undefined
  && document.getElementById("omarchy-boot-overlay")?.hidden === true, null,
{ timeout: Number(opt["ready-timeout-min"]) * 60_000, polling: 250 });
log(`desktop ready after ${((Date.now() - tOpen) / 1000).toFixed(1)} s`);

// In-page probe: per animation frame, hash each watched canvas region and timestamp changes;
// capture-phase listeners timestamp the DOM input events exactly where the page receives them.
await page.evaluate((regions) => {
  const canvas = document.getElementById("ide-display-canvas");
  const scratch = document.createElement("canvas");
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  const state = Object.fromEntries(Object.entries(regions).map(([k, r]) => [k, { ...r, hash: null, changes: [] }]));
  const hashOf = (r) => {
    scratch.width = r.w; scratch.height = r.h;
    ctx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const d = new Uint32Array(ctx.getImageData(0, 0, r.w, r.h).data.buffer);
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const inputs = [];
  for (const type of ["pointerdown", "pointerup", "pointermove", "keydown", "keyup"]) {
    window.addEventListener(type, (e) => { inputs.push({ type, at: performance.now(), key: e.code ?? null }); }, { capture: true, passive: true });
  }
  let frames = 0;
  const tick = () => {
    const now = performance.now();
    frames += 1;
    for (const r of Object.values(state)) {
      const h = hashOf(r);
      if (h !== r.hash) { if (r.hash !== null) r.changes.push(now); r.hash = h; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__lat = {
    now: () => performance.now(),
    frames: () => frames,
    reset: () => { for (const r of Object.values(state)) r.changes.length = 0; inputs.length = 0; },
    changes: () => Object.fromEntries(Object.entries(state).map(([k, r]) => [k, r.changes.slice()])),
    inputs: () => inputs.slice(),
    firstAfter: (name, t) => state[name].changes.find((c) => c >= t) ?? null,
    lastInput: (type) => inputs.findLast((e) => e.type === type)?.at ?? null,
    firstInput: (type) => inputs.find((e) => e.type === type)?.at ?? null,
  };
}, REGIONS);

const box = await page.locator("#ide-display-canvas").boundingBox();
assert.ok(box && box.width > 100, "display canvas is laid out");
const toPage = (p) => ({ x: box.x + (p.x / GUEST.w) * box.width, y: box.y + (p.y / GUEST.h) * box.height });
const moveTo = async (p) => { const q = toPage(p); await page.mouse.move(q.x, q.y); };
const sleep = (ms) => page.waitForTimeout(ms);
const sched = () => page.evaluate(async () => {
  const s = await window.__schedulerStats?.();
  const p = window.__presentation?.state?.() ?? null;
  let clock = null;
  try { clock = await window.__linuxCtl?.guestClockState?.() ?? null; } catch { /* not exposed */ }
  return { at: performance.now(), retired: s?.retiredInstructions ?? null, slices: s?.slices ?? null,
    maxSliceMs: s?.maxSliceMs ?? null, maxStretchGapMs: s?.maxStretchGapMs ?? null, yieldMode: s?.yieldMode ?? null,
    sliceMs: s?.totalSliceMs ?? null, idleSleeps: s?.idleSleeps ?? null, idleSleepMs: s?.idleSleepMs ?? null,
    idleWakes: s?.idleWakes ?? null, clockMode: clock?.mode ?? null,
    // Guest seconds since boot: mtime is a decimal string of timebase ticks.
    guestS: clock?.mtime === undefined || !clock?.timebaseHz ? null : Number(BigInt(clock.mtime) / 1000n) / (clock.timebaseHz / 1000),
    framesReceived: p?.gpu?.framesReceived ?? p?.framesReceived ?? null, drawnPresents: p?.gpu?.drawnPresents ?? p?.drawnPresents ?? null };
});
const delta = (a, b, key) => (a[key] === null || b[key] === null ? null : b[key] - a[key]);
const rate = (a, b) => ({ wallMs: Math.round(b.at - a.at), instructionsM: +((b.retired - a.retired) / 1e6).toFixed(1),
  mips: +(((b.retired - a.retired) / 1e6) / ((b.at - a.at) / 1000)).toFixed(1),
  // E5-T37b: how much of the wall time the worker spent inside run slices, how fast guest time
  // ran against real time, and how often the run loop slept instead of taking the next slice.
  inSlicePct: delta(a, b, "sliceMs") === null ? null : +(100 * delta(a, b, "sliceMs") / (b.at - a.at)).toFixed(1),
  guestSecondsPerSecond: delta(a, b, "guestS") === null ? null : +(delta(a, b, "guestS") / ((b.at - a.at) / 1000)).toFixed(2),
  idleSleeps: delta(a, b, "idleSleeps"), idleSleepMs: delta(a, b, "idleSleepMs") === null ? null : Math.round(delta(a, b, "idleSleepMs")),
  idleWakes: delta(a, b, "idleWakes"), clockMode: b.clockMode,
  framesReceived: b.framesReceived === null ? null : b.framesReceived - a.framesReceived,
  drawnPresents: b.drawnPresents === null ? null : b.drawnPresents - a.drawnPresents });
// Wait until `name` changes at or after page time `t`; returns latency in ms or null on timeout.
async function latency(name, t, timeout = TRIAL_TIMEOUT_MS) {
  try {
    await page.waitForFunction(([n, at]) => window.__lat.firstAfter(n, at) !== null, [name, t], { timeout, polling: 50 });
  } catch { return null; }
  return +(await page.evaluate(([n, at]) => window.__lat.firstAfter(n, at) - at, [name, t])).toFixed(1);
}
// Wait until none of the watched regions has changed for `quietMs`, counted from this call at
// the earliest (so a repaint the caller just provoked, e.g. by moving the pointer, has time to
// arrive before the quiet period can be satisfied). Bounded by `maxMs`.
async function settle(quietMs = 2500, maxMs = 120_000) {
  const t0 = Date.now();
  const start = await page.evaluate(() => performance.now());
  for (;;) {
    const [last, now] = await page.evaluate(() => [
      Math.max(0, ...Object.values(window.__lat.changes()).flat()), performance.now()]);
    if (now - Math.max(last, start) >= quietMs || Date.now() - t0 > maxMs) return;
    await sleep(250);
  }
}
// Move the pointer onto `p` and wait for the guest to have drawn it there: the watched `region`
// repaints (the guest composites its own cursor and the hover state), then goes quiet.
async function restOn(p, region) {
  await page.evaluate(() => window.__lat.reset());
  await moveTo(p);
  const t = await page.evaluate(() => window.__lat.lastInput("pointermove") ?? performance.now());
  const arrived = await latency(region, t, 30_000);
  await settle();
  return arrived;
}
const stats = (xs) => {
  const v = xs.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return { n: 0, missing: xs.length };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, missing: xs.length - v.length, min: v[0], median: q(0.5), max: v[v.length - 1] };
};
const KEY = { " ": "Space", "-": "Minus", "'": "Quote", ".": "Period", "(": ["Shift", "Digit9"], ")": ["Shift", "Digit0"], "*": ["Shift", "Digit8"] };
async function typeText(text, gapMs = 150) {
  for (const ch of text) {
    const k = /[a-z]/u.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/u.test(ch) ? `Digit${ch}` : KEY[ch];
    assert.ok(k, `no key mapping for ${JSON.stringify(ch)}`);
    if (Array.isArray(k)) { await page.keyboard.down(k[0]); await page.keyboard.press(k[1], { delay: 30 }); await page.keyboard.up(k[0]); }
    else await page.keyboard.press(k, { delay: 30 });
    await sleep(gapMs);
  }
}

const result = { label: opt.label, url, browser: browser.version(), startedAt: new Date().toISOString(),
  trials: N, scenarios: {} };
const run = {
  async idle() {
    await moveTo({ x: 640, y: 700 }); await settle();
    const a = await sched(); await sleep(Number(opt["idle-s"]) * 1000); const b = await sched();
    result.scenarios.idle = rate(a, b);
    result.yieldMode = b.yieldMode; result.maxSliceMs = b.maxSliceMs; result.maxStretchGapMs = b.maxStretchGapMs;
  },
  async click() {
    // Park the pointer elsewhere first so the move onto the button is a real one, then wait
    // for the guest to draw the pointer there: the press below is on a resting pointer.
    await moveTo(TERMINAL); await settle();
    const arrived = await restOn(BUTTON, "button");
    assert.ok(arrived !== null, "the guest never drew the pointer on the button");
    const pressed = [], answered = [], rates = [];
    for (let i = 0; i < N; i++) {
      await page.evaluate(() => window.__lat.reset());
      const a = await sched();
      await page.mouse.down(); await sleep(60); await page.mouse.up();
      const t = await page.evaluate(() => window.__lat.firstInput("pointerdown"));
      const r = await latency("runs", t);
      // The pressed-state frame is optional: a 60 ms press can be released before the guest
      // has painted it, and then the first repaint of the button is the result frame itself.
      // Only a button repaint strictly before the result counts as a pressed-state frame.
      // Both change timestamps are compared unrounded, in the page: a button repaint in the
      // same animation frame as the result is not a pressed-state frame.
      const f = r === null ? null : await page.evaluate(([at]) => {
        const c = window.__lat.firstAfter("button", at);
        const res = window.__lat.firstAfter("runs", at);
        return c !== null && res !== null && c < res ? +(c - at).toFixed(1) : null;
      }, [t]);
      const b = await sched();
      pressed.push(f); answered.push(r); rates.push(rate(a, b));
      log(`click #${i + 1}: result ${r} ms, pressed-state frame ${f === null ? "none" : f + " ms"}, ${rates.at(-1).instructionsM}M instr @ ${rates.at(-1).mips} MIPS`);
      await settle();
    }
    const seen = pressed.filter((x) => x !== null);
    result.scenarios.click = { resultMs: stats(answered), pointerArrivedMs: arrived,
      pressedFrame: { seen: seen.length, none: pressed.length - seen.length, ms: seen.length ? stats(seen) : null },
      raw: { pressed, answered, rates } };
  },
  async sweep() {
    const answered = [], cursor = [];
    for (let i = 0; i < N; i++) {
      await moveTo(TERMINAL); await settle();
      await page.evaluate(() => window.__lat.reset());
      const steps = 40;
      for (let s = 1; s <= steps; s++) {
        await moveTo({ x: TERMINAL.x + ((BUTTON.x - TERMINAL.x) * s) / steps, y: TERMINAL.y + ((BUTTON.y - TERMINAL.y) * s) / steps });
        await sleep(12);
      }
      const tArrive = await page.evaluate(() => window.__lat.lastInput("pointermove"));
      await page.mouse.down(); await sleep(60); await page.mouse.up();
      const t = await page.evaluate(() => window.__lat.firstInput("pointerdown"));
      const r = await latency("runs", t);
      const c = await page.evaluate(([at]) => { const x = window.__lat.firstAfter("button", at); return x === null ? null : +(x - at).toFixed(1); }, [tArrive]);
      answered.push(r); cursor.push(c);
      log(`sweep #${i + 1}: pointer shown on the button ${c} ms after arriving, result ${r} ms after the press`);
      await settle();
    }
    result.scenarios.sweep = { resultMs: stats(answered), cursorArriveMs: stats(cursor), raw: { answered, cursor } };
  },
  async type() {
    await moveTo(TERMINAL); await page.mouse.down(); await sleep(60); await page.mouse.up(); await settle();
    await typeText("clear"); await page.keyboard.press("Enter", { delay: 30 }); await settle();
    const echo = [];
    for (let i = 0; i < N; i++) {
      await page.evaluate(() => window.__lat.reset());
      await page.keyboard.down("KeyA");
      const t = await page.evaluate(() => window.__lat.firstInput("keydown"));
      await sleep(40); await page.keyboard.up("KeyA");
      const e = await latency("row0", t);
      echo.push(e);
      log(`type #${i + 1}: echo ${e} ms`);
      await settle(1500);
    }
    result.scenarios.type = { echoMs: stats(echo), raw: { echo } };
    await page.keyboard.down("Control"); await page.keyboard.press("KeyU", { delay: 30 }); await page.keyboard.up("Control");
    await settle();
  },
  async node() {
    await moveTo(TERMINAL); await page.mouse.down(); await sleep(60); await page.mouse.up(); await settle();
    const done = [], rates = [];
    for (let i = 0; i < Math.min(N, 3); i++) {
      await typeText("clear"); await page.keyboard.press("Enter", { delay: 30 }); await settle();
      await typeText("node -e 'console.log(6*7)'"); await settle();
      await page.evaluate(() => window.__lat.reset());
      const a = await sched();
      await page.keyboard.down("Enter");
      const t = await page.evaluate(() => window.__lat.lastInput("keydown"));
      await sleep(40); await page.keyboard.up("Enter");
      const d = await latency("prompt2", t, 600_000);
      const b = await sched();
      done.push(d); rates.push(rate(a, b));
      log(`node #${i + 1}: prompt back ${d} ms after Enter, ${rates.at(-1).instructionsM}M instr @ ${rates.at(-1).mips} MIPS`);
      await settle();
    }
    result.scenarios.node = { promptMs: stats(done), raw: { done, rates } };
  },
  async mips() {
    await moveTo({ x: 640, y: 700 }); await settle();
    const jobs = { nodeIntLoop: `node -e 'let s=0;for(let i=0;i<2e7;i++)s=(s+i*7)|0;console.log(s)'`,
      shellLoop: `i=0; while [ $i -lt 40000 ]; do i=$((i+1)); done` };
    result.scenarios.mips = {};
    for (const [name, cmd] of Object.entries(jobs)) {
      const a = await sched();
      await page.evaluate((c) => window.wvmDemo.exec(c, 1_800_000, { quiet: true }), cmd);
      const b = await sched();
      result.scenarios.mips[name] = rate(a, b);
      log(`mips ${name}: ${JSON.stringify(result.scenarios.mips[name])}`);
    }
  },
};

try {
  for (const name of scenarios) {
    assert.ok(run[name], `unknown scenario ${name}`);
    log(`scenario ${name}`);
    await run[name]();
    if (name !== "click" && name !== "sweep") log(JSON.stringify({ ...result.scenarios[name], raw: undefined }));
  }
  result.jit = await page.evaluate(async () => { try { return await window.__jitStats?.(); } catch { return null; } });
  // Disk I/O of the session: reads that had to wait for the end of a run slice (`fetchWaits`)
  // and chunks served from the whole-image prefill (`localHits`).
  result.disk = await page.evaluate(async () => {
    try {
      const s = await window.__schedulerStats?.();
      const f = await window.__chunkedStats?.();
      return { fetchWaits: s?.fetchWaits ?? null, fetchRequestedChunks: s?.fetchRequestedChunks ?? null,
        fetchWaitTotalMs: s?.fetchWaitTotalMs ?? null, localImage: f?.localImage ?? null,
        localHits: f?.localHits ?? null, localBytes: f?.localBytes ?? null, networkFetches: f?.fetches ?? null };
    } catch { return null; }
  });
  // Required measures: a missing sample means the tool could not see the effect it timed.
  const required = { click: ["resultMs"], sweep: ["resultMs", "cursorArriveMs"], type: ["echoMs"], node: ["promptMs"] };
  result.missing = Object.entries(required).flatMap(([name, keys]) => keys
    .filter((k) => result.scenarios[name] && result.scenarios[name][k].missing !== 0)
    .map((k) => `${name}.${k}`));
} finally {
  result.consoleErrors = consoleErrors;
  result.finishedAt = new Date().toISOString();
  const summary = Object.fromEntries(Object.entries(result.scenarios).map(([k, v]) => [k, { ...v, raw: undefined }]));
  log("SUMMARY", JSON.stringify(summary, null, 1));
  if (opt.out) {
    fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
    fs.writeFileSync(path.resolve(opt.out), JSON.stringify(result, null, 2) + "\n");
    await page.screenshot({ path: path.resolve(opt.out).replace(/\.json$/u, "") + ".png" }).catch(() => {});
    log("wrote", opt.out);
  }
  await browser.close();
}
if (result.missing?.length) {
  console.error(`[desktop-latency] missing samples: ${result.missing.join(", ")}`);
  process.exit(1);
}
