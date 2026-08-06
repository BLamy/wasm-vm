---
id: E4-T13
epic: 4
title: M (multiply/divide) and C (compressed) extensions in translated code
priority: 413
status: partially-verified
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
- 2026-08-05 — **M+C translation correctness-COMPLETE + verified (commit `8e8e85d`); status partially-verified (only the workload-level ledger/ratio ACs deferred).** **M div/rem (no escaped wasm trap):** `emit_div_rem64/32` guard `b==0` (unsigned) / `b==0 | (a==MIN & b==-1)` (signed), `select`-sanitize the divisor to 1 when the guard fires (the wasm div/rem is now total → never traps), then a final `select` substitutes RISC-V's result (`div/0→-1`, `divu/0→all-ones`, `rem/0→dividend`; overflow needs no extra select — a/1==INT_MIN, a%1==0). `*W` on i32 boundaries then `extend_i32_s`. **MULH\*:** unsigned high-64 from 4 schoolbook 32-bit partials; signed via two's-complement identity `MULH=high_u-(b<0?a:0)-(a<0?b:0)`, **MULHSU=high_u-(a<0?b:0)** (asymmetric — rs1 signed, rs2 unsigned). **C:** the E4-T05 predecoder already expands to 32-bit `Instr` with per-op `len`, and the translator was already length-driven (fall-through = base+total_len, JAL/JALR link = pc+2 for compressed) → verification-only, no code fix. **Gates (independently re-ran):** M corner cross-product 13 ops × 14 × 14 = **2548 cases, zero divergences, zero wasm traps** (run under wasmtime); directed mines (div/0, divw INT32_MIN/-1, rem INT64_MIN/-1, mixed-sign MULHSU) all match; C PC gate (compressed-only block → `c.bnez` target pc+2·k, mixed 2/4-byte, c.jal/c.jalr link=pc+2 — PCs+regs match every exit); **100k randomized** with M ops + random 2/4-byte mixes zero divergences; `riscv_tests_verdict_identical_with_jit` incl. all 13 rv64um + rv64uc ELFs; `m_and_c_suites_execute_in_jit_tier` (compiled_count>0 per ELF — no longer excluded, rv64uc-p-rvc compiles 47 blocks); `hot_m_loop_executes_in_jit` (906 JIT blocks byte-identical). All E4-T09/10/11/12 + determinism + SMC green; clippy(-D)/fmt/wasm32 no_std clean. **Deferred debt (workload-level — need a boot/bench run):** the ledger Dhrystone/CoreMark rerun with M+C, and the Alpine ≥80%-translated-instruction-ratio AC — these are boot-harness measurements outside the translator+gate scope (reaping/slow), tracked as remaining debt.
(empty)
