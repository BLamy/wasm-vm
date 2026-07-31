---
id: E3-T12c
epic: 3
title: Virtio quiesce and overlay-generation snapshot coherence
priority: 321.93
status: pending
depends_on: [E3-T12b, E3-T08]
estimate: S
risk: high
capstone: false
---

## Goal
Create a coherent snapshot boundary across virtio devices, guest page cache, and persistent overlay
generation by draining or refusing in-flight work before serialization.

## Deliverables
- Snapshot visitors for remaining stateful virtio/platform devices used by the production machine.
- A bounded quiesce protocol proving no in-flight descriptor, cache pin, or unacknowledged write
  crosses the snapshot point.
- Persisted overlay generation binding and typed refusal for stale base/generation pairs.

## Acceptance criteria
- [ ] `make verify-E3-T12c` proves quiesce reaches an empty in-flight set or deterministically
  refuses, and a restored machine neither replays nor loses a completed request.
- [ ] Snapshot restore against a changed base hash or overlay generation fails before machine state
  mutation.
- [ ] `sync` followed by snapshot/restore leaves `fsck.ext4 -n` clean.

## Adversarial verification
Snapshot during every virtqueue transition and a guest copy, alter the overlay after snapshot, and
restore the same snapshot twice. Any disk/page-cache divergence, duplicated completion, stale-overlay
resume, or unbounded quiesce wait refutes.

## Verification log
(empty)
