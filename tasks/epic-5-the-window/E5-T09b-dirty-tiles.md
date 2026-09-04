---
id: E5-T09b
epic: 5
title: Virtio-gpu dirty-tile upload planner
priority: 509.2
status: in-progress
depends_on: [E5-T09a]
estimate: S
risk: high
capstone: false
---

## Goal

Track which 64x64 tiles became dirty through TRANSFER_TO_HOST_2D and intersect them with the
coalesced flush plan so a cursor blink or one-cell update uploads only the necessary bytes.

## Boundary

This slice owns the core dirty bitmap, transfer marking, flush intersection, tile clipping, and
upload-byte accounting. It does not own rAF/timer scheduling or browser DOM wiring.

## Deliverables

- A 64x64 tile-grid planner sized from the current resource dimensions.
- TRANSFER marking and flush intersection that clips partial edge tiles and clears only consumed
  dirty state.
- Deterministic counters for selected tiles, uploaded bytes, and full-frame comparison mode.

## Acceptance criteria

- A full-screen flush after one 1x1 transfer selects only the intersecting 64x64 tile, while a
  full-screen transfer selects every required tile and reports exact byte counts.
- Boundary rectangles crossing `x=63,w=2`, the right/bottom edge, and a mid-frame resize select
  the same tiles as an independent cell-mask reference and never select outside the resource.
- Repeated transfer/flush cycles do not retain stale dirty bits; disabled-tiling mode produces the
  same final shadow bytes and exposes a comparable full-frame counter.

## Verification command

`make verify-E5-T09b`

## Adversarial verification

Run 10,000 seeded transfer/flush sequences with random resource sizes and compare selected upload
regions and final shadow bytes against a reference planner; fail on any stale tile or byte-count
drift.

## Verification log

(empty)
