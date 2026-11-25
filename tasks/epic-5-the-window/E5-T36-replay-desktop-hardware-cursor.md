---
id: E5-T36
epic: 5
title: Hardware cursor plane on the Replay desktop — pointer drawn by the host, instantly (planning parent)
priority: 0.38765
status: pending
depends_on: [E5-T34g]
estimate: M
risk: medium
capstone: false
---

## Why this exists

On the Replay desktop the guest compositor draws the pointer into the frame, so the pointer
the user steers is a picture that arrives a guest frame late, while the browser's own arrow
sits on top of it. The host already has a verified cursor plane (E5-T15): a guest cursor image
up to 128×128 becomes a CSS cursor, which the browser draws at the real pointer position with
no guest round trip.

Probed live on 2026-11-24 (session restarted inside the running desktop, sway debug log):

- `WLR_NO_HARDWARE_CURSORS=1` in `tools/replay-desktop/rootfs/usr/local/bin/replay-desktop-session`
  forces software cursors. Removing it alone changes nothing: wlroots reports
  `Found 1 DRM planes` and falls back to software, because Linux 6.6 hides the cursor plane of
  paravirtual GPUs from atomic clients that do not declare cursor-hotspot support.
- With `WLR_DRM_NO_ATOMIC=1` (legacy KMS) wlroots reports `Found 2 DRM planes`, the kernel's
  cursor plane goes live (`plane-1 crtc=crtc-0 … 64x64`) and the page's canvas gets
  `cursor: url("data:image/png…")` from the guest's image. The cursor controller counted one
  update per pointer move.
- Two things remain. (1) Legacy `drmModeSetCursor` carries no hotspot: the device reports
  `hot_x = hot_y = 0` and the guest instead places the plane at pointer minus hotspot, so the
  host would draw the image offset by the hotspot (a few pixels for the arrow, about half the
  image for a text caret). The host can recover it: it knows the guest-space positions it
  sent, and each `MOVE_CURSOR` is one of them minus the hotspot; intersecting the candidate
  offsets over a few moves leaves one. (2) Every pointer move still produced one framebuffer
  flush to the page; whether that is a real page flip or an empty commit, and whether the
  page can skip it, is not yet known.

## Progress on the scratch branch (2026-11-24/25, not merged)

- Slice 1 is written and unit-tested: `web/src/sink/cursor-hotspot.js`
  (`CursorHotspotEstimator`: candidate hotspots per reported plane position, intersected over
  moves to different places; tolerant of a lagging guest, coalesced moves, one pixel of
  rounding and wrapped u32 positions; never guesses from a straight evenly spaced sweep) and
  its use in `CursorController` for a CSS cursor whose device hotspot is (0,0) — one style
  write per cursor image, the device's own report untouched, overlay cursors unaffected.
  `web/tests/e5-t36-cursor-hotspot.test.mjs`: 9 tests.
- Live probe with the session restarted on legacy KMS inside the running desktop: the page's
  canvas cursor became the guest's image with inferred hotspots — arrow (1,1), hand over the
  button (9,4), text caret in foot (4,8) — and the guest frame no longer contains a painted
  pointer.
- Slice 2 is blocked: the image is assembled in a Docker container, and the colima VM
  `replay-chromium` has had a read-only data disk and a failing root disk since the host disk
  filled on 2026-11-24 (`docker build` fails with `meta.db: input/output error`). The VM also
  runs other projects' containers, so restarting it is the owner's decision.

## Slices (split before starting)

1. Host: infer the hotspot of a cursor image from sent pointer positions and `MOVE_CURSOR`
   positions; unit tests with lagging and dropped moves; no behaviour change while the device
   reports a non-zero hotspot.
2. Guest image: legacy KMS and hardware cursors in the session script; stop the monitor loop's
   polling after `REPLAY_DESKTOP_READY`; rebuild the image, chunk manifest, whole-image
   artifact and warm snapshot; privacy guard on each.
3. Browser proof on the built page: one cursor (the guest's image as a CSS cursor), its tip on
   the pixel the guest reports under the pointer for arrow, hand and text shapes; pointer moves
   without guest recomposition; the E5-T34c/E5-T34e proofs still pass.

## Verification log
