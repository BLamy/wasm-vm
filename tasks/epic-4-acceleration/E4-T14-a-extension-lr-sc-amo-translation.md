---
id: E4-T14
epic: 4
title: A extension in translated code — LR/SC reservations and AMOs
priority: 414
status: pending
depends_on: [E4-T12]
estimate: M
capstone: false
---

## Goal
Atomics run in the JIT tier: AMOs (amoswap/add/xor/and/or/min/max[u], .w/.d) execute as
inline load-op-store sequences using wasm atomic RMW ops on the shared linear memory, and
LR/SC implements the reservation-set protocol against the same `(addr, valid)` reservation
state the interpreter uses — correct today on one hart, and deliberately built on wasm
atomics so the E4-T22 worker move and future SMP don't force retranslation semantics.

## Context
Linux userspace is atomics-dense (futexes, pthread mutexes, refcounts); leaving A-extension
blocks to the interpreter caps real-workload speedup. Design choices per E4-T06: AMO
fastpath requires a write-TLB hit (device/SMC pages fall to the slow-path helper, which
also handles the address-misaligned trap — AMOs trap on misalignment, no exception);
LR sets the reservation (address, tagged valid) in CPU state; SC checks reservation
validity + address match, writes 0/1 to rd per success, and *any* SC clears the
reservation. Stores from the same hart between LR and SC invalidate per our documented
(spec-legal, conservative) policy — the invalidation hook lives in the store slow/fast
path and must fire identically from interpreter and JIT. aq/rl orderings map onto wasm
atomics' sequential consistency (stronger is legal). Emitter support for 0xFE-prefixed
atomic opcodes landed in E4-T07.

## Deliverables
- Translator: all .w/.d AMOs inline (wasm `i32/i64.atomic.rmw.*`; min/max via cmpxchg loop
  or load-compare-store under single-hart guarantee — decision recorded), LR/SC inline with
  reservation state in the shared CPU-state block.
- Misalignment: AMO/LR/SC address checks → precise trap side-exit (cause 6/7 store/AMO
  misaligned/access distinctions per spec).
- SC failure paths: mismatched address, cleared reservation, intervening store — all
  return 1 in rd and perform no store.
- Differential rig: randomized LR/SC/AMO sequences interleaved with plain stores, JIT vs
  interpreter, comparing memory + registers + reservation state.
- In-guest validation: pthread mutex/futex stress (`sysbench threads` or a bundled
  pthread ping-pong) run under JIT.

## Acceptance criteria
- [ ] rv64ua suite green with JIT forced on (native + browser runtime).
- [ ] Directed tests: SC after reservation-clearing store fails; SC to wrong address
      fails; back-to-back LR/LR/SC honors the *latest* reservation; AMO to MMIO page takes
      the slow path (device counter increments).
- [ ] Misaligned `amoadd.w` at addr%4≠0 traps with correct mcause/mtval under JIT,
      matching interpreter exactly.
- [ ] 1-hour Alpine soak running a futex-heavy workload under JIT: no hangs, no lockups,
      dmesg clean.

## Adversarial verification
Refute atomicity bookkeeping. Attack angles: (1) craft an LR/SC loop where the *SC itself*
is the first instruction of a new block after an interrupt-budget side-exit — the
reservation must survive a dispatch-loop round trip but be cleared by trap entry per our
documented policy; test both, divergence from interpreter refutes; (2) SMC interaction:
patch the code page containing an LR/SC loop mid-loop and verify invalidation doesn't
corrupt reservation state; (3) run the randomized rig with sequences that alias the
reservation address at different widths (LR.W then SC.D at overlapping addr); (4) guest
torture: `stress-ng --futex 4 --timeout 120` plus a kernel build snippet — any hang,
non-progressing futex wait, or glibc/musl assertion refutes; (5) verify wasm atomic
encodings execute in Chrome AND Firefox on a SharedArrayBuffer-backed memory (forward
compatibility claim for E4-T22).

## Verification log
(empty)
