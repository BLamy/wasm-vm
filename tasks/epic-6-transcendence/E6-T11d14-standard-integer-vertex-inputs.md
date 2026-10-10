---
id: E6-T11d14
epic: 6
title: Execute original pure integer vertex inputs through typed GPU variants
priority: 525.02703900032
status: in-progress
depends_on: [E6-T11d13]
estimate: S
risk: high
capstone: false
---

## Boundary

One original pure integer vertex-input boundary in the host-selected standard async renderer: R/RG/RGB/RGBA 8/16/32_UINT/SINT. Ordinary arrays retain original GPU buffers and native integer pointers; stride-zero attributes retain the bounded asynchronous GPU read batch and sign/zero-expand only the declared width into native integer generic words. Missing components are integer (0,0,0,1). No CPU per-vertex conversion or shader evaluation.

The actual fixed-memory C standard pair compiler receives two host-derived disjoint 16-bit input masks restricted to declared vertex attributes. It configures the pinned upstream masks, emits matching ivec4/uvec4 declarations and raw register-word reads, and returns matching typed metadata. The old stage/pair entry points remain zero-mask. Guest packets do not supply keys or select a compiler facet. Derive masks from owned bound vertex elements; include complete type identity in translation/program keys, reflection and retained draw validation. Preserve variant/cache ownership and budget eviction. Existing floating lookup, old exact/private factories, original shader bodies, source lifetime and full bounds remain intact. Packed/swizzled types, storage/texture/framebuffer/API/caps and guest bring-up are separate boundaries.

## Deterministic acceptance

`make verify-E6-T11d14` authenticates original 24-format enums and packet extents, actual native and ASan/UBSan typed C calls with independent literal masks/types, direct native/Wasm JSON equality, strict primitive-owned requests, allocation exhaustion/recovery and added C hunk LLVM coverage. Because C/shared emitted-output boundaries change, run the affected prescribed standard compiler gate at the frozen head and carry unchanged legacy numerical proofs with direct native/browser anchors; retain actual scalar/compact floating fetch checks.

Headed hardware records original full GPU bytes, real typed shader reflection, IPointer/normalization/divisors/bounds, supplied generic raw words/kind, variant source and original full pixels. Cover every family/count for arrays/stride zero under varied delayed schedules; signed narrow extension, unsigned maxima, 32-bit extrema, 2^24 neighbors and NaN-looking raw words; missing components, attribute15, mixed/shared buffers, effective alignment/overlap/stride ends, divisors/instances/indices/restart/all-restart, exact source/work/staging ends and one-unit-short rejection; pending revision/reuse/cancel/disposal; original float/signed/unsigned/float variants of one owned shader pair and poisoned native state/cache eviction. Wrong type metadata/mask requests reject without native draws. Real native signedness, generic raw-word and supplied typed ESSL conversion faults finish native draws/fences and fail original full pixels.

Record source/generated/served/blob identities and C/V8 coverage, one final pristine exact-head default acceptance with scrubbed environment, seal all hot/cold recordings and submit to a fresh critic. This prerequisite grants no complete API, production capability, guest execution, deployment or performance claim.

## Adversarial verification

Predict source widths, sign/zero expansion and integer defaults, native shader/pointer/generic types, complete input masks/cache identity, exact fetched ends, original GPU words and full pixels before inspecting. Authenticate original source/upload/output custody, actual C/Wasm equivalence and pristine clone. Independently seed one high-attribute mixed/shared integer constant batch with delayed reads; attack NaN-looking words and signed minima, stale/reused sources and changing typed variants/eviction. Cover every added executable C/JS hunk and strict API rejection; sabotage promoted assertions through real native execution. Carry unaffected HELD results and demand only missing proof for unchanged boundaries. No speculative capsets or hidden CPU fallback.

## Verification log

### 2026-10-10 — worker — activation

E6-T11d13 is independently verified at `8037ede91b4c8450e696811d33ac7d34235388ba`; its critic explicitly released the clean index. The verified-head negative `evidence/virgl-production-readiness/standard-integer-vertex-gap.json` binds 24 original packets and 359 source/generated identities: each pure integer format177..200 rejects both standard and legacy wire admission, and the actual standard bridge has no typed pair method. Reproduce with `decodeStandardSubmission` on each literal `packetHex`; the existing `createVirglStandardShaderBridge()` has `typeof translatePairTyped === 'undefined'` at that head. The user's explicit request to finish production guest graphics keeps this ordered S/high prerequisite ahead of unrelated queue work. No production capability or guest execution follows from this activation.
