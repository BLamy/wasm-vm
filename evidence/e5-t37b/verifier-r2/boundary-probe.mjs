// E5-T37b verifier round 2, novel attack: boundary values at the wasm -> sleeper seam.
//
// The SHIPPED wasm (a pkg directory given on the command line) is driven in node through its JS
// API under a host clock this script controls exactly (a fake `performance`, stepped by hand),
// and every wait it reports is fed to the real web/idle-sleep.js with fake timers. One loop per
// guest, the same shape as the loader's: run a slice, take the wait, sleep on it or run again.
//
//   node boundary-probe.mjs <pkg-dir> <web-dir> [wasm-file]   > boundary-probe.json
//
// The optional third argument names another .wasm to instantiate with the same JS glue (used to
// run the bundle of the round-1 head, 939f16b9a, through the identical script).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pkg = path.resolve(process.argv[2]), web = path.resolve(process.argv[3]);
const wasmFile = path.resolve(process.argv[4] ?? path.join(pkg, "wasm_vm_wasm_bg.wasm"));

// The host clock: JsHostTimer::new() wants `globalThis instanceof WorkerGlobalScope` and reads
// `.performance` once; it then calls `.now()` on that object for every sample.
let hostMs = 1_000;
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => hostMs } });
globalThis.WorkerGlobalScope = class { static [Symbol.hasInstance](v) { return v === globalThis; } };

const mod = await import(pathToFileURL(path.join(pkg, "wasm_vm_wasm.js")).href);
mod.initSync({ module: readFileSync(wasmFile) });
const { createIdleSleeper, IDLE_SLEEP_MIN_MS, IDLE_SLEEP_MAX_MS } = await import(pathToFileURL(path.join(web, "idle-sleep.js")).href);

const TIME = [0x544958b7, 0xd4588893, 0x00000813]; // lui a7,0x54495; addi a7,a7,-699; addi a6,x0,0
const TAIL = [0x00000073, 0x10500073, 0xffdff06f]; // ecall; wfi; jal x0,-4
const lui = (imm20) => ((imm20 & 0xfffff) << 12 | 0x537) >>> 0;            // lui  a0, imm20
const addi = (imm12) => (((imm12 & 0xfff) << 20) | 0x50513) >>> 0;          // addi a0, a0, imm12
const li = (imm12) => (((imm12 & 0xfff) << 20) | 0x00513) >>> 0;            // addi a0, x0, imm12
const slli = (sh) => ((sh << 20) | 0x51513) >>> 0;                          // slli a0, a0, sh
const TICK_MS = 1e-4; // 10 MHz timebase
const guests = [
  // [name, words that load a0 (null: no set_timer call at all), deadline in ticks (null: none)]
  ["A 2^28 ticks (26.8 s; the worker's guest)", [lui(0x10000)], 2 ** 28],
  ["B 1 tick ahead", [li(1)], 1],
  ["C deadline 0 (already due)", [li(0)], 0],
  ["D no timer armed (wfi straight away)", null, null],
  ["E deadline u64::MAX (SBI: never)", [li(-1)], null],
  ["F deadline 0xffff_ffff_ffff_f000", [lui(0xfffff)], null],
  ["G 12,288 ticks (1.2288 ms, under the 1.5 ms minimum)", [lui(3)], 12_288],
  ["H 15,000 ticks (1.5 ms exactly)", [lui(4), addi(-1384)], 15_000],
  ["I 16,384 ticks (1.6384 ms)", [lui(4)], 16_384],
  ["J 500,000 ticks (50 ms exactly)", [lui(0x7a), addi(288)], 500_000],
  ["K 500,001 ticks (50 ms + 1 tick)", [lui(0x7a), addi(289)], 500_001],
  ["L 0x7ffff000 ticks (214.7 s)", [lui(0x7ffff)], 0x7ffff000],
  ["N 2^63 ticks", [li(1), slli(63)], null],
];

const BUDGET = 1_000, SLICE_COST_MS = 0.02;
const out = { wasm: path.basename(path.dirname(wasmFile)) === "pkg" ? "web/dist/pkg (HEAD)" : path.basename(wasmFile),
  node: process.version, minMs: IDLE_SLEEP_MIN_MS, maxMs: IDLE_SLEEP_MAX_MS, budget: BUDGET, sliceCostMs: SLICE_COST_MS, guests: [] };

for (const [name, load, deadlineTicks] of guests) {
  hostMs = 1_000;
  const words = load ? [...TIME, ...load, ...TAIL] : TAIL.slice(1);
  const m = new mod.WasmLinux(8, new Uint8Array(new Uint32Array(words).buffer), new Uint8Array(0), "", () => {}, false);
  m.setGuestClock("paced-icount");
  m.setPacedIdlePolicy(true, 50);
  let timer = null;
  const sleeper = createIdleSleeper({ setTimer: (fn, ms) => { timer = { fn, ms }; return 1; }, clearTimer: () => { timer = null; } });
  const t0 = hostMs, deadlineMs = deadlineTicks == null ? null : deadlineTicks * TICK_MS;
  const limitMs = deadlineMs == null ? 2_000 : deadlineMs + 1_000;
  const violations = [], firstSteps = [];
  let slices = 0, earlyEnds = 0, sleeps = 0, sleptMs = 0, refusedWaits = 0, zeroWaits = 0, firedAtMs = null, mtimeAtFire = null;
  let minWait = Infinity, maxWait = 0, minDelay = Infinity, maxDelay = 0, retiredTotal = 0;
  while (hostMs - t0 <= limitMs && slices < 400_000) {
    const res = m.runChunk(BUDGET, undefined); const retired = Number(res.retired);
    slices += 1; retiredTotal += retired;
    const wait = m.takeIdleWaitMs(), again = m.takeIdleWaitMs();
    const mtime = BigInt(m.guestClockState().mtime), elapsed = hostMs - t0;
    if (firstSteps.length < 4) firstSteps.push({ hostElapsedMs: +elapsed.toFixed(4), retired, waitMs: wait, mtime: String(mtime) });
    if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 0) violations.push(`slice ${slices}: wait ${String(wait)}`);
    if (again !== 0) violations.push(`slice ${slices}: second take ${again}`);
    if (retired > BUDGET || retired < 0) violations.push(`slice ${slices}: retired ${retired}`);
    if (retired === 0 && wait === 0) violations.push(`slice ${slices}: nothing retired and no wait`);
    if (wait > 0) {
      earlyEnds += 1; minWait = Math.min(minWait, wait); maxWait = Math.max(maxWait, wait);
      if (retired === BUDGET) violations.push(`slice ${slices}: a wait with the whole budget retired`);
      // N5: never told to sleep past the guest's timer (guest time is mtime; 1e-6 ms slack).
      if (deadlineTicks != null) {
        const leftMs = Number(BigInt(deadlineTicks) - mtime) * TICK_MS;
        if (wait > leftMs + 1e-6) violations.push(`slice ${slices}: wait ${wait} ms past the deadline (${leftMs} ms left at mtime ${mtime})`);
      }
    } else zeroWaits += 1;
    if (retired === BUDGET && firedAtMs === null && deadlineMs !== null) { firedAtMs = elapsed; mtimeAtFire = String(mtime); }
    if (firedAtMs !== null) break;
    let resumed = false;
    const armed = sleeper.sleep(wait, () => { resumed = true; }, sleeper.ticket());
    if (armed) {
      const d = timer.ms; sleeps += 1; sleptMs += d; minDelay = Math.min(minDelay, d); maxDelay = Math.max(maxDelay, d);
      if (!(d >= IDLE_SLEEP_MIN_MS && d <= IDLE_SLEEP_MAX_MS)) violations.push(`slice ${slices}: armed ${d} ms`);
      if (d !== Math.min(wait, IDLE_SLEEP_MAX_MS)) violations.push(`slice ${slices}: armed ${d} ms for a wait of ${wait}`);
      hostMs += d; const fn = timer.fn; timer = null; fn();
      if (!resumed) violations.push(`slice ${slices}: timer fired, no resume`);
    } else {
      if (wait >= IDLE_SLEEP_MIN_MS) violations.push(`slice ${slices}: wait ${wait} not slept on`);
      if (wait > 0) refusedWaits += 1;
      hostMs += SLICE_COST_MS;
    }
  }
  const elapsed = hostMs - t0, mtimeEnd = BigInt(m.guestClockState().mtime);
  const g = { name, words: words.map((w) => "0x" + w.toString(16).padStart(8, "0")), deadlineMs,
    slices, retiredTotal, sliceEndedAtWfiWithWait: earlyEnds, slicesWithoutWait: zeroWaits, sleeps, sleptMs: +sleptMs.toFixed(4),
    waitsTooShortToSleepOn: refusedWaits, waitMs: earlyEnds ? { min: minWait, max: maxWait } : null,
    armedMs: sleeps ? { min: minDelay, max: maxDelay } : null,
    hostElapsedMs: +elapsed.toFixed(4), mtimeEnd: String(mtimeEnd), guestMsPerHostMs: +(Number(mtimeEnd) * TICK_MS / elapsed).toFixed(4),
    timerSeenDueAtHostMs: firedAtMs === null ? null : +firedAtMs.toFixed(4), mtimeWhenSeenDue: mtimeAtFire,
    lateByMs: firedAtMs === null || deadlineMs === null ? null : +(firedAtMs - deadlineMs).toFixed(4), firstSteps, violations };
  if (deadlineMs !== null) {
    if (firedAtMs === null) g.violations.push("the timer was never seen due within the deadline + 1 s");
    else {
      // Guest time must not run ahead of the host (beyond the retire-derived busy time of the
      // slices themselves) and the guest must not be later than the 50 ms cap.
      if (BigInt(mtimeAtFire) < BigInt(deadlineTicks)) g.violations.push(`seen due at mtime ${mtimeAtFire}, before the deadline`);
      if (g.lateByMs > IDLE_SLEEP_MAX_MS) g.violations.push(`late by ${g.lateByMs} ms`);
      if (g.lateByMs < -(slices * BUDGET / 10) * TICK_MS - 1e-6) g.violations.push(`early by ${-g.lateByMs} ms (more than its own retirements account for)`);
    }
  }
  out.guests.push(g);
  m.free?.();
}
out.violations = out.guests.flatMap((g) => g.violations.map((v) => `${g.name}: ${v}`));
console.log(JSON.stringify(out, null, 1));
process.exitCode = out.violations.length ? 1 : 0;
