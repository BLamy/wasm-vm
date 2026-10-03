---
id: E6-T11b
epic: 6
title: Complete VirGL submissions and transfers through asynchronous ordered fences
priority: 525.02697
status: cancelled
decomposed_into: [E6-T11b1, E6-T11b2]
depends_on: [E6-T11a]
estimate: S
risk: high
capstone: false
---

## Replacement slices

Implementation inspection found two independent boundaries: the renderer's current
index and texture readbacks are synchronous, and the device must separately own
requests and guest DMA across yields. Continue the user's graphics-offload request
through these ordered S tasks; neither claims production Mesa activation:

1. [E6-T11b1 — asynchronous renderer jobs](E6-T11b1-async-renderer-jobs.md).
2. [E6-T11b2 — virtqueue and DMA completion](E6-T11b2-virtio-3d-ordered-completion.md).

The original acceptance requirements below are retained in those slices. E6-T11c
now depends on E6-T11b2 rather than this cancelled planning container.

## Boundary

Connect SUBMIT_3D and TRANSFER_TO_HOST_3D/FROM_HOST_3D to the shared decoder and
renderer, with validated copies/ownership across Rust, Wasm and JS. Implement
box/stride/layer-stride semantics and asynchronous completion: preserve fence_id
and VIRTIO_GPU_FLAG_FENCE, return control-queue completions in submission order,
and complete reads only after guest backing contains actual renderer output.
Never block the browser event loop waiting for GPU completion. Cursor-queue
progress stays independent. Unknown/unsupported commands produce explicit
errors and replayable diagnostics, not silent skips or fabricated success.

## Deterministic acceptance

`make verify-E6-T11b` runs affected native/wasm gates plus recorded guest traces
and headed browser submission/readback tests. Submit 100 fenced commands and
immediately destroy the context: every accepted request receives one correctly
ordered success/error response, and no freed backing is accessed. Assert fence
ordering, event-loop/cursor progress, output bytes and bounded pending work with
varied deterministic completion schedules. Include reference-decoded command
logs and submit/fence/byte counters. Complete the high-risk final clean clone.

## Adversarial verification

Delay or fail renderer completion, detach backing during queued transfer,
destroy/reuse context/resource IDs and interleave independent contexts. Attack
overflowing transfer arithmetic and malformed submit tails. Sabotage completion
ordering/readback-before-signal and require failure. Explicit test negotiation
does not enable production 3D before the truthful capability milestone.

## Verification log

### 2026-10-03 — planning decomposition

Split before activation; no runtime work was submitted under this container.
E6-T11a is independently verified at `26834baa` (PR #411). The next slice
continues the explicitly requested guest graphics offload.

