---
id: E6-T06
epic: 6
title: LR/SC and AMO correctness across parallel hart threads
priority: 606
status: pending
depends_on: [E6-T05]
estimate: L
capstone: false
---

## Goal
The A-extension is correct under true concurrency: AMOs are single wasm atomic RMWs,
LR/SC is emulated with a documented cmpxchg strategy whose deviation window (ABA) is
understood and bounded, and constrained LR/SC loops make forward progress — so every
lock, refcount, and futex in the guest behaves under contention.

## Context
Under E6-T03's single-threaded scheduler, LR/SC could be exact (nothing intervenes within
a quantum). Parallel harts change that. Strategy (QEMU MTTCG precedent): LR records
(addr, loaded value) in the hart's reservation; SC performs `i32/i64.atomic.rmw.cmpxchg`
expecting the recorded value — this admits ABA success (another hart wrote A→B→A between
LR and SC), which real hardware forbids but which is tolerated by realistic code because
Linux and libc build cmpxchg-style primitives from LR/SC anyway. That tolerance must be
*documented*, not silent. Reservations are killed on traps/interrupts and on any other
memory access by the same hart per our policy, keeping the window to a few instructions.
AMOs (amoadd/and/or/xor/swap/min/max, .w/.d, aq/rl) lower directly to seq_cst wasm RMWs;
misaligned AMO/LR/SC raise address-misaligned per spec. Forward progress: the unified
A-extension guarantee for constrained loops (≤16 instructions, no other loads/stores)
must hold — beware live-lock where two harts' SCs perpetually kill each other.

## Deliverables
- `amo.rs` lowering table (op × width → wasm atomic RMW) + alignment trap tests.
- LR/SC implementation with per-hart reservation, invalidation policy, and an "ABA
  deviation" section added to `docs/memory-model.md` with the exact window analysis.
- Forward-progress mechanism (e.g. bounded exponential backoff on SC failure) with a
  two-hart adversarial unit test that live-locks without it.
- Guest torture binaries: pthread mutex/rwlock/condvar hammer, C11 atomics
  fetch-add/cmpxchg counters, a ticket-lock fairness probe — each with self-checking
  invariants (final counter == N*iters etc.).
- Native concurrency test: core crate harts on std::thread, run in CI under TSan.

## Acceptance criteria
- [ ] All torture binaries pass 10-minute runs at smp=4 in the browser and natively;
      counter invariants exact, zero lost updates.
- [ ] `amoadd.d` from 4 harts, 10^7 iterations each, sums exactly; same for amomax/amoswap
      invariant tests across .w/.d.
- [ ] Misaligned amoadd.w at addr%4!=0 traps with cause=6 (store/AMO address misaligned)
      and correct mtval, native and wasm32.
- [ ] The live-lock unit test fails when backoff is disabled and passes with it (proving
      the mechanism is load-bearing).
- [ ] glibc/musl `pthread_mutex` stress under `stress-ng --futex 4` runs 10 min clean.

## Adversarial verification
Write a guest program specifically hunting ABA: hart A does LR on X; harts B and C swap X
between two values millions of times; hart A's SC then stores a sentinel — measure how
often SC succeeds after an intervening write and check the observed rate is consistent
with the documented window (an *undocumented* success path, e.g. SC succeeding after the
same hart trapped, refutes). Contend a single cache line: 4 harts doing amoadd to
adjacent u32s in one 64-byte line, checking neighbor corruption (mixed-size/overlap
bugs). Run the kernel's own `futex` selftests inside the guest. Torture SC pairing: SC
to a *different* address than LR, SC without LR, double SC — all must fail per spec.
Finally re-run the full rv64ua riscv-tests under the parallel engine at smp=4 with the
tests pinned to a secondary hart; any failure refutes.

## Verification log
(empty)
