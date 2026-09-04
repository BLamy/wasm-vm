---
id: E5-T06d
epic: 5
title: Presentation selection, context-loss fallback, and VM integration
priority: 506.4
status: verified
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

- [x] The selected default matches the committed E5-T06c decision and falls back when the feature
      is unavailable.
- [x] Simulated WebGL context loss causes at most one dropped frame and leaves later presents
      pixel-correct through Canvas2D.
- [x] Full and partial presents reach the visible canvas with no guest queue stall or duplicate
      frame callback.
- [x] The built demo's browser proof records the backend, final frame, and zero console errors.

## Verification command

`node tools/verify/e5-t06d-present-integration.mjs`

## Adversarial verification

Disable WebGL2, lose the context during a partial update, resize during recovery, and send 1,000
rapid presents. Assert the last frame wins, at most one frame is dropped, no promise/listener
leaks accumulate, and a guest-visible queue remains live.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- Default/fallback — HELD. The exact-head Chromium capture selected Canvas2D as the E5-T06c
  default and selected Canvas2D after a WebGL2 feature-disable shim, with one recorded fallback.
- Context-loss replay — HELD. `WEBGL_lose_context.loseContext()` during a partial update produced
  one context loss, one full-resource replay, zero dropped frames, and pixel-correct Canvas2D
  readback; the replacement canvas retained two listeners and the old canvas retained none.
- Queue and delivery — HELD. The native Machine test configured a real controlq descriptor chain,
  kicked it through the MMIO notify path, and observed the `GET_DISPLAY_INFO` response and used
  index at the production run boundary. The worker protocol test independently confirmed copied
  FrameSink pixels cross the worker without retaining the source view.
- Adversarial rapid/resize path — HELD. The browser capture resized during the recovered path and
  delivered 1,000 rapid presents with the last frame visible, zero dropped frames, no listener
  growth, and no duplicate callback.
- Coverage — HELD. Runtime Rust paths are exercised by `virtio_gpu_machine`; worker changes by the
  E4-T32 protocol suite; controller behavior by the focused Node tests and real Chromium capture;
  generated `web/dist` modules match their source counterparts byte-for-byte.

Commit: `4d49c888934d0afea8e4f07011e6b65978c312e8`.

Commands: `cargo fmt --check`; `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`;
`cargo clippy -p wasm-vm-core --lib --tests -- -D warnings`; `cargo clippy -p wasm-vm-wasm
--target wasm32-unknown-unknown -- -D warnings`; `cargo test -p wasm-vm-core --lib` (249 passed);
`make verify-E5-T06d` (27 browser/worker tests, 2 machine tests, and the prescribed Chromium
proof).

Evidence: [presentation-integration.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t06d/presentation-integration.json)
(SHA-256 `a19bdb332defde0224bf1a622ef8d4e70a6a0ca4c2940ca929ec7043c6bb17f2`) and
[presentation-integration.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t06d/presentation-integration.png)
(SHA-256 `cc7990bf5c139b148a3b3fac73d61e0fd672af280ae10dd614b272b622b8041f`). The JSON records
Chromium 131, source/dist parity, Canvas2D default, WebGL2-unavailable fallback, the partial-loss
recovery, resize, 1,003 total frames, 0 dropped frames, and empty console/page/request errors.
