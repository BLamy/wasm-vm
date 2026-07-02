---
id: E5-T09
epic: 5
title: Damage-rect coalescing, dirty tiling, and rAF-paced presentation
priority: 509
status: pending
depends_on: [E5-T06, E5-T07]
estimate: L
capstone: false
---

## Goal
The present pipeline stops being "one JS call per guest flush": damage rects from
RESOURCE_FLUSH are coalesced per frame, uploads are restricted to dirty tiles, and
presentation is paced by `requestAnimationFrame` with at most one upload+draw per
display refresh — cutting bytes-per-frame and decoupling guest flush rate from vsync.

## Context
fbcon already flushes small rects, but a compositor (T16+) will flush large ones at
uncapped rates; without pacing, a 60 Hz guest repaint on a busy interpreter turns into
main-thread jank. Design: the GPU device accumulates a damage list per scanout
(coalesce policy: union up to N=16 rects, else collapse to bounding box — measure both);
the sink drains it in a rAF callback; guest-side FLUSH completions are acked immediately
(virtio-gpu 2D flush is not a fence to vblank, QEMU acks the same way). Dirty tiling:
64x64 tile grid over the shadow buffer, tiles marked by TRANSFER rects, so a full-screen
FLUSH after a 1-tile TRANSFER uploads 1 tile (fbcon cursor blink does exactly this).
Add counters: frames presented, flushes coalesced, bytes uploaded, rAF overruns.

## Deliverables
- Damage accumulator in the GPU device (core crate, unit-tested rect union/coalesce).
- Tile-dirty bitmap keyed off TRANSFER_TO_HOST_2D rects; upload path iterates dirty
  tiles ∩ flush damage.
- rAF scheduler in the sink: one present per frame, frame-skip (latest-wins) when the
  VM produces faster than display refresh; `document.hidden` fallback to a 250 ms timer
  so the guest never stalls waiting on a hidden tab.
- Metrics surface (`vm.stats.gpu`) exposed to the page and to the T25 harness.
- Bench comparison in `docs/perf/present-paths.md` appendix: bytes/frame and ms/frame
  before vs after, on fbcon-scroll and cursor-blink workloads.

## Acceptance criteria
- [ ] Cursor-blink workload uploads < 1% of full-frame bytes per blink (counter-based).
- [ ] Full-screen scroll remains pixel-correct: end-state screenshot CRC equals a run
      with tiling/coalescing disabled (correctness A/B switch kept for verification).
- [ ] With a synthetic guest flushing 240 rects/s, present count ≤ display refresh rate
      +1 and the main thread stays responsive (long-task observer: no task > 50 ms).
- [ ] Hidden-tab boot completes (timer fallback verified with `document.hidden` forced).
- [ ] Rect coalescer unit tests cover overlapping, adjacent, contained, and 17+ rect
      spill-to-bbox cases.

## Adversarial verification
Refute correctness first: run the fuzz workload (random TRANSFER+FLUSH sequences, 10k
iterations, seeded) and CRC-compare final shadows/screens against the A/B disabled path
— any pixel diff refutes. Then starve it: point a 4x-CPU-throttled Chrome at a
full-screen `glxgears`-style fbdev animation and prove latest-wins skipping (no
ever-growing damage queue; heap flat over 5 min). Attack the tile math with rects that
touch tile boundaries exactly (x=63,w=2) and rects clipped by a mid-frame resize.
Backgrounded-tab audio/serial must keep flowing while presents are timer-paced. A
stuck cursor blink (damage marked but never presented after rAF resume) refutes.

## Verification log
(empty)
