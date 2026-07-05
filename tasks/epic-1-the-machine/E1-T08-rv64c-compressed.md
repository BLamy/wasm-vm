---
id: E1-T08
epic: 1
title: RV64C compressed instruction decoding — all quadrants, expansion, PC alignment
priority: 108
status: verified
depends_on: [E1-T01]
estimate: M
capstone: false
---

## Goal
Every legal RV64C encoding decodes by expansion to its base RV64I/F/D equivalent and
executes identically to the expanded form; the fetch path handles 16-bit instruction
granularity, IALIGN drops to 16, and misaligned-fetch semantics change accordingly.
Alpine riscv64 userland is compiled RVC — without this, nothing at Level 2+ runs.

## Context
Unprivileged spec "C" chapter, RV64-specific rows (C.ADDIW replaces C.JAL; C.LDSP/C.SDSP/
C.LD/C.SD exist; C.FLW* do not exist in RV64C but C.FLD*/C.FSD* do). Implementation is
expansion-based: `expand(u16) -> Option<u32>` so execution semantics live in one place.
Reserved encodings must trap: C.ADDI4SPN with nzuimm=0 (includes the all-zero
instruction — defined illegal), C.LUI with imm=0 or rd=x2 semantics (rd=x2 is C.ADDI16SP;
C.ADDI16SP with imm=0 reserved), C.LWSP/C.LDSP with rd=x0, C.JR with rs1=x0. With C
enabled, JAL/JALR/branch targets at 2-mod-4 addresses are legal — instruction-address-
misaligned (cause 0) fires only for odd targets, effectively never on taken branches.

## Deliverables
- `expand_c(u16) -> Result<u32, Illegal>` covering quadrants 0, 1, 2 exhaustively for
  RV64, with the rd'/rs' 3-bit register mapping (x8–x15) and all immediate scramblings.
- Fetch path: read 16 bits; if opcode[1:0]!=0b11 expand, else fetch the second parcel
  (the two parcels may cross a page boundary — must be two independent accesses so T16
  can fault the second half precisely); pc advances by 2 or 4.
- misa.C reported; mtvec/stvec, mepc/sepc handling of bit 0 per spec (bit 0 of xepc is
  masked on read).
- Exhaustive-decode test: all 65536 u16 patterns, diffed against a reference decoding.
- rv64uc-p-* passing.

## Acceptance criteria
- [ ] For all 65536 16-bit patterns: our {illegal | expansion} verdict matches a reference
      table generated from Spike's disassembler (or riscv-opcodes) — zero mismatches.
- [ ] The all-zeros 16-bit pattern raises illegal instruction with mtval = 0.
- [ ] C.ADDI16SP, C.ADDI4SPN, C.LUI immediates verified against hand-computed cases
      (sign extension and the nonstandard bit shuffles).
- [ ] A JALR to a 2-mod-4 address executes (no misaligned trap); JALR with target bit 0
      set clears bit 0 per JALR semantics rather than trapping.
- [ ] A 32-bit instruction straddling two pages executes when both are mapped (test with
      the T16 MMU later — for now, straddling two memory regions).
- [ ] rv64uc-p suite passes natively and in wasm32.

## Adversarial verification
Refute the exhaustive-decode claim independently: regenerate the reference table yourself
from riscv-opcodes or Spike (do not trust the checked-in table), diff again. Attack the
expansion equivalence property: for every legal compressed pattern, execute the C form and
its claimed 32-bit expansion from identical initial states and diff full architectural
state — any difference refutes (watch C.JALR: expands to jalr x1, rs1, 0 and must write
pc+2, not pc+4, into x1 — the classic bug). Attack hint encodings (C.NOP with nonzero
imm, C.SLLI64 forms): these are *hints*, must execute as no-ops, not trap. Attack fetch:
place a C instruction in the last halfword of a memory region followed by unmapped space
— executing it must not access the next region. Diff a compressed-heavy Linux-userland
snippet trace against Spike with C enabled.

## Verification log

### 2026-07-03 — worker (implementation claim)
Expansion-based RV64C: `crates/core/src/decode_c.rs::expand_c(u16) -> Result<u32, IllegalInstr>`
maps every legal compressed encoding to its 32-bit base word, which flows through the SAME
`decode`+execute path — so a compressed op is byte-identical to its expansion (the strongest
equivalence guarantee; no separate C execute arms).
- **Fetch path** (`hart/mod.rs::step_traced`): read the low 16-bit parcel; if `[1:0]!=0b11`
  expand (pc len 2), else fetch the upper parcel as a SEPARATE `load16` (a straddling second
  half faults precisely, cause 1 at pc+2) and combine (len 4). `insn_len` (2/4) threaded
  through `execute` — `pc_next = pc + insn_len` (renamed from `pc4`), so sequential ops,
  JAL/JALR links (C.JALR writes **pc+2**), and not-taken branches advance by the true length.
- **IALIGN=16**: misaligned-target checks changed `& 3` → `& 1`; a 2-mod-4 branch/jump target
  is now LEGAL and lands (an odd target can't arise — JALR clears bit 0, JAL/branch imms are
  even), so the cause-0 trap is effectively unreachable. Updated the E0-T09 control-flow tests
  (hart_control.rs, verifier_e0t07/e0t09_angles.rs, wasm hart_ctrl.rs) to the new semantics.
- **mepc** WARL mask `!1` (bit 0 masked, IALIGN=16). misa.C already reported.

Evidence (local):
- **Official riscv-tests rv64uc-p passes** (`riscv_tests_f.rs::rv64uc_p_suite_all_pass`;
  the `rvc` test exercises every quadrant). rv64ui/um/ua/uf/ud all still pass.
- `crates/core/tests/rv64c.rs` (7): expansions match **toolchain ground-truth**
  (c.addi4spn/addi16sp/lui/jalr/lwsp/ld — pins the immediate scrambles); reserved/illegal
  encodings (all-zeros, q0 f3=100, C.LWSP/LDSP rd=0, C.JR rs1=0, C.ADDIW rd=0); the
  **exhaustive 65536-pattern sweep** (never panics, every Ok expansion decodes, legal count =
  **46743** of 49152); C.JALR writes pc+2; compressed advances pc by 2; a straddling 32-bit
  op faults on the second parcel.
- `crates/wasm/tests/rv64c.rs`: expansion + pc+2 identical on wasm32.
- Exhaustive 2^32 (32-bit) sweep unchanged (325,400,581 — decode() still rejects 16-bit space;
  C lives in the fetch path). Gate: fmt clean, clippy 0, workspace + both wasm builds 0 FAILED.

### 2026-07-03 — adversarial verifier (fresh cold clone) — VERDICT: verified
Could not refute after all ten attack classes.
- **rv64uc-p:** `rv64uc-p-rvc` exits 0 under `spike --isa=rv64gc` and passes the harness; no
  regression (rv64ui/um/ua/uf/ud all ok).
- **THE key attack — 65536-pattern independent Spike differential:** dumped `expand_c` for
  all 49152 compressed patterns, independently disassembled every pattern AND every expansion
  through `spike-dasm`, canonicalized both to raw base-op tuples, compared operand-for-operand.
  **All 46743 legal expansions match Spike — 0 mismatches, 0 unparsed.** The critic
  independently derived the legal count: 49152 − unknown(1168) − Zcb/Zcmp(1008) − Zcmop(8) −
  c.unimp(1) − constraint-reserved(224) = **46743**, exactly the committed number. (Our
  rejection of Zcb/Zcmp/Zcmt/Zcmop — which base RV64C reserves — is correct.)
- **Expansion-equivalence:** 8000 random legal patterns executed via `Hart::step` vs their
  32-bit expansions from identical seeded state (all x/f-regs, pc, 64KB RAM) — **0 refutations**;
  the only differences are the legitimate pc/link +2 (compressed) vs +4. **C.JALR link=pc+2**.
- **Hints** (c.addi/slli/li x0, c.nop-with-imm) retire, don't trap. **Fetch path:** last-halfword
  compressed op doesn't touch the next region; unmapped upper parcel → InstrAccessFault at pc+2
  (two `load16`); all-zeros → IllegalInstruction mtval=0. **IALIGN=16**, misa.C set, mepc bit-0
  masked. **Panic hunt:** none. **native/wasm parity** holds.
- **Mutation audit — no survivors (6):** insn_len 2→4, drop ADDI4SPN nzuimm=0, CJ-offset
  scramble, IALIGN &1→&3, ADDI16SP/LUI rd==2→rd==3, two-load16→load32 — each caught by a
  committed test (the CJ scramble by the rv64uc-p suite).
- **Gate** green (fmt/clippy/workspace/exhaustive/wasm both builds). Tree left clean.

VERIFIED — E1-T08 complete. The RV64GC ISA is now fully decoded and executed.
