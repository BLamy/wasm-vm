---
id: E5-T21e
epic: 5
title: Guest microphone capture and browser proof
priority: 521.5
status: in-progress
depends_on: [E5-T21d]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the complete opt-in microphone path: guest `arecord` receives real or deterministic loopback
audio through rxq, and denied/revoked permission remains a paced, recoverable silence stream.

## Boundary

This slice owns the end-to-end guest/browser harness, WAV duration/sample/FFT assertions, privacy
proof, docs/audio.md capture section, roadmap evidence, and checked-in browser evidence. It may not
redesign the core rxq, ring, or permission state machine.

## Deliverables

- A bounded Chromium proof for flag-off privacy, granted capture, denied silence, revocation, retry,
  44.1-to-48 kHz duration truth, absurd guest periods, and full-duplex playback/capture.
- Machine-readable capture/digest output, screenshot/transcript, and exact source/dist hashes.
- `docs/audio.md` privacy and capture-method notes plus the live/verified roadmap update.

## Acceptance criteria

- [ ] Flag-off guest enumeration has no capture device and the browser records zero media requests.
- [ ] Granted capture runs for five seconds with exact WAV duration and a loopback tone FFT peak;
      denied capture completes in the same wall-clock time as digital silence.
- [ ] Mid-record revocation emits notification/silence, re-grant works without reload, and the
      final Chromium run has zero unexpected console/page/request errors.

## Verification command

`node tools/verify/e5-t21e-microphone-capture-proof.mjs`

## Adversarial verification

Force 44.1 kHz hardware, post 16-byte and 1 MiB periods with canaries, delay permission 30 seconds,
run two tabs and 60 seconds of full-duplex playback/capture, and require exact duration, bounded
completion lengths, no cross-ring corruption, and zero pre-START media calls.

## Verification log

(empty)
