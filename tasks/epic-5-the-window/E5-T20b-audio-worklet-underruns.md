---
id: E5-T20b
epic: 5
title: AudioWorklet consumer and underrun accounting
priority: 520.2
status: verified
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

### 2026-09-03 — worker — implemented

- Commit: `c96bd1ef2458c9d5d7f3eb516a6a72d04b006a14`.
- Exact-head acceptance: `env -i PATH="$PATH" node --test web/tests/audio-worklet.test.mjs
  web/tests/audio-ring.test.mjs` — 13 passed, 0 failed.
- The worklet cases exercise full, one-frame-short, empty, quantum-boundary wrap, alternating
  starvation over 10,000 simulated `process()` calls, and the no-blocking/no-allocation source
  guard. The dependent ring suite carries forward the exact-fill, non-power-of-two wrap, 2^32
  rollover, concurrent worker, capacity mutation, and malformed-input coverage.
- Stability: `env -i PATH="$PATH" node --test web/tests/audio-worklet.test.mjs` passed 5/5, and
  20 repeated worklet-only runs all exited 0.
- Packaging: `make web-dist` succeeded; both `cmp web/src/audio/ring.js
  web/dist/src/audio/ring.js` and `cmp web/src/audio/worklet.js web/dist/src/audio/worklet.js`
  passed. Evidence transcript:
  `evidence/e5-t20b/audio-worklet-verifier-2026-09-03.txt` (SHA-256
  `fb51b1ca831e785f203ac431afba61251b039240929a1cf641b0e5c31b2c8bc4`).

The recording demonstrates that the real processor path drains at most one 128-frame quantum,
copies stereo f32 frames into caller-owned planar output, zero-fills every missing frame, and
increments the shared underrun counter exactly once per starved quantum. It also proves the
dependent ring contract remains ordered through wraps and concurrent publication, with the
deployable source copy byte-identical to the tested module.

### 2026-09-03 — verifier — VERDICT: verified

- **Quantum output — HELD.** Predicted exact sample preservation for a full 128-frame render and
  zero-fill for every missing frame in partial and empty renders. The focused run held both cases,
  including the one-frame-short adversarial input.
- **Underrun accounting — HELD.** Predicted exactly one atomic counter increment per starved
  `process()` call. Alternating starvation held for 10,000 simulated calls with the expected
  count and zero residual fill.
- **Wrap and real-time boundary — HELD.** Predicted no duplicate or missing frames at a
  quantum-sized ring wrap and no blocking/allocation primitive in `process()`. The wrap test and
  source guard held; the dependent ring suite also held the concurrent SPSC publication contract.
- **Coverage and reproducibility — HELD.** The exact-head suite passed 13/13 in a scrubbed
  environment, the worklet suite passed in 20 repeated runs, and source/deploy copies matched by
  digest. Evidence: [`audio-worklet-verifier-2026-09-03.txt`](../../evidence/e5-t20b/audio-worklet-verifier-2026-09-03.txt),
  SHA-256 `fb51b1ca831e785f203ac431afba61251b039240929a1cf641b0e5c31b2c8bc4`.
- Findings: none. The task is verified.
