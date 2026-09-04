---
id: E5-T21a
epic: 5
title: Virtio-snd capture stream and rxq state machine
priority: 521.1
status: in-progress
depends_on: [E5-T20e]
estimate: S
risk: high
capstone: false
---

## Goal

Add the guest-facing capture PCM stream and receive-queue (`rxq`) protocol to virtio-snd without
opening a host microphone or changing the existing playback stream.

## Boundary

This slice owns only the core/device contract: capture stream descriptors, posted empty-buffer
validation, bounded completion length/status, stream transitions, and event notification. Host media,
shared capture buffers, permissions, and browser UI belong to dependent slices.

## Deliverables

- Capture stream state and transition handling reusing T19's playback transition table.
- `virtio_snd_pcm_xfer` receive-side parsing with actual-length completions and bounded writes.
- Deterministic native fixtures for legal, malformed, undersized, and oversized rxq buffers.

## Acceptance criteria

- [ ] A legal posted capture buffer completes with the requested channel/sample format, actual byte
      length, and success status without modifying bytes outside the posted guest range.
- [ ] Malformed headers, 16-byte periods, 1 MiB periods, short descriptors, and guest-memory canaries
      fail closed or complete with a bounded status; no rxq request poisons the next request.
- [ ] PCM_START/STOP/PREPARE/RELEASE transitions are deterministic and playback behavior is unchanged.

## Verification command

`cargo test -p wasm-vm-core --test virtio_snd_capture`

## Adversarial verification

Permute descriptor lengths and offsets, place canaries on both sides of every receive buffer, submit
zero-length and absurd periods, and interleave capture STOP/START with playback transfers. Inspect
every used-ring length and status for boundedness and deterministic recovery.

## Verification log

(empty)
