---
id: E6-T11d15
epic: 6
title: Execute original packed 10/10/10/2 vertex inputs on the GPU
priority: 525.02703900033
status: implemented
depends_on: [E6-T11d14]
estimate: S
risk: high
capstone: false
---

## Boundary

One packed floating vertex-fetch boundary in the standard async renderer: original R10G10B10A2_UNORM/USCALED/SSCALED/SNORM (8/123/172/173). Retain original GPU buffers. Unsigned arrays use native unsigned REV fetch; signed arrays fetch the original fields through an unnormalized unsigned REV pointer and an actual C-emitted GPU vertex helper sign-extends each original width, including two-bit alpha. SNORM divides by 511/1 and clamps signed minima. Packed elements have four components in four bytes, with four-byte effective alignment. Stride-zero attributes read those four original bytes once through retained asynchronous GPU tickets and supply native float generic values. No CPU per-vertex conversion or shader evaluation.

Host-owned compiler specialization takes four compatible 16-bit masks: existing signed/unsigned integer inputs, signed packed arrays, and their normalized subset. Packed arrays remain native vec4 inputs; normalization masks must be a subset of packed masks, disjoint from integer masks and restricted to declared vertex attributes. Derive the packed masks from the original element format AND a nonzero bound stride. Include all selected formats in retained plan/program/translation identity. Existing stage/pair/typed entry points always have zero packed masks.

Keep old floating descriptor shapes, legacy factories, resource admission and guest/API/caps unchanged. Packed BGR/swizzled inputs, pure integer packed types and texture/storage packed formats remain separate boundaries. This prerequisite does not qualify production guest graphics.

## Deterministic acceptance

`make verify-E6-T11d15` authenticates original enums from pinned C headers under native and ASan/UBSan builds; original packet/end/divisor bounds and historical factory isolation; source/served/generated/compiler/blob custody; and headed hardware draws with independently reconstructed original full GPU storage and pixels. Exercise all four packed formats for arrays and stride-zero under varied delayed schedules, all channel minima/maxima/interiors, signed minima and two-bit alpha, actual pointer/generic types and full original values through direct word output wherever the conversion has an exact contract. Interior normalized arithmetic uses complete color output rather than a portable bit claim.

Exercise high attribute15, shared and overlapping original buffers, mixed float/packed constant read batches, legal alignment/stride ends, divisors/instances, index widths/restart/all-restart, exact four-byte source ends and one-short rejection, exact staging/work budgets and one-short rejection, stale revision/name reuse/cancel/disposal during pending reads, and native state poisoning/restoration. Exercise mixed signed/unsigned integer position inputs with signed scaled/normalized packed colors. On the same original shader/buffers, transition scaled array → normalized array → constant → scaled array, with and without forced cache eviction. Missing methods and malformed compiler masks/metadata/native interfaces must reject before draw. Native normalization, constant-field and GPU alpha-sign sabotages must finish actual draws/fences before failing original full pixels.

Run 59 literal packed compiler cases through actual native, sanitized and fixed-memory Wasm entry points; all declared slots, mixed integer/packed masks, normalized subsets, old zero-packed entry points, malformed/undeclared masks, null/bounded texts, own primitive facade fields, getters/proxy mutation, separate factory memory, fixed 16 MiB OOM and exact recovery. Fail every genuine allocation site for scaled/normalized packed pair variants and prove both complete sources are owned before semantic allocation. Repeat the full prescribed standard compiler gate, stack/allocation/LLVM proofs, retained typed compiler gates and affected compact/scalar/integer physical gates. Bind full LLVM/V8 regions to the added diff and carry unchanged historical HELD proofs by source and evidence digest.

Run one final default acceptance in a pristine exact-head clone with scrubbed environment, seal hot/cold records and submit to a fresh critic. The isolated factory remains outside the reachable demo until the later qualified production wiring; no deployment, API/capset, guest instruction execution or throughput claim follows.

## Adversarial verification

Predict original four-byte extent, each literal field's signed/unsigned value and normalization, actual GPU pointer/generic types and full original pixels before inspecting. Authenticate actual C/Wasm/served source pins and full original GPU bytes, retained read widths, immutable factory boundaries and pristine clone. Independently seed one delayed high-attribute shared/mixed constant batch, attack two-bit signed alpha and signed minima, legal maximum stride/offset and one-short ends, reuse/stale ownership and native state restoration. Attack the four compiler masks, array/constant variant identity and native type reflection. Cover each added executable C/JS region, invent one bounded attack and sabotage promoted pixel assertions through completed native GPU draws. Carry unchanged HELD results; demand only missing proof for untouched boundaries. No speculative capability bits or hidden CPU fallback.

## Verification log

### 2026-10-10 — worker — activation

E6-T11d14 is independently verified at `23bf410f9e152d53e83e674717c647a4164dcde7`; its critic explicitly released the clean branch/index lease. The verified-head negative `evidence/virgl-production-readiness/standard-packed-vertex-gap.json` (SHA-256 `0c757096ea4f341be4a090e76c122e6db9f0c29962e48ca642b3af6822e680d2`) binds four original packed packets and 364 source/generated identities: each formats 8/123/172/173 rejects standard and historical wire admission; `vertexFormat` returns null. Reproduce at that head by reading each literal `packetHex` from the record and passing `Buffer.from(packetHex, 'hex')` to `decodeStandardSubmission` / `decodeSubmission`. The original pinned header names and generated format table establish four 10/10/10/2 components in one 32-bit element. The user's request to finish production guest graphics keeps this ordered S/high fetch prerequisite ahead of unrelated queue work. No production capset or guest execution follows from activation.

### 2026-10-10 — worker — signed packed hardware discovery

The ephemeral direct native signed REV implementation contradicted the original signed alpha contract on this host. `target/evidence/virgl-standard-packed-self-alpha/report.json` records a completed draw/fence with original alpha -2: direct binary32 word output expected bytes `[0,0,0,192]` and observed `[0,0,0,64]` (+2). The full provisional run also failed the signed alpha color pixels. The boundary therefore includes actual C-emitted GPU sign decoding from native unsigned unnormalized fields, selected only for signed packed arrays. This is a portable format path, with no host fingerprint or CPU array conversion. The subsequent ephemeral narrow sign run matched all 256 pixels; the expanded ephemeral matrix passed 210 frames, 15 pre-draw rejections, six pending ownership attacks and three ownership records. These self-checks guide implementation and are not final exact-head evidence.

### 2026-10-10 — worker — implemented submission

Frozen runtime/harness head: `e7a85906622794c60872876f9d3e80da83df9ccd`. Commands: `VIRGL_STANDARD_PACKED_EVIDENCE_DIR=target/evidence/virgl-standard-packed-final-hot make verify-E6-T11d15`; `python3 tools/virgl-command/standard-packed-cold.py --output target/evidence/virgl-standard-packed-final-cold`; `python3 tools/virgl-command/standard-packed-seal.py target/evidence/virgl-standard-packed-final-hot target/evidence/virgl-standard-packed-final-cold evidence/virgl-standard-packed/worker`. Both default acceptances passed at the same exact source head; the cold clone has empty before/after Git status and scrubbed environment.

`evidence/virgl-standard-packed/worker/manifest.json`, `records.json` and `recording.tar.gz` seal 17,844 records. Archive SHA-256 `724887df2941202113d22fd297f8e3a5633ab0ddb409fd8ffa5ef260d4cc0113`; index `1c46154671bdbf7a2e743fbff97db333fee4ad28ac96aca5dcc22d9e1c9e6f85`; hot receipt `f25e1da2e1570ff7e48d11c10ecd9fe6422a25010e897a27339cb6812f5a2941`; cold report `8dbe00ca06db09938229d07fd2e8e0d7a6cfef63410600be66046ed6e90f7ae1`; cold receipt `ca81c3ebbe088cce3e376c4c3762637ceb23bbbde6bce22e71ebb94c228ac7be`. The hot receipt records 8,903 files, full served/source/compiler/blob custody, 61 V8 script records and 18 LLVM file records. Conservative optimized Wasm stack frames total 191,856 bytes against the fixed 262,144-byte stack.

Each hot/cold run proves 59 original wire cases and 59 actual packed compiler cases, fixed-memory OOM recovery, 40 genuine packed allocation faults with exact recovery and source ownership, the retained 48-case typed compiler with all 40 allocation faults, and the full prescribed 669-case/129-frame standard compiler gate. The own headed M4 Metal matrix completes 214 original packed draws with 57,600 independently reconstructed pixels, original complete GPU storage, signed alpha/minima, all four formats, retained constants, high attribute15, mixed integer positions, array/constant/cache transitions, 15 pre-draw rejections, six pending lifetime attacks and native state restoration. All three packed faults complete real draw/fence work before failing original full pixels. Retained compact225/scalar391/integer348 physical matrices and their seven draw/fence faults pass at the same head. The recorded claim is this isolated packed fetch boundary; it grants no API/capset, production guest execution, deployment or MIPS authority. Fresh adversarial verification remains required.
