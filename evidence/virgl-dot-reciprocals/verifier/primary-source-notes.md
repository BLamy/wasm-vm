# Independently inspected scalar and precision contracts

Primary sources accessed 2026-10-03:

- Mesa TGSI documentation: https://docs.mesa3d.org/gallium/tgsi.html and cached Mesa26.2.2 source files listed and hashed in `primary-source-digests.json`.
- Khronos GLSL ES3.00 revision6: https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf, section4.5.1 printed page52/PDF index58; section8.2 printed page88/PDF index94.

Mesa26.2.2 TGSI docs at RCP103, RSQ112 and DP3176 specify one x reciprocal/inverse-root and an xyz dot, then replication. RSQ for nonpositive inputs is undefined. Interpreter `tgsi_exec.c`:2869–2888 loads source x before writing enabled lanes; DP3 at3025–3052 fetches xyz before any write. Opcode metadata entries4,5,10 use REPL. `tgsi_util.c`:94–108 and133–135 supply x and xyz masks. The checked repo vendor still classifies RCP componentwise (`tgsi_util.c`:185), and `vrend_shader.c`:5675 emits reciprocal on the supplied whole vector. The owned scalar rule deliberately resolves this discrepancy in favor of the documented/interpreted TGSI contract; the limitation is disclosed. Exact capture inventory is preserved in `native-audit.json` and includes four DP3, two RCP and four RSQ within PRECISE-bearing originals.

Khronos specifies2.5ULP division accuracy for positive divisors from2^-126 through2^126 and2ULP inverse-root accuracy. The current independent controls use only that quantitative domain. The derived oracle uses exact fractions and integer-square-root brackets; it does not treat an exact mathematical root as exact implementation bits. Correctly representable DP3 products/sums are checked under every pairwise association before exact output assertions. Computed zero signs may interchange. No payload, subnormal-retention, nonpositive-RSQ or cross-stage equality assertion follows from this proof.

GPU witnesses and mutation builds are source-bound in `builds.json`, `current-gpu-inputs.json` and `current-gpu-check.json`; generated GLSL is actual public-API output from separately built libraries. Sabotage libraries change only the isolated source snapshots under a temporary directory; the shared implementation is untouched.
