---
id: E0-T06
epic: 0
title: RV64I instruction decoder covering all six base encoding formats
priority: 6
status: pending
depends_on: [E0-T01]
estimate: L
capstone: false
---

## Goal
A pure function `decode(insn: u32) -> Result<Instr, IllegalInstr>` in `wasm-vm-core` that
classifies every RV64I instruction into a typed `Instr` enum with fields extracted
(rd/rs1/rs2, sign-extended immediates) for all six formats R/I/S/B/U/J — no execution,
no state, fully table-testable.

## Context
Unprivileged ISA (20191213) §2.2 (base formats), §2.3 (immediate encoding variants —
note the B-type bit scramble `imm[12|10:5|4:1|11]` and J-type `imm[20|10:1|11|19:12]`),
Ch. 5 (RV64I: `LWU/LD/SD`, `*W` ops, 6-bit shamt), Ch. 24 Table 24.1 (opcode map).
Instructions with `insn[1:0] != 0b11` are compressed-space and must decode as illegal
(no C extension at Level 0). This decoder is the target of the property/fuzz scaffold
(E0-T21) and the semantic core consumed by E0-T07..T09.

## Deliverables
- `crates/core/src/decode.rs`: `Instr` enum covering LUI, AUIPC, JAL, JALR, BEQ..BGEU,
  LB/LH/LW/LD/LBU/LHU/LWU, SB/SH/SW/SD, ADDI/SLTI/SLTIU/XORI/ORI/ANDI, SLLI/SRLI/SRAI
  (shamt[5:0]), ADD..AND, ADDIW/SLLIW/SRLIW/SRAIW (shamt[4:0], `imm[5]=1` ⇒ illegal),
  ADDW/SUBW/SLLW/SRLW/SRAW, FENCE (fields preserved), ECALL, EBREAK.
- All immediates sign-extended to `i64` at decode time; funct7/funct3 fully matched —
  unassigned combinations (e.g. `funct7=0x20` on ADDI-space, garbage on OP) ⇒ `IllegalInstr`.
- Golden decode table test: ≥60 instruction words hand-assembled or lifted from
  `riscv64-unknown-elf-objdump -d` output, asserting exact field values; negative table
  of ≥20 reserved/garbage encodings. Wasm mirror test on a subset.

## Acceptance criteria
- [ ] Every listed mnemonic decodes with correct rd/rs1/rs2/imm on the golden table,
      including max-negative B/J immediates and `imm[11]` placement (B-type: `insn[7]`).
- [ ] `0x0000_0000` and `0xFFFF_FFFF` decode as illegal; any `insn[1:0] != 0b11` is illegal.
- [ ] `SRAI` (funct7 bit 30 set, shamt up to 63) and `SRAIW` (shamt ≤ 31) decode; `SLLIW`
      with `insn[25]=1` is illegal.
- [ ] `decode` is `const`-friendly / allocation-free and never panics (asserted by test
      sweeping 1M random words).
- [ ] Tests pass natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Cross-decode a real binary: objdump the E0-T14 hello ELF, parse the mnemonic column,
and compare instruction-by-instruction against `decode` output — any classification
mismatch refutes. (2) Hit the scramble bits: craft branches with offsets ±4096 (B-type
range edges) and JAL ±1 MiB edges; off-by-one in bit 11/20 placement refutes. (3) Feed
every word in `{0..=u32::MAX}` step 0x10001 (or run the E0-T21 exhaustive sweep early) —
any panic refutes. (4) Check hint-space policy consistency: `FENCE` with nonzero fm/pred
/succ must decode (they are valid), while `FENCE.I` (Zifencei, funct3=001) must be illegal
at Level 0 — confirm both. (5) Verify sign extension by decoding `addi x1, x0, -1` ⇒
imm == -1i64, not 4095.

## Verification log
(empty)
