---
id: E6-T12g6g1
epic: 6
title: Admit exact word-local minimum selection
priority: 525.027010574
status: in-progress
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
