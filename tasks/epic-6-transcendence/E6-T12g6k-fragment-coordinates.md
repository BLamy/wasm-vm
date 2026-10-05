---
id: E6-T12g6k
epic: 6
title: Lower captured fragment position and coordinate properties
priority: 525.02701058
status: in-progress
depends_on: [E6-T12g6j2]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only original POSITION fragment input plus FS_COORD_ORIGIN LOWER_LEFT and FS_COORD_PIXEL_CENTER HALF_INTEGER. Lower to explicit physical fragment coordinate semantics with correct stage/index/interpolation metadata. Preserve interface/output bounds and reject unsupported origins/centers. No discard opcode.

The original accepted declaration is full-mask `IN[0], POSITION, LINEAR`
with both explicit properties, in either order before instructions. Missing,
duplicate, foreign-stage or unsupported coordinate properties and POSITION
indices/masks/interpolation reject. The builtin is highp `gl_FragCoord`;
it never joins the ordinary GENERIC varying interface. An owned v38 wrapper
retains every underlying v1..v37 obligation and binds lower-left surfaces,
half-pixel single-sample rasterization, window-depth Z and reciprocal-clip-W
into the checked selector key. Existing input numerical/output authority
remains unchanged; no exact, finite, F2I or address-range facts are added.

Physical predictions use supplied clip-space vertices and independent rational
screen barycentrics. X/Y half-centers and constant dyadic Z/W cases are exact;
interpolated Z/W use an explicit measured absolute budget <=2^-20. RGBA8
readback exposes all four bytes of one evaluated component, including outside
viewport sentinel pixels. No portable accuracy or full-body claim follows.

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

### 2026-10-04 — worker — activated

The user requested continued guest graphics offload implementation. POW is
independently verified at `574d633c17c7436545195c63e534d9fa7859ac74`; its ten
predictions HELD,118-member critic seal was authenticated, and PR454 remains
open. Native stack layer `codex/virgl-fragment-coordinates` starts from that
exact prerequisite. Read-only geometry and primary-source preparation found
the literal original POSITION/LOWER_LEFT/HALF_INTEGER header, existing surface
and rasterizer conventions, and ESSL3.00's intrinsic highp gl_FragCoord. Use
native/Wasm closed metadata checks, actual physical full-word predictions,
varied seeds/schedules, source faults, one final pristine clone and a fresh
critic. Production capability and performance claims remain gated.
