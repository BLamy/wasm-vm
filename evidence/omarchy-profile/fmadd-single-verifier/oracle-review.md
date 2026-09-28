# Independent oracle and status-boundary review

This review follows the immutable pre-evidence predictions. No worker result
values are used to derive `goldens.json`; its 175 operand triples come from
directed cases and independent seeds. The Python oracle uses `Fraction` and
integer rounding only. It does not call Rust, APFloat, the interpreter, or host
floating-point arithmetic. The committed verifier embeds all 875 result/flag
pairs so native and browser expected values have no dependency on the DUT.

## Rounding construction

For a finite nonzero exact fused value x, the oracle first rounds |x| with
precision 24 and an unbounded exponent. The sign selects the directed mode.
That rounded magnitude determines overflow (at least 2^128) and tininess
(below 2^-126). Final encoding separately clamps the minimum ULP to 2^-149.
UF requires both tininess and final inexactness. Thus a final normal result
can still have UF. Signed exact cancellation and zero-product rules are
handled before magnitude rounding. Each malformed FPR box becomes a quiet
canonical NaN before exceptional-value classification.

Primary-source retrieval succeeded for the official
[F source](https://github.com/riscv/riscv-isa-manual/blob/main/src/unpriv/f-st-ext.adoc),
[D source](https://github.com/riscv/riscv-isa-manual/blob/main/src/unpriv/d-st-ext.adoc),
[SoftFloat FMA](https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/s_mulAddF32.c),
and [SoftFloat rounding](https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/s_roundPackToF32.c).
The docs.riscv.org versioned browser links returned an access error, so the
official source text supplied the actual specification read. No secondary
source supplies expected arithmetic values.

## Preliminary review of the worker's directed software-Double comparison

The proposed correction changes only flags for an already-inexact F32 FMA
whose magnitude is largest finite or smallest normal. For such a finite
result all three original operands must be finite. After flipping one
multiplicand and the addend when the exact result is negative, the widened
exact fused sum is positive. All binary32 products lie inside binary64's
exponent range, although an extreme exponent gap can exceed its precision.

For an exactly representable positive threshold T, downward rounding preserves
`x >= T` and `x < T`; upward rounding preserves `x <= T`. These comparisons
remain valid even when a tiny addend is rounded away. Nearest rounding does
not have that property. The literal set includes both signs of
`2^128 +/- minimum_subnormal` and nearby tininess thresholds, specifically to
attack lost-addend errors. This is a mathematical review of the approach,
not a verdict on the final source or execution.
