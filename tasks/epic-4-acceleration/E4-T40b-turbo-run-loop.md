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
