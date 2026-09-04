# virtio-snd T19a control contract

The first sound device is virtio device ID 25. It exposes four queues in the standard order:
`controlq`, `eventq`, `txq`, and `rxq`. Its configuration is one output jack, one output PCM
stream, and one output channel map. T19a does not advertise optional PCM features; timing, sinks,
queue data, and XRUN events are owned by T19b--T19d.

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
