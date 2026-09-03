---
id: E5-T14c
epic: 5
title: pointer wheel capture and browser proof
priority: 514.3
status: pending
depends_on: [E5-T14b, E5-T13c]
estimate: S
risk: medium
capstone: false
---

## Goal

Finish the pointer surface with deterministic wheel normalization, drag-outside pointer capture,
documentation, guest evtest fixtures, and one browser proof that exercises the complete host-to-
guest path.

## Deliverables

- Per-axis PIXEL/LINE/PAGE wheel accumulators with the documented evdev sign and detent policy.
- Pointer-capture drag handling that continues outside the canvas until button-up, plus the mode
  toggle/debug UI and pointer focus-loss release integration.
- Guest-side evtest transcript/fixtures and a single local Chromium harness covering coordinates,
  drag, wheel, relative mode, lock loss, and zero browser errors.
- `docs/input.md` pointer-mode, wheel, and browser limitation policy.

## Acceptance criteria

- [ ] One PIXEL and one LINE wheel detent each emit exactly one signed `REL_WHEEL` event; 1000
      small deltas accumulate deterministically without sign flips or unbounded state.
- [ ] A drag leaving the canvas still delivers movement and its button-up; a relative-mode exit
      leaves both pointer devices neutral and the next absolute move has no jump.
- [ ] The exact-head browser proof records the guest evtest stream, mode transitions, UI state, and
      zero unexpected console/page/request errors.

## Adversarial verification

Send 1000 `+3px` wheel events and compare the total to the accumulator contract. Combine a held
button with Pointer Lock denial, Escape, blur, view toggles, and pointer capture outside the canvas;
then type/inspect a guest event stream and require no stuck button or modifier. Re-run the corner,
center, DPR, and CSS-zoom matrix through the built page.

## Verification log

(empty)
