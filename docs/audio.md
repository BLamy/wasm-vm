# Browser audio ring contract (E5-T20a)

The browser audio path uses one `SharedArrayBuffer` for a single-producer/single-consumer
stereo PCM queue. The VM worker owns the producer endpoint and the `AudioWorkletProcessor` owns
the consumer endpoint. `web/src/audio/ring.js` is deliberately independent of AudioContext,
worklet scheduling, autoplay policy, and UI code so this contract can be tested deterministically
in Node before it is wired into the browser.

## Shared layout

The first 40 bytes are ten 32-bit header cells. All control-cell access goes through
`Atomics`; the payload samples are ordinary `Float32Array` values published by the atomic fill
update.

| Byte offset | Cell | Meaning |
| ---: | --- | --- |
| 0 | `WRITE_INDEX` | Monotonic producer frame counter, stored as an unsigned 32-bit value in an `Int32Array` cell. |
| 4 | `READ_INDEX` | Monotonic consumer frame counter, with the same representation. |
| 8 | `FILL_FRAMES` | Number of published frames currently available; always in `[0, capacity]`. |
| 12 | `CAPACITY_FRAMES` | Immutable frame capacity for this allocation. The default is 4096; endpoints reject a changed cell. |
| 16 | `WRITE_SLOT` | Current producer slot in `[0, capacity)`, atomically advanced with the write counter. |
| 20 | `READ_SLOT` | Current consumer slot in `[0, capacity)`, atomically advanced with the read counter. |
| 24 | `MAGIC` | `AURG` header marker. |
| 28 | `VERSION` | Layout version, currently `1`. |
| 32 | `CHANNELS` | Interleaved channel count, currently `2`. |
| 36 | `UNDERRUNS` | Atomic uint32 count of render quanta that did not have all requested frames. |

Samples begin at byte 40. Frame `n` is stored at
`40 + (slot * 2 + channel) * 4`, with channel 0 followed by channel 1. Capacity is intentionally
not required to be a power of two; the explicit slot cursors remain correct even when a logical
counter crosses `2^32` and the 4095-frame adversarial test protects that arithmetic.

The logical counters wrap modulo `2^32`. Because the queue is SPSC and capacity is much smaller
than `2^31`, the counter distance is unambiguous for every non-full state. `FILL_FRAMES`
distinguishes an empty ring from a full ring when the counters have the same low 32 bits.

## Publication and consumption

The producer first copies samples into the slots beginning at `WRITE_INDEX`, then publishes the
new write counter and atomically adds the number of frames to `FILL_FRAMES`:

```text
write payload → Atomics.store(WRITE_INDEX) → Atomics.add(FILL_FRAMES, +frames)
```

The consumer copies only the currently published frames, then advances its read counter and
atomically subtracts the consumed count:

```text
read payload → Atomics.store(READ_INDEX) → Atomics.sub(FILL_FRAMES, frames)
```

This ordering prevents a consumer from seeing a partially written frame and prevents a producer
from reusing a slot until the consumer has finished reading it. A full producer call returns the
number of frames accepted; callers retry the remainder after space becomes available. A consumer
always writes into caller-owned storage, which keeps the worklet `process()` path allocation-free.

At 48 kHz, 4096 stereo frames hold about 85.3 ms of PCM. At 44.1 kHz they hold about 92.9 ms.
The later sink/clock slice adds the device and scheduling margin; this ring's only latency
contribution is `fillFrames / sampleRate`.

## S16 sink and clock bridge (E5-T20c)

`web/src/audio/sink.js` implements the host side of T19's interleaved stereo S16 sink. Each sink
allocates its own ring, converts samples with the exact `sample / 32768` mapping, and returns a
bounded `{ acceptedFrames, droppedFrames, complete, sampleRateHz }` result instead of waiting when
the ring is full. Input at any rate other than the constructed context's actual `sampleRate` is
rejected; the bridge never inserts an implicit resampler.

Construction requests 48 kHz. If the browser honors it, the advertised PCM rate is 48 kHz. If the
constructor rejects the option or returns another rate, that actual context rate becomes the
advertised rate and callers must supply PCM at that rate. `connect()` loads the stable T20b
processor and passes only this sink's `SharedArrayBuffer` to its node.

`audioClockNowNs()` uses `AudioContext.currentTime` as the consumed-frame clock and falls back to
the atomic `READ_INDEX` delta at the negotiated rate. `vm.stats.audio` is refreshed on each push
or explicit `stats()` call with `latency_ms`, `underruns`, and `fill`; exposed `baseLatency` and
`outputLatency` values are included and added to the ring-fill latency. With the default 4096
frames at 48 kHz, a 10 ms base plus 20 ms output latency reports about 115.3 ms at full fill,
below the 120 ms acceptance budget.

## Autoplay unlock and suspended-context policy (E5-T20d)

`web/src/audio/autoplay.js` owns the browser's single gesture-to-resume transition. The main page
shows an accessible muted badge immediately, attaches one `click` and one `keydown` listener, and
shares one in-flight `AudioContext.resume()` promise between simultaneous gestures. A successful
resume hides the badge and cancels the suspended-context reader. A rejected resume keeps the badge
visible with an actionable retry message and leaves the ring reader/listeners usable.

While the context is locked, the policy's pre-unlock consumer uses the negotiated sample rate to
accumulate clock credit and consumes at most one 128-frame quantum per pump. Timer/background gaps
therefore cannot turn into a burst drain on foreground or unlock; the consumer reads into one
preallocated stereo scratch block. T20e connects the already-created sink/ring to the guest PCM
producer.

The focused Node/DOM proof is:

```sh
node --test web/tests/audio-autoplay.test.mjs
```

It covers the no-gesture state, clock-rate discard, a delayed/backgrounding gap, first click,
keydown/click coalescing, repeated gestures, resume rejection and retry, and listener cleanup.

## Deterministic proof

Run the focused contract suite with:

```sh
node --test web/tests/audio-ring.test.mjs
```

It exercises partial and exact fills, empty reads, repeated 128-frame drains across non-power-of-two
wraps, counters crossing `2^32`, a real Node worker producer racing the consumer, and a static
check that the consumer copies into preallocated storage without allocation helpers.
