---
id: E1-T05
epic: 1
title: Softfloat strategy — evaluate, decide, and scaffold the FP arithmetic backend
priority: 105
status: pending
depends_on: [E1-T01]
estimate: M
capstone: false
---

## Goal
A written, benchmarked decision on how wasm-vm computes IEEE-754 arithmetic — a Rust port
of Berkeley SoftFloat-3e, `rustc_apfloat`, an existing crate (e.g. `softfloat-wrapper`/
`simple-soft-float`), or hand-rolled — plus the chosen backend integrated behind a
`SoftFloat` trait with f32/f64 add/sub/mul/div/sqrt/fma/compare/convert entry points that
return (result, exception-flags) pairs. T06/T07 build on this without revisiting the choice.

## Context
Host floating point is disqualified for the datapath: RISC-V mandates specific NaN
payloads (canonical NaN 0x7fc00000 / 0x7ff8_0000_0000_0000), five sticky exception flags,
and five rounding modes, none of which host f64 ops expose portably — and WASM/native
divergence in NaN bit patterns would break the determinism guarantee (T22). Berkeley
SoftFloat is the reference-quality choice (it's what Spike uses — bug-for-bug agreement
is a feature); rustc_apfloat is pure safe Rust but has known divergences in flag behavior;
hand-rolling requires exhaustive-testing budget. This task decides with data, not vibes.

## Deliverables
- `docs/design/softfloat.md`: candidates compared on (a) correctness vs Berkeley
  SoftFloat/TestFloat vectors, (b) native + wasm32 throughput (Mops/s for add/mul/div/fma),
  (c) `no_std` compatibility, (d) license, (e) maintenance risk. Explicit decision + why.
- `SoftFloat` trait in the core crate: all ops parameterized by rounding mode, returning
  `(bits, Flags)` where `Flags` = {NV, DZ, OF, UF, NX}; zero use of host `f32`/`f64`
  arithmetic in any code path the guest can reach (enforced by a clippy lint or CI grep).
- The chosen backend vendored/ported and passing a smoke slice of TestFloat vectors
  (f32_add, f64_mul, f64_div, f32_sqrt, f64_mulAdd — all rounding modes).
- Benchmark harness (`cargo bench` + a wasm32 timing page) with recorded numbers.

## Acceptance criteria
- [ ] Design doc exists with a filled comparison table and a named decision.
- [ ] TestFloat (or SoftFloat-3e test vector) smoke slice passes: zero mismatches in
      result bits AND flag bits for the five listed op/mode matrices.
- [ ] `qNaN` results carry the RISC-V canonical payload; sNaN inputs raise NV.
- [ ] fma is a true fused op: a TestFloat f64_mulAdd vector that double-rounding would
      corrupt passes (e.g. cases where round(round(a*b)+c) != round(a*b+c)).
- [ ] wasm32 build compiles `no_std` and the benchmark page reports numbers in the doc.
- [ ] CI check fails if guest-reachable code performs host float arithmetic.

## Adversarial verification
Refute the correctness claim with TestFloat: run `testfloat_gen` for at least f64_add,
f64_div, f64_sqrt, f64_mulAdd across all five rounding modes at level 2, piped through a
harness calling our trait; any result-bit or flag mismatch vs SoftFloat-3e is a refutation.
Attack the "no host float" claim by grepping the core crate for f32/f64 arithmetic ops and
`to_bits/from_bits` misuse, and by diffing full flag+result traces between native and
wasm32 for 100k random fma inputs (NaN-heavy corpus: sNaN/qNaN payload permutations,
subnormals, ±0, ±inf). Refute the fused-multiply-add claim with the classic
double-rounding witnesses. Refute the benchmark claim by re-running it cold.

## Verification log
(empty)
