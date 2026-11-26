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

### 2026-11-25 — verifier — VERDICT: refuted

Fresh session; head `e4599fe73` (`git diff d28394aff e4599fe73 -- crates` is empty). Predictions
were written after reading the task and the diff and before any evidence file was opened or
anything was run: `evidence/e5-t37a/verifier/predictions.txt`. My tests are
`evidence/e5-t37a/verifier/verifier_tests.rs` (19 tests named `v37a_*`: own guests, host clocks
and parameters; 15 pass, the 4 named `*_REFUTES` fail), output in `verifier-tests.log` beside it.
No implementation file was changed; sabotage edits were restored each time.

**Failed**

- C5 "a bounded lag that loses time while the guest is asleep" — FAILED. Predicted (what the
  claim needs): with yield on and a 50 ms bound, host time that passes while the guest sits at a
  reported wait is on the guest clock at its next `wfi`. Observed, divider 10, all three loop
  flavours (general, batched `--no-turbo`, turbo):
  (a) `v37a_bounded_lag_keeps_time_slept_before_a_host_wake_REFUTES`: the guest reports a wait
  of 9000 ms; the host clock moves 5000 ms; the host raises an enabled interrupt (CLINT `msip`)
  and runs; 3020 instructions retire between the two waits; guest time moved 500,302 ticks
  (50.03 ms) — 49,499,698 ticks (4.95 s) discarded — and the remaining wait reads 8949 ms, so
  the armed timer fires 4.95 s late.
  (b) `v37a_bounded_lag_keeps_time_a_host_overslept_REFUTES`: no host event at all — the host
  sleeps the reported wait plus 2000 ms, the guest's own timer handler retires about 3000
  instructions; guest time is 500,302 ticks past the deadline, 19,499,698 ticks (1.95 s)
  discarded.
  Controls pass (`v37a_bounded_lag_host_wake_controls`, `…_oversleep_controls`): a handler of
  470 retirements, or no bound, gives the full 50,000,000 / 20,000,000 ticks.
  Cause: `lib.rs:5639` judges `worked` from retirements since the last consultation and
  `time.rs:190-195` applies the bound to the whole host interval since then; 3020 retirements
  are microseconds of it, the rest was the reported wait. Contradicts the Boundary ("Time that
  passed while the guest was only waiting (the host may have slept) still passes in full") and
  `lib.rs:5490-5491` ("never bounded"). The worker's test only ever follows a wait with a
  3-instruction idle pass. Demand: make both tests pass (time slept at a reported wait, and
  time overslept past a deadline, must reach the guest clock before the work that follows a
  wake is charged as busy lag), or withdraw that sentence and state what E5-T37b must do
  instead; then re-record.
- B5/C3 "pure ICount and wall-clock machines never report an idle wait" / "a stale wait" —
  FAILED. `v37a_a_recorded_wait_does_not_outlive_a_clock_change_REFUTES`: a paced run ends at a
  waiting `wfi` (wait 703,200 ns, not taken); then `set_icount_clock()` →
  `guest_clock_mode() == ICount` and `take_idle_wait_nanos() == Some(703200)`; the same after
  `set_wall_clock()`; the same after `load_resume()` of the reset-state blob (pc back at the
  first instruction, a wait for a `wfi` that guest never ran); and after `rebase_guest_clock()`
  with the guest ahead of the host clock the true distance from the pacer's new ceiling is
  498,600 ns while 703,200 is reported. `lib.rs:5574`, `5420`, `4157`, `5558` are untouched by
  the diff; only `set_paced_icount_clock` and `set_paced_idle_policy` clear the wait. Low
  severity (it needs a host call between the run and the take), but it is the acceptance
  bullet's "never". Demand: drop or re-derive the recorded wait in every host call that
  changes what it means.
- N5 (my novel attack) `lib.rs:5643-5644` "nothing can happen in the guest until the host clock
  gets there or the host delivers an event" — FAILED.
  `v37a_no_wait_is_reported_while_an_interrupt_is_deliverable_REFUTES`: a block
  `sw <1>, msip; wfi` with MSIE set. With interrupt batching `mip` is refreshed at block
  boundaries only, so the `wfi` retires with a stale `mip`, `mip_and_mie_nonzero()` is false
  and a wait of 10,000,000,100 ns is reported with `msip = true`; the next run call, host clock
  unchanged and nothing delivered, takes the interrupt at once. A host that honours the wait
  sleeps 10 s on a deliverable interrupt. Narrow: it needs the interrupt-raising store in the
  `wfi`'s own block, which the Linux idle path does not do. Demand: decide the wait on current
  interrupt levels, or correct the comment and record the limit for E5-T37b.

**Needs evidence**

- COVERAGE/SABOTAGE — six mutants of changed behaviour survive the worker's 7 tests
  (`evidence/e5-t37a/verifier/sabotage.log`): `IDLE_SPIN_INSTRS` 2048 → 4096; `>` → `>=` on it;
  `set_paced_icount_clock` not resetting `idle_consult_retired` (every worker test selects the
  clock at retired = 0); `set_paced_idle_policy` not handing the bound to an existing pacer;
  `set_paced_icount_clock` and `set_paced_idle_policy` not clearing a recorded wait. Each is
  killed by one of `v37a_idle_spin_threshold_is_exactly_2048_retirements`,
  `v37a_clock_selected_mid_run_and_bound_selected_after_the_clock`,
  `v37a_wait_is_current_or_absent_and_every_call_makes_progress`. Demand: carry tests that pin
  them (mine may be promoted as they are).
- `IDLE_SPIN_INSTRS` — the measurement the claim and `lib.rs:837-839` cite (257–1024 against
  more than 4096, nothing between) has no evidence file. Demand: commit the histogram and how
  it was taken.

**Held** (carry forward while `crates/core/src/{lib,time}.rs` and these digests are unchanged)

- E1–E3: `gates.log` sha256 `79b23824cbb8…2f89`; the logs say what the claim says (of the 7
  `paced_idle` tests one, `paced_idle_clock_tests::paced_selection_refuses…`, predates the
  task); no `#[ignore]`, disabled assertion or `cfg(test)` branch in the non-test hunks.
- A1–A4: 7/7 and 431/431; oracle: six digests identical, only the baseline README differs;
  desktop equivalence at 2,000,000,000: `0dab1ccaa237df29` / 1,999,831,660 /
  `ed70e270…38701`; at my budget 777,777,777: `d97496f20e00e7ac` / 777,691,269 /
  `e87de723…3df6`, turbo = ordinary, and byte-identical to a CLI built from the pre-task commit
  `ee5582ac6` (`cold-clone.log`).
- B1/B2 `v37a_yield_off_uses_the_budget_and_yield_on_reports_ceiling_to_deadline`: yield off
  (never selected, or selected false) uses 33,333 of 33,333; yield on stops with the `wfi` the
  last retirement, wait = (mtimecmp − 12,345,678) × 100 ns exactly, reported once; a host that
  sleeps exactly the wait reaches the deadline, one tick less reports `Some(100)`.
- B3/C1/C2/C9 lockstep (`v37a_lockstep_*`): the subject (yield on; general, batched and turbo
  loops) against a yield-off control replaying every call one work slot at a time — an S-mode
  guest on the built-in SBI timer, an M-mode guest with the `wfi` last in an inline block and
  straddling a page, 12 seeded random programs; dividers 2/7/33, host steps 1/13/400/25,000
  ticks, bounds none/0/300 ns/1 s, four budget patterns. 792 runs, 2,551,170 calls, 591,138
  yields: every yield ended on a `wfi` that my own predicate says must wait, none was missed,
  every other call used its budget; `observe()` and RAM equal after every call, resume bytes at
  every sample.
- B4/C6: 5,000 busy instructions, host 7.3 s ahead, bound 12.5 ms → exactly 125,000 ticks,
  once (20 further waits add nothing; deadlines a quarter-bound apart do not stack it);
  1.7 s and 250 × 3 ms of pure waiting pass in full.
- C7: 2048 retirements between consultations is waiting, 2049 is work.
- C3a/b, N3: a wait is dropped by a call that retires anything else, is reported when recorded
  on the last budget slot, and 1,000 calls with a standing host clock each retire one idle pass.
- C4: the policy is inert under pure ICount, wall clock, an exact session and live-unrecorded
  (lockstep-equal to a machine without it); a paced clock cannot be combined with a session; a
  key staged after a reported wait stops the yield and the pacer is not consulted.
- C8: resume bytes at a waiting `wfi` equal a policy-free machine's; a restore keeps the policy.
- N2: bound `u64::MAX`, deadline `u64::MAX − 1`, host clock at `u64::MAX` then backwards: no
  panic, wait saturates to `u64::MAX`, guest time never rewinds.

COVERAGE: every changed line is executed by a test. Waived: `.min(u128::from(u64::MAX))` in
`set_paced_idle_policy` (cannot bind for a `u64` of nanoseconds) and `.max(1)` at `lib.rs:5645`
(an equivalent mutant: `limited < d` implies the recomputed ceiling is below `d`). The worker's
machines run the general loop or the turbo loop; the batched `--no-turbo` loop under yield is
exercised by my lockstep only.

SABOTAGE (mine, none of the worker's three): killed by the worker's tests — anchor not moved
when clamping; `limited <= d`; the run-start clear removed; wait measured from guest time;
`rebase` dropping the bound; the bound not handed to a new pacer; `take` not clearing. Survive
— the six above, and `.max(1)` removed (equivalent). `git status` clean after each.

MOCK & ENV, cold clone: sparse clone at `e4599fe73`, `env -i` with only HOME/PATH/TERM: 7/7,
431/431, release build, oracle digests and both desktop equivalences as above
(`evidence/e5-t37a/verifier/cold-clone.log`); clone deleted. No golden value in the worker's
tests is computed by the code under test other than the yield-off control, which is the claim.

SUITE: n/a until the refutations clear. `verifier_tests.rs` is kept as evidence and builds with
one `include!` line (its header says how); at re-verification promote the 15 passing tests and,
once fixed, the four `*_REFUTES` ones.

Not checked: the browser run (no server in this session; nothing selects the policy, so it
cannot bear on the claim) and the desktop measurement behind 2048.

Follow-ups, not part of the verdict: the diff adds a sixth error (`idle_max_busy_lag_ticks`,
`idle_consult_retired` never read) to `make clippy`'s `zicsr-stub` line, which already failed
with five at `ee5582ac6` (`zicsr-stub-clippy.log`); the doc of `Machine::run` still says it
returns "after exactly `max_instrs` retirements".

Commands: `cargo test -p wasm-vm-core --lib paced_idle`; `cargo test -p wasm-vm-core --lib`;
`cargo test -p wasm-vm-core --lib v37a_ -- --nocapture --test-threads=1`;
`cargo build --release -p wasm-vm-cli`;
`bash tools/perf/oracle.sh target/release/wasm-vm target/verifier-e5t37a-oracle` + `diff -r`;
`bash tools/perf/turbo-equivalence.sh {2000000000,777777777} …`;
`cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings` (with my tests
included); `cargo fmt --check`; the two wasm32 builds;
`cargo clippy -p wasm-vm-core --no-default-features --features std,trace,zicsr-stub --lib -- -D warnings`;
14 mutations × `cargo test -p wasm-vm-core --lib -- paced_idle v37a_`.
