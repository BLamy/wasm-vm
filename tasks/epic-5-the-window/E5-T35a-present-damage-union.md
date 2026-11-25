---
id: E5-T35a
epic: 5
title: Paint the union of coalesced damage so an earlier flush is never left stale on the canvas
priority: 0.38764
status: in-progress
depends_on: [E4-T40b]
estimate: S
risk: low
capstone: false
---

## Boundary

`web/src/sink/presentation.js` only (host presentation; no guest or wasm change).

The frame scheduler keeps one pending frame and presents at most once per animation frame.
Every frame carries the whole resource, but the presentation controller painted only the
newest frame's rect. When two guest flushes land inside one animation frame — a button
repaint, then a flush elsewhere such as the cursor — the first region was never painted and
stayed stale until some later flush happened to cover it.

Track the damage queued behind the scheduler and paint its union with the newest rect (same
resource size only; a resized resource already repaints in full). An immediate present that
replaces a queued frame keeps that frame's damage too.

## Deterministic acceptance

`cd web && node --test tests/e5-t06d-presentation.test.mjs tests/e5-t09c-present-scheduler.test.mjs tests/e5-t09d-hidden-present.test.mjs`
passes, including three new cases: coalesced flushes paint the union with the newest pixels
and painted damage is not carried into the next frame; queued damage of another resource
size is not unioned into a resized frame; an immediate present keeps the damage of the
queued frame it replaces.

## Adversarial verification

Low risk: inspect the direct result. The new test must fail on the previous
`presentation.js`.

## Verification log
