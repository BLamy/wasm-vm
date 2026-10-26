---
id: E9-T22q
epic: 9
title: Preserve virtio-GPU notification latches in exact checkpoints
priority: 524.9220297
status: in-progress
depends_on: [E9-T22n]
estimate: S
risk: high
capstone: false
---

## Goal

Make a restored exact GPU checkpoint resume the same queue-service schedule as
the recorded machine. A published descriptor with no pending QueueNotify must
stay unclaimed until the guest really notifies it.

## Boundary

The virtio-GPU exact result-checkpoint codec, its logical-state witness and
bounded replay proof. Keep ordinary 2D reconnect's wake-up policy, frozen
Omarchy assets, guest clock, 50M checkpoint cadence, workloads and performance
budgets unchanged. Existing checkpoints that omit the latches must not silently
claim exact replay fidelity.

## Acceptance criteria

- [ ] Persist and validate both control and cursor notification latches in the
  exact result checkpoint, restore them atomically, and bind their values into
  the logical state digest. Reject unsupported older exact GPU checkpoint
  versions explicitly rather than inventing a latch value.
- [ ] In deterministic native tests, a published but unnotified control
  descriptor remains unclaimed after restore; a notified control descriptor
  advances, and the equivalent cursor cases hold. Malformed latch fields fail
  without partial state changes. Ordinary 2D reconnect still rearms both queues.
- [ ] Prove built-WASM browser record/replay parity across a GPU checkpoint
  with an unnotified published descriptor, including the next witness and zero
  live replay egress. A fresh Daybreak verifier attacks the new format and one
  bounded notification race.

## Deterministic acceptance

`make verify-E9-T22q` at the frozen exact head.

## Adversarial verification

Try a control descriptor published without QueueNotify, an equivalent cursor
descriptor, both notifications just before capture, a corrupt latch byte, and
an older checkpoint with no latch bytes. Compare queue shadows and logical
digests at the first resumed witness; a merely matching initial checkpoint is
insufficient.

## Verification log

### 2026-10-26 — worker — reproduced before implementation

The authenticated E9-T22c cold-395 checkpoint at 19.8B has the same initial
witness as its original run. At the next 19.85B witness, replay's RAM and every
serialized component except `VIRTIO_GPU` match the independently reconstructed
cold-396 state. Original control queue shadow is `last_avail=452, used=452`;
replay is `last_avail=453, used=452`, with an extra pending
`CMD_RESOURCE_FLUSH` and no additional recorded receipt. The original digest is
`7967c3dde55a71e77ad05461c6a1b038286fd44fc89dfd909d12dea876974002`;
replay observes `5b2ea2cf90b5b05a3ef21fce4c48e9c37390f7c2bccc85678fd9d47ffd5d989c`.
See `target/evidence/e9-t22o-state-diff.json` (SHA-256
`b272b4c2ebaf82e28b68c4dd8e1146069a9f14b881da8e2e66ca003ddf3cc7f5`)
and the divergent browser report (SHA-256
`bebdbf1cf874a794cfc65f5656bdf042d8decf88e73a8fc3596b1f835492c41d`).
Fresh Daybreak inspection traced the extra dequeue to
`GpuState::commit_gpu_checkpoint` calling `snapshot::apply`, which sets both
`kicked` flags true; the exact checkpoint does not serialize their recorded
values. Browser console errors and external egress were zero.
