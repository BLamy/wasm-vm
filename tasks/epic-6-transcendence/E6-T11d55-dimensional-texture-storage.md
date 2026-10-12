---
id: E6-T11d55
epic: 6
title: Allocate and transfer original volume, cube and array RGBA8 resources
priority: 525.027039000398
status: implemented
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

### 2026-10-12 — worker — activated

The selected dimensional RGBA8 allocation/DMA layout boundary is the sole active
task. All three dependencies are independently verified. Use the recorded
`make verify-E6-T11d55` acceptance, affected historical gates, one final scrubbed
pristine clone and a separate critic. This starts no production capability or
Linux guest rendering claim.

### 2026-10-12 — worker — frozen submission

Runtime and complete harness freeze:
`bae5df1f1973e93d331bc7662b3ce89bbc1c98ef`.
Exact authoritative repro:
`python3 tools/virgl-dimensional-storage/cold.py /tmp/wasmvm-dimensional-storage-cold-bae5df1f-v2`.
It creates a pristine shared clone at that exact head, scrubs inherited
Rust/Cargo/Node settings, then runs `make verify-E6-T11d55`. All17 selected gates
pass with clean checkout before and after. The full receipt retains every
command, environment override and stdout/stderr digest. Native/compiler,
ticket/owner and historical consumer bodies are unchanged and authenticated
against the complete D54 and D50 worker/critic seals:2404 bodies reopened.
No Rust semantic change warrants repeating their unchanged gauntlets.

Actual Metal GL operations prove all three original shapes over three seeds,
27 mip levels and135 complete inverse planes/6270 pixels. Complete mip costs
are448(volume),720(cube) and504(array) bytes. Original op9/43/45 words, dirty
split SG bytes, row/layer padding, partial x/y/z boxes, synchronous and fenced
native bytes, staging copies, deferred dense input and GPU-only overwrites are
retained. Revoked backing/membership/context work, retained allocation reuse,
pending disposal and15 physical native failure cases retire all budgets and
native objects.146 boundary cases cover original roles/hints, whole chains,
aggregate bytes, measured dimension neighbors, malformed inputs and overflows.
The recording has24215 actual GL calls and zero browser/page/request errors.

The native cube-PBO attachment sabotage rotates real faces while synchronous
output still passes. After the physical fence signals, the unchanged original
600-byte oracle fails at the recorded `full initial inverse` point. Finest V8
coverage has451 executed changed regions, two delimiter-only waivers and no
unproven runtime region. The independent Python audit reconstructs literal
RGBA8 predictions and every public/native inverse without product imports.

`evidence/virgl-dimensional-storage/worker/` seals1516 complete bodies, every
member reopened,21943887 compressed bytes:

- index `3818f85ddc3f083764334ef80c4c615615dafe9d9c89dbe54776e0183aaac0a4`
- archive `c32c662034196c07d06ec9103bb68de55bc461fc0623930fe2fed9ee0bc8d691`

The first clone attempt filled the disk during checkout, before any acceptance
run; `/tmp/wasmvm-dimensional-storage-cold-bae5df1f.log` preserves that failure.
Only disposable D54 build caches, its sealed unchanged cold clone and the
failed D55 checkout were removed. Recorded evidence was preserved; the final
retry above passes from the scrubbed pristine checkout.

`make web-dist` rebuilt and committed the demo bundle at the freeze. The built
page records127 passed/0 failed, zero errors, a live scalar-memory pip and
partial graphics pip; proof-only Wasm exports remain absent. Dimensional
sampler/surface/scanout consumers, native control layout and positive production
capsets stay gated. Actual Linux Mesa/Hyprland rendering and300MIPS remain
successor claims. A fresh independent critic must adjudicate this submission.

### 2026-10-12 — worker — publication proof gap

The code and final pristine recording above are unchanged. Three attempts to
publish the validated303-file bundle reached asset upload/header publication,
then Cloudflare rejected the Function publish with exactly
`Failed to publish your Function. Got error: Unknown internal error occurred.`
Repros:

- `bash tools/deploy-cloudflare.sh`
- `npx --yes wrangler pages deploy web/dist --project-name wasm-vm --branch main --commit-dirty=true`
- `npx --yes wrangler@4.148.0 pages deploy web/dist --project-name wasm-vm --branch main --commit-hash bae5df1f1973e93d331bc7662b3ce89bbc1c98ef --commit-dirty=true`

All complete CLI outputs, validated deployment URL rewrites, the deployment
list and current service-status response are retained in
`evidence/virgl-dimensional-storage/deployment/`. The full original189MiB
Omarchy snapshot and other unchanged boot artifacts passed their public digest
checks; the two subsequent publishes reused the identical uploaded asset set.
Wrangler4.149.0 and4.148.0 return the same server failure. No local Function or
worker bundle was introduced by this slice. Pages is reported operational;
the current status response does not establish the cause of this project error.
Only the four owned staged URL rewrites were restored afterward.

`node /tmp/wasmvm-dimensional-storage-live.mjs --output evidence/virgl-dimensional-storage/deployment/final --task E6-T11d55`
confirms the existing live site still passes127/0 with zero errors, but its
graphics evidence text remains D54 and the required D55 marker assertion fails.
That negative capture retains full served bodies and the runner. This is a
publication proof gap; no completed live deployment is claimed. The fresh
critic should carry the held local results and identify the missing live proof
without restarting the unchanged runtime gauntlet.
