---
id: E6-T12g6g2
epic: 6
title: Admit exact instruction-local fractional-part arithmetic
priority: 525.027010575
status: implemented
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
