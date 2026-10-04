---
id: E6-T12g5
epic: 6
title: Execute bounded RESOURCE_INLINE_WRITE and stride-repacked uploads
priority: 525.0270105
status: in-progress
depends_on: [E6-T12g4]
estimate: S
risk: high
capstone: false
---

## Boundary

Complete RESOURCE_INLINE_WRITE and required stride-repacked texture uploads
through the checked command/store boundary. Preserve exact guest bytes, format
conversion, boxes/levels/row/layer strides, deferred ownership and generation
checks. Do not decode opaque END_TRANSFERS padding recursively or weaken other
command framing. Use original packet/payload provenance wherever captured.

## Deterministic acceptance

`make verify-E6-T12g5` executes required original inline/transfer packets
and independent physical byte/color/depth oracles, including odd padded rows,
partial boxes, caller mutation and async yields. Bound all allocations before
GPU effects; require malformed/short/overflow/unsupported packets to fail and
an exercised copy/stride source fault to be detected. Retain format/view and
tiny-scene regressions and final pristine-clone proof.

## Adversarial verification

Attack packet lengths, trailing data, offset/stride/layer overflow, caller
mutation and detached/shared inputs, bad resource roles, ID reuse and overlapping
rows. Check untouched guest padding and neighbors. Sabotage one row or inline
payload offset and require the independent physical oracle to fail.

## Verification log

### 2026-10-04 — worker — execution boundary

Continue the user's graphics-offload chain from independently verified G4
`feb78352200139079db61257acf1de1004456037`. The authenticated G1 inventories
contain zero client RESOURCE_INLINE_WRITE packets, two kmscube TRANSFER3D
packets and three es2gears TRANSFER3D packets. Prove those original packets and
payloads separately from synthetic inline packets; do not invent capture claims.

Admit opcode9 with the pinned eleven common words and data beginning at word12,
level0 and one buffer/2D layer. Preserve opaque usage. Default row stride is the
whole resource's width in guest bytes; default layer stride is the whole height,
as in pinned vrend_renderer transfer validation. The narrow inline profile accepts
exactly the rounded-up strided footprint (up to three unused alignment bytes),
not extra whole words. Repack owned dense scratch only after bounds/quotas. Inline
payloads do not require guest backing, never scatter into backing, and async jobs
yield before issuing their owned upload with resource/membership generation checks.
END_TRANSFERS stays opaque. Higher mip/layer/target families remain rejected.

Acceptance includes original normal transfers, native color2/67/233 and Z16,
odd/padded rows and partial boxes, buffer input, padding/neighbors, default strides,
malformed/overflow/accessor inputs, caller mutation, actual delayed fences, ID and
attachment reuse, allocation/backend fault rollback and independent source sabotage.
The compiler/CPU/web deployment boundaries remain unchanged; negotiation is disabled.

