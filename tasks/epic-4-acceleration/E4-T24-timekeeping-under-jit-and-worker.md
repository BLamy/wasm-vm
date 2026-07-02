---
id: E4-T24
epic: 4
title: Timekeeping under JIT and worker — mtime sources, hybrid clocking, no time warps
priority: 424
status: pending
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

## Verification log
(empty)
