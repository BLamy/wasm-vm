---
id: E6-T11d3
epic: 6
title: Execute scalar through four-component float vertex fetches
priority: 525.027036
status: in-progress
depends_on: [E6-T11d2]
estimate: S
risk: high
capstone: false
---

## Boundary

Complete the pinned R32_FLOAT/R32G32_FLOAT/R32G32B32_FLOAT/R32G32B32A32_FLOAT
per-vertex fetch family. Preserve the GPU's missing-lane defaults (zero and W=one),
actual fourth color lane and homogeneous position W. Validate aligned source
and buffer offsets, exact element widths, actual last fetch and u32 arithmetic
before native drawing. Preserve ordinary nonzero strides, arrays/indexed strips,
owned generation/lease/context and asynchronous completion contracts. Zero-stride,
instancing, other vertex formats and production capsets stay explicitly gated.

This one vertex-fetch prerequisite does not qualify the complete API or guest.

## Deterministic acceptance

`make verify-E6-T11d3` authenticates an independent compiled pinned enum oracle,
checks all four wire formats/overflows/alignment and rejection boundaries, builds
the actual shader Wasm, then draws original-form VirGL packets on the headed
hardware browser. Use separate position and color buffers to prove every lane
and padding, nonunit homogeneous W through gl_FragCoord.w, offsets/padded strides,
nonzero starts, indexed actual maxima and dishonest wire hints. Check physical
pixels from independently specified values plus native attribute/fetch evidence.

Record A/B/A, public resource unref/ID reuse, transfer updates, cache restoration,
varied async/fence schedules and one-short fetch recovery with no issued draw.
Sabotage scalar/four-component native sizes and require precise pixel failures.
Run affected retained draw/raster/async gates, one final exact-head cold clone,
seal raw packets/geometry/pixels/reflection/coverage and submit to a fresh critic.
No unchanged full compiler suite or unrelated cache stress wall is restarted.

## Adversarial verification

Predict native size, missing lanes, fourth-lane alpha and reciprocal clip W at
concrete pixels. Attack the last element at both bounds, maximum u32 offsets,
alignment, retained allocation replacement, inactive elements and actual indexed
maxima. Independently choose one nonunit-W/partial-color geometry and sabotage
the new oracle once. Cover every changed runtime hunk or narrowly waive it;
carry unchanged compiler/private and D2 blend results forward.

## Verification log

### 2026-10-09 — worker — activation

D2 was independently verified at `bcdb820620092aaf869aa0574ffce6de793dd5fe`.
The actual negative wire record is
`evidence/virgl-production-readiness/float-vertex-gap.json`; it binds the
original-form bytes and decoder/state/header identities to source `2b720fca`.
This isolated prerequisite has no imports from the production demo and does
not advertise new capsets. Its physical browser proof is the relevant browser
path; production surfacing and deployment remain in E6-T11d.


Pending negative readiness: pinned formats28/31 reject original-form
CREATE_OBJECT VERTEX_ELEMENTS with `unsupported-feature: Only per-vertex
RG32/RGB32_FLOAT elements are supported.` The currently accepted29/30 cannot
preserve an application's scalar input padding or fourth position/color lane.
The user request to finish production graphics continues the ordered chain.
