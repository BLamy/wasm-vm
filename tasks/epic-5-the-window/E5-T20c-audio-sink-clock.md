---
id: E5-T20c
epic: 5
title: AudioWorklet producer, AudioContext clock, and latency metrics
priority: 520.3
status: pending
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

(empty)
