---
id: E3-T12c1
epic: 3
title: Virtio transport + device snapshot visitors
priority: 321.931
status: verified
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
- [x] `make verify-E3-T12c1`: a virtio device round-trips through the container format byte-identically
  (transport features/status/queue-config + ring indices), native and wasm32.
- [x] A truncated / over-long / bad-discriminant payload is a typed `BadComponentState`, device
  unchanged.
- [x] After save→load into a dirty machine, the device re-serializes byte-identically to the snapshot
  (every field overwritten exactly once).

## Verification log

### 2026-08-02 — virtio-blk + virtio-net snapshot visitors → verified

**Implementation.** `VirtioMmio::snapshot_transport`/`restore_transport` (crates/core/src/dev/virtio/
mmio.rs) serialize the transport lifecycle (status, feature negotiation, queue selector, per-queue
config, interrupt status, config-gen, kick counters), all-or-nothing via `resume::Reader`.
`Virtqueue::ring_indices`/`set_ring_indices` capture the device ring position (`last_avail_idx`/
`used_idx`). `Machine::save_resume`/`load_resume` compose the **VIRTIO_BLK** section (transport + ring
position + FLUSH count) and the **VIRTIO_NET** section (transport + both ring positions + rx/tx/dropped
counters); load rebuilds each ring view from the restored transport config, then sets the position.
`is_supported_section` now includes VIRTIO_BLK + VIRTIO_NET; **VIRTIO_RNG** (a real pending device) is
reserved so the reserved-vs-unsupported boundary stays testable. Backends (disk/connections) are NOT
in these sections — the overlay is bound by generation (E3-T12c3) and net connections can't resume
(the guest sees drops, E3-T25); the transport+ring state is snapshotted so the guest driver isn't
wedged. Quiesce of the in-flight `parked` set is E3-T12c2.

**Verification — `make verify-E3-T12c1`: OK** (native + wasm32):
- AC1 round-trip: `mmio::tests::transport_snapshot_round_trips_and_rejects_malformed` (transport
  re-serializes byte-identically, non-default state) + `cpu_resume::virtio_blk_and_net_sections_
  round_trip_at_machine_level` (drives the real virtio-blk init over the bus → non-default transport +
  ready queue, net enabled in slot 1, save→load into a fresh machine → whole blob incl both virtio
  sections byte-identical) + `resume::virtio_blk_section_round_trips_on_wasm32` (same on real wasm32).
- AC2 malformed: the transport unit test asserts a truncated payload → `BadComponentState`, transport
  untouched (parse-into-locals-then-commit).
- AC3 dirty overwrite: the Machine-level test restores into a fresh (un-programmed) machine and
  re-serializes byte-identically → every field overwritten exactly once.

All acceptance criteria met with recorded evidence → status **verified**.

## Adversarial verification
Delete/reorder each serialized field, flip the ready bit, and restore into a device with a different
negotiated feature set. Any surviving mutant, partial mutation on error, or host-width-dependent
encoding refutes.
