---
id: E5-T09e
epic: 5
title: Damage tiling and frame-pacing integration proof
priority: 509.5
status: in-progress
depends_on: [E5-T09d]
estimate: S
risk: medium
capstone: false
---

## Goal

Close T09 with one end-to-end proof that tiled/coalesced presentation is pixel-correct, latest-wins
under load, and documented with measured counters.

## Boundary

This slice owns the integrated browser workload, A/B switch, stress assertions, and presentation
performance appendix. It does not add new GPU protocol or scheduler primitives.

## Deliverables

- A deterministic fbcon cursor-blink/full-scroll A/B route using tiling/coalescing enabled and
  disabled.
- A 240-rect/s responsiveness proof recording present rate, queue bound, and long-task maximum.
- Updates to `docs/perf/present-paths.md` with bytes/frame and ms/frame for the scroll and blink
  workloads, tied to the exact bundle head.

## Acceptance criteria

- Cursor-blink uploaded bytes stay below 1% of the full-frame byte budget, and full-screen scroll
  final pixels/CRC match the disabled-tiling reference exactly.
- Under 240 synthetic flush plans per second, presents stay at display refresh plus one or less,
  no long task exceeds 50 ms, and the pending queue does not grow.
- A forced-hidden boot drains via the timer fallback; serial output remains live; the evidence
  records counters, browser health, and source/dist parity.

## Verification command

`node tools/verify/e5-t09e-present-integration.mjs`

## Adversarial verification

Run the seeded 10,000-sequence A/B fuzz, exact tile-boundary and resize cases, a 4x CPU-throttled
latest-wins run, and a cursor update immediately after visibility resume. Any CRC mismatch, queue
growth, dropped final cursor, or long-task violation refutes the proof.

## Verification log

(empty)
