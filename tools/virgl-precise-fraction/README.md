# Instruction-local precise fraction evidence

This private boundary implements pinned TGSI `x-floor(x)` (Mesa 24.2.8
TGSI specification, lines 309–319) with one binary32 nearest-even rounding.
Both zeros and every representable finite integer produce positive zero;
positive subnormals stay gradual; tiny negative inputs may round to positive
one. All NaNs and infinities produce quiet `0x7fc00000`. Negation precedes
calculation. Ordinary FRC and the pinned Mesa `fract` converter remain unchanged.

The unsigned helper uses shifts in 1–24 and normalization loops bounded to
23 steps. BigInt rational source equations generate the predictions; Python
independently recomputes exact Euclidean remainders and searches adjacent
binary32 words. No emitted helper supplies the truth.

Native ASan/UBSan recordings cover 7,968 helper words across every binary32
exponent and 1,919 predetermined compiler cases, with 1,897 actual pinned
TGSI token/converter witnesses. Wasm repeats complete results and pairs.
Physical WebGL2 transform feedback reconstructs all 32 result bits from two
normal finite carriers. Fragment captures cover all 32 RGBA8 bit planes.
Three seeds exercise masks, swizzles, source aliases, negation, conditional
versions, literal inputs, real attributes and changing exact-word banks.
NaN/subnormal private banks are isolated direct shader probes; wire consumers
retain the existing nonfinite encoding rejection.

The new metadata wrapper retains every inherited range, finite-bank, counted
loop, radial, raster, precision, arithmetic, conversion, scalar and minimum
obligation. An unknown private fraction gains no numeric/output authority or
new F2I range promise. Already authorized sources preserve their checked
numeric shadow and bank dependence; known results use only the prior static
normal-or-zero proof.

Four real indexed draw rigs combine guarded signed conversions with precise
fractions that change their pixels. They exercise sync/async ownership,
A/B/A banks, whole prefixes, unused components, restoration, hostile ranges,
actual index waits and zero lifetime budgets. Real shader-source faults break
negative complements, rounding ties and special results; the mathematical
word oracle must refute each before the run is accepted.

Compatibility re-executes the sealed, independently verified minimum compiler
against 1,014 old ordinary-FRC, precise ADD/MUL, precision and selected-away
fixtures. Whole results remain identical except the two named old precise-FRC
rejections now admitted in `legacy-migrations.json`. A second local fraction
instruction preserves all old base policies. Promoted prior critic guards
remain part of the target.

Run `make verify-E6-T12g6g2` at the frozen source head, then `cold.py` once for
a pristine scrubbed clone and `seal.py` for the source-bound hot/cold archive.
A fresh critic must inspect that evidence before the task becomes verified.
Production negotiation, live demo imports, guest offload and performance claims
remain gated by downstream integration.
