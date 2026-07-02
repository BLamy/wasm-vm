---
id: E0-T08
epic: 0
title: RV64I loads and stores with misaligned and access-fault trap semantics
priority: 8
status: pending
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
(empty)
