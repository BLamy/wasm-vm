---
id: E6-T12g6d
epic: 6
title: Admit bounded signed integer comparison and maximum
priority: 525.027010571
status: pending
depends_on: [E6-T12g6c]
estimate: S
risk: high
capstone: false
---

## Boundary

Add private raw-word ISLT and IMAX for two’s-complement signed32 semantics. Preserve uint arithmetic, canonical mask words and separate ordinary numeric/raster authority. No float casts or transcendental operations.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6d`: Predict literal masks and selected signed words at INT_MIN/INT_MAX/negative/zero/positive boundaries, lane masks/swizzles/conditional joins and constant-bank ownership. Differential against pinned Mesa integer semantics, native/wasm and independent actual transform-feedback/readback words. Test wrong signedness and winner-source faults; arbitrary raw words must not gain numeric/output authority.

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
