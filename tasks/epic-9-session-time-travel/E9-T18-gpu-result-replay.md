---
id: E9-T18
epic: 9
title: Replay guest-visible GPU results and completion ordering
priority: 524.918
status: pending
depends_on: [E9-T17, E9-T09, E9-T14]
estimate: S
risk: high
capstone: false
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

`make verify-E9-T18`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Change upload/draw/readback completion timing and host results, then replay. Corrupt one recorded readback and require divergence; inject a stale GPU reply after a seek.

## Verification log

(pending; no implementation or verification claim)
