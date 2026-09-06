---
id: E5-T22b
epic: 5
title: Debounce viewport and DPR changes with stale-frame letterboxing
priority: 522.2
status: pending
depends_on: [E5-T22a]
estimate: S
risk: medium
capstone: false
---

## Goal

Observe the browser display container and device-pixel ratio, request bounded
guest pixel modes, and safely present old-size frames while the guest catches up.

## Boundary

Own browser viewport policy, its lifecycle, and presentation/input coordinates.
This does not claim that the selected compositor has adopted a new mode.

## Deliverables

- ResizeObserver, DPR watcher and 250 ms trailing debounce to T22a's controller.
- Documented minimum and EDID-maximum clamps.
- Native-pixel clipped/letterboxed stale frames on black, with no CSS stretching.
- Real Canvas2D/WebGL2 fixtures, disposal/race tests and a visible demo surface.

## Acceptance criteria

- [ ] CSS dimensions multiplied by DPR yield rounded bounded device-pixel modes.
      DPR changes without CSS changes are observed. The trailing delay is 250 ms;
      a test-only zero-delay hook is explicitly scoped.
- [ ] Fifty size changes over five seconds coalesce to a bounded handful of
      requests and end at the final mode. Late async replies cannot restore older
      intent. Disposal cancels observers, timers and DPR listeners.
- [ ] Old-size resource rows keep their own stride and bounds. The visible target
      clips or letterboxes at native pixel scale on opaque black, never stretches.
      A matching frame removes the mismatch state and bars.
- [ ] Odd widths and DPR 1, 1.5 and 2 pass independent pixel oracles through both
      actual browser backends, including context loss/replacement and a pending
      scheduled frame at resize.
- [ ] Pointer coordinates map the visible target consistently; minimum-size
      clamping and the pre-desktop next-mode-set caveat are documented.

## Verification command

make verify-E5-T22b

## Adversarial verification

Race an old RPC response against a newer viewport intent, then dispose while an
RPC is pending. Submit an old resource after shrinking the target, including a
partial last-row rectangle; compare pixels to an independent stride/clipping
oracle. Lose WebGL context during the mismatch and require the replacement
canvas to replay the same bounded image. Add one independent odd-size sequence.
Carry T22a and existing resource TRANSFER bounds forward unchanged.

## Verification log

### 2026-09-06 — coordinator — planned

Second ordered S replacement for E5-T22. Real guest adoption and end-to-end
latency/resource cleanup remain the responsibility of T22c-d.

