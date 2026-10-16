---
id: E6-T12g6e
epic: 6
title: Admit bounded signed integer and float conversions
priority: 525.027010572
status: verified
depends_on: [E6-T12g6d]
estimate: S
risk: high
capstone: false
---

## Boundary

Add I2F/F2I with explicit binary32 rounding and a documented TGSI-defined conversion domain. Preserve typed private/raw shadows and numeric/output provenance. Implement or reject out-of-domain values before any undefined GLSL conversion; no SIN/POW/TRUNC opcode.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6e`: Independent word equations and pinned Mesa differentials for signed endpoints, representable neighbors, ties, fractional truncation, both zero signs and forbidden/nonfinite inputs. Native/wasm and physical GPU source/modifier/lane cases. Bind any required range/typed-bank contract through all synchronous/async consumers; unsafe runtime banks must not issue draws.

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

Continued the user's guest graphics offload work above independently verified
G6d `7f2cdec8`. Only this S/high conversion boundary occupies the active lane.
Pinned TGSI I2F suggests nearest-even while leaving rounding unspecified; this
profile chooses explicit binary32 nearest-even. F2I truncates toward zero only
for finite encodings below positive2^31 or at most negative2^31. Use bounded
unsigned word helpers and static known-bit range proofs; unknown direct,
unmodified constant operands require exact component-bank range guards before
all sync/async uploads, restorations and draws. Reject other unproven computed,
input or indirect sources. Float source modifiers apply only to range-proven
F2I encodings; integer I2F modifiers remain unsupported. Preserve the fixed IR
layout and all preexisting profile obligations in bounded conversion wrappers.
Integer outputs stay private; explicit I2F results receive normal/zero numeric
and output authority. Record endpoints, rounding ties, fractional truncation,
subnormals/zero signs, masked/swizzled aliases, source versions, joins, physical
words/pixels, changing banks and deliberate rounding/range/source faults. The
complete captured compositors remain gated until their own full-shape range
proof and remaining opcodes. No production imports/caps or MIPS/FPS claim.

### 2026-10-04 — worker — implementation freeze

Added unsigned C/GLSL conversion helpers, static bit-range proofs and direct
constant component obligations without enlarging the fixed IR. Conversion
profiles v29/v30 preserve their entire v1..v28 base metadata. The state renderer
uses one owned complete prefix for base and conversion checks before sync/async
uploads, restoration, index access and draws. Synthetic private browser paths
exercise source modifiers, input words, aliases, joins, masks, changing banks,
actual indexed draws, reflection pruning, held async plans and zero budgets.
The final recording target is `make verify-E6-T12g6e`; its source-only rational
oracle and independent Python binary32 receipt never derive expected pixels
from emitted GLSL. Deliberate rounding/truncation/helper and real range-guard
faults are rejected by those oracles. Pinned Mesa word differentials exclude
float-TEMP NaN/subnormal payload cases; owned evidence retains all defined
words. No production/demo import changes, so the public demo gate is not yet
applicable. Final exact-source evidence and independent verification follow.

### 2026-10-04 — worker — recorded submission

Frozen runtime/harness source `2e67fac91552702add11c701f61d6c4c0af2260c`
(runtime freeze `c4b811d7686e4fa59706324fcec6c3eecdc559d0`), above verified
G6d `7f2cdec89ca53b37bac120538bb168aaa153d62f`.

Commands: `make verify-E6-T12g6e`; evidence-only serialization repair followed
by `node tools/virgl-signed-conversions/consumer.mjs
 target/evidence/virgl-signed-conversions/native/report.json
 target/evidence/virgl-signed-conversions/consumer.json`, Node syntax/Python
compile checks, and `python3 tools/virgl-signed-conversions/receipt.py
 target/evidence/virgl-signed-conversions`; `python3
 tools/virgl-signed-conversions/cold.py --output
 target/evidence/virgl-signed-conversions-cold`; `python3
 tools/virgl-signed-conversions/seal.py --hot
 target/evidence/virgl-signed-conversions --cold
 target/evidence/virgl-signed-conversions-cold --output
 evidence/virgl-signed-conversions/worker`.

The original hot run passed every runtime/physical check but its receipt
caught evidence serialization invoking rejected metadata getters. The only
repair touched `consumer.mjs`/`receipt.py`; no runtime source changed. Reran
that missing proof (324 contracts /7,849 forgeries /9 owned banks /4 preserved
base wrappers /zero getter calls). The receipt carries earlier immutable
runtime recordings only after an ancestor diff restricted to those two
harness files and exact served-source digests. The final pristine scrubbed
clone ran the entire acceptance at `2e67fac9`, with clean checkout before/after.

The recording proves 364 native singles /325 actual pinned parser/converter
witnesses /364 exact Wasm singles and closed pairs; ASan/UBSan, repeat/recovery,
retained 25 originals with23 admissions and unchanged source/metadata;
402 bounds,49 hexadecimal and108 signed-selection promoted guards. Three
physical-GPU seeds checked 114,408 words and37,568 pixels, with no browser
errors and all native objects/budgets disposed. Each seed includes all32
result bits/planes, source modifiers/versions/aliases/joins, actual input
attributes, four changing-bank consumer rigs and four actual indexed-draw
rigs. Unsafe finite F2I banks reject before upload/index access/draw, complete
prefix checks survive reflection pruning, and approved snapshots survive
caller mutation and actual async index waits. All prior loop/radial/raster/
precise obligations remain intact. Independently recomputed helper coverage
from the authenticated binary/profile records is in
`hot/native/coverage-helpers.json`: all29 lines /28 branches /61 regions
executed; helper counts1,414 I2F /1,342 range proofs /1,158 F2I.

Deliberate fault points: `hot/fault-rounding/report.json` carrier lane5
expected1056964610, observed1056964609 (SHA
`41df8851b593bf668b0568c8bd0e5956e56f102b9d92add975a530cd95723024`);
`hot/fault-truncate/report.json` lane5 expected1065353215,
observed1056964609 (SHA
`f007f0e9d01ddc18daedfcaf90510996d20de7102e0f1c4724850d1c14f89115`);
`hot/fault-range/report.json` independent intercept stopped
`uniform4uiv` at bank word181 =0x4f000000 before any unsafe native effect
(SHA `6eef61c9afa4b348e8cc60b1c77445cd1fb70b3687d17b03f5e4b8ed18229e16`).

Evidence: `evidence/virgl-signed-conversions/worker/{manifest.json,records.json,
recording.tar.gz}`:81 authenticated members, archive11,907,860 bytes /SHA
`0302fd33c25937206456e6549502f89122fdb73f622c920c573be8bc4da6b336`;
index SHA `b7028f12a864bc0b716ce20ad870caaa0a771a617bf82df1c17696e720edc833`;
hot receipt `07ee905bfc1214795cef35cee3d0766508f994b0362203ab55d5a9781a21379d`;
cold receipt `d049394dc76b82cb6cb58715db4cd7c0a7dae7f2ce2b6c8006c09c63ed8b80fb`.
Pinned Mesa raw TEMP comparisons remain restricted as documented; owned
checks cover all defined words. The two complete compositor programs,
production imports/caps, guest boots and MIPS/FPS remain outside this claim.
A fresh critic must set the verdict before G6f can activate.


### 2026-10-04 — verifier — VERDICT: verified

Fresh adversarial session, never the implementer. Read the complete task and
scoped diff before predictions and evidence. Report points below are relative
to `evidence/virgl-signed-conversions/verifier/`; `predictions.json` preserves
the predictions recorded before inspecting their state.

All 11 predictions HELD; 0 FAILED; 0 NEEDS EVIDENCE.

- P1 — HELD. Archive/index/member hashes and every receipt source match the named frozen commits; hot runtime is an ancestor with only the two harness repair paths changed and cold is exact2e67fac9, pristine and scrubbed. Citations: authentication.json#members[0..80],sources.hot,sources.cold,incrementalDiff,coldReport (SHA256 ab172454d7925dcbcd936484755c34a1f5d34f7cf839021998d6ad9f45968f0c), cold-binary-binding.json#sha256 (SHA256 f1bd656aaa315bdaae978637c35c3a7825eee2a4d3e7e03059e9990af58722ff)
- P2 — HELD. For each authenticated GPU vertex source, independently interpreting signed32 I2F gives nearest-even including +/-2^31, +/-1 and tie parity; raw feedback equals source-derived position and two exact finite carriers of all32 result bits. Citations: source-semantics.json#runs[0..5].vertices[].expectedWords/all32bits/resultSha256 (SHA256 e08f8281050998da98e85c5c7ea0c2e8a410c206509239195c2a4d2faa9b99e2)
- P3 — HELD. F2I truncates finite binary32 toward zero; +2^31, the next negative word below -2^31, NaNs and infinities are rejected before any emitted conversion or native effect; -2^31, both zeros and subnormals remain defined. Citations: independent-regressions.json#native[672]:range-cube-1325400064-0-identity-x;native[].feasibleWords (SHA256 90e23221b81f0fe3a3f0e4126fae2e038f995b9d9c48e20b2abb130d90462096), source-semantics.json#runs[].vertices: F2I endpoint/zero/subnormal words (SHA256 e08f8281050998da98e85c5c7ea0c2e8a410c206509239195c2a4d2faa9b99e2), consumer-attacks.json#words[].predicted/observed (SHA256 bd54a19e724ca6c3c45d676388e522e6eb14bf154429ed0b4292ce8b006282b7)
- P4 — HELD. Source modifiers, post-swizzle masks, in-place aliases, old/new versions and joins use pre-instruction words and preserve private integer provenance; unproven computed/input/indirect or modified dynamic F2I sources reject. Citations: independent-regressions.json#native/wasm: all1,575 range-cube/modifier/mask/version/join cases (SHA256 90e23221b81f0fe3a3f0e4126fae2e038f995b9d9c48e20b2abb130d90462096), boundary-attacks.json#native/wasm:20 indirect/modifier/lexical/opcode cases (SHA256 14b9b6f724b208407937a90c6dcf82b746f06f5aeaa297068b83d0343470ad9c)
- P5 — HELD. Every native/Wasm single and pair has exact parity; rejections publish no GLSL/metadata; pinned Mesa tokens have signed->float I2F and float->signed F2I and actual Mesa GPU output agrees inside its documented normal/zero TEMP scope. Citations: native-source-parity.json#nativeCases[0..727],physicalUniqueSources=1136 (SHA256 e23f0bd8b28e556b7d44df662ea47b5a89c4049fd7a5d3fe706900dd7adf0d07), carry-forward.json#retained,unchangedBoundaries (SHA256 bc84f0e7928c3b2c3d8ed14005bef2056e53c04996042f7fb77a5d29f4fabc9d)
- P6 — HELD. Each fragment source produces independently derived all32 RGBA8 result bit planes, and each real indexed draw derives pixels from source words, with actual float/uvec4 reflection and full declared-prefix ownership. Citations: source-semantics.json#runs[0..5].fragments[].expectedRGBA/resultSha256,draws[].expectedRGBA/resultSha256 (SHA256 e08f8281050998da98e85c5c7ea0c2e8a410c206509239195c2a4d2faa9b99e2), fourth-seed-semantics.json#runs[0].vertices/fragments/draws (SHA256 22bd2461061fb3bb1fde73b5b9d438494cf4ff11f3b01704f005eb1c2a2b1ff8)
- P7 — HELD. All conversion metadata forgeries reject without invoking getters, base policies remain byte-identical, and dynamic F2I domain components equal the union of consumed post-swizzle source lanes. Citations: consumer-attacks.json#metadata[0..1790],banks[0..42],getterCalls=0 (SHA256 bd54a19e724ca6c3c45d676388e522e6eb14bf154429ed0b4292ce8b006282b7), authentication.json#members:hot/consumer.json and cold/acceptance/consumer.json (SHA256 ab172454d7925dcbcd936484755c34a1f5d34f7cf839021998d6ad9f45968f0c)
- P8 — HELD. Both stages and sync/async state consumers reject forbidden banks before upload, index access and draw; restored banks and owned async plans survive caller changes/actual index waits; budgets and physical objects return to zero. Citations: source-semantics.json#runs[].guardedAttacks=20,asyncWaits=2 (SHA256 e08f8281050998da98e85c5c7ea0c2e8a410c206509239195c2a4d2faa9b99e2), fourth-seed-semantics.json#runs[0].guardedAttacks/asyncWaits (SHA256 22bd2461061fb3bb1fde73b5b9d438494cf4ff11f3b01704f005eb1c2a2b1ff8), cleanup.json#matchingLiveProcesses=[],physicalLiveObjects=0 (SHA256 92411a48809295ded48592132cf768b3982698e5f4100ff79fa2eb26c96147db)
- P9 — HELD. Authenticated LLVM and V8 count records execute each changed runtime hunk; unexecuted paths can only be waived as static structure/error fallback with independently bounded rejection proof. Citations: coverage-audit.json#hunks[0..54],runtimeAddedLines[0..235],helperCoverage/helperFunctions;needsEvidence=[],dead=[] (SHA256 a2b43b572b2591bd1ef3110ff4919eff0f5f72a5eb8d861b28929dd8ef44f7bf)
- P10 — HELD. Deliberate rounding, truncation and real component-guard source faults contradict independent source-derived words/range; the promoted regression fails when a real source range-proof mutation admits +2^31. Citations: sensitivity.json#physicalFaults[0..5],sabotage.case:predictedfalse/actualtrue at positive2^31 (SHA256 60aadd4b351149885b085718e7de471615b13212c37a827dcbc2129cba15cd52)
- P11 — HELD. A bounded novel attack of signed range known-bit cubes, masks/modifiers/joins and output-version escapes matches independent range/provenance expectations on scratch native and Wasm binaries; a fourth physical seed also retains all exact words/pixels. Citations: independent-regressions.json#cases=1575,native/wasm complete (SHA256 90e23221b81f0fe3a3f0e4126fae2e038f995b9d9c48e20b2abb130d90462096), boundary-attacks.json#cases=20 (SHA256 14b9b6f724b208407937a90c6dcf82b746f06f5aeaa297068b83d0343470ad9c), fourth-seed-semantics.json#runs[0]:37800 words/12480 pixels (SHA256 22bd2461061fb3bb1fde73b5b9d438494cf4ff11f3b01704f005eb1c2a2b1ff8)

All 55 scoped hunks and 236 runtime added lines are executed or explicitly waived. No runtime hunk is dead or needs evidence. Helper coverage independently reproduces 29/29 lines, 28/28 branches and 61/61 regions.

Promoted 1,575 deterministic native/Wasm source-word/range/mask/alias/version guards; the real upper-bound <= source fault fails at positive 2^31. All 20 extra indirect/modifier/lexical/opcode attacks pass. Six recorded physical faults independently contradict the source predictions as intended.

All prior G6a/b/c/d HELD seals and unchanged dependency boundaries carry forward. No implementation was edited, no duplicate cold clone was run, and all owned resources/processes closed.

Authenticated both receipt source sets against their frozen Git heads: hot
216 entries and cold 215. The hot-to-final ancestor diff changes only the two
evidence getter-serialization repair files. The preserved actual cold sanitizer
binary matches the cold receipt (SHA
`7c2cc80d054f774c3ccabed80659806ee7f386babd0129ee77d40fa5a71926af`).
Six immutable runs independently reproduce 228,816 words /75,136 pixels; the
new Apple M4 Max physical seed 324508639 reproduces 37,800 words /12,480 pixels.
1,791 new metadata attacks and 43 direct owned-bank attacks reject safely with
zero getter calls. Both state-consumer stages and sync/async paths preserve
complete owned prefixes, reflection-pruned checks and async mutation safety.

SUITE: promoted `renderer/virgl-shader/tests/signed-conversion-regressions.mjs`
(SHA `af656f9a8a7bc00d12fc4d8562dbc889ea19c63c2428917c37a6e45ad471ae0a`).
`independent-regressions.json` uses schema
`virgl-signed-conversion-critic-guards-v1`, contains all 1,575 native and Wasm
source/result arrays, feasible-word sets and hashes, and passes exact parity.
The actual source sabotage changes `< 0x4f000000` to `<= 0x4f000000`; the
promoted test fails at `failure.counterexample` in
`sabotage-regressions.json`, where `range-cube-1325400064-0-identity-x` predicts
rejection of `0x4f000000` but the faulty compiler admits it. The runtime
implementation and generated primary fixture were never edited.

Commands and reopening instructions are in verifier `README.md`; actual
checks include independent TGSI source interpretation, a fourth headed GPU
seed, isolated frozen-source native builds, the 1,575 native/Wasm guards,
20 additional indirect/modifier/opcode boundaries, direct consumer attacks,
LLVM/V8 coverage re-export/audit, and one real-source sabotage check.
Syntax checks and `git diff --check` pass. Ran
`python3 tools/check_task_policy.py` (active=none) before
`python3 tools/build_queue.py` (601 tasks /399 verified).

Verifier seal: `evidence/virgl-signed-conversions/verifier/{manifest.json,
records.json,recording.tar.gz}`; 47 actual members, 6,548,892 bytes,
archive SHA `ccec7ef4231c2aaac9ed93167ab7e025283a14a9efe28a3be5c91f6a43e41cca`;
index SHA `fc9b55d8d34a2dc287d2193dafcefec1291e8098fee9aa7386205535e7b0ffc9`;
verdict SHA `a9150bdc4bb87913a267e98c3881f81928b593129da4dafd0c3d7e29b5a407b7`.
Every sealed member was reopened and its length/SHA authenticated. The seal
retains the worker archive dependency and all unchanged prior HELD evidence.
No remaining semantic contradiction or proof gap. Production/captured
compositors, guest boot and MIPS/FPS claims remain gated as the task states.

### 2026-10-04 — worker — verifier promotion integration

Authenticated all 47 critic archive members, the seal/index/verdict and promoted
source digest. Wired the independent 1,575-case native/Wasm guard into the
recurring acceptance target and bound its test SHA in the receipt. The focused
command `node renderer/virgl-shader/tests/signed-conversion-regressions.mjs
--native renderer/virgl-shader/build/native/virgl-shader --output
target/evidence/virgl-signed-conversions-promoted-guards.json` passed all1,575
cases with complete native/Wasm parity. Report SHA `9093dd72c0c2ba38d15db8e1af464dbc393371922d00e8c3626c1b3c474310d8`.
Narrow Node/Python/shell syntax and report authentication checks passed.
No runtime implementation or frozen dependency boundary changed; all critic
HELD results and the exact-source cold proof carry forward.
