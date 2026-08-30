---
id: E4-T24
epic: 4
title: Timekeeping under JIT and worker — mtime sources, hybrid clocking, no time warps
priority: 424
status: verification-debt
depends_on: [E4-T12, E4-T23]
estimate: M
capstone: false
---

## Goal
Guest time stays sane when the CPU runs 10–50x faster and lives on a throttleable worker:
a defined mtime architecture — wall-clock-authoritative (`performance.now()`-derived,
scaled to the DT-declared timebase frequency) with monotonicity clamps and catch-up
policy after tab throttling/suspension, plus an optional deterministic instruction-count
mode (icount) for the lockstep/fuzz rigs — so `sleep 1` sleeps one second, timestamps
never go backward, and timer interrupts are delivered when mtimecmp says, at JIT speed.

## Context
The interpreter era could conflate instructions with time; the JIT breaks any such
assumption 10–50x over, and background tabs break wall clock the other way (Chrome
throttles timers and may clamp performance.now progression; a resumed tab can see a huge
mtime jump that makes the guest kernel deliver a storm of missed ticks or trip watchdog/
RCU-stall warnings). Policy per design doc: mtime = clamped monotone function of host
wall clock; after a suspension gap > threshold, *slew* rather than step (bounded catch-up
rate) so the guest sees fast-but-continuous time, and cap total forwarded time (a 6-hour
background gap should not replay 6 hours of ticks — jump-with-notification is the
documented exception, mirroring real-hardware suspend/resume where the kernel resyncs
from RTC; we expose a goldfish-RTC-style device or SBI TIME already — verify the resync
path). mtimecmp scheduling drives the E4-T22 `Atomics.wait` timeout; icount mode threads
the E4-T10 instruction budget into a virtual mtime for reproducibility. QEMU's `-icount
shift=auto,align=on` is the studied prior art.

## Deliverables
- `TimeSource` abstraction: WallClock (default) and ICount (deterministic) impls; one
  place computes mtime, used by CLINT reads, mtimecmp scheduling, and SBI time queries.
- Throttle/suspend handling: visibilitychange hooks + gap detection in the worker
  (deadline overshoot measurement), slew-based catch-up with documented bounds.
- Timer delivery correctness under JIT: mtimecmp deadline → `Atomics.wait` timeout /
  instruction-budget clamp so delivery error < 1 ms when foregrounded.
- Tests: guest `sleep 1` wall-accuracy; `date` monotonicity across simulated 10-minute
  background gap; timer-interrupt latency histogram under CoreMark load.
- ICount mode wired into the differential rig (consumed by E4-T25).

## Acceptance criteria
- [ ] `time sleep 1` in-guest: 1.0 s ± 50 ms wall clock, foreground, under JIT.
- [ ] Simulated background throttle (scripted 10 min gap): on resume, guest `date`
      advances monotonically, no RCU-stall/soft-lockup warnings in dmesg, and shell
      responsive within 2 s.
- [ ] CLOCK_MONOTONIC sampled in a tight guest loop never decreases across 10 minutes of
      mixed JIT/interpreter/eviction churn (directed test).
- [ ] Timer delivery error p99 < 1 ms foreground under CoreMark load (histogram evidence).
- [ ] ICount mode: two runs of the same guest binary produce identical instruction-
      timestamped traces (determinism proof).

## Adversarial verification
Refute with clock cruelty. Attack angles: (1) benchmark-integrity attack: verify CoreMark
scores are computed against honest time — cross-check guest-reported elapsed vs host wall
clock during a JIT run (a too-slow mtime inflates scores; >2% skew refutes and invalidates
the epic's headline numbers — this check is mandatory); (2) warp hunt: flip visibility
on/off every 500 ms for 5 minutes during a `while true; do date; done` loop — any
backward or > slew-bound forward jump in output refutes; (3) storm test: set mtimecmp
storms (100 Hz guest timer via a test kernel config or hrtimer-heavy workload) and
compare tick counts guest-side vs expected over 60 s — drift > 1% refutes; (4) suspend
the worker (DevTools pause) 30 s mid-boot and resume — kernel calibration (lpj/timebase)
must not be poisoned into permanent misbehavior; (5) run the E4-T25 lockstep rig in
ICount mode twice and byte-diff the traces — nondeterminism refutes the mode's claim.

## Design (as built)

`TimeSource` (`crates/core/src/time.rs`) is the ONE owner of `mtime` derivation, in two modes:

- **ICount** (default): `mtime = retired / clock_div`, a pure function of the retire count — byte-for-
  byte the E1-T12 retire clock. `Machine::advance_clock` stays on this path unchanged, so every
  determinism / lockstep / `predecode_diff` gate is untouched. This is the mode the E4-T25 rig runs
  under so timer interrupts land at identical retire indices on both engines.
- **WallClock**: host-wall-derived, scaled to `TIMEBASE_FREQ_HZ` (10 MHz), via an injected
  `MonotonicClock` (no host time API named in `no_std` core; integer-only math — no f64 intrinsics).
  `TimeSource::sample_wall(host_ns, current_mtime)` applies, in one place: (1) a **monotonicity clamp**
  (`last_mtime` floor — never regresses even if the injected host clock jitters backward; also honors a
  software `mtime` write as a floor); (2) **gap detection** (deadline overshoot vs `gap_threshold` =
  100 ms); (3) **bounded slew** for a moderate gap — catch up at ≤ `slew_multiplier` (2×) real time
  until it converges, never a raw jump; (4) the **jump-with-notification exception** for a gap >
  `max_slew_gap` (10 s): jump straight to the wall target, re-anchor, and raise a `TimeJump` so the host
  surfaces it and the guest resyncs from the RTC (mirrors hardware suspend/resume). Bounds are the
  documented `WallClockPolicy::DEFAULT` constants; a 6-hour background gap therefore does NOT replay 6
  hours of ticks.

`Machine::set_wall_clock(clock, policy)` arms wall mode; `sample_wall_clock()` recomputes `mtime` once
per block boundary (before `sync_clint` samples MTIP) so CLINT reads, `mtimecmp`/`stimecmp` scheduling,
and the `rdtime`/SBI-time shadow all see the single clamped value. `wfi_fast_forward` is a no-op in wall
mode (jumping to a deadline would make `sleep` return early). `take_time_jump()` drains the resync
notification. The goldfish RTC (`dev/rtc.rs`) already reads real wall time independently, so its `date`
value and a wall-mtime jump agree — the verified resync path.

## Verification log

**2026-08-06 — headless core VERIFIED (native).** Files: `crates/core/src/time.rs` (new),
`crates/core/src/lib.rs` (TimeSource wiring: fields, `advance_clock` guard, `sample_wall_clock`,
`set_wall_clock`/`set_icount_clock`/`take_time_jump`/`clint_mtime`, `wfi_fast_forward` guard, `time`
module), `crates/jit-runtime/tests/timekeeping.rs` (new).

Gates run + passed (real output):
- **AC5 ICount determinism** — `icount_two_runs_identical_mtime_trace`: two JIT runs byte-identical —
  *"325 trace samples, timer fired at retired=Some(6311)"*, identical across both runs; exactly one
  timer interrupt.
- **AC3 CLOCK_MONOTONIC never decreases** — `clock_monotonic_never_decreases_under_churn`: *"mtime
  monotone across 52800 samples of JIT/interp/eviction churn (evictions=9998)"* — asserted non-
  decreasing at every sample.
- **Monotonicity clamp + slew unit tests** (`time` module, 6 tests): clamp under jittery-backward host,
  bounded slew for a moderate (5 s) gap capped at 2× real per sample, jump-with-notification for a
  6-hour gap landing exactly at the wall target + re-anchor, software-write floor, ICount purity.
- **ICount-lockstep-with-interrupts (the E4-T25 leg deferred)** —
  `icount_lockstep_with_timer_interrupts_byte_identical`: JIT master vs shadow interpreter byte-
  identical WITH a timer interrupt — *"retired=9009, mtime=9009, timer_ints=1, jit_blocks_exec=2937"*,
  identical registers/PC/mtime/retired/interrupt-count.
- Regressions green: `wasm-vm-core` full suite (169 lib + all integration incl. `determinism`, `clint`,
  `interrupts`, `plic`; `predecode_diff` 76.9 s + `predecode_smc_diff` 125 s byte-identical, 0 failed);
  `wasm-vm-jit-runtime` full suite (verdict-identical 16, `lockstep_fuzz` 5, `chaining`, `eviction`,
  `timekeeping` 3 — 0 failed); wasm32 `no_std` core build (+`trace`) clean; `crates/wasm` release build
  clean; `clippy` (core+jit-runtime, tests) clean; `fmt --check` clean.

## Verification debt (deferred — needs booted-guest / browser on Linux `dev`; the mac reaps browser boots)

- **AC1** — in-guest `time sleep 1` = 1.0 s ± 50 ms foreground under JIT. Needs WallClock mode driven by
  a real host `performance.now()`/`Instant` in a booted guest. Injection point exists:
  `Machine::set_wall_clock(Box<dyn MonotonicClock>, WallClockPolicy)`. NO number recorded.
- **AC2** — scripted 10-min background throttle → guest `date` monotonic on resume, no RCU-stall/soft-
  lockup in dmesg, shell responsive < 2 s. The gap-detection + slew POLICY that makes this safe is
  verified headless above; the browser `visibilitychange` hook that FEEDS gap detection into
  `sample_wall`, and the booted-guest run, are dev/browser debt. NO number recorded.
- **AC4** — timer-delivery error p99 < 1 ms foreground under CoreMark (histogram). Needs a booted
  CoreMark run in wall mode. NO number recorded.
- **Adversarial** benchmark-integrity skew check, visibility-flip warp hunt, 100 Hz storm drift,
  DevTools-pause mid-boot — all need the booted guest / browser; deferred with the above. NO numbers
  recorded.
- **Browser wiring**: `set_wall_clock` injection + `take_time_jump` surfacing + the `visibilitychange`
  listener belong in `crates/wasm` / the worker JS; they drop onto the verified core API on `dev`.

### 2026-08-29 — worker evidence — local restored Node browser sleep check

Ran the real worker-backed restored `node-alpine` guest in separately installed Google Chrome
`152.0.7977.65` at `http://127.0.0.1:8131/?guest=node-alpine&profile=1&jit=0|1`, using the exact
command `time sleep 1` once with the interpreter and once with JIT enabled. Both arms exited 0 and
printed guest output `real    0m 1.01s`, `user    0m 0.00s`, `sys     0m 0.00s`. The interpreter arm
completed the browser command in `1881.935 ms`; the JIT arm completed it in `2874.400 ms`. The
recorded scheduler stats show 24 slices and `11,998,071` retired instructions in each arm; the JIT
arm executed JIT blocks (`retiredViaJit` increased from `165,459` to `1,056,024`), while the
interpreter arm did not. The only browser console error was the known `/favicon.ico` 404 from the
development server. Full raw evidence is
`evidence/epic-4-t24/node-alpine-browser-sleep-ab-2026-08-29.json`.

This strengthens the implemented deterministic/WFI behavior for a live restored guest and records
the actual browser/JIT path, but it does not close the unimplemented WallClock mode, the scripted
10-minute throttle/resume run, the CoreMark timer-latency histogram, or the ICount trace-determinism
acceptance criterion. Host command elapsed time includes browser/fetch/worker overhead and is not
substituted for guest wall-clock time.

### 2026-08-29 — fresh verifier — VERDICT: needs-evidence

- **HELD:** The worker-backed JIT arm exits 0, reports guest `real 0m 1.01s`, and retires JIT work in
  `evidence/epic-4-t24/node-alpine-browser-sleep-ab-2026-08-29.json`.
- **NEEDS EVIDENCE:** That bounded run does not establish foreground WallClock mode, the scripted
  10-minute throttle/resume behavior, the CoreMark timer-delivery p99 histogram, or byte-identical
  ICount traces. The task's browser debt therefore remains open.

The verifier classified the item as `needs-evidence`; no verified status is claimed.
