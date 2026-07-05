---
id: E2-T08
epic: 2
title: virtio-mmio v2 transport — register file, device lifecycle, feature negotiation
priority: 208
status: implemented
depends_on: [E2-T01]
estimate: M
capstone: false
---

## Goal
A reusable virtio-mmio (non-legacy, Version=2) transport implementing the full register
layout, status/reset lifecycle, and 64-bit feature negotiation, as a generic wrapper any
virtio device (blk now; net/gpu/input later) plugs into.

## Context
Virtio spec 1.2 §4.2.2 register map (LE, 4-byte access): `MagicValue`=0x74726976 @0x000,
`Version`=2 @0x004, `DeviceID` @0x008 (0 = empty slot — kernel must skip it silently),
`VendorID` @0x00c, `DeviceFeatures`/`DeviceFeaturesSel` @0x010/0x014,
`DriverFeatures`/`DriverFeaturesSel` @0x020/0x024, `QueueSel` @0x030, `QueueNumMax` @0x034,
`QueueNum` @0x038, `QueueReady` @0x044, `QueueNotify` @0x050, `InterruptStatus` @0x060
(bit 0 used-ring, bit 1 config change), `InterruptACK` @0x064, `Status` @0x070,
`QueueDescLow/High` @0x080/0x084, `QueueDriverLow/High` @0x090/0x094,
`QueueDeviceLow/High` @0x0a0/0x0a4, `ConfigGeneration` @0x0fc, config space @0x100+.
Status bits: ACKNOWLEDGE=1, DRIVER=2, DRIVER_OK=4, FEATURES_OK=8, NEEDS_RESET=64,
FAILED=128. Rules with teeth: always offer `VIRTIO_F_VERSION_1` (bit 32, via
FeaturesSel=1); if the driver writes FEATURES_OK with a feature set we didn't offer, leave
FEATURES_OK unset on readback; writing 0 to Status is full device reset (queues torn down,
InterruptStatus cleared); `QueueReady` gates ring address validity. Define trait
`VirtioDevice { device_id, features, config read/write, queue_notify, reset }` so E2-T11
is pure device logic. Populate slot 0 with a blk placeholder, slots 1–7 as DeviceID 0.

## Deliverables
- `crates/core/src/devices/virtio/mmio.rs` (transport) + `mod.rs` trait definitions.
- Register-level unit tests for the lifecycle: reset → ACKNOWLEDGE → DRIVER → features →
  FEATURES_OK → queue setup → DRIVER_OK, plus mid-lifecycle reset.
- E2-T02 DTB gains eight `virtio,mmio` nodes pointing at the slots.

## Acceptance criteria
- [ ] Feature negotiation rejects (FEATURES_OK stays clear) any unoffered bit and accepts
      the offered set; VERSION_1 always offered.
- [ ] Status write of 0 provably clears queue state, selected features, InterruptStatus.
- [ ] Empty slots return DeviceID 0 and tolerate arbitrary register writes.
- [ ] Linux boot log (from any later boot task) shows no `virtio-mmio` probe errors or
      warnings for empty slots.
- [ ] Unit tests green native and `wasm32`.

## Adversarial verification
Fuzz the register file: random 1/2/4/8-byte reads and writes at random offsets in
0x000–0x1FF for 10^6 ops — any panic or non-spec width behavior (spec says 4-byte; decide
and document sub-width policy) refutes. Lifecycle attack: set DRIVER_OK without
FEATURES_OK; write QueueReady=1 with desc addr 0; reset mid-request — device must degrade
to NEEDS_RESET or ignore per spec, never wedge. Diff `InterruptStatus`/`InterruptACK`
behavior against QEMU: ACK of a bit that re-arms mid-ACK must not lose interrupts (read
QEMU's implementation and replicate the race handling; a lost used-buffer notification
under stress in E2-T24 traces back here and refutes).

## Verification log

### 2026-07-05 — worker — implemented

**What landed.** `crates/core/src/dev/virtio/{mod,mmio}.rs` (dev/ is the codebase
convention): the `VirtioDevice` trait (device_id/features/config r-w/queue_notify/reset —
E2-T11 stays pure device logic) and the full §4.2.2 Version=2 register file with the
lifecycle rules that have teeth: VERSION_1 ALWAYS offered (FeaturesSel=1 bit 0);
FEATURES_OK stays clear on readback if the accepted set ⊄ offered; DRIVER_OK without
FEATURES_OK degrades to NEEDS_RESET (never wedges); Status=0 is FULL reset (queues,
selections, features, InterruptStatus, backend reset — verified mid-lifecycle);
InterruptACK is a MASK-clear (a bit re-armed between the driver read and its ACK
survives — the QEMU race contract); QueueReady gates; empty slots answer DeviceID 0 and
tolerate arbitrary writes. Documented width policy: registers are 4-byte-only (else
read 0/ignore); config space 0x100+ passes 1/2/4/8 to the backend.
`Machine::enable_virtio_slots(slot0)`: 8 slots at VIRTIO_BASE+i·stride wired to PLIC IRQ
1..=8 (slot 0 = blk placeholder, 1-7 empty), run loop mirrors each InterruptStatus level.
The 8 DTB nodes were already emitted by E2-T02 (deliverable pre-satisfied; addresses
match Platform::virtio_base by construction).

**Evidence:** unit 8/8 — happy lifecycle (reset→ACK→DRIVER→both feature banks→FEATURES_OK
→queue setup→DRIVER_OK, no NEEDS_RESET), unoffered-bit rejection + renegotiation,
mid-lifecycle Status=0 teardown, DRIVER_OK-without-FEATURES_OK→NEEDS_RESET+recovery,
empty-slot tolerance, ACK mask-clear race, and the CHARTER FUZZ: 10^6 random-width/offset
ops over 0x000–0x1FF on both a backed and an empty slot — no panic, sub-width policy
asserted per op. Integration 2/2: kernel-style probe of all 8 slots over the real bus;
slot-0 used-ring interrupt → PLIC IRQ 1 → S-mode claim → transport ACK → complete → line
settles. wasm32 mirror 1/1. Gates: fmt, clippy ±--all-features, both wasm legs 0 FAILED.
Linux-boot-log check (acceptance #4) explicitly deferred to the boot tasks per its own
wording.
