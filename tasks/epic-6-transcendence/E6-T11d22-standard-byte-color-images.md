---
id: E6-T11d22
epic: 6
title: Execute original normalized-byte and sRGB 2D color images
priority: 525.02703900036
status: implemented
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

### 2026-10-10 — worker — selected byte-color implementation and prechecks

The explicitly selected decoder/store/native backend/async renderer admits the 24 pinned original UNORM/SNORM/sRGB byte layouts. Physical native allocation and transfer scratch are separately charged from original logical guest bytes. RGB signed/sRGB helpers use padded RGBA native storage with initialized implicit alpha and actual signed extension qualification; SNORM guest render roles remain refused. Transfers convert one pixel in the same reserved array; restricted image refresh stays GPU-only. The 55 explicit migrations invert all three predecessor runtime files exactly; historical admissions and metadata shapes are retained.

Headed actual M4 Metal smoke, full numerical matrix, independently varied native boundary and owned original43/45 readback prechecks passed their numerical and lifetime checks. The exploratory full matrix recording was rejected by source custody because a proof-harness edit occurred while it ran; it is preserved as a failed precheck and is not submitted as passing evidence. The first signed-clear prechecks exposed an exact -0.5 rounding tie (-63 versus -64); the final harness uses exactly representable signed values and preserves those failed captures. No product change followed either harness finding.

The final selected gate records 192 literal wire/layout/allocation cases, 96 full/truncated NPOT resources with 1152 full sampled frames and 240 selected-surface clear/draw/blend frames, three independently seeded 31-run schedules, exact/short physical image/PBO and logical/native/CPU/scratch limits, actual GL storage/upload/read errors, context/subcontext/native-state restoration, retained generation/public ID reuse and cancellation/disposal. Owned original TRANSFER3D and COPY_TRANSFER3D readbacks preserve complete source/staging rows and untouched padding. Both actual channel/encoding selection controls must finish a physical fence before the unchanged original pixel oracle rejects. Full raw upload/readback bytes and typed native parameters, native planes, old-target retirement pixels, complete shader text, object cleanup and source/served/generated/full V8 custody are captured. Freeze all runtime/harness source, run the final selected gate and one pristine scrubbed exact-head clone, seal and submit to a fresh critic. This layer remains isolated; full API/caps and production guest integration are still required.

### 2026-10-10 — worker — explicit browser proof source closure

The first frozen gate at `76bd5df85e9c59f202d1bd879cb8f2470612432a` passed all 96 native matrix runs, all three 31-run schedules, both completed-fence native controls and independent reconstruction of 83,072 pixels / 41,786 native texels / 1,404 draws / 864 transfers / 2,607 physical fences. It stopped in the historical decoder browser server because that server's explicit source list omitted the new pure imported descriptor module. The failed attempt remains preserved. Add that transitive dependency to explicit historical proof-server source arrays, preserving numeric module indices and every existing assertion/control. These are declarative source/serve metadata corrections; the four affected historical consumers plus the selected original-image consumer run in the final gate. Other unchanged historical source-list declarations are scoped configuration waivers, not new runtime claims. No renderer, compiler or native oracle semantics changed. Freeze this corrected harness; record the final selected acceptance and one final pristine clone.

### 2026-10-10 — worker — sealed final byte-color submission

Frozen acceptance head `30908255d0ab91434ff37505852fe6550977a227`; product runtime is the unchanged `76bd5df85e9c59f202d1bd879cb8f2470612432a` implementation. Exact commands:

```sh
VIRGL_BYTE_COLOR_EVIDENCE_DIR=target/evidence/virgl-standard-byte-color-final make verify-E6-T11d22
python3 tools/virgl-command/standard-byte-color-cold.py --output target/evidence/virgl-standard-byte-color-cold-final
python3 tools/virgl-command/standard-byte-color-seal.py target/evidence/virgl-standard-byte-color-final target/evidence/virgl-standard-byte-color-cold-final evidence/virgl-standard-byte-color-images/worker
```

Both final hot and pristine scrubbed cold gates passed at the exact frozen head with zero browser errors and actual headed Apple M4 Max Metal. Each records 192 literal original wire/layout/allocation cases, 96 full/truncated resources, 1152 complete sampled frames, 240 selected-surface clear/draw/blend frames, three independently seeded 31-run boundary schedules, and two native channel/encoding controls rejected by the original full oracle after completed physical fences. Independent packet replay reconstructs 1,404 native draws, 83,072 full pixels, 41,786 native texels, 864 original synchronous/staged/owned transfers and 2,607 consumed physical fences. Native enum/typed-array and byte audits check 2,548 allocations, 402 uploads and 1,161 reads. Full signed normalization, sRGB decode-before-filter / encode-on-clear-draw-blend, source swizzles and implicit channels hold. GPU-only writes refresh restricted views without CPU uploads. Original43/45 outputs preserve complete logical source/staging rows and all untouched segmented padding. Retained old output is recorded before deletion after its consumed physical fence; generation reuse, cancellation/disposal and real GL failures leave no duplicate native deletion or terminal CPU/GPU/scratch/image/job budget.

The affected original decoder, transfer, color, async and D21 image regressions pass. Source/served/generated/full nested V8 and all complete native/input bodies are bound by digest. The line-sample audit binds 42 complete V8 records and 440 added-line samples; full nested regions remain the fresh critic's authority. The 55 explicit migrations restore all three exact predecessor runtime files. Compiler/cache/constants/Rust/worker/demo remain unchanged; authenticated D21 worker+critic seals carry their prior HELD dependency chain. Source-list declarations for historical browser servers only serve the new pure dependency; assertions and prior controls stay unchanged.

Cold clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-byte-color-cold-6et86a3g/wasm-vm` was clean before and after acceptance. The seal contains 30256 records / 23359582 compressed bytes. Archive SHA256 `06406c64da6f9117633df916eb307c466df9d73c3fcc13abec640f7efcb5ac4e`; index SHA256 `846ce5b67333ea0f3aac751d3c5aed448979ca2f17c2fd1cae569c73974166a7`; hot receipt `92343a0947ee5d6355fb71f193a2647ab2a29d63df7b4b7c32b79ee63615a5db`; cold report `aaa2e726c5a2183250764b2eea5fec3933ab5dbea442d6f982bb0ae97b8b43d0`; cold receipt `17d3aa8752362bd758abd9c5915ed3c4e74e1844bbbae5082c54e0f6d335b61b`.

Claim: this evidence demonstrates one host-selected original byte-color image/transfer/async boundary with actual native signed and sRGB semantics, separately bounded logical/physical bytes and GPU-only image work. This is a worker claim awaiting a fresh adversarial verifier. Complete graphics API/typed caps, actual production RISC-V guest Mesa/compositor, production worker scanout/deployment and performance remain unqualified. No retired rr/ssh path is used.
