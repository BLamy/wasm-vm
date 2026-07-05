# SoftFloat backend decision (E1-T05)

**Decision: `rustc_apfloat` (the LLVM APFloat port) for add/sub/mul/div/fma/compare/convert,
plus a hand-rolled correctly-rounded integer-only `sqrt`.** Every NaN-producing op
canonicalizes its result to the RISC-V canonical NaN. Implemented in
`crates/core/src/softfloat.rs`; T06/T07 build the F/D instruction datapath on the
`SoftFloat` trait without revisiting this choice.

## Why host `f32`/`f64` is disqualified for the datapath

RISC-V mandates behavior host floats do not expose portably:
- a **canonical NaN** payload (`0x7fc0_0000` / `0x7ff8_0000_0000_0000`) for *every*
  NaN-producing op (RISC-V does **not** propagate NaN payloads — unlike IEEE's recommended
  behavior and unlike LLVM/apfloat, which we override);
- five sticky **exception flags** (NV, DZ, OF, UF, NX);
- five **rounding modes** (RNE, RTZ, RDN, RUP, RMM).

Worse, host NaN bit patterns and subnormal handling can diverge between native and wasm32,
which would break the cross-target determinism guarantee (E0-T22). So no guest-reachable
code path performs host float arithmetic; the `softfloat` module is
`#![deny(clippy::float_arithmetic)]` and CI greps for host-float ops (see *Enforcement*).

## Candidates evaluated (with data gathered on this toolchain)

| Candidate | Correctness | native + wasm32 | `no_std` | License | Maintenance | Verdict |
|-----------|-------------|-----------------|----------|---------|-------------|---------|
| **Berkeley SoftFloat-3e (C, via `cc`)** | Reference — *is* the TestFloat oracle; bug-for-bug Spike agreement | ❌ **cannot build wasm32**: the available Apple `clang` has no `wasm32` target (`"No available targets are compatible with triple wasm32"`); shipping a C→wasm toolchain into CI is out of scope | n/a | BSD-3 | Low (stable) | **Rejected** — fails the hard wasm32 constraint |
| **`simple-soft-float`** | Full IEEE incl. sqrt/fma, aims for exactness | ❌ **does not compile** on Rust 1.96 (internal `uint_impl` macro type error); pulls bigint deps | unclear | LGPL-2.1+ | **Bit-rotted** | **Rejected** — won't build; license friction |
| **`rustc_apfloat` 0.2** | LLVM APFloat: correct results + flags; **no sqrt**; propagates NaN payloads (we canonicalize) | ✅ builds native **and** `wasm32-unknown-unknown` | ✅ yes | Apache-2.0/MIT w/ LLVM exception | **Active** (in-tree with rustc) | **Chosen** |
| **Hand-roll everything** | Whatever we test | ✅ | ✅ | ours | High risk, large test budget | Rejected for the common ops; used **only** for sqrt |

### Why `rustc_apfloat` despite the known trade-offs
- The two "reference-quality" options are eliminated by hard constraints (wasm32 build /
  won't-compile), not by preference — this is a constraint-forced decision, documented with
  the actual toolchain errors above.
- apfloat gives correct round-to-`{RNE,RTZ,RDN,RUP,RMM}` results **and** the five flags for
  add/sub/mul/div and a genuinely **fused** `mul_add`. Its `Double::NAN`/`Single::NAN` are
  already the RISC-V canonical payloads.
- Two behaviors we **override** to match RISC-V/Spike:
  1. **NaN canonicalization.** apfloat (like LLVM) propagates NaN payloads; RISC-V returns
     the canonical NaN for all NaN-producing ops. `SoftFloat::*` forces any NaN result to
     `canonical_nan()`. (This was caught by a committed sNaN test.)
  2. **sNaN → NV on convert.** Signaling-NaN detection drives NV explicitly.

### The sqrt gap and how it is closed
LLVM APFloat has no square root, so `ieee_sqrt` is hand-rolled **integer-only** (no host
float, so it is deterministic and passes the `float_arithmetic` deny):
- Decompose `x = m·2^e`; because sqrt never under/overflows a normal input
  (`sqrt(2^-1074) = 2^-537`, still normal) the **result is always normal** — only NX and NV
  can fire, which removes all subnormal/overflow rounding bookkeeping.
- Scale `m` by an even shift so `q = isqrt(R)` (`u128::isqrt`, exact floor) yields exactly
  `p = mantissa+1` significand bits. `q` and `q+1` are the two adjacent candidate floats
  bracketing the true root; the correctly-rounded result is chosen by comparing `x` to the
  candidates' **exact integer squares** — no reimplemented rounding core.

## Correctness evidence

`crates/core/tests/softfloat.rs` (oracle = host hardware sqrt, which is IEEE
correctly-rounded RNE; IEEE sqrt provably never hits a rounding tie, so RMM == RNE too):
- **sqrt RNE/RMM == host** over **300,000** random f64 and **300,000** random f32 inputs
  (normals + subnormals), bit-for-bit.
- **Directed modes** (RTZ/RDN/RUP) validated by deriving the expected floor/ceil float from
  an **exact** `r²`-vs-`x` integer comparison over the same 300k sweep, incl. the NX flag.
- Specials: sqrt(−0)=−0, sqrt(+∞)=+∞, sqrt(−x)=canonical NaN + NV, sNaN→NV, perfect squares
  exact (no NX).
- Ops: reference vectors for add/mul/div, `0.1+0.2` flags NX, `1/0` flags DZ, canonical-NaN
  and sNaN→NV, a **fused-multiply-add double-rounding witness** (`(1+2^-52)²−(1+2^-51)` =
  `2^-104` fused, but `0` if double-rounded), signaling vs quiet compares.
- `crates/wasm/tests/softfloat.rs`: identical results on wasm32 (the determinism claim).

## Benchmarks

`cargo bench -p wasm-vm-core --bench softfloat` (Criterion) times f64 add/mul/div/fma/sqrt
and f32 sqrt. Representative numbers on the development host (Apple, native release) — rerun
locally, they are machine-relative:

Measured over a 1024-element input vector per iteration (Criterion median ÷ 1024), native
release on the development host (Apple Silicon). Machine-relative — rerun with
`cargo bench -p wasm-vm-core --bench softfloat_bench`.

| op | ns/op | ≈ Mops/s |
|----|-------|----------|
| f64_add | ~14.4 | ~69 |
| f64_mul | ~15.5 | ~64 |
| f64_div | ~46.5 | ~22 |
| f64_fma | ~21.7 | ~46 |
| f64_sqrt (integer, hand-rolled) | ~31.7 | ~32 |
| f32_sqrt (integer, hand-rolled) | ~20.9 | ~48 |

The hand-rolled integer sqrt (~32 Mops/s f64) is competitive with apfloat's other ops — the
single `u128::isqrt` dominates and the candidate-compare rounding is a handful of integer
multiplies. A wasm32 timing page lands with the F-extension UI in E1-T06/T07, where FP
instructions are actually wired to the datapath.

## Enforcement — no host float in guest-reachable paths

1. `crates/core/src/softfloat.rs` is `#![deny(clippy::float_arithmetic)]` — a compile error
   on any `+ - * /` over host floats in the FP backend.
2. `tools/ci/no-host-float.sh` greps the FP datapath sources for host-float arithmetic and
   `f64::from_bits`/`sqrt`-style host ops, failing CI on a hit. As T06/T07 add the F/D
   execute arms, they extend the deny attribute and this grep's file list.
