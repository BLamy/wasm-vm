---
id: E1-T03
epic: 1
title: RV64M multiply/divide with exact div-by-zero and overflow semantics
priority: 103
status: implemented
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

### 2026-07-03 — worker (implementation claim)
Implemented all 13 RV64M ops as decode variants + execute arms (`crates/core/src/decode.rs`,
`crates/core/src/hart/mod.rs`). Design notes:
- **Not feature-gated** (unlike Zicsr): the M decode is legal in both the default and
  `zicsr-stub` builds. The rv64ui-p stub path never executes M ops, so this is inert there —
  confirmed by rv64ui-p still passing under the stub.
- **No Rust panic paths**: every divisor-zero and signed-overflow case is branched out
  BEFORE the `/`/`%`. Signed div/rem use an explicit `b==0 → -1/dividend` and
  `MIN/-1 → dividend/0` guard; unsigned use `checked_div`/`checked_rem` (which return `None`
  only on divisor zero — no unsigned overflow case).
- **MULHSU**: `(rs1 as i64 as i128) * (rs2 as u128 as i128)` — rs1 sign-extended, rs2
  zero-extended (always non-negative), exact product in i128, arithmetic `>>64`. Derivation
  documented in-line. A dedicated test contrasts MULHU vs MULHSU on (-1,-1) to prove the
  sign of rs1 flips the high word.
- **W forms** operate on the low 32 bits and sign-extend the 32-bit result — including
  DIVUW/REMUW, whose *unsigned* results are still sign-extended from bit 31.

Evidence (local, macOS + reference toolchain):
- `cargo test -p wasm-vm-core --test rv64m` — 12/12 (products, div/rem-by-zero over 6
  dividends, signed overflow, truncate-toward-zero, W upper-bits-ignored, DIVUW/REMUW
  sign-extension, rd==rs1==rs2 aliasing, boundary-biased no-panic sweep).
- **Official riscv-tests rv64um-p: all 13 ELFs pass** via `tohost` (`cargo test -p
  wasm-vm-core --features zicsr-stub --test riscv_tests` → `rv64um_p_suite_all_pass` +
  `rv64ui_p_suite_...` both green). Built reproducibly with `tools/riscv-tests/build-rv64um.sh`
  (`-march=rv64im_zicsr`, committed to `tests/riscv-tests-bin/`).
- wasm32: `crates/wasm/tests/rv64m.rs` boundary table passes under BOTH `wasm-pack test
  --node crates/wasm` and `--features zicsr-stub` — forces the `__multi3` i128 lowering
  (no native i128 on wasm) and matches native bit-for-bit.
- Decoder space: exhaustive 2^32 release sweep passes with the updated analytic tally
  **236,093,445** (= 56·2^22 + 3·2^16 + 31·2^15 + 5; +13·2^15 for the new M encodings);
  `decode_props` round-trip extended to all 13 M ops + the reserved-funct7 sweep now
  excludes 0000001; `decode_golden`/wasm negatives updated (MUL/MULH/REMUW now legal, a
  reserved M *W funct3 kept as the illegal probe).
- Gate: `cargo fmt --all --check` clean, `cargo clippy --workspace --all-targets` 0
  warnings, `cargo test --workspace` 0 FAILED.

Pending: adversarial verification by a fresh cold-clone critic (≥1M-instruction Spike
differential biased toward boundary patterns; MULHSU mixed-sign attack; W-form garbage
upper bits; aliasing).
