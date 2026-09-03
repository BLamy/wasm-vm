---
id: E5-T19b
epic: 5
title: virtio-snd paced playback and native audio sinks
priority: 519.2
status: pending
depends_on: [E5-T19a]
estimate: S
risk: medium
capstone: false
---

## Goal

Consume one playback txq period at the pace of an injectable audio clock and expose the samples
through a native-testable sink without draining the queue in a burst.

## Deliverables

- `AudioClock` injection and txq completion with computed `latency_bytes`.
- `AudioSink` trait with the default null sink and a scratch-directory `WavSink`.
- PREPARE/START/STOP/RELEASE integration for period delivery, including clean STOP/START resume.
- Native deterministic pacing, ramp-integrity, and sine-capture fixtures.

## Acceptance criteria

- [ ] Mock-clock runs at 0.5x, 1x, and 2x real time complete the same PCM at the corresponding
      wall-clock rate; arrival alone never completes an unripe period.
- [ ] A bit-exact ramp reaches `WavSink` sample-for-sample, with no dropped or duplicated period at
      normal playback or a STOP/START boundary.
- [ ] The native sine fixture captures eight seconds at 48 kHz with the expected FFT peak and no
      period-join discontinuity beyond 1 LSB; every completion reports bounded latency bytes.

## Adversarial verification

Hold the mock clock still while posting multiple txq descriptors, then advance it one period at a
time and inspect sink samples and used-ring order. Stop after a partial period, restart, and compare
the output against the reference ramp for duplicate or skipped samples.

## Verification log

(empty)
