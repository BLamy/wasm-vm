---
id: E6-T12g6e
epic: 6
title: Admit bounded signed integer and float conversions
priority: 525.027010572
status: pending
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

(empty)
