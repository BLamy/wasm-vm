---
id: E5-T20b
epic: 5
title: AudioWorklet consumer and underrun accounting
priority: 520.2
status: pending
depends_on: [E5-T20a]
estimate: S
risk: high
capstone: false
---

## Goal

Consume the T20a ring on the real-time audio rendering thread in fixed 128-frame quanta, producing
silence and an atomic underrun count when a quantum is unavailable.

## Boundary

This slice owns the worklet processor and its deterministic simulated-renderer tests. Producer
conversion, AudioContext clock feedback, autoplay, and guest proof remain downstream.

## Deliverables

- `web/src/audio/worklet.js` registered under a stable processor name and safe for `process()` on the
  rendering thread.
- Exact-fill and underflow behavior: consume available frames, zero-fill missing frames, and bump
  the SAB underrun counter once per starved quantum.
- No locks, promises, timer calls, or avoidable allocations in `process()`.
- A test hook that supplies synthetic quanta without requiring an actual audio device.

## Acceptance criteria

- [ ] Full, partial, and empty 128-frame quanta produce the expected sample-for-sample output;
      empty reads output silence and increment underruns exactly once.
- [ ] A ring wrap at a quantum boundary produces no click-inducing duplicate or missing sample.
- [ ] The processor never calls a blocking primitive and remains bounded to one quantum per
      `process()` invocation.

## Verification command

`node --test web/tests/audio-worklet.test.mjs`

## Adversarial verification

Starve the producer for alternating quanta, present a one-frame-short ring, and run 10,000
simulated `process()` calls across wrap boundaries. Inspect every output block and the underrun
counter for exact accounting and no state drift.

## Verification log

(empty)
