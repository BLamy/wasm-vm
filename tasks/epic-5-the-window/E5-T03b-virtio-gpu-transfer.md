---
id: E5-T03b
epic: 5
title: virtio-gpu checked transfer and scatter-gather copy
priority: 503.2
status: verified
depends_on: [E5-T03a]
estimate: S
risk: high
capstone: false
---

## Goal

Implement `TRANSFER_TO_HOST_2D` as a read-only, checked copy from a resource's guest backing
sglist into its host shadow buffer. Treat the entries as one linear byte stream and make the
walk efficient across arbitrary entry boundaries.

## Deliverables

- Typed little-endian transfer support and control-queue dispatch with checked rectangle,
  offset, stride, span, and resource arithmetic.
- A scatter-gather cursor that handles rows crossing entry boundaries, including one-byte
  entries, without looking up an sg entry once per pixel.
- Errors for detached backing, unknown resources, out-of-bounds rectangles, and
  `offset + span` overflow; rejected transfers must leave the shadow unchanged.
- Instrumented/native tests that prove the path only reads guest memory and never writes to it.

## Acceptance criteria

- Full-frame and partial-rectangle transfers match a naive reference copy for multi-entry
  backing, including an odd-x rectangle whose width is not aligned to an sg-entry boundary.
- A 64x64 transfer backed by one-byte entries succeeds with the same result as the reference;
  an offset of `backing_len - 1` with a two-byte span returns `ERR_INVALID_PARAMETER`.
- An over-bound rectangle, arithmetic overflow, or detached backing returns the specified
  error and leaves the shadow CRC unchanged without reading guest memory.
- The focused transfer tests pass under native `cargo test` and the core wasm32 build.

## Adversarial verification

Run 10,000 independently seeded `(rect, offset)` cases against the naive nested-loop oracle,
including zero-sized and edge-touching rectangles. Time a native 1280x800 full-frame transfer;
the implementation must stay within the task's 5 ms budget and must not regress into a
per-pixel sg lookup. Add a bus read/write counter and fail if any transfer performs a guest
write.

## Verification log

### 2026-09-03 — worker — implemented

- **Transfer path — HELD.** The control queue decodes a fixed little-endian
  `TRANSFER_TO_HOST_2D` request and copies each validated row from the resource's guest
  scatter-gather backing into its host shadow using a linear cursor with explicit row-gap skips.
- **Arithmetic and failure atomicity — HELD.** Widened rectangle, stride, offset, span, backing,
  and guest-RAM checks reject detached backing, out-of-bounds rectangles, overflow, and truncated
  source ranges before the first shadow write.
- **Adversarial/performance coverage — HELD.** Native tests cover odd-x SG crossings, one-byte
  entries, source immutability, three-seed 30,000-case model comparison, and the release
  1280x800 budget at 418.584 microseconds.

Implementation commit: `d4f1326`.

Evidence: `evidence/e5-t03b/transfer-2026-09-03.json` (SHA-256
`20a68a67dec0b9f4781c29bb3530d41bceba646c757a17d504d55891970ff1e7`).

Commands: `cargo fmt --all -- --check`; `git diff --check`; `cargo test -p wasm-vm-core --lib
gpu_transfer` (7 passed); `cargo test -p wasm-vm-core --lib` (212 passed); `cargo clippy
-p wasm-vm-core --lib -- -D warnings`; `cargo build -p wasm-vm-core --no-default-features
--target wasm32-unknown-unknown`; `cargo clippy -p wasm-vm-core --target
wasm32-unknown-unknown --no-default-features --lib -- -D warnings`; `cargo test -p wasm-vm-core
--test virtio_mmio_slots --test virtio_blk --test virtio_net_critic` (22 passed);
`wasm-pack test --node crates/wasm --test gpu_protocol` (2 passed); and `cargo test
-p wasm-vm-core --release --lib gpu_transfer_full_frame_native_budget -- --nocapture`
(418.584 microseconds, under 5 ms). Independent-machine, WebKit, and host-layer rr runs were
excluded per the user's direction and current repository evidence policy.

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The focused recording proves full and partial rectangle copies against
  a reference, odd-x and one-byte SG boundary handling, bounded invalid transfers with unchanged
  shadow state, detached-backing refusal, and fenced control-queue progress.
- **Coverage — HELD.** The changed transfer protocol type, error mapping, control-queue arm,
  SG reader, row-gap handling, guest-range validation, and host-pixel writes are exercised by
  the focused suite and the 212-test core regression.
- **Adversarial/performance — HELD.** Three independent deterministic seeds cover 30,000
  model-oracle cases, and the release benchmark records 418.584 microseconds for 1280x800,
  below the 5 ms budget.
- **Evidence integrity — HELD.** Evidence digest
  `20a68a67dec0b9f4781c29bb3530d41bceba646c757a17d504d55891970ff1e7` matches the checked-in
  artifact for implementation commit `d4f1326`.

The user explicitly directed this slice to be marked verified. E5-T03c is now the next active
eligible slice.
