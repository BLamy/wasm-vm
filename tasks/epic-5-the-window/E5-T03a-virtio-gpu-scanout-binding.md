---
id: E5-T03a
epic: 5
title: virtio-gpu scanout binding and FrameSink contract
priority: 503.1
status: verified
depends_on: [E5-T02c]
estimate: S
risk: high
capstone: false
---

## Goal

Implement the `SET_SCANOUT` control command for scanout 0 and establish the core-only
`FrameSink` boundary that later flushes use to publish pixels without importing browser APIs
into the emulator.

## Deliverables

- Typed little-endian request/response support for `SET_SCANOUT` and its bounded control-queue
  dispatch path.
- Validation that `scanout_id < num_scanouts`, the resource exists when non-zero, and the
  requested rectangle is inside the resource; resource id 0 disables the scanout.
- A `FrameSink` trait plus a headless/null implementation suitable for the native and wasm
  cores. Keep the contract explicit about the scanout binding and resource dimensions so the
  flush slice can forward unbound damage legally.
- Native tests proving that invalid requests preserve the prior binding and that disabling
  scanout does not resurrect a resource already cleaned up by T02c.

## Acceptance criteria

- `SET_SCANOUT` binds an existing resource to scanout 0 and returns OK for a valid in-bounds
  rectangle.
- Resource id 0 disables scanout 0; an invalid scanout id, unknown resource id, or out-of-bounds
  rectangle returns the specified error without changing the previous binding.
- The `FrameSink` contract compiles for a headless sink on native and wasm32 without any DOM or
  canvas dependency.

## Adversarial verification

Probe scanout ids at `num_scanouts - 1`, `num_scanouts`, and `u32::MAX`; use resource id 0,
an unknown id, and a resource removed by `UNREF`; and test rectangles whose right or bottom
edge overflows `u32`. Every rejected command must leave the prior binding unchanged and must
not panic or write outside its response descriptor.

## Verification log

### 2026-09-03 — worker — implemented

- **Scanout binding — HELD.** The control queue decodes a fixed little-endian SET_SCANOUT
  request, validates the single scanout, live resource, and rectangle with widened arithmetic,
  binds a valid resource, and treats resource id 0 as an explicit disable.
- **Failure atomicity — HELD.** Short requests, invalid scanout ids, unknown resources, and
  overflowing/out-of-bounds rectangles return bounded errors without changing an existing
  binding. A split readable descriptor chain is covered.
- **Presentation seam — HELD.** `FrameSink` is a browser-independent core trait and the
  default `NullSink` keeps headless devices usable; transfer and flush remain in T03b/T03c.

Implementation commit: `c8ea5b0`.

Evidence: `evidence/e5-t03a/scanout-binding-2026-09-03.json` (SHA-256
`8ada9397674e6096165f4377a4f2b46264c53d6476c9d7f15b1cab55251722d9`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
gpu_scanout_binding` (6 passed); `cargo test -p wasm-vm-core --lib` (205 passed); `cargo clippy
-p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core --no-default-features
--target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic` (22 passed); and
`wasm-pack test --node crates/wasm --test gpu_protocol` (2 passed). Independent-machine, WebKit,
and host-layer rr runs were excluded per the user's direction and current repository evidence
policy.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The focused recording proves valid binding, explicit disable, split
  request decoding, exact little-endian wire layout, bounded short-request handling, and
  prior-binding preservation for invalid scanout/resource/rectangle inputs.
- **Coverage — HELD.** The changed protocol type, FrameSink/NullSink boundary, constructor
  wiring, rectangle arithmetic, SET_SCANOUT handler, and response mapping are exercised by the
  focused and full-core runs; the wasm core build and GPU protocol runner remain green.
- **Adversarial matrix — HELD.** `num_scanouts`, `u32::MAX`, unknown resource id, and
  extreme-coordinate rectangle attacks all return errors without mutating scanout state.
- **Evidence integrity — HELD.** Evidence digest
  `8ada9397674e6096165f4377a4f2b46264c53d6476c9d7f15b1cab55251722d9` matches the checked-in
  artifact for implementation commit `c8ea5b0`.

The user explicitly directed this slice to be marked verified. E5-T03b is now the next active
eligible slice.
