---
id: E5-T19c
epic: 5
title: virtio-snd queue errors, XRUN events, and reset hardening
priority: 519.3
status: pending
depends_on: [E5-T19b]
estimate: S
risk: medium
capstone: false
---

## Goal

Make the playback queues total and recoverable: malformed descriptors complete with errors, audio
underruns become bounded eventq notifications, and reset/re-setup cannot leak or strand buffers.

## Deliverables

- `VIRTIO_SND_EVT_PCM_XRUN` eventq serialization and delivery at the stream boundary.
- Defensive txq parsing for header-only, zero-length PCM, undersized, and wrong-stream buffers.
- Queue-depth accounting, reset/re-setup handling, and native tests for descriptor reclamation.
- A stable control/data response fixture suitable for comparison with QEMU's virtio-snd layout.

## Acceptance criteria

- [ ] Each malformed or wrong-stream txq descriptor completes with the specified error status and
      the queue continues to accept a later valid period.
- [ ] A forced mock-clock underrun emits one bounded XRUN event per missed period without unbounded
      event or sample buffering.
- [ ] Fifty STOP/RELEASE/reset/re-setup cycles return every descriptor and preserve the sink and
      stream state; queue depth does not monotonically shrink.

## Adversarial verification

Byte-dribble and truncate txq headers, mix invalid stream IDs with valid periods, fill the eventq
while the guest is not polling, and reset between kicks. Verify used-ring progress, error status,
event count, and a clean subsequent playback period.

## Verification log

(empty)
