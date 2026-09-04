---
id: E5-T20a
epic: 5
title: Audio SAB ring buffer protocol and deterministic indices
priority: 520.1
status: pending
depends_on: [E5-T19d]
estimate: S
risk: high
capstone: false
---

## Goal

Define the lock-free producer/consumer buffer that carries interleaved stereo f32 PCM between the
VM worker and an AudioWorklet without blocking the audio thread or losing ring-boundary samples.

## Boundary

This slice owns only the SharedArrayBuffer layout, atomic read/write counters, capacity arithmetic,
and deterministic test harness. AudioWorklet scheduling, AudioContext policy, and UI unlock belong to
the dependent slices.

## Deliverables

- `web/src/audio/ring.js` with a documented header and 4096-frame default stereo f32 capacity.
- SPSC producer/consumer helpers using `Atomics` for indices and fill accounting.
- Node tests covering wrap, exact-fill, empty-read, partial writes, and concurrent index races.
- `docs/audio.md` ring layout and capacity/latency math for the shared contract.

## Acceptance criteria

- [ ] Producer and consumer agree on the header offsets and never overwrite unread frames or read
      an unwritten frame, including wrap and exact-fill boundaries.
- [ ] A simulated consumer can drain 128-frame quanta while a producer wraps repeatedly with no
      dropped, duplicated, or reordered samples; fill is always in `[0, 4096]`.
- [ ] All index reads/writes use the declared atomic cells and the ring helpers allocate no work
      in the consumer path.

## Verification command

`node --test web/tests/audio-ring.test.mjs`

## Adversarial verification

Run independent producer/consumer schedules with fixed seeds, force write/read counters across
`2^32` wrap, and mutate capacity by one frame. Any stale index, overwrite, or non-atomic fill
calculation is a failure.

## Verification log

(empty)
