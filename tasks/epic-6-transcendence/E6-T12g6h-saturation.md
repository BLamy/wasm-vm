---
id: E6-T12g6h
epic: 6
title: Admit bounded MOV and DIV saturation modifiers
priority: 525.027010576
status: in-progress
depends_on: [E6-T12g6g2]
estimate: S
risk: high
capstone: false
---

## Boundary

Add only captured MOV_SAT/DIV_SAT spellings and apply the TGSI-defined clamp after the underlying numeric operation. Preserve modifier locality, masks, source authority and existing plain MOV/DIV semantics. Other unproved saturation/opcode combinations remain rejected.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6h`: Independent clamp equations and actual words/pixels below0, at0/1, between, above1 and near rounding/divisor boundaries. Test numeric domain exclusions, all lanes, aliases, adjacent saturated/plain instructions and clamp order faults through native/wasm and WebGL2. No undefined division or raw-word authority shortcut.

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
