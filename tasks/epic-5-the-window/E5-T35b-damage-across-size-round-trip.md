---
id: E5-T35b
epic: 5
title: Keep queued damage across a resource size round trip and across a failed backend present
priority: 0.387641
status: pending
depends_on: [E5-T35a]
estimate: S
risk: low
capstone: false
---

## Boundary

`web/src/sink/presentation.js` only. Two gaps the E5-T35a verifier found. Neither is a
regression (the previous file behaves the same or worse) and neither has been seen on the live
desktop; both were found by fuzzing the controller.

1. **Size round trip under a fixed viewport.** Queue an 8x8 frame with rect `{6,6,2,2}`, then a
   16x16 frame, then an 8x8 frame with rect `{0,0,1,1}`, with no paint in between (one paused
   period, one hidden-tab timer period or one animation frame). Only `{0,0,1,1}` is painted and
   `{6,6,2,2}` stays stale: pending damage of the first size is dropped when the second size
   arrives, and E5-T35a's premise that a resized resource repaints in full does not hold under a
   fixed viewport. The verifier's fuzz hit it in 71 of 600 seeds in that mode
   (`evidence/e5-t35a/verifier/`).
2. **A backend `present` that throws.** Pending damage is cleared before the backend call, so
   after a throw the next frame paints only its own rect.

Fix: when the queued size changes, promote the next paint to the whole resource instead of
dropping the queued damage; clear pending damage only after the backend call returns.

## Deterministic acceptance

`cd web && node --test tests/e5-t06d-presentation.test.mjs` passes with two new cases: the
round trip above paints a rect covering `{6,6,2,2}`; after a backend that throws once, the next
present covers the rect of the failed one. Both must fail on the E5-T35a `presentation.js`.

## Adversarial verification

Low risk: inspect the direct result and re-run the verifier's fixed-viewport fuzz mode from
`evidence/e5-t35a/verifier/` with fresh seeds; no seed may leave a stale pixel.

## Verification log
