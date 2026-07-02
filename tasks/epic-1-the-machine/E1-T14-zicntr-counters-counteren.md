---
id: E1-T14
epic: 1
title: Zicntr counters — cycle/instret/time and mcounteren/scounteren delegation
priority: 114
status: pending
depends_on: [E1-T09, E1-T12]
estimate: S
capstone: false
---

## Goal
The unprivileged Zicntr counters — cycle (0xC00), time (0xC01), instret (0xC02) — exposed
read-only with the M-mode backing registers mcycle/minstret (0xB00/0xB02) writable, and
access from S/U gated by mcounteren/scounteren exactly per spec, so `rdtime`-based delays
in OpenSBI/Linux and vDSO clock reads behave.

## Context
Unprivileged spec "Zicntr" chapter; privileged spec §3.1.10 (mcounteren), §4.1.5
(scounteren). RV64: no *h high-half CSRs. Gating rule: an S-mode read of cycle/time/
instret traps illegal-instruction unless the corresponding mcounteren bit (CY=0, TM=1,
IR=2) is set; a U-mode read requires the bit set in *both* mcounteren and scounteren.
time is a read-only window onto CLINT mtime (T12) — there is no mtime CSR; M-mode reads
of time also work (mcounteren does not gate M). cycle/instret tick from the retire loop;
since the interpreter is one-instruction-per-step, cycle may equal instret — document
this (legal; no IPC claims). Writes to 0xC00–0xC02 are always illegal (read-only user
counters, T02 already enforces the address-encoding rule).

## Deliverables
- mcycle/minstret as writable 64-bit M-CSRs incremented per retire (increment order
  documented: CSR reads observe the count *before* the reading instruction retires,
  matching Spike).
- cycle/instret as read-only shadows; time reading CLINT mtime through the bus.
- mcounteren/scounteren with WARL masks exposing only CY/TM/IR bits (upper HPM bits
  read-only zero until hardware performance monitors exist).
- Trap tests for all {mode ∈ S,U} × {counter} × {mcounteren, scounteren} combinations
  (12 gate states asserted).

## Acceptance criteria
- [ ] `rdcycle` twice in a row in M-mode yields strictly increasing values differing by
      the retire distance; `rdinstret` delta across a counted 100-instruction block is
      exactly 100 (trap-free block).
- [ ] Writing minstret from M-mode takes effect and instret shadows it.
- [ ] S-mode `rdtime` with mcounteren.TM=0 → illegal instruction (mcause=2, mtval = the
      rdtime encoding); with TM=1 it returns CLINT mtime.
- [ ] U-mode `rdcycle` with mcounteren.CY=1 but scounteren.CY=0 → illegal instruction;
      with both set it succeeds.
- [ ] mcounteren/scounteren all-ones write reads back with only bits [2:0] set.
- [ ] time advances in lockstep with mtime under the T12 deterministic clock (equal
      values when read back-to-back through both paths).

## Adversarial verification
Diff every gate combination against Spike with identical misa and counteren settings —
Spike is authoritative on which accesses trap; a single mismatched trap/no-trap cell in
the 12-state matrix refutes. Attack the shadow relationship: write mcycle to u64::MAX-2,
retire a few instructions, and check wraparound in both mcycle and cycle; write mtime via
the CLINT and confirm time follows instantly (no cached copy). Attack increment
positioning: `csrr x1, minstret; csrr x2, minstret` — x2-x1 must match Spike exactly (off-
by-one in retire-count placement is the classic divergence, and RISCOF's counter tests
will catch it later — catch it now). Attack WARL: attempt to set HPM enable bits 3..31
and verify read-back zero, then confirm the corresponding hpmcounter CSR reads still trap
from S/U regardless. Native vs wasm32: identical counter values at every checkpoint of a
10k-instruction deterministic run.

## Verification log
(empty)
