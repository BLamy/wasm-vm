---
id: E5-T37a
epic: 5
title: Paced idle in the core — a waiting wfi ends the run slice and reports the wait; busy lag is bounded
priority: 0.387644
status: implemented
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

### 2026-11-25 — worker — claim (head `d28394aff`)

Implementation `b9b720157` (`crates/core/src/time.rs`, `crates/core/src/lib.rs`, tests in
`crates/core/src/turbo_equivalence_tests.rs` and `time.rs`, rebuilt `web/dist`); `d28394aff`
only refreshes the generated `web/gpu-checkpoint-build.js` (equal to the copy in `web/dist`).

What changed:

- `time::IdlePacer`: `max_busy_lag_ticks` (default unbounded), `limit_deadline_after(host,
  current, deadline, worked)` — `limit_deadline` is that with `worked = true`, which makes no
  difference while the bound is unbounded — and `ticks_until(deadline)`.
- `Machine::set_paced_idle_policy(yield_to_host, max_busy_lag_nanos)`,
  `take_idle_wait_nanos()`, `paced_idle_yield()`. In `wfi_fast_forward`'s paced branch the
  machine tells the pacer whether more than `IDLE_SPIN_INSTRS` (2048) instructions retired
  since the last consultation, and with the opt-in records the wait when the jump was limited.
  The run loop returns `MaxInstrs` at its loop top while a wait is recorded, and clears an
  untaken wait when a run call starts. Nothing is serialized.
- `IDLE_SPIN_INSTRS` comes from a measurement on the warm Replay desktop (prototype,
  2026-11-25): of the run slices that ended at a waiting `wfi`, every one retired either
  257–1024 instructions (a spurious pass of the kernel's idle loop: 62–131 per 10 s) or more
  than 4096 (a pass that handled an interrupt: 26–48 per 10 s); none fell in between.
- Reported wait: measured from the pacer's ceiling, not from guest time. A guest whose
  retire-derived time is ahead of the host clock waits for the host to catch up. (My first
  version reported `deadline - guest time`; a test of mine showed it would wake the host
  early, so it was changed before submission.)

Commands, on the working tree that became `b9b720157` unless stated:

- `evidence/e5-t37a/gates.log` (sha256 `79b23824cbb8…`): `cargo fmt --check`;
  `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`;
  `cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown -- -D warnings`;
  `cargo test -p wasm-vm-core --lib paced_idle` (7 pass);
  `cargo test -p wasm-vm-core --lib` (431 pass);
  `cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown`;
  `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`. All exit 0.
- `cargo test --workspace --exclude wasm-vm-wvseccomp` → 191 `test result: ok`, no failure
  (`evidence/e5-t37a/workspace-tests.log`; the excluded crate is Linux-only and does not
  build on macOS: `libc::prctl`, `SYS_seccomp`).
- `bash tools/perf/oracle.sh target/release/wasm-vm target/oracle-e5t37a` then
  `diff -r evidence/perf-overhaul/oracle-baseline …/digests` → only the baseline README
  differs (`evidence/e5-t37a/oracle.log`).
- `bash tools/perf/turbo-equivalence.sh` → `EQUIVALENT (2000000000 instructions)`,
  `trace fnv64=0dab1ccaa237df29`, `trace retired=1999831660`,
  `state sha256=ed70e270…38701` for both runs (`evidence/e5-t37a/turbo-equivalence.log`).
- Sabotage (`evidence/e5-t37a/sabotage.log`), each restored afterwards: the loop-top return
  disabled → 3 of the 7 tests fail; the bound applied without `worked` → 2 fail; a wait
  recorded in pure ICount → 1 fails.
- Cold clone at `d28394aff` (sparse: no `evidence/` except the oracle baseline, no
  `web/dist`), scrubbed `RUSTFLAGS`/`RUST_LOG`/`CARGO_*`: the 7 tests pass, the release build
  succeeds, the oracle digests match, the desktop equivalence is `EQUIVALENT` with the same
  RAM hash (`evidence/e5-t37a/cold-clone.log`).
- Browser, committed `web/dist` at `d28394aff`:
  `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --label e5-t37a-dist --n 5 --scenarios idle,click,sweep,type,node --out evidence/e5-t37a/browser-dist.json`
  → exit 0, no missing samples, the favicon 404 only; idle 150 MIPS, click result median
  384 ms, move-and-click 269 ms, key echo 49 ms, `node -e` 4.9 s: the range of E4-T40d, as
  it must be while nothing selects the policy.

What the tests demonstrate (`cargo test -p wasm-vm-core --lib paced_idle`):

- `paced_idle_yield_ends_the_run_at_a_waiting_wfi_and_reports_the_wait` — dividers 1, 10 and
  64, turbo on and off: the run returns after the `wfi` with under 100 of 100,000 retired; the
  wait is the whole distance to the deadline while the host clock stands still, is reported
  once, is re-derived by the next call, is dropped by a run call when not taken; after half
  the wait on the host clock guest time equals the host's; after the deadline the interrupt is
  taken and nothing more is reported. The control without the opt-in uses its whole budget.
- `paced_idle_yield_leaves_the_retire_stream_unchanged` — 3 guests x 3 dividers x 3 host
  clock steps x 3 lag settings x turbo on/off x 3 budget patterns, each run to its poweroff:
  outcome, trace hash and count, hart snapshot, CLINT, tick residue, progress counters, resume
  position, resume bytes and RAM equal the one-call control without the opt-in; more than
  5,000 yields occur.
- `paced_idle_busy_lag_bound_applies_after_work_and_never_while_waiting` — after 8,000 busy
  instructions with the host 10 s ahead the jump is exactly the bound (50 ms; 0; or the whole
  10 s when unbounded); then 3 s and a hundred 80 ms sleeps of waiting move guest time by
  exactly 3 s and 8 s.
- `paced_idle_policy_is_inert_in_other_clock_modes_and_is_not_serialized` — pure ICount with
  the policy selected is observation-equal to one without it at every budget and has the same
  resume bytes; a wall-clock machine never reports.
- `paced_idle_yield_stays_out_while_a_host_wake_is_outstanding` — with a key staged and not
  released the pacer is never consulted, nothing is reported, the budget is used.
- `time::tests::paced_idle_busy_lag_is_bounded_and_waiting_time_is_not` — the pacer's
  arithmetic, including `ticks_until`, `rebase` keeping the bound, and the unbounded default
  being exactly `limit_deadline`.

Not shown here, and left to E5-T37b: any effect in the browser. Nothing calls
`set_paced_idle_policy` yet, so this task is not reachable from the demo; the roadmap row
belongs to E5-T37b. A held key still stops idle jumps altogether, as before (the guard is
unchanged), so a held key makes the paced guest spin; whether the paced clock should ignore
that guard is a separate question.
