---
id: E5-T07b
epic: 5
title: Browser fbcon first-light boot on the display canvas
priority: 507.2
status: pending
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

(empty)
