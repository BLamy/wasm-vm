`make verify-E6-T12g6m` proves both larger literal compositor pairs. It retains
the verified whole 403b/c580 body, the old nineteen bodies and G6a's four new
bodies through native, Wasm and physical runs, then records the entire original
716-instruction 7bf4/92cb body under all three captured paired banks.

The new entry authenticates both complete source byte strings, all 2,040 bytes
of captured geometry and the exact single-sample RGBA32F strip state. Both
texts and selected raw bank words are owned before the first real allocation.
No truncated source, caller-provided certificate or public compiler retry can
select the new flag. Ordinary and ordinary-exact full 92cb remain rejected;
production negotiation, renderer imports and live guest claims remain disabled.

Dynamic POW reads both post-modifier scalar operands before publication.
Emitted code rejects negative/nonfinite/subnormal bases, nonfinite/subnormal
exponents, and zero with a nonpositive exponent. Integer binary exponents
conservatively bound log2(base); their magnitude times abs(exponent) must be
at most 119, leaving a unit of margin inside the previously measured 120
envelope. Zero returns exact +0; valid nonzero operands use host pow. A guard
failure yields an explicit -30000 diagnostic rather than a numerical result.
It supplies no static word, indirect-index or conversion authority.

Only original pcs 231/260/293/319 may replace a negative fade power with zero.
In this complete pinned source and bank, each value is consumed solely by a
UCMP whose next predicate selects exact zero whenever radius > CONST7 +
CONST5. A negative fade means precisely that condition. Neither the power nor
its arbitrary undefined value reaches an observable output. The full source
and bank pins protect the producer, consumer, masks and versions together.
This does not admit negative power bases elsewhere.

[Mesa TGSI](https://docs.mesa3d.org/gallium/tgsi.html#pow-power) specifies the
scalar replicated power and raw conditional select.
[GLSL ES 3.00](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
sections 8.2 and 4.5.1 define pow's invalid inputs and highp arithmetic.
Accuracy here is a measured M4 Max budget, not a portable guarantee from pow's
specification. The complete program's outputs must match the handwritten
color/corner/edge/discard equations within 0.0001 absolute error. Each defined
observed POW is independently checked against its observed scalar operands
within 2^-14 relative error. The primary output oracle never reads GPU output
or generated GLSL to construct an expected pixel.

An additional diagnostic attachment records every actual base/exponent/result
at each of the 29 live original power sites. Diagnostic mode retains probes
at original KILL; default mode executes the original discard and output path.
The receipt replays complete compressed raw readbacks for every pixel/site,
including masked negatives and unreachable branch sites. The same emitted
guard runs against 22 literal independent boundary predictions. Five invalid
operand injections must produce the guard's specific fault sentinel; output,
discard and power sabotage must fail the primary/power equations. Source,
geometry, bank, reflection and draw-state mutations stay closed.

The GL context, Wasm compiler and physical work live in a dedicated worker
with its own OffscreenCanvas. Page WebGL hooks cannot reach the draw. Trusted
hash-bound worker code is the boundary; privileged debugger modification inside
that worker is outside this claim. No future production DRAW, FPS or MIPS
authority follows from this isolated acceptance.

After committing the source, run the gate, then `python3
tools/virgl-original-programs/cold.py target/evidence/virgl-original-programs-cold`
and `python3 tools/virgl-original-programs/seal.py
target/evidence/virgl-original-programs target/evidence/virgl-original-programs-cold
evidence/virgl-original-programs/worker`. Hand the exact source/diff/seal to a
fresh adversarial verifier before the G6 integration task activates.
