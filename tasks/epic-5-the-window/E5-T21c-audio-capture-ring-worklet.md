---
id: E5-T21c
epic: 5
title: Capture SAB ring and AudioWorklet producer
priority: 521.3
status: in-progress
depends_on: [E5-T21b]
estimate: S
risk: high
capstone: false
---

## Goal

Implement the browser-side capture half of the microphone pipeline: a capture AudioWorklet writes
interleaved f32 frames into a second shared ring for the VM worker to consume.

## Boundary

This slice owns the reversed SPSC ring role, capture worklet quantum handling, rate/channel metadata,
and deterministic Node tests. Permission requests, guest rxq consumption, and user-facing indicators
belong to dependent slices.

## Deliverables

- Capture ring layout reusing T20's atomic header contract with producer/consumer roles reversed.
- Capture AudioWorklet that copies bounded 128-frame input quanta and reports overflow/drop state.
- Tests for wrap, empty/full backpressure, mono/stereo conversion, and 44.1/48 kHz pacing.

## Acceptance criteria

- [ ] Every committed capture frame is ordered exactly once across repeated non-power-of-two wraps;
      the consumer never reads unpublished data and the producer never overwrites unread data.
- [ ] Mono input is expanded deterministically to the advertised guest channels; missing input is
      zero-filled and overflow increments a bounded counter without blocking the audio thread.
- [ ] The worklet process path contains no promise, timer, blocking primitive, or per-quantum
      allocation helper and remains correct at both supported rates.

## Verification command

`node --test web/tests/audio-capture-ring.test.mjs web/tests/audio-capture-worklet.test.mjs`

## Adversarial verification

Run seeded producer/consumer schedules through counter wrap, starve and flood the consumer, switch
between mono and stereo, force 44.1 kHz, and inspect every frame/counter plus the process source guard.

## Verification log

(empty)
