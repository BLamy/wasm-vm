---
id: E5-T19d
epic: 5
title: virtio-snd Linux guest integration and playback proof
priority: 519.4
status: pending
depends_on: [E5-T19c]
estimate: S
risk: medium
capstone: false
---

## Goal

Wire the completed virtio-snd device into the booted guest and freeze the end-to-end playback
contract that E5-T20 will consume.

## Deliverables

- Native and browser assembly wiring that preserves existing virtio slots and exposes the sound
  device to Linux without changing unrelated devices.
- A deterministic guest playback validator and checked-in control/response capture diffed against
  the QEMU-shaped fixture.
- Final native WavSink and headless Alpine playback evidence, including pacing and recovery.

## Acceptance criteria

- [ ] The booted guest's `aplay -l` lists the card and `speaker-test -c2 -tsine -l1 -r48000`
      completes; the native WavSink capture contains the clean reference sine.
- [ ] `aplay short.wav` under the real-time mock clock completes within ±10% of the file duration
      and is not a burst drain.
- [ ] The exact-head validator proves the QEMU-shaped control responses, malformed-buffer recovery,
      and STOP/START playback resumption with zero unexpected guest or host errors.

## Adversarial verification

Kill the guest playback process mid-stream and immediately restart it 50 times, checking legal
STOP+RELEASE sequences, stable queue depth, and no repeated periods. Run the reference ramp through
the guest path and compare the sink output sample-for-sample; vary the mock clock at 0.5x and 2x.

## Verification log

(empty)
