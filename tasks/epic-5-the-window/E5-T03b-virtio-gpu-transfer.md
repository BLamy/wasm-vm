---
id: E5-T03b
epic: 5
title: virtio-gpu checked transfer and scatter-gather copy
priority: 503.2
status: in-progress
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

(empty)
