---
id: E6-T12g6g1
epic: 6
title: Admit exact word-local minimum selection
priority: 525.027010574
status: verified
depends_on: [E6-T12g6f]
estimate: S
risk: high
capstone: false
---

## Boundary

Add ordinary MIN and instruction-local MIN_PRECISE following the already separated MAX selection/precision model. Preserve exact operand selection/NaN/zero word contracts for private precise results and inherited ordinary output domains. No FRC_PRECISE.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6g1`: Independent selected operand words at equal values, signed zeros, normal/subnormal and NaN payload boundaries; numeric plain-MIN pixels and exact private raw captures. Test all masks, source modifiers, aliases, adjacent precise/plain instructions and source-selection faults; carry old MAX/FSEQ/FSNE precision contracts unchanged.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

### 2026-10-04 — worker — activation

Activated this S/high boundary above independently verified G6f `79cae493`.
The pinned TGSI definition gives component-wise MIN; ordinary numeric emission
uses unchanged GLSL `min` and retains existing finite numeric authority.
Instruction-local MIN_PRECISE follows the existing private MAX selection model:
choose the first original word only when it is ordered strictly smaller;
equal values, both signed zeros and unordered comparisons choose the second
original word. Negation applies before selection; private NaN payloads and
subnormals remain words and gain no new numeric/output authority. Preserve
whole previous precision, finite-bank, raster, arithmetic, conversion and
scalar obligations with one bounded outer contract. Record native/Wasm and
physical word/pixel proofs, masks/aliases/modifiers, adjacent precise/plain
instructions, source-selection sensitivity, varied seeds and one final cold
clone; submit to a fresh critic. Production negotiation and performance claims
remain gated by dependent integration tasks.

### 2026-10-04 — worker — implemented

Runtime/native harness frozen at `2412ecf2e4350cd21eadf10b3f022fdbd7e75e1d`;
final recording harness at `2be8709b05a9f6bcaf9f2a543a62d9eda37656ed`, above
verified parent `79cae493`. Ordinary MIN keeps inherited finite numeric authority
and GLSL `min`. MIN_PRECISE selects the original first word only for ordered
strictly-less comparisons, otherwise the original second word, after source
negation. The bounded v32 wrapper preserves each complete earlier policy and
does not alter old MAX/FSEQ/FSNE precision contracts, IR sizes, state consumers
or production negotiation.

Commands:

```sh
make verify-E6-T12g6g1
# Evidence-only GPU schedule/oracle and failed-report binding repair;
# repeat just the affected physical captures, retaining unchanged runtime proofs.
for seed in 1369979863 2804203833 3781791491; do
  node tools/virgl-minimum-selection/browser.mjs --output "target/evidence/virgl-minimum-selection/gpu-$seed" --seed "$seed"
done
node tools/virgl-minimum-selection/browser.mjs --output target/evidence/virgl-minimum-selection/fault-selection --fault selection
# The source fault must fail; receipt authenticates its actual failure and disposal.
python3 tools/virgl-minimum-selection/receipt.py target/evidence/virgl-minimum-selection
python3 tools/virgl-minimum-selection/cold.py --output target/evidence/virgl-minimum-selection-cold
python3 tools/virgl-minimum-selection/seal.py --hot target/evidence/virgl-minimum-selection --cold target/evidence/virgl-minimum-selection-cold --output evidence/virgl-minimum-selection/worker
```

The hot receipt records 961 native cases (917 accepted, 44 rejected), 913 actual
pinned-converter comparisons, 961 Wasm singles and pairs, 917 owned contracts,
661 metadata attacks, 16 banks and four complete inherited policy bases. All
402 bounds, 49 hexadecimal, 108 signed-integer, 1,575 signed-conversion and
1,427 scalar critic guards pass, as do 84 earlier precision cases. Retained
originals preserve 23/25 admissions; both unsupported full compositor bodies
remain rejected. The historical 112-body corpus retains its five admissions.

Three headed physical M4 Max runs independently check 166,752 words and 17,344
pixels, including all destination masks, swizzles, aliases, conditional versions,
source negations, signed zeros, private NaN/subnormal payloads, actual input and
bank updates, sync/async rendering, guard rejection before upload/draw, restoration
and disposal. Each seed checks 55,584 words; pixel counts are 6,464, 5,440 and
5,440. Unchanged primary GLSL participates only for normal/zero operands; ordinary
GLSL zero signs are unconstrained, while precise private zeros and unwritten
masked-copy lanes remain exact. Deliberately reversing the precise selection
helper fails `MIN_PRECISE/direct/owned/edge-MIN_PRECISE-0` at lane 6: expected
1056964608, observed 1056964609. Actual fault output and cleanup are recorded.

The initial full target completed runtime, native, Wasm, consumer and hardware
proofs but its receipt exposed a primary-reference schedule gap, then a failed-run
report-name binding error. Only the four declared recording/oracle files changed;
every runtime byte stayed frozen. The affected physical captures were repeated
at the final harness head; `gpu-refinement-final.log` preserves the successful
normal runs and deliberate failure. The initial `acceptance.log` and earlier
repair log are retained honestly. The receipt authenticates the two hot heads
and all unchanged runtime/source bytes rather than claiming a single original
full-target pass. One pristine clone at the final exact head, with RUST_LOG and
any RUSTFLAGS/CARGO_* removed, then passes the entire target; clean status before
and after is recorded. No second cold clone was needed.

Evidence: `evidence/virgl-minimum-selection/worker/{manifest.json,records.json,recording.tar.gz}`,
82 authenticated members, 17,813,706 archive bytes. Archive SHA-256:
`4cde54d259703ba0c62f7f70f88820fdb53faa06621f5b7b0d5f372066ebc394`;
index: `97bb60698f66009bfa1bf0fe498797b9c2601967693c61f7f9017bf18e6456a7`;
hot receipt: `1626d7928fba3db259e729293ba56fa1a0231b39be79cf4cebe04cbd86926895`;
cold receipt: `f15cf1cdaccf85b79393ecbb462cf93f8e58704ee93bbabd410ad03e7c2c37f1`.
Unsealed originals remain in `target/evidence/virgl-minimum-selection{,-cold}`.
Both actual sanitizer binaries and coverage profiles are sealed. This submission
claims only the isolated compiler/consumer boundary, with no guest boot, live
offload, FPS or MIPS claim. A fresh adversarial critic must decide verification.


### 2026-10-04 — verifier — VERDICT: verified

VERDICT: verified. Fresh adversarial session, never the implementer. Read the
complete task, AGENTS.md and scoped diff before recording falsifiable predictions
in `evidence/virgl-minimum-selection/verifier/predictions.json`. Runtime freeze
remains `2412ecf2e4350cd21eadf10b3f022fdbd7e75e1d`, final recording harness
`2be8709b05a9f6bcaf9f2a543a62d9eda37656ed`, submission `22be542a`, above
independently verified G6f `79cae493`. No implementation/harness, branch,
commit or PR was edited. Root handles policy/queue commits and recurring-gate
integration.

All 11 predictions HELD; 0 FAILED; 0 NEEDS EVIDENCE. Points below are relative
to `evidence/virgl-minimum-selection/verifier/`.

- P1-authentication — HELD. All 82 actual members, 230 hot/224 cold source rows, both actual binaries/profiles and frozen source heads authenticate. Citations: authentication.json#memberCount,authenticated,cold,runtimeSourceHashes (SHA256 45afe366db348407b8633dae84aac61a6450fc1998036fc296d3fcaf9264c347)
- P2-precise-words — HELD. Source binary32 interpretation preserves precise ordered-less selection, second-operand ties/zero/NaN payloads and all original selected bits. Citations: source-semantics.json#runs[].vertices[].vectors[].sourceOperation,predictedCarrierWords,reconstructedWords (SHA256 52c80630cb6d91bec0499d2762798174f375fa931b5b957be2aff7c1afe3349b); independent-regressions.json#native/wasm:precise-selected-* (SHA256 4d88382ca1838583203f4de2e79423f1dcfca7614df45180ba603d91b187fd3a)
- P3-ordinary-domain — HELD. Ordinary MIN retains finite numeric authority and documented zero-sign freedom; private killed versions/unsafe literals reject and untouched raw lanes remain exact. Citations: independent-regressions.json#native/wasm:MIN-killed-source-*,selected-raster-authority-*,saved-numeric-version-* (SHA256 4d88382ca1838583203f4de2e79423f1dcfca7614df45180ba603d91b187fd3a); source-semantics.json#runs[].vertices:masked,mask-*,alias (SHA256 52c80630cb6d91bec0499d2762798174f375fa931b5b957be2aff7c1afe3349b)
- P4-versions-liveness — HELD. All masks, swizzles, aliases, both source negations and conditional source versions use captured original source values; adjacent plain/precise and legacy precision inventories stay local. Citations: independent-regressions.json#native/wasm:killed-source-*,aliased-selected-output-*,adjacent-local-precision (SHA256 4d88382ca1838583203f4de2e79423f1dcfca7614df45180ba603d91b187fd3a); source-semantics.json#runs[].vertices[].vectors[].sourceOperation (SHA256 52c80630cb6d91bec0499d2762798174f375fa931b5b957be2aff7c1afe3349b)
- P5-policy-ownership — HELD. 2,606 independent hostile metadata cases reject without getters; 24 snapshots remain owned/frozen; 738 bank/prefix checks retain complete older obligations. Citations: consumer-attacks.json#metadata,ownership,banks,getterCalls (SHA256 c2807ada65a88aff9373a02c0f1a079d7f8e0324bc9db68c6c08f2dc60412e2f)
- P6-inheritance — HELD. Five previous critic seals, 242 unchanged dependency files and 15 unchanged helpers authenticate; originals, historical admissions, 84 legacy cases and all old guards carry forward unchanged. Citations: carry-forward.json#priorSeals,unchangedDependencies,unchangedHelpers,currentRecordedGuards (SHA256 cb6e801942965d01a3e639722898ad5cb9e27c0efa26f3115543a4c2d802955e)
- P7-physical-oracle — HELD. Both actual sanitizer binaries replay identical complete logs and real primary witnesses. 601 physical source programs match compiler results, actual shaderSource events bind unchanged GLSL, and independent TGSI reproduces every frozen word/pixel and guarded draw/wait. Citations: native-source-parity.json#replays,sources,fourthBindings,primaryFixtureSha256 (SHA256 91a9a30bbeb49b74f22b29c2b2fc0661e8403b90fd7ae21b94ab15a08ed55ea6); source-semantics.json#runs[].vertices,fragments,draws (SHA256 52c80630cb6d91bec0499d2762798174f375fa931b5b957be2aff7c1afe3349b)
- P8-coverage — HELD. All 32 runtime hunks/69 added lines execute or have explicit structural waivers. Both actual LLVM exports reproduce the worker counts; independent source-bound V8 coverage executes the new policy paths. No dead or unproven runtime hunk. Citations: coverage-audit.json#nativeBinaryBindings,runtimeAddedLines,v8Profiles,needsEvidence,dead (SHA256 d429dba9e5f86a653eaf8e693241fc7914093c98e8a0b206510cf61a4135f35c)
- P9-fault-cleanup — HELD. Both actual physical helper reversals contradict independent source equations at captured lane 6. The independent real C knowledge-selector reversal is caught at precise-selected-1-0-none-bit-0; all nine runs dispose objects/budgets and no owned browser process remains. Citations: sensitivity.json#physicalFaults[].point,failure; sabotage.case (SHA256 ddf5c285145d258e9e6d369568e2dd1216f26ccd5b1a9ba62f7fd73602e641c0); cleanup.json#lifetimes,matchingOwnedProcesses (SHA256 face991a42c958dccd4401a76e13fa60ba26383a5bd4ea30cc4bfe68c5a03618)
- P10-cold-head — HELD. The single final pristine clone has clean status before/after, scrubbed environment, exit zero and an authenticated full receipt at exact final harness 2be8709b. Earlier failed hot logs are retained, and all incremental changes are the declared recording-only files. Citations: authentication.json#cold,authenticated[].reports[].incrementalChangedFiles (SHA256 45afe366db348407b8633dae84aac61a6450fc1998036fc296d3fcaf9264c347)
- P11-novel-attack — HELD. Fourth headed Apple M4 Max seed 19088743 independently reproduces 55,224 words/5,440 pixels. The new 4,524-case native/Wasm test covers selected bits/lane/version/authority and kills an isolated selector sabotage. Citations: fourth-seed-semantics.json#runs[0] (SHA256 e23e31ae957392b4240e9742132b9d6607604a08a7c51e0db6bc83569c8e3bff); independent-regressions.json#cases,native,wasm,testSha256,nativeBinary (SHA256 4d88382ca1838583203f4de2e79423f1dcfca7614df45180ba603d91b187fd3a); sensitivity.json#sabotage (SHA256 ddf5c285145d258e9e6d369568e2dd1216f26ccd5b1a9ba62f7fd73602e641c0)

All 82 worker members, 230 hot/224 cold source rows, actual native/Wasm binaries,
both actual sanitizer binaries/profiles and the single pristine scrubbed cold
clone authenticate. The earlier failures are retained honestly; every intervening
change is one of the four declared recording-only files, and runtime stays frozen.
Five earlier critic seals, 242 unchanged dependency files, 15 unchanged helpers,
25 originals (23 admissions), 112 historical bodies (five admissions), 84 complete
legacy precision cases and all old promoted guards retain their HELD results.
No duplicate cold clone or unrelated gauntlet was run; the September rr waiver
applies.

Independent TGSI source execution reproduces 333,504 words / 34,688 pixels from
the six frozen hot/cold Apple M4 Max runs. Fourth headed physical seed 19088743
reproduces 55,224 words / 5,440 pixels, including real input attributes, bank
updates, every mask, aliases, swizzles, negations, conditional versions, indexed
draws/restoration, held async waiting-index plans and rejection before native
upload/index read/draw. Source binary32 mathematics and exact raw word operations
provide predictions; neither IR ordering keys nor emitted GLSL contributes.
Actual shaderSource events bind unchanged owned and actual pinned Mesa GLSL;
601 physical TGSI programs match native output. Primary comparisons stay limited
to normal/zero operands with inherited floating zero-sign freedom. Owned precise
and untouched masked raw lanes remain exact.

Coverage: 32 runtime hunks / 69 added lines execute or have explicit static-data,
declaration or delimiter waivers. Both actual LLVM exports reproduce their
recorded maps; independent source-bound V8 counts execute the new policy paths.
needsEvidence=[] and dead=[]. Both sealed ASan/UBSan binaries replay identical
complete native stdout: 961 public cases and 913 actual pinned parser/converter
witnesses each, with no sanitizer diagnostic or closed-result violation.

SUITE: promote `renderer/virgl-shader/tests/minimum-selection-regressions.mjs`
(SHA `641318a8ea3896fd078536c8c6fe11c4fe9cf118eeac1154ce6cb8a68fc5ab0f`). Its 4,524 deterministic selected-bit,
lane/version/authority, mask/alias and adjacent-policy cases have complete native
and Wasm arrays, exact parity, integer `cases`, `testSha256`, and
`nativeBinary.sha256` under schema `virgl-minimum-selection-critic-guards-v1`.
Full report SHA `4d88382ca1838583203f4de2e79423f1dcfca7614df45180ba603d91b187fd3a`; native binary SHA
`2989b67216117b3a42dc4dd547434022e27cd94ed0498b515493cfb8553a56b5`.
The isolated actual C selector-order sabotage is caught at
`sabotage-regressions.json#failure.counterexample`, case
`precise-selected-1-0-none-bit-0`: a=1, b=0 must select word0, whose bit0 projection
may rasterize. The mutant instead selects subnormal1 and rejects the program.
Both actual emitted-helper faults contradict independently interpreted physical
lane6 predictions (1056964608 expected, 1056964609 observed) and dispose objects.

Additional independent attacks: 2,606 hostile metadata cases, 738 bank/prefix
checks and 24 owned/frozen snapshots, with zero getter calls. All nine physical
success/failure runs close native objects and state/resource budgets; no owned
Chrome profile remains live. One critic expectation correction is retained in
`expectation-correction.json`: legacy precision policy names FSEQ/FSNE/MAX/MOV
do not include the instruction spelling's _PRECISE suffix. This was a critic
test expectation error and did not refute product behavior.

Node/Python syntax, source/record authentication, native replay, LLVM/V8 audit,
independent native/Wasm guards, TGSI-derived physical semantics and
`git diff --check` pass. Reopening commands are in verifier README.md.

Verifier seal at `evidence/virgl-minimum-selection/verifier/`: `manifest.json`,
`records.json`, `recording.tar.gz`; 63 actual members,
6,772,063 archive bytes. Archive SHA
`aedf4c1401b7e985b399350ab9648d6ec981d591692ce3dbce1e95fabc8bd4ff`;
index SHA `7a9bca57207672121cea1f0d17c76b788cb7813b1fd8d736e68ca13321020b98`;
verdict SHA `9ea000f3e35e50058155692a40923b58eb5fab4d0ffb6e190111739f86c4e8dc`.
Every member and verdict citation was reopened and length/SHA authenticated.
The seal preserves independent records/scripts/captures/profiles and actual
mutant binary/source, referring to immutable worker/prior-seal dependencies
for unchanged sources and original recordings. No remaining contradiction or
proof gap. Production negotiation, complete compositor admission, guest boot
and FPS/MIPS remain gated by later tasks.

### 2026-10-04 — worker — critic test integration

Integrated the fresh critic's 4,524-case test into the recurring acceptance target
and bound its exact schema, source digest and complete native/Wasm arrays in
the receipt. The focused command
`node renderer/virgl-shader/tests/minimum-selection-regressions.mjs --native renderer/virgl-shader/build/native/virgl-shader --output target/evidence/virgl-minimum-selection-promotion.json`
passes; its report is byte-identical to the critic's authenticated independent
report SHA `4d88382ca1838583203f4de2e79423f1dcfca7614df45180ba603d91b187fd3a`.
Root reopened all 63 verifier members, every verdict citation and the promoted
source snapshot, matching the index/archive/verdict and test digests. Node,
Python and shell syntax plus policy/diff checks pass. These are test/recording
integration changes only; runtime and dependency bytes, prior HELD results and
the single final pristine-clone proof remain unchanged. No broader rerun or
second cold clone was required. Verification is the fresh critic's verdict.
