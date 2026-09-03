---
id: E5-T03a
epic: 5
title: virtio-gpu scanout binding and FrameSink contract
priority: 503.1
status: pending
depends_on: [E5-T02c]
estimate: S
risk: high
capstone: false
---

## Goal

Implement the `SET_SCANOUT` control command for scanout 0 and establish the core-only
`FrameSink` boundary that later flushes use to publish pixels without importing browser APIs
into the emulator.

## Deliverables

- Typed little-endian request/response support for `SET_SCANOUT` and its bounded control-queue
  dispatch path.
- Validation that `scanout_id < num_scanouts`, the resource exists when non-zero, and the
  requested rectangle is inside the resource; resource id 0 disables the scanout.
- A `FrameSink` trait plus a headless/null implementation suitable for the native and wasm
  cores. Keep the contract explicit about the scanout binding and resource dimensions so the
  flush slice can forward unbound damage legally.
- Native tests proving that invalid requests preserve the prior binding and that disabling
  scanout does not resurrect a resource already cleaned up by T02c.

## Acceptance criteria

- `SET_SCANOUT` binds an existing resource to scanout 0 and returns OK for a valid in-bounds
  rectangle.
- Resource id 0 disables scanout 0; an invalid scanout id, unknown resource id, or out-of-bounds
  rectangle returns the specified error without changing the previous binding.
- The `FrameSink` contract compiles for a headless sink on native and wasm32 without any DOM or
  canvas dependency.

## Adversarial verification

Probe scanout ids at `num_scanouts - 1`, `num_scanouts`, and `u32::MAX`; use resource id 0,
an unknown id, and a resource removed by `UNREF`; and test rectangles whose right or bottom
edge overflows `u32`. Every rejected command must leave the prior binding unchanged and must
not panic or write outside its response descriptor.

## Verification log

(empty)
