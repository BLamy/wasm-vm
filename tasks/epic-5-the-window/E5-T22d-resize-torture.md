---
id: E5-T22d
epic: 5
title: Prove end-to-end resize storms, resource cleanup and reload boundaries
priority: 522.4
status: pending
depends_on: [E5-T22c]
estimate: S
risk: high
capstone: false
---

## Goal

Finish the original E5-T22 acceptance and adversarial resize matrix on the actual
desktop, preserving the already verified host/compositor boundaries.

## Boundary

Own the end-to-end deterministic torture harness, final resource/timing proof
and docs/display.md. New product fixes, if needed, must re-earn their scoped gates.

## Deliverables

- Scripted real desktop resize sequences with screenshots and actual GPU stats.
- Resource lifetime, DPR, debounce, race and mid-resize reload evidence.
- Pipeline and stale-frame policy documentation, including minimum clamp and
  the fbcon next-mode-set caveat.

## Acceptance criteria

- [ ] Ten resizes while foot runs yes reflow text without guest crash/host panic;
      actual GPU resource count returns to its pre-resize baseline.
- [ ] Fifty changes in five seconds coalesce to a bounded handful of guest mode
      changes; final mode is exact and dmesg/compositor logs have zero new errors.
- [ ] DPR 100% to 150% to 100% changes the real mode and retains sharp glyph
      edges without fractional CSS scaling.
- [ ] Two hundred 100-ms racing resizes under 4x CPU throttle finish without
      stuck letterbox, torn rows, leaked framebuffers, guest OOM or kernel WARN.
- [ ] A zero-debounce test forces host resize between guest TRANSFER and FLUSH;
      native sanitizer/bounds evidence and wasm bounds checks show no OOB access.
- [ ] Shrink to 640x480 with ten windows and grow again: clients remain reachable.
      Reload mid-resize boots at the current container pixel mode.
- [ ] The original T22 criteria are all mapped to retained T22a-c or this proof,
      including the two-second release-to-matching-frame bound and actual EDID.

## Verification command

make verify-E5-T22d

## Adversarial verification

Independently choose a bounded odd-dimension sequence and a mid-transition reload.
Check screenshot rows against the no-shear oracle and compare per-resize resource
counts with the actual device map, not presentation counters. Reopen evidence at
the forced TRANSFER/FLUSH window; a new target must not alter old resource bounds.
Carry unchanged T22a-c predictions HELD instead of restarting unrelated suites.

## Verification log

### 2026-09-06 — coordinator — planned

Final ordered S replacement for E5-T22 and the dependency handoff for T27.
No original acceptance or adversarial requirement is removed by decomposition.

