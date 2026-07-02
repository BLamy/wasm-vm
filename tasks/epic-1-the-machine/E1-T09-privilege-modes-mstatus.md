---
id: E1-T09
epic: 1
title: M/S/U privilege modes and the mstatus state machine
priority: 109
status: pending
depends_on: [E1-T02]
estimate: L
capstone: false
---

## Goal
Three privilege modes with the complete mstatus/sstatus state machine: trap-entry and
xRET stack manipulation (MPP/SPP, MPIE/SPIE, MIE/SIE), the memory-behavior modifiers
(MPRV, SUM, MXR), the virtualization/trap knobs (TVM, TW, TSR), FS/SD tracking from T06,
and sstatus as a masked view of mstatus — the skeleton Linux and OpenSBI stand on.

## Context
Privileged spec §3.1.6 (mstatus), §3.3.2 (xRET), §4.1.1 (sstatus). The exact shuffles:
trap to M ⇒ MPIE←MIE, MIE←0, MPP←y (prior mode); MRET ⇒ MIE←MPIE, MPIE←1, mode←MPP,
MPP←U (lowest supported), and MPRV←0 if the new mode != M. Trap to S ⇒ SPIE←SIE, SIE←0,
SPP←(0 if from U, 1 if from S); SRET mirrors. MPP is WARL 2-bit (M/S/U — 0b10 must not
be storable); SPP is 1-bit. TSR=1 makes SRET in S-mode illegal; TW=1 makes WFI in S/U
trap (after a zero timeout for us); TVM=1 makes satp access and SFENCE.VMA in S-mode
illegal. sstatus exposes only SPP/SIE/SPIE/SUM/MXR/FS/SD (+UXL read-only 2); writes
through sstatus must not touch M-level bits. UXL/SXL are read-only 0b10 (64-bit).

## Deliverables
- `PrivMode` enum on the hart; mode changes *only* via trap entry and MRET/SRET.
- mstatus with per-field WARL legalization (MPP rejects 0b10 → document chosen legal
  value); SD (bit 63) computed read-only from FS (and future VS/XS).
- MRET/SRET execution incl. privilege checks (MRET below M illegal; SRET below S illegal;
  SRET in S with TSR=1 illegal); WFI privilege/TW checks (executes as NOP-until-interrupt
  placeholder until T11 wires wakeups).
- sstatus/sie/sip read/write masking as views over mstatus/mie/mip (single storage).
- Tests: full trap/return round-trips M→M, S→M, U→M, U→S(deleg placeholder), with
  before/after mstatus snapshots asserted bit-exactly.

## Acceptance criteria
- [ ] `csrw mstatus` attempting MPP=0b10 reads back a legal mode (documented; matches
      what Spike does with the same misa).
- [ ] MRET from M with MPP=U lands in U-mode with MIE restored from MPIE, MPIE=1, MPP=U,
      and MPRV cleared; subsequent CSR access to any M-CSR from U traps.
- [ ] SRET in S-mode with mstatus.TSR=1 raises illegal instruction (mcause=2).
- [ ] Writing sstatus with all-ones changes only SPP/SIE/SPIE/SUM/MXR/FS in mstatus.
- [ ] ECALL from U/S/M produces mcause 8/9/11 respectively (wired fully in T10 — here
      at minimum the mode plumbing delivers the right cause).
- [ ] All above identical native and wasm32.

## Adversarial verification
Diff the entire mstatus lifecycle against Spike: script a bare-metal binary that walks
M→U (mret), traps back via ecall, M→S, S→U, S-trap, sret, dumping mstatus/sstatus after
every transition to the signature region; byte-diff vs Spike. Attack WARL edges: write
every 2-bit MPP value, all-ones to mstatus, all-ones to sstatus, and diff readbacks vs
Spike. Attack TSR/TW/TVM one at a time from S and U modes (TW in U must trap WFI even
with TW=0? — no: check spec §3.1.6.5 carefully; WFI in U-mode legality depends on
implementation of S — verify our choice matches Spike and is documented). Attack MPRV:
set MPRV with MPP=U in M-mode, do a load — once T16 lands this must translate as U;
pre-MMU it must at least honor PMP (T15) — record the documented interim behavior and
refute if implementation contradicts documentation. Attempt to reach a privilege mode
by any path other than trap/xRET (e.g. CSR write) — success refutes.

## Verification log
(empty)
