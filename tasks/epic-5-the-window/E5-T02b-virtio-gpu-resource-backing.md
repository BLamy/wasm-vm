---
id: E5-T02b
epic: 5
title: virtio-gpu resource backing attach and detach validation
priority: 502.2
status: in-progress
depends_on: [E5-T02a]
estimate: S
risk: high
capstone: false
---

## Goal

Implement `RESOURCE_ATTACH_BACKING` and `RESOURCE_DETACH_BACKING` for the resource store,
including checked scatter-gather decoding and guest-RAM range validation. A failed attach is
atomic: the resource remains alive and backing-less (or retains its previous valid backing).

## Context

Linux supplies guest-physical memory entries rather than a contiguous host pointer. The
handler must validate the entire descriptor array and every `addr..addr+length` range before
publishing any backing entries. Zero entries are a valid detached state but must not make later
pixel transfers read address zero.

## Deliverables

- Typed decoding of `virtio_gpu_mem_entry { le64 addr, le32 length, le32 pad }` arrays with
  checked `nents` and byte-count arithmetic.
- `RESOURCE_ATTACH_BACKING` and `RESOURCE_DETACH_BACKING` handlers returning the specified
  invalid-resource and invalid-parameter errors without partial mutation.
- Guest-memory range checks for every entry, including address and length overflow handling,
  and a native test seam for a bounded guest RAM model.
- Native tests for valid multi-entry backing, past-RAM ranges, zero-entry lists, malformed
  counts, stale/unknown resource ids, detach, and overlapping guest pages attached to two
  independent resources.

## Acceptance criteria

- [ ] A valid attach publishes the exact `(GuestAddr, u32)` entries and returns OK; detach
      clears them and returns OK.
- [ ] Any entry that extends past guest RAM, overflows its address range, or has an invalid
      sglist location returns `ERR_INVALID_PARAMETER` with no partial backing mutation.
- [ ] An attach to an unknown resource returns `ERR_INVALID_RESOURCE_ID`; an oversized
      `nents` value is rejected before host allocation or unbounded parsing.
- [ ] `cargo test -p wasm-vm-core --lib gpu_resources_backing` passes, including the shared
      guest-page alias case.

## Adversarial verification

Use `nents=0x10000000`, a truncated sglist, address `u64::MAX`, and a final entry whose end
overflows or lands one byte past RAM. Attach identical guest pages to two resources, detach
one, and confirm the other retains its independent entries. A zero-entry attach must leave the
resource explicitly backing-less so a later transfer can reject it rather than dereference 0.

## Verification log

(empty)
