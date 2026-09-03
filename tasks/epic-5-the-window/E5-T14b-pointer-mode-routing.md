---
id: E5-T14b
epic: 5
title: pointer mode state machine and coordinate/button routing
priority: 514.2
status: pending
depends_on: [E5-T14a]
estimate: S
risk: medium
capstone: false
---

## Goal

Route browser pointer events to the T14a devices with an explicit absolute-tablet versus
relative-mouse mode state machine. Absolute mode must remain pixel-exact under CSS scaling and
device-pixel-ratio changes; relative mode must enter and leave Pointer Lock without an absolute
jump.

## Deliverables

- `web/src/input/pointer.ts` and its byte-identical browser projection with absolute/relative mode,
  coordinate scaling, Pointer Lock request/error/exit handling, and mode diagnostics.
- Button mapping for primary, secondary, auxiliary, back, and forward buttons, with captured
  context-menu suppression and a clear mode-toggle API for the T08 chrome.
- Deterministic unit fixtures for mode transitions, rect/DPR scaling, button mapping, and pointer
  lock denial/loss.

## Acceptance criteria

- [ ] Absolute pointer moves emit tablet coordinates from the current canvas CSS rect, clamped to
      `0..32767`, with no dependence on the canvas backing-pixel size.
- [ ] Relative mode emits only `movementX`/`movementY` mouse deltas, requests Pointer Lock, and
      returns to absolute mode when lock is denied, lost, or cancelled.
- [ ] Button down/up pairs remain balanced through mode changes and map aux/back/forward to the
      documented evdev codes; captured right-click never opens the browser context menu.

## Adversarial verification

Use DPR 1/1.5/2 and CSS zoom 80%/125% at all four corners and the exact center. Deny Pointer Lock,
press Escape during a held button, and alt-tab during lock; every path must leave the selected mode
consistent with `document.pointerLockElement` and no button held.

## Verification log

(empty)
