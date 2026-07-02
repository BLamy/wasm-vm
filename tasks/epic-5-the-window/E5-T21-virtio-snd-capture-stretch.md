---
id: E5-T21
epic: 5
title: Microphone capture stream (stretch) — rxq, getUserMedia, permission UX
priority: 521
status: pending
depends_on: [E5-T20]
estimate: M
capstone: false
---

## Goal
Config-gated microphone input: the virtio-snd device grows a capture PCM stream fed
from `getUserMedia` through a capture AudioWorklet and a second SAB ring, so `arecord`
in the guest records the real mic — off by default, honest about permission state, and
silent (not broken) when denied.

## Context
Stretch scope, deliberately after playback is solid. rxq mirrors txq with direction
flipped: guest posts empty buffers (`virtio_snd_pcm_xfer` header + space); device fills
with captured frames and completes with actual length + status. PCM_INFO grows a second
stream (direction INPUT, S16, mono-or-stereo, 48k). Host chain:
`getUserMedia({audio: {echoCancellation: false, ...}})` → `MediaStreamAudioSourceNode`
→ capture worklet (producer) → SAB ring → VM worker (consumer) → rxq completion at
clock pace. Permission lifecycle is the hard part: request lazily on guest PCM_START
of the capture stream (not page load); denial or `NotFoundError` → stream still runs,
delivering zeroed frames at the correct rate (ALSA apps behave; nothing hangs);
revocation mid-capture (`track.onended`/`mute`) → same silence fallback + eventq
notification. Feature flag `enable_mic` in VM config defaults false → capture stream
not even advertised in PCM_INFO (guests see a playback-only card).

## Deliverables
- rxq handling + capture stream state machine reusing T19's transition table.
- Capture worklet + ring (shared ring code from T20, tested for the reversed roles).
- Lazy permission request flow with UI indicator (live/denied/off), wired to
  PCM_START/STOP; silence-fallback paths for deny/revoke/no-device.
- `enable_mic` config gate at device-creation time.
- `docs/audio.md` capture section incl. privacy note (mic never opened before guest
  asks *and* flag enabled).

## Acceptance criteria
- [ ] Flag off: guest `arecord -l` shows no capture device; PCM_INFO fixture confirms
      one stream advertised.
- [ ] Flag on + permission granted: `arecord -f S16_LE -r48000 -c1 out.wav` for 5 s
      captures real audio (played tone loop-back test: FFT peak at the tone frequency).
- [ ] Permission denied: same arecord command completes with 5 s of digital silence in
      correct wall-clock time; no guest error, no host exception; indicator shows
      denied.
- [ ] Revoke mid-record (browser site settings): recording continues as silence, eventq
      carried an XRUN-or-notification, indicator flips; re-grant + new arecord works
      without reload.
- [ ] Mic is opened only after guest PCM_START (verified: no `getUserMedia` call in a
      session where the guest never records — checked via a spy hook).

## Adversarial verification
Attack the rate path: mic hardware at 44.1k while guest asks 48k — captured wav must be
duration-correct (resample or reject per the documented policy; a 10% fast/slow
recording refutes). Attack buffer accounting: arecord with absurd period sizes (16
bytes; 1 MB) — rxq completions must report actual lengths, never overrun the posted
buffer (guest memory canary around the buffer). Race permission: trigger PCM_START,
answer the permission prompt after 30 s — frames before grant must be silence, stream
timeline unbroken. Privacy refutation: run a full desktop session (T18) with flag on
but no guest recording and prove zero getUserMedia invocations and no mic indicator in
the browser chrome. Simultaneous full-duplex (aplay + arecord) for 60 s: both rings
stable, no cross-corruption.

## Verification log
(empty)
