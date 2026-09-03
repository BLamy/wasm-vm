---
id: E5-T01b
epic: 5
title: virtio-gpu control queue and GET_DISPLAY_INFO
priority: 501.2
status: pending
depends_on: [E5-T01a]
estimate: S
risk: high
capstone: false
---

## Goal

Drain virtio-gpu control-queue descriptor chains and answer `VIRTIO_GPU_CMD_GET_DISPLAY_INFO`
with one enabled 1280x800 scanout, including exact fence echo semantics and request headers split
across descriptors.

## Context

This is the first guest-visible GPU command. It reuses the existing split virtqueue and virtio-mmio
transport while proving that device-readable request bytes and device-writable response buffers are
handled with the same descriptor ownership rules as the existing block and network devices.

## Deliverables

- Controlq queue-0 dispatch for `GET_DISPLAY_INFO` and cursorq queue-1 exposure.
- Response construction for the 408-byte header plus 16 display modes.
- Queue-driven native tests for contiguous and two-descriptor request headers, with and without
  `VIRTIO_GPU_FLAG_FENCE`.

## Acceptance criteria

- `cargo test -p wasm-vm-core --lib virtio_gpu_display_info` passes with a hand-built descriptor
  chain and asserts response length, scanout rectangle, and status.
- A fenced request returns the same nonzero fence ID and flag; an unfenced request returns fence ID
  zero. A header split across two 12-byte descriptors parses identically to a contiguous header.
- The command consumes the used-ring entry and does not hang when the response is delivered through
  a separate writable tail descriptor.

## Adversarial verification

Submit a response buffer shorter than 408 bytes and inspect guest memory for writes outside the
provided range. Use a zero-length readable segment and a chain with no writable tail; both must be
consumed or rejected without a host panic or stale used-ring entry.

## Verification log
(empty)
