---
id: E5-T36a
epic: 5
title: Infer the hotspot of a guest cursor image the device did not describe
priority: 0.387651
status: in-progress
depends_on: [E5-T37b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Host only: `web/src/sink/cursor-hotspot.{js,ts}` (new), `web/src/sink/cursor-controller.{js,ts}`,
and the pointer bridge's frame hook in `web/main.js`. No guest image change: with today's
image the guest paints its own pointer and reports no cursor plane, so nothing visible changes
until E5-T36b turns the hardware cursor on.

Why: on legacy KMS (the only way wlroots 0.17 gets a cursor plane from virtio-gpu on Linux 6.6)
`drmModeSetCursor` carries no hotspot. The device reports `hot_x = hot_y = 0` and the guest
places the plane at pointer minus hotspot instead. The host draws the guest's cursor image as a
CSS cursor at the real pointer, so without the hotspot the image sits offset by it: a pixel
for the arrow, (9,4) for the hand, (4,8) for the text caret.

What changes: the page knows the guest-space positions it sent; each `MOVE_CURSOR` the device
reports is one of them minus the hotspot. `CursorHotspotEstimator` keeps, per cursor image, the
candidate hotspots consistent with every reported plane position seen so far (against the
recently sent positions, one pixel of rounding tolerated, u32-wrapped negatives handled) and
answers once exactly one candidate is left after moves to different places. It never answers
from a straight evenly spaced sweep, where a lag of whole steps is indistinguishable from a
hotspot. `CursorController` uses the answer for a CSS cursor whose device hotspot is (0,0):
one style write per cursor image. A device that reports a non-zero hotspot, and overlay
cursors, are untouched.

## Deterministic acceptance

`cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/cursor*.test.mjs` passes: the
estimator converges on the right hotspot with a lagging guest, coalesced and dropped moves,
rounding and wrapped positions; stays silent on a collinear sweep and on contradictory input;
remembers per image; the controller writes the style once per image and leaves reported
hotspots alone. The web unit suite fails no test that passed before. Demo page: zero console
errors, suite at its full count.

## Adversarial verification

Medium risk. Attack list: two images with different hotspots alternating; a hotspot larger
than the image; positions near the output edges (clamped plane positions); a guest that lags
by a varying number of moves; the same image re-installed after a different one; an estimator
fed positions from a different output size (resize); memory growth over a long session. One
bounded novel attack of the verifier's choice.

## Verification log
