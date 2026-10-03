---
id: E6-T11b
epic: 6
title: Complete VirGL submissions and transfers through asynchronous ordered fences
priority: 525.02697
status: pending
depends_on: [E6-T11a]
estimate: S
risk: high
capstone: false
---

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

(empty)
