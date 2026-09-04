---
id: E5-T20c
epic: 5
title: AudioWorklet producer, AudioContext clock, and latency metrics
priority: 520.3
status: verified
depends_on: [E5-T20b]
estimate: S
risk: high
capstone: false
---

## Goal

Connect T19's S16 `AudioSink` to the ring/worklet pair and make the AudioContext's consumed-frame
progress the pacing source, with honest fill and latency telemetry.

## Boundary

This slice owns producer-side S16→f32 conversion, AudioContext construction/rate negotiation, clock
feedback, and `vm.stats.audio`. Autoplay gesture policy and the final guest capture remain downstream.

## Deliverables

- `web/src/audio/sink.js` implementing the T19 `AudioSink` contract over the T20a ring.
- Producer-side consumed-frame clock feedback and 48 kHz-or-actual-rate PCM advertisement.
- `vm.stats.audio = { latency_ms, underruns, fill }` with `baseLatency`/`outputLatency` when exposed.
- Unit tests for stereo conversion, rate fallback, fill/latency calculation, and two simultaneous
  sink instances with disjoint rings.

## Acceptance criteria

- [ ] A reference S16 ramp reaches the ring as exact interleaved f32 values and each sink instance
      owns a distinct ring.
- [ ] AudioContext sample-rate negotiation advertises 48 kHz when honored and the actual context
      rate when the constructor falls back; no implicit resampler is introduced.
- [ ] Reported latency includes ring fill plus available context latency and stays below 120 ms at
      the default 4096-frame configuration.

## Verification command

`node --test web/tests/audio-sink.test.mjs`

## Adversarial verification

Force 44.1 kHz, alternate empty/full ring states, pause the consumer for 500 ms, and instantiate
two sinks in one page. The rate, fill, underrun, and latency reports must remain isolated and
monotonic with the injected clock.

## Verification log

### 2026-09-03 — worker — implemented

- Commit: `49f3bc508df325381c788893cfb2bd3bf87a8dc6`.
- Exact-head acceptance: `env -i PATH="$PATH" node --test web/tests/audio-sink.test.mjs` — 6
  passed, 0 failed.
- The tests cover exact S16 stereo conversion, disjoint rings, honored 48 kHz, 44.1 kHz fallback
  and no-resampler rejection, stable worklet connection, full/empty fill and latency telemetry,
  monotonic consumed-frame/context clock, and bounded full-ring backpressure.
- Stability: 20 repeated sink-only runs passed; dependent T20a/T20b suites passed 13/13.
- Packaging: `make web-dist` succeeded and the source/deploy copies of ring, worklet, and sink
  are byte-identical. Evidence transcript:
  `evidence/e5-t20c/audio-sink-verifier-2026-09-03.txt` (SHA-256
  `e0fc26bbc19e9ff41f936ddb78b94659d9679ff4688f63329da2da9073bdbd90`).

The recording demonstrates that T19-style S16 frames reach a private shared ring with exact
stereo normalization, the actual AudioContext rate is the only advertised/input rate, the
consumed-frame clock stays monotonic under an injected context pause, and `vm.stats.audio`
includes ring fill, atomic underruns, and exposed context latency within the 120 ms budget.

### 2026-09-03 — verifier — VERDICT: verified

- **S16 conversion and isolation — HELD.** Predicted exact extrema/ramp conversion and no shared
  storage between two simultaneous sinks. The 6-test acceptance run held both predictions.
- **Rate negotiation — HELD.** Predicted 48 kHz when honored, actual 44.1 kHz after constructor
  fallback, and a hard failure rather than an implicit resampler for mismatched input. All three
  branches held.
- **Clock and telemetry — HELD.** Predicted that full→empty ring transitions, atomic underrun
  updates, and an injected 500 ms context-time advance would keep `fill`, `underruns`, and
  `latency_ms` honest and monotonic. The stats and clock tests held; full fill plus 30 ms context
  latency reported about 115.3 ms.
- **Coverage and reproducibility — HELD.** The acceptance suite passed in a scrubbed environment,
  20 repeated sink-only runs passed, and dependent ring/worklet suites passed 13/13. Evidence:
  [`audio-sink-verifier-2026-09-03.txt`](../../evidence/e5-t20c/audio-sink-verifier-2026-09-03.txt),
  SHA-256 `e0fc26bbc19e9ff41f936ddb78b94659d9679ff4688f63329da2da9073bdbd90`.
- Findings: none. The task is verified.
