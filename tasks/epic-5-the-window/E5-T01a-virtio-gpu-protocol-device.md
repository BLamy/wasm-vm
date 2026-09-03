---
id: E5-T01a
epic: 5
title: virtio-gpu device identity, config space, and protocol types
priority: 501.1
status: in-progress
depends_on: [E4]
estimate: S
risk: high
capstone: false
---

## Goal

Add the virtio-gpu device skeleton and typed wire-format helpers without dispatching a guest
command: device ID 16, VERSION_1 negotiation, the six-byte configuration surface, and exact
little-endian control/response header and display-mode representations.

## Context

Every later GPU command depends on a stable protocol boundary. Keeping identity, feature bits,
configuration registers, and byte-layout fixtures in one small slice makes the device enumerable
before queue behavior is introduced and allows native/wasm byte comparisons without a running
desktop.

## Deliverables

- `crates/core/src/dev/virtio/gpu/` protocol and device-skeleton modules.
- `VirtioGpu` implementing the existing `VirtioDevice` trait with device ID 16, one scanout, and
  zero capsets.
- Native unit tests for feature/config reads and the 24-byte control header plus 408-byte display
  response layout fixtures.

## Acceptance criteria

- `cargo test -p wasm-vm-core --lib gpu_protocol` passes and asserts the exact little-endian bytes
  for the control header and all 16 display modes.
- The device reports ID 16, negotiates VERSION_1, and exposes `num_scanouts == 1` and
  `num_capsets == 0` through the existing virtio-mmio transport.
- No queue command is claimed complete by this slice; command dispatch remains owned by E5-T01b.

## Adversarial verification

Flip every multi-byte field independently and compare the fixture bytes against the virtio-gpu
wire layout. Run the same protocol tests under the wasm32 test target. Attempt an unsupported
feature bit and confirm negotiation rejects it without mutating the configuration surface.

## Verification log
(empty)
