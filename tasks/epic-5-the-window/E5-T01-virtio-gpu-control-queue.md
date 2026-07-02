---
id: E5-T01
epic: 5
title: virtio-gpu device skeleton, control queue, and GET_DISPLAY_INFO
priority: 501
status: pending
depends_on: [E4]
estimate: M
capstone: false
---

## Goal
A virtio-gpu device (virtio device ID 16) on the existing virtio-mmio transport that
negotiates features, exposes controlq (queue 0) and cursorq (queue 1), parses the
`virtio_gpu_ctrl_hdr` protocol, and answers `VIRTIO_GPU_CMD_GET_DISPLAY_INFO` with one
enabled 1280x800 scanout — the foundation every later GPU command builds on.

## Context
Epic 5's entire display stack hangs off this device. We reuse the virtio-mmio transport
and virtqueue code from Epics 2–3; what is new is the GPU protocol layer: 24-byte
`virtio_gpu_ctrl_hdr` (le32 type/flags, le64 fence_id, le32 ctx_id, u8 ring_idx, 3B pad),
request/response type spaces (cmds 0x01xx, OK responses 0x11xx, errors 0x12xx), fence
semantics (`VIRTIO_GPU_FLAG_FENCE` → response must echo fence_id and the flag), and the
config space `{events_read, events_clear, num_scanouts, num_capsets}`. Reference:
virtio spec v1.2 §5.7; Linux `drivers/gpu/drm/virtio/`; QEMU `hw/display/virtio-gpu.c`.

## Deliverables
- `crates/vm-core/src/devices/gpu/mod.rs`: `VirtioGpu` implementing the existing
  `VirtioDevice` trait; device ID 16, `num_scanouts = 1`, `num_capsets = 0`.
- Protocol module with typed encode/decode for `virtio_gpu_ctrl_hdr` and
  `virtio_gpu_resp_display_info` (16 `pmodes`, scanout 0 enabled, r = 0,0,1280,800).
- Command dispatch loop that drains controlq descriptor chains, handles requests split
  across multiple descriptors, and writes responses into the device-writable tail.
- Unknown/unsupported commands answered with `VIRTIO_GPU_RESP_ERR_UNSPEC`, never a hang.
- Native unit tests driving the queue with hand-built descriptor chains (no browser).

## Acceptance criteria
- [ ] Device enumerates on virtio-mmio; a native test negotiates features and reads
      config space `num_scanouts == 1`.
- [ ] `GET_DISPLAY_INFO` returns 408 bytes: OK header + 16 pmodes, only pmode[0] enabled
      with rect 0,0,1280,800; byte layout diffed against a hex fixture captured from QEMU.
- [ ] A request with `VIRTIO_GPU_FLAG_FENCE` gets a response with the flag set and the
      same fence_id; without the flag, fence_id in the response is 0.
- [ ] A request header split across two 12-byte descriptors is parsed correctly.
- [ ] Command type 0xdead gets `RESP_ERR_UNSPEC` and the device keeps serving.
- [ ] All tests pass under `cargo test` and the wasm32 test runner.

## Adversarial verification
Refute by protocol malformation: submit chains with (1) a device-writable buffer shorter
than the response (must truncate or error, not overflow guest memory), (2) zero
device-writable descriptors (must consume the chain without writing), (3) a 1-byte
request. Boot the E4 Linux kernel with its stock (non-graphics) config and confirm the
extra device does not perturb existing boot (dmesg diff vs E4 baseline). Endianness: run
the byte-layout fixture test under wasm32 and native and diff outputs. Any host panic,
guest-memory write outside the provided descriptors, or fixture mismatch is a refutation.

## Verification log
(empty)
