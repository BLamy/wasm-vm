---
id: E6-T11a
epic: 6
title: Connect validated virtio 3D context and resource control to the renderer
priority: 525.02696
status: pending
depends_on: [E6-T12d]
estimate: S
risk: high
capstone: false
---

## Boundary

Add the transport/renderer interface and strict control-queue handling for
CTX_CREATE/DESTROY/ATTACH_RESOURCE/DETACH_RESOURCE, RESOURCE_CREATE_3D,
RESOURCE_ATTACH_BACKING/DETACH_BACKING and resource unref. Validate guest RAM
scatter/gather lists and the target/format/bind/dimensions/array/level/sample
fields before forwarding bounded resources to the verified renderer. Keep
transport ownership distinct from JS object/storage references and generations.
Use an explicit test-only negotiation fixture; production VIRGL/capsets stay
disabled until E6-T11d. A null sink proves transport only, never Mesa support.

## Deterministic acceptance

`make verify-E6-T11a` runs affected Rust format/lint/native/wasm builds and tests,
recorded guest command/response traces and the real browser renderer bridge for
valid context/resource lifecycles. Compare spec responses and state digests with
an independent packet oracle. Invalid resource IDs, duplicate attach, stale
generations and guest backing past RAM must return appropriate ERR_* responses
without panic or memory access outside validated bounds. Run final clean clone.

## Adversarial verification

Exercise creation rollback, ID reuse, context destruction while references
remain, backing-page overflow/alias/short lists and failed renderer allocation.
Do not treat nested reference-capture API calls as duplicate guest operations.
Preserve Epic5 two-dimensional control/scanout tests. No live guest 3D or UI
capability claim follows a test-only control-plane fixture.

## Verification log

(empty)
