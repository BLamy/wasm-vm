---
id: E9-T18
epic: 9
title: Replay guest-visible GPU results and completion ordering
priority: 524.918
status: cancelled
depends_on: [E9-T17, E9-T09, E9-T14]
estimate: L
risk: high
capstone: false
decomposed_into: [E9-T18a, E9-T18b, E9-T18c]
---

## Goal

Prevent GPU execution from introducing unrecorded guest-visible differences during replay.

## Boundary

The graphics nondeterminism adapter: readback bytes, query/fence/error results, shared-memory writes and completion order. Separate exact guest state from presentation pixels across different physical GPUs.

## Acceptance criteria

- [ ] Record every admitted guest-visible result at its event boundary and replay exact bytes/order, including pending jobs across a keyframe.
- [ ] An actual guest GPU workload produces matching replay state and documented physical rendering witnesses; do not assume command replay alone gives cross-GPU bit-identical pixels.
- [ ] Missing results, unsupported profiles, context loss and stale resource epochs produce explicit outcomes without live result substitution or stranded fences.

## Deterministic acceptance

This planning container is replaced by ordered S slices E9-T18a, E9-T18b and
E9-T18c. Their acceptance commands and final integration must satisfy every
criterion above. This parent is not an implemented or verified replay claim.

## Execution slices

1. **E9-T18a** owns native guest-visible result admission: exact scatter bytes,
   query/error/fence envelopes and completion order at recorded event boundaries.
2. **E9-T18b** persists genuine guest-pending work, owned results/cursors and
   validated fresh ownership across coherent keyframes.
3. **E9-T18c** connects the admitted native boundary to the real Wasm GPU bridge,
   durable sessions and hardware-browser replay proof. Consumers depend on this
   final slice, which requires both predecessors to be verified.

The original first criterion is owned jointly by a/b/c, the physical guest and
rendering criterion by c, and explicit missing/corrupt/stale/context/profile
outcomes by all three at their boundaries. No criterion is dropped. The T01
clock/performance contract stays unchanged; authenticated T17 checkpoints are
not silently converted into exact GPU recordings.

## Adversarial verification

Change upload/draw/readback completion timing and host results, then replay. Corrupt one recorded readback and require divergence; inject a stale GPU reply after a seek.

## Verification log

### 2026-10-21 — planning decomposition

Source inspection found three separate boundaries: host DMA/completion admission,
a native codec that currently refuses all pending GPU work, and the Wasm/durable
profile integration. The existing 32 MiB production exchange limit also exceeds
the device adapter's sub-1 MiB inline payload limit. Treating these as one S task
would hide independent persistence and callback-ownership claims. This container
is cancelled in favor of the ordered replacements; no runtime implementation is
claimed here. Downstream replay consumers are gated on E9-T18c.
