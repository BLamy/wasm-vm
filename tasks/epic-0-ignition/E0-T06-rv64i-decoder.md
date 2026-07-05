---
id: E0-T06
epic: 0
title: RV64I instruction decoder covering all six base encoding formats
priority: 6
status: verified
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

### 2026-07-02 — worker claim — commit 29dbd40 (branch task/e0-t06-rv64i-decoder, stacked on e0-t05)
Deliverables: crates/core/src/decode.rs — const fn decode(u32) -> Result<Instr,
IllegalInstr>, 52 mnemonics across all six formats (log corrected per verifier: initial claim undercounted at 47), immediates sign-extended to i64 at
decode (I/S/B/U/J extractors documented against spec bit layouts). Level-0 policy in
module doc: compressed space illegal; FENCE decodes for ALL fm/pred/succ (incl.
fence.tso, fm=8) but FENCE.I illegal; SYSTEM exact-word ECALL/EBREAK only; M-ext/CSR/
privileged illegal; RV64 shamt6 for SLLI/SRLI/SRAI (top6 selects), shamt5 W-forms with
insn[25]=1 illegal per spec.
GOLDEN TABLE PROVENANCE (anti-self-licking, per the E0-T05 lesson): all 70 positive
words produced by clang -target riscv64-unknown-elf -march=rv64i -mno-relax +
llvm-objdump -d -M no-aliases (alpine docker); branch/JAL immediates are REAL label
distances; B/J range extremes (+4094/-4096, +1048574/-1048576) constructed via
.skip-separated labels so the assembler emitted the boundary words itself (they matched
my independent hand-computations exactly). Source: scratchpad/golden.s + golden.dump;
command line recorded in the test header for reproduction.
Tests: golden_table_decodes_exactly (70, >= 60 required), negative_table (30, >= 20),
compressed_space sweep (300k), sweep_never_panics (1M random + 65k strided full-range,
miri-reduced via SWEEP const), const-context evaluation. 3 wasm32 mirrors (13-entry
subset incl. edges, negatives, 200k sweep). miri clean on the suite (1.4s reduced).
Gates: fmt / clippy -D warnings exit 0 (captured directly) / native green / no_std
wasm32 / wasm-pack test --node (5 suites) / CI green run 28604047843.
Follow-up per angle 1: objdump cross-decode of the E0-T14 hello ELF recorded for
E0-T14/E0-T20 (binary does not exist yet).
rr: SKIPPED locally (macOS/no PMU per AGENTS.md); deterministic+miri+wasm+CI layers.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 golden-table provenance — HELD. Claimed clang/llvm-objdump pipeline reproduced golden.dump byte-identically; all 70 test pairs machine-checked against the dump (mnemonics, ABI→number mapping, immediates, branch/JAL offsets recomputed from dump addresses). Label-distance extremes verified: beq 0x10c→0x110a = +4094, jal 0x202114→0x102114 = −1048576.
- P2 verifier's own golden table — HELD. 87/87 pass (verifier.s: all 52 mnemonics, lui 0x80000→−2^31, jalr −2048, five branches with imm[11] set incl. +2048 exact, slli shamt 31/32/33, x0-saturated operands, B/J extremes on nonzero regs; expected fields derived from objdump operand text only). Extreme words recomputed by hand from spec formulas — all match assembler and decode.
- P3 differential disassembler fuzz (3000 words, seed 0x5EEDC917) — HELD. 0 words LLVM calls base-RV64I that decode rejects, 0 mnemonic mismatches, 0 decode-accepts of LLVM-valid non-Level-0 (77 csr* all rejected). Sole asymmetry: 12 FENCE words with exotic fm/rd/rs1 decode accepts but LLVM won't print — root-caused to spec §2.7 forward-compat ("base implementations shall ignore these fields") and the module's documented policy; disassembler conservatism, not a bug.
- P4 task angles 2/3/4/5 — HELD. Scramble extremes exact; insn[7]-flip drops imm bit 11 as predicted; full-range stride (phase 7) + 1M random (verifier seed) no panics; fence w,r / i,o / iorw,w / tso exact fields; FENCE.I words 0x0000100f AND 0xffff100f illegal; addi x1,x0,-1 → imm == −1i64.
- Angle 1 hello-ELF cross-decode — SKIPPED loud: E0-T14 pending, binary doesn't exist; mitigated by the 3000-word differential (superset attack); re-run at E0-T14/E0-T20.
- rr — SKIPPED loud: macOS/no PMU; mitigated by deterministic suite + miri + wasm + CI; decode is a pure const fn with no concurrency to interrogate.
- COVERAGE: 5/5 mutations killed by the worker's own suite — B imm[11]←insn[8] (golden red at 0xfe419ee3); BLT/BGE swap (red at 0xfe62cce3); FENCE.I allowed (negative red); OP M-leak (negative red); imm_i zero-extend (golden red at 0xffc102e7). No surviving mutant.
- MOCK/HONESTY: provenance authentic — no self-licking, table words from a reproducible external assembler. Claim numbers all check (70/30/const/miri-1.41s/CI 28604047843 at 29dbd40 with decode tests in logs); ONE discrepancy: "47 mnemonics" is actually 52 — harmless undercount, log corrected.
- NOVEL: per-word llvm-mc --disassemble differential, invented after discovering two disassembler artifacts a naive stream differential would misreport ($d mapping symbols; long-encoding low-byte desync). Exotic-fm FENCE probe root-caused to policy. No decoder finding from any novel attack.
- SUITE: promote verifier_golden.rs (87-entry independent table, all 52 mnemonics) + verifier_angles.rs (angles 2–5 with verifier inputs) + fuzz_words.txt as E0-T21 corpus seeds. Discard examples/vfuzz.rs (harness hack).
Commands: docker alpine clang/llvm re-dump + diff; check_table.py/gen_table.py; cold-clone cargo test ×2 rounds; 5 mutations (all red, reverted); llvm-mc --disassemble ×3000; wasm-pack test --node; miri decode_golden (1.41s); gh run view 28604047843 + job logs.

### 2026-07-02 — post-verdict actions (worker)
Promoted verifier_e0t06_golden.rs (87 entries) + verifier_e0t06_angles.rs verbatim;
fuzz corpus seeds committed to tests/data/decode_fuzz_corpus_e0t06.txt for E0-T21.
Mnemonic count corrected 47→52 in the claim. Gates re-earned: fmt/clippy exit 0/
promoted suites green (4+1 tests).
