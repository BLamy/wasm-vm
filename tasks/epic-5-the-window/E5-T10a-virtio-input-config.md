---
id: E5-T10a
epic: 5
title: virtio-input config protocol and declarative device spec
priority: 510.1
status: pending
depends_on: [E5-T05c]
estimate: S
risk: high
capstone: false
---

## Goal

Build the reusable virtio-input identity and configuration boundary from a declarative
`InputDeviceSpec`, with explicit little-endian wire types and a bounded select/subsel query
state machine.

## Deliverables

- `VirtioInput` identity/config state for virtio device id 18.
- `InputDeviceSpec` carrying name, devids, property bits, event capability bitmaps, and absolute
  axis metadata.
- Typed ID_NAME, ID_SERIAL, ID_DEVIDS, PROP_BITS, EV_BITS, and ABS_INFO payloads with correct
  size semantics; unsupported selections return size zero and a zero payload.
- Native fixture tests for the QEMU-shaped configuration bytes and a wasm32 build/test mirror.

## Acceptance criteria

- ID_NAME, ID_DEVIDS, EV_BITS, and ABS_INFO for a fixture spec match the checked-in reference
  bytes, with the name compared separately.
- Unsupported select/subsel combinations return `size = 0` and read as zero without stale union
  bytes from the previous query.
- Every config read is bounded by the 128-byte union and every selector write/read round-trips
  identically on native and wasm32.

## Adversarial verification

Hammer selector changes followed by reads, including unsupported and maximum subsel values, and
prove no query exposes bytes from the previous selection or reads outside the fixed union.

## Verification log

(empty)
