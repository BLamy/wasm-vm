---
id: E5-T19
epic: 5
title: virtio-snd device — control plane and PCM playback stream machine
priority: 519
status: pending
depends_on: [E5-T05]
estimate: L
capstone: false
---

## Goal
A virtio-snd device (virtio ID 25) with a spec-correct control plane and one playback
PCM stream whose full state machine (SET_PARAMS → PREPARE → START → STOP → RELEASE)
works against the Linux `snd_virtio` driver, delivering PCM frames to a host `AudioSink`
trait — natively testable by dumping WAV files, before any WebAudio exists.

## Context
virtio-snd (virtio v1.2 §5.14) has four queues: controlq, eventq, txq (playback), rxq
(capture — T21). Control requests we must serve: `VIRTIO_SND_R_JACK_INFO` (1 output
jack), `R_PCM_INFO` (1 output stream: formats bitmap = S16 only, rates bitmap = 44.1k +
48k, channels_min/max = 2/2), `R_CHMAP_INFO` (FL/FR), `R_PCM_SET_PARAMS`
(buffer_bytes, period_bytes, format, rate — validate against advertised caps),
`R_PCM_PREPARE/START/STOP/RELEASE`. Playback data: guest posts txq buffers
(`virtio_snd_pcm_xfer { stream_id }` header + period_bytes of frames); device consumes
at the *pacing of the audio clock* and completes each with `virtio_snd_pcm_status
{ status, latency_bytes }` — completing too fast makes ALSA spin, too slow starves the
guest mixer. In native tests the clock is a mock; the sink gets
`push(frames: &[i16], rate)`. State machine strictness matters: Linux issues
SET_PARAMS in RELEASED only; wrong-state requests get `VIRTIO_SND_S_BAD_MSG`.

## Deliverables
- `crates/vm-core/src/devices/snd/mod.rs`: control-plane dispatch + per-stream state
  machine as an explicit enum with a transition table (unit-tested exhaustively).
- txq consumption paced by an injectable `AudioClock` trait; per-period completion with
  computed `latency_bytes`.
- `AudioSink` trait + native `WavSink` writing `/tmp`-free artifacts into the scratch
  dir for tests; null sink default.
- eventq wiring for `VIRTIO_SND_EVT_PCM_XRUN` (device-side underrun report, used by
  T20).
- Fixture: control-request/response byte captures diffed against QEMU virtio-snd.

## Acceptance criteria
- [ ] Exhaustive state-machine test: all 6 requests x all 5 states — every cell matches
      the spec'd OK/BAD_MSG table (table checked in as the test oracle).
- [ ] Guest `aplay -l` lists the card; `speaker-test -c2 -tsine -l1 -r48000` (serial,
      headless) completes; the native WavSink capture contains a clean 8-second sine
      (FFT peak within 1 Hz of expected, no discontinuities > 1 LSB at period joins).
- [ ] `aplay short.wav` completes in wall-clock ≈ duration ±10% under the mock clock
      driven at real-time rate (pacing works; not a burst-drain).
- [ ] SET_PARAMS with rate 96000 (unadvertised) returns BAD_MSG and stream stays usable.
- [ ] STOP mid-playback then START resumes without stale buffers (no repeated period).

## Adversarial verification
Refute pacing: drive the mock clock at 0.5x and 2x real-time — guest-side `aplay`
must correspondingly stretch/compress wall time; a device that completes txq buffers on
arrival regardless of clock refutes. Refute frame integrity: play a bit-exact ramp
pattern wav and compare the WavSink output sample-for-sample — any dropped/duplicated
period at STOP/START/RELEASE boundaries refutes. Attack the state machine from the real
guest: `kill -9` an `aplay` mid-stream (ALSA sends STOP+RELEASE) then immediately start
a new one, 50x in a loop — any BAD_MSG to a legal sequence, stuck stream, or txq
descriptor leak (queue depth monotonically shrinking) refutes. Malformed txq buffer
(header only, zero PCM bytes; wrong stream_id) must complete with error status, not
stall the queue.

## Verification log
(empty)
