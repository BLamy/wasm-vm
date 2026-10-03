---
id: E6-T11b2
epic: 6
title: Complete guest 3D submissions and DMA through ordered asynchronous jobs
priority: 525.026972
status: pending
depends_on: [E6-T11b1]
estimate: S
risk: high
capstone: false
---

## Boundary

Connect SUBMIT_3D and TRANSFER_TO_HOST_3D/FROM_HOST_3D through Rust and Wasm to the
verified asynchronous job engine. Own immutable requests and response descriptors
across yields; define bounded admission and dispatch. Validate exact wire sizes,
all guest ranges and full u64 transfer offsets before narrowing. Embedded
TRANSFER3D/COPY_TRANSFER3D commands use the same fresh gather and actual-output
scatter as outer transfer requests. Copy through the bus, never retain guest or
Wasm-memory views.

Order control completion by device epoch and internal request sequence, never by
guest fence IDs. Preserve VIRTIO_GPU_FLAG_FENCE and the full fence ID, including
duplicates and nonmonotonic IDs. Validate the entire completion before scattering
precise dirty rows, then publish response, used.idx, trace and IRQ in that order.
Keep cursorq independent. Run host GPU polling outside Machine.run; pending but
not ready work remains idle, and ready completion wakes service without a new
guest kick or per-instruction GPU polling.

Context destruction is ordered after earlier admitted work. Device reset revokes
old queue ownership and releases pending host jobs; late or duplicate completions
must not touch RAM or old/new used rings. Unsupported commands and host failures
produce explicit errors and replayable diagnostics. Production 3D negotiation
remains disabled pending the truthful capability milestone.

## Deterministic acceptance

`make verify-E6-T11b2` runs affected native/Wasm gates and recorded guest traces
plus headed browser submission/readback tests. Queue 100 fenced commands and
immediately destroy the context: every admitted request receives exactly one
ordered success/error response, and no freed backing is accessed. Document
admission semantics if the implementation leaves descriptors in the available
ring behind one active head rather than copying a large FIFO.

Assert exact native/Wasm wire parity, output-before-used/IRQ, fence echo and
ordering, event-loop/cursor progress, actual fresh uploads and readbacks, and
bounded pending work with varied deterministic completion schedules. Include
reference-decoded command logs and submit/fence/byte counters. Verify the ordinary
built demo and ship any resulting default artifact changes. Complete the high-risk
final pristine-clone proof.

## Adversarial verification

Delay or fail completion, detach backing during a queued transfer, destroy/reuse
context/resource IDs, and interleave independent contexts. Exercise duplicate and
nonmonotonic fence IDs, reset and late/duplicate callbacks. Reject overflowing
transfer arithmetic, malformed submit tails and incomplete response capacity.
Mutate unrelated guest bytes while readback is pending and preserve them. Test
both embedded and outer DMA. Introduce incorrect completion ordering and an early
readback signal and require deterministic failure. Explicit proof negotiation
must not enable production 3D.

## Verification log

(empty)
