---
id: E5-T21c
epic: 5
title: Capture SAB ring and AudioWorklet producer
priority: 521.3
status: verified
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

### 2026-09-04 — verifier — VERDICT: verified (user-directed)

- **Reversed SPSC publication — HELD.** Predicted that the capture worklet-owned producer would
  publish complete frames in order, that the VM consumer would observe only published fill, and
  that explicit slot cursors would survive repeated non-power-of-two wraps and a `uint32` counter
  rollover. The focused ring suite held this across 12,345 frames at capacity 7 and a real worker
  producer/consumer race at capacity 4,095; no duplicate, missing, or unpublished frame was
  observed.
- **Backpressure and overflow — HELD.** Predicted that a full ring would return immediately with
  only the available prefix committed, preserve unread frames, and saturate the shared dropped
  frame counter rather than wrap it. Full/empty tests held the prefix and later-frame ordering;
  the counter remained `0xffff_ffff` after further drops.
- **Channel conversion and missing input — HELD.** Predicted exact stereo preservation, deterministic
  mono duplication into the ring's two advertised channels, and zero-fill for short or absent
  input channels. The capture worklet suite held all three paths, including a 128-frame bound for
  oversized input.
- **Rate and real-time boundary — HELD.** Predicted fixed 128-frame quanta with correct 44,100 Hz
  and 48,000 Hz duration metadata, no promises/timers/locks/`Atomics.wait`, and no per-quantum
  allocation helper in `process()`. Both supported rates, the shared frame clock, duration
  calculation, and source guard held.
- **Browser path and coverage — HELD.** The real Chromium AudioWorklet module loaded from the
  built page under cross-origin isolation, consumed a one-channel constant source into the SAB,
  duplicated it to stereo, and reported `read > 0`, `droppedFrames = 0`, with zero unexpected
  console errors. The roadmap capability is marked verified and source/deploy copies are byte
  identical.
- **Suite — HELD.** The exact-head focused command passed 12/12; 25 scrubbed repetitions passed;
  the dependent T20a–T20d audio suites passed 27/27; `cargo fmt`, affected-crate clippy, wasm
  clippy/checks, `make web-build`, `make web-dist`, and `git diff --check` passed. The workspace
  clippy wall remains blocked by pre-existing macOS-incompatible `wvseccomp` Linux syscalls and
  unrelated pre-existing `wasm-vm-core` dead-code warnings; no T21c Rust code was changed.
- **Evidence:** [`audio-capture-worklet-2026-09-04.txt`](../../evidence/e5-t21c/audio-capture-worklet-2026-09-04.txt),
  [`capture-worklet-2026-09-04.png`](../../evidence/e5-t21c/capture-worklet-2026-09-04.png).
- Findings: none. The task is verified.
