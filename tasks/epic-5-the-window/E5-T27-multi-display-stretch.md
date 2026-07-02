---
id: E5-T27
epic: 5
title: Multi-display support (config-gated stretch) — second scanout, second canvas
priority: 527
status: pending
depends_on: [E5-T22]
estimate: M
capstone: false
---

## Goal
Behind a config flag, the machine grows a second display: `num_scanouts = 2`, a second
canvas element, per-scanout damage/present pipelines, and a guest desktop extended
across both — proving the T01–T09 pipeline was genuinely scanout-indexed and not
secretly single-display, while changing nothing for default users.

## Context
Deliberately a stretch: high demo value, low criticality, and an honest audit of every
place we wrote `scanout 0`. With `displays: 2` in VM config: config space
`num_scanouts = 2`, GET_DISPLAY_INFO enables pmode[1] with its own rect (positioned to
the right: x-offset = display0 width — virtio-gpu pmode rects encode layout),
per-scanout EDID (T04 is already scanout-indexed), SET_SCANOUT with scanout_id 1
binds a second resource, and the sink fans flushes out by scanout to per-canvas
present pipelines (T09 damage/tiling state must be per-scanout, not global —
this is where hidden globals will surface). Input: T14's absolute tablet maps one
canvas each — simplest correct model is one tablet per display... but virtio-input has
no display binding; instead keep ONE tablet whose coordinate space spans the union
bounding box, with each canvas mapping its region (matching how the compositor lays
out outputs — offsets must agree or clicks land on the wrong monitor; document the
contract). Guest side: wlroots handles multi-output natively; verify with `wlr-randr`
and per-output wallpaper. T22 resize must work per-display; T26 snapshots must
capture both.

## Deliverables
- `displays: N` (1..=2 for now) VM config; all scanout-indexed paths audited and
  parameterized (grep-audit checklist committed with the PR).
- Second canvas in the page layout (side-by-side, independent CSS size) with its own
  PresentBackend instance; per-scanout stats.
- Tablet coordinate-union mapping + the documented layout contract host⇄guest.
- Tests: dual-display fbcon (kernel picks scanout 0; scanout 1 blank — expected and
  asserted), dual-display desktop screenshot fixture, per-display resize test.
- Flag off (default): byte-identical config space to pre-task fixtures; zero behavior
  change (regression suite green).

## Acceptance criteria
- [ ] Flag on: guest `wlr-randr` lists two outputs at the configured sizes/offsets;
      a window dragged from display 0 to display 1 renders across the seam
      (screenshot pair stitched and checked).
- [ ] Clicks land correctly on BOTH canvases at DPR 1 and 2 (corner-accuracy test from
      T14 repeated per canvas — the union-mapping math is the likely bug site).
- [ ] Resizing canvas 1 only changes output 1's mode (wlr-randr confirms; output 0
      untouched); per-scanout damage counters move independently.
- [ ] Flag off: GET_DISPLAY_INFO response and all E5 regression tests byte-identical
      to pre-T27 fixtures.
- [ ] T26 snapshot with two displays restores both (CRC each canvas).

## Adversarial verification
Refute the isolation claim first: with flag off, diff the full GPU trace of a T18
desktop boot against the pre-T27 fixture — ANY byte difference refutes "zero behavior
change". Flag on, attack the seams: cursor moved along the boundary between displays
must not teleport or duplicate (hotspot + union-mapping interaction); a window
half-on-each-display during a drag must damage-track both scanouts (bytes-uploaded
counters both nonzero, neither full-frame). Kill display 1 mid-session (set
`displays: 1` on a 2-display snapshot restore) — must degrade per a documented policy,
not crash. Attack per-scanout state: run the T09 fuzz workload simultaneously on both
scanouts with different seeds — CRC each against single-display oracle runs; any
cross-contamination refutes the parameterization audit.

## Verification log
(empty)
