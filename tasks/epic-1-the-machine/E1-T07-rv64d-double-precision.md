---
id: E1-T07
epic: 1
title: RV64D double-precision extension and F/D interaction semantics
priority: 107
status: pending
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
(empty)
