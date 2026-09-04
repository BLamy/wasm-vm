---
id: E5-T20a
epic: 5
title: Audio SAB ring buffer protocol and deterministic indices
priority: 520.1
status: verified
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

### 2026-09-03 — worker — implemented

- Commit: `6eb6d9da3ad5ec5ae46f9b4a9be10fd02e65264d`.
- Exact-head acceptance: `node --test web/tests/audio-ring.test.mjs` — 7 passed, 0 failed.
- Adversarial repeat: the same suite ran 20 additional times with `--test-reporter=dot` — all
  runs exited 0. The suite covers exact-fill/backpressure, empty and partial reads, repeated
  128-frame drains across a 4095-frame ring, a 2^32 counter wrap on a 7-frame ring, capacity
  metadata mutation fail-closed behavior, a real 30,000-frame Node worker producer/consumer race,
  and the consumer allocation guard.
- Packaging: `make web-dist` succeeded; `cmp web/src/audio/ring.js web/dist/src/audio/ring.js`
  passed. Evidence transcript:
  `evidence/e5-t20a/audio-ring-native-2026-09-03.txt` (SHA-256
  `e61899dab8ec713e1d35c9d762cdb6a121cd12a0c00aab1bb7932f1aa0eacfbe`).

The recording demonstrates that the exact-head SPSC contract publishes only complete stereo f32
frames, applies atomic fill/index publication and consumption, preserves order through repeated
non-power-of-two wraps and uint32 counter rollover, rejects a capacity mismatch without silent
endpoint divergence, and remains correct under an actual concurrent Node worker schedule. The
deployable source copy is byte-identical to the tested module.

### 2026-09-03 — verifier — VERDICT: verified

- **Publication and ordering — HELD.** Predicted that the producer would publish complete stereo
  frames only after payload writes and that the consumer would never read beyond published fill.
  The focused suite held this through empty, partial, exact-fill, backpressure, repeated 128-frame
  drains, and the 30,000-frame worker race; see
  [`audio-ring-verifier-2026-09-03.txt`](../../evidence/e5-t20a/audio-ring-verifier-2026-09-03.txt).
- **Wrap arithmetic — HELD.** Predicted that explicit slot cursors would preserve order for
  capacities that do not divide 2^32. The independent fixed schedule held for capacities 1, 2, 3,
  5, 7, 31, and 4095, each seeded at `0xfffffff0` and run for 300 schedules.
- **Hardening and coverage — HELD.** The promoted test covers malformed header cells, capacity
  mutation, invalid caller storage, and invalid frame ranges; the consumer source guard confirms
  no allocation helpers. No changed runtime hunk is dead; the impossible oversized-allocation
  guard is waived as defensive `Number.isSafeInteger` protection.
- **Reproducibility — HELD.** The acceptance suite passed from a scrubbed environment and in 20
  repeated runs. The tested source and deployable `web/dist` copy have identical SHA-256 digests.
- Evidence: [`audio-ring-verifier-2026-09-03.txt`](../../evidence/e5-t20a/audio-ring-verifier-2026-09-03.txt),
  SHA-256 `5145dea53fc4832ba7b6efefd80242fa780fc538b64ac110c84b1bfbf82ae834`.
- Findings: none. The task is verified.
