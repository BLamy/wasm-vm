---
id: E6-T11d69b
epic: 6
title: Measure logical original transform-feedback primitive query counts
priority: 525.027038
status: pending
depends_on: [E6-T11d69a]
estimate: S
risk: high
capstone: false
---

## Boundary

Original query type6 reports real TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN through
the independently held query/resource lifecycle from69a. The original capture
lowering assembles primitives and repeats POINTS capture per output buffer;
measure real native capture and normalize to original logical primitives once.
Do not sum duplicate output-buffer passes or publish CPU predicted counts.
Unsupported query types remain refused. Bounded allocations, availability,
resource/generation ownership and cleanup remain intact.

## Deterministic acceptance

`make verify-E6-T11d69b` records original query commands, real native feedback
query results and exact original16-byte guest result readback. Independently
predicted counts cover points/lines/triangles, strips/fans, fixed restart,
instances, multiple output buffers, capacity truncation and zero capture.
Interleave virtual owners and completion schedules. Check logical counts against
actual captured data, type6/index0, availability/state/result_size4/u64 high0,
unsupported query types, reuse/destroy/reset and loss. The independent actual
RISC-V GBM/GLES3 probe must admit allthree mandatory targets with no GL errors
or rejected valid transport commands. Record affected high-risk gates and one
final clean clone. Parent then separately proves default Omarchy and deployment.

## Adversarial verification

Fresh verifier holds the source lowering against actual native query calls and
captured bytes. Invent one bounded multi-buffer/restart/capacity case. Sabotage
duplicate-pass counting or primitive normalization and demand that the guest
result oracle fails. Carry unchanged69a results. No CPU capture prediction or
mocked native counter suffices.

## Evidence carried

The independent actual-GLES3 negative and pinned original ABI are preserved in
E6-T11d69 and the committed original-negative seal. Public renderer remains
virgl; no llvmpipe, invented packets, fabricated availability or CPU count may
justify a positive result. Parent default Omarchy remains a separate acceptance.
