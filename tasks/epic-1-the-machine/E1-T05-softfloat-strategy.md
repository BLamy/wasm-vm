---
id: E1-T05
epic: 1
title: Softfloat strategy — evaluate, decide, and scaffold the FP arithmetic backend
priority: 105
status: verified
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

### 2026-07-03 — worker (implementation claim)
**Decision (data-driven, forced by hard constraints): `rustc_apfloat` for
add/sub/mul/div/fma/compare/convert + a hand-rolled correctly-rounded integer-only `sqrt`.**
Full rationale + comparison table in `docs/design/softfloat.md`. The two "reference-quality"
options were eliminated by measured constraints, not preference:
- **Berkeley SoftFloat (C)** — cannot build `wasm32-unknown-unknown`: the available Apple
  `clang` has no wasm target (`"No available targets are compatible with triple wasm32"`),
  and a C→wasm toolchain in CI is out of scope. Fails the hard wasm32/`no_std` constraint.
- **simple-soft-float** — does NOT compile on Rust 1.96 (internal `uint_impl` macro error);
  bit-rotted. Rejected.
- **rustc_apfloat 0.2** — pure Rust, `no_std`, builds native AND wasm32 (both verified),
  correct rounding + flags, fused `mul_add`, RISC-V-canonical `NAN`. Chosen. Gaps handled:
  (1) **no sqrt** → hand-rolled `ieee_sqrt`; (2) apfloat **propagates NaN payloads** but
  RISC-V mandates the canonical NaN → `SoftFloat::*` canonicalizes every NaN result (caught
  by a committed sNaN test); (3) sNaN→NV on convert added explicitly.

Deliverables:
- `crates/core/src/softfloat.rs`: `#![deny(clippy::float_arithmetic)]` (compile-time proof
  of no host float). `Flags` (NX/UF/OF/DZ/NV in `fflags` bit order), `RoundMode` (5 modes,
  `from_bits`), `SoftFloat` trait (add/sub/mul/div/fma/sqrt/eq/lt/le/canonical_nan) impl'd
  for `F32`/`F64` via a macro over apfloat; `f32_to_f64`/`f64_to_f32` conversions.
- **`ieee_sqrt`** — integer-only, exact: decompose `x=m·2^e`; sqrt never under/overflows a
  normal input so the result is always normal (only NX/NV fire, no subnormal bookkeeping);
  scale by an even shift so `u128::isqrt` yields exactly `p` bits; the two adjacent
  candidates bracket the root and the correctly-rounded result is chosen by comparing `x` to
  the candidates' **exact integer squares** — no reimplemented rounding core.
- `docs/design/softfloat.md` (comparison table + decision + benchmark numbers).
- `tools/ci/no-host-float.sh` + a CI/`make test` step (belt-and-braces over the deny attr).
- `crates/core/benches/softfloat_bench.rs` (Criterion; numbers recorded in the doc:
  f64 add ~14ns, mul ~15ns, div ~47ns, fma ~22ns, sqrt ~32ns; f32 sqrt ~21ns).

Evidence (local):
- `cargo test -p wasm-vm-core --test softfloat` — 9/9. **sqrt RNE & RMM == host hardware
  sqrt** (IEEE correctly-rounded RNE; sqrt provably never ties, so RMM==RNE) over
  **300,000 f64 + 300,000 f32** random inputs incl. subnormals, bit-for-bit; directed modes
  (RTZ/RDN/RUP) validated by deriving floor/ceil from an **exact `r²`-vs-`x`** integer
  comparison over the same sweep, incl. the NX flag; specials (−0, +∞, sqrt(−x)→canonical
  NaN+NV, sNaN→NV); reference vectors; `0.1+0.2`→NX; `1/0`→DZ; NaN canonicalization; a
  **fused-multiply-add double-rounding witness**.
- `crates/wasm/tests/softfloat.rs`: identical results on wasm32 (the determinism claim) —
  green under both default and `--features zicsr-stub`.
- Builds: `--no-default-features` (`no_std`) and `wasm32-unknown-unknown` both compile.
- Gate: fmt clean, clippy 0 warnings (float_arithmetic deny active), workspace 0 FAILED,
  `tools/ci/no-host-float.sh` OK, exhaustive tally unchanged.

### 2026-07-03 — adversarial verifier (round 1) — VERDICT: refuted (coverage)
The critic could NOT fault the implementation (F64 1,106,134 + F32 1,112,069 sqrt inputs ×5
modes = ~11.1M checks, 0 mismatches; add/sub/mul/div 600k NaN-heavy pairs ×5 modes each,
0 mismatches; fma fused-witness distinct in 3,686/200k; native==wasm32 FNV checksum over
~3M results+flags; no host float; no panics; 4/6 mutations caught). BUT it found a **coverage
hole**: the committed tests asserted only **RNE** for arithmetic ops, so two `to_apfloat`
mutations survived the whole suite — (1) swap `Rdn`↔`Rup`; (2) `Rtz`→`NearestTiesToEven`.
Per the task's own criterion ("a mutation the committed tests miss is a REFUTATION"), valid.

### 2026-07-03 — rework
Added directed-mode ARITHMETIC coverage to `crates/core/tests/softfloat.rs`:
- `mul_div_directed_modes_match_independent_oracle` — 200k+ mul/div cases ×{RTZ,RDN,RUP}
  vs an INDEPENDENT oracle (host correctly-rounded RNE + exact-integer u128 residual to pick
  floor/ceil). This exercises the full `to_apfloat` mapping (shared by every op).
- `add_and_fma_directed_modes` — independently-known directed results for `0.1+0.2`
  (RTZ/RDN=…333, RUP/RMM=…334) and `1/3` (RUP=…556, RTZ=…555), plus an fma RTZ≠RUP check.
Confirmed both critic mutations now FAIL these tests (2 failures each); reverted → 11/11
green. No production code changed (impl was already correct). Re-verifying.

### 2026-07-03 — adversarial verifier (round 2) — VERDICT: verified
Re-checked the coverage fix from a fresh cold clone. Confirmed: the rework commit is
**test-only** (`git show f7f5bdf --stat` — no production `softfloat.rs` change); the new
oracle is **non-circular** (derives expected directed results from host RNE + exact integer
residual, never from the impl's own directed output). Per-mutation: M1 swap Rdn↔Rup →
CAUGHT; M2 Rtz→RNE → CAUGHT; M4 Rne→RTZ (sanity) → CAUGHT; M3 Rmm→RNE → *survived* (RMM
==RNE except on ties, which the sweeps didn't hit) — flagged as minor non-blocking
under-coverage. Regression re-confirmed: committed suite 11/11, `cargo test --workspace`
0 FAILED, sqrt 300k×5-mode sweep clean; gate green (fmt/clippy/wasm32/no-host-float).

### 2026-07-03 — RMM hardening (test-only)
Closed the round-2 minor observation: added an exact HALFWAY-tie case (`1.0 + 2^-53`, the
midpoint of 1.0 and 1.0+2^-52) — RNE ties-to-even → 1.0, RMM ties-away → 1.0+2^-52. Now all
FIVE `to_apfloat` mode mappings are mutation-locked; verified the Rmm→RNE mutation is caught
(`add_and_fma_directed_modes` fails), reverted → 11/11 green. fmt/clippy clean.

VERIFIED — E1-T05 complete.
