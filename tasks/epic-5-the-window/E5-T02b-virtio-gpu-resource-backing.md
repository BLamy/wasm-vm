---
id: E5-T02b
epic: 5
title: virtio-gpu resource backing attach and detach validation
priority: 502.2
status: verified
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

### 2026-09-03 — worker — implemented

- **Attach/detach — HELD.** The control-queue service decodes the fixed attach header and each
  16-byte memory entry across arbitrary readable descriptor boundaries, validates nonzero ranges
  against guest RAM, atomically publishes the completed `(GuestAddr, u32)` vector, and clears it
  for DETACH. A split attach→detach queue test covers both command responses.
- **Malformed input — HELD.** Out-of-RAM, `u64::MAX` address, truncated sglist, and
  `nents=0x10000000` requests return `ERR_INVALID_PARAMETER` without partial backing mutation;
  `nents=0` returns OK and leaves an explicit empty list.
- **Ownership — HELD.** Two resources receiving equal guest entries retain independent vectors;
  detaching one does not alter the other. The full core and virtio regressions remain green.

Implementation commit: `6785dc0`.

Evidence: `evidence/e5-t02b/resource-backing-2026-09-03.json` (SHA-256
`96c6b31f5f4b2ed6f73973e2ffd02571f37af37993af16c5af46696db525095f`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
gpu_resources_backing` (4 passed); `cargo test -p wasm-vm-core --lib` (195 passed); `cargo clippy
-p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core --no-default-features
--target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic` (22 passed); and
`wasm-pack test --node crates/wasm --test gpu_protocol` (2 passed). Independent-machine, WebKit,
and host-layer rr runs were excluded per the user's direction and current repository evidence
policy.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The focused recording covers successful multi-entry attach, split
  descriptor decoding, detach, zero-entry detach state, out-of-RAM rejection, and exact
  `ERR_INVALID_PARAMETER` handling for truncated, overflowing, and oversized lists.
- **Atomicity/ownership — HELD.** Invalid attaches leave both resources empty, and the independent
  vector test shows that detaching one resource cannot alter another resource with the same guest
  pages.
- **Coverage — HELD.** The changed protocol types, bounded readable-stream walker, guest-RAM
  validation, map mutation methods, and both control-queue command arms are exercised by the
  focused tests; full core and virtio regressions pass.
- **Evidence integrity — HELD.** Evidence digest
  `96c6b31f5f4b2ed6f73973e2ffd02571f37af37993af16c5af46696db525095f` matches the checked-in
  artifact for implementation commit `6785dc0`.

The user explicitly directed this slice to be marked verified; unref and scanout cleanup remain
gated behind E5-T02c.
