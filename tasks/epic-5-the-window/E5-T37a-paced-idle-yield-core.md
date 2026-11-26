---
id: E5-T37a
epic: 5
title: Paced idle in the core — a waiting wfi ends the run slice and reports the wait; busy lag is bounded
priority: 0.387644
status: in-progress
depends_on: [E4-T40b]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/core` only: `time::IdlePacer` and the paced branch of `Machine::wfi_fast_forward`,
plus one test of the run loop's budget condition. Everything is opt-in host policy for the
paced ICount clock (`TimeMode::PacedICount`); pure ICount and wall-clock machines, and paced
machines that do not opt in, behave exactly as before.

Why (measured on the warm Replay desktop, 2026-11-25): under the retire-count clock an idle
guest's `wfi` jumps guest time to the next timer deadline, so guest time runs 9–12 times
faster than real time while idle (650 times with the session monitor stopped). Periodic guest
work then runs many times per real second (the monitor script, Chrome's memory and hang
timers, kernel workers): 37–80 M instructions per second of the worker's ~155, forever, on a
pegged host core. The paced clock already limits idle jumps to the host clock, but the run
slice then spins on `wfi`, and a guest that was busy (guest time runs at about 0.2x real time
under load) is allowed to skip all of the time it fell behind in one burst.

Two additions, both selected by one host call (`Machine::set_paced_idle_policy`):

1. **Idle yield.** When a `wfi` retires and the nearest timer deadline is still in the paced
   future, the machine records how far away it is and the run call returns at that boundary
   (`RunOutcome::MaxInstrs`, as a smaller budget would). `take_idle_wait_nanos()` reports the
   wait once. The retire stream is unchanged: after such a `wfi` the guest goes round its idle
   loop to the next `wfi` either way; only where the host call ends moves.
2. **Bounded busy lag.** When the guest did real work since the pacer was last consulted
   (retire-derived time advanced by more than one idle-loop iteration), at most
   `max_busy_lag` of the time it fell behind may be skipped by idle jumps; the rest is
   forgotten. Time that passed while the guest was only waiting (the host may have slept) still
   passes in full, so an idle guest's clock follows the host's.

## Deterministic acceptance

`cargo test -p wasm-vm-core --lib paced_idle` passes, including:

- yield off (the default): a paced guest spinning on `wfi` uses its whole budget, as before;
- yield on: `run(n)` returns after the waiting `wfi` with fewer than `n` retired,
  `take_idle_wait_nanos()` is the distance from the pacer's ceiling to the deadline, a second
  take is `None`, and after the host clock passes the deadline the next run jumps to it and
  reports nothing;
- the retire trace, registers, `mtime` and resume blob after the same total number of
  retirements are identical with yield on (many short run calls) and yield off (one call),
  with the turbo loop on and off, on a guest that takes timer interrupts out of `wfi`;
- bounded lag: after a busy stretch during which the host clock ran far ahead, the next idle
  jump moves guest time by exactly `max_busy_lag`; after a stretch of only idle-loop
  iterations it moves by the full host elapsed time;
- pure ICount and wall-clock machines never report an idle wait.

`bash tools/perf/oracle.sh` and `bash tools/perf/turbo-equivalence.sh` (pure ICount) still
reproduce their committed digests.

## Adversarial verification

High risk (guest time). Attack list: a run call that returns early when nothing is waiting, or
fails to return when something is; a stale wait reported after other work ran; a wait reported
in a mode that cannot honour it (pure ICount, wall clock, an exact session, a pending host
wake such as a held key); the equivalence above at other seeds, budgets and clock steps; a
bounded lag that loses time while the guest is asleep, or lets a busy guest skip more than the
bound; the idle-spin threshold misjudging a short real wakeup; snapshot/resume bytes changing
(the policy must not be serialized); the turbo loop exiting at a different instruction than
the ordinary loop when the wait is recorded mid-run.

## Verification log
