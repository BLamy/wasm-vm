---
id: E6-T11d55
epic: 6
title: Allocate and transfer original volume, cube and array RGBA8 resources
priority: 525.027039000398
status: verified
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

### 2026-10-12 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified

The critic read the complete task and the verified-parent diff before concrete
state inspection. Predictions P0–P9 were recorded first in critic member
`predictions.json`; all are HELD. The critic changed no implementation or
runtime code. The worker metadata head is
`d9e58259ec36a2bb0d7fa3fa5a1dcf8f442313a0`; the runtime and complete worker harness
remain frozen at `bae5df1f1973e93d331bc7662b3ce89bbc1c98ef`.

- P0 complete custody — HELD. Independently reopened all 1,516 D55 worker bodies
  and 2,404 unchanged D54/D50 worker/critic bodies. All manifest/index/archive
  digests equal their submitted pins and the dependency seals equal verified
  parent 37a6794437424049d38acb733191a16c1cdca998. All 1,236 frozen source bodies,
  151 carried native/compiler/consumer source pins and the three complete owner/
  ticket regions match their authenticated Git bodies. Critic member
  `authentication.json` records every seal and source pin; its digest is
  `3124e18779537be6b4709f0cf54b6439d7a31fb66fdcc3a3f9350aac1ede4ed5`.
- P1 independent costs and mips — HELD. Original volume levels shrink7→3→1;
  cube faces stay 6 and array layers stay 7. Full immutable public/native costs
  are 448/720/504 bytes. Actual native storage words are volume
  `[32879,3,32856,5,3,7]` at worker member
  `cold/recording/hardware/report.json:56070`, cube
  `[34067,3,32856,5,5]` at 100829 and array
  `[35866,3,32856,5,3,7]` at 154110. This complete report's digest is
  `52cf1016066f803d02da0deaf5da1f7de194ac0ee78fe389ef533c5a58b4abd7`.
- P2 original/public/native DMA — HELD. Independently reconstructed all 27 mip
  levels and 135 full inverse planes per recording, including op9/43/45,
  original row/layer padding, odd offsets, dirty split SG, partial x/y/z,
  synchronized staging copies in both directions, deferred dense input and
  GPU-only overwrites. Every native PBO output also equals the public inverse
  oracle. Volume 420-byte output is at worker member
  `cold/recording/hardware/report.json:59351` (GL sequence181), cube 600 bytes
  at 104013/2412 and array 420 bytes at 157269/4958, under the report digest above.
  Every other point, exact span and digest is in critic `recording-audit.json`;
  its digest is `257f1b96ae7ec081f1a5262fcc2b5561690649270a9d1a7af54f24b599f8e8f6`.
- P3 admission and limits — HELD. All 146 worker and 146 fresh boundary observations
  agree. Exact complete-chain/aggregate/backing endpoints pass; one-short or
  over-limit inputs, invalid original role/hint/shape/format/mip words and
  overlapping/overflowing row/layer spans refuse without native work or owner/
  ticket publication. Exact volume backing end 631 includes 626 footprint bytes
  and 420 dense bytes. Measured 2D/cube limits 16384, 3D limit 2048 and 2048 array
  layers clamp the selected limits; oversized cube dimensions fail before any
  byte-budget allocation. All 18 historical decoder profiles/error strings and
  inherited resource/image gates pass. Novel tests independently refuse all 45
  unsupported original target neighbors before GL publication. Concrete
  boundary inputs/results remain in `recording-audit.json/boundaries` and the
  full hardware reports.
- P4 lifetime and physical failures — HELD. Retained same-ID allocations preserve
  old GPU bytes and charge both original costs. Backing, membership and context
  replacement cannot publish stale work. All 15 physical allocation/upload/read/
  pending-disposal cases per complete run retire tickets and scratch. The native
  create/delete census is exact; all terminal budgets and native objects are 0.
  This covers actual synchronous/PBO failures and disposal with pending reads,
  not a CPU image mirror. Full state/native points are retained under the report
  and recording-audit digests above; unchanged owner semantics remain HELD.
- P5 changed-region coverage — HELD. Independently reconstructed every finest
  nested V8 partition over all changed runtime hunks. 451 executable regions
  ran; the two remaining partitions contain only delimiters. No executable
  operand is waived or needs evidence. All V8/source/served digests match the
  frozen implementation. Critic `coverage-audit.json` digest:
  `785baffd81122cae0d38340ab7da44394a5fbf2ed7e01e9471b1e72df55c95de`.
  It classifies every runtime hunk and remaining test/tool/declarative hunk.
- P6 exact-head pristine/environment — HELD. The final preserved clone is still
  clean, with HEAD bae5df1f1973e93d331bc7662b3ce89bbc1c98ef. Clean-before/after,
  all 17 prescribed exits and every stdout/stderr body authenticate against
  receipt digest `d8b47b1cee7b515e4a58e074c98b2ed4c0221c924f69994bd2ff57b9f156fac1`.
  The complete cold runner scrubs inherited Rust/Cargo/Node/Chrome settings and
  installs fresh npm dependencies. All physical reports require enabled Metal
  hardware and exclude software fallback. No changed native/compiler/consumer
  boundary warrants repeating its carried Rust/wasm gauntlet or pristine clone.
- P7 independent schedules and sabotage — HELD. Fresh seeds 38197/115937/219173
  exercise the complete attack matrix: 27 mips,135 full inverse planes,
  6,270 pixels,24,215 actual GL calls, zero browser/page/request/final GPU errors.
  Critic member `fresh-hardware/report.json` digest is
  `6723d1daea91a32ed3574384bf78486449e4283d1a05c36977cb87c9a8beb8f3`.
  The fresh physical cube-PBO face mutant preserves synchronous reads, then the
  original 600-byte oracle fails after fence 2412 and physical completion 2418.
  `sabotage-cube-layer/report.json:53190` / GL 2424 contains the rotated native
  output; report digest `41a2397c0330987a33b8d18ea041a8d100000372e3f9fb42225c5f6087ce2f1f`.
  Expected digest 0df293bcbc6bf0b3d68efde1ae58adb8bf103915f0ea2b588d4e83eafaf20312
  differs from observed 61b292d48634ca994d49c30bc7d39a84a78caccceba8756ac64b5b01c16c4ff8.
  The independent audit confirms exactly one-face rotation after the actual
  getBufferSubData operation; full original/mutant sources are preserved.
- P8 bounded novel transport attack — HELD. The promoted independent test uses
  direct native coordinate sources for volume 7x5x9, cube 7x7x6 and array 7x5x9.
  All 30 varied-seed mip inverses include the final layer/face, nonzero x/y,
  default NPOT-tail pitch, 21-byte padded rows,65-byte layers and a 5-byte SG split.
  Box (1,1,7,2,2,2) has 32 native bytes and exact public end 97; end 96 refuses
  before a native operation/ticket. Whole backing/padding/guards agree, and
  fenced reads preserve poisoned guest backing. Concrete outputs are critic
  `novel-hardware/report.json:6309` (volume GL 111),12065 (cube GL 497),16777
  (array GL 803), report digest
  `d0bdeb9273a7909fd1ac36598612a6f0f9581ede33a27d9a0f460f2deccbedd8`.
  No product oracle/layout helper supplies these literal predictions.
- P9 built and recovered live publication — HELD. The authenticated built page
  and independently captured production page both pass 127/0 with zero errors,
  live scalar pip, partial graphics and absent proof exports. The complete live
  roadmap/Wasm bytes match the frozen committed bundle and the D55 marker is
  present. Authenticated all 304 staged files (303 public assets plus .nojekyll),
  194 successful live bodies and 205 prior negative-publication bodies. The root
  worker's isolated unchanged-bundle retry succeeded at canonical production
  deployment 1e10e572-1fdd-41ff-8d1e-014942c306f9, 13:11:08 UTC, frozen bae5df1f
  metadata; its complete publish log/index/API body are critic `publication/`.
  Critic `live/report.json` digest:
  `95f9844a17ed085803ad0643e32e1470a2a0f21a43e3a757b359f6edc4d55341`.
  The prior Cloudflare failures remain recorded history; no proof gap remains.
- SUITE: promoted `renderer/virgl-command/tests/dimensional-storage-critic.mjs`
  and durable runner `tools/virgl-dimensional-storage/critic-browser.mjs`.
  Exact commands/exits are in critic `commands.json`; both focused syntax gates
  and the final all-mip hardware run pass. An initial recorder setup error
  requested coverage for an unused fixture after product assertions passed;
  its complete bodies remain as tooling history, and the final runner is fixed.

Critic seal `evidence/virgl-dimensional-storage/verifier/` contains 584 complete
bodies, 6,555,925 compressed bytes; every member was reopened and authenticated:

- manifest `3a8b2f0713ffd30165bb582dcf7fc1b769312545c2db418ad0d0dca4ad29f1b9`
- index `f3fd8f6a9cea34379b208f20a595c4939d4604d58063c14851a48c30928edb55`
- archive `309db5281fe1c73b06b7c7999214d37c49d9620911740bdfc8e0642928a26e1d`

Only the selected original RGBA8 host storage/DMA boundary is verified. Native
control layout, dimensional sampler/surface consumers, positive capsets, Linux
Mesa/Hyprland and measured MIPS remain successor work. This test/evidence/
metadata commit changes no browser/wasm inputs and preserves exact frozen
`web/dist` bytes; task policy is checked before queue regeneration.
