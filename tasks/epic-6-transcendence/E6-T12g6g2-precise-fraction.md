---
id: E6-T12g6g2
epic: 6
title: Admit exact instruction-local fractional-part arithmetic
priority: 525.027010575
status: in-progress
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
