---
id: E5-T02a
epic: 5
title: virtio-gpu resource creation and budget accounting
priority: 502.1
status: in-progress
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

(empty)
