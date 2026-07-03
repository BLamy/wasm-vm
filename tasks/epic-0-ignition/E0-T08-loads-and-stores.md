---
id: E0-T08
epic: 0
title: RV64I loads and stores with misaligned and access-fault trap semantics
priority: 8
status: verified
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

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: refuted
- P1 program differential vs spec-first model — HELD. 41-instruction program (all 11 memory ops, negative load AND store offsets, rd==rs1 chains, deps through loaded values): full regfile + 48-byte data window + final pc exact match vs independent Python RV64I model.
- P2 suite-edit audit (verifier_e0t07_angles.rs) — HELD. Edit minimal (X2_SENTINEL const + comments + the two lb/sd entries); X2_SENTINEL hand-verified = seeded x2 = 0x5EAF_02D7_0202_0202, unmapped, causes 5/7 + tval=ea spec-correct; purity loop untouched — no weakening. APPROVED.
- P3 negative offset — HELD. rs1=DRAM_BASE imm=-1 → cause 5 tval=0x7FFF_FFFF at four shapes; with a RecordingDevice at [DRAM_BASE-0x100, DRAM_BASE), straddling ld/sd at DRAM_BASE-1 faults 5/7 with the device NEVER invoked.
- P4 boundary sweep, verifier bases — HELD. Last slot from rs1=last-w imm=+w succeeds; ea=last+1 from ABOVE (rs1=RAM_END, negative imm) faults with tval=last+1, every width, both directions.
- P5 fault purity full-dump — HELD. 18 fault shapes, 31 sentinels, full dump + whole-RAM compare bit-identical. Device write Err propagates as cause 7 tval=ea, pure, exactly one invocation; device loads mask-to-width then extend correctly through the hart.
- P6 wrap acceptance — HELD. Wrapped tval=0x8, no panic, native and wasm.
- rr — SKIPPED loud (macOS/no PMU). Mitigation: cold-clone suite + spec-first model + miri (11/11 hart_memory) + wasm + CI.
- COVERAGE: 6 mutations, 5 killed, 1 SURVIVED: successful sb writing (rd=3, 0xBAD) through the retire path stays green across all 98 committed tests — store tests check memory via fresh harts and never re-read registers; purity suites only cover faults. DEMAND: successful-store register-purity test, or adopt promoted verifier_e0t08_diff.rs (kills the class via final full-regfile compare).
- MOCK/HONESTY: clean — counts exact (98 native / 21 wasm), CI 28624358764 success at 917e7fa, claim commit tasks-only, no self-licking goldens (model recomputed every expected value).
- NOVEL: device-through-hart — faulting device write pure + single invocation; successful sw passes exact (offset,width,value); device returning stray high bits cannot corrupt lb/lbu/lw (masking + extension verified through the hart). All held.
- SUITE: promote verifier_e0t08_diff.rs + model.py + verifier_e0t08_attacks.rs; rework hart_memory.rs (the demanded test); approve the verifier_e0t07_angles edit as committed.

### 2026-07-02 — rework after refutation (worker)
Applied all demands: (1) promoted verifier_e0t08_diff.rs + verifier_e0t08_attacks.rs
verbatim and model.py as tests/data/model_e0t08.py (generator provenance);
(2) added hart_memory::successful_store_leaves_all_registers_untouched — every store
width, 31 sentinels, full-dump compare + pc==CODE+4; (3) re-ran the exact surviving
mutant (successful sb → (3, 0xBAD)): KILLED, reverted, hart/mod.rs clean. Gates:
clippy exit 0, 16 native suites green. Status implemented; re-verification requested.

### 2026-07-02 — adversarial verifier (re-verification) — VERDICT: verified
- (a) Original survivor (successful sb → retire (3, 0xBAD)) re-applied at 066eb10 — RED: killed by hart_memory::successful_store_leaves_all_registers_untouched AND verifier_e0t08_diff::program_differential_vs_spec_model.
- (b) Same mutant on Sh/Sw/Sd — all RED, same two killers each time; each reverted cleanly.
- (c) Novel retire-path mutant: successful lw additionally writes x5=0xDEAD — RED, killed by the promoted spec-first differential's final full-regfile compare.
- (d) Promoted suites semantically verbatim (rustfmt reflow only); model_e0t08.py byte-identical; demanded test faithful (4 widths, 31 sentinels, full-dump, pc+4 exact).
- (e) Full suite in fresh clone of 066eb10, scrubbed env: 106 passed / 0 failed.
Commands: fresh clone at 066eb10; suite diffs; cargo test --workspace --no-fail-fast (baseline + 5 mutants, reverted each); promoted suites standalone.
