---
id: E1-T03
epic: 1
title: RV64M multiply/divide with exact div-by-zero and overflow semantics
priority: 103
status: pending
depends_on: [E1-T01]
estimate: M
capstone: false
---

## Goal
All thirteen M-extension instructions (MUL, MULH, MULHSU, MULHU, DIV, DIVU, REM, REMU,
MULW, DIVW, DIVUW, REMW, REMUW) execute with bit-exact results including the spec's
non-trapping division edge cases, so rv64um passes and the shifts into Linux's libgcc
soft-div paths never arise.

## Context
Unprivileged spec, "M" extension chapter. The trap-free edge semantics are mandatory:
divide by zero yields quotient all-ones (DIV → -1, DIVU → 2^64-1) and remainder = the
dividend; signed overflow (i64::MIN / -1, i32::MIN / -1 for the W forms) yields quotient =
dividend, remainder = 0. W-form instructions operate on the low 32 bits and sign-extend
the 32-bit result — including DIVUW/REMUW, whose *unsigned* 32-bit results are still
sign-extended to 64 bits. MULH* require a 128-bit intermediate (Rust `i128`/`u128`).

## Deliverables
- Decoder entries (opcode OP/OP-32, funct7=0000001) and execute arms in the interpreter.
- MULHSU implemented via i128×u128 mixed-sign product (document the derivation in a
  comment — this is the one everyone gets wrong).
- Unit tests enumerating every edge row: {0, 1, -1, i64::MIN, i64::MAX, i32::MIN as
  sign-extended, 0x8000_0000} as both operands, for all 13 ops, with expected values
  generated once from Spike and checked into the test as constants.
- rv64um-p-* binaries from riscv-tests pass under the Epic 0 bare-metal harness.

## Acceptance criteria
- [ ] `div  rd, x, 0` = -1; `divu rd, x, 0` = 2^64-1; `rem/remu rd, x, 0` = x, for random x.
- [ ] `div` of i64::MIN by -1 = i64::MIN with `rem` = 0; `divw` of i32::MIN by -1
      sign-extends 0x80000000 with `remw` = 0.
- [ ] `divuw`/`remuw` results are sign-extended from bit 31 (e.g. divuw producing
      0xFFFF_FFFF reads back as 0xFFFF_FFFF_FFFF_FFFF).
- [ ] MULH/MULHU/MULHSU match Spike on 10k random operand pairs (offline-generated table).
- [ ] All rv64um-p tests report pass via tohost; identical results native and wasm32.
- [ ] No Rust panic paths (checked arithmetic or explicit wrapping) — `div` by zero must
      not hit Rust's divide-by-zero panic in either build.

## Adversarial verification
Refute via differential execution: generate ≥1M random RV64M instructions (random regs,
random 64-bit operand values biased toward boundary patterns 0x8000…, 0x7FFF…, ±1, 0),
run lockstep against Spike, and report the first register-file divergence. Specifically
attack: MULHSU sign handling with negative rs1/positive rs2 and vice versa; W-form inputs
whose upper 32 bits are garbage (spec says they are ignored — seed registers with
non-canonical upper bits); rd == rs1 == rs2 aliasing. In the WASM build, force the
i128 paths (wasm has no native i128) and re-run the boundary table — any native/WASM
mismatch is a refutation. A Rust panic or abort on any input is also a refutation.

## Verification log
(empty)
