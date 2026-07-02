---
id: E0-T08
epic: 0
title: RV64I loads and stores with misaligned and access-fault trap semantics
priority: 8
status: implemented
depends_on: [E0-T07]
estimate: M
capstone: false
---

## Goal
`Hart::step` executes the full RV64I memory instruction set — LB/LH/LW/LD (sign-extend),
LBU/LHU/LWU (zero-extend), SB/SH/SW/SD — with effective address `rs1 + sext(imm)` in
wrapping two's-complement, mapping `BusFault::Misaligned` to causes 4/6 and
`BusFault::Access` to causes 5/7, with `tval` = the effective address, and with zero
partial side effects on any fault.

## Context
Unprivileged ISA §2.6 and Ch. 5. Policy (locked in E0-T03): misaligned data accesses trap,
matching Spike's default (Spike only emulates misaligned when passed `--misaligned`;
qemu-riscv64 silently supports them — a known differential-harness asymmetry that E0-T20
documents). Trap-on-fault purity is what makes traps precise, which Level 1's `mtval`/
`mepc` machinery and Level 2's Linux depend on.

## Deliverables
- Load/store execution arms in the hart, sharing one effective-address helper
  (`rs1.wrapping_add(imm as u64)`).
- Sign/zero-extension test matrix: each load width against memory bytes `0x80`, `0x7F`,
  `0xFF..` patterns; each store width verified byte-wise through the bus.
- Fault tests: misaligned at each width ⇒ cause 4 (load) / 6 (store); unmapped ⇒ 5/7;
  `tval` equals the computed effective address including wrap-around cases.

## Acceptance criteria
- [ ] `lw` of `0xFFFF_FFFF` yields `0xFFFF_FFFF_FFFF_FFFF`; `lwu` yields `0x0000_0000_FFFF_FFFF`.
- [ ] `ld` at `addr % 8 == 4` traps cause 4 with `tval = addr`; `sd` likewise cause 6.
- [ ] Effective-address wrap: `rs1 = 0xFFFF_FFFF_FFFF_FFF8, imm = +16` traps access fault
      with the *wrapped* address in `tval`, no panic.
- [ ] A faulting load leaves rd untouched; a faulting store leaves all of RAM bit-identical
      (digest compare); PC still points at the faulting instruction.
- [ ] A load with rd == rs1 writes the loaded value (not the address) — explicit test.
- [ ] Matrix passes natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Write a 30-instruction bare-metal blob mixing all widths/sign modes and diff the full
register file after N steps against Spike running the same blob — any register mismatch
refutes. (2) Attack purity harder: seed rd with a sentinel, fault the load, and also check
the *trace* (once E0-T16 lands) emits no retire record for the faulting instruction.
(3) Negative-offset attack: `rs1 = DRAM_BASE, imm = -1` must access-fault, not read the
last byte of a device window or wrap into RAM. (4) Boundary sweep: loads of every width at
`ram_end - width` (must succeed) and `ram_end - width + 1` (must fault). (5) Confirm
misaligned-policy documentation exists and matches behavior — undocumented divergence from
Spike's default refutes.

## Verification log

### 2026-07-02 — worker claim — commit 917e7fa (branch task/e0-t08-loads-stores, stacked on e0-t07)
Deliverables: load/store arms in Hart::execute (bus now threaded through execute) —
LB/LH/LW/LD sign-extend, LBU/LHU/LWU zero-extend, SB/SH/SW/SD; ONE effective-address
helper `ea(base, imm) = base.wrapping_add(imm as u64)` shared by all 11 arms; bus-fault
mapping via load_fault/store_fault helpers (Misaligned→4/6, Access→5/7, tval = effective
address incl. wrapped); every fault path returns via `?` BEFORE writeback → rd (even when
rd==rs1), RAM, and PC untouched. Misaligned-data policy documented in the module scope
ledger with the Spike-default vs qemu asymmetry noted for E0-T20 (angle 5 satisfied).
Tests (tests/hart_memory.rs, 11): acceptance anchors (lw sext / lwu zext of 0xFFFF_FFFF;
ld/sd at addr%8==4 → causes 4/6 tval=addr; wrap rs1=0xFFFF_FFFF_FFFF_FFF8 imm=+16 →
Access with WRAPPED tval=0x8; faulting load leaves rd sentinel + full-RAM digest compare
across 3 fault shapes; rd==rs1 load yields the VALUE); extension matrix over bytes
0x80/0x7F/0xFF at every width; store widths verified byte-wise incl. no-write-past-width;
misaligned at every width both directions; negative-offset DRAM_BASE-1 (angle 3, proactive);
boundary sweep last-slot-succeeds/one-past-faults at every width (angle 4, proactive);
pc-unmoved battery; instruction-level store→load roundtrip. 2 wasm32 mirrors (extension,
faults+purity+wrap on 32-bit usize host).
SUITE EVOLUTION (flagged for the verifier): lb/sb left the E0-T07 placeholder lists in
hart_semantics.rs; verifier_e0t07_angles.rs (critic-authored) updated — its two lb/sd
placeholder entries became load/store access-fault entries with sentinel-address tval
asserts (X2_SENTINEL const documents the formula); the purity property is preserved and
now covers the REAL memory fault paths. Edit is marked in-file; audit requested.
Gates: fmt / clippy -D warnings exit 0 / 98 native + 21 wasm tests green / no_std wasm32
build / CI green run 28624358764.
rr: SKIPPED locally (macOS/no PMU); deterministic+wasm+CI layers; Spike differential is
angle 1 for the verifier (spec-first substitute precedent from E0-T07).
