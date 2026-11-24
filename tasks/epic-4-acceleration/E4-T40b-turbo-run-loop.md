---
id: E4-T40b
epic: 4
title: Turbo run loop — whole-block interpretation with deferred accounting, bit-identical to the batched interpreter
priority: 0.38762
status: pending
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
bit-for-bit) and CLI `--decoded-cache-entries`.

Out of scope: block chaining, a larger default decoded cache, superinstructions, any
JIT change, other guests' boot options.

## Deterministic acceptance

1. `cargo test --release -p wasm-vm-core --lib -- tests::turbo_loop_takes_timer_interrupts_at_the_same_boundaries tests::replay_block_tail_is_unobservable tests::deferred_retire_accounting_is_unobservable`
   passes: with the loop on, the retire-trace hash, retired count, run outcomes,
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
