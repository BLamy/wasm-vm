---
id: E6-T12g6g1
epic: 6
title: Admit exact word-local minimum selection
priority: 525.027010574
status: pending
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

(empty)
