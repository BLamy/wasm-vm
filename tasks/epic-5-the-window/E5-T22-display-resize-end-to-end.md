---
id: E5-T22
epic: 5
title: Display resize end-to-end — canvas size to guest mode change and back
priority: 522
status: pending
depends_on: [E5-T04, E5-T18]
estimate: M
capstone: false
---

## Goal
Resizing the browser window resizes the guest desktop: canvas-size changes flow through
T04's display-info/EDID hotplug event, the guest compositor picks up the new mode,
reallocates its framebuffer, and the new-size scanout lands back on a correctly-sized
canvas — with the whole loop debounced and storm-proof.

## Context
The chain: `ResizeObserver` on the canvas container → debounce 250 ms (trailing) →
`VirtioGpu::set_display(w, h)` (T04: pmode update + EDID regen + EVENT_DISPLAY + config
IRQ) → guest driver re-queries and fires a DRM hotplug uevent → compositor handles it
(wlroots reacts natively; on X11 it needs RandR — per the T16 choice) → guest sends
RESOURCE_CREATE_2D at the new size, SET_SCANOUT, and full-frame TRANSFER+FLUSH → sink
resizes the canvas backing store (`canvas.width/height` = CSS size × DPR) and presents.
Subtleties: transfers from the *old* resource may still be in flight when the host size
changes — validation is against the resource's own dims (T03 already does this), and
the sink must letterbox/clamp a stale-size scanout rather than stretch it; DPR changes
(browser zoom, monitor move) are a resize with equal CSS size — observe
`devicePixelRatio` too; odd widths must not shear (T06 row-stride handling); fbcon
(pre-desktop) ignores hotplug — the serial console must note "resize takes effect at
next mode set" rather than pretending.

## Deliverables
- Host side: ResizeObserver + DPR watcher + debouncer → set_display; letterbox
  presentation for size mismatch intervals (black bars, no stretch).
- Verified guest side: compositor mode-change confirmed (wlr-randr / xrandr output
  logged before/after), old resources UNREF'd (resource-count assertion via GPU stats).
- A resize-torture test page/harness: scripted sequences of window sizes with
  screenshots + GPU stats after each.
- `docs/display.md`: the resize pipeline diagram and the stale-frame policy.

## Acceptance criteria
- [ ] Dragging the browser window to any size between 640x480 and 2560x1600 yields,
      within 2 s of release, a guest desktop at exactly the canvas pixel size
      (wlr-randr reports w×h == canvas.width×height; screenshot has no letterbox at
      steady state, no blur from CSS scaling).
- [ ] Foot/terminal running `yes` during resize: no guest crash, no host panic, text
      reflows; total resource count returns to pre-resize baseline (no leaked
      old framebuffers) after 10 resizes.
- [ ] DPR change (browser zoom 100%→150%→100%) triggers mode changes and text stays
      sharp (no fractional-scale blur — compare glyph edges in screenshots).
- [ ] Resize storm: 50 programmatic size changes in 5 s → at most a handful of guest
      mode changes (debounce measured), final state correct, zero errors in dmesg or
      compositor log.
- [ ] Minimum-size clamp documented and enforced (e.g. < 320px requests clamp, guest
      never asked for absurd modes).

## Adversarial verification
Race it: script a resize *during* the guest's reaction to the previous one (fire at
100 ms intervals, under 4x CPU throttle) 200 times — any stuck letterbox, torn frame
(screenshot shear detector: row-wise autocorrelation), guest OOM from leaked
framebuffers, or dmesg WARN refutes. Attack the in-flight window: hold the debounce at
0 ms (test hook) and force host-size change between a guest TRANSFER and its FLUSH —
prove no OOB write into the resized canvas staging buffer (ASAN natively; bounds
asserts in wasm). Shrink to 640x480 with 10 windows open, then grow — windows must be
reachable (compositor's problem, but a hang is ours to detect). Verify EDID actually
updated: `edid-decode` in-guest after resize shows the new preferred mode. Reload the
tab mid-resize: boot must come up at the *current* canvas size, not the pre-resize one.

## Verification log
(empty)
