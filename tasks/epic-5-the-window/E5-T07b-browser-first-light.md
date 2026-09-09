---
id: E5-T07b
epic: 5
title: Browser fbcon first-light boot on the display canvas
priority: 507.2
status: verified
depends_on: [E5-T07a]
estimate: S
risk: high
capstone: false
---

## Goal

Wire the proven guest probe into a focused browser boot path and show Linux fbcon text as the first
real user-visible frame on the display canvas.

## Boundary

This slice owns the browser first-light route, cold-boot frame capture, and visible canvas proof. It
does not own tty0 input/damage stress or the later desktop/display-server work.

## Deliverables

- A `web/first-light.html` route or an explicit main-page flag that boots the T05 kernel with the
  production display sink and keeps the serial console available for diagnostics.
- A Chromium verifier that records backend selection, boot markers, final canvas pixels, and browser
  console/page/request errors.
- A screenshot/evidence record tied to the exact kernel and web bundle head.

## Acceptance criteria

- A cold Chromium boot renders legible fbcon text on the canvas within the E4 boot-time budget plus
  20%, with the expected color channel order and no blank or stale surface.
- The serial log contains the virtio-gpu, DRM/fbdev, and `fb0: virtio_gpudrmfb` markers from the
  same boot that produced the screenshot.
- The built demo proof reports the selected backend and zero console/page/request errors.

## Verification command

`node tools/verify/e5-t07b-first-light.mjs`

## Adversarial verification

Run once with WebGL2 disabled and once with the normal Canvas2D default; the guest must keep
retiring instructions and the canvas must remain live. Reload during the boot transfer and confirm
the replacement run re-probes without reusing a stale frame or listener.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- Cold Canvas2D first light — HELD. Exact-head Chromium boot selected the measured Canvas2D default,
  received five full-resource FrameSink presents, and read back 1,024,000 non-black pixels from the
  1280×800 canvas. The serial stream from that same boot contains the virtio-gpu, DRM, and
  `fb0: virtio_gpudrmfb` markers.
- Pixel format and channel order — HELD. The guest frame carries
  `B8G8R8X8_UNORM` (format 2); the first visible sample `0x00aaaaaa` was normalized to the expected
  opaque RGBA `[170, 170, 170, 255]` and the browser readback matched exactly. The deterministic
  presentation test also covers the non-gray `0x00112233 → 0xff112233` XRGB conversion.
- Browser health and progress — HELD. The normal run retired 305,489,125 guest instructions in
  18,480 ms, stayed within the 450,464 ms E4 budget, delivered zero dropped frames, retained two
  listeners, and reported empty console/page/request error lists.
- Adversarial fallback — HELD. A WebGL2-disabled Chromium run reselected Canvas2D with exactly one
  fallback, the same live canvas/readback invariants, and no browser errors.
- Adversarial reload — HELD. Reload during the initial boot transfer produced a fresh probe and
  replacement first-light proof with five presents, zero drops, two listeners, and no stale frame
  or browser errors.
- Coverage — HELD. The changed Rust FrameSink boundary is exercised by the core library and machine
  tests; the wasm target is rebuilt; the XRGB normalization is asserted by the focused presentation
  test; all browser route, fallback, reload, serial-marker, readback, and source/dist parity paths
  are exercised by the recorded Chromium verifier. Independent-machine, WebKit, and host-layer rr
  runs are outside this task's accepted proof scope.

Commit: `d4f352938bc12c8b02d791672a723b678eddc097`.

Commands: `cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm`; `cargo clippy -p wasm-vm-core --lib
--tests -- -D warnings`; `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D
warnings`; `cargo test -p wasm-vm-core --lib` (249 passed); `cargo test -p wasm-vm-core --test
virtio_gpu_machine` (2 passed); `node --test web/tests/e5-t06d-presentation.test.mjs` (4 passed);
`make web-build`; `node tools/verify/e5-t07b-first-light.mjs --output
evidence/e5-t07b/first-light.json`.

Evidence: [first-light.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t07b/first-light.json)
(SHA-256 `67b5dd3019b741da654c2b86643dcc57c4086cd5ed88e5ceeee60349413ee80a`),
[first-light.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t07b/first-light.png)
(SHA-256 `4ba1f7c903fb5ae0e8e674aa3574ed56c36d9de0ab02c9feb40af72e2744ff35`),
[first-light-webgl2-disabled.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t07b/first-light-webgl2-disabled.png)
(SHA-256 `53382d7234551c9360d42c666f68c1de5f932522e2f350aec4cf78a37e083d36`), and
[first-light-reload.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t07b/first-light-reload.png)
(SHA-256 `40081702f6692673b8bc4904076969bfa53cc51364b617fb09a2cfc85a19c64f`). The JSON records
Chromium 131, the exact kernel/initramfs hashes, web-bundle identity, all three proofs, and empty
browser error arrays.
