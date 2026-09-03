---
id: E5-T02a
epic: 5
title: virtio-gpu resource creation and budget accounting
priority: 502.1
status: implemented
depends_on: [E5-T01c]
estimate: S
risk: high
capstone: false
---

## Goal

Add the host-side 2D resource store and a strict `RESOURCE_CREATE_2D` handler. Valid
resources receive an owned linear pixel buffer, while malformed or over-budget requests
return the specified virtio-gpu error without attempting an allocation.

## Context

Later GPU commands address resources by id and transfer pixels through their host shadow
buffers. This slice establishes the ownership and accounting boundary first: resource ids are
non-zero and unique, formats are restricted to the six supported wire values, dimensions are
bounded at 16384, and each resource plus the device total stay within fixed byte budgets.

## Deliverables

- `gpu/resources.rs` with a `ResourceMap` keyed by non-zero `resource_id`, storing format,
  dimensions, `Box<[u32]>` host pixels, and an initially empty backing list.
- `RESOURCE_CREATE_2D` dispatch with `ERR_INVALID_RESOURCE_ID`, `ERR_INVALID_PARAMETER`, and
  `ERR_OUT_OF_MEMORY` responses as appropriate.
- Explicit per-resource (256 MiB) and total (default 512 MiB) accounting with checked size
  arithmetic and no allocation attempt on rejected input.
- Native tests for supported formats, duplicate ids, id 0, zero dimensions, invalid format,
  dimension overflow, and budget rejection.

## Acceptance criteria

- [ ] A valid create inserts exactly one resource and increases accounted bytes by
      `width * height * 4`; its backing list is empty.
- [ ] Existing id, id 0, width 0, height 0, and unsupported format 99 each return the
      spec'd error and leave the map and accounted bytes unchanged.
- [ ] 16384x16384 with the default 512 MiB total budget returns `ERR_OUT_OF_MEMORY` without
      allocating a pixel buffer; a request exceeding 256 MiB is rejected likewise.
- [ ] `cargo test -p wasm-vm-core --lib gpu_resources_create` passes with exact error and
      accounting assertions.

## Adversarial verification

Probe width/height `0x10000`, multiplication near `u32::MAX`, and 100,000 unique 4096x4096
creates. The map must never panic or grow beyond its configured byte budget, and rejected
requests must not change the resource count or accounting total. Flip each supported format
independently to catch a decoder that validates only one enum value.

## Verification log

### 2026-09-03 — worker — implemented

- **Creation and accounting — HELD.** `ResourceMap` is keyed by non-zero resource id and creates
  a zeroed `Box<[u32]>` with an empty backing list. The six supported formats and exact
  `width * height * 4` byte accounting are covered by native assertions.
- **Validation before allocation — HELD.** Duplicate/id-zero, zero dimensions, format 0/99,
  `0x10000` dimensions, the 16384x16384 1 GiB request, and aggregate/per-resource budget
  failures leave resource count and accounted bytes unchanged. The 100,000-request hostile loop
  stops at exactly eight 4096x4096 resources under the default 512 MiB budget.
- **Control-queue boundary — HELD.** A split readable/writable descriptor chain decodes the
  40-byte little-endian `RESOURCE_CREATE_2D` request, returns `RESP_OK_NODATA` with the requested
  fence echo for a valid resource, and returns `RESP_ERR_INVALID_PARAMETER` without insertion for
  an unsupported format.
- **Scope — HELD.** Backing attach/detach and unref/scanout cleanup remain in E5-T02b/T02c.

Implementation commit: `923e9f2`.

Evidence: `evidence/e5-t02a/resource-create-2026-09-03.json` (SHA-256
`c52caaed753e093e56180c38637ea7f19cc0dce64e064d7c1fb27711a676b640`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
gpu_resources_create` (7 passed); `cargo test -p wasm-vm-core --lib` (191 passed); `cargo clippy
-p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core --no-default-features
--target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic` (22 passed); and
`wasm-pack test --node crates/wasm --test gpu_protocol` (2 passed). Independent-machine, WebKit,
and host-layer rr runs were excluded per the user's direction and current repository evidence
policy.
