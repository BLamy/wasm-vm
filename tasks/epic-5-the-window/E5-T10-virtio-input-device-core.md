---
id: E5-T10
epic: 5
title: virtio-input device core — config space, eventq/statusq, event injection API
priority: 510
status: pending
depends_on: [E5-T05]
estimate: M
capstone: false
---

## Goal
A reusable virtio-input device (virtio ID 18) implementing the select/subsel config
space and the eventq/statusq queue pair, with a host-side `inject(type, code, value)`
API and bounded buffering — the shared chassis that T11's keyboard and T14's pointers
are instances of.

## Context
virtio-input's config space is a query protocol, not a struct: the guest writes
`select`/`subsel` bytes and reads back `size` + a 128-byte union. We must serve
`VIRTIO_INPUT_CFG_ID_NAME (0x01)`, `ID_SERIAL (0x02)`, `ID_DEVIDS (0x03)`
(bustype=0x06 BUS_VIRTUAL, vendor/product/version), `PROP_BITS (0x10)`,
`EV_BITS (0x11)` (subsel = EV_KEY/EV_REL/EV_ABS/EV_LED/EV_SYN; payload is the evdev
capability bitmap), and `ABS_INFO (0x12)` (subsel = axis; min/max/fuzz/flat/res).
Events are 8-byte `virtio_input_event { le16 type, le16 code, le32 value }` written
into guest-supplied eventq buffers; statusq carries guest→device output events (LEDs).
When the guest hasn't posted buffers yet (early boot), events must be buffered or
dropped by policy, never block the VM loop. Reference: virtio v1.2 §5.8; Linux
`drivers/virtio/virtio_input.c`; `include/uapi/linux/input-event-codes.h`.

## Deliverables
- `crates/vm-core/src/devices/input/mod.rs`: `VirtioInput` built from a declarative
  `InputDeviceSpec { name, devids, ev_bits, abs_info, .. }`.
- Config space state machine with correct `size` semantics (0 for unsupported selects).
- `inject_event()` + `sync()` (appends EV_SYN/SYN_REPORT) host API; ring of pending
  events (default 256) with drop-oldest-full-frame policy and a dropped-events counter.
- statusq handler surfacing `virtio_input_event`s to a host callback (LEDs for T11).
- Native tests: config queries for a fixture spec byte-compared against a QEMU
  virtio-keyboard capture; event delivery through hand-built queues.

## Acceptance criteria
- [ ] Config-space read of ID_NAME/EV_BITS/ABS_INFO for a test spec matches the QEMU
      fixture byte-for-byte (excluding name string, compared separately).
- [ ] Unsupported select returns size=0 and reads-as-zero payload.
- [ ] 1000 injected events with the guest draining slowly: no VM-loop block; drops occur
      in whole EV_SYN-delimited frames only (never a torn key event), counter accurate.
- [ ] Events cross the queue in ≤ 8-byte little-endian layout (wasm32 + native identical).
- [ ] statusq events reach the host callback with correct type/code/value.

## Adversarial verification
Refute frame integrity: force the drop path with a 3-buffer eventq while injecting
key-down/up bursts, then drain and machine-check the stream invariant "every EV_KEY
frame terminated by SYN_REPORT; no down without matching eventual up-or-drop-of-both".
A torn frame (down delivered, up dropped) is a refutation — it becomes T13's stuck key.
Attack config space: hammer select/subsel writes concurrently with reads (guest driver
does write-then-read; ensure no torn union). Boot the real T05 kernel with this device
attached and prove `virtio_input` binds and `/dev/input/event0` appears with the spec'd
capabilities in `/proc/bus/input/devices` — any capability-bitmap mismatch refutes.

## Verification log
(empty)
