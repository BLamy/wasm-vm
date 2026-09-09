---
id: E5-T09e
epic: 5
title: Damage tiling and frame-pacing integration proof
priority: 509.5
status: verified
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

### 2026-09-04 — verifier — VERDICT: verified

- P1 tiled/full-frame A/B — HELD. Predicted that two cursor updates would stay below one percent
  of the 4,096,000-byte full-frame budget and that a full-screen scroll would remain pixel-correct;
  Chromium readback matched in both paths, with cursor uploads of 32,768 bytes (0.8%) and matching
  CRCs `cf091863` (cursor) and `4017dc0a` (scroll), with zero mismatched bytes.
- P2 pacing under load — HELD. Predicted that 240 synthetic plans per second would retain one
  pending slot, present at most display-refresh plus one, and remain below the 50 ms long-task
  budget; the visible run presented 62/240 with `maxPending=1`, zero long tasks, and the 4× CPU-
  throttled run presented 62/240 with the same bounds. Both runs drained to zero pending work.
- P3 adversarial coverage — HELD. Predicted that the seeded 10,000-sequence A/B fuzz, exact tile
  boundaries, resize, and cursor-after-visibility-resume cases would preserve final pixels and
  latest delivery; all passed, with fuzz CRC `3d719f55`, zero mismatched bytes, and stale timer
  ignored on resume.
- P4 forced-hidden boot — HELD. Predicted that a forced-hidden Linux boot would use the bounded
  250 ms timer without stopping serial progress; the Chromium boot used timer mode, received 21
  plans with `maxPending=1`, presented 9, produced 58 serial bytes after `E5T09E_SERIAL_OK`, and
  retired 398,987,126 guest instructions. `vm.stats.gpu` remained finite scalar data and the
  presentation/backend error list was empty.
- P5 coverage and packaging — HELD. The exact runtime implementation head was
  `8b4b0faec77c54b8eed75ad77072b9d3535e7be7`; `node tools/verify/e5-t09e-present-integration.mjs`
  completed source/dist parity, Chromium 131 integration, and zero console/page/request errors.
  Evidence is `evidence/e5-t09e/present-integration.json`, SHA-256
  `ed5f48b5c36d809552d5db328515a09fd241ceaf69956bcf54a887e8908210d7`.

The user explicitly waived independent-machine and WebKit coverage; host rr is waived by the
repository evidence policy. No new GPU protocol or scheduler primitive was added; this slice
closes the integration proof and measured appendix for T09.
