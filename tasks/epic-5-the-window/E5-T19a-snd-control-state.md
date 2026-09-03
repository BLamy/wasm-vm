---
id: E5-T19a
epic: 5
title: virtio-snd control protocol and PCM state machine
priority: 519.1
status: pending
depends_on: [E5-T05c]
estimate: S
risk: medium
capstone: false
---

## Goal

Define the guest-visible virtio-snd control contract and make one playback stream's legal
transitions explicit before any host audio timing or browser sink exists.

## Deliverables

- `crates/core/src/dev/virtio/snd/mod.rs` control-plane skeleton for virtio device ID 25.
- Deterministic JACK_INFO, PCM_INFO, and CHMAP_INFO responses for one stereo S16 output stream.
- An explicit RELEASED → SET_PARAMS → PREPARED → RUNNING → STOPPED → RELEASED transition table
  with a checked-in oracle covering every request/state cell.
- Validation for format, rate, channels, buffer size, period size, and stream ID.

## Acceptance criteria

- [ ] The exhaustive native oracle covers all six control requests across all five stream states and
      matches the documented OK/BAD_MSG table exactly.
- [ ] Config responses advertise one output jack, FL/FR, S16, stereo, and only 44.1 kHz/48 kHz;
      unsupported selectors and malformed requests return deterministic errors.
- [ ] `SET_PARAMS` at 96 kHz returns `VIRTIO_SND_S_BAD_MSG` while a subsequent legal setup remains
      usable.

## Adversarial verification

Permute control requests and selectors, repeat SET_PARAMS with boundary-sized buffers, and inject
unknown stream IDs or truncated payloads. The oracle must show no illegal transition, panic, or
state mutation after a rejected request.

## Verification log

(empty)
