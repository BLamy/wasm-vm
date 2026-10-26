---
id: E9-T22r
epic: 9
title: Record an exact-format cold Omarchy first-frame prefix
priority: 524.92202975
status: pending
depends_on: [E9-T22q]
estimate: S
risk: medium
capstone: false
---

## Goal

Replace the old 20B cold prefix whose GPU notification latches were omitted
from every exact checkpoint. Retain a fresh original-cold recording with the
corrected format through the first real nonblank desktop frame, or a bounded
failure frontier.

## Boundary

One fresh browser recording of the same pinned Omarchy image, kernel,
bootargs, renderer, service-file setup, ICount/64 clock and 50M checkpoint
cadence. This is a diagnostic prefix, not the full C workload or its probe;
it cannot qualify timing. Stop at the first real desktop frame or a declared
finite upper bound with resource preflight. Preserve the old graph as evidence.

## Acceptance criteria

- [ ] Before starting, calculate a finite guest-transition, host-wall, quota
  and free-disk budget from the old 20B run's measured rate and 9.65 GiB
  storage, with explicit safety headroom. Refuse a run that cannot fit.
- [ ] Record the original cold guest in a fresh browser context. Retain the
  new exact GPU checkpoint format, every 50M witness and physical graph, and
  first nonblank frame plus guest session/process proof if it appears. If the
  cap is reached first, retain an exact failure frontier.
- [ ] Authenticate the saved graph and replay at least the last two adjacent
  checkpoint windows to matching witnesses with zero live egress. A fresh
  Daybreak critic checks source pins, latch witness fidelity and frame evidence.

## Deterministic acceptance

`make verify-E9-T22r` at a frozen exact head.

## Adversarial verification

Swap a checkpoint's latch byte, remove an unrequested RAM-delta chunk, alter a
physical renderer epoch, and misclassify a compositor process as visible pixels.
Reject reusing the old v2 graph or a warm-start boot as the new prefix.

## Verification log

### 2026-10-26 — worker — necessity established

The old 20B graph's original GPU control shadow stayed `last_avail=used=452`
from cold-395 through cold-399, while guest RAM's control avail index was
`579` in every one of those five checkpoints. Its cursor queue was `0/0`
with RAM avail index `0`. The physical objects and sparse-RAM ancestry were
SHA-256 checked while extracting those ring values. The 127 published but
unserviced control descriptors make the old v2 checkpoint's missing
QueueNotify latch behaviorally decisive. Forced rearm consumed one of them in
the independently observed replay at 19.85B. A guessed latch value cannot
authenticate an exact continuation, so the calibration task needs a newly
recorded source prefix after E9-T22q lands.
