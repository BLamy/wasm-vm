# E5-T36b round 2 — verifier predictions

Written 2026-11-26 before any run of mine. HEAD `e57b40bc0` (code `7c5191e91`). Image under test
`target/e5-t36b/image/replay-desktop.ext4` (round 1's, sha256 8a5c6c1e34b7…); control
`target/e5-t34b/image/replay-desktop.ext4` (gen 1, 2af6100e9b37…). CLI `target/release/wasm-vm`
sha256 62fde0c35fc8…. Carried forward from round 1 as HELD (session script, image and CLI
unchanged): P2, P3, P5, P6, P7, P8, P9, P11, P12.

Already seen before writing this (so not a prediction): the worker's `native/result.json`
(corner move parsed as 64x64 at -1,-1) and its `startedAt` 20:17:57Z, which is ~2 min BEFORE
commit `7c5191e91` (20:19:44Z) — my own rerun at HEAD has to stand in for it.

## Acceptance and the parser (changed lines)

- R1. `node tools/verify/e5-t36b-hardware-cursor.mjs --image <new> --out verifier-r2/native` at
  HEAD exits 0; `swayEnv` = [WLR_DRM_NO_ATOMIC=1, WLR_RENDERER=pixman]; five moves, each a 64x64
  plane on crtc-0 with fb>0; the (0,0) move parses to x=-1, y=-1 (both axes negative), hotspot
  (1,1); the other four hotspots match round 1 (1,1)(1,1)(9,5)(5,9).
- R2. Control `--expect software` on gen 1 exits 0 with `cursor:null` at all five moves (the
  corner move added nothing that breaks the control).
- R3. The new regex parses `64x64-1-1`→(-1,-1), `64x64+1278-1`→(1278,-1), `64x64-1+797`→(-1,797),
  `64x64+0+0`→(0,0), `1280x800+0+0`; rejects `64x64+-1+-1`-style junk is irrelevant (kernel uses %+d).
- R4. Sabotage: the same acceptance with the round-1 regex restored (scratch copy, not the repo
  file) FAILS at the corner move (w/x null → the hotspot assertion fails), so the fifth position
  is what exercises the fix.

## The revised attack item (reachability of a >64x64 cursor as shipped)

- R5. Inventory of the booted new image: no `cursors` directory with Xcursor files anywhere on the
  root filesystem (no theme for XCURSOR_PATH/~/.icons/ /usr/share/icons to find); no XCURSOR_*
  in sway's, Chrome's or foot's environment; sway's output scale is 1.0 (EDID is a fixed 96 DPI
  panel, so sway never auto-scales). Chrome therefore runs at device scale factor 1.
- R6. In the guest's Chrome at DSF 1, a page with a 128x128 **PNG** cursor, a 128x128 SVG cursor
  declared through `image-set(... 1x)`, and a 256x256 PNG at `image-set(... 2x)` → each keeps a
  64x64 plane on the CRTC (Chrome caps the bitmap to the display's maximum cursor size).
- R7. Chrome's own cursors at DSF 1 (I-beam over text input, hand over a link, default arrow over
  the tab strip) → plane on the CRTC with a hotspot inside 64x64.
- R8 (informational; needs a Chrome flag a user must type, so it cannot refute the "as shipped"
  claim, but it scopes E5-T36d): Chrome launched with `--force-device-scale-factor=2` and the
  128x128 CSS cursor → I predict a 64x64 plane still (cap in physical pixels). Low confidence.
- R9 (informational, same class as R8): `swaymsg output Virtual-1 scale 2` with wlroots' built-in
  cursor → plane stays on (built-in image is small).

## Novel attack

- R10. sway's own cursor over the tiling seam between Chrome and foot and over the corner of a
  title bar (where sway may ask for resize cursor names the built-in theme may not have): a
  pointer is drawn (plane on, or painted). Prediction: plane on the CRTC at every spot.

## Mock hunt

- R11. The corner move asserts against the kernel's DRM state, not against anything the script
  computes itself; nothing in the diff special-cases (0,0).

## Addendum (written after attacks-new.log, before attacks-new-b)

attacks-new.log showed Chrome 108 ignores unprefixed `image-set()` in `cursor` (both image-set
bands show the default arrow, hotspot 1,1, not the declared 40,40 → 20,20), and `pgrep` is
absent so the XCURSOR env check printed nothing. New predictions for attacks-r2b.mjs:

- R6b. `-webkit-image-set(url(256x256 PNG) 2x)` (hotspot 40 40) and
  `-webkit-image-set(url(128 SVG) 1x)` at DSF 1 → 64x64 plane, hotspot not (1,1).
- R5b. No XCURSOR_* in sway's, foot's or Chrome's browser-process environment.
- R7b. Every CSS cursor keyword in the shipped Chrome (DSF 1) → plane on the CRTC (or painted),
  64x64 — Chrome's fallback bitmaps at 100% are ≤32 px. (`none` → plane off, nothing painted:
  that is the page hiding it, not a failure.)
- R8b (informational, needs a flag): at forced DSF 3, Chrome's own bitmap cursors (zoom-in, grab,
  copy, alias, not-allowed, cell, context-menu) — I expect at least one to exceed 64 px and draw
  no pointer (75 px from the 200% bitmaps ×1.5). Does not refute "as shipped".
