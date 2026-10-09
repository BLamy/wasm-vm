---
id: E6-T11d2
epic: 6
title: Execute single-target blend equations and factors for guest qualification
priority: 525.027037
status: in-progress
depends_on: [E6-T11d1]
estimate: S
risk: high
capstone: false
---

## Boundary

Replace the two-form alpha-blend restriction with the pinned Gallium single-RT
ADD, SUBTRACT, REVERSE_SUBTRACT, MIN and MAX equations and all non-dual-source
GLES2 factors, independently for RGB and alpha. Preserve explicit rejection of
unknown factors/equations, dual-source, logic operations and multiple targets.
Validate source-only SRC_ALPHA_SATURATE; its alpha factor is one.

WebGL forbids mixing constant color and constant alpha in the RGB source and
destination factors. For exactly those combinations whose RGB equation uses
factors, fold the clamped source constant into a bounded fragment variant and
use native source ONE. Leave alpha unmodified. Bind the variant, owned blend
color and cache identity to the actual draw. MIN/MAX ignore their factors and
must not acquire this variant. Keep normal cases on native GPU blending.

No API/capset, live guest, performance or production negotiation claim follows
from this isolated prerequisite. E6-T11d remains blocked until full qualification.

## Deterministic acceptance

`make verify-E6-T11d2` authenticates the pinned C enum oracle, checks wire
decoding and negative boundaries in Node and the actual headed browser, builds
the fixed-memory Wasm shader bridge, and draws every supported RGB and alpha
factor pair and equation through original-form VirGL packets. An independent
rational oracle checks all raw framebuffer pixels with a stated one-unit UNORM8
quantization budget, including saturation, source/blend-color clamps, different
RGB/alpha equations, color masks and X-alpha storage. Record actual reflection,
blend parameters, shader variants, complete packets/banks and pixel bytes.

Record context A/B/A and subcontext restoration, varied asynchronous schedules,
program/state cache eviction, variant allocation/size/host-uniform failures and
recovery. Deliberately sabotage equation, factor and constant-fold upload; each
must fail its precise pixel oracle. Run affected retained renderer, raster,
resource, indexed and asynchronous gates, final exact-head clean clone, and
seal sources, raw pixels, browser captures and changed-line coverage for a
fresh verifier. Preserve older constant/compiler and private profile limits.

## Adversarial verification

Independently choose colors and mixed constant pairs, partial color masks and
RGB/alpha equations; test source saturation with destination alpha on both
sides of the minimum. Attack a last blend-color update, object destruction/ID
reuse, context restoration and evicted variants. Reject speculative native
WebGL support for forbidden mixed constants. Check clamping before source-factor
folding, alpha preservation, factor-free MIN/MAX and actual owned uniform values.
Exercise variant size, host-component and allocation bounds and prove cleanup.
Invent one bounded physical attack and sabotage the new oracle once. Every
changed runtime hunk needs a recorded execution or explicit narrow waiver.

## Verification log

Activation follows the independent E6-T11d1 verdict. The next concrete readiness
probe is an original-form CREATE_OBJECT BLEND carrying ADD with source ONE and
destination ZERO in both RGB and alpha: it currently rejects with
`unsupported-feature: Only standard additive alpha blending is supported.` The
production capset remains disabled while this minimum operation is repaired.
