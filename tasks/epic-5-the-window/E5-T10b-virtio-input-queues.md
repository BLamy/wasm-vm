---
id: E5-T10b
epic: 5
title: virtio-input eventq and statusq transport
priority: 510.2
status: in-progress
depends_on: [E5-T10a]
estimate: S
risk: high
capstone: false
---

## Goal

Connect the virtio-input config device to its two queue boundaries: device-to-guest eventq
delivery and guest-to-device statusq consumption, with a host callback for output events.

## Deliverables

- Eventq/statusq queue setup and bounded descriptor-chain servicing on the existing virtio-mmio
  chassis.
- Typed 8-byte `virtio_input_event` encoding/decoding in little-endian order.
- Host status-event callback seam for LED/output events, with malformed and short chains rejected
  without a VM-loop panic or stall.
- Hand-built native queue tests and a wasm32 wire-layout mirror.

## Acceptance criteria

- A posted eventq buffer receives exactly one 8-byte event and the used length is exact.
- A statusq event reaches the host callback with the original type, code, and value.
- Split descriptors, short buffers, unsupported queue shapes, and repeated service calls preserve
  ring progress and return bounded errors; native and wasm32 event bytes are identical.

## Adversarial verification

Exercise split event/status descriptors, empty and undersized buffers, alternating queue kicks,
and a hostile used-ring index. Prove no event is partially written and no status callback runs
for malformed input.

## Verification log

(empty)
