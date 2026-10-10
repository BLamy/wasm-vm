---
id: E6-T11d22
epic: 6
title: Execute original normalized-byte and sRGB 2D color images
priority: 525.02703900036
status: pending
depends_on: [E6-T11d21]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly host-selected original normalized-byte color-image boundary. A frozen pinned-format descriptor supplies original guest channel order and bytes, actual native sized format/type, implicit channels, signed-normalized and sRGB semantics, and separately checked native allocation/readback/scratch bytes. Admit R/RG/RGB/RGBA8 UNORM/SNORM and the corresponding qualified 8-bit RGB/BGR/ARGB/ABGR/X/sRGB memory orders, retaining prior formats2/67/233. Original texture/view/surface/transfer packets execute through an owned async color factory; original SNORM textures qualify sampler roles only, while UNORM/sRGB qualify render/sampler roles; every historical factory and its metadata/admission shape remains unchanged. Gate native signed-normalized GPU-copy/readback helpers on actual EXT_render_snorm support; this does not advertise SNORM guest render-target support. Native padded RGBA storage for non-renderable RGB SNORM/sRGB retains implicit alpha one and charges the complete physical allocation, expanded upload/readback scratch and staged PBO. Guest row/layer offsets remain logical original bytes, not native padded bytes. Native matching-format GPU-only mip copies and selected UNORM/sRGB surfaces use the D21 ownership/fence boundary. Sampling/filtering observes signed normalization and sRGB decode; native UNORM/sRGB surface clear/draw/blend observes sRGB encode and original color masks. CPU work is bounded channel/endian/packing conversion of transfers; all image drawing and refresh execute on the physical GPU. Complete API/caps, float/integer/packed texture families, additional targets/depth, production guest integration and scanout remain successors.

## Deterministic acceptance

`make verify-E6-T11d22`

Pinned Mesa format source and VirGL enums independently reconstruct every guest/native format descriptor. Literal original creates, views, surfaces, transfers, complete shaders and draws prove every admitted family with full/truncated NPOT levels, missing zero/one channels, original swizzles, nonzero/unaligned segmented backing offsets, subrectangles and padding, inline/synchronous/staged readbacks, signed extrema and sRGB transfer-vs-filter-vs-output behavior. Preserve complete original backing, native planes, pre-draw state and full completed-fence output; compare with an independent original-input normalized/color-space oracle. Check actual GPU-only mutation, restricted range refresh, retained generation/public-ID reuse, later-task cancellation/disposal, exact/short logical/native GPU and CPU/scratch/PBO budgets, incompatible format/roles, unavailable extension and actual native errors. Wrong native signedness/channel/encoding sabotages must finish a physical fence before the unchanged original oracle fails. Record source/served/generated/full nested V8 custody and affected historical byte-image paths at a frozen head; authenticate unchanged D21 HELD dependencies, then run one pristine scrubbed exact-head clone and seal for a fresh adversarial critic. This prerequisite grants no full API/capset, guest, deployment or performance authority.

## Adversarial verification

Predict original byte layouts, native signed/normalized/encoding types, missing channels, physical charges, full native bytes and completed-fence pixels before inspecting recordings. Authenticate every sealed member and carry unchanged HELD dependency identity. Audit each changed nested region. Attack original family/channel order, signed sample/readback endpoints, explicit SNORM render-role refusal, sRGB decode-before-filter and blend encoding, padded RGB alpha and scratch/PBO ownership. Invent one bounded signed/encoding or retained-generation attack with independent seeds/schedules and sabotage a real native selection; require unchanged original-oracle failure after a completed fence. Promote recurring deterministic proof and seal fresh captures. The critic never fixes runtime implementation.

## Verification log

### 2026-10-10 — worker — planning only

D21 is awaiting independent verification. Its decoder still rejects original normalized-byte red/green/RGB, signed-normalized and sRGB sampler/surface formats. Readiness records bind literal original packets, pinned VirGL/Mesa format source, unchanged source closure and actual fixed-memory Wasm; they supply no native/API authority. Native M4 planning additionally confirms RGB8_SNORM and SRGB8 themselves are not framebuffer-complete, while corresponding RGBA formats are complete with the stated actual extensions. This candidate remains pending until D21 is independently verified and its exclusive verifier lease is released.

### 2026-10-10 — worker — predecessor released; executable prerequisite

D21 is independently verified at `ac916b7fd0b194c088fe5d54800b24a80a4679ac` and its exclusive verifier lease is released. This ordered S task follows the explicit production graphics instruction. The original negative format/layout records and pinned Mesa descriptor blocks are preserved under `evidence/virgl-production-readiness/standard-byte-color-*`; their unchanged runtime identities remain exact through the verified predecessor. No native execution or production authority follows from the pure readiness/temporary implementation previews. Activate only after the pending task/queue commit.
