---
id: E3-T12c2
epic: 3
title: Bounded virtqueue quiesce before snapshot
priority: 321.932
status: verified
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
- [x] `make verify-E3-T12c2`: with a chain parked on a resolvable event, quiesce drains to empty and
  the snapshot proceeds; with a chain parked on an unresolvable event, quiesce refuses within a bounded
  pass count (no unbounded wait) and the snapshot is refused, not torn.
- [x] A completed request is neither replayed nor lost across quiesce→snapshot→restore (the used-ring
  index is exact).
- [x] `save_resume` on a non-quiesced machine returns the typed refusal and does not emit a blob.

## Adversarial verification
Snapshot at every virtqueue transition (mid-pop, post-exec pre-publish, parked). Force a parked chain
on a chunk that never arrives and assert the quiesce is bounded and refuses. Any torn boundary,
duplicated completion, lost request, or unbounded quiesce refutes.

## Verification log
- 2026-08-02 — `make verify-E3-T12c2`: **OK** (native + wasm32). Implementation:
  - `Machine::quiesce()` (`crates/core/src/lib.rs`) — bounded-iteration (`QUIESCE_MAX_PASSES = 16`)
    drain of the virtio-blk parked set via re-`service`; returns `Ok(())` when the in-flight set is
    empty (checked BEFORE any service pass, so an already-coherent machine is never mutated) or the
    typed `SnapshotError::NotQuiesced { reason, in_flight }` when the budget is exhausted. No blk ⇒
    trivially quiesced. Never waits unboundedly.
  - `Machine::save_resume()` now returns `Result<Vec<u8>, SnapshotError>` and calls `quiesce()` first
    — a non-quiesced machine returns the typed refusal and emits no blob (AC3).
  - `SnapshotError::NotQuiesced` + `QuiesceReason { Chunk, Flush, Write }` in `resume.rs`;
    `BlkState::residual()` maps the head parked reason + count (build-agnostic mirror of `ParkReason`).
  - Test `crates/core/tests/virtio_blk_quiesce.rs` (3 cases): resolvable FLUSH drains to empty then
    snapshots and round-trips the used-ring index exactly into a fresh machine (AC1-resolvable + AC2);
    unresolvable never-arriving chunk refuses within the bounded budget with `NotQuiesced{Chunk}`, no
    partial completion (AC1-unresolvable + AC3); empty in-flight set is a no-op quiesce.
  - Existing `cpu_resume` / wasm `resume` round-trips updated for the fallible `save_resume` and still
    green (the quiesce gate does not regress blk/net/CPU section round-trips).
