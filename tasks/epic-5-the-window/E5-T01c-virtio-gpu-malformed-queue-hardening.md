---
id: E5-T01c
epic: 5
title: virtio-gpu malformed commands and descriptor-chain hardening
priority: 501.3
status: verified
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

### 2026-09-03 — coordinator — VERDICT: verified (user-directed)

- **Malformed command progress — HELD.** `virtio_gpu_malformed_requests_make_progress_and_recover`
  submits `0xdead`, a one-byte request, a valid request with no writable descriptors, and then a
  valid request. All four used entries publish; the first returns `RESP_ERR_UNSPEC`, the malformed
  paths write nothing, and the final request returns the enabled 1280x800 scanout.
- **Bounds and address safety — HELD.** The short request leaves its 408-byte sentinel untouched.
  A response descriptor straddling the end of guest RAM is rejected by the virtqueue validator,
  drops the cached queue view, raises `NEEDS_RESET`, writes no response bytes, and leaves used.idx
  unchanged rather than exposing a stale completion.
- **Regression/parity — HELD.** The malformed acceptance command passed 2/2 tests; all GPU tests
  passed 9/9; the full core library passed 184/184. Existing virtio-mmio, virtio-blk, and
  virtio-net integration tests passed 2, 12, and 8 tests respectively. The core wasm32 build and
  wasm32 Node protocol/MMIO runner (2 tests) also passed.
- **Scope — HELD.** Resource and pixel-transfer commands remain later Epic 5 work; this closes the
  malformed boundary for the current GPU skeleton only.

Implementation commit: `0d85128`.

Evidence: `evidence/e5-t01c/malformed-2026-09-03.json` (SHA-256
`fa92fe9d8487eb8104ed31cc6694d8c4f3735f734b0f9e83dff00505cd7e0489`).

Commands: `cargo fmt --all`; `cargo test -p wasm-vm-core --lib virtio_gpu_malformed` (2 passed);
`cargo test -p wasm-vm-core --lib gpu::` (9 passed); `cargo test -p wasm-vm-core --lib` (184
passed); `cargo test -p wasm-vm-core --test virtio_mmio_slots` (2 passed); `cargo test -p
wasm-vm-core --test virtio_blk` (12 passed); `cargo test -p wasm-vm-core --test
virtio_net_critic` (8 passed); `cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo
build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown`; and `wasm-pack test
--node crates/wasm --test gpu_protocol` (2 passed). Independent-machine, WebKit, and host-layer
rr runs were not used per the user's direction and current repository evidence policy.
