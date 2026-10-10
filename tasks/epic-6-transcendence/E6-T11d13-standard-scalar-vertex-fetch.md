---
id: E6-T11d13
epic: 6
title: Execute remaining scalar floating vertex formats from original GPU buffers
priority: 525.02703900031
status: in-progress
depends_on: [E6-T11d12]
estimate: S
risk: high
capstone: false
---

## Boundary

One scalar floating vertex-fetch boundary in the selected standard async renderer:
original R/RG/RGB/RGBA32_UNORM/SNORM and 8/16/32_USCALED/SSCALED. Extend the
immutable pinned format descriptor; ordinary arrays keep original GPU buffers,
native floating shader inputs, pointer conversion, exact type/normalization,
offsets/strides/divisors and bounded actual source fetches. No CPU vertex conversion
or shader evaluation. Stride-zero values retain the existing asynchronous GPU
read batch and unpack only the declared signed/unsigned scalar width into native
generic binary32 values. Scaled inputs convert their scalar values directly;
normalized32 clamps signed minima and uses its full original integer range.

Preserve existing float32/half/normalized8/16 fetch semantics, missing lanes,
work/byte ceilings, source revision/name reuse/cancellation/disposal and cached
A/B/A native state restoration. Pure integer and packed/swizzled formats, compiler
semantics and production caps remain separate. Update historical wire exclusions
whose format is deliberately admitted by this new boundary; preserve their original
sealed negative evidence as history. This prerequisite does not qualify complete
API support or activate production guest graphics.

## Deterministic acceptance

`make verify-E6-T11d13` checks original pinned native/sanitized enums, literal wire
admission/end bounds and headed hardware through the unchanged fixed-memory
compiler. Record every new family/component count for arrays and stride-zero
attributes under varied delayed schedules; native pointer type/normalization,
original full GPU storage, actual reads and exact supplied generic words. An
independent literal byte/original-shader oracle must not import the runtime format
descriptor or scalar converter.

Probe signed/unsigned widths, zero/min/max, values around binary32 rounding at
2^24, signed minima normalization, missing lanes, shared/mixed byte and 32-bit
buffers, individually unaligned offsets with aligned sums, non-four-byte and
legal overlapping strides, indices/restart/instances/divisors, exact ends and
one-byte-short buffers, staging/work limits and pending source lifetime attacks.
Actual served native type/normalization and generic scalar conversion faults must
complete real draws/fences and fail original full pixels. Preserve standard
native numerical authority without claiming a portable exact arithmetic certificate.

Carry unchanged compiler/allocator and earlier HELD evidence; run the affected
compact positive hardware and legacy float32 admission once. Record source/blob
custody and V8 coverage, one final pristine exact-head default acceptance with
scrubbed environment, then seal for a fresh critic. No unrelated compiler gauntlet
restart for the unchanged C/Wasm boundary.

## Adversarial verification

Predict integer source widths, signedness, normalization, native floating input
types, component defaults, generic binary32 words, actual last fetched bytes and
pixels before inspecting evidence. Authenticate original uploads/native storage,
source/Wasm identities and the clean clone. Independently seed one mixed-width
shared-buffer and stride-zero case with delayed read collection, then attack a
rounding boundary, a signed minimum and a stale/reused source. Cover every changed
runtime hunk and sabotage the promoted oracle through actual GPU execution. Carry
unchanged HELD results rather than re-litigating prior compiler arithmetic.

## Verification log

### 2026-10-10 — worker — activation

Predecessor E6-T11d12 is independently verified at
`b98847797f109b0a3af6171fd0a8c21983e1057b`; its fresh critic explicitly released
the clean index. The literal negative record
`evidence/virgl-production-readiness/standard-scalar-vertex-gap.json` binds all
32 original scalar packets and 356 source/generated identities at that verified
head. Each packet still fails standard and historical admission. The user's
explicit instruction to finish production guest graphics keeps this ordered
prerequisite ahead of unrelated general-queue work. One active S/high boundary;
no production caps or complete API claim is made by this activation.

### 2026-10-10 — worker — self-validation before freeze

The runtime diff is limited to original scalar descriptors in `decoder.mjs`
and the signed-width/normalized-versus-scaled stride-zero branch in `state.mjs`.
No compiler, allocator, interface, resource, guest or production source changed.
The first complete new hardware run passed 383 frames, 396 wire records and 80
historical wire records. Both actual served faults completed draw/fence work
and failed original pixels: signedness expected `[0,0,0,207]`, observed
`[0,0,0,79]`; scaled-generic rounding expected `[0,0,128,75]`, observed
`[0,0,0,75]`, both at pixel(1,2). Offline original byte/storage/word/pixel checks
passed. Pinned native and ASan/UBSan enum programs print the same literal list.

The affected compact225 and its two native faults still pass their independent
saved-pixel audit; the promoted critic44/297-wire run passes unchanged original
TGSI/pixel interpretation with the deliberately updated scalar exclusions.
Historical recordings remain byte-identical. Eight additional normalized32
retained-generic interior word checks bring the final matrix to 391 frames,
including full-original-range rounding. `target/evidence/virgl-scalar-self-*`
and `/tmp/wasmvm-scalar-*.log` are inner-loop output only, not the final proof.
The final default hot and scrubbed pristine-clone command will be recorded once
at the frozen implementation/harness head, then sealed for a fresh critic.
