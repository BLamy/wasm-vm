---
id: E6-T11d14
epic: 6
title: Execute original pure integer vertex inputs through typed GPU variants
priority: 525.02703900032
status: implemented
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

### 2026-10-10 — worker — sealed implementation submission

Frozen runtime/harness head: `12bb78e1b7f4b9d636f8d46091b9a1a1766fbe4b`.
Final commands, run once at that head:

```sh
VIRGL_STANDARD_INTEGER_EVIDENCE_DIR=target/evidence/virgl-standard-integer-final make verify-E6-T11d14
python3 tools/virgl-command/standard-integer-cold.py --output target/evidence/virgl-standard-integer-cold-final
python3 tools/virgl-command/standard-integer-seal.py target/evidence/virgl-standard-integer-final target/evidence/virgl-standard-integer-cold-final evidence/virgl-standard-integer/worker
```

Both default acceptances passed. The cold clone checked out the same head and had empty tracked/untracked status before and after the run. The worker seal contains 14584 records; archive SHA-256 `a4f79256677d3f5ef6e2de5f1b2c15ca6b85b6b9c7f7ba5ccbb222424459b93a`, record-index SHA-256 `506e7ff96e26d0a7098c5cd2b6d30c43aa79d9a67b468b3e30b5a8e86ce44df9`. The replayable records are `evidence/virgl-standard-integer/worker/{manifest.json,records.json,recording.tar.gz}` with `hot/` and `cold/` acceptance trees and their generated binaries. Hot receipt SHA-256 `8ba7b61ed65d40469766f8f8bb793e479b74f73434718589f54f49655c6d3e03`; cold receipt SHA-256 `592509c490a69714c38326c6b410068bbada883984a93931830bc517e82826af`.

The recordings demonstrate 300 literal wire/extent cases with historical isolation; 48 actual native/ASan/UBSan/Wasm typed compiler cases and complete literal slot masks, strict owned requests, fixed16MiB pressure/recovery; all40 actual typed allocation failures and exact recovery/caller mutation. On headed M4 Metal, 348 original integer draws prove 91,392 complete pixels, original upload/full-storage custody, native pointers/generic raw words/reflection/source, all24 formats/counts, every missing lane, signed extrema/2^24/NaN-looking words, high15, mixed/shared sources, exact/short bounds and budgets, varied delays, six pending lifetime attacks, disposal, native poison and same-owned float/signed/unsigned/float variants with and without eviction. Four typed-response/method mismatches reject before native draws. All three original-pixel sabotages finish actual draws/fences: the signed8 descriptor supplies unsigned native pointer plus matching native shader type, generic words flip a bit, and supplied typed ESSL numerically converts the raw word. The ESSL sabotage changes supplied output after translation; it is not an actual C source mutation.

Because the standard C/shared-emitter boundary changed, the full prescribed compiler gate was run in both recordings: 669 cases, 129 physical frames /2,390,688 independently recomputed pixels, allocations, LLVM and optimized Wasm stack, plus direct ordinary/raw/private anchors. The helper's108,256-byte frame plus33,728 conversion,49,216 largest upstream and640 emitter remain below the262,144-byte stack; receipt accounting now includes the helper and both exported wrappers. Original scalar391 and compact225 physical frames and their real completed-draw pixel faults pass on the new binary. `coverage-audit.json` binds LLVM/V8 full regions and added-line samples; all117 added runtime JS samples have positive counters, with full regions remaining verifier authority. Historical verified evidence is unchanged and carried by digest.

This isolated standard factory is not wired into the demo/ordinary guest device yet; no positive capset, complete API, guest instruction execution, deploy or MIPS claim follows. AGENTS.md's reachable-demo gate belongs to the later qualified production wiring. The final frozen diff and recorded evidence are submitted to a fresh critic; the worker has not marked this task verified.
