---
id: E0-T07
epic: 0
title: Hart fetch-decode-execute step loop, trap enum, and RV64I computational instructions
priority: 7
status: in-progress
depends_on: [E0-T03, E0-T05, E0-T06]
estimate: L
capstone: false
---

## Goal
A `Hart` with `step(&mut self, bus: &mut impl Bus) -> Result<(), Trap>` that fetches at
PC, decodes, and executes all RV64I computational instructions (LUI, AUIPC, OP-IMM,
OP-IMM-32, OP, OP-32) with bit-exact semantics, reporting failures through a `Trap` type
whose cause codes mirror the privileged spec's `mcause` encodings.

## Context
Privileged ISA (20211203) Table 3.6 supplies the cause numbering we adopt now so Level 1
can graft CSR-based trap delivery without renumbering: 0 instruction address misaligned,
1 instruction access fault, 2 illegal instruction, 3 breakpoint, 4/6 load/store address
misaligned, 5/7 load/store access fault, 8/11 ECALL. Level 0 semantics: a trap *returns*
from `step` with PC still pointing at the faulting instruction and no other architectural
state modified; the host decides what happens next. RV64 subtleties live here: `*W` ops
compute in 32 bits then sign-extend (Unprivileged ISA Ch. 5); shift amounts come from the
low 6 bits (5 for `*W`) of rs2/imm.

## Deliverables
- `crates/core/src/hart/mod.rs`: `Hart { regs: XRegs, pc: u64 }`, `Trap { cause: Exception,
  tval: u64 }`, `Exception` enum with the numeric codes above, `step()` with fetch
  (4-byte `load32`; bus `Access` ⇒ cause 1 with `tval = pc`) and execute for all
  computational ops; PC advances by 4 on retirement.
- Semantic unit-test matrix: for each op, edge vectors (0, 1, -1, `i64::MIN`,
  `0x7FFF_FFFF`, `0x8000_0000`, sign-boundary `*W` cases like `addiw` on `0x7FFF_FFFF`).
- Illegal instruction ⇒ cause 2, `tval` = raw 32-bit instruction word.

## Acceptance criteria
- [ ] `addiw x1, x2, 1` with `x2 = 0x7FFF_FFFF` yields `0xFFFF_FFFF_8000_0000`.
- [ ] `sll` uses only `rs2[5:0]`; `sllw` only `rs2[4:0]`; `sra`/`sraw` are arithmetic
      (verified on negative values); `sltu x1, x0, x2` implements `snez`.
- [ ] Fetch from unmapped PC returns cause 1 with `tval = pc` and mutates nothing
      (register/PC snapshot identical before and after).
- [ ] After any trap, PC equals the faulting instruction's address.
- [ ] Writes with rd = x0 are discarded for every computational op (parameterized test).
- [ ] Full matrix passes natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Differential spot-check ahead of the harness: hand-run 20 mixed computational
instructions and compare each rd result against Spike (`spike -d` interactive or a
throwaway test binary) — any mismatch refutes. (2) Attack sign-extension: `srliw` on a
value with bit 31 set (result must still sign-extend the 32-bit *result*), `subw`
producing `0x8000_0000` (must read back negative). (3) Attack trap purity: make `step`
fail mid-instruction (fetch fault) after seeding all registers with sentinels; any changed
sentinel refutes. (4) Attack shamt masking: `sll` with `rs2 = 0xFFFF_FFFF_FFFF_FFC1`
must shift by 1 (low 6 bits = 0b000001), and `sllw` with `rs2 = 0x2F` must shift by 15
(low 5 bits), per Unprivileged ISA Ch. 5. (5) Run the same matrix on
wasm32 and diff outputs numerically against native — any divergence refutes determinism.

## Verification log
(empty)
