---
id: E5-T20
epic: 5
title: AudioWorklet playback — SAB ring buffer, underrun accounting, autoplay unlock
priority: 520
status: pending
depends_on: [E5-T19]
estimate: M
capstone: false
---

## Goal
Guest PCM reaches the speakers: an `AudioSink` implementation that pushes T19's frames
into a SharedArrayBuffer ring buffer consumed by an `AudioWorkletProcessor`, with the
audio clock fed back as the device's pacing source, measured latency, counted
underruns, and a clean autoplay-policy unlock flow.

## Context
Topology: VM worker (producer) → SAB ring (f32 interleaved stereo; convert S16→f32 at
the producer) → AudioWorklet `process()` (consumer, 128-frame quanta) on the audio
rendering thread. Indices via `Atomics` (u32 read/write counters in a header segment;
no locks in `process()` — it must never block). Ring size = latency budget: default
4096 frames (~85 ms @48k) with a documented tradeoff note; expose fill level.
Underruns: consumer finding < 128 frames outputs silence, bumps an underrun counter in
the SAB header, and the device reports `VIRTIO_SND_EVT_PCM_XRUN` to the guest when a
full period was missed. The AudioContext *is* the clock: a producer-side callback
derived from consumed-frames (Atomics.waitAsync on the read index or periodic poll)
drives T19's `AudioClock`, so guest pacing locks to the hardware DAC rate. Rate:
construct `AudioContext({sampleRate: 48000})` and advertise only 48k in PCM_INFO when
honored; if the context comes up at another rate, advertise that instead — no
resampler in v1 (documented). Autoplay: context starts suspended; first
click/keydown resumes it; UI shows a muted-until-interaction badge; pre-unlock PCM is
consumed-and-discarded at clock rate so the guest doesn't stall.

## Deliverables
- `web/src/audio/worklet.ts` (processor) + `web/src/audio/sink.ts` (producer/ring),
  ring logic shared + unit-tested in isolation (simulated consumer).
- Clock feedback wiring into the T19 device; latency estimate =
  ring fill + `AudioContext.outputLatency`/`baseLatency`, exposed in `vm.stats.audio`
  {latency_ms, underruns, fill}.
- Autoplay unlock UX on the main page + T08 chrome badge; pre-unlock discard path.
- `docs/audio.md`: architecture, ring sizing math, measured latencies per browser.

## Acceptance criteria
- [ ] `speaker-test -tsine` in the guest is audibly a clean tone; loopback capture of
      the browser tab (getDisplayMedia w/ audio, or OS loopback where available —
      method documented) shows a spectrally pure sine, no periodic clicks (gaps at
      ring wrap = the classic off-by-one).
- [ ] Reported latency ≤ 120 ms @48k default config in Chrome and Firefox (numbers
      recorded); ring fill stable ±1 period during steady playback (clock lock works).
- [ ] Zero underruns during 60 s of `aplay` with the tab foregrounded on the dev
      machine; underrun counter demonstrably increments under induced starvation
      (producer paused via test hook) and recovers without permanent distortion.
- [ ] Before first user gesture: no console errors, guest `aplay` completes at correct
      wall-clock pace (discard path), badge shown; after gesture: audio flows.
- [ ] Ring unit tests cover wrap, exact-fill, empty-read, and concurrent index races
      (loom or stress-loop).

## Adversarial verification
Measure, don't listen: record 30 s of tab audio during guest playback of a reference
ramp file and machine-diff for dropped/duplicated 128-frame blocks (spectral +
sample-level; a click every ring-length seconds refutes). Attack the clock loop:
background the tab (Chrome throttles timers but not the audio thread) — playback must
continue clean for 5 min; then hard-block the VM worker 500 ms (test hook) and verify
XRUN is reported to the guest and ALSA recovers (`aplay` finishes, no hung stream).
Force `AudioContext.sampleRate` 44100 via constructor rejection (some hardware) and
verify PCM_INFO follows reality. Two tabs of the VM playing simultaneously must not
share/corrupt rings. Any `process()` call taking > 128-frame budget (perf-marked)
under load refutes the no-blocking claim.

## Verification log
(empty)
