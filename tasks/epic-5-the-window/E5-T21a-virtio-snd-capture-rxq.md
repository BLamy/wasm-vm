---
id: E5-T21a
epic: 5
title: Virtio-snd capture stream and rxq state machine
priority: 521.1
status: verified
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

- [x] A legal posted capture buffer completes with the requested channel/sample format, actual byte
      length, and success status without modifying bytes outside the posted guest range.
- [x] Malformed headers, 16-byte periods, 1 MiB periods, short descriptors, and guest-memory canaries
      fail closed or complete with a bounded status; no rxq request poisons the next request.
- [x] PCM_START/STOP/PREPARE/RELEASE transitions are deterministic and playback behavior is unchanged.

## Verification command

`cargo test -p wasm-vm-core --test virtio_snd_capture`

## Adversarial verification

Permute descriptor lengths and offsets, place canaries on both sides of every receive buffer, submit
zero-length and absurd periods, and interleave capture STOP/START with playback transfers. Inspect
every used-ring length and status for boundedness and deterministic recovery.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified (user-directed)

- **Capture stream and rxq contract — HELD.** Predicted that a legal stream-1 receive chain would
  remain pending until its exact period deadline, write only the requested interleaved S16 payload,
  publish `period_bytes + 8`, and return `S_OK`. The exact-head fixture held all predictions for
  mono and stereo sources, including source ramp bytes and untouched canaries on both sides of the
  guest buffers.
- **Malformed and hostile buffers — HELD.** Predicted bounded `IO_ERR` completion for short
  headers, undersized PCM storage, wrong stream ids, and a short status tail, with the following
  valid descriptor still accepted. The 1 MiB-period case stayed bounded by the posted writable
  range. The XRUN attack ran 257 short-source periods and retained exactly the 256-event budget,
  counting one dropped notification.
- **Lifecycle and regression behavior — HELD.** Predicted stream-local PREPARE/START/STOP/RELEASE
  transitions, release flushing of pending rxq buffers, and unchanged playback/queue behavior. The
  capture transition fixture and the existing virtio-snd playback, machine, and queue suites all
  passed.
- **Coverage and reproducibility — HELD.** At exact implementation head
  `a41c4bd49fbdeef792f32c2296b9cb916479c863`, the acceptance command passed 6/6, 25 consecutive
  focused reruns passed 6/6, all-target core clippy, 238 core library tests, the existing sound
  suites, the wasm release build, the no-default-features check, formatting, and diff checks
  passed. Evidence transcript: [`virtio-snd-capture-2026-09-04.txt`](../../evidence/e5-t21a/virtio-snd-capture-2026-09-04.txt),
  SHA-256 `8ab1b294e85b578a13ad5382c49c77d0cf6fe24439c968cd7cc9e5106eea580a`.
- **SUITE — HELD.** Retain the deterministic rxq fixtures and bounded XRUN-budget regression in
  `crates/core/tests/virtio_snd_capture.rs`; host media, permissions, browser UI, independent
  machines, and WebKit remain outside this slice or waived by user direction.
- Findings: none. The task is verified.
