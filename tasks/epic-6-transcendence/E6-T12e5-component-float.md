---
id: E6-T12e5
epic: 6
title: Preserve the remaining componentwise float operations and negation
priority: 525.0269905
status: in-progress
depends_on: [E6-T12e4c2]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit inventoried plain DIV, MAX, FRC and LRP and captured scalar/source negate
syntax. Preserve opcode operand order, TGSI definitions, consumed lane masks and
modifier ordering. Explicitly enumerate the accepted finite/numeric domains and
the pinned TGSI/WebGL guarantees for each operation. Do not add unused absolute,
saturate or other modifiers incidentally. PRECISE remains rejected.

## Deterministic acceptance

`make verify-E6-T12e5` records native sanitizer/Wasm parity and actual ESSL300
execution using independent expected values: unequal LRP endpoints, negative
FRC arguments, distinct per-lane divisors/MAX operands and negated swizzles.
Use exact binary-fraction pixels where possible and documented bit/ULP limits
where the admitted semantics require them. Test every newly admitted operation
and modifier; preserve previous gates and 12/19 original outcomes. Record
exact-head and pristine-clone proof.

## Adversarial verification

Attack operand reversal, negative FRC truncation-versus-floor, signed zero and
denominator/exceptional-value boundaries only according to the explicit admitted
contract, modifier order and partial writes. Sabotage one operator or negate
application and require an independent oracle failure.

## Preparation notes

Keep this as one atomic checked componentwise-arithmetic boundary. Use the
ordinary float contract from E6-T12e4c2. Original IN values, existing computed or
sampled shadows, and raw words proved finite normal or signed zero are authorized
numeric sources. Do not add magnitude, finite-value, nonzero-divisor or
interpolation-weight admission guards on ordinary IN/shadows. Such guards are
not imposed by the pinned TGSI equations and would exclude valid captured
programs. The specified finite/range conditions instead limit quantitative
accuracy claims and independent test oracles. Unknown raw numeric CONST/TEMP
inputs remain rejected; the separate constant-domain integration before Mesa
is still required.

Use the pinned VirGL mappings: DIV `src0/src1`, MAX `max(src0,src1)`, FRC
`fract(src0)`, and LRP `mix(src2,src1,src0)`. Preserve source and modifier order,
partial masks, consumed-lane validation, both pre-write snapshots and bounded
storage. Only validated new operations or numeric modifiers select the new
owned profile; pure new-op/negative numeric programs without an integer token
must enter that checked path. Earlier programs retain their exact profiles and
full outputs except explicitly bound historical admissions.

Unary minus is supported only for numeric operands, including TEX coordinates.
Keep MOV, UCMP selector/payload, raw comparisons, bitwise/integer sources and
samplers unmodified. Keep absolute, saturation, repeated signs, unary plus,
PRECISE and LEGACY_MATH_RULES rejected. The latter has a distinct zero-times-
infinity rule, including the multiplications implied by LRP. These are not
silently covered by ordinary ESSL lowering.

The original inventory contains 39 plain operations across five bodies:
17 DIV, 8 FRC, 8 LRP and 6 MAX. All six source negations occur as MAX's second
operand: four `-TEMP[n].xxxx` and two `-CONST[4].xxxx`. Preserve those two CONST
sites in the compatibility inventory even though unknown raw numeric constant
admission remains a later boundary. Every full original still contains other
unsupported semantics, including PRECISE; keep the exact 12/19 outcomes.

Use independent rational dyadics for MAX/FRC/LRP/negation, including unequal
endpoints, extrapolating LRP weights, negative FRC, source-position permutations,
swizzles, aliases and numeric/sample shadows. DIV output must be checked with
an outward rational enclosure covering the GLSL ES3.00 accuracy guarantee for
the chosen denominator range. An exact mathematical quotient does not by itself
require exact output bits. Do not infer NaN payload, signed-zero or subnormal
preservation after ordinary arithmetic, or exact CPU-executor equivalence.

Six historical C2 rejection bodies become explicit positives: negated ADD-IN,
MAX-IN and DIV-IN in both stages. Preserve each exact body in the new fixture,
and bind each adjacent replacement used to retain historical rejection slots.
The malformed two-source FRC cases must still reject; bind any unavoidable
structured error migration explicitly. All raw FSLT/FSGE modifier rejections
remain unchanged.

## Verification log

(empty)
