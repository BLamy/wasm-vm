---
id: E6-T12g6k
epic: 6
title: Lower captured fragment position and coordinate properties
priority: 525.02701058
status: pending
depends_on: [E6-T12g6j2]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only original POSITION fragment input plus FS_COORD_ORIGIN LOWER_LEFT and FS_COORD_PIXEL_CENTER HALF_INTEGER. Lower to explicit physical fragment coordinate semantics with correct stage/index/interpolation metadata. Preserve interface/output bounds and reject unsupported origins/centers. No discard opcode.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6k`: Native/wasm metadata and actual GPU per-pixel x/y/z/w predictions for several framebuffer/viewport positions and dimensions, copied/raw/numeric coordinate uses and neighboring GENERIC inputs. Reflection, surface origin and shader-key binding must agree; zero errors/disposal and coordinate-source faults required.

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
