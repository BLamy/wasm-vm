# Instruction-local numeric saturation evidence

Only the captured MOV_SAT and DIV_SAT spellings are added. The pinned Mesa
24.2.8 TGSI specification defines saturation as destination clamping to [0,1]
(lines 42 and 3003–3004), after the underlying operation. The untouched pinned
converter applies its clamp at vrend_shader.c lines 6148–6149.

Every written post-swizzle source requires the existing numerical authority.
Arbitrary private raw results cannot borrow it through saturation. Negation is
instruction-local and precedes the operation. Every aliased source lane is
snapshotted before writes. Ordinary MOV and DIV remain unchanged; other
saturation/precision combinations remain closed rejections.

DIV_SAT additionally requires a fully known normal denominator at its exact
post-modifier source version, with magnitude in [2^-126,2^126]. Unit magnitude
preserves the existing numerical domain. A nonunit divisor requires a known
normal-or-zero numerator; nonzero exponent differences must be in [-124,125],
conservatively excluding underflow and overflow boundaries. Unknown divisors
and unknown nonunit numerators are rejected. The clamp supplies no static
computed F2I range facts.

Negative divisors are sign-canonicalized exactly before ordinary numerical
division. The independent BigInt and Python Fraction oracles use the 2.5-ULP
highp division bound in the [ESSL 3.00 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf),
section 4.5.1, printed page 52. `precision-source.json` pins its document digest
and domain. Exact copies and saturated plateaus are separate from quotient
budgets. Saturation and ordinary DIV retain the permitted interchange of numerical
signed zeros in the same section; raw MOV and untouched copy lanes preserve
exact words. The pinned converter follows its existing numerical zero policy. No new exact
promise or authority is created for special/subnormal numerical sources.

The declared physical schedule covers both private and pinned Mesa shaders,
all masks, source aliases and versions, signed denominators, bank changes,
modifiers, literal and attribute sources, all 32 fragment bit planes and all
32 result bits reconstructed from two finite transform-feedback carriers.
Four exact captured SAT statements are isolated and exercised on both backends.
This is not admission of the complete original compositor bodies.

Native ASan/UBSan and Wasm prove 1,313 predetermined cases and 1,245 actual
pinned TGSI parser/converter witnesses. Hostile metadata must retain every
whole prior bank, range, scalar, minimum and precise-fraction obligation.
Sync/async real consumers own A/B/A banks and restore them; rejected nonfinite
wire updates leave state and physical uniforms unchanged; all GL and renderer
objects are disposed. Real emitted-source faults delete either clamp bound or
move it before division and must contradict the independent physical oracle.

`make verify-E6-T12g6h` also replays 2,933 whole predecessor responses and
promoted critic guards. The fraction capture oracle carries its authenticated
unchanged 36,096-word hardware evidence and actual faulty capture. Run final
acceptance at the frozen commit, one pristine scrubbed clone with `cold.py`,
then `seal.py`; submit the diff and seal to a fresh adversarial critic.
Production negotiation, guest caps and live imports remain disabled. This
private boundary makes no guest-offload, FPS, MIPS or deployment claim.
