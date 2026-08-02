---
id: E3-T12c1
epic: 3
title: Virtio transport + device snapshot visitors
priority: 321.931
status: pending
depends_on: [E3-T12b]
estimate: S
risk: medium
capstone: false
---

## Goal
Give the production machine's virtio stack a complete, versioned snapshot section: the MMIO transport
lifecycle state and each device's queue ring position serialize and restore byte-identically, so a
resumed machine's virtio driver ⇄ device handshake continues exactly where it left off.

## Context
The resume container (E3-T12a) already carries CPU (E3-T12b) + RAM + CLINT + PLIC + UART + RTC; the
VIRTIO_BLK / VIRTIO_NET section tags are reserved-but-unsupported. The MMIO transport
(`dev/virtio/mmio.rs`) owns negotiated features, device status, and per-queue config (num +
desc/driver/device addresses + ready + notify); the device caches a `Virtqueue` whose
`last_avail_idx`/`used_idx` are the ring position — restore these wrong and the device replays or drops
descriptors. This ticket is the pure serialization (NOT quiesce — E3-T12c2 — and NOT disk coherence —
E3-T12c3), verifiable headlessly by round-trip like the CLINT/PLIC/CPU visitors.

## Deliverables
- `ComponentSnapshot` for the virtio-blk and virtio-net transport+device state (VIRTIO_BLK /
  VIRTIO_NET section tags), fixed-layout little-endian: negotiated features, device status, per-queue
  (num, desc, driver, device, ready) config, and the device ring indices (`last_avail_idx`,
  `used_idx`). Diagnostic-only fields (blk_log) are documented as not-snapshotted.
- `is_supported_section` includes the virtio tags; `Machine::save_resume`/`load_resume` compose them.
- All-or-nothing restore via the bounds-checked `resume::Reader` (a malformed payload leaves the
  device untouched).

## Acceptance criteria
- [ ] `make verify-E3-T12c1`: a virtio device round-trips through the container format byte-identically
  (transport features/status/queue-config + ring indices), native and wasm32.
- [ ] A truncated / over-long / bad-discriminant payload is a typed `BadComponentState`, device
  unchanged.
- [ ] After save→load into a dirty machine, the device re-serializes byte-identically to the snapshot
  (every field overwritten exactly once).

## Adversarial verification
Delete/reorder each serialized field, flip the ready bit, and restore into a device with a different
negotiated feature set. Any surviving mutant, partial mutation on error, or host-width-dependent
encoding refutes.

## Verification log
(empty)
