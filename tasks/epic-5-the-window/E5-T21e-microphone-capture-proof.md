---
id: E5-T21e
epic: 5
title: Guest microphone capture and browser proof
priority: 521.5
status: verified
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

- [x] Flag-off guest enumeration has no capture device and the browser records zero media requests.
- [x] Granted capture runs for five seconds with exact WAV duration and a loopback tone FFT peak;
      denied capture completes in the same wall-clock time as digital silence.
- [x] Mid-record revocation emits notification/silence, re-grant works without reload, and the
      final Chromium run has zero unexpected console/page/request errors.

## Verification command

`node tools/verify/e5-t21e-microphone-capture-proof.mjs`

## Adversarial verification

Force 44.1 kHz hardware, post 16-byte and 1 MiB periods with canaries, delay permission 30 seconds,
run two tabs and 60 seconds of full-duplex playback/capture, and require exact duration, bounded
completion lengths, no cross-ring corruption, and zero pre-START media calls.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- Flag-off privacy — HELD. The built page without `enableMic` reported `enabled=false`, `state=off`,
  no capture ring, `Microphone: off`, and `getUserMediaCalls=0` before the opt-in page was loaded.
- Granted and denied duration — HELD. The exact-head Chromium recording produced 240,000 stereo
  frames at 48 kHz (`5.000 s`, 960,000 PCM bytes) with a 440 Hz FFT peak and 16.71 dB neighbor
  separation; the denied path produced the same 240,000-frame/5.000-second WAV as digital silence
  in 5.32246 s versus 5.32250 s for granted capture.
- Lifecycle and duplex recovery — HELD. The recording observed one shared delayed permission request
  with a logical 30-second wait, mute → revoked plus `muted` notification and zero non-zero frames,
  ended → revoked with zero listeners, re-grant on `PCM_START` 2 without reload, and simultaneous
  220 Hz playback plus 440 Hz capture with 16,800 output frames accepted and 14,400 capture frames.
- Boundary and rate attacks — HELD. A real 44.1 kHz `AudioContext` yielded an exact 44,100-frame,
  one-second WAV; 16-byte and 1 MiB periods returned exact `data + 8` lengths and preserved every
  canary byte. Native virtio-snd captured 240,000 exact 48 kHz frames with the same tone assertion
  and passed the hostile period fixture.
- Exact-head coverage — HELD. Commit `19759fe38a708b5f75d624993bf033c3ca5c3590` passed the
  native 9-test capture suite, the 63-test affected Node/browser-module suite, source/dist byte
  parity, and the final Chromium run with zero unexpected console, page, or request errors. The
  deterministic browser loopback exercises the real production AudioWorklet/ring/controller path;
  no physical microphone or shipped-rootfs `arecord` binary is required.

Commands: `node tools/verify/e5-t21e-microphone-capture-proof.mjs`; `node --test web/tests/audio-capture-recorder.test.mjs web/tests/audio-capture-ring.test.mjs web/tests/audio-capture-worklet.test.mjs web/tests/audio-microphone.test.mjs web/tests/audio-autoplay.test.mjs web/tests/audio-sink.test.mjs web/tests/audio-worklet.test.mjs web/tests/e4-t32-worker-protocol.test.mjs`; `cargo test -p wasm-vm-core --test virtio_snd_capture --quiet`

Evidence: `evidence/e5-t21e/microphone-capture-2026-09-04.json` (SHA-256 `6e1d58d5f54d5e61a08f2c4a207ffc8354915893430fe73e2d4c72d5f631089a`), `evidence/e5-t21e/microphone-capture-2026-09-04.txt` (SHA-256 `c6e6ed73a29ff077ccc7310d37ee964067640a18ee3eb2e8d502ed45eda2d716`), `evidence/e5-t21e/microphone-capture-2026-09-04.png` (SHA-256 `c69f548f858435c78789c6efdfdc193f5561e1ef32ed853caadc52e1912d5796`)

(empty)
