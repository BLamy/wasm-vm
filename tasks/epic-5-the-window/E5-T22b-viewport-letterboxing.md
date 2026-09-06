---
id: E5-T22b
epic: 5
title: Debounce viewport and DPR changes with stale-frame letterboxing
priority: 522.2
status: implemented
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

### 2026-09-06 — coordinator — in-progress

T22a independently verified at dc28b514; its four held acceptance items are
checked off as a metadata handoff. Implement the viewport/presentation boundary
without changing the guest compositor or the retained fixed-size T18 proof pages.

### 2026-09-06 — worker — implemented

Frozen runtime/harness `66bb2a48019d089756cdfaee3d5ea578f156bc28`.
`make web-dist` rebuilt the deployable modules. Final command
`make verify-E5-T22b > evidence/e5-t22b/acceptance.log 2>&1` exited 0: 55 tests,
58 independent pixel checks / 183,108,328 bytes across actual Canvas2D and
WebGL2 at DPR 1, 1.5 and 2, live DPR swaps, real mode RPCs, one extra request
for a 50-change / five-second storm, native pointer transport, context-loss
replacement, and disposal. Chrome 152 uses an explicitly recorded software
WebGL renderer for functional proof only. Built demo: 126/0, zero collected
errors; main-app ownership accepts its current initial viewport through a real
paused fixture controller. This does not claim a live compositor adopted a mode.

Evidence: `evidence/e5-t22b/README.md`, `viewport-proof.json` SHA256
`d273f19eb6f5b7ce92505d049fada88dc73ee79f02776a3be83478cd66587690`,
`acceptance.log` SHA256
`703d8693242638966c4c0b08d64a39a9d9b80e2ef5c7a9d039ecce24f9017a43`,
and seven hash-bound browser captures. Unchanged WASM SHA256
`563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc` carries
T22a's verified guest trace, event/EDID semantics and resource bounds forward.

The verifier's provisional novel attack refuted the initial `2da168d7` frame
transition twice. Both reports and the initial worker recording are retained.
The fix decides required full damage at paint time, so a newer partial frame
cannot coalesce it away; mismatch clears only after successful backend delivery.
The final deterministic regression and six browser cases exercise exactly that
composition. Viewport timers/RPC policy and all other HELD boundaries are unchanged.
No full-workspace/Rust gauntlet or real guest desktop claim is made for this
medium-risk JavaScript-only boundary.
