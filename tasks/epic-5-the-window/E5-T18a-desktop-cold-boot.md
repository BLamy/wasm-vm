---
id: E5-T18a
epic: 5
title: Prove the local cold-boot desktop contract
priority: 518.1
status: pending
depends_on: [E5-T08, E5-T15d, E5-T17e]
estimate: S
risk: high
capstone: false
---

## Goal

Make the T17 desktop artifact reach a visible, ready desktop from a clean local browser load.

## Boundary

This slice owns only the cold-load assembly and desktop-readiness contract: wallpaper, panel,
and WM menu must become visible without serial intervention. Terminal semantics, pointer/DPR
hit-testing, crash recovery, and the final playbook belong to dependent slices.

## Deliverables

- A deterministic local Chromium cold-boot harness using the committed T17 artifact.
- Explicit desktop-ready markers and a measured cold/warm boot-to-desktop statistic.
- A recorded screenshot and console/error transcript for the successful path.

## Acceptance criteria

- [ ] In a fresh local Chromium context with cache disabled, ten consecutive loads reach the
      wallpaper, panel, and WM menu with no manual serial intervention.
- [ ] The harness records cold and warm boot-to-desktop timings and fails on a timeout, black
      screen, missing panel/menu, unexpected console error, or hidden readiness marker.
- [ ] The run exercises the committed image publication path and leaves the read-only source
      artifact unchanged.

## Verification command

make verify-E5-T18a

## Adversarial verification

Run 25 local Chromium cold boots with cache disabled and independent fresh contexts. Add the
500 ms seatd-start test delay; the boot must still reach the same readiness contract or produce
the documented bounded failure marker. A hang, black screen, missing cursor/menu readiness, or
manual intervention refutes this slice. WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice isolates the first user-visible desktop boundary so later input and recovery work
cannot hide a cold-boot regression.
