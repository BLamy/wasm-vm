# virtio-snd T19a control contract

The first sound device is virtio device ID 25. It exposes four queues in the standard order:
`controlq`, `eventq`, `txq`, and `rxq`. Its configuration is one output jack, one output PCM
stream, and one output channel map. The PCM advertises `VIRTIO_SND_PCM_F_EVT_XRUNS`; timing, sinks,
queue data, and recovery are implemented by T19b--T19d.

The PCM stream accepts interleaved stereo S16 frames at only 44.1 kHz or 48 kHz. `buffer_bytes`
and `period_bytes` are non-zero, frame-aligned, `period_bytes` divides `buffer_bytes`, and the
buffer is no larger than 16 MiB. Rejected `SET_PARAMS` requests leave the stream and its previous
parameters unchanged.

## Control state oracle

The six columns are `PCM_INFO`, `SET_PARAMS`, `PREPARE`, `START`, `STOP`, and `RELEASE`. `OK`
means the request is accepted; `BAD_MSG` means the request is rejected and the state is unchanged.
`PCM_INFO` is a stateless query and is therefore `OK` in every row.

| Current state | PCM_INFO | SET_PARAMS | PREPARE | START | STOP | RELEASE |
| --- | --- | --- | --- | --- | --- | --- |
| RELEASED | OK | OK → SET_PARAMS | BAD_MSG | BAD_MSG | BAD_MSG | BAD_MSG |
| SET_PARAMS | OK | BAD_MSG | OK → PREPARED | BAD_MSG | BAD_MSG | BAD_MSG |
| PREPARED | OK | BAD_MSG | BAD_MSG | OK → RUNNING | BAD_MSG | OK → RELEASED |
| RUNNING | OK | BAD_MSG | BAD_MSG | BAD_MSG | OK → STOPPED | BAD_MSG |
| STOPPED | OK | BAD_MSG | BAD_MSG | OK → RUNNING | BAD_MSG | OK → RELEASED |

The executable copy of this table is [`PCM_TRANSITION_ORACLE`](../crates/core/src/dev/virtio/snd/mod.rs)
and the exhaustive native test is `crates/core/tests/virtio_snd.rs`. Query responses use the
specification's fixed item layouts, with zero-filled padding and exactly one item per supported
selector. Unknown selectors return `NOT_SUPP`; malformed known requests return `BAD_MSG`.

## T19b paced playback

The output `txq` is serviced through [`service`](../crates/core/src/dev/virtio/snd/mod.rs) with an
injected [`AudioClock`](../crates/core/src/dev/virtio/snd/mod.rs) and [`AudioSink`](../crates/core/src/dev/virtio/snd/mod.rs).
Each readable transfer is copied as interleaved stereo S16 samples, held until its sample-duration
deadline, then delivered once to the sink and completed with the eight-byte `PcmStatus`. Its
`latency_bytes` is the remaining queued PCM after that completion; an unripe transfer never enters
the used ring merely because it arrived.

`NullSink` is the host-independent default. Native tests can use `WavSink::create` in a repository
scratch directory and call `finish` to write a finalized PCM16 stereo RIFF header. STOP retains
pending transfers, while the next START reschedules them from the new clock position so a pending
period is delivered exactly once. RELEASE completes retained transfers with `IO_ERR` rather than
silently dropping their descriptors.

The deterministic playback fixture is `crates/core/tests/virtio_snd_playback.rs`: it checks held
clock pacing at 0.5x/1x/2x, exact used-ring order and status latency, a STOP/START ramp capture, and
an eight-second 48 kHz sine capture whose FFT peak is within 1 Hz of 440 Hz.

## T19c queue recovery and XRUN events

`SndEvent::pcm_xrun(stream_id)` serializes the eight-byte `virtio_snd_event` record with event type
`0x111` and the stream identifier in `data`. The running stream counts each elapsed period with no
pending txq transfer as one XRUN. Events are retained in a 256-record bounded queue while eventq is
not polled; excess notifications are counted as dropped rather than growing host memory.

Malformed but structurally valid txq transfers (truncated/header-only, zero PCM, a non-period-sized
PCM payload, undersized status, or the wrong stream) are completed with `IO_ERR`; the ring then
continues to the next descriptor. Short or wrongly-directed eventq buffers are returned with
`used.len = 0` while the event remains pending for a later writable buffer. Reset clears both
queue views and pending host state, and a changed transport queue layout causes a fresh ring view to
be built on the next service boundary.
