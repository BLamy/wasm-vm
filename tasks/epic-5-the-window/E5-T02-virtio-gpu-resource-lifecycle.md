---
id: E5-T02
epic: 5
title: virtio-gpu 2D resource lifecycle (CREATE_2D, ATTACH_BACKING, DETACH, UNREF)
priority: 502
status: pending
depends_on: [E5-T01]
estimate: M
capstone: false
---

## Goal
The device owns a correct 2D resource store: guests can create host resources with
`RESOURCE_CREATE_2D`, attach guest-physical scatter-gather backing with
`RESOURCE_ATTACH_BACKING`, detach, and destroy with `RESOURCE_UNREF` — with strict
validation so a hostile guest cannot exhaust host memory or dangle references.

## Context
Every pixel that ever reaches the canvas lives in one of these resources. A 2D resource
is a host-side linear pixel buffer (`width * height * 4` bytes, host shadow) plus an
optional guest backing sglist (`virtio_gpu_mem_entry { le64 addr, le32 length, le32 pad }`
array). Linux's KMS driver allocates one per framebuffer and churns them on mode changes,
so leaks compound fast. Formats we must accept (virtio spec §5.7.6.7):
`B8G8R8A8_UNORM (1)`, `B8G8R8X8_UNORM (2)`, `A8R8G8B8_UNORM (3)`, `X8R8G8B8_UNORM (4)`,
plus `R8G8B8A8_UNORM (67)` / `X (68)` — Linux xrgb8888 maps to 2 on little-endian.

## Deliverables
- `gpu/resources.rs`: `ResourceMap` keyed by non-zero `resource_id` with
  `{format, width, height, host_pixels: Box<[u32]>, backing: Vec<(GuestAddr, u32)>}`.
- Handlers for `RESOURCE_CREATE_2D`, `RESOURCE_ATTACH_BACKING`, `RESOURCE_DETACH_BACKING`,
  `RESOURCE_UNREF` with error responses per spec (`ERR_INVALID_RESOURCE_ID`,
  `ERR_OUT_OF_MEMORY`, `ERR_INVALID_PARAMETER`).
- Hard limits: max dimension 16384, per-resource ≤ 256 MiB, total resource budget
  (default 512 MiB) — exceeding any returns `ERR_OUT_OF_MEMORY`, no allocation attempt.
- Backing validation: every sg entry range-checked against guest RAM at attach time.
- UNREF of a scanout-bound resource leaves the device consistent (scanout disabled).
- Native tests covering create/attach/detach/unref, duplicate ids, id 0, format 0.

## Acceptance criteria
- [ ] Create → attach → detach → unref round-trips with OK responses; host memory
      returns to baseline (asserted via the resource map's accounted byte total).
- [ ] `RESOURCE_CREATE_2D` with an existing id, id 0, width 0, or format 99 each return
      the spec'd error and allocate nothing.
- [ ] Create at 16384x16384 with budget 512 MiB returns `ERR_OUT_OF_MEMORY` (1 GiB ask).
- [ ] ATTACH_BACKING with an sg entry past end of guest RAM returns
      `ERR_INVALID_PARAMETER` and the resource remains backing-less but alive.
- [ ] 10,000 create/unref cycles show zero net growth in accounted bytes (leak test).

## Adversarial verification
Refute by resource-exhaustion and aliasing attacks: (1) script 1e5 CREATE_2D calls with
unique ids at 4096x4096 and prove host memory (native RSS / wasm memory.grow count) stays
bounded by the budget; (2) attach the same guest pages to two resources and unref one —
prove the other still transfers correctly (no shared-ownership corruption); (3) attach a
0-entry sglist, then TRANSFER (from T03) — must error, not read address 0; (4) integer
overflow probes: width=0x10000, height=0x10000 (w*h*4 overflows u32), nents=0x10000000.
Any panic, unbounded allocation, or wrong-size accounting refutes.

## Verification log
(empty)
