---
id: E6-T11d21
epic: 6
title: Render original 2D sampler ranges and framebuffer mip surfaces
priority: 525.02703900036
status: implemented
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

### 2026-10-10 — worker — final recording selected

Self-validation preserved in `target/evidence/virgl-image-{harness,custody,proof}-precheck` exposed and corrected proof-harness gaps: packed native words need byte lengths and complete shared blob custody, and disposed pending jobs must record the explicit refusal rather than demand more successful steps. No runtime change followed these harness corrections. The final precheck has 936 matrix draws and 30 boundary draws, full original-packet reconstruction of all sampled planes/pixels, and both native selection sabotages rejected after completed physical fences. Earlier failing prechecks remain available; none is final evidence.

The submission gate records the 750 original wire cases, full 24-resource/936-draw range matrix, three independently seeded native boundary schedules, actual GPU-only clear/draw refresh, retained image identities and exact budgets, native allocation/copy failures, completed-fence sabotages and full V8/source/served/generated custody. It also runs affected historical decoder, resource-transfer, color, async and original sampler consumers. Compiler, cache and unqualified Rust/worker/demo boundaries carry exact predecessor identity; this new host-selected renderer is unreachable through the current production demo. One final pristine scrubbed clone and fresh adversarial critic remain required after the frozen run.

### 2026-10-10 — worker — inherited direct-backend fixture correction

The first frozen attempt at `7529bc0c3fe796b9309c682ffd6308f1945f686d` passed the complete native image matrix, all three boundary schedules, both physical sabotages and independent pixel/plane reconstruction, then stopped in historical async `finalCoverage` at its direct backend allocation. Its fixture omitted `lastLevel`, which the documented normalized host-backend contract includes. Actual predecessor `c0488902` and current source both produce `WebGL error 1281` for that incomplete fixture; both allocate successfully with `lastLevel:0`, on the same actual M4 Metal host with zero console errors. The complete reproducer/result is `evidence/virgl-production-readiness/standard-image-legacy-metadata-precheck.json`. This is an inherited harness omission, not an image-product failure. Add only the required zero-level field to the historical fixture. Preserve the failed attempt under `target/evidence/virgl-standard-image-final-attempt1`; freeze the corrected harness, record the final selected gate and run the single final cold clone. Product runtime remains byte-identical to `7529bc0c`.

### 2026-10-10 — worker — sealed final original image submission

Frozen acceptance head `89306b560bb71552a9a6800065ec54273cff0dc8`; product runtime is the unchanged `7529bc0c` implementation. Commands:

```sh
VIRGL_IMAGE_SUBRESOURCES_EVIDENCE_DIR=target/evidence/virgl-standard-image-final make verify-E6-T11d21
python3 tools/virgl-command/standard-image-cold.py --output target/evidence/virgl-standard-image-cold-final
python3 tools/virgl-command/standard-image-seal.py target/evidence/virgl-standard-image-final target/evidence/virgl-standard-image-cold-final evidence/virgl-standard-image-subresources/worker
```

The final hot and pristine scrubbed cold gates both pass at the exact frozen head. Each records 750 original view/surface admission cases and their historical-factory checks, the complete 24-resource/936-draw full/truncated color/range/filter matrix, three independently seeded 33-run native boundary schedules, two actual native selection faults, and affected decoder/resource/color/async/original-sampler regressions. The independent original-packet inverse checks 1,028 native draws, 59,904 full matrix pixels and 30,733 observed native texels across 1,173 rows; both native faults contradict the original oracle only after completed physical fences. Raw original backing/planes/transfer bytes, actual pre-draw sampler state and native plane bytes, complete shaders, original target levels, native objects, later-task fence/job/lifetime state and all GPU-only changes are retained. All healthy predictions hold, including pending delete/unref/reuse, cancellation/disposal, explicit logical nonoverlap and overlap, exact/short budgets, token/hold limits, context/cache/native-state restoration and actual allocation/blit errors. Native objects retire once and terminal budgets are zero.

The recorded browser is headed actual Apple M4 Max Metal with zero console/page/request errors and the actual unchanged 16 MiB compiler exports. Each source/served/native/blob and full V8 record is bound by digest. The line-sample coverage audit contains 43 complete V8 script records and 479 added-line samples; all 206 sampled changed runtime lines have positive witnesses. Full nested regions remain the critic's authority. The explicit 48-migration product inverse restores all three exact D20 runtime files; cache/constants/compiler/Rust/worker/demo are unchanged. D20 worker and critic seals are authenticated against `c0488902`, carrying earlier HELD results through their unchanged dependency chain.

Cold clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-image-state-cold-ktfi4pfh/wasm-vm` is clean before and after acceptance. The seal under `evidence/virgl-standard-image-subresources/worker` has 20366 records and 19471765 compressed bytes. Archive SHA256 `6dcdde6ae41416f458cb4d5371df2ac0c83ae49e2bc0571a3efa52d2142f0a48`; record-index SHA256 `3199b8a4c20646f8cf31bd9b1e3d0b36a45c88e0e6994902b6564fddd425aeaa`; hot receipt `5ee47c6dd478b91d6e968a55889cb9df45dc80134c9861fd7d976ca5a48bdac4`; cold report `0426dd64e2f9de632fade0bbd5d0a3797388af667db1152ed89f21e3a8a5a861`; cold receipt `885823d8eb88371d619d84f3f3c81909dc593b3dcddf80490f607d2519ac9d66`.

Claim: this recording demonstrates one explicitly selected original 2D normalized-color image-range/surface boundary with actual GPU-only copies, exact logical plane selection and retained asynchronous ownership. It is a worker claim awaiting fresh adversarial verification. Complete API/typed capsets, actual production guest Mesa/compositor/scanout, deployment and performance remain unqualified. No rr or retired `ssh dev` path is used.
