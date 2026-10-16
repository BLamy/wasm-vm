# Fresh E6-T12e5 verifier predictions (before evidence inspection)

Worker source/diff inspected against 67ca333c05fb70d719c49b3dc5cb8c1f8bb2f6de; final frozen worker evidence is pending. These are predictions, not results.

1. Each plain DIV/MAX/FRC/LRP and numeric-source minus in ADD/MUL/MAD/new operators/TEX coordinates selects raw-bits-v5 even without an integer opcode. Checked ESSL uses ordered division, max(a,b), fract(a), and mix(c,b,a), and applies minus after swizzle selection.
2. Original IN and computed/sample float-shadow sources remain admissible without denominator, value-range, finite, or LRP-weight guards. Unknown raw CONST or overwritten TEMP does not acquire numeric authority; safe finite-normal/signed-zero raw words do.
3. Partial writes validate only consumed swizzled lanes and snapshot all operands before publishing raw and float destination lanes. A later integer overwrite invalidates only its touched float authorities; a later numeric use cannot read stale shadows.
4. PRECISE, LEGACY_MATH_RULES, abs, saturation, repeated signs, unary plus, and minus on MOV/UCMP/raw comparison/integer/sampler operands reject with structured errors and no partial output.
5. Parent valid shaders retain complete serialized responses and exact profiles. Only six explicitly bound historical numeric rejection bodies are admitted; malformed two-source FRC continues rejecting and all original captured full results preserve 12/19 outcomes.
6. Independent rational expectations distinguish division reversal, floor from truncation in negative FRC, LRP endpoint reversal/extrapolation, negation source positions, aliases, and partial writes. DIV is judged by outward GLSL ES3.00 highp error enclosure, not exact quotient bits. Exceptional arithmetic has only the explicitly documented ordinary ESSL guarantees.
7. Worker native/Wasm/browser evidence is bound to frozen source/binary hashes, has exercised every changed runtime branch (or justified nonsemantic waiver), preserves bounded storage/recovery, fails a meaningful source-bound sabotage, and passes one final pristine clone.
8. Novel bounded attack: alternate float-producing writes and integer/raw writes in separate lanes, then use negated cyclic/swizzled numeric sources. Defined lanes must retain correct authority; an unauthorized overwritten lane must reject. Probe every new numeric operator/source position and all admitted write masks.

Final verdict is withheld until exact-head worker and cold-clone submissions are received.
