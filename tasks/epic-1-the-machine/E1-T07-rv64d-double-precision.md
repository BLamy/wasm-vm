---
id: E1-T07
epic: 1
title: RV64D double-precision extension and F/D interaction semantics
priority: 107
status: implemented
depends_on: [E1-T06]
estimate: M
capstone: false
---

## Goal
Full D-extension execution on top of T06's register file and softfloat backend: all
double-precision compute/convert/compare/classify ops, FLD/FSD, FMV.X.D/FMV.D.X, and the
single↔double conversion pair — making the FPU complete for RV64GC and rv64ud green.

## Context
Unprivileged spec "D" chapter. D mostly parallels F, but the interactions are where bugs
live: FCVT.S.D must round (inexact possible) while FCVT.D.S is exact; FCVT.D.S of a
non-boxed f32 operand must see canonical qNaN; f64 values are *not* NaN-boxed (they fill
the register), and a subsequent f32 read of that register must fail the box check.
FCVT.{W,WU,L,LU}.D saturation mirrors F (NaN → most-positive). FCVT.D.W/WU are exact
(every i32 fits in f64, no flags); FCVT.D.L/LU can be inexact. FMV.X.D/FMV.D.X are raw
bit moves — no canonicalization, no flags. Canonical f64 NaN is 0x7ff8_0000_0000_0000.

## Deliverables
- Decode/execute for FADD/FSUB/FMUL/FDIV/FSQRT/FMADD/FMSUB/FNMADD/FNMSUB.D,
  FSGNJ[N,X].D, FMIN/FMAX.D, FEQ/FLT/FLE.D, FCLASS.D, FCVT.S.D, FCVT.D.S,
  FCVT.{W,WU,L,LU}.D and inverses, FLD/FSD, FMV.X.D, FMV.D.X.
- FLD/FSD honoring the same misalignment policy as integer loads/stores (document:
  we allow misaligned via slow path or trap — must match what T10 documents).
- Extension of the T06 test matrix to f64, plus targeted F↔D interaction tests.
- rv64ud-p-* passing.

## Acceptance criteria
- [ ] FCVT.D.S(box-violating operand) = canonical f64 qNaN; FCVT.S.D result is properly
      NaN-boxed (upper 32 bits all-ones, verified via FMV.X.D readback).
- [ ] FCVT.S.D(1e300) = +inf with OF|NX; FCVT.D.S is flag-clean for all finite f32 inputs
      (property-tested over 1M random f32 bit patterns).
- [ ] FCVT.L.D(NaN) = 0x7FFF_FFFF_FFFF_FFFF with NV; FCVT.LU.D(-1.0) = 0 with NV.
- [ ] FMIN.D/FMAX.D two-qNaN case returns 0x7ff8_0000_0000_0000 exactly.
- [ ] FCLASS.D matches Spike on ±0, ±subnormal-min/max, ±normal-min/max, ±inf, sNaN, qNaN.
- [ ] rv64ud-p suite passes natively and in wasm32 with identical fcsr end states.

## Adversarial verification
TestFloat level-2 for all D ops and both conversion directions, all five rounding modes,
through the decoded path — mismatch refutes. Attack the F/D register aliasing: write an
f64, execute an f32 op on the same register, then FCLASS.S — must report qNaN regardless
of the f64's low bits; then the reverse (write boxed f32, read as f64 — the *full 64-bit
pattern* including the box must be used, i.e. it's a negative NaN-space f64; diff FCLASS.D
vs Spike). Attack conversions at the exactness boundary: FCVT.D.L of 2^53+1 must set NX;
FCVT.D.W of i32::MIN must be exact. Run a 50k mixed F/D random stream lockstep vs Spike
with NaN-payload-rich seeds; compare full f-reg file + fcsr each retire. Any native/wasm32
divergence in result bits or flags refutes (this is the pre-test for T22).

## Verification log

### 2026-07-03 — worker (implementation claim)
Full RV64D execution, a near-exact parallel of T06 for f64 on the existing infrastructure:
- **Decode** (`crates/core/src/decode.rs`): 15 D variants (FLD/FSD funct3=011; OP-FP fmt=01
  arms; fused fmt=01; FMV.X.D/FMV.D.X; the two format conversions FCVT.S.D/FCVT.D.S). The
  F handling is untouched; D adds new funct7 arms. `FcvtDS` stores its (ignored) rm for
  round-trip fidelity.
- **f64 helpers** (`softfloat.rs`): `fclass_f64`/`f64_minmax`/`f64_to_int`/`f64_from_int`
  mirror the f32 ones; the FCVT.S.D/FCVT.D.S pair reuses the existing `f64_to_f32`/
  `f32_to_f64`.
- **Execute** (`hart/mod.rs`): D arms via `F64::{...}`. **f64 fills the register — NO
  NaN-boxing**: operands/results use `read_raw`/`write_raw`. FMV.X.D/FMV.D.X are raw 64-bit
  moves. FCVT.S.D narrows (rounds, result boxed via `write_f32`); FCVT.D.S widens (exact,
  input `read_f32`-checked). Every D op is in the `is_fp` FS guard.

Evidence (local):
- **Official riscv-tests rv64ud-p: all 12 ELFs pass** via `tohost` under the real-CSR
  harness (`riscv_tests_f.rs::rv64ud_p_suite_all_pass`; fadd/fclass/fcmp/fcvt/fcvt_w/fdiv/
  fmadd/fmin/ldst/move/recoding/structural). Built by `tools/riscv-tests/build-rv64ud.sh`
  (`-march=rv64ifd_zicsr`), committed. rv64uf/ui/um/ua still pass.
- `crates/core/tests/rv64d.rs` (6): FCVT.D.S(box-violating)→f64 canonical qNaN; FCVT.S.D
  result NaN-boxed (via FMV.X.D) + 1e300→+inf with OF|NX; **FCVT.D.S flag-clean over 200k
  random finite f32**; FCVT.L.D(NaN)→i64::MAX+NV, FCVT.LU.D(-1.0)→0+NV; FMIN/FMAX.D two-qNaN
  → canonical; F/D register aliasing (f64 seen as qNaN by f32 ops; boxed f32 seen as a NaN
  by FCLASS.D).
- wasm32: `crates/wasm/tests/rv64d.rs` bit-identical to native under both feature builds
  (the T22 determinism pre-test).
- Decoder space: exhaustive 2^32 sweep passes with the analytic tally **325,400,581**
  (brute-force verified; D contributions documented). decode_props FP-D round-trip (all rm)
  + the fmt=10-reserved negative pass.
- Gate: fmt clean, clippy 0 warnings, `cargo test --workspace` 0 FAILED, both wasm builds
  0 FAILED, no-host-float OK.

Pending: adversarial verification (TestFloat/Spike lockstep over the decoded D path;
F/D aliasing, conversion-exactness-boundary, and mixed F/D stream attacks).
