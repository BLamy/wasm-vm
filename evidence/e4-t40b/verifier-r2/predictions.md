# E4-T40b verifier round 2 — predictions, written before the checks were run

Head under test: `48f516905` (runtime `a2233d307`). Round-1 verifier commit: `ccb7da9f5`.
Already seen when this was written (ORIENT only): the task file, `git diff ccb7da9f5 a2233d307 -- crates/`,
`turbo.rs`, `hart/turbo.rs`, `enter_block`, `mmu.rs`, `mmio.rs`, the worker's `r2/` logs, and that the
committed test file's SHA-256 equals the round-1 evidence file's. No test, build, boot or browser run
had been started.

## Sweeps
- S1. `git diff ccb7da9f5 a2233d307 -- crates/` adds no `#[ignore]`, removes no assert and no test; the
  only assert change is one ADDED `debug_assert!` (turbo.rs:365).
- S2. `git diff 79b5c2817 a2233d307 -- crates/core/src/dispatch.rs` is empty.

## Acceptance
- A1. The 17-test command passes in release. The 14 `turbo_equivalence_tests` pass in a debug build
  (the new `debug_assert!` is live and never fires).
- A2. Oracle: `diff -r` reports only the baseline README; busybox-fast `entries=2360038`,
  alpine-fast `entries=15084958` (unchanged from round 1: neither deletion changes when the loop
  is entered or left).
- A3. `turbo-equivalence.sh 2000000000`: EQUIVALENT, FNV `0dab1ccaa237df29`, retired 1,999,831,660,
  RAM `ed70e270…38701`, turbo `entries=10927101`.
- A3b (mine). N=1,618,033,989, rng seed 271828, quantum 9,973: EQUIVALENT.
- A4. Browser on the committed bundle (wasm `3b26459e…e0198f` as served): exit 0, `missing: []`,
  `jit.turbo.enabled` true, `entries` > 0, `jit.hasExecutor` false; click median in 0.27–0.70 s,
  `node -e` median in 3.3–7.7 s.

## The two deletions
- D-a. The code-write log is empty at turbo.rs:365 on every block entry. Reasoning: `enter_block`
  drains it (lib.rs:6027) whenever the block cache is on, which the loop requires
  (`interrupt_batching()` implies `block_cache_enabled`); what follows — `fetch_phys`, `decode_at`,
  discovery, the cache insert — reaches the bus only through `load64`/`load16` and `&impl Bus`
  (`fast_publish`); devices never hold the bus; the log is appended only by `note_ram_store`,
  `write_ram_slice` and turbo.rs:470. Check: a release CLI built with `debug-assertions` on runs the
  busybox-fast and alpine-fast oracle cases and a desktop equivalence run (virtio blk/net/rng/gpu
  DMA) without a panic and with the baseline digests.
- D-b. A CSR/system op always reads the `time` shadow of its own block's boundary. Reasoning: CSR
  and system ops are never inline, and both ordinary-op sites settle first (turbo.rs:353, :417);
  the first settle of a block takes `before_block`, so `sync_clint` runs with exactly the
  retirements that preceded the boundary. Before the rework every block containing a CSR op was
  settled on entry (a CSR op is a terminator, so such a block was always `system_end`); now the
  first settle of such a block can be a mid-block slow op, a code-filter hit or a budget exit.
  Checks:
  1. Removing `self.sync_clint()` from `turbo_settle` fails both
     `counter_csrs_after_inline_ops_and_first_in_block` and
     `sbi_timer_deadlines_future_past_and_rearmed`.
  2. A scratch guest (`system_end_scratch_test.rs`) whose blocks end in `csrr time` and whose first
     settle is, in turn: the CSR op itself, a stale-filter store, a store that drops another
     cached block, a misaligned load, a CLINT `mtime` load, an FP op — dividers 1 and 3, every
     slicing, traced and untraced — agrees with the general loop after every `run()` call, debug
     and release. Under sabotage 1 it fails too.

## Coverage items 1–6 at this head (each: hit count > 0 in the named test, and the sabotage fails it)
1. reservation clear (`hart/turbo.rs:125`) → `inline_stores_clear_exactly_the_overlapping_reservation`.
2. trapping uncached entry (`turbo.rs:353-358`), sabotage: drop the settle at :353 →
   `page_straddling_entries_and_the_128_op_cap`.
3. carry on after a filter hit that drops nothing (`turbo.rs:477`), sabotage: treat it as a dropped
   block (clear the cursor, return) → `inline_store_to_a_page_whose_code_was_flushed_wholesale`.
4. `jalr` `& !1` (`hart/turbo.rs:181`) → `jalr_targets_and_compressed_inline_ops`. Whole core lib
   suite under it: that test fails; I expect no other (the inline `jalr` ran in no other workspace
   test in round 1).
5. live-work accounting of an ordinary-path op (`turbo.rs:245`) →
   `wfi_idle_jumps_in_every_clock_mode_the_loop_runs_in`. Whole core lib suite under it: at least
   that test; possibly other live-unrecorded tests, since the loop is on by default.
6. `Lh` zero-extends, `Bge` strict → `inline_load_store_widths_and_all_six_branches`; the
   `enter_block` trap exit without its settle → `self_modifying_stores_and_page_faults_under_sv39`;
   and one mutation per remaining arm (`Lwu`, `Lhu`, `Lbu`, `Sh`, `Bgeu`, `Blt`, `Bltu`) each fails
   the widths-and-branches test. Hit counts > 0 for every one of those arms and for `Jalr`.

## Carried forward (to re-check only that the code they rest on is unchanged)
P1 sweeps, P7 exclusions, P8 exit states (re-audit the block-entry region the deletions touched),
P11 pre-existing failures.

## Notes added after the checks (the text above is as written beforehand)
- Correction to the header: one `cargo build --release -p wasm-vm-cli` had run before this file was
  written; it compiled nothing (`Finished … in 0.26s`).
- Outcomes are in the task's Verification log (round 2). One prediction above missed: in item 6,
  `Bgeu` made strict and `Bltu` made `<=` fail `random_programs_agree_under_every_slicing`, not the
  widths-and-branches test. The scratch test's first run stopped on my own `exit_horizon > 20`
  bound (16 at divider 3) after its comparisons had passed; the bound is now 5.
