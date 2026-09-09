# E5-T26i critic — pre-browser attack results

Target: exact committed source `99b8e692fddb7b1e82e4175e152ef5682c6b9373`; scoped diff `65e99f2e..99b8e692` SHA-256 `057477e490cc4768caa219e8be4ac27c1a9e9bc06eb266a1811eca6597696f80`. Submission evidence was not read.

## Changed-boundary inspection

- No anchored runtime refutation found in the static pass. Successful `Machine::load_resume` rebases only after all restore passes commit; refusal returns before the added call. `set_wall_clock` installs source/policy then rebases at current `mtime`; `set_icount_clock` removes wall state and stale jump notification.
- The JS route validates exact mode and realm `performance.now()` before asset fetch. Lifecycle selection occurs after boot-snapshot restore but before execution. Direct/worker RPC returns machine state as a decimal-string `mtime`; explicit pause/quota resumes invoke rebase before clearing the pause and scheduling.
- The pre-existing JIT boundary remains conservative: `direct_chain_budget` refuses direct chaining whenever wall mode is active. No changed hunk alters slew policy, residency, scheduler quantum, F command, F deadline, or snapshot codec.

## Novel attack — HELD

Prediction 13 was exercised in an isolated local clone with the exact test retained as `novel-repeated-rebase.rs`. It starts above JavaScript's exact-integer range, arms a future CLINT deadline, repeats rebases, injects backward jitter, advances two exact 1 ms steps, then switches to ICount while moving the former host source to `u64::MAX`.

Command (scrubbed compiler/log environment, isolated target):

`cargo test -p wasm-vm-core --features gpu-trace --test guest_clock verifier_repeated_rebase_preserves_nonzero_time_deadline_and_mode_handoff -- --exact --nocapture`

Observed: exit 0; `1 passed; 0 failed`. Rebase preserved nonzero `mtime` and deadline, backward jitter clamped, each 1 ms produced exactly 10,000 ticks, no stale jump survived, and ICount produced exactly one tick after ten retirements.

## Sabotage — DETECTED

In the same isolated clone only, `ManualClock::now_nanos` retained its read counter but returned constant zero instead of the driven nanoseconds. The unchanged test
`busy_rdtime_tracks_ten_mhz_not_retire_count_and_clamps_jitter` failed immediately at its first 100 ms sample: observed `rdtime = 0`, expected `1,000,000` (`crates/core/tests/guest_clock.rs:72`), exit 101. This confirms the regression depends on the injected host source and its 10 MHz scaling; it is not self-licking against retirement count.

## Pending

Predictions requiring built Chromium, direct/worker guest UART, WASM fixtures, authenticated desktop comparison, and exact submission-log digests remain `NEEDS EVIDENCE`. No task verdict or lifecycle status is issued here.
