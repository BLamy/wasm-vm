---
id: E6-T12g5
epic: 6
title: Execute bounded RESOURCE_INLINE_WRITE and stride-repacked uploads
priority: 525.0270105
status: pending
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

(empty)
