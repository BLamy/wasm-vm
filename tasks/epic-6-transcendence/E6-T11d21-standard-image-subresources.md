---
id: E6-T11d21
epic: 6
title: Render original 2D sampler ranges and framebuffer mip surfaces
priority: 525.02703900036
status: in-progress
depends_on: [E6-T11d20]
estimate: S
risk: high
capstone: false
---

## Boundary

One host-selected original image-subresource boundary. Original SAMPLER_VIEW first/last mip words select their precise retained 2D resource range; original SURFACE level selects the actual framebuffer plane and logical dimensions. Preserve all historical decoder/store/renderer admissions and shapes. A new original image owner charges bounded GPU-only private immutable copies for restricted ranges, because WebGL2 texture base/max state belongs to the whole native texture. Different simultaneous VS/FS ranges never overwrite each other's selection. Complete original ranges may alias their retained native source. Refresh restricted ranges with matching-format unscaled native GPU blits before each active draw, including GPU-only writes; no CPU image or content-revision assumption supplies the copy. Restore native base/max and bindings explicitly. View and surface allocations remain retained/charged through job completion fences, public deletion/reuse, cancellation and disposal. Defined nonoverlap same-image ranges may render into a distinct mip plane; overlapping logical framebuffer feedback rejects even when private images differ. All image draws/clears use owned jobs. Formats/targets remain the existing bounded normalized 2D color family; arrays/cubes/depth mip/shadow and complete API/caps remain successor boundaries.

## Deterministic acceptance

`make verify-E6-T11d21`

Literal original view/surface/transfer/draw packets, exact retained native identities and complete shader bodies prove full/truncated NPOT resources, every admitted mip range/plane in formats2/67/233, distinct simultaneous VS/FS ranges, original min/mag/mip filter and finite LOD selection, swizzles and selected surface dimensions. Native GPU-only copy/clear/draw and complete native planes/full completed-fence output pixels must match an independent oracle reconstructed from original inputs and native format rules. Poison base/max, active units and framebuffer state; restore contexts/subcontexts/caches. Exercise GPU-only source mutation, logical overlapping-feedback rejection and defined same-image nonoverlap rendering, original public-ID/handle reuse, live queued delete/rebind and retained allocation charges until final later-task GPU fences. Reject original malformed/out-of-bounds view/surface ranges before publication, exact/one-byte-short private-view budgets and hold-count limits, actual native allocation/copy errors, revocation/cancellation/disposal. Native surface-level and view-copy-level sabotages must complete physical fences before the unchanged original oracle rejects. Record complete source/served/generated/native/V8 custody, affected old decoder/storage/draw paths at frozen head, one pristine scrubbed exact-head clone and sealed evidence. No complete API, production guest/caps or deployment authority follows from this isolated prerequisite.

## Adversarial verification

Predict literal mip ranges, source plane/native sampler/target identities, full GPU words and full output pixels before reading evidence. Authenticate every hot/cold member and inherited HELD dependency digest; audit every changed nested region or give a specific carry/waiver. Attack all admitted image ranges/planes/formats/roles/budgets/ownership boundaries. Invent one bounded original same-image or retained-generation attack with independent seeds/schedules; sabotage its actual native selection and require original-oracle failure after a completed fence. Promote recurring proof and seal fresh captures. The fresh critic never fixes implementation.

## Verification log

### 2026-10-10 — worker — negative readiness planning

D20 supplies native mip storage and transfers, but its selected decoder still rejects nonzero original SAMPLER_VIEW ranges and SURFACE levels, and historical draw consumers require kind=texture. Reproduce the complete original literal packets in `evidence/virgl-production-readiness/standard-image-gap.json` through `decodeStandardTextureSubmission`. WebGL2 exposes texture-wide base/max state rather than independent texture-view objects, so an unchanged global state mutation cannot justify simultaneous different guest views. This successor qualifies one actual GPU image-subresource boundary under the user's continuing production graphics request; full API/capsets, real guest Mesa/compositor and deployment remain gated.

### 2026-10-10 — worker — verified predecessor and ordered selection

D20 is independently verified at `c0488902039a5fb5f9efc8c62101798668b2ce4a` and its exclusive lease is released. Original decoder/resource/state bytes and fixed-memory Wasm in the negative image record remain unchanged through that verdict. The explicit request to finish production guest graphics selects this next original image boundary ahead of unrelated queue work. M4 prechecks in /tmp are exploratory; only the forthcoming frozen original-wire/native recording and fresh independent critic can grant image authority. Old API/capset, guest and deployment gates stay closed.

### 2026-10-10 — worker — activated

This original image-subresource boundary is the sole active task, with D20 independently verified. Temporary full/truncated, format, GPU-only, lifetime, budget, native-error and maximum-level prechecks passed on actual M4 Metal; they are not the final submission. Freeze the runtime and original harness, run the selected affected gates once, record full native/V8/source custody, run one final pristine scrubbed clone, seal and submit to a fresh critic.
