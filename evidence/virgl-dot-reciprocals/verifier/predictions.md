# Fresh scalar verifier predictions (written before current results/evidence inspection)

Task E6-T12e6; parent 3adaa72f95fd88b8fefd5caa32d6407df22af1dd.
Scope is isolated ordinary compiler semantics, not guest/Mesa acceleration.

- P1 scalar lanes: DP3 needs post-swizzle xyz even writing only x or w, ignores post-swizzle w; RCP/RSQ need post-swizzle x even writing only w, ignoring yzw. Missing consumed initialization or authority rejects, missing ignored lanes does not.
- P2 GPU scalar and alias behavior: independent dyadic xyz dot controls with poison w produce the rational xyz sum replicated to every written lane. Nonbroadcast swizzles and typed negation occur before the scalar operation. A partial aliased write reads all operands before publication and leaves unwritten lanes byte-identical.
- P3 reciprocal GPU enclosure: positive normal RCP outputs lie within exact reciprocal plus/minus the specified 2.5 ULP, and RSQ within an integer-square-root rational bracket plus/minus 2 ULP. Exact mathematical roots do not imply exact emitted bits. Replicated lanes equal within each invocation.
- P4 authority/domain boundary: unknown raw numeric CONST and TEMP consumed lanes reject; authenticated input/shadow and statically normal/signed-zero operands admit. Signed/zero ordinary numeric inputs do not acquire new finite/positive admission restrictions. PRECISE/absolute/saturation/legacy-math remain rejected. No fabricated exceptional payload/sign guarantee.
- P5 compatibility: exactly two source-bound historical DP3 bodies change from rejection to v6 success. All other complete preceding results, four malformed two-source RCP/RSQ errors, profiles and all 19 full originals remain identical; originals remain 12 successes/7 PRECISE rejections.
- P6 source discrepancy: contemporary Mesa documentation/interpreter/metadata source consumption confirms xyz DP3 and scalar x RCP/RSQ; pinned VirGL componentwise RCP discrepancy remains documented. Capture inventory is four DP3/two RCP/four RSQ, all in unchanged PRECISE originals.
- P7 adapter: independently reconstructed VGC5 stream equals worker bytes after exactly the two declared adjacent-negative substitutions. Harness/helper code, all old complete results, 12/10 anchors, four seeds, totals and output digests stay exact. Mutating a name, transform, full result, stream, anchor, seed or digest is rejected by the receipt validator.
- P8 limits/coverage: instructions stay 112 bytes, IR 26232, opcode negation bit21 remains reserved and new ops use22..24, 179 instruction and16MiB memory bounds remain. Every changed runtime hunk executes or receives an explicit nonbehavioral waiver. Native/Wasm parity and current full C2/GPU predecessors are evidence-bound.
- P9 sabotage/novel attack: modifying DP3 reduction to xy or reciprocal source/operation makes independently derived hardware expectations fail; varying all destination masks and source selector permutations cannot change which post-swizzle lanes are consumed.
- P10 final: final frozen worker receipt and pristine clone bind identical sources and inputs; no test suppression, patched expected values, environment reuse or stale GPU output can satisfy the claim.

Final verdict is deferred until frozen worker and clean-clone evidence are provided.

## Frozen harness/oracle audit predictions — 72a8695ba92d734a6bead0c42ead3089d8611806

Written before reading frozen worker output:

- P11 independent math: every authored reciprocal/texture lane has a correctly directed rational enclosure, positive exact-binary32 divisor, exact scalar source selector, and within-invocation broadcast group. Altering the denominator, root bracket, ULP radius, bound direction, reconstructed word or lane equality must fail independent validation.
- P12 oracle scope: exactness is required only for proved dyadic DP3 controls/untouched lanes. Normal RCP/RSQ outputs use enclosures even when exact mathematical answers exist. Nonpositive RSQ/NaN/subnormal observations impose no fabricated payload or equality guarantee; zero-divisor RCP requires only the justified infinity class.
- P13 transcript binding: each scalar native/Wasm/compiler fixture, quantitative program, actual attribute/uniform upload, texture, feedback/bitplane, sabotage capture, GL-object balance and current source identity binds to the frozen head. Omitting/duplicating a workload or altering GPU bytes with matching local claimed expectations cannot make the verifier succeed.
- P14 final isolation: the cold command starts from the exact committed tree with scrubbed RUSTFLAGS/CARGO_*/RUST_LOG, emits actual new full acceptance evidence, and proves the same actual compiler and source/input identity; no copied historical receipt replaces execution.
