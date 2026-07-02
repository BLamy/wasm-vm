---
id: E6-T08
epic: 6
title: JIT code-cache coherence across hart workers
priority: 608
status: pending
depends_on: [E6-T05, E6-T07]
estimate: L
capstone: false
---

## Goal
The Epic 4 JIT is safe under SMP: each hart worker's translation cache is invalidated
correctly when any hart (or DMA) writes to translated guest pages, remote_fence_i
provides the architectural synchronization point, and cross-modifying code executes
correctly — without serializing the fast path.

## Context
Epic 4 built per-execution-thread translation with self-modifying-code (SMC) detection
via page write-tracking. SMP breaks its assumptions: hart A can patch code hart B is
executing. Architecturally RISC-V requires the *executing* hart to do FENCE.I after
remote modification, which Linux implements via `sbi_remote_fence_i` (and exposes to
userspace via the `riscv_flush_icache` syscall) — so hooking E6-T07's remote_fence_i is
the architectural sync point. But our JIT must also stay *memory-safe* when guests skip
the protocol: a shared page-generation table in the SAB (guest phys page → u32 gen
counter, bumped by any tracked write) lets each block prologue or chain-entry validate
generations cheaply, with eager cross-worker invalidation doorbells for the pages a
worker has translated. Note `WebAssembly.Module` is structured-cloneable: decide whether
hot translations compile once and ship to workers, or compile per-worker (measure —
compile time vs postMessage latency).

## Deliverables
- Shared page-generation table + write-tracking extension to cover all harts and DMA
  writers (virtio devices writing guest RAM must bump generations too).
- Per-worker invalidation queue with doorbell; remote_fence_i drains the target's queue
  before completing (integrates with E6-T07's completion protocol).
- Block linking/chaining rules updated: no stale-target chaining across an invalidation
  (documented invariant + debug assertion build).
- Cross-modifying-code guest test: hart A patches a function hart B calls in a loop via
  the flush-icache syscall protocol; asserts B observes the new code within a bounded
  number of calls and *never* executes a torn mix of old/new.
- Compile-once-vs-per-worker decision recorded with measurements in `docs/jit.md`.

## Acceptance criteria
- [ ] Full compliance suite + Linux boot pass at smp=4 with JIT enabled; zero
      interpreter-vs-JIT divergence in differential spot-checks (Epic 4 harness, now run
      per-hart).
- [ ] The cross-modifying test passes 10^5 patch cycles at smp=4; with the generation
      check deliberately disabled it fails (detector is load-bearing).
- [ ] A guest running `gcc` self-rebuild of a small project at smp=4 completes with
      correct output (compilers exercise mprotect+SMC via ld.so and JIT-less paths).
- [ ] JIT smp=4 aggregate CoreMark ≥ 3x smp=1 JIT baseline on a ≥8-core host.
- [ ] No fast-path lock: perf counters show block entry adds ≤ 2 shared-memory loads.

## Adversarial verification
Race the tracker: hart A stores to a page in the same microsecond hart B first executes
from it (arrange with Atomics-based starting gun); repeat 10^6 times looking for B
executing pre-store bytes after A's store retired *and* the fence protocol ran — one
occurrence refutes. Attack DMA: have virtio-blk read file data into a page that was
previously executed, then jump to it after fence.i; stale translation execution refutes.
Overflow the generation counter (u32 wrap): force 2^32 bumps on one page via a tight AMO
loop if feasible, else unit-test the wrap path directly — wrong wrap handling refutes.
Disable chaining invalidation only (leave prologue checks) and prove the test suite
catches it; if nothing fails, the chaining invariant is untested and that itself refutes
the acceptance claim. Measure the fast path with the debug-assertion build off to confirm
the ≤2-loads claim.

## Verification log
(empty)
