---
id: E5-T06b
epic: 5
title: WebGL2 presentation backend
priority: 506.2
status: pending
depends_on: [E5-T06a]
estimate: S
risk: medium
capstone: false
---

## Goal
Implement the WebGL2 `PresentBackend` behind E5-T06a's contract, uploading the core pixel
format without a per-pixel JavaScript swizzle and rendering it through a deterministic textured
quad.

## Boundary
This slice owns only `web/src/sink/webgl.ts`, its shader/texture lifetime, and backend-local
readback tests. It does not benchmark or choose between backends, handle context loss, or wire
the selected sink into the VM.

## Deliverables

- WebGL2 texture allocation, resize, `texSubImage2D` damage upload, and fullscreen-quad draw.
- Correct coordinate orientation, alpha behavior, and BGRA/RGBA channel mapping for the core
  `FrameSink` pixels.
- Readback tests for the same five golden patterns used by E5-T06a, including odd damage rects.

## Acceptance criteria

- [ ] Five golden patterns render pixel-identically to the Canvas2D oracle after readback.
- [ ] A partial rect updates only the rect, including x=1, width=3 on a non-power-of-two canvas.
- [ ] Alpha-zero pixels remain correct and do not expose prior framebuffer contents.
- [ ] Repeated texture resize/delete cycles leave no stale GL object or unbounded staging buffer.

## Verification command

`cd web && node --test tests/e5-t06b-webgl.test.mjs`

## Adversarial verification

Use odd canvas widths, x/y damage at each edge, a rect crossing an upload row, transparent
pixels over a nonzero background, and 1,000 alternating texture sizes. Run with WebGL debug
validation enabled and fail on any GL error or readback mismatch.

## Verification log

(empty)
