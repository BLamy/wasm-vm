---
id: E6-T12g6g2
epic: 6
title: Admit exact instruction-local fractional-part arithmetic
priority: 525.027010575
status: verified
depends_on: [E6-T12g6g1]
estimate: S
risk: high
capstone: false
---

## Boundary

Add FRC_PRECISE with a stated binary32 word result contract from pinned TGSI semantics. Keep it instruction-local and preserve finite numeric/output authority separately. Do not lower exact private results to unproved native fract arithmetic.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6g2`: Independent binary32 fractional-part words for both zeros, negative/positive subnormals, values around integers, representable large integers and documented specials. Native/wasm and physical private word capture; alias/swizzle/conditional/read-use tests and arithmetic source faults. Existing FRC, precise ADD/MUL and selected-away proofs remain unchanged.

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

Activated this S/high boundary above independently verified minimum selection
`5ec49cbc`. The pinned TGSI definition at
`renderer/virgl-shader/tests/mesa-24.2.8-tgsi.rst:309-319` gives component-wise
`x - floor(x)`; the pinned converter at `vendor/src/vrend/vrend_shader.c:5702`
emits ordinary `fract`, whose existing path remains unchanged. The new private
FRC_PRECISE contract evaluates the exact source equation and rounds once to
binary32 nearest-even: integers and both zeros produce canonical positive zero,
positive subnormals remain gradual, and tiny negative fractions can round to
positive one. All NaNs and infinities produce canonical quiet `0x7fc00000`,
matching the documented special-result doctrine of earlier private arithmetic.
Negation precedes evaluation. A bounded unsigned helper avoids native floating
arithmetic in the precise private result.

Preserve existing numerical/output authority separately: unknown private words
gain none, known results can use only the existing static normal-or-zero proof,
and already authorized inputs retain the old bank-dependent numerical shadow
policy. Preserve whole prior wrappers, ordinary FRC, precise ADD/MUL and
selected-away proofs, with no new unknown computed F2I range promise. Record
independent rational source predictions, direct native helper/sanitizer evidence,
actual pinned token/converter witnesses, native/Wasm singles and pairs, physical
word/pixel captures across masks/aliases/versions, state consumers, source-fault
sensitivity, varied seeds and one final pristine clone. Submit to a fresh critic
before the next dependency. Production negotiation and performance remain gated.

### 2026-10-04 — worker — implemented

Frozen runtime/harness source: `8a721921e16375ccc6ee30f46e772f245a4a17ac`,
above independently verified `5ec49cbce92fc809498c601dc5e3a0e165e435ba`.
Commands: `make verify-E6-T12g6g2`;
`python3 tools/virgl-precise-fraction/cold.py --output target/evidence/virgl-precise-fraction-cold`;
`python3 tools/virgl-precise-fraction/seal.py --hot target/evidence/virgl-precise-fraction --cold target/evidence/virgl-precise-fraction-cold --output evidence/virgl-precise-fraction/worker`.
Relevant C warning checks, pinned-source hashes, ASan/UBSan, instrumented native
helper/compiler, Wasm and actual physical WebGL2 gates passed. Runtime and
prescribed submission succeeded together at the frozen head; no repair was
needed after that freeze. Earlier inner-loop GPU compilation caught the reserved
ESSL name `half`, fixed to `halfway` before freezing; these ephemeral runs are
not the evidence of record.

Evidence of record: `evidence/virgl-precise-fraction/worker/{manifest.json,records.json,recording.tar.gz}`.
Archive has 95 members / 36,345,207 bytes, SHA-256
`4d4636dc00d88c0a9bb073e2fbc35afba741f51d460912430e4c8fe1b24c562d`;
index SHA-256 `a0d424b132263e40d61e497f2416f2927c285f0b57896f0a7ae4d4311f0ec623`.
Hot receipt SHA-256 `86e6ab57ded74e6922d889028d2c6aefcb315eaa3e22e3a2c1ede55d22b1bcc3`;
cold receipt SHA-256 `eff718e69bed1ff62fb81327d83154bbf490563dffdda5125a40d4abb433168f`;
cold report SHA-256 `ca8040575804b467cfaee5248e443459f59ed8a6e5cb3a47d22dab95efc8f00a`.
Raw hot recordings are `target/evidence/virgl-precise-fraction`; cold copies are
`target/evidence/virgl-precise-fraction-cold/acceptance`. The one pristine clone
was `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-precise-fraction-cold-djfnu74i/wasm-vm`,
with `RUST_LOG` scrubbed and empty before/after Git status.

Each hot/cold recording proves 7,968 independent direct native helper words,
1,919 predetermined public requests (1,899 accepted / 20 closed rejects),
1,897 actual pinned FLOAT/FLOAT unary FRC tokens and converted GLSL witnesses,
1,919 complete native/Wasm response matches and 1,919 pairs. The native coverage
record covers all 36 helper lines, 32 branches and 81 regions across both real
helper instantiations. The consumer records 591 hostile metadata mutations,
13 owned banks and four complete earlier base chains. Compatibility records
1,014 complete predecessor results: ordinary FRC, precise ADD/MUL, precision
and selected-away proofs remain identical; exactly two named old FRC_PRECISE
rejections gain support through the committed input-digest migration ledger.
Promoted bounds/hex/signed/conversion/scalar/minimum guards cover respectively
402/49/108/1,575/1,427/4,524 cases.

Per hot/cold submission, physical seeds 1,369,979,863 / 2,804,203,833 /
3,781,791,491 check 128,928 / 129,384 / 129,384 words and 11,584 / 11,072 /
11,072 pixels (totals 387,696 words / 33,728 pixels). Pinned primary GLSL checks
177,528 words / 14,336 pixels under the unchanged ordinary zero policy. Private
precise words, including positive zeros, gradual subnormals and canonical NaNs,
are exact. All masks, aliases, swizzles, negation, conditional versions, live
attributes and raw dynamic banks execute before observed results. Real sync/async
bank draws combine the new fraction with signed conversion/scalar/minimum
chains; the fraction changes pixels while complete prefix, conversion range,
restore, immutable waiting-index plans and zero lifetime budgets remain enforced.
Every browser recording has zero console/page/request errors and no live GL
objects. Negative, rounding and special emitted-source faults each produce a
physical word contradiction (hot receipt `physicalOutputFaults`, lanes 7/5/6)
and still dispose their objects.

This recording demonstrates the instruction-local exact binary32 equation and
its separate numerical/output authority, including known result facts and no
invented unknown F2I range promise. It preserves every inherited policy. It does
not demonstrate actual guest offload, complete compositor admission or a speed
increase; the two full original shaders remain rejected and production/caps/live
imports remain gated. Submitted to a fresh adversarial critic before a dependent
may activate.

### 2026-10-04 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified

Inspected the complete task and predecessor/submission diff before evidence and
committed predictions to the critic record before reading the observations. This
session did not implement the task. Runtime remains frozen at
`8a721921e16375ccc6ee30f46e772f245a4a17ac`; worker submission is
`be4ff41ba8e99047796d9c41e13b34b0965c8e6c`, above verified predecessor
`5ec49cbce92fc809498c601dc5e3a0e165e435ba`. rr/ssh-dev remain waived.

- P1 — HELD. 95 unique regular members match the index, archive and cited digests; hot/cold 243/236 sources bind unchanged frozen runtime to submission. Original exact-head cold clone was pristine and scrubbed. Citation: `evidence/virgl-precise-fraction/verifier/authentication.json`, SHA-256 `fc3550e82d069d70eef65e60398be1af0e2bab149be405d3b867d7e8ca78fab6`.
- P2 — HELD. Independent integer-scale rational equation confirms 15,936 helper predictions and literal predeclared anchors, including -minimum-subnormal => 0x3f800000 at hot/cold native/native.log:4 and -2^-25 => 0x3f800000 at line 10. Every complete archived native response matches Wasm. Citation: `evidence/virgl-precise-fraction/verifier/native-source-parity.json`, SHA-256 `2bd7c4db1d51f07ee8763616ebcadba1b00b97275fcdc8baa24d25bcaa22f133`.
- P3 — HELD. 17 distinct authentic contracts survive; 1,118 independent hostile metadata mutations close without invoking an accessor. 13 banks preserve ownership, range and whole-prefix checks; private unknown/output/F2I predictions hold in the promoted 4,469-case guard. Citation: `evidence/virgl-precise-fraction/verifier/consumer-attacks.json`, SHA-256 `f56d9cdf0a9d65c239e0935bf479a39ec45df24c27eabbfaf668b971dc9e1ec5`.
- P4 — HELD. All 4,469 native/Wasm word-bit, negation, mask/swizzle, alias, killed/saved version, conditional, malformed syntax and no-new-range predictions hold. Native token replay checks all 1,897 actual FLOAT/FLOAT unary FRC primary conversions and masks per recording. Citation: `evidence/virgl-precise-fraction/verifier/independent-regressions.json`, SHA-256 `fc23c3ab26457cc8e7d72a044a7faa6b793b545e5e35a4a1ba9a5d48ab352480`.
- P5 — HELD. Six verified critic seals, 247 byte-identical dependencies and 16 unchanged helpers are carried forward. Independent native/legacy replay preserves 1,014 complete predecessor responses per recording except exactly the two digest-ledger migrations; current retained original/historical partitions remain 23/25 and 5/112. Seven production gate files remain byte-identical. Citation: `evidence/virgl-precise-fraction/verifier/carry-forward.json`, SHA-256 `9a665a774ed48f2705b72769511a4fffc0b2b202006e8a0c9a73394305ce2a47`.
- P6 — HELD. Independent TGSI source interpretation confirms all six sealed recordings: 775,392 words and 67,456 pixels. Exact actual shaderSource sequences, GL compile/link status and reflection, attributes, banks, indexed geometry, source-dependent pixels, async waiting-index plans, closed hostile draws and zero GL/resource lifetimes bind the observations. Fourth physical seed separately confirms 128,832 words and 11,072 pixels. Citation: `evidence/virgl-precise-fraction/verifier/source-semantics.json`, SHA-256 `c3e26f55660a72add39c3f29759417808bff531be03f869204ad85f97429536f`.
- P7 — HELD. Actual archived hot/cold ASan/UBSan binaries replay with byte-identical transcripts and no diagnostics. Re-exporting their original raw/merged profiles is exact. All 36 helper lines, 32 branches and 81 regions are covered; 28 runtime hunks/145 added lines have positive LLVM/V8 counts or explicit static/type/source-data justification, with zero proof gaps or dead hunks. Citation: `evidence/virgl-precise-fraction/verifier/coverage-audit.json`, SHA-256 `4e27278f554ae26999b05d910aee4e47008f3371f865950f4adcaf5765cb22c7`.
- P8 — HELD. Independent seed 324,508,637 and physical seed 610,839,776 hold. The native promotion detects deleted negative complement at fraction-1-true-bit-0. The permanent capture promotion independently confirms 36,096 private words and refutes the real emitted negative-complement fault at record 175/vector 0, carrier lane 7, capture 9389931471ca43ba88af7b8bd37a8f8f4bb61a7107ca422d9aad1bd167d9079f. All six sealed physical faults contradict concrete words (lanes 7/5/6) and dispose objects. Citation: `evidence/virgl-precise-fraction/verifier/sensitivity.json`, SHA-256 `77c1e65023d49efbc130413dc25d2147f42d06be50710045a46368a999963a25`.

SUITE: promoted `renderer/virgl-shader/tests/precise-fraction-regressions.mjs`
contains 4,469 exact native/Wasm source-bit, version, mask and authority cases;
`renderer/virgl-shader/tests/precise-fraction-capture-regressions.mjs` interprets
TGSI against real feedback and verifies 36,096 private words in the fourth seed.
The native and actual emitted-source sabotages both fail these promotions.
Both source/report digests and exact commands are in the verifier manifest and
`verdict.json`; the next saturation target will carry both guards forward.

Commands: `python3 evidence/virgl-precise-fraction/verifier/{authenticate,replay,native_parity,source_semantics,coverage_audit,carry_forward,sensitivity,final_audits,write_verdict,seal}.py` (each separately);
`node tools/virgl-precise-fraction/browser.mjs --output evidence/virgl-precise-fraction/verifier/gpu-610839776 --seed 610839776`;
`python3 evidence/virgl-precise-fraction/verifier/source_semantics.py --fourth`;
`NODE_V8_COVERAGE=evidence/virgl-precise-fraction/verifier/node-consumer-coverage node evidence/virgl-precise-fraction/verifier/consumer_attacks.mjs`;
`node renderer/virgl-shader/tests/precise-fraction-regressions.mjs --native evidence/virgl-precise-fraction/verifier/unpacked/generated/native/virgl-shader --output evidence/virgl-precise-fraction/verifier/independent-regressions.json`;
`node renderer/virgl-shader/tests/precise-fraction-capture-regressions.mjs --report evidence/virgl-precise-fraction/verifier/gpu-610839776/report.json --output evidence/virgl-precise-fraction/verifier/independent-capture-regressions.json`.
Exact deliberate-failure commands, archive binary/profile identities and replay
digests are also recorded in `verdict.json`, `native-replays.json` and `sensitivity.json`.

Evidence of record: `evidence/virgl-precise-fraction/verifier/{manifest.json,records.json,recording.tar.gz}`.
Critic archive: 71 members / 13,091,830 bytes, SHA-256
`29fdaa5e6774bde13f708333b870bb2cda1060547f369086d0f11fd9a73c21e6`;
index SHA-256 `16ac41cbdc3e4944cccb845670fa941b9fce9180589887a17717fd9d380b3a7a`;
verdict SHA-256 `0b55fa9417706aeb14a88b2baa7f1689a8d1891bdd141845f0e3fb2c82578fd7`.
Every sealed member was re-authenticated after sealing. Six predecessor critic
seals, 247 unchanged dependencies and 16 unchanged helpers retain HELD results.
The original pristine exact-head clone is authenticated and reused; no runtime
change or portability finding called for repeating it.

Coverage: all 28 changed runtime hunks / 145 added lines are executed or explicitly
waived as static declarations/source data; zero needs-evidence/dead hunks. The
actual archived helper profiles cover all 36 lines, 32 branches and 81 regions.
Cleanup: all 13 successful/fault browser runs dispose their objects and all
completed consumers have zero renderer/resource lifetime budgets.

No guest offload, complete compositor admission, throughput/FPS/MIPS or production
deployment claim follows. The two complete original shaders remain rejected;
default caps/negotiation and live demo imports are byte-identical to the verified
predecessor and stay disabled.
