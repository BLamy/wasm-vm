---
id: E6-T11d2
epic: 6
title: Execute single-target blend equations and factors for guest qualification
priority: 525.027037
status: implemented
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

### 2026-10-09 — worker — recorded submission for fresh falsification

Frozen source `0ed130ff0b9a3efa1273ac485d87dad656efcef4`, diff from independently
verified parent `3c6295a93d6b088c62a5c6f1cc434f226e090340`. Commands:
`make verify-E6-T11d2`;
`python3 tools/virgl-command/blend-cold.py --output target/evidence/virgl-blend-cold`;
`python3 tools/virgl-command/blend-seal.py target/evidence/virgl-blend target/evidence/virgl-blend-cold evidence/virgl-blend/worker`.

Both full submissions pass. The exact-head pristine clone has empty status
before/after and scrubbed environment. Each run authenticates 390 source files,
the generated fixed-memory Wasm and 116 recorded artifacts. The 536 Node/wire
predicates admit 120 and reject 136 factor-field cases. The real headed hardware
browser draws 2,302 frames (589,312 pixels) and holds 23,637 predicates with zero
console/page/request errors. Its raw stream is independently recomputed using
Python Fractions, with at most one stored UNORM8/UNORM10 component unit accepted.
Every RGB and alpha pair/equation is drawn; mixed source constants, clamps,
alpha saturation on both minimum branches, masks, X-alpha, disabled zero fields,
terminal discard, destroyed/reused state objects, A/B/A and real subcontexts,
bounded eviction, later-task native fences and typed allocation/size/component
failures recover. Native settings, reflected variants, owned uploads, complete
packet/TGSI/ESSL frame dumps and V8 changed-source coverage accompany the pixels.

The physical source faults fail exactly at `rgb-0-1-1` (equation swap),
`rgb-0-1-4` (destination factor), and `rgb-0-7-8` (fold upload); raw pixels
independently contradict their predictions, with no unrelated browser error.
Affected I/H/G5 renderer/resource/indexed/async/raster gates and the promoted
three-seed cache attacks pass at this head. The unchanged compiler/private
profile semantics carry the independently verified D1 boundary. Early harness
runs found the system Bash empty-array/nounset case and the promoted cache
report's `sourceHead` field; these recording fixes precede the frozen full runs.

Evidence of record: `evidence/virgl-blend/worker/recording.tar.gz` (242 records,
9,896,153 bytes), archive SHA256
`ee7ef868a4e8d98e8121c37116a8d3d06497b6cc88ef3c9c4581254f3a522b1f`,
record-index SHA256
`1c6b9f26fae9591017986598f241272b084505d251e34460c5c315f322108d7c`.
Hot receipt `22d754268302c8ff528706d385ba11e76cd23dafb0a56b415a784af10eced6f7`;
cold receipt `7af314b1ded202c86688796d365b4629bd958eed6e7c8121e6e6b6438f6ccbc7`.
Unpacked working artifacts remain in `target/evidence/virgl-blend` and
`target/evidence/virgl-blend-cold`. This is an isolated normalized blend claim:
production capability negotiation stays disabled, with no guest boot or
performance claim. This worker does not set `verified`.
