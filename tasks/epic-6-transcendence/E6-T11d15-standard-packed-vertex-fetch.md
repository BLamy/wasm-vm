---
id: E6-T11d15
epic: 6
title: Execute original packed 10/10/10/2 vertex inputs on the GPU
priority: 525.02703900033
status: in-progress
depends_on: [E6-T11d14]
estimate: S
risk: high
capstone: false
---

## Boundary

One packed floating vertex-fetch boundary in the standard async renderer: original R10G10B10A2_UNORM/USCALED/SSCALED/SNORM (8/123/172/173). Retain original GPU buffers and use native signed/unsigned REV pointers for ordinary arrays. Packed elements contain four components in exactly four bytes and require four-byte effective alignment. Stride-zero attributes read those four original bytes once through retained asynchronous GPU tickets and expand the 10/10/10/2 fields into native float generic values. Sign-extend each original width, including the two-bit alpha; clamp signed normalized minima and preserve native scaled values. No CPU per-vertex conversion or shader evaluation.

Keep old floating descriptor shapes, legacy factories, shader compiler/type masks/caches, resource admission and guest/API/caps unchanged. Packed BGR/swizzled inputs, pure integer packed types and texture/storage packed formats remain separate boundaries. This prerequisite does not qualify production guest graphics.

## Deterministic acceptance

`make verify-E6-T11d15` authenticates original enums from the pinned C headers under native and ASan/UBSan builds; original packet/end/divisor bounds and historical factory isolation; source/served/generated/compiler/blob custody; and headed hardware draws with independently reconstructed original full GPU storage and pixels. Exercise all four packed formats for arrays and stride-zero under varied delayed schedules, all channel minima/maxima/interiors, signed minima and two-bit alpha, exact native pointer types/normalization/generic words, every original field through direct word output where the native conversion has an exact contract. Interior native normalized arithmetic uses complete color output rather than a portable bit claim.

Exercise high attribute15, shared and overlapping original buffers, mixed float/packed constant read batches, legal alignment/stride ends, divisors/instances, index widths/restart/all-restart, exact four-byte source ends and one-short rejection, exact staging/work budgets and one-short rejection, stale revision/name reuse/cancel/disposal during pending reads, and native state poisoning/restoration. Native normalization and constant-field sabotages must finish actual draws/fences before failing original full pixels. Repeat the affected compact/scalar/integer physical gates; carry unchanged compiler/vendor/guest and historical HELD proofs by source and evidence digest. Record added JS full-region coverage; no C semantic change is claimed.

Run one final default acceptance in a pristine exact-head clone with scrubbed environment, seal hot/cold records and submit to a fresh critic. The isolated factory remains outside the reachable demo until the later qualified production wiring; no deployment, API/capset, guest instruction execution or throughput claim follows.

## Adversarial verification

Predict original four-byte extent, each literal field's signed/unsigned value and normalization, native pointer/generic types and full original pixels before inspecting. Authenticate predecessor compiler pins and actual full GPU bytes, retained read widths, immutable factory boundaries and pristine clone. Independently seed one delayed high-attribute shared/mixed constant batch, attack two-bit signed alpha and signed minima, legal maximum stride/offset and one-short ends, reuse/stale ownership and native state restoration. Cover each added executable JS region, invent one bounded attack and sabotage promoted pixel assertions through completed native GPU draws. Carry unchanged HELD results; demand only missing proof for untouched boundaries. No speculative capability bits or hidden CPU fallback.

## Verification log

### 2026-10-10 — worker — activation

E6-T11d14 is independently verified at `23bf410f9e152d53e83e674717c647a4164dcde7`; its critic explicitly released the clean branch/index lease. The verified-head negative `evidence/virgl-production-readiness/standard-packed-vertex-gap.json` (SHA-256 `0c757096ea4f341be4a090e76c122e6db9f0c29962e48ca642b3af6822e680d2`) binds four original packed packets and 364 source/generated identities: each formats 8/123/172/173 rejects standard and historical wire admission; `vertexFormat` returns null. Reproduce at that head by reading each literal `packetHex` from the record and passing `Buffer.from(packetHex, 'hex')` to `decodeStandardSubmission` / `decodeSubmission`. The original pinned header names and generated format table establish four 10/10/10/2 components in one 32-bit element. The user's request to finish production guest graphics keeps this ordered S/high fetch prerequisite ahead of unrelated queue work. No production capset or guest execution follows from activation.
