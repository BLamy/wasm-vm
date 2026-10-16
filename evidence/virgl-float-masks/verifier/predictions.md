# E6-T12e4c1 independent pre-evidence predictions

Prepared after reading the task and runtime/harness diff against verified E4b
`7be4e09748bc4acfcdf167bd66cd6f3d890132d5`, before inspecting any E4c1
worker run output. The current implementation is not frozen yet; this document
will remain unchanged. Final findings and source bindings will be separate.

## Predictions

1. **Ordered semantics.** For any two raw binary32 encodings, FSLT is all ones
   exactly when neither operand is NaN and the represented real value of the first
   is smaller. FSGE is all ones exactly when neither is NaN and it is greater or
   equal. An independent sign/exponent/significand oracle must agree with the
   C abstract evaluator and actual GPU execution for explicit edges and new seeds.
2. **Unordered.** Either signed quiet or signaling NaN in either operand makes
   both operations zero, including same-encoding NaNs and differing payloads.
   Removing the unordered guard must compile/link but fail a recorded GPU check.
3. **Signed zero.** All four positive/negative zero combinations give FSLT=0 and
   FSGE=0xffffffff. Removing zero equivalence must fail actual GPU results.
4. **Negative order.** Negative adjacent normals, subnormals, normal/subnormal
   boundaries, and negative infinity sort in reverse magnitude order. A sabotage
   that sorts negative magnitude forward must fail actual GPU results.
5. **Positive order and infinity.** Positive adjacent normals, all boundary
   classes, and positive infinity sort by exact represented value, without
   subnormal flush or NaN canonicalization affecting raw private data.
6. **All bits.** Every true comparison yields all 32 one bits, not numeric 1.0 or
   uint 1. Complete VS transform-feedback byte carriers and FS bit-plane captures
   reconstruct the oracle word; selection/AND/OR/shift consumers retain it.
7. **Integer contrast.** USEQ distinguishes positive and negative zero and treats
   identical NaN bits as equal, while ordered comparison treats zeros equal and
   NaNs unordered. ISGE remains signed-integer semantics on the same payloads.
8. **Aliases and partial writes.** All consumed source lanes come from the state
   before an instruction. Masked/swizzled self aliases cannot observe an earlier
   destination-lane write. Unwritten unconsumed lanes do not invalidate a shader;
   any consumed uninitialized lane causes a bounded rejection and exact recovery.
9. **Known-bit safety.** Constant comparisons produce exact known masks; dynamic
   comparisons discard float-origin authority. Abstract facts are conservative
   for every independently concretized seed/schedule. A true raw all-ones mask or
   unknown mask cannot pass directly through the float output guard; a proven
   zero or a proven finite-normal selection can. Signed zeros remain allowed.
10. **Profile selection.** Valid new opcodes select v3; v3 takes precedence over
    existing v2. Inputs without new opcode tokens preserve exact v1/v2/v5 output
    bytes. Mere comments, prefixes or invalid new opcodes cannot authorize a
    successful v3 program, and a failed v3 attempt cannot contaminate recovery.
11. **Interface scope.** Mixed v5/v1/v2/v3 pairs preserve the checked semantic,
    component and smooth/flat contract. The returned FS equals the standalone FS
    exactly. Partial GENERIC interfaces keep vec4 declarations and execute with
    correct independently expected covered/uncovered pixels.
12. **Float interface caveat.** Inputs are interpreted as whatever bits the float
    interface delivered. The implementation does not claim raw NaN/subnormal
    transport across that interface. Dynamic exceptional values in proof are
    delivered through integer uniforms; ordinary finite IN values remain valid.
13. **Historical migrations.** Exactly six formerly unsupported FSLT/FSGE case
    texts are promoted, with exact old text and result bound to the parent and
    exact new v3 result. Adjacent FSEQ/FSNE replacements remain unsupported.
    Every other historical case retains its exact serialized result, all 19
    originals remain exact, and older receipt code is not weakened.
14. **Bounds.** IR remains 26,232 bytes, instruction 112, source 24. Text, token,
    bank, instruction, GLSL, result, fixed 16 MiB Wasm and 256 KiB stack bounds
    remain unchanged. Excess shader output must reject without partial output,
    and both owned allocation failures must recover exactly without heap growth.
15. **Gated features.** Numeric ADD/MUL/MAD/TEX mixed with raw opcodes, PRECISE,
    unsupported comparisons, control flow, address/indirect operations and
    sampler declarations remain bounded errors. No production negotiation flag
    or guest integer-constant transport changes in this slice.
16. **Native/Wasm parity.** Independent authored inputs return exact full JSON
    parity between sanitizer-native and the frozen Wasm, including malformed
    operands and repeated successful recovery. No sanitizer violation occurs.
17. **Coverage.** Every newly executable C line and meaningful branch is covered
    by a source-bound final run or an explicit verifier attack. Existing guard-
    excluded dead operand alternatives may retain narrowly applicable waivers;
    no new semantic branch is waived merely because the happy path passed.
18. **Regression and isolation.** Prior HELD results whose implementation and
    evidence dependency remain unchanged are carried forward. The required
    current legacy/raw/integer/constant/async gates pass without deleting their
    negative assertions, and all browser GL objects are released without errors.
19. **Independent sabotage.** A separately authored actual-GPU probe with new
    operands, aliases and signed edge data passes intact; at least one targeted
    source corruption compiles and links, then fails an independently computed
    raw result at a named capture. A compile failure alone is insufficient.
20. **Evidence binding.** Final records name the frozen source commit, sources,
    fixture and Wasm hashes. All referenced digests recompute. A scrubbed pristine
    clone of the final frozen head passes once and produces identical Wasm.
    Evidence claims remain scoped to private raw-word shader lowering; no Mesa,
    desktop responsiveness, FPS or MIPS claim follows from this work.
