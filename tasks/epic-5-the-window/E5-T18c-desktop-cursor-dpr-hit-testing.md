---
id: E5-T18c
epic: 5
title: Prove desktop cursor alignment and DPR hit-testing
priority: 518.3
status: pending
depends_on: [E5-T18b]
estimate: S
risk: high
capstone: false
---

## Goal

Freeze pointer geometry and focus hit-testing for the ready desktop at device-pixel ratios one
and two.

## Boundary

This slice owns host-cursor mapping, guest hover-highlight state, and close/maximize button
hit-tests at DPR 1 and DPR 2. Terminal launch, compositor recovery, and documentation belong
to neighboring slices.

## Deliverables

- A deterministic pointer test fixture with explicit CSS-to-guest coordinate assertions.
- Evidence for cursor/hover coincidence and close/maximize behavior at DPR 1 and DPR 2.
- Regression coverage for rounding, canvas offsets, and the active-window focus transition.

## Acceptance criteria

- [ ] Moving the host cursor to the tested control produces the matching guest hover highlight
      at both DPR 1 and DPR 2, with no one-pixel or scale-dependent offset.
- [ ] Close and maximize buttons hit-test the intended window at both DPR values and do not
      activate an adjacent control.
- [ ] The pointer/focus run is deterministic across repeated local Chromium contexts and has
      no unexpected console errors.

## Verification command

make verify-E5-T18c

## Adversarial verification

Run the hit-test matrix at fractional canvas offsets and at coordinates immediately adjacent
to each button boundary. Repeat after opening and maximizing a second window. Any DPR-dependent
miss, neighboring-control activation, or cursor/hover divergence refutes the slice. WebKit and
independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice isolates pointer scaling and focus geometry after the terminal path is known to be
usable.
