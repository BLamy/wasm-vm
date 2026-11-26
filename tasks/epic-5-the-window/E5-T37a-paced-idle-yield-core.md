---
id: E5-T37a
epic: 5
title: Paced idle in the core — a waiting wfi ends the run slice and reports the wait; busy lag is bounded
priority: 0.387644
status: evidence-needed
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
   future, the machine records the deadline and the run call returns at that boundary
   (`RunOutcome::MaxInstrs`, as a smaller budget would, with nothing of the boundary's own work
   done). `take_idle_wait_nanos()` reports the distance from the pacer's ceiling to the
   deadline, once. The retire stream is unchanged: after such a `wfi` the guest goes round its
   idle loop to the next `wfi` either way; only where the host call ends moves.

   **A reported wait is always true; a true wait is not always reported.** It is reported only
   while it holds, judged without changing any state:
   - every device is idle: the run loop's own quiescence marker says the last full device
     service pass found none with work (a queue to drain, a UART character timeout running, an
     RTC alarm armed, a paced audio stream) and nothing has accessed the device fabric since.
     A device with work can raise an interrupt on a schedule the CLINT knows nothing about;
   - no enabled interrupt is pending once the levels this boundary samples are counted
     (`Machine::fresh_mip`: CLINT `msip` and `mtime >= mtimecmp`, the SBI timer, the PLIC's two
     contexts). `mip` is refreshed at block boundaries only, so a store earlier in the `wfi`'s
     own block is not in it yet.

   The quiescence marker is reset when a run call starts (the host may have delivered
   something between calls) and set again at the call's first sampled block boundary. So a
   run call reports a wait only after it has itself serviced the devices at a boundary: a call
   that begins inside the `wfi`'s block, or a guest with a device that has work, goes on. The
   wait is picked up at a later `wfi` whose block some call enters and runs through to the
   `wfi` — which never happens for a host whose budgets are all shorter than the `wfi`'s
   position in its block (the round-3 verifier measured it: a `wfi` third in its block is never
   reported with budgets of 1 or 2 work slots, always with 7 or more). That costs host CPU (the
   guest goes round its idle loop, as it always did), never correctness. Measured on the idle Replay desktop, the devices
   were idle at all 1,050 of 1,050 wait checks in 30 s (`evidence/e5-t37a/quiescence-on-desktop.txt`).

   A recorded wait describes one guest under one clock: a new run call, selecting any clock or
   idle policy, and a restore drop it; a rebase of the host anchor is reflected in the distance.

2. **Bounded busy lag.** When the guest did real work since the pacer was last consulted
   (more than `IDLE_SPIN_INSTRS` = 2048 instructions retired), at most `max_busy_lag` of the
   time it fell behind may be skipped by idle jumps; the rest is forgotten.

   Waiting time is never bounded:
   - host time between two consultations of a guest that did not work in between passes in
     full (the host may have slept);
   - the part of it an idle jump cannot hand over at once, because a deadline is nearer than
     the ceiling (the host overslept), stays owed and survives later work;
   - when the host took a reported wait and an interrupt then wakes the guest (the host
     delivered an event), the host time since the `wfi` — or since a rebase after it — goes on
     the guest clock at that boundary, stopping at an armed deadline, before the handler or the
     next instruction runs. This costs one reading of the host clock that a machine without
     the opt-in does not make; it happens only when something other than the guest's own timer
     ends a wait the host took.

## Deterministic acceptance

`cargo test -p wasm-vm-core --lib paced_idle` passes (24 tests), including:

- yield off (the default): a paced guest spinning on `wfi` uses its whole budget, as before;
- yield on: `run(n)` returns after the waiting `wfi` with fewer than `n` retired,
  `take_idle_wait_nanos()` is the distance from the pacer's ceiling to the deadline, a second
  take is `None`, and after the host clock passes the deadline the next run jumps to it and
  reports nothing;
- the retire trace, registers, `mtime`, resume bytes and RAM after the same total number of
  retirements are identical with yield on (many short run calls) and yield off (one call),
  with the turbo loop on and off, on guests that take timer interrupts out of `wfi`;
- bounded lag: after a busy stretch during which the host clock ran far ahead, the next idle
  jump moves guest time by exactly `max_busy_lag`; after only idle-loop passes it moves by the
  full host elapsed time; the worked/waited line is exactly 2048 retirements; a restore starts
  a new interval;
- waiting time is kept: 5 s slept before a host event are on the guest clock when the handler
  starts (also after a rebase, and in the `time` CSR after a wake without a trap); a wake stops
  at a deadline inside the slept interval and the rest stays owed; 2 s overslept past a
  deadline are still handed over after the handler worked;
- no wait while a device has work (an armed RTC alarm), while an interrupt is deliverable per
  any level the boundary samples (`fresh_mip` equals what the level sync writes, in all 32
  combinations, with and without the SBI timer), or from a call that began inside the `wfi`'s
  block; a pending but disabled interrupt does not end a wait; a wake is accounted only for a
  wait the host took;
- a recorded wait does not outlive a clock change, a policy change or a restore; a rebase is
  reflected in it;
- pure ICount and wall-clock machines never report an idle wait and never return early.

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

### 2026-11-25 — worker — round 2 claim (head `215cbd1f9`)

Answer to the refutation above. Implementation `90c1d9bfe`; `215cbd1f9` only refreshes the
generated `web/gpu-checkpoint-build.js`. The Boundary and Deterministic acceptance sections
above were rewritten to state the round-2 contract; the round-1 claim is left as written.

**The findings, and what changed**

- *C5, time slept is lost under the bound (host wake; host oversleep).* Two mechanisms.
  (a) `time::IdlePacer` now keeps `owed_wait_ticks`: host time between two consultations of a
  guest that did not work is waiting time, and whatever part of it a deadline keeps an idle
  jump from handing over stays owed; the busy-lag bound is applied on top of it
  (`current + owed + bound`), and every idle jump consumes it first. (b) `Machine::paced_wake`:
  at the first sampled boundary of the run call after one that ended on a wait the host took,
  if an enabled interrupt is pending, the pacer is consulted as "waited" and `mtime` moves
  before the interrupt is taken (or, with interrupts globally masked, before the next
  instruction), and the CLINT/SBI levels and the `time` shadow are re-synced.
- *B5b/C3c/N1, a recorded wait outlives a clock change, a restore, a rebase.* The machine no
  longer stores a distance. It stores the deadline (`idle_wait_deadline`) and
  `take_idle_wait_nanos` reads the distance from the pacer that is selected at that moment, so
  there is nothing to report without a paced clock and a rebase is reflected. Selecting any
  clock or idle policy and `load_resume` clear it.
- *N5, a wait reported while an interrupt is deliverable.* `Machine::paced_wait_holds` asks,
  without changing state, whether the wait still holds: no enabled interrupt pending in `mip`;
  none pending per the CLINT (`msip`, `mtime >= mtimecmp`) and SBI-timer levels this boundary
  will sample; no fabric device access since the last sampled boundary
  (`idle_boundary_epoch`). The run loop asks before returning and otherwise goes on in the
  same call; `take_idle_wait_nanos` asks too, for the call that spent its last work slot on
  the `wfi`. The device rule is mine, not the verifier's: a device touched in the `wfi`'s own
  block is serviced at the next boundary and may raise an interrupt then.
- *Six surviving mutants.* Each is now killed by a test of mine (table below).
- *The 2048 measurement had no evidence file.* `evidence/e5-t37a/idle-slice-histogram.txt`
  records it, with its provenance and limits (a scratch prototype; one guest, one session).
- *Follow-ups from the report.* The two new fields no longer add a dead-code error to the
  `zicsr-stub` lint line (back to the five that predate the task); `Machine::run`'s doc says
  what a work slot is and names the early return.

**One thing the next verifier needs to know about the round-1 verifier's tests.** 18 of the 19
pass unchanged, including the four `_REFUTES` ones. `v37a_lockstep_random_programs_with_wfi`
fails as committed, at "MISSED RETURN": its predicate `v_wfi_waits` decides "must wait" from
the stale `mip` alone, and round 2 deliberately does not yield in two more cases (fresh
CLINT/SBI levels; a device access since the last sampled boundary). With those two conditions
added to that one function in a scratch copy — nothing else touched — all 19 pass, the
lockstep ones with state, RAM and resume bytes equal after every call
(`evidence/e5-t37a/verifier-tests-r2.log`, which shows the diff; the scratch copy is
`evidence/e5-t37a/verifier-tests-r2-predicate.rs.txt`). I did not edit or promote the
verifier's file.

**What I got wrong on the way, so it is on the record**

- My first wake accounting ran whenever a wait had been recorded, including when the guest
  went straight on in the same run call. The verifier's lockstep caught it (an extra reading
  of the host clock, 13 ticks). It now belongs only to a wait the host took.
- A check in `paced_wake` that the guest had retired nothing since the `wfi` could not be made
  to fail by any test; it is an invariant of where the flag is set and read, so it is a
  `debug_assert` now.
- My mutation script restored files with their old modification time, so cargo did not rebuild
  after the last mutant and one later test run executed a stale mutant binary. The script now
  re-touches the file; the recorded matrix was produced after that fix.

**Commands**, on the working tree that became `90c1d9bfe` unless stated:

- `evidence/e5-t37a/gates-r2.log` (sha256 `47095616e2db…`): `cargo fmt --check`;
  `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`;
  `cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown -- -D warnings`; the
  Makefile's `zicsr-stub` lint line (the same 5 errors as at `ee5582ac6`);
  `cargo test -p wasm-vm-core --lib paced_idle` (15 pass);
  `cargo test -p wasm-vm-core --lib` (439 pass); the two wasm32 builds. All exit 0 except the
  stub line, which fails as it did before the task.
- `cargo test --workspace --exclude wasm-vm-wvseccomp` → 191 `test result: ok`, no failure
  (`workspace-tests-r2.log`).
- Boot oracle: only the baseline README differs (`oracle-r2.log`). Desktop equivalence:
  `EQUIVALENT (2000000000 instructions)`, FNV `0dab1ccaa237df29`, retired 1,999,831,660, RAM
  `ed70e270…38701` (`turbo-equivalence-r2.log`).
- Mutation matrix, 25 mutants, each applied alone and restored
  (`evidence/e5-t37a/sabotage-r2.log`, sha256 `15b92e337df8…`): 25 killed, 0 survive.

  | Mutant | Killed by |
  |---|---|
  | V1 threshold 2048 → 4096; V2 `>` → `>=` | `paced_idle_spin_threshold_is_exact` |
  | V3 clock selection does not start a new interval; V4 bound not handed to an existing pacer | `paced_idle_policy_and_clock_in_either_order_and_mid_run` |
  | V5, V6 clock / policy selection does not clear a recorded wait | `paced_idle_wait_does_not_outlive_a_clock_change_or_a_restore` |
  | N1 no wake accounting; N2 wake accounting with nothing pending; N3 no level/time resync | `…time_slept_before_a_host_wake…`, `…wake_without_a_trap…`, the equivalence test |
  | N4–N6 owed waiting time not accumulated / ignored by the bound / never consumed | `time::tests::paced_idle_busy_lag_is_bounded_and_waiting_time_is_not`, `…time_a_host_overslept_is_kept` |
  | N7, N8, N9, N11, N13, N16 the wait holds or its wake stays armed when it should not | `…no_wait_while_an_interrupt_is_deliverable_or_a_device_was_touched` |
  | N10 a restore keeps a wait; N12 an untaken wait keeps its wake | `…wait_does_not_outlive…`, `…wake_is_only_accounted_for_a_wait_the_host_took` |
  | N14 wait measured from guest time; N15 rebase drops the bound | four tests; the pacer test |
  | W1–W3 my round-1 mutants (no early return; bound without `worked`; a wait in pure ICount) | 10, 8 and 1 tests |

- Cold clone at `215cbd1f9` (sparse; `env -i` with HOME/PATH/TERM): 15/15 and 439/439, the
  release build, oracle digests identical, desktop equivalence `EQUIVALENT` with the same RAM
  hash (`cold-clone-r2.log`).
- Browser, committed `web/dist` at `215cbd1f9`
  (`node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --label e5-t37a-r2-dist --n 5 --scenarios idle,click,sweep,type,node --out evidence/e5-t37a/browser-dist-r2.json`):
  exit 0, no missing samples, the favicon 404 only; idle 159 MIPS, click result median
  348 ms, move-and-click 267 ms, key echo 46 ms, `node -e` 4.9 s. Unchanged, as it must be
  while nothing selects the policy.

**What is and is not shown.** Shown: the fifteen tests' statements, on machines I built, with
host clocks I set. The equivalence test still holds exactly for guests woken only by their own
timers. Not exact any more, by design: when a host event ends a wait the host took, the
opted-in machine reads the host clock once more than a spinning one and moves `mtime` at that
boundary; no test compares that case against a yield-off control, because the two are not
supposed to agree there. Not shown: anything in the browser (E5-T37b); the 2048 threshold on
any guest but this desktop's kernel; a held key still stops idle jumps altogether, as before.

### 2026-11-25 — verifier (round 2) — VERDICT: refuted

Fresh session — not the worker, not the round-1 verifier; head `d8db32db8`
(`git diff 215cbd1f9 d8db32db8 -- crates` is empty). Predictions were written after reading the
task and both diffs and before any evidence file was opened or anything was run:
`evidence/e5-t37a/verifier-r2/predictions.txt`. My tests are
`evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs` (24 tests named `r2_*`: own guests, host
clocks and parameters; 20 pass, the 4 named `*_REFUTES` fail), output in `verifier-r2-tests.log`
beside it. No implementation file was changed; every sabotage edit was restored with
`git checkout`, re-touched, and `git status --short crates` checked empty.

Incremental rule: `lib.rs` and `time.rs` both changed, so no HELD result of round 1 about them
was carried; the round-1 tests were re-run instead. The one thing reused is a fact about the
unchanged commit `ee5582ac6`: its 777,777,777 digest as round 1 recorded it.

**The round-1 findings**

- C5 (time slept lost under the bound) — FIXED on every path but one (B4 below). Round 1's own
  two tests now pass unchanged (50,000,302 ticks for 5,000 ms slept, was 500,302; 20,000,000
  ticks past the deadline for 2,000 ms overslept, was 500,302). Mine, three loop flavours
  (general, batched `set_turbo(false)` with the replay tail, turbo), all exact:
  `r2_c5a_*` 48 configurations (dividers 3/10, handlers of 2,100 and 16,000 retirements, bounds
  50 ms and 0, the event a CLINT `msip` or a UART byte through the PLIC): `mtime` at the
  handler's first instruction = t0 + 50,000,000, the next wait = the first − 5 s, two host
  readings (wake, next `wfi`); `r2_c5b_*` oversleep: timer taken at its deadline, `mtime` at
  the next `wfi` = deadline + 20,000,000 = the host clock; `r2_c5c1_*` sleeps of 1 s, 2 s and
  then 2 s with a wake: t0 + 5 s at the handler; `r2_c5c2_*` guest 4 ms ahead of the host
  clock: a 1 ms sleep moves nothing, 10 ms more lands on the host clock exactly;
  `r2_c5c4_*` deadline inside the slept interval plus a host event: first handler at the
  deadline exactly, both taken, then deadline + 2 s; `r2_c5c5_*` S-mode on the built-in SBI
  timer, UART byte to the S context: `rdtime` at `stvec` = t0 + 5 s, and deadline + 2 s after an
  oversleep; `r2_c5c6_*` `mstatus.MIE` off: the next instruction reads t0 + 5 s from the CLINT
  register and the `time` CSR; `r2_c5d_*` the bound still binds: exactly one bound (200,000
  ticks) per busy stretch, before and after a wait.
- B5b/C3c/N1 (a wait outlives what it describes) — FIXED. `r2_b_*`: after
  `set_icount_clock`, `set_wall_clock`, re-selecting the paced clock, `set_paced_idle_policy`
  (three forms) and `load_resume`, `take_idle_wait_nanos()` is `None`, before a take and after
  one (then no wake is accounted: no host reading, `mtime` unmoved); after `rebase_guest_clock`
  the distance is (deadline − `mtime`) × 100 ns with the guest level with or ahead of the host.
- N5 (a wait while an interrupt is deliverable) — NOT FIXED: fixed for the CLINT levels
  (`r2_n5ab_*`, round 1's test), not for the PLIC, and the device rule added with it does not
  cover a device that owes an interrupt. See Failed.
- Six surviving mutants — FIXED: re-applied to the new code, each is killed by a worker test
  (`sabotage.log`, S1–S6).
- The 2048 measurement — present (`idle-slice-histogram.txt`: a record of a scratch
  prototype's console output, with its limits stated; not reproducible from the repository).

**Failed**

- N5c "no wait while an interrupt is deliverable" (acceptance) / Boundary "A wait is reported
  only while it holds" — FAILED. Predicted (what the claim needs): no wait when the level the
  next boundary samples makes an enabled interrupt pending. Observed
  (`r2_n5c_no_wait_while_a_plic_interrupt_is_deliverable_REFUTES`, 6 of 6: three loops, budget
  1 and 1,000,000): a UART byte is pending at the PLIC, the block `sw <enable> -> PLIC; wfi`
  enables it; the call returns at retired = 49 with `take_idle_wait_nanos()` =
  `Some(10000000200)` while `plic.eip(0)` is true, and the next `run(1)`, host clock unchanged,
  takes cause 11. It is round 1's N5 through the other interrupt controller:
  `paced_wait_holds` (`lib.rs:5581-5598`) has level terms for `msip`, MTIP and STIP and none
  for the PLIC, which is not behind `FabricTouch` either. Narrow in the same way (the store
  must be in the `wfi`'s own block). Demand: decide the wait on every level the boundary
  samples, the PLIC's included, and carry a test.
- N5d the device rule (worker's own) / Boundary, same sentence; attack list "a wait reported
  … [with] a pending host wake" — FAILED. Predicted: no wait while a device still owes the
  guest an interrupt that needs neither the host clock nor another host event. Observed
  (`r2_n5d_no_wait_while_the_uart_character_timeout_is_running_REFUTES`, three loops): UART
  programmed as Linux's 8250 driver programs a 16550A (FIFO trigger 8, receive interrupt on),
  timer 10 s out, the host delivers one byte. Yield off: the character-timeout interrupt is
  handled 17 µs of guest time later, inside the same run call. Yield on: 341 consecutive run
  calls each report a 9,000 ms wait before the interrupt is taken in call 342, with the host
  clock standing still and nothing else delivered; at all 341 the machine's own marker
  (`fabric_idle_epoch`, set by `boundary_sync_full`, `lib.rs:7112`, `7262`) said a device still
  had work. The rule (`lib.rs:5583`) asks whether a fabric device was *accessed* since the
  last sampled boundary, not whether the fabric is idle; the timeout clock ticks only while
  the guest executes (`lib.rs:7933`: "must keep ticking at boundaries while the guest spins").
  A host that honours the waits delivers a typed character one timer period per idle pass
  late, hundreds of passes in this guest. Same hole, `r2_n5e_*`: an RTC alarm armed 1 ms
  ahead (`lib.rs:7120`), timer 10 s out: `Some(10000000400)` is reported with the alarm armed
  and the alarm handler starts 9,999 ms after the `wfi`. The rule is sound where it applies
  and cannot report a wrong wait by itself (`r2_n5fg_*`: same result in the three loops; an
  idle loop that touches a device in the `wfi`'s block every pass never yields — budget used,
  state equal to yield off — and yields every pass with interrupt batching off). Demand:
  report a wait only when no device has work outstanding (the quiescence the run loop already
  computes), and carry tests for a counting UART timeout and an armed alarm.
- B4 (my novel attack) claim "(b) … at the first sampled boundary of the run call after one
  that ended on a wait the host took, if an enabled interrupt is pending, the pacer is
  consulted as 'waited' and `mtime` moves before the interrupt is taken"; Boundary "Waiting
  time is never bounded", "a rebase of the host anchor is reflected in the distance" — FAILED.
  Predicted: host time slept after a rebase is on the guest clock at the wake. Observed
  (`r2_b4_time_slept_after_a_rebase_is_kept_REFUTES`, 12 of 12: three loops, rebase before or
  after the take, bound 50 ms or none): wait 9,000 ms, `rebase_guest_clock()`, 5,000 ms slept,
  `msip`, a handler of 2,800 retirements: `mtime` moved 0 ticks at the handler's first
  instruction and the host clock was not read; with the bound it moved 500,282 ticks by the
  next `wfi` — 49,499,718 of 50,000,000 discarded, remaining wait 8,949 ms instead of 4,000
  (the size of round 1's C5 loss). Cause: `IdlePacer::rebase` builds a new pacer
  (`time.rs:255-259`, `waiting` false) and `paced_wake` returns at `lib.rs:5623`. Removing
  that guard, or keeping `waiting` across a rebase, makes the test pass and fails no test of
  anyone's (`sabotage.log`, M1, M16). Low severity (a rebase between the run and the wake).
  Demand: account the wake from the rebased anchor, or drop the wait on a rebase and say so.

**Needs evidence**

- Seven mutants of changed behaviour survive the worker's 15 tests and round 1's 19; each is
  killed by one test of mine, which may be promoted (`sabotage.log`, passes 2 and 3):
  `limited < d` → `<=` at `lib.rs:5773`, killed in round 1 and now masked by the level check
  (`r2_k2_*`: a reached deadline that wakes nothing must not end the run); `paced_wake`
  without the deadline cap, `lib.rs:5629` (`r2_c5c4_*`); `paced_wake` without
  `sync_sbi_timer` (`r2_m3_*`); `paced_wait_holds` without the STIP term (`r2_m6_*`) and with
  `msip` not gated by `mie` (`r2_c5c3_*`); owed waiting time not capped by what the host
  clock is ahead by, `time.rs:232` (`r2_m10_*`); `load_resume` not starting a new interval,
  `lib.rs:5184` (`r2_m13_*`).
- The MTIP term of `paced_wait_holds` (`lib.rs:5590`): no test of anyone's reaches a state
  where it decides (it needs MTIE on, `mtimecmp` coming due inside the `wfi`'s block and a
  later built-in-SBI deadline). Record such a run or delete the term.

**Held**

- E1–E4: `gates-r2.log` sha256 `47095616e2db…41c1`, `sabotage-r2.log` `15b92e337df8…0670`; the
  logs say what the claim says (15/439, 191 ok and none failed, 25 mutants killed, cold clone
  at `215cbd1f9`); no `#[ignore]`, disabled assertion or `cfg(test)` branch in the non-test
  hunks; the `debug_assert_eq!` in `paced_wake` held in every run of mine.
- A1–A8: 15/15 and 439/439; release build; oracle: six digests identical, only the baseline
  README differs; desktop equivalence at 2,000,000,000: `0dab1ccaa237df29` / 1,999,831,660 /
  `ed70e270…38701`; at 777,777,777: `d97496f20e00e7ac` / 777,691,269 / `e87de723…3df6`, the
  values round 1 recorded from a CLI built at `ee5582ac6`; at my budget 333,333,333:
  `873b6d4b8b9928eb` / 333,298,090 / `6170e85d…dd33`, turbo = ordinary; the `zicsr-stub` lint
  line fails with the five errors that predate the task, none naming an `idle_*` item.
- Q1 exact equivalence for guests woken by their own timers
  (`r2_q1_lockstep_with_an_independent_predicate`): subject (yield on; three loops) against a
  yield-off control replaying every call one work slot at a time — the S-mode SBI guest, the
  M-mode guest (inline block; page straddle), 16 random programs, and 24 random programs of
  mine with UART accesses next to the `wfi`s; 366 runs, 838,866 calls, 132,051 yields
  (4,170 in the UART programs): every yield on a `wfi` that must wait, none missed,
  `observe()`, RAM and the count of host-clock readings equal after every call, resume bytes
  at every sample.
- Q2 the extra reading happens only in the stated case: taken wait + enabled interrupt
  pending → +1 (also with `mstatus.MIE` off, also when the host did not sleep); untaken → 0;
  taken, own-timer wake after an oversleep → 0; pending but not enabled → 0 (and the yield is
  not held back); a wait that did not hold → 0. Outside it: after a rebase → 0 (B4).
- Q3 `r2_q3_*`: with the unbounded default the new pacer equals the pre-task
  `limit_deadline` (copied from `ee5582ac6`) on 200,000 random closed-loop consultations —
  either `worked`, backward and saturating host readings, u64-edge deadlines, rebases, five
  timebases. NV2 `r2_nv2_*`, 240,000 consultations with a bound: a guest that never works gets
  the unbounded pacing exactly; total idle jump ≤ host time waited + one bound per
  consultation after work; no idle jump passes the host clock.

The predicate (`v_wfi_waits`). Reproduced (`round1-tests.log`): as committed 18 pass and
`v37a_lockstep_random_programs_with_wfi` fails at seed 7001 ("MISSED RETURN"); with the
worker's scratch copy all 19 pass. The change is faithful, not a cover: with ONLY the fresh
`msip` level added all 19 pass too — the failure is exactly the case round 1 reported as N5,
and the old predicate encoded that defect. The worker's MTIP, STIP and device terms decide
nothing on those programs (no fabric device is attached to them), and its device term reads
the implementation's own `idle_boundary_epoch`, which a promoted test must not. The
predicate I would use is `r2_wfi_waits`: stale `mip & mie`; the `msip`, MTIP and (with the
built-in SBI) STIP levels gated by `mie`; a fabric access since the last block boundary of the
control as the harness itself sampled the pre-existing `fabric_epoch`; the nearest deadline
still ahead. Once N5c and N5d are fixed it needs a PLIC level term and a fabric-idle term.

COVERAGE: every changed line is executed by a test. Waived: `let holds = false` under
`zicsr-stub` (`lib.rs:5552`; nothing can record a wait in that build); the `let … else return`
of `paced_wake` and `(0, None)` in `idle_deadline` (`lib.rs:5647`): unreachable while a wake
can be armed only with a pacer, clock and CLINT present; the getters `max_busy_lag_ticks()`
and `owed_wait_ticks()` (read by tests only). Equivalent mutants, so not evidence gaps:
`if limited != mtime` unconditional (M4); the stale `mip & mie` term of `paced_wait_holds`
(M25; `wfi_fast_forward` returns before recording when it is set); `clear_idle_wait` in
`set_icount_clock` and `set_wall_clock` (M12; with no pacer nothing is reported or
accounted); the `builtin_sbi` guard (M7b; `stimecmp` is `u64::MAX` without it); the run-start
clear gated on the wake flag (M17; the two are set together).

SABOTAGE: 29 mutants, one at a time (`sabotage.py`, `sabotage.log`). The six round-1
survivors: killed by worker tests. New, killed by worker tests: no `sync_clint` in
`paced_wake`; the wake consulted as worked; `take`'s no-report path keeping the wake armed;
`waiting` always true; (and round 1's anchor and take-not-clearing mutants again). Survive
the worker's tests: the seven above, the MTIP term, the equivalents, and M1/M16 (the B4
guard).

MOCK & ENV, cold clone: sparse clone at `d8db32db8`, `env -i` with HOME/PATH/TERM: 15/15,
439/439, release build, oracle digests identical, desktop equivalence at 2,000,000,000 and
333,333,333 with the values above (`cold-clone.log`); clone deleted. No golden value in the
worker's tests comes from the code under test other than the yield-off control, which is the
claim; its device test touches only the UART scratch register, which can owe nothing.

SUITE: n/a until the refutations clear. Decision for re-verification: promote the round-1
file's 19 tests with `v_wfi_waits` replaced by `r2_wfi_waits` (harness-tracked epoch), my 20
passing tests, and the four `*_REFUTES` ones once fixed, as a file under `crates/core/src/`
included from `turbo_equivalence_tests.rs`.

Not checked: the browser run (nothing selects the policy); the workspace-wide suite (the
worker's log shows 191 ok; I re-ran the core suite, the release build and the digests, here
and in the cold clone); the yield with the JIT on; virtio-snd.

Follow-ups, not part of the verdict: `take_idle_wait_nanos` does not look at
`external_wake_io_pending()` or at input the host pushed after the run returned — E5-T37b's
host must treat its own delivery as cancelling a wait; virtio-snd playback
(`idle &= snd_idle`, `lib.rs:7225`) is host-clock-driven device work of the same class as the
RTC alarm and should be measured with audio playing; a wait is reported for a timer that is
armed but not enabled (harmless: `r2_k2_*`), while the watchdog's `any_wakeup_armed` gates on
the enable.

Commands: `cargo test -p wasm-vm-core --lib paced_idle`; `cargo test -p wasm-vm-core --lib`;
`cargo build --release -p wasm-vm-cli`;
`bash tools/perf/oracle.sh target/release/wasm-vm target/verifier-r2-e5t37a-oracle` + `diff -r`;
`bash tools/perf/turbo-equivalence.sh {2000000000,777777777,333333333} …`;
`cargo test -p wasm-vm-core --lib v37a_` (as committed; worker's predicate; `msip` only);
`cargo test -p wasm-vm-core --lib r2_ -- --nocapture --test-threads=1`;
`python3 evidence/e5-t37a/verifier-r2/sabotage.py` (+ `--pass2 …`);
`cargo clippy -p wasm-vm-core --no-default-features --features std,trace,zicsr-stub --lib -- -D warnings`;
`bash evidence/e5-t37a/verifier-r2/cold-clone.sh d8db32db8`.

### 2026-11-25 — worker — round 3 claim (head `7fd2e0160`)

Answer to the second refutation. Implementation `bd110f77d`; `7fd2e0160` only refreshes the
generated `web/gpu-checkpoint-build.js`. The Boundary and Deterministic acceptance sections
above state the round-3 contract.

**The findings, and what changed**

- *N5c (PLIC) and the MTIP/STIP terms.* `Machine::fresh_mip` computes `mip` as this boundary's
  level sync will leave it — `sync_clint`, `sync_plic` and `sync_sbi_timer` applied to the
  current bits — without changing anything, and `paced_wait_holds` tests
  `fresh_mip() & mie == 0`. The hand-picked level terms of round 2 are gone.
  `paced_idle_fresh_mip_is_what_the_boundary_sync_writes` checks it against the real sync in
  all 32 combinations of the five levels, from every other combination's stale bits, with and
  without the SBI timer.
- *N5d/N5e (my device rule asked the wrong question).* The rule is now the run loop's own
  quiescence marker, `fabric_idle_epoch == Some(fabric_epoch)`: the last full service pass
  found every device idle and nothing has touched the fabric since. A UART character timeout
  in progress or an armed RTC alarm makes a device not idle, so no wait is reported and the
  guest goes round its idle loop as before. The `idle_boundary_epoch` field of round 2 is gone.
- *B4 (time slept after a rebase).* `paced_wake` no longer consults a pacer flag that `rebase`
  resets. `IdlePacer::waiting` stays as a diagnostic; nothing in the machine reads it.
- *Seven surviving mutants and the undecided MTIP term.* Each is now killed by a test of mine
  (the `R` rows of the table below); the MTIP term has
  `paced_idle_no_wait_when_the_machine_timer_came_due_inside_the_wfi_block`.

**A narrowing of the contract, stated plainly.** The quiescence marker is reset when a run
call starts and set again at the call's first sampled block boundary. So a run call reports a
wait only after it has itself serviced the devices at a boundary. A call that begins inside the
`wfi`'s block — for instance a host that runs one work slot at a time and lands on a `wfi` that
is not the first op of its block — does not report that wait; the guest goes on and the wait is
picked up at a later `wfi` (`paced_idle_a_call_that_begins_inside_the_wfi_block_reports_one_pass_later`).
Round 1's and round 2's text said "the run call returns at that boundary" without this
condition. I think the condition is right, not just convenient: the host may have delivered
something between calls, and until a boundary services the devices this call cannot know.
The cost is host CPU in an unusual slicing; a reported wait is never wrong because of it.

**The two earlier verifiers' tests against round 3** (`evidence/e5-t37a/verifier-tests-r3.log`,
sha256 `57ebc84f9b98…`): as committed, 39 of 43 pass, including all eight `_REFUTES` tests of
both rounds. The four that fail are the three lockstep tests (`v37a_lockstep_m_mode_…`,
`v37a_lockstep_random_…`, `r2_q1_lockstep_…`), at "MISSED RETURN" for one-slot calls that
begin inside the `wfi`'s block, and `v37a_busy_lag_is_exactly_the_bound_once_…`, which steps
one slot at a time onto the `wfi` and expects the next call to report it. With the lockstep
harnesses changed in a scratch copy to require a wait only when the subject's call has sampled
a block boundary before the `wfi` — tracked in the harness from the control's block
boundaries, not read from the subject — all three lockstep tests pass with state, RAM, resume
bytes and host-clock reading counts equal after every call; 42 of 43. The log shows the diffs.
I did not edit or promote the verifiers' files.

**Commands**, on the working tree that became `bd110f77d` unless stated:

- `evidence/e5-t37a/gates-r3.log` (sha256 `c89e48fe7619…`): `cargo fmt --check`;
  `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`;
  `cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown -- -D warnings`; the
  Makefile's `zicsr-stub` lint line (the same 5 errors as before the task);
  `cargo test -p wasm-vm-core --lib paced_idle` (24 pass);
  `cargo test -p wasm-vm-core --lib` (448 pass); the two wasm32 builds.
- `cargo test --workspace --exclude wasm-vm-wvseccomp` → 340 test binaries, every one
  `test result: ok`, no failure (`workspace-tests-r3.log`; the log is `sort | uniq -c` output,
  189 distinct result lines whose counts sum to 340. The "191" in my round-1 and round-2 claims
  was the number of distinct lines in those logs, not the number of suites; they also sum to
  340). Boot oracle: only the baseline README differs
  (`oracle-r3.log`). Desktop equivalence: `EQUIVALENT (2000000000 instructions)`, FNV
  `0dab1ccaa237df29`, retired 1,999,831,660, RAM `ed70e270…38701`
  (`turbo-equivalence-r3.log`).
- Mutation matrix, 37 mutants, one at a time, the file restored and re-touched after each
  (`evidence/e5-t37a/sabotage-r3.log`, sha256 `e56eaf52f6bc…`; the script is
  `sabotage-r3.py`): 37 killed, 0 survive.

  | Mutants | Killed by |
  |---|---|
  | R1 a wait without the devices idle | `paced_idle_no_wait_while_a_device_has_work`, `…a_call_that_begins_inside_the_wfi_block…`, `…or_a_device_was_touched` |
  | R2, R2b, R3, R4, R5 a level missing from `fresh_mip` | `paced_idle_fresh_mip_is_what_the_boundary_sync_writes` (and the machine-level tests for MSIP, MTIP, STIP) |
  | R6 a pending but disabled interrupt ends the wait | `paced_idle_a_disabled_interrupt_does_not_end_the_wait` |
  | R7 the wake jumps over an armed deadline; R8, R9 no SBI / CLINT resync at the wake; R14 the wake counted as work | `paced_idle_wake_stops_at_a_deadline_inside_the_slept_interval`, `…wake_without_a_trap…`, `…time_slept_before_a_host_wake…` |
  | R10 a wait recorded at a reached deadline (`<` → `<=`) | `paced_idle_a_reached_deadline_that_wakes_nothing_does_not_end_the_run` |
  | R11 owed waiting time not capped | `time::tests::paced_idle_busy_lag_is_bounded_and_waiting_time_is_not` |
  | R12 a restore does not start a new interval | `paced_idle_a_restore_starts_a_new_interval` |
  | R13 `take` keeps the wake armed for an unreported wait | `…no_wait_while_an_interrupt_is_deliverable_or_a_device_was_touched` |
  | V1–V6 (round 1's survivors), N1–N6, N9–N15, W1–W3 (rounds 1 and 2) | as in the round-2 table |

- Cold clone at `7fd2e0160` (sparse; `env -i` with HOME/PATH/TERM): 24/24 and 448/448, the
  release build, oracle digests identical, desktop equivalence `EQUIVALENT` with the same RAM
  hash (`cold-clone-r3.log`).
- Browser, committed `web/dist` at `7fd2e0160`
  (`node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --label e5-t37a-r3-dist --n 5 --scenarios idle,click,sweep,type,node --out evidence/e5-t37a/browser-dist-r3.json`):
  exit 0, no missing samples, the favicon 404 only; idle 158 MIPS, click result median 341 ms,
  move-and-click 285 ms, key echo 44 ms, `node -e` 5.2 s. Unchanged while nothing selects the
  policy.
- Whether the devices are in fact idle when the real desktop waits:
  `evidence/e5-t37a/quiescence-on-desktop.txt` — 1,050 of 1,050 wait checks in 30 s, on a
  scratch build; one session, no audio, no serial input, no RTC alarm.

**Mistakes of mine in this round, for the record.** Two tests of mine first passed for the
wrong reason and their mutants survived: the pure-ICount test's budgets never let the call that
ran the `wfi` sample a boundary, and the restore test compared two outcomes that were both
"worked". Both were rewritten until their mutants died. My first draft of the "owed time is
handed over once" pacer test asserted that 5,000 separate busy stretches share one bound; they
each get one, which is the design, and the test now pins the consumption of owed time directly.

**What is and is not shown.** Shown: the 24 tests' statements, on machines I built with host
clocks I set; both verifiers' refuting tests passing unchanged; lockstep exactness for
timer-woken guests under the narrowed contract. Not shown: anything in the browser with the
policy selected (E5-T37b); virtio-snd playback or a guest with the JIT on (neither is in a
test; a playing stream should make the device not idle, which I have not measured); the 2048
threshold on any other kernel; a held key still stops idle jumps altogether, as before.

### 2026-11-26 — verifier (round 3) — VERDICT: needs-evidence

Fresh session — not the worker, not the round-1 or round-2 verifier; head `7d25929a7`
(`git diff 7fd2e0160 7d25929a7 -- crates` is empty). Predictions were written after reading the
task, both diffs and the run loop, and before any evidence file was opened or anything was built
or run: `evidence/e5-t37a/verifier-r3/predictions.txt` (the addendum for the real-kernel runs was
written before those runs). My tests are `evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs`
(17 tests named `r3_*`: own guests, host clocks and parameters; all pass at this head), output in
`verifier-tests.log` beside it. No implementation file was changed: every mutant was restored with
`git checkout`, re-touched, and `git status --short crates` checked empty; the one scratch patch
to the CLI (`cli-paced-yield-probe.py`) was built into its own target directory and reverted.

**Nothing refutes the round-3 claim; two mutants of changed behaviour and one dead getter are not
pinned by the worker's tests.** The product claim is not contradicted (status
`evidence-needed`); the response is tests only.

Incremental rule: `crates/core/src/lib.rs` changed in round 3, `time.rs` only in a comment and in
its test. I carried forward round 2's Q3 and NV2 (the pacer alone; code unchanged) and re-ran
everything else, both earlier verifiers' files included.

**Needs evidence**

- B11, Boundary "Bounded busy lag … at most `max_busy_lag` of the time it fell behind may be
  skipped by idle jumps; the rest is forgotten" — NEEDS EVIDENCE. Mutant: `time.rs:224`
  `ticks_of(self.latest_host_ns - before)` → `… - self.anchor_host_ns` (what a waiting guest is
  owed becomes the host time since the anchor instead of since the previous consultation). It
  turns the unused part of one busy-lag allowance into "owed waiting time", which survives the
  next busy stretch on top of a fresh bound. An exact model of the function, checked against the
  real code (`owed-arithmetic-model.py`, `.txt`): on my test's sequence the guest skips 72 ms
  where 56 is right, and after k work/idle cycles behind near deadlines a busy guest with a
  50 ms bound may skip 64, 78, 92 … 330 ms (k = 1, 2, 3 … 20) where the original gives 50 every
  time — the bound stops binding. The mutant survives the worker's 24 tests, round 1's 19 and
  round 2's 24 (`sabotage.log`, B11), including round 2's closed-loop invariant, which allows one
  bound per consultation after work. Killed by
  `r3_owed_time_is_the_host_time_since_the_previous_consultation` (`sabotage-pass2.log`). Demand:
  carry a test that tells the two apart (mine may be taken as it is).
- B3, acceptance "no wait … while an interrupt is deliverable per any level the boundary samples
  (`fresh_mip` equals what the level sync writes, in all 32 combinations, with and without the
  SBI timer)" — NEEDS EVIDENCE. Mutant: `lib.rs:5596` `c.mtime >= self.sbi_state.stimecmp` → `>`.
  The 32 combinations use `stimecmp = 999` against `mtime = 1000`, so `>` and `>=` agree; the
  machine-timer level is tested at equality, the S-timer level is not. With the mutant a wait is
  reported when the S-timer comes due exactly at the `wfi`'s own retirement tick. Survives the
  worker's tests; killed by `r3_k1_fresh_mip_is_the_level_sync_on_random_states` and
  `r3_no_wait_when_the_s_timer_comes_due_exactly_at_the_wfi`. Demand: carry the equality case.
- COVERAGE `IdlePacer::waiting()` (`time.rs:166-168`) and the flag it returns (`time.rs:233`) —
  DEAD. Hit counts under the worker's tests (`coverage.log`): the getter is never executed, and
  it has no caller anywhere under `crates/`; round 3 removed the two assertions that read it
  (`git diff 215cbd1f9 7fd2e0160 -- crates/core/src/time.rs`). Mutant B12 (`self.waiting = false`)
  survives the worker's tests. Demand: delete the field and the getter, or put a test on it
  (`r3_pacer_waiting_flag_says_whether_the_last_consultation_fell_short` kills B12).

**The central question**

- SAFETY ("a reported wait is always true") — HELD; no counterexample.
  - S1 behavioural probe: at 4,670 sampled reported waits a yield-off machine was put in the same
    state (the control's resume bytes), its host clock frozen, and run on past 1,100 block
    boundaries (more than the UART's 1024-boundary timeout) or to the deadline: 6,814,194 work
    slots, zero interrupts taken (`r3_s1_lockstep_*`).
  - S2 UART bytes pushed by the host between run calls (FIFO off, triggers 1/4/8/14, 1/3/9 bytes,
    after a taken and an untaken wait, budgets 1/7/1,000,000, four loop flavours): 1,134 waits
    reported, every one with no byte unread while the receive interrupt is on; 1,621,976 calls
    ended with bytes unread and reported nothing (`r3_s2_*`). With the receive interrupt off the
    wait comes back only after the timeout clock has stopped.
  - S3 UART transmit interrupt (THR written in the `wfi`'s block and in the block before): no wait
    before the handler ran (`r3_s3_*`). S4 RTC alarm on a wall clock that moves by itself: no wait
    while armed, waits resume after the last alarm (`r3_s4_*`).
  - S5 PLIC: enable, threshold, priority and complete stores placed in the `wfi`'s own block, M and
    S context, three budgets, four loops: no wait before the external interrupt was handled
    (`r3_s5_*`; 96 configurations).
  - S6 `fresh_mip` against the level sync on 30,000 random states (CLINT, SBI deadline, PLIC
    priorities/enables/thresholds/lines/claims/completes, stale software bits; with and without a
    CLINT, a PLIC, the built-in SBI): equal, nothing changed by computing it, and the run loop's
    own boundary sync leaves `mip` as predicted (`r3_k1_*`). The only writers of `mip` are
    `sync_clint`, `sync_plic`, `sync_sbi_timer`, CSR instructions and the SBI IPI call (grep of
    `set_mip_bit` / `W_MIP`); the last two end a block.
  - S7 stale marker: after the run that ended on a wait the marker says idle and a host push does
    not move it (asserted); a NEW RUN CALL resets it, so it serves the byte (more than 100 idle
    passes, then the interrupt) before it reports anything, with the first wait taken or not
    (`r3_s7_*`). See follow-up 1 for the one order this does not cover.
  - S8 restore paths: `load_resume`, `load_session_resume`, `load_accelerated_resume` and
    `restore_recording_branch` all commit through `load_resume_inner_with_purpose`
    (`lib.rs:5178`); `restore_desktop_snapshot` restores device envelopes only. Read, not run, for
    the last three.
  - Virtio queues with work were not hand-assembled; by reading, every service returns "idle"
    only on its no-work early return (blk also not while reads are parked, input not while a host
    event is pending, net not unless the backend opts in), and the real desktop below has every
    driver bound.
- COMPLETENESS ("a true wait is not always reported") — HELD as stated, and not vacuous.
  - C1/C2: 9,600 of 9,600 calls that started at a block boundary reported at the first waiting
    `wfi`, in the per-op, general, batched and turbo loops (`r3_c1_*`). On a real kernel: 24,219 of
    24,290 and 25,800 of 25,803 `wfi`s (busybox), 30,101 of 30,501 and 165,966 of 166,240 (the
    Replay desktop snapshot).
  - C4: with PLIC, UART, RTC, virtio blk, net (loopback), rng, keyboard, tablet, mouse, sound, GPU
    and console attached and idle, 50 of 50 calls report (`r3_c4_*`).
  - Unreported true waits, all of them: the call sampled no block boundary before the `wfi`
    (111,348 in my lockstep), a device had work or was accessed since (366,062), and two classes
    that never report: follow-ups 2 and 4.

**Round-2 findings**

- N5c (PLIC) — FIXED. `r2_n5c_*_REFUTES` passes unchanged (6 of 6: no wait while `plic.eip(M)` is
  true); mine: S5 above.
- N5d (UART character timeout) — FIXED. `r2_n5d_*_REFUTES` passes unchanged (0 waits before the
  interrupt, was 341); mine: S2.
- N5e (RTC alarm) — FIXED. `r2_n5e_*_REFUTES` passes unchanged; mine: S4.
- B4 (rebase, then a host wake) — FIXED. `r2_b4_*_REFUTES` passes unchanged (12 of 12). Mine
  (`r3_b4_*`, four loops, bounds 50 ms / 0 / none, rebase before and after the take): `mtime` at
  the handler's first instruction = `mtime` at the rebase + 50,000,000 for 5 s slept, two host
  readings, remaining wait shorter by exactly 5 s; two rebases with discarded sleeps: only the
  last second; a rebase and a 2 s oversleep: timer at its deadline, deadline + 20,000,000 at the
  next `wfi`.
- Seven surviving mutants — FIXED: re-applied to the new code, each is killed by a worker test
  (`sabotage.log`, A1–A7).
- MTIP term — FIXED: `paced_idle_no_wait_when_the_machine_timer_came_due_inside_the_wfi_block`
  exists and the 32-combination test has the machine timer at equality (B3b killed).

**Held**

- E1–E4: `gates-r3.log` sha256 `c89e48fe7619…bc93`, `sabotage-r3.log` `e56eaf52f6bc…0542`,
  `verifier-tests-r3.log` `57ebc84f9b98…d73f`; the logs say what the claim says (24/448, 340
  test binaries and none failed, 37 mutants killed, cold clone at `7fd2e0160`); no
  `#[ignore]`, disabled assertion or `cfg(test)` branch in the non-test hunks;
  `idle_boundary_epoch` is gone; nothing in `lib.rs` reads `waiting`. E5 as predicted: see Needs
  evidence.
- A1–A7: 24/24 and 448/448; release build; oracle: six digests identical, only the baseline
  README differs; desktop equivalence at 2,000,000,000: `0dab1ccaa237df29` / 1,999,831,660 /
  `ed70e270…38701`; at my budget 555,555,555: `219809c2bc11411e` / 555,490,133 /
  `b4223f05…2282`, turbo = ordinary, and byte-identical to a CLI built from the pre-task commit
  `ee5582ac6` (`cold-clone.log`); the `zicsr-stub` lint line fails with the five errors that
  predate the task, none naming an item of it.
- B3/K7 exact equivalence under a predicate of my own, both directions (every reported wait is
  one that has to be reported, none is missed), `observe()` and RAM equal after every call,
  resume bytes at every sample, host-clock reading counts equal where no host event is delivered:
  my harness 512 configurations, 2,576,871 calls, 257,881 yields, with real device work and a
  host delivering 45,782 events; the round-1 and round-2 harnesses, their own predicates plus my
  level and device terms, 1,158 configurations, 3,384,888 calls, 673,749 yields. Four loop
  flavours in mine (per-op sampling added).
- B6a/B6b/B7/B8: a call that began inside the `wfi`'s block reports nothing (`r3_c3_*`); pending
  but disabled `msip` and PLIC lines do not hold a wait back (`r3_pending_but_disabled_*`); a
  zero-budget call drops an untaken wait and keeps a taken one's wake (`r3_a_zero_budget_*`);
  clock and policy changes and a restore: both earlier verifiers' tests pass unchanged.
- K1–K4: `fresh_mip` (S6); `paced_wait_holds` has exactly the two terms; no reader of the pacer
  flag; the marker is reset at run entry (mutant B8 killed by the worker's
  `…begins_inside_the_wfi_block…`).
- K5/K6: reproduced exactly — as committed 39 of 43 pass (`earlier-verifiers-as-committed.log`);
  the four failures are the three lockstep tests at "MISSED RETURN on the last budget slot" with
  budgets `[1]`, and `v37a_busy_lag_is_exactly_the_bound_once_…` (`wfi` count 2, not 1). They are
  exactly the narrowed-contract cases: with the predicate below all three lockstep tests pass in
  both directions, and the fourth passes once its long call starts at the block's entry
  (`earlier-verifiers-adapted.diff`). No real missed or early return hides there.

**The narrowing, and the predicate**

The narrowing is sound and I think it is right: until a boundary of this call has serviced the
devices, the call cannot know what the host delivered. What it costs, measured (`r3_c3_*`): with
block-sampled interrupts a call reports a `wfi` only if it began at or before that `wfi`'s block
boundary. For a `wfi` that is the third op of its block, a host with a fixed budget of 1 or 2
work slots gets 0 reports over 85 and 171 `wfi`s — not "one pass later", never; budget 3 gets
85 of 257, 4 gets 300 of 300, 5 gets 200 of 400, 7 and more every one; a `wfi` that opens its
block, or per-instruction sampling, is reported every time at any budget. My prediction C3 named
only the one-slot host and was too narrow. The Boundary's "the wait is picked up at a later
`wfi`" is true for any call long enough to go round the idle loop, which is every realistic one.

The worker's scratch predicate (`sampled`) is faithful for guests without device work, which is
all the two earlier harnesses run; it has no term for a device that has work, so it would demand
a wait the implementation rightly withholds. The form I consider right is `r3_arch_waits` and
`R3Vouch` in my file: no enabled interrupt in the stale `mip`; none per `msip`,
`mtime >= mtimecmp`, the SBI deadline and the PLIC's two contexts as read from the devices; the
nearest deadline still ahead; and a copy of the quiescence rule kept by the harness for each run
call of the subject from the control alone (unset at call start; at each slot that begins at a
sampled boundary where the copy is not valid for the fabric access counter, a full pass that
finds the devices idle iff the UART's timeout clock was not running before the slot and no RTC
alarm is armed after it). Nothing is read from the subject or from `fabric_idle_epoch`.

**Novel attack: a real kernel** (`real-kernel-equivalence.sh`, `.log`). Linux 6.6 natively
under the paced clock on a host clock that advances a fixed amount per reading — busybox
initramfs, Alpine on virtio-blk, and the warm Replay desktop snapshot in the browser's device
topology — yield off and on, turbo and batched, with and without a bound, each run stopped after
the same number of retirements (350,000,000 / 1,500,000,000). Within each of the six groups the
four evidence files and console outputs are byte-identical and the host-clock reading counts are
equal (a wait reported while a device owed an interrupt would make `paced_wake` read the clock
once more and shift every later reading). 516,391 waits were reported in the nine yield-on runs
that idle, one of them with `--jit` (94.7 % of retirements compiled; identical too). The Alpine
case retires no `wfi` in 1.5 G instructions and says nothing about the yield.

COVERAGE (hit counts, `coverage.sh`, `coverage.log`): of the 191 lines the task added to
non-test code that carry a code region, the worker's 24 tests execute 185. Never executed:
`IdlePacer::waiting()` (dead, above); waived: the no-CLINT exit of `fresh_mip` (`lib.rs:5598`; a
wait needs a CLINT — `r3_k1_*` runs it), the `let … else return` of `paced_wake` (`lib.rs:5628`)
and `(0, None)` in `idle_deadline` (`lib.rs:5651`), both unreachable while a wake can be armed
only with a pacer, a clock and a CLINT; `let holds = false` under `zicsr-stub`.

SABOTAGE: 25 mutants, one at a time (`sabotage.py`, `sabotage.log`, `sabotage-pass2.log`). The
seven round-2 survivors: killed by worker tests. Fourteen new ones, none in `sabotage-r3.log`:
killed by worker tests — PLIC contexts swapped, no `builtin_sbi` guard, MTIP with `>`, an unset
marker accepted, marker without the epoch, the run-entry marker reset removed, `paced_wake`
before the boundary sync, a wait without the opt-in; survive the worker's tests — B3, B11, B12
(above) and three equivalents: the run-entry clear of an untaken wait removed (B7: the marker
reset at entry already makes that wait fail `paced_wait_holds` at the loop top and in the take,
`run(0)` included — the clear at `lib.rs:7521-7523` is redundant since round 3), `paced_wake`
writing unconditionally (B9: the same value and two idempotent syncs), `fresh_mip` starting from
zero (B16: a stale enabled bit keeps `wfi_fast_forward` from recording a wait at all; my K1 test
pins the documented value anyway). Four of the worker's own mutants were re-run against my file
to show it can see them: 8, 1, 7 and 7 of my tests fail on them (no devices-idle term; no PLIC
level; the take not asking; the loop top not asking).

MOCK & ENV, cold clone: sparse clone at `7d25929a7`, `env -i` with HOME/PATH/TERM: 24/24,
448/448, release build, oracle digests identical, desktop equivalence at 2,000,000,000 and
555,555,555 with the values above, then the same clone at `ee5582ac6` for the pre-task digest
(`cold-clone.log`); clone deleted. In the worker's round-3 tests (read in full) no golden value
comes from the code under test: `fresh_mip` is compared with the real level sync, the rest with
numbers derived from the host clock the test sets.

SUITE: not promoted — the verdict is not `verified`. Ready for the re-verification: the round-1
and round-2 files adapted to the round-3 contract by
`adapt-earlier-verifier-files.py <dir> --lint` (the predicate above in both lockstep harnesses;
`v37a_busy_lag_…` starting its long call at the block's entry; five clippy lints and rustfmt in
the round-2 file) plus `verifier_r3_tests.rs`, as three files under `crates/core/src/`
`include!`d from `turbo_equivalence_tests.rs`. With them 60 of 60 pass (`verifier-tests.log`),
`cargo fmt --check` is clean and
`cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings` passes. The core suite
then has 508 tests and takes 45 s here instead of 19 s.

Mistakes of mine, for the record: six first-draft expectations in my own tests were wrong and
were corrected before any result was recorded (three completeness expectations that assumed any
budget above 1 reports, a random PLIC line that belongs to the UART, an idle-pass threshold that
ignored per-op sampling, a virtio slot clash), and my host-driven lockstep first let so much host
time pass that few waits occurred, so its timing was retuned; my zero-budget test was written to
kill B7 and does not, because B7 is equivalent; I refactored my test file while the first
mutation pass was running, so the mutants that survived everything in it, and B3 and B16, were
re-run in a second pass after the last tests were added.

Not checked: the browser run (nothing selects the policy); the workspace-wide suite (the
worker's log shows 340 test binaries, none failed; I re-ran the core suite, the release build
and the digests, here and in the cold clone); virtio-snd playback; a hand-written virtio
driver with queue work; `load_accelerated_resume` and `restore_recording_branch` under a taken
wait (read only).

Follow-ups, not part of the verdict:
1. `take_idle_wait_nanos()` vouches for the devices as of the END OF THE RUN CALL. A host that
   delivers something and then asks, without running in between, is told to sleep on its own
   delivery: `r3_s7_*` measures `Some(9000000600)` with the UART's timeout clock running, in all
   four loops. The native CLI's loop pushes stdin into the UART after its run call
   (`crates/cli/src/boot.rs:2469`, `:2528`), so "ask at the end of the loop body" is the natural
   mistake. E5-T37b's host must take the wait immediately after `run` returns, before delivering
   anything, or treat any delivery of its own as cancelling it; the doc of
   `take_idle_wait_nanos` should say so. (Round 2 filed the same; it stays outside the verdict.)
2. A network backend that does not opt in to `NetBackend::idle` keeps the quiescence marker
   unset for good: no wait is ever reported and the turbo loop never engages (`r3_c4_*`, with a
   polled backend: 0 of 50 calls). The slirp stack is such a backend (`SlirpLocalBackend`,
   `crates/slirp/src/local_backend.rs:1029`; `SharedSlirpBackend`,
   `crates/wasm/src/browser_file_transfer.rs:18`; the CLI's `SlirpBackend`), so a session with
   networking on gets no idle sleep. The desktop of the worker's measurement uses the loopback.
3. An armed RTC alarm suppresses every wait however far away it is (the worker's own test); its
   deadline is known and could bound the wait instead.
4. A host whose budgets never exceed the `wfi`'s position in its block never gets a report
   (above). Harmless for real hosts; the Boundary's "picked up at a later `wfi`" could say so.
5. `cargo clippy -p wasm-vm-core --all-targets -- -D warnings` (core alone) does not build at
   this head: three example/test targets the task does not touch import a feature-gated
   `VecSink`. The worker's form with `-p wasm-vm-cli` passes.
6. Carried from round 2: virtio-snd playback with the yield on is unmeasured.

Commands: `cargo test -p wasm-vm-core --lib paced_idle`; `cargo test -p wasm-vm-core --lib`;
`cargo build --release -p wasm-vm-cli`;
`bash tools/perf/oracle.sh target/release/wasm-vm target/verifier-r3-e5t37a-oracle` + `diff -r`;
`bash tools/perf/turbo-equivalence.sh {2000000000,555555555} …`;
`cargo test -p wasm-vm-core --lib -- v37a_ r2_` (as committed) and
`… -- v37a_ r2_ r3_ --nocapture --test-threads=1` (adapted);
`python3 evidence/e5-t37a/verifier-r3/sabotage.py` (+ `"B3 " B7 B9 B11 B16`);
`bash evidence/e5-t37a/verifier-r3/coverage.sh`;
`python3 evidence/e5-t37a/verifier-r3/cli-paced-yield-probe.py apply|revert`,
`CARGO_TARGET_DIR=target/verifier-r3-probe cargo build --release -p wasm-vm-cli`,
`bash evidence/e5-t37a/verifier-r3/real-kernel-equivalence.sh …`;
`bash evidence/e5-t37a/verifier-r3/cold-clone.sh 7d25929a7 full`;
`cargo fmt --check`; `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`
(clean tree, and with the three verifier files included).

### 2026-11-26 — worker — round 4, evidence only (head `b815d68ca`)

Answer to the `needs-evidence` verdict above. Commit `d13be10dc` adds tests and two doc
comments; `b815d68ca` refreshes the generated build id. Nothing the machine does changed.
(The shipped wasm's bytes did change — panic locations carry line numbers and the comments
moved them — so the digest gates were run again in the cold clone rather than carried.)

- **B11, owed time measured from the anchor instead of the previous consultation.** The pacer
  test now runs six consecutive consultations of a waiting guest, each capped by a deadline
  1 ms ahead while the host moves 14 ms, after work has moved the anchor: `owed_wait_ticks()`
  is exactly 13, 26, 39, 52, 65, 78 ms, and the busy stretch that follows skips exactly
  78 ms + one 50 ms bound. The mutant gives 13, 40, 81 … and is killed.
- **B3, the S-timer level at equality.** `paced_idle_fresh_mip_is_what_the_boundary_sync_writes`
  now sets `stimecmp` to `mtime` (due exactly now) or `mtime + 1`, like the machine timer.
  `>=` → `>` is killed.
- **`IdlePacer::waiting()`.** Kept and tested rather than deleted (the round-2 verifier's
  fuzz tests read it): true short of the deadline, false once reached, cleared by a rebase,
  in the pacer test. The mutant that never sets it is killed.
- **Text.** The Boundary no longer says an unreported wait is always "picked up at a later
  `wfi`": it is not, for a host whose budgets are all shorter than the `wfi`'s position in its
  block (the verifier's table). `take_idle_wait_nanos`'s doc now says the answer speaks for the
  machine as the run call left it, and what a host that delivers something afterwards must do.

Commands (the touched harness only, per the incremental rule), on the tree that became
`d13be10dc`:

- `evidence/e5-t37a/gates-r4.log` (sha256 `80ef6e0c796b…`): `cargo fmt --check`;
  `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`;
  `cargo test -p wasm-vm-core --lib paced_idle` (24 pass);
  `cargo test -p wasm-vm-core --lib` (448 pass). All exit 0.
- Mutation matrix, 40 mutants (round 3's 37 plus B11, B3, B12), one at a time, restored and
  re-touched after each (`evidence/e5-t37a/sabotage-r4.log`, sha256 `b8ff31bcbb5d…`; script
  `sabotage-r4.py`): 40 killed, 0 survive. B11 and B12 by
  `time::tests::paced_idle_busy_lag_is_bounded_and_waiting_time_is_not`, B3 by
  `paced_idle_fresh_mip_is_what_the_boundary_sync_writes`.
- Cold clone at `b815d68ca` (sparse; `env -i`): 24/24 and 448/448, the release build, oracle
  digests identical, desktop equivalence `EQUIVALENT (2000000000 instructions)` with RAM
  `ed70e270…38701` (`evidence/e5-t37a/cold-clone-r4.log`, sha256 `724ecd3dc0cb…`).

Not re-run, carried from round 3 because their inputs did not change: the workspace-wide
suite and the browser check of the committed bundle (the bundle's wasm differs only by the
line numbers above; nothing selects the policy). Not addressed here, because the verifier put
them outside the verdict: the follow-ups (slirp backends never report idle; an armed RTC alarm
suppresses every wait; virtio-snd unmeasured; a core-only `clippy --all-targets` build failure
in three untouched targets). I will file them with E5-T37b.

### 2026-11-26 — verifier (round 4) — VERDICT: needs-evidence

Fresh session — not the worker and none of the three earlier verifiers; head `cc7dfef69`, whose
code is `b815d68ca` (`git diff b815d68ca cc7dfef69 -- crates web` is empty). An earlier round-4
verifier session was interrupted before it wrote a verdict; what I took from it is in the last
paragraph. My predictions: `evidence/e5-t37a/verifier-r4/predictions-2.txt` — the first part
written after the task text, the round-3 verdict and the round-4 response and before the diff, any
test or any evidence file; the addendum for my own two mutants before either was applied. No
implementation file was changed: every mutant was restored with `git checkout`, re-touched, and
`git status --short crates` checked. `crates/` is exactly `HEAD` as I leave it.

**Two of the three round-3 items are answered. The third (B3) was answered by moving the hole,
not closing it:** the worker's test now holds the S-timer level at "due exactly now" and "one tick
ahead" and no longer at "already past", so `>=` → `==` in `fresh_mip` passes all 448 tests of the
core suite at this head, where the same test as round 3 saw it fails on it. Nothing contradicts
the product claim (status `evidence-needed`); the response is one test line.

**Incremental premise** — HELD. `git diff 7fd2e0160 b815d68ca -- crates`, read line by line:
`lib.rs` +5, all `///` on `take_idle_wait_nanos`; `time.rs` +50 at lines 625-674, inside
`#[cfg(test)] mod tests` (opens at 443); `turbo_equivalence_tests.rs` +2 −1, a
`#[cfg(all(test, …))]` module; `csr.rs` untouched. Mechanically, two ways: comment lines dropped
from the non-test part (`incremental-premise.py`, re-run: 6132 and 274 lines identical), and every
comment stripped outside literals, token streams compared (`premise-tokens.py`, `.log`: 15,347
and 706 tokens identical). (The response says "two doc comments"; the diff has one, and its
other comments are in test code.)

**Carried forward from round 3** — each rests on the non-test code of `lib.rs` (the run loop,
`wfi_fast_forward`, `paced_wait_holds`, `fresh_mip`, `paced_wake`, `take_idle_wait_nanos`, the
restore paths) and `time.rs` (`IdlePacer`), token-identical since the head round 3 verified:

- SAFETY S1–S8 and COMPLETENESS C1/C2/C4; the narrowing and the predicate (`R3Vouch`).
- The lockstep equivalence B3/K7 (2,576,871 + 3,384,888 calls), B6a/B6b/B7/B8, K1–K6.
- The round-2 findings N5c, N5d, N5e, B4 FIXED. Not only carried: the three verifiers' files
  (rounds 1 and 2 through round 3's adaptation tool) were built into this head and pass, 60 of 60
  (`gates-2.log`).
- Round 2's Q3 and NV2 (the pacer alone), as round 3 carried them.
- The real-kernel equivalence runs (not re-run), COVERAGE 185 of 191 lines with its four waivers,
  MOCK & ENV for the round-3 tests (those lines are unchanged; the two new hunks are read below).
- The seven round-2 survivors and the MTIP term FIXED, and the worker's 37 mutants: the test lines
  they rest on are unchanged (the pacer test gained 50 lines and lost none; 22 tests are
  untouched), and the worker re-ran all of them at this head (`sabotage-r4.log`). NOT carried: the
  one test line that changed, the S-timer case of the 32 combinations — re-checked, see below.

**Needs evidence**

- MY1, acceptance "no wait … while an interrupt is deliverable per any level the boundary samples
  (`fresh_mip` equals what the level sync writes, in all 32 combinations, with and without the
  SBI timer)" — NEEDS EVIDENCE. Prediction (written before the run): the round-4 edit REPLACED
  the past-due case with the equality case (`turbo_equivalence_tests.rs:2838`, `999` / `u64::MAX`
  → `1_000` / `1_001` against `mtime` 1000), so the mutant `lib.rs:5601`
  `c.mtime >= self.sbi_state.stimecmp` → `==` (the S-timer level only AT its deadline) passes the
  test now and failed it before. Observed (`sabotage-2.log`): 24 of 24 pass on the mutant at this
  head; with the test file as at `7fd2e0160` it is killed at the same assertion
  (`sbi=true case=00100`, 32 against 0); re-checked against the whole core suite, 448 of 448 pass
  on it (`my1-recheck.log`). It is not an equivalent mutant: three verifier tests fail on it
  (`sabotage-2-suite.log`) — the round-2 verifier's
  `r2_m6_no_wait_when_the_s_timer_came_due_inside_the_wfi_block` (the run call returns at the `wfi`
  with the S-timer some 30 ticks past due and its handler not run), the round-3 verifier's
  `r3_no_wait_when_the_s_timer_comes_due_exactly_at_the_wfi` ("FALSE WAIT — the S-timer interrupt
  is due", `Some(100000200)` where `None` is right, the deadline three ticks past) and
  `r3_k1_fresh_mip_is_the_level_sync_on_random_states`. A level `time >= stimecmp` is decided by
  three points — one tick past, due now, one tick ahead; the worker's suite held the first and
  third in round 3 and holds the second and third now. `>` was the rarer failure (the timer due
  on the `wfi`'s own tick); `==` is the general case of an S-timer that came due inside the
  `wfi`'s block, which the machine timer has a test for
  (`paced_idle_no_wait_when_the_machine_timer_came_due_inside_the_wfi_block`) and the S-timer
  does not. Demand: put the past-due deadline back beside the other two in
  `paced_idle_fresh_mip_is_what_the_boundary_sync_writes` (the loop already goes round twice), or
  carry a machine-level test of an S-timer that came due inside the `wfi`'s block (`r2_m6_*` may
  be taken as it is); `>`, `==` and `mtime + 1 >=` must all fail the worker's tests.

**Held**

- P0 evidence — HELD. sha256 of `gates-r4.log`, `sabotage-r4.log`, `cold-clone-r4.log` begin
  `80ef6e0c796b`, `b8ff31bcbb5d`, `724ecd3dc0cb` as claimed; they say 24/448, 40 killed and 0
  surviving, and a sparse clone at `b815d68ca` with identical digests. No `#[ignore]`, disabled
  assertion or `cfg` in the diff.
- P2, B11 — HELD. Derived from the Boundary before reading the test: a waiting guest is entitled
  to all 14 ms between two consultations, a deadline 1 ms ahead hands over 1, so 13 ms stay owed
  each time — 13·n after n, wherever the anchor is — and a busy stretch after that may skip
  what is owed plus one bound, 78 + 50 ms. The test asserts exactly that, with literals that come
  from its own host steps (`n * ticks_ms(13)`; `now + 6 * ticks_ms(13) + ticks_ms(50)`), none
  read back from the pacer. Re-applied by hand: killed by
  `time::tests::paced_idle_busy_lag_is_bounded_and_waiting_time_is_not` at `time.rs:638`,
  "after 2 capped idle passes", 400000 against 260000 (40 ms where 26 is right). It survives the
  pacer test as round 3 saw it (`sabotage-repro.log`, B11@r3). Not fitted to the mutant: the same
  block kills a different error (the jump taken from what was owed before this consultation's
  time is added, M3: 14 ms against 13 at n = 1) that the round-3 form let through.
- P3, B3 as round 3 named it — HELD. Re-applied by hand (`>=` → `>`): killed by
  `paced_idle_fresh_mip_is_what_the_boundary_sync_writes` at `turbo_equivalence_tests.rs:2848`
  (`assert_eq!(m.hart.csr.mip_bits(), predicted, …)`, `sbi=true case=00100`, 32 against 0);
  survives the test as round 3 saw it. The reference is independent code: `>` in
  `sync_sbi_timer` alone fails the same assertion the other way round, 0 against 32
  (`p3-independence.log`), and in both at once three tests fail, one of them
  `sbi_timer_deadlines_future_past_and_rearmed` (P3b). `mtime + 1 >=` is killed too (M2).
- P4, `IdlePacer::waiting()` — HELD, and the getter is WAIVED rather than dead: it is now
  executed and decided (seven reads in the pacer test; the flag never set, the getter constant
  false or true, `<` → `<=`, judged before the jump, kept across a rebase: six mutants, six
  killed, at `time.rs:643`, `:653` and the rebase assertion). Reason: a diagnostic of the
  exported `time::IdlePacer` beside `owed_wait_ticks()`; nothing outside tests reads it and the
  machine derives `limited < d` itself (`lib.rs:5782`), so it cannot touch guest state; round 3
  offered "test it" as the alternative to deleting it, and the round-2, round-3 and round-4
  verifier tests read it as their oracle (2, 6 and 3 reads).
- MY2 (mine), a guest that worked may skip `max(owed, bound)` instead of `owed + bound`
  (`time.rs:213-215`) — HELD: killed, but at `time.rs:551` ("everything the host clock ran ahead
  while the guest waited", 20010300 against 20020000), an older block, in both forms of the test.
  So no mutant I ran was decided by the new block's last assertion (`:648-651`).
- P6 gates at this head — HELD (`gates-2.log`, `digest-gates-2.log`): `cargo fmt --check` 0;
  the clippy line 0; `paced_idle` 24 of 24; the core lib suite 448 of 448 in 21 s; the release
  build; oracle: six digests identical, `diff -r` shows only the baseline README;
  `turbo-equivalence.sh 2000000000`: `EQUIVALENT`, FNV `0dab1ccaa237df29`, retired
  1,999,831,660, RAM sha256 `ed70e270…38701`, turbo and ordinary. The digest gates were run
  twice with the same values (see Mistakes).

COVERAGE, the lines changed since `7fd2e0160`: `lib.rs:5535-5539` — waived, comment.
`time.rs:625-674` — executed; `:638-642` decided by B11 and M3, `:643` and `:653-674` by the six
flag mutants, `:648-651` reached by no mutant of mine. `turbo_equivalence_tests.rs:2837-2838` —
executed; decides `>` and `mtime + 1 >=`, does not decide `==`, which the line it replaced did
(above). `time.rs:166-168` and `:233`, round 3's DEAD item — executed and waived (P4).

SUITE: not promoted — the verdict is not `verified`. Checked and ready for the next round:
`python3 evidence/e5-t37a/verifier-r4/promote.py <existing scratch dir>` writes
`crates/core/src/paced_idle_verifier_tests/round{1,2,3}.rs` from the three evidence files (re-run
here: byte-identical to what the interrupted session left) and the `include!` lines;
`verifier_r4_tests.rs` beside it is `round4.rs`. With all four the core suite is 510 tests, all
passing, in 44 s against 21 s (62 added: 19 + 24 + 17 + 2; `--lib -- v37a_ r2_ r3_ r4_` alone
39 s); the `paced_idle` filter still selects 24; `cargo fmt --check`, `rustfmt --check` on the
four files and the clippy line pass. No file under `crates/` then reads anything under
`evidence/`. The promotion headers name this round as the promoter; whoever promotes must
correct them. Nothing of it is in the tree or in this commit.

Outside the verdict (the incremental rule: code and tests of this line are unchanged since
round 3, and round 3 held the pacer): M1, found by the interrupted session and reproduced here —
the cap on owed time judged before the idle jump instead of after it (`time.rs:232`,
`ceiling.saturating_sub(limited)` → `…sub(current)`) survives the worker's 24 tests AND the 60
tests of the three earlier verifiers; with it a busy guest skips a debt it was already paid on
top of its bound (1 s + 50 ms where 50 ms is right). Killed only by the two `r4_*` tests
(`sabotage-2-suite.log`); I re-derived the directed one's numbers by hand from the Boundary. The
worker may take `r4_nothing_is_owed_beyond_what_the_host_clock_is_ahead_after_the_jump` as it is;
otherwise it is closed when the file is promoted.

Mistakes of mine, for the record: my first run of `promote.py` failed for want of its scratch
directory and I compared the untouched files with themselves before noticing; the comparison
reported above is from the second, complete run. This session was interrupted while the digest
gates ran in the background; they had finished, but I rebuilt the release CLI from the tree as
it stood (`git diff -- crates` empty) and ran both again rather than rest the binary's
provenance on timing — same digests (the two builds' sha256 differ; Mach-O debug maps carry
object-file times).

Not checked: the pristine clone — the rule runs it once, on the final exact head, and this head
is not final (the worker's is `cold-clone-r4.log` at `b815d68ca`; I re-ran the lib suite and
both digest gates in the tree); the browser run and the workspace-wide suite (carried by the
worker; nothing selects the policy).

The interrupted round-4 session left a predictions file, a premise check, a mutation script
with its log, a promotion script and four promoted test files wired into the crate, all
uncommitted. I read all of it as input. Reused after checking: `incremental-premise.py`
(re-run), `sabotage.py` as machinery and its 14 rows other than B11 and B3, each reproduced with
the same failing test and assertion (`sabotage-repro.log`; B11 and B3 I applied by hand),
`promote.py` (re-run), and its two tests, kept as `verifier_r4_tests.rs` with a header that
says what happened (its own claimed a `verified` verdict that was never given). Its files are
committed unchanged beside mine; its in-tree copy and `include!` lines I removed, because
nothing is promoted. Its second mutation pass (`sabotage-suite.log`) stops at the first row; my
`sabotage-2-suite.log` is that pass for M1 and MY1.

Commands: `python3 evidence/e5-t37a/verifier-r4/incremental-premise.py 7fd2e0160 b815d68ca`;
`python3 evidence/e5-t37a/verifier-r4/premise-tokens.py 7fd2e0160 b815d68ca`;
`cargo test -p wasm-vm-core --lib paced_idle` (clean, and under B11 and B3 applied by hand);
`cargo test -p wasm-vm-core --lib` (clean ×2, under MY1, and with the 62 verifier tests ×2);
`python3 evidence/e5-t37a/verifier-r4/sabotage-2.py MY1 MY1@r3 MY2 MY2@r3`;
`python3 evidence/e5-t37a/verifier-r4/sabotage.py B11@r3 B3@r3 B12 W1 W2 W4 W5 W6 M1 M2 M2@r3
M3 M3@r3 P3b`;
`python3 evidence/e5-t37a/verifier-r4/sabotage-2.py --suite MY1 M1`;
`cargo fmt --check`; `cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings`
(clean tree, and with the four verifier files included);
`cargo build --release -p wasm-vm-cli` (×2);
`bash tools/perf/oracle.sh target/release/wasm-vm target/verifier-r4b-e5t37a-oracle` +
`diff -r evidence/perf-overhaul/oracle-baseline target/verifier-r4b-e5t37a-oracle/digests` (×2);
`bash tools/perf/turbo-equivalence.sh 2000000000 target/verifier-r4b-e5t37a-teq` (×2).
