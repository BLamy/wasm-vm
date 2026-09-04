---
id: E5-T06a
epic: 5
title: Canvas2D presentation backend and present contract
priority: 506.1
status: in-progress
depends_on: [E5-T03c]
estimate: S
risk: medium
capstone: false
---

## Goal
Define the browser-side presentation contract and implement the Canvas2D backend that consumes
T03 `FrameSink` pixels with bounded staging, correct channel order, resize handling, and partial
damage updates.

## Boundary
This slice owns only the shared `PresentBackend` interface and `web/src/sink/canvas2d.ts`.
It does not select a default, implement WebGL, measure browser performance, or wire context-loss
fallback into the runtime; those belong to E5-T06b/c/d.

## Deliverables

- A small `PresentBackend` interface with `present(rect, pixels)` and `resize(width, height)`.
- Canvas2D implementation using a non-shared staging buffer where the browser requires one,
  converting the core's BGRA words to the exact RGBA bytes expected by `ImageData`.
- Five deterministic full-frame and partial-rect golden-pattern readback tests, including alpha
  zero, odd-width damage, and a resize.

## Acceptance criteria

- [ ] Five golden patterns read back pixel-identically through the Canvas2D backend.
- [ ] A partial rect changes only its target pixels; an x=1, width=3 rect is not sheared.
- [ ] Alpha bytes of `0x00` remain transparent in the readback rather than being dropped or
      replaced by a stale staging value.
- [ ] Repeated resize/present calls keep staging allocation bounded by the current canvas size.

## Verification command

`cd web && node --test tests/e5-t06a-canvas2d.test.mjs`

## Adversarial verification

Present a 1x1 and a maximum supported canvas, use a damage rect crossing every row boundary,
alternate opaque and alpha-zero pixels, and reuse the same backend for 1,000 resizes. Assert
readback outside the rect and staging capacity never exceed the documented bound.

## Verification log

(empty)
