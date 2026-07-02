---
id: E0-T04
epic: 0
title: MMIO dispatch layer routing bus windows to memory-mapped devices
priority: 4
status: pending
depends_on: [E0-T03]
estimate: S
capstone: false
---

## Goal
A `SystemBus` that implements `Bus` by routing each access either to guest RAM or to a
registered `MmioDevice` by physical address window, with unmapped holes returning
`BusFault::Access` — the single seam through which every future device (UART, CLINT, PLIC,
virtio-mmio) attaches.

## Context
Architectural bet #3 is "virtio everywhere"; that only works if device attachment is a
one-line registration. The stub console (E0-T12) is the first client. The hot path
(RAM access during fetch/execute) must not regress measurably — this dispatch sits under
every single instruction.

## Deliverables
- `crates/core/src/mmio.rs`: `MmioDevice` trait with width-explicit
  `read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault>` / `write(...)`;
  `Width` enum {B1, B2, B4, B8}.
- `SystemBus { ram, devices: Vec<(Range<u64>, Box<dyn MmioDevice>)> }` with
  `attach(base, len, dev)` that rejects overlapping windows (including overlap with the
  DRAM range) at registration time with a typed error.
- A `RecordingDevice` test double capturing (offset, width, value) sequences.
- Unit tests native + `wasm-bindgen-test` mirror.

## Acceptance criteria
- [ ] Accesses inside a window reach the device with the correct *offset* (not absolute
      address), width, and value; accesses in `DRAM_BASE..end` reach RAM unchanged.
- [ ] Access to an unmapped hole (e.g. `0x2000_0000`) returns `Access` at every width.
- [ ] An access straddling a window edge (e.g. `load64` at `window_end - 4`) returns
      `Access` and does not partially invoke the device.
- [ ] `attach` returns an error for windows overlapping RAM or another device.
- [ ] Suite passes natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Attach a device at `DRAM_BASE - 4` with length 8 — registration must fail; if it
succeeds, demonstrate the resulting aliasing and refute. (2) Issue a `load64` whose first
byte is the last byte of a device window — confirm via `RecordingDevice` that the device
saw *zero* calls. (3) Register 100 devices and measure RAM-path throughput vs. bare `Ram`
with a quick criterion micro-bench — >10% regression on the RAM path refutes the hot-path
claim. (4) Check width forwarding: a `store16` must arrive as B2, not two B1 calls.
(5) Attempt zero-length windows and `base + len` overflow (`base = u64::MAX - 2, len = 8`)
— panics refute.

## Verification log
(empty)
