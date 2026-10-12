---
id: E6-T11d55
epic: 6
title: Allocate and transfer original volume, cube and array RGBA8 resources
priority: 525.027039000398
status: pending
depends_on: [E6-T11d54, E6-T11d50, E6-T11d20]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected host storage and DMA layout boundary for original
PIPE_TEXTURE_3D=3, PIPE_TEXTURE_CUBE=4 and PIPE_TEXTURE_2D_ARRAY=7 RGBA8 format67.
Preserve immutable original metadata, exact render/sampler roles and measured
creation hints. Volume mip depth shrinks; array layer counts and six cube faces
remain constant. Check every complete mip allocation and public transfer span
against existing resource, aggregate, scratch and ownership budgets before
native work. Clamp separate dimensions/layers against actual WebGL2 limits.

Creation and public DMA form one atomic layout boundary: allocating a layered
owner without its original z/layer/row addressing cannot yield usable transfers.
Use actual native texStorage3D/texStorage2D, texSubImage3D/cube-face uploads and
layer/face framebuffer reads with fenced PBO output. Do not introduce a CPU
image mirror. New owners remain outside historical shader/view/surface/scanout
consumers until their separate qualification. Existing constructors, formats,
buffer and2D paths remain covered. Native transport and production capabilities
are not widened by this isolated host selection.

## Deterministic acceptance

`make verify-E6-T11d55`

Original metadata and op9/43/45 transfer packets with a literal independent
RGBA8/coordinate oracle prove all mip levels, layers and cube faces. Record
full original and native words, immutable allocations/dimensions, three varied
completion schedules, SG source writes after attachment, odd offsets, padded
rows/layers, nonzero x/y/z subboxes, inline and both synchronized copy directions,
sync and fenced inverse output, physical GPU-only overwrites, exact padding and
guards. Exercise retained ID reuse, backing/context/attachment revocation,
pending cancellation and disposal with zero terminal budgets/objects.

Refuse unsupported formats/targets, malformed cube/array/volume shapes,
samples/flags/hints, high mip words and impossible levels, whole-chain and
aggregate budgets, overflow, short backing and malformed row/layer spans before
native publication. Bound actual dimension and byte-limit neighbors and execute
native allocation/upload/readback failure cleanup. Authenticate unchanged
D54/D50 ownership/compiler/consumer evidence; run affected historical resource
and decoder gates. Preserve full source/served/native/V8 custody and finest
changed region coverage, record one final scrubbed pristine clone, and submit
sealed evidence to a fresh independent critic. The built and live page remains
127/0, graphics partial and production negotiation disabled; update/rebuild/
commit/deploy the demo per AGENTS.md.

## Adversarial verification

Predict independent mip depth versus fixed layer counts, every public/native
byte cost, all native texels and exact backing spans. Attack cube face order,
volume z selection, array nonzero layers, NPOT tails, exact budget boundaries,
overlapping/padded strides, odd/split SG boundaries, post-attach dirt,
stale generations and pending reset/disposal. Run three independent schedules,
one bounded novel transport attack and a native layer/level selection sabotage;
require the unchanged original oracle to fail after the physical operation.
Classify every changed hunk and finest nested region, authenticate full bodies
and the final cold clone, and carry unchanged HELD boundaries incrementally.

## Verification log

### 2026-10-12 — worker — verified-head dimensional refusal; planned slice

D54 is independently verified at
`37a6794437424049d38acb733191a16c1cdca998` and published as open/draft PR532
above PR531 on the existing native stack500. Both stack identities and all132
prior PR identities/order/heads/bases remain unchanged; all133 remain open,
draft and unmerged. `evidence/virgl-production-readiness/dimensional-texture-gap/stack-continuity.json`
records that comparison. Codex's100-attachment cap prevented attaching PR532;
no prior attachment was removed.

At that clean verified head the actual selected Wasm queue and qualified
hardware host reject original RGBA8 volume(5x3x7), six-face cube(5x5x6) and
array(5x3x7) metadata, each with three mip levels. The identical2D5x3
control allocates through native control and the hardware host. Both original
vertex/fragment TEX sources for each multidimensional target reject the bounded
grammar; all six refusals are retained. Host Metal limits are16384 for2D/cube,
2048 for3D and2048 array layers. All refusals preserve native/host ownership
and GPU allocations; every control allocation retires.

Exact repro:
`node /tmp/wasmvm-dimensional-texture-readiness.mjs --output /tmp/wasmvm-dimensional-texture-readiness-37a67944-v2`.
The full runner is archive member `readiness-runner.mjs`; original enum/header,
native source, actual selected Wasm, metadata/packet/state/guest-loop trace and
all167 actual GL calls are retained. The913ms recording has zero browser,
request/page and final GPU errors.

`evidence/virgl-production-readiness/dimensional-texture-gap/` seals100 complete
bodies,2843123 compressed bytes, every member reopened:

- index `49d070ecdf8803af19da3ce02eb44c316d08472dc094c7dcc661cd0817112d44`
- archive `132ae60bdeb77d821688435a0349e371e2b33efaa4c43d6ff0e6d1d2539f27b2`
- report `47e29af237cfea9cc29be023f9af3ebd4ba74c98e9eaaffa7dbad7a6a40abc83`

The original target enum is pinned Gallium p_defines.h157..168. GLES3.0.6
section3.8 requires these texture kinds
(`https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf`).
Hyprland's captured API floor remains GLES3.0. The explicit human instruction
continues production graphics ahead of unrelated general-queue work. Other
format/target cross-products, actual sampler/surface consumers, native layout,
truthful caps/API, Linux Mesa/Hyprland, production worker/scanout and measured
MIPS remain ordered parent work; this slice grants none of those claims.
