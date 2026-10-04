---
id: E6-T12g6g2
epic: 6
title: Admit exact instruction-local fractional-part arithmetic
priority: 525.027010575
status: pending
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

(empty)
