---
id: E4-T13
epic: 4
title: M (multiply/divide) and C (compressed) extensions in translated code
priority: 413
status: pending
depends_on: [E4-T12]
estimate: M
capstone: false
---

## Goal
Translated blocks natively execute the full M extension (MUL/MULH/MULHSU/MULHU, DIV/DIVU/
REM/REMU and all `*W` forms) with exact RISC-V corner-case semantics, and compressed (C)
instructions flow through translation correctly — expanded at predecode, with 2-byte PC
arithmetic, branch targets, and block byte-ranges all right — so real Alpine binaries
(which are RVC-dense) run predominantly in the JIT tier.

## Context
The semantic mines: wasm `i64.div_s/div_u/rem_*` *trap* on divide-by-zero and on
INT_MIN/−1 overflow, while RISC-V defines results (div/0 → −1 (all ones for divu),
rem/0 → dividend; INT_MIN/−1 → INT_MIN with rem 0) — generated code must guard both cases
explicitly, never letting a wasm trap escape. MULH* has no single wasm op: compose 64×64→
high-64 from 32-bit halves (four partial products) or the standard Karatsuba-lite sequence;
get MULHSU's asymmetric signedness right. C-extension work is mostly in the E4-T05
predecoder (already expanding to 32-bit forms), but translation exposes what predecode
could fudge: per-op lengths feed PC materialization (E4-T12), fallthrough PCs of 2-byte
ops, JAL/JALR link values of pc+2, and blocks whose *byte* range must be exact for SMC
invalidation (E4-T17) to find them.

## Deliverables
- Translator support for all 13 M-extension ops incl. `*W` forms, with div/rem guard
  sequences and a comment-level note on the chosen MULH lowering.
- Verified C handling end-to-end: mixed 2/4-byte blocks translate with correct next-PC,
  link registers, and branch targets; `c.jalr`, `c.ebreak`, and misaligned-fetch edge at
  a 2-byte-aligned page-crossing boundary covered.
- Differential rig extended: random M-op blocks biased to corner values (0, ±1, INT_MIN,
  INT64_MIN, powers of two) and random compressed/uncompressed instruction mixes.
- Ledger rerun: Dhrystone (multiply-heavy) and CoreMark with M+C translated.

## Acceptance criteria
- [ ] rv64um and rv64uc suites green with JIT forced on.
- [ ] Directed tests: `div x, y, 0`, `divw INT32_MIN, -1`, `rem INT64_MIN, -1`, MULHSU
      with mixed-sign operands — all match interpreter, and *no wasm trap* is observable
      (asserted by running under wasmtime with trap hooks).
- [ ] 100k-block randomized differential incl. M ops and RVC mixes: zero divergences.
- [ ] An Alpine userspace workload (`gcc --version`, `python3 -c 'print(2**64)'`) shows
      ≥ 80% translated-instruction ratio (RVC no longer forcing interpreter fallback).

## Adversarial verification
Refute the corner cases and the RVC bookkeeping. Attack angles: (1) exhaustive-ish sweep:
for every M op, test the cross product of operands drawn from {0, 1, −1, 2, INT32_MIN/MAX,
INT64_MIN/MAX, random} against the interpreter — any mismatch or host trap refutes;
(2) build a guest function of only compressed instructions ending in `c.bnez` whose taken
target is pc+2×k — single-step interpreter vs JIT and compare PCs at every exit; (3) place
a 4-byte instruction straddling a page boundary preceded by 2-byte ops (legal with C) and
verify fetch-fault mepc/mtval precision under JIT; (4) confirm block byte-ranges: overwrite
the *last two bytes* of a cached mixed-width block and check invalidation catches it
(pairs with E4-T17 but a length bug is visible now via the conservative flush path).

## Verification log
(empty)
