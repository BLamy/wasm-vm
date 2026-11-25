---
id: E4-T40b
epic: 4
title: Turbo run loop — whole-block interpretation with deferred accounting, bit-identical to the batched interpreter
priority: 0.38762
status: implemented
depends_on: [E4-T40a]
estimate: S
risk: high
capstone: false
---

## Boundary

One execution seam in `crates/core`: a run loop that executes consecutive decoded
blocks without returning to `run_capture_inner` for each block, and without the
per-instruction bookkeeping the batched interpreter pays today. No change to the
decoder, the TLBs, the block cache, the devices or the JIT, and no change to any
guest-visible result.

Why (E4-T40, measured): guest code averages about five instructions per block. With
the block cache and interrupt batching on, every block pays a full boundary
iteration, and every load, store and branch pays the retire clock (a CLINT borrow),
the counters, the progress and live-work counters, the code-write drain and three
loop-top tests. A host profile put about 37% of the main thread in boundary
bookkeeping.

The loop (`crates/core/src/turbo.rs`, with the per-instruction fast path in
`crates/core/src/hart/turbo.rs`) is entered only at a sampled block boundary where
the ordinary loop has just found nothing to deliver, with the device fabric
quiescent, the retire-count clock, no debug trigger, and no JIT, profiler, HTIF,
session clock or source capture. It:

- computes, as a retire count, the first boundary at which MTIP or STIP could newly
  read set (the horizon) and stops before the block at or past it;
- counts retirements and applies the Zicntr counters, the retire clock, the progress
  counter and the live-work counters in bulk before anything that can observe them,
  refreshing the `time` shadow at the boundary of the block being executed;
- executes integer ops through the existing `integer_result`, and loads, stores,
  branches and jumps inline only on the path `Hart::execute` would take without
  leaving the hart (aligned access, live fast-TLB entry, all-RAM page, aligned
  target); everything else — CSR, system, FP, atomic, misaligned, faulting, MMIO —
  goes through the ordinary executor with the ordinary accounting;
- returns to the ordinary loop after any op that ends its block outside inline
  execution, after any device access (at the next boundary), when a store drops the
  running block, and when the work budget runs out.

It is on by default and switchable: `Machine::set_turbo`, CLI `--no-turbo`, wasm
`setTurbo`, page `?turbo=0`. The Replay desktop boots interpreter-only so the loop
engages there (the JIT was slower on it, E4-T40a); `?jit=1` restores the JIT.

Also in scope, because the proofs need them: CLI `--virtio-rng-seed` (a fixed byte
stream for the entropy device, so a snapshot that has the rng slot can be replayed
bit-for-bit), CLI `--decoded-cache-entries`, and CLI `--resume-core-id` /
`--resume-base-id` (adopt a stamped snapshot's identity before it is validated, so the
shipped desktop snapshot can be resumed natively).

Out of scope: block chaining, a larger default decoded cache, superinstructions, any
JIT change, other guests' boot options.

## Deterministic acceptance

1. `cargo test --release -p wasm-vm-core --lib -- turbo_equivalence_tests tests::turbo_loop_takes_timer_interrupts_at_the_same_boundaries tests::replay_block_tail_is_unobservable tests::deferred_retire_accounting_is_unobservable`
   (17 tests) passes: with the loop on, the retire-trace hash, retired count, run outcomes,
   registers, full hart snapshot, RAM digest, `mtime`, tick residue and progress
   counter equal the general loop's for every slicing, and the loop demonstrably
   engaged.
2. `bash tools/perf/oracle.sh target/release/wasm-vm OUT && diff -r evidence/perf-overhaul/oracle-baseline OUT/digests`
   differs only by the baseline's README: the six committed boot digests are
   reproduced with the loop engaged in the batched cases.
3. `bash tools/perf/turbo-equivalence.sh 2000000000` prints `EQUIVALENT`: from the warm
   Replay desktop snapshot, 2 billion instructions with and without `--no-turbo`
   produce the same retire-trace FNV, retired count and RAM SHA-256.
4. `node tools/perf/desktop-latency.mjs --label turbo --n 3 --out evidence/e4-t40b/browser-turbo.json`
   on the built page exits 0 with no missing sample, and its click, key-echo, Node and
   MIPS figures are recorded against the E4-T40a baseline.

## Adversarial verification

High risk (guest architectural semantics). Attack the equivalence argument in
`turbo.rs`, not the speed:

- A timer deadline that moves while blocks are running: an MMIO write to `mtimecmp`
  from the middle of a block, an SBI `set_timer`, a deadline already in the past.
  The interrupt must be taken at the boundary the ordinary loop picks.
- `csrr time`, `csrr cycle`/`instret`, a CLINT `mtime` load and a counter write placed
  after runs of inline ops, at every slicing including one instruction at a time.
- A store that rewrites the running block, a later op of the same block, and another
  cached block; a store into a page-table page.
- A run budget that expires on every op index of a block, and at a boundary.
- A faulting load/store/fetch in the middle of a chain of blocks; an entry
  instruction that straddles a page.
- An armed debug trigger, wall-clock mode, the JIT, a session clock: the loop must
  stay out.
- Sabotage each of: the horizon test, the device-access stop, the `time` shadow
  refresh, the code-filter test after an inline store. The tests must fail.
- State the loop leaves behind at exit (cursor, `mip`, the `time` shadow, counters)
  must match at every exit kind.

## Verification log

### 2026-11-24 — worker — implemented

Runtime head `16ed17e48` (implementation `aa45bc340` plus the regenerated GPU
checkpoint build id). Later commits change no runtime file: `33b11bdd8` adds
`RELEASES` handling to `tools/perf/turbo-equivalence.sh`, and the commit carrying
this entry adds `tools/serve-dist.sh` (serves the committed `web/dist` with
`releases/` mounted, so a built page can be verified without the working copy of
`web/`), this log and the evidence. Built page wasm:
`web/dist/pkg/wasm_vm_wasm_bg.wasm` SHA-256
`ba675629a622bd5ea4fe839aa469e31a8dc1f14ce57efdfda68f4d7392d479fb`, byte-identical
to the local `wasm-pack` build the browser runs used. Apple M4 Max, Chrome
158.0.8127.88 headless. Evidence: `evidence/e4-t40b/`.

**1. Unit tests (acceptance 1)** — `gates.log`: the three named tests pass. They
compare the general loop (`replay_tail_off`, turbo off) with the turbo loop for the
retire-trace hash, retired count, run outcomes, registers, full hart snapshot, RAM
digest, `mtime`, tick residue and progress counter, traced and untraced, for slicings
of 1,000,000 / 1,7,333 / 4096,3 / 2,5 / 5,3 / 2 / 97 work slots, and assert the loop
engaged (`inline_ops`, `slow_ops`, `exit_horizon`). The new timer test's guest has an
M-mode timer handler that folds every interrupted `mepc` into a register, and a main
loop that rewrites `mtimecmp` through the CLINT from the middle of a block.
Sabotage, each run once then reverted: dropping the `time`-shadow refresh fails
`deferred_retire_accounting_is_unobservable`; ignoring the horizon, ignoring the
device-access stop, and not recording a device access each fail the timer test at its
equivalence assertion.

**2. Boot oracle (acceptance 2)** — `oracle.log`, `oracle-digests/`: all six digests
equal the committed baseline (`diff -r` reports only the baseline's README). The loop
was engaged in the batched cases: 2.36 M entries / 396 M inline ops (busybox-fast),
15.1 M entries / 1,976 M inline ops (alpine-fast).

**3. Desktop equivalence (acceptance 3)** — `equivalence-2b.log` and the two evidence
files: `EQUIVALENT (2000000000 instructions)`; both runs report trace FNV
`0dab1ccaa237df29`, 1,999,831,660 retired, RAM SHA-256 `ed70e270…38701`. The turbo
run entered the loop 10.9 M times and retired 1,980 M ops inline. An earlier
10-billion-instruction run of the same comparison (before the final formatting-only
edits) was also equivalent (FNV `1b6bf642aad8bdf0`, 9,999,141,680 retired); it is
not evidence for this head.

**4. Browser (acceptance 4)** — `browser-turbo-{1,2}.json`, `browser-no-turbo.json`
(`?turbo=0`, same build), each exit 0 with `missing: []`. Median of 3 (range):

| Measure | Baseline, shipped (E4-T40a) | This head, turbo | This head, `?turbo=0` |
|---|---:|---:|---:|
| Idle guest speed | 44–46 MIPS | 148–149 MIPS | 75 MIPS |
| Click: "runs" line repainted | 1,492–1,965 ms | 452 ms (436–1,025), 492 ms (478–1,825) | 831 ms (818–1,143) |
| Sweep then click | 900–1,119 ms | 402 ms, 386 ms | 685 ms |
| Key echo in foot | 82–92 ms | 43 ms, 47 ms | 85 ms |
| `node -e 'console.log(6*7)'` to prompt | 13.7–14.2 s | 5.6 s, 5.4 s | 11.5 s |
| Node integer loop (wall) | 17.5–17.7 s | 11.9 s, 11.7 s | 21.5 s |
| Shell loop (762 M instructions) | 15.7–16.3 s | 6.6 s, 6.5 s | 14.2 s |

A click retires the same 39–43 M guest instructions as before; the host runs them
faster. The first click of a session (1.0–1.8 s) and the first Node run (27–28 s,
885 M instructions) are still slow: the guest spins idle while a disk read waits for
the end of the run slice. That is not this task's seam and is filed as follow-up work.

**Gates.** `cargo fmt --all --check` clean. `make clippy`: the workspace command
passes; the `zicsr-stub` command fails with the same five dead-code errors as the
parent commit (session-clock items; `clippy.log`, and identical on a pristine
checkout of the parent). `cargo test --workspace --exclude wasm-vm-wvseccomp`:
every test binary reports ok, no failure (`workspace-tests.log`, 340 result lines).
`cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown`
and `wasm-pack test --node crates/wasm`: all ok (`wasm-tests.log`; a first attempt
failed to write build files because this machine's disk was full — my own scratch
clone — and passed unchanged once space was freed). A first run of that suite at an earlier state caught a real
bug of mine — the stats tally underflowed when an ordinary-path op trapped
(`verifier_fs_frm_transitions_through_partial_blocks_match_the_batched_interpreter`,
debug overflow) — fixed before this head by counting an ordinary op only after it
retires. `dev::virtio::gpu::resources::tests::gpu_transfer_full_frame_native_budget`
is a 5 ms wall-clock budget that fails under parallel load and passes alone (3/3),
on this head and on the parent.

**Cold clone** — `cold-clone.log`: a `git clone` of `33b11bdd8` in a scratch
directory with `RUSTFLAGS`/`RUST_LOG`/`CARGO_TARGET_DIR` unset passes the three
tests, reproduces the oracle baseline and prints `EQUIVALENT (2000000000
instructions)` with the same digest. The large gitignored artifacts (Alpine rootfs,
Replay image and snapshot) come from this checkout through `RELEASES=`.

**What the recording demonstrates.** The loop changes how long the host takes, not
what the guest does: every retired instruction, register write and memory access of
2 billion desktop instructions and of the six boot workloads is identical with it on
and off, timer interrupts land on the same instruction boundary, and the state left
at every kind of exit matches. In the browser it roughly halves interaction latency
against the same build's ordinary loop and cuts a click's result from 1.5–2.0 s to
about 0.45–0.5 s against what is shipped.

**Not covered.** Wall-clock and paced-icount guest clocks never enter the loop
(wall mode is excluded; paced mode shares the ICount path and is exercised only by
the existing paced tests, not by a dedicated turbo test). Omarchy and the other
guests still boot with the JIT and so do not use the loop. The browser runs above
used `tools/serve-dev.sh` (the source tree with the same wasm as `web/dist`); a
two-trial click check against the committed bundle through `tools/serve-dist.sh`
booted the desktop and answered (1,679 ms first click, 575 ms second) but is not a
recorded run.

### 2026-11-24 — verifier — VERDICT: needs-evidence

Fresh session, runtime head `16ed17e48` (tree `d6bc706ba`; `crates/` untouched by me). Nothing I
ran contradicts the claim: every acceptance command reproduces, and 14 new guest programs,
compared after every `run()` call, agree with the general loop. The submission is short on
proof, not on correctness: five changed hunks are executed by none of the recorded runs, or are
executed without any recorded check depending on them, and one branch cannot run at all.
Evidence: `evidence/e4-t40b/verifier/`.

**Predictions (each fixed before its check was run).**

- P1 sweeps — predicted no `#[ignore]`, no removed assert or test, no disabled `debug_assert`
  in `git diff 79b5c2817..d6bc706ba -- crates/`, and that the two modified tests still compare
  general vs replay loop with turbo off. Observed: only added `debug_assert`s
  (`turbo.rs:300`, `hart/turbo.rs:68,98,117`); `lib.rs:7924-7932` and `lib.rs:8313-8350` keep
  the original comparisons (`deferred > 1000`, `tail_ops > 1000`, turbo `entries == 0`). HELD.
- P2 acceptance 1 — the three tests pass in release. Observed `3 passed`
  (`verifier/acceptance1.log`). HELD.
- P3 acceptance 2 — six digests equal the baseline with the loop engaged. Observed
  `diff -r` reports only the README; `turbo: entries=2360038` (busybox-fast) and `15084958`
  (alpine-fast); the `-jit` and `-cache` cases report `entries=0` and the legacy case, with
  no block cache, prints no turbo line (`verifier/oracle.log`). HELD.
- P4 acceptance 3 — `EQUIVALENT` at 2,000,000,000 with the worker's digest. Observed FNV
  `0dab1ccaa237df29`, 1,999,831,660 retired, state `ed70e270…38701`, 10,927,101 entries. HELD.
  Independent configurations through a copy of the script (`verifier/turbo-equivalence-param.sh`),
  all `EQUIVALENT` with identical console output (`verifier/equivalence-batch{,2}.log`):

  | Instructions | rng seed | quantum | decoded cache | trace FNV (both runs) | retired |
  |---:|---:|---:|---:|---|---:|
  | 137,000,001 | 42 | 500,000 | default | `7b5b69137e65f17e` | 136,989,303 |
  | 911,111,111 | 7 | 7,919 | default | `257433fd92660a1b` | 911,008,830 |
  | 3,141,592,653 | 123456789 | 123,457 | default | `14ab1a116c04b2d9` | 3,141,326,734 |
  | 50,000,017 | 99 | 1 | default | `2be0aad58afc55f3` | 49,996,707 |
  | 733,333,337 | 31337 | 1,000,003 | default | `62c304f1a7739ac8` | 733,252,036 |
  | 1,234,567,891 | 42 | 500,000 | 16,384 (the browser's) | `967e7d0701d4c52b` | 1,234,462,395 |
  | 311,111,113 | 5 | 65,537 | 64 | `ceb343d0c685db0e` | 311,078,832 |
  | 97,000,003 | 11 | 500,000 | 1 | `552ad037953547d2` | 96,993,073 |

- P5 acceptance 4 — on the committed `web/dist` (`tools/serve-dist.sh 8125`, wasm SHA-256
  `ba675629…d479fb` as served): exit 0, `missing: []`, loop engaged, no JIT, timings within 40%
  of the claim. Observed (`verifier/browser-dist.json`): `jit.turbo.enabled: true`,
  `entries: 76831910`, `jit.hasExecutor: false`, one console error (the favicon 404); idle
  150 MIPS; click 393 ms median (393–1,548); sweep-then-click 384 ms; key echo 44 ms; `node -e`
  5.3 s median (first run 26.9 s); Node loop 11.5 s; shell loop 6.3 s. HELD.
- P6 own guests — predicted every observable equal after every `run()` call for slicings
  `[1000000] [1] [2] [3] [5] [1,7,333] [4096,3] [97]`, traced and untraced. Observed: all 14
  tests in `verifier/turbo_equivalence_tests.rs` pass at this head, debug (assertions on, 16 s)
  and release (2.2 s). They compare outcome, trace hash and count, the whole hart snapshot, CLINT
  registers, tick residue, `stimecmp`, progress/interrupt/`wfi` counters, the resume position,
  live-work counters, all RAM bytes, and the dirty-page set after a mid-run commit. Scenarios:
  SBI `set_timer` future / past / re-armed from the handler (dividers 1, 3, 10); counter CSRs
  after inline ops and first in a block; Sv39 with stores rewriting an earlier op, a later op
  and another page's block, load/store/fetch page faults, an undecodable op, and page-table
  stores with and without a TLB flush; LR/SC around inline stores; `jalr` with bit 0 set,
  `rd == rs1`, its own block as target, compressed ops; all load/store widths and six branch
  kinds; misaligned accesses, UART and CLINT accesses mid-block, an `msip` interrupt, a write to
  `mtime`; page-straddling entries (one trapping) and the 128-op cap under a timer; FP and AMO
  ops; an unhandled trap; `wfi` in plain, paced and live-unrecorded modes; 32 seeded random
  programs. HELD.
- P7 exclusions — predicted `turbo_stats().entries == 0` with a trigger armed, wall clock, JIT
  attached, session clock, profiler, HTIF, batching off, cache off, `set_turbo(false)`, and
  `> 0` otherwise. Observed so (`excluded_modes_never_enter_the_turbo_loop`). The loop is NOT
  excluded in paced-ICount and live-unrecorded modes; equivalence holds there
  (`wfi_idle_jumps_in_every_clock_mode_the_loop_runs_in`). I found no mode that should be
  excluded and is not. HELD.
- P8 exit states — for each `return` in `turbo_loop` (`turbo.rs:333, 346, 360, 363, 383, 434,
  439, 445, 452, 484`) I predicted the cursor, settled accounting and `time` shadow the ordinary
  loop has at that point, then checked by reading and by the per-call comparison of the resume
  position and hart snapshot. Observed equal; a boundary exit leaves `block_cursor = None` where
  the ordinary loop leaves a cursor parked past its block's last op, which `at_block_boundary`
  and `next_micro_op` treat identically (`lib.rs:6003-6011, 6132-6137`). HELD.
- P9 sabotage (task list) — predicted each makes one of the three acceptance tests fail.
  Observed in release (`verifier/sabotage-round1.log`): horizon test (`turbo.rs:316`) → timer
  test; device-access stop (`:320`) → timer test; device access not recorded (`:455-458`) →
  timer test; `time`-shadow refresh (`:214`) → deferred and timer tests; code-filter test
  (`:467-469`) → replay test. HELD for the task's four.
- P10 sabotage (reservation clear, `hart/turbo.rs:121-126`) — predicted one of the three tests
  fails. Observed: all three pass. FAILED → NEEDS EVIDENCE, item 1 below.
- P11 pre-existing failures — the five `zicsr-stub` dead-code errors: identical on a pristine
  worktree of `79b5c2817`. `gpu_transfer_full_frame_native_budget`: passes alone 3/3 and in a
  single-threaded release run of all 411 core lib tests; the diff touches nothing under
  `crates/core/src/dev`. Both independent of this task. HELD.

**COVERAGE.** Hit counts from a scratch build with a counter on every changed hunk
(`verifier/instrument.py`, table in `verifier/coverage-hit-counts.txt`; the instrumented binary
reproduced the baseline digests). "Recorded" = the whole `cargo test --workspace --exclude
wasm-vm-wvseccomp` run (340 result lines, none failed, the three acceptance tests among them),
both `-fast` oracle boots and the 2,000,000,000-instruction desktop run.

NEEDS EVIDENCE — commit a test that executes and observes each (the named test in
`verifier/turbo_equivalence_tests.rs` does; see SUITE):

1. `hart/turbo.rs:121-126`, the inline store clearing the LR/SC reservation: 0 executions in
   every recorded run, so none can observe it; removing it passes all three acceptance tests.
   `inline_stores_clear_exactly_the_overlapping_reservation`
   runs it 10,916 times and fails without it.
2. `turbo.rs:357-361`, a trap from an uncached page-straddling entry op: 0 executions recorded
   (the non-trapping path ran 1,048,982 times on the desktop).
   `page_straddling_entries_and_the_128_op_cap`
   runs it 640 times; dropping the settle at `:356` fails only that test.
3. `turbo.rs:486`, carrying on after a code-filter hit that drops nothing: 0 executions
   recorded. Reachable after a whole-cache flush (a PMP change leaves stale page records in the
   filter, `dispatch.rs:655`) or with more than 1 GiB of RAM (`dispatch.rs:475-477`).
   `inline_store_to_a_page_whose_code_was_flushed_wholesale` runs it 3,558 times.
4. `hart/turbo.rs:181`, `& !1` on the `jalr` target: the inline `jalr` runs in no workspace
   test (0 hits) and 43 M times on the desktop; removing the mask passes the three tests and
   leaves the busybox-fast digest unchanged (the other boots were not retried).
   `jalr_targets_and_compressed_inline_ops` fails without it.
5. `turbo.rs:248`, live-work accounting of an op run through the ordinary executor: removing
   it passes the three tests (the rest of the workspace was not retried). The live-unrecorded
   case of `wfi_idle_jumps_in_every_clock_mode_the_loop_runs_in` fails without it.
6. Fast-gate breadth: the inline `Lwu/Lh/Lhu/Lbu/Sh`, `Bge/Bgeu` and `Jalr` arms and the
   uncached entry (`turbo.rs:352-364`) run in no workspace test, only in the Linux boots (which
   need the release artifacts); `Blt/Bltu` and the `enter_block` trap exit (`:344-347`) run in
   none of the three acceptance tests. Zero-extending `Lh` or making `Bge` strict passes all
   three tests.
   `inline_load_store_widths_and_all_six_branches`,
   the Sv39 test and the block-shapes test cover them. (The SBI term of the horizon,
   `turbo.rs:194-196`, is likewise caught by no unit test but IS caught by acceptance 2: the
   busybox-fast digest changes.)

DEAD — delete:

7. `turbo.rs:371` and `:389-391` (`ordinary_next`), with the "Fetch walks" paragraph at
   `:49-51`. The paragraph says a fetch translation can update a PTE and log the frame; this
   MMU never writes a PTE (`mmu.rs:11-12`, Svade trap scheme; no store in `mmu.rs`), and
   `enter_block` drains the log before translating (`lib.rs:6025`), so the log is always empty
   at `:371`. 0 hits in every run above and in all 14 verifier tests; forcing it `false` changes
   no test. Delete it, or state the invariant as a `debug_assert!` on the empty log.

WAIVED (one line each): `turbo.rs:450-453` — `turbo_ctx()` is `None` only with a trigger armed,
which only a CSR instruction can do, and that ends its block at `:441-446`; the arm just hands
back to the ordinary loop. `hart/turbo.rs:97-100, 116-119` — invariant guard (fast-TLB entries
exist only for all-RAM pages) that falls back to the ordinary executor. `hart/turbo.rs:137-139,
172-174` — mirror of `execute`'s odd-target check; the PC and B/J offsets are even; falls back
to the ordinary executor. `turbo.rs:320`, `!fabric_quiescent()` as the only stop reason —
evaluated at every boundary; alone it can only follow an instruction fetch from a fabric
window. Stats, CLI/wasm/page switches — configuration and logging; `--no-turbo`,
`--virtio-rng-seed`, `--decoded-cache-entries`, `--resume-core-id/--resume-base-id` all ran in
the equivalence batches, `?turbo=0` in the worker's browser run.

Not findings, for the same edit: removing the settle-on-entry for a block that ends in a system
op (`turbo.rs:365-367`, and with it `DecodedBlock::system_end` and `is_control_transfer` in
`dispatch.rs`) changes no test and not the busybox-fast digest — the settle before the system
op itself does the same work — so the module doc's sentence about it is not load-bearing, and
without the field the Boundary's "no change to the block cache" would be literally true. The
same holds for `ctx = next` at `turbo.rs:454`, which the `TurboCtx` doc already says cannot
change. `--resume-core-id` and `--resume-base-id` are in the diff but not in the Boundary's
list of proof-support flags.

**SUITE.** Nothing promoted: coverage does not hold at this head, so the tests stay evidence.
`evidence/e4-t40b/verifier/turbo_equivalence_tests.rs` (14 tests, SHA-256 `f84e6ff2…1c567f`)
passes at `16ed17e48` in debug and release and is `cargo fmt`/clippy clean; its header says
where it goes. Sabotage against it (release; `verifier/sabotage-round1.log` with its first nine
tests, `verifier/sabotage-round2.log` with thirteen; the fourteenth, random programs, came
after): every sabotage above that changes behavior fails at least one of its tests; the three
that change nothing (item 7 and the two non-findings) fail none.

**For the next round.** Add tests for items 1–6 (adopting the file is enough), delete item 7,
rerun acceptance 1–4 at the new head. A later verifier can carry P1, P7, P8 and P11 forward and
needs only the acceptance commands, the 14 tests and the hit counts for items 1–7.

Commands: the acceptance 1 test command as written; `bash tools/perf/oracle.sh target/release/wasm-vm
target/verifier-oracle && diff -r evidence/perf-overhaul/oracle-baseline
target/verifier-oracle/digests`; `bash tools/perf/turbo-equivalence.sh 2000000000
target/verifier-equiv`; `verifier/equiv-batch.sh`, `verifier/equiv-batch2.sh`;
`cargo test [--release] -p wasm-vm-core --lib -- turbo_equivalence_tests` (file placed in
`crates/core/src`, then removed); `python3 verifier/sabotage.py . [names]`;
`python3 verifier/sabotage_cli.py . OUT horizon-ignores-sbi-timer jalr-keeps-bit0
system-end-settle-on-entry ctx-not-refreshed-after-slow-op` then `ORACLE_CASES=busybox-fast
bash tools/perf/oracle.sh OUT/wasm-vm-sab-… …`; `python3 verifier/instrument.py .` then the
tests, `TURBO_COV=1` oracle and equivalence runs; `python3 verifier/instrument_atexit.py .`
then `TURBO_COV_FILE=… cargo test --workspace --exclude wasm-vm-wvseccomp --no-fail-fast`;
`cargo clippy -p wasm-vm-core
--no-default-features --features std,trace,zicsr-stub --lib -- -D warnings` on a worktree of
`79b5c2817`; `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html
--label verifier --n 3 --out evidence/e4-t40b/verifier/browser-dist.json`.

### 2026-11-24 — worker — rework after `needs-evidence`

Runtime head `a2233d307` (`7ac39f427` plus the regenerated GPU checkpoint build id);
built page wasm SHA-256
`3b26459e9fd454a8773fef90230206278123861bd8a67dc57043e56609e0198f`. Evidence:
`evidence/e4-t40b/r2/`.

**Items 1–6 (tests).** The verifier's file is adopted unchanged as
`crates/core/src/turbo_equivalence_tests.rs` (SHA-256 `f84e6ff2…1c567f`, 14 tests) and
acceptance 1 now names it: 17 tests pass (`r2/gates.log`). Per the verifier's hit
counts and sabotage log, each of items 1–6 is executed by one of them and each
sabotage fails one of them: the reservation clear
(`inline_stores_clear_exactly_the_overlapping_reservation`), the trapping
page-straddling entry (`page_straddling_entries_and_the_128_op_cap`), carrying on after
a code-filter hit that drops nothing
(`inline_store_to_a_page_whose_code_was_flushed_wholesale`), the `jalr` bit-0 mask
(`jalr_targets_and_compressed_inline_ops`), live-work accounting of an ordinary-path op
(`wfi_idle_jumps_in_every_clock_mode_the_loop_runs_in`), and the remaining load/store
widths and branch kinds (`inline_load_store_widths_and_all_six_branches`, the Sv39 and
block-shape tests).

**Item 7 (dead code).** `ordinary_next` and the "Fetch walks" paragraph are deleted.
The invariant is stated where the branch was: `debug_assert!` that the code-write log
is empty when a block's ops start. My claim that a fetch translation can update a PTE
was wrong for this MMU.

**The two non-findings.** Also removed, as inert: the settle-on-entry for a block that
ends in a system op, with `DecodedBlock::system_end` and `is_control_transfer` — the
ordinary-executor path settles before the system op and refreshes the `time` shadow at
that block's boundary, which is what the module doc now says. `crates/core/src/dispatch.rs`
is unchanged by this task again, so the Boundary's "no change to the block cache" holds
literally. `ctx = next` after an ordinary-path op is kept (waived by the verifier). The
Boundary now lists `--resume-core-id` / `--resume-base-id`.

**Acceptance at this head.**

1. 17 tests pass (`r2/gates.log`).
2. Oracle: `diff -r` reports only the baseline README; busybox-fast 2,360,038 entries,
   alpine-fast 15,084,958 (`r2/oracle.log`) — the same entry counts as before the rework.
3. `EQUIVALENT (2000000000 instructions)`: FNV `0dab1ccaa237df29`, 1,999,831,660
   retired, RAM `ed70e270…38701` — the digests of the previous head
   (`r2/equivalence-2b.log`).
4. Browser, on the committed `web/dist` through `tools/serve-dist.sh 8125`
   (`r2/browser-dist.json`): exit 0, `missing: []`, turbo enabled with 70,439,402
   entries, no JIT executor; click 488 ms median (482–1,682), sweep-then-click 434 ms,
   key echo 50 ms, `node -e` 5.8 s (first run 26.6 s), Node loop 12.4 s, shell loop
   6.7 s.

**Gates.** `cargo fmt --all --check` clean. `make clippy`: the workspace command
passes, the `zicsr-stub` command shows the same five pre-existing dead-code errors
(`r2/clippy.log`). `cargo test --workspace --exclude wasm-vm-wvseccomp`: every binary ok,
340 result lines, no failure (`r2/workspace-tests.log`). wasm32 core build and
`wasm-pack test --node crates/wasm`: 81 result lines, all ok (`r2/wasm-tests.log`).

**Cold clone** at `a2233d307` (`r2/cold-clone.log`; sparse checkout that leaves out
`evidence/` except the oracle baseline, and `web/dist`, to fit this machine's disk; no
tracked change; `RUSTFLAGS`/`RUST_LOG`/`CARGO_TARGET_DIR` unset): 17 tests pass, the
oracle reproduces the baseline, and `EQUIVALENT (2000000000 instructions)` with RAM
`ed70e270…38701`.

**For the verifier.** Changed since the head you examined: `crates/core/src/turbo.rs`
(the `ordinary_next` branch and its doc paragraph deleted, a `debug_assert!` in their
place; the system-end settle and its doc sentence deleted), `crates/core/src/dispatch.rs`
(back to the parent's content), `crates/core/src/lib.rs` (one `mod` line), the new test
file, and this task file's Boundary and acceptance 1. `crates/core/src/hart/turbo.rs`,
the CLI, the wasm crate and `web/` sources are untouched.
