---
id: E4-T12
epic: 4
title: Trap side-exits with precise state and the CSR/system-instruction policy
priority: 412
status: pending
depends_on: [E4-T11]
estimate: L
capstone: false
---

## Goal
Any exception raised inside translated code — page fault, misaligned fetch target, illegal
instruction, ecall/ebreak — side-exits to the interpreter with *precise* architectural
state: the faulting instruction's PC, fully written-back registers as of that instruction,
and correct mcause/mtval/mepc produced by the existing (trusted) interpreter trap machinery.
CSR and privileged instructions follow the E4-T06 policy: they terminate blocks and execute
via interpreter call-out — never inlined in v1.

## Context
This is where JITs rot: an exit taken with half-written-back locals or a stale PC produces
heisenbugs that only appear under load. Strategy per design doc: before every potentially
trapping operation (memory slow-path call-out, ecall/ebreak) generated code materializes
the current guest PC into the state block and writes back all dirty locals; the call-out
returns a fault sentinel; generated code returns `Exit::Trap` immediately, and the
dispatch loop re-raises the trap through interpreter code paths so CSR side effects
(mstatus stack, mtval encoding, medeleg routing) have exactly one implementation. WFI,
MRET/SRET, and every Zicsr op are block terminators executed by the interpreter. The cost
of eager materialization is measured; PC-map-based lazy reconstruction is a recorded
possible follow-up, not scope.

## Deliverables
- Translator: PC materialization + dirty-register writeback before every trapping point;
  fault-sentinel checks after each slow-path call; `Exit::Trap` plumbing.
- Dispatch loop: on `Exit::Trap`, invoke the interpreter's `raise_exception` with the
  fault details recorded by the slow path (cause, tval) — no duplicate trap logic.
- Block-terminator handling for ecall/ebreak/xret/wfi/csr* via single-instruction
  interpreter execution, then normal re-dispatch.
- Directed test suite: page fault on load/store/fetch at every position in a block (first,
  middle, last instruction); ecall from U/S/M; illegal CSR access; interrupt arriving at a
  block boundary vs mid-block-budget-expiry.
- Measured cost of eager materialization on CoreMark (should be small: few trapping points
  per block) recorded in the ledger notes.

## Acceptance criteria
- [ ] rv64mi + rv64si suites green with JIT forced on (native wasmtime path).
- [ ] For a store faulting as instruction k of an n-instruction block: mepc = that store's
      PC, mtval = the faulting vaddr, and registers x1–x31 reflect instructions 0..k−1
      exactly (asserted against interpreter lockstep on directed tests).
- [ ] Linux boots to login with JIT on; `/proc/cpuinfo` read, a segfaulting userspace
      program is killed with SIGSEGV (not a machine wedge), and `strace true` works
      (ecall-heavy path).
- [ ] No CSR instruction is ever executed by generated code (assert via translator audit
      test enumerating emitted call-outs per opcode class).

## Adversarial verification
Refute precision. Attack angles: (1) lockstep-diff a trap storm: run a guest that takes
10k page faults (demand paging loop) under JIT and interpreter, comparing mepc/mcause/
mtval/mstatus and full register file at every trap entry — any single-field divergence
refutes; (2) craft a block where the faulting store's *base register was overwritten
earlier in the same block* — mtval must reflect the address computed from the old value's
dataflow, and registers must show the overwrite (catches writeback-ordering bugs);
(3) deliver an external interrupt while a block is mid-execution and verify sepc lands on
a block-boundary/instruction boundary consistent with the budget rules — an interrupt
"taken" at a PC the guest never architecturally reached is a refutation; (4) run the
E4-T25-style register-file comparison on `stress-ng --fault` inside Alpine for 60 s.

## Verification log
(empty)
