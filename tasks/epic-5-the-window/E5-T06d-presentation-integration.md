---
id: E5-T06d
epic: 5
title: Presentation selection, context-loss fallback, and VM integration
priority: 506.4
status: pending
depends_on: [E5-T06c]
estimate: S
risk: medium
capstone: false
---

## Goal
Wire the measured presentation backend into the browser display path, feature-detect it at
runtime, and fall back from WebGL2 to Canvas2D without wedging the guest or losing more than one
frame on context loss.

## Boundary
This slice owns runtime sink selection, display resize wiring, WebGL context-loss recovery, and
the final browser proof. It does not reimplement either backend or alter the core virtio-gpu
protocol.

## Deliverables

- Runtime feature detection and the documented default/fallback order from E5-T06c.
- Context-loss handling that tears down/recreates the WebGL resources and replays the latest
  frame through Canvas2D when recovery cannot complete immediately.
- End-to-end browser wiring from `FrameSink::flush` to the selected backend, including resize.
- A browser evidence record showing the chosen path, zero console errors, and the one-frame loss
  bound under a simulated `WEBGL_lose_context` event.

## Acceptance criteria

- [ ] The selected default matches the committed E5-T06c decision and falls back when the feature
      is unavailable.
- [ ] Simulated WebGL context loss causes at most one dropped frame and leaves later presents
      pixel-correct through Canvas2D.
- [ ] Full and partial presents reach the visible canvas with no guest queue stall or duplicate
      frame callback.
- [ ] The built demo's browser proof records the backend, final frame, and zero console errors.

## Verification command

`node tools/verify/e5-t06d-present-integration.mjs`

## Adversarial verification

Disable WebGL2, lose the context during a partial update, resize during recovery, and send 1,000
rapid presents. Assert the last frame wins, at most one frame is dropped, no promise/listener
leaks accumulate, and a guest-visible queue remains live.

## Verification log

(empty)
