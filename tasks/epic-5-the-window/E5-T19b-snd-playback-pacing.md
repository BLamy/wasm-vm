---
id: E5-T19b
epic: 5
title: virtio-snd paced playback and native audio sinks
priority: 519.2
status: verified
depends_on: [E5-T19a]
estimate: S
risk: medium
capstone: false
---

## Goal

Consume one playback txq period at the pace of an injectable audio clock and expose the samples
through a native-testable sink without draining the queue in a burst.

## Deliverables

- `AudioClock` injection and txq completion with computed `latency_bytes`.
- `AudioSink` trait with the default null sink and a scratch-directory `WavSink`.
- PREPARE/START/STOP/RELEASE integration for period delivery, including clean STOP/START resume.
- Native deterministic pacing, ramp-integrity, and sine-capture fixtures.

## Acceptance criteria

- [ ] Mock-clock runs at 0.5x, 1x, and 2x real time complete the same PCM at the corresponding
      wall-clock rate; arrival alone never completes an unripe period.
- [ ] A bit-exact ramp reaches `WavSink` sample-for-sample, with no dropped or duplicated period at
      normal playback or a STOP/START boundary.
- [ ] The native sine fixture captures eight seconds at 48 kHz with the expected FFT peak and no
      period-join discontinuity beyond 1 LSB; every completion reports bounded latency bytes.

## Adversarial verification

Hold the mock clock still while posting multiple txq descriptors, then advance it one period at a
time and inspect sink samples and used-ring order. Stop after a partial period, restart, and compare
the output against the reference ramp for duplicate or skipped samples.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

- Commit: `2d4e77ab034d734bc3487788c45ffc396a722c8d`.
- Commands: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core --test virtio_snd --quiet`; `cargo test -p wasm-vm-core --test virtio_snd_playback --quiet`; `cargo test -p wasm-vm-core --lib --quiet`; `cargo clippy -p wasm-vm-core --all-targets -- -D warnings`; `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release`; `cargo check -p wasm-vm-core --no-default-features`.
- Results: T19a suite 6/6 passed; playback suite 7/7 passed; core library 238/238 passed; clippy, release wasm, and the no-default-features check passed.
- Evidence: [`snd-playback-native-2026-09-03.txt`](../../evidence/e5-t19b/snd-playback-native-2026-09-03.txt), SHA-256 `cc4a766487f0eb1e1a85a9a4dc6f722368721d25214e57c4bd21028c45d40b65`.

The recorded native run proves that txq arrival alone leaves an unripe period pending, that the
injected monotonic clock controls 0.5x/1x/2x completion cadence, and that each completion writes a
bounded `latency_bytes` status and preserves FIFO used-ring order. It also exercises a bit-exact
STOP/START ramp through the native WAV sink, sink and stream-ID errors, RELEASE flushing, and an
eight-second 48 kHz 440 Hz sine capture with an FFT peak within 1 Hz and exact period joins.

### 2026-09-03 — verifier — VERDICT: verified

- Predictions: a held clock leaves all posted periods out of the used ring; advancing one period
  completes exactly one FIFO descriptor with bounded latency; STOP/START neither duplicates nor
  drops samples; sink and wrong-stream failures complete with `IO_ERR`.
- Observed: the optimized playback suite passed 7/7, and 25 consecutive debug invocations passed
  7/7 each. The WAV ramp was sample-for-sample, the sine FFT peak was within 1 Hz of 440 Hz, and
  the used-ring/status assertions held.
- Evidence: [`snd-playback-verifier-2026-09-03.txt`](../../evidence/e5-t19b/snd-playback-verifier-2026-09-03.txt),
  SHA-256 `174e80ffc97d6b387348d54ddcdd95a29293ccc5d3573e75007ed6b5272bbc01`.
- Findings: none. The task is verified.
