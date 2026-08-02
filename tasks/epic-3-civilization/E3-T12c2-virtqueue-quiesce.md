---
id: E3-T12c2
epic: 3
title: Bounded virtqueue quiesce before snapshot
priority: 321.932
status: pending
depends_on: [E3-T12c1, E3-T08]
estimate: S
risk: high
capstone: false
---

## Goal
Guarantee a coherent snapshot boundary: no in-flight virtqueue descriptor, parked async request, or
unacknowledged durable write is left half-processed across a snapshot. The machine either reaches an
empty in-flight set or refuses the snapshot with a typed error — never serializes a torn state.

## Context
virtio-blk parks chains awaiting an async event (`ParkReason::Chunk` a base-chunk fetch,
`Flush` a durability barrier, `Write` a persistent-write commit). A snapshot taken while a chain is
parked would, on restore, either double-complete it (re-pushed to the used ring) or lose it. The
quiesce drains what can be drained synchronously (a chunk already resident, a flush/write the backend
can commit now) and, for anything that cannot be drained within a bounded number of service passes,
REFUSES the snapshot (typed `NotQuiesced`) so the caller retries or falls back — it never snapshots a
non-empty `parked` set.

## Deliverables
- A `quiesce()` on the machine/blk device: bounded-iteration drain of `parked`; returns Ok(empty) or a
  typed refusal with the residual reason.
- `Machine::save_resume` calls quiesce first and refuses to serialize a non-empty in-flight set.
- Fault-injectable parked states for the test (a chain parked on a never-arriving chunk → bounded
  refusal, not an infinite wait).

## Acceptance criteria
- [ ] `make verify-E3-T12c2`: with a chain parked on a resolvable event, quiesce drains to empty and
  the snapshot proceeds; with a chain parked on an unresolvable event, quiesce refuses within a bounded
  pass count (no unbounded wait) and the snapshot is refused, not torn.
- [ ] A completed request is neither replayed nor lost across quiesce→snapshot→restore (the used-ring
  index is exact).
- [ ] `save_resume` on a non-quiesced machine returns the typed refusal and does not emit a blob.

## Adversarial verification
Snapshot at every virtqueue transition (mid-pop, post-exec pre-publish, parked). Force a parked chain
on a chunk that never arrives and assert the quiesce is bounded and refuses. Any torn boundary,
duplicated completion, lost request, or unbounded quiesce refutes.

## Verification log
(empty)
