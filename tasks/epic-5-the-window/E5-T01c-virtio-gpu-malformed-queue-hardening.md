---
id: E5-T01c
epic: 5
title: virtio-gpu malformed commands and descriptor-chain hardening
priority: 501.3
status: pending
depends_on: [E5-T01b]
estimate: S
risk: high
capstone: false
---

## Goal

Close the virtio-gpu skeleton's malformed-input boundary: unsupported commands return
`VIRTIO_GPU_RESP_ERR_UNSPEC`, short or missing request data never panics, and the device continues
serving a valid display-info request after each rejected chain.

## Context

GPU control queues are guest-controlled memory. The final slice turns the protocol implementation
into a safe reusable device by proving bounded reads, bounded writes, used-ring progress, and
recovery after malformed requests before later resource and scanout commands are added.

## Deliverables

- Defensive request/response bounds checks in the GPU queue path.
- Regression tests for command `0xdead`, one-byte requests, zero writable descriptors, and truncated
  response buffers.
- A native virtio-mmio enumeration regression confirming the new device does not disturb existing
  headless boot devices.

## Acceptance criteria

- `cargo test -p wasm-vm-core --lib virtio_gpu_malformed` passes all malformed-chain cases with no
  panic, out-of-bounds guest-memory write, or queue hang.
- `0xdead` produces `VIRTIO_GPU_RESP_ERR_UNSPEC`, and a subsequent valid `GET_DISPLAY_INFO` request
  still produces the expected enabled 1280x800 scanout.
- The existing core virtio-mmio/device tests remain green in the same command invocation.

## Adversarial verification

Sabotage each descriptor length and physical address independently, including a response tail that
straddles the end of guest RAM. Confirm the error response is truncated safely, the used length is
bounded by the writable capacity, and a following valid request cannot observe stale bytes from the
rejected chain.

## Verification log
(empty)
