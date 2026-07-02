---
id: E2-T01
epic: 2
title: Define the "wasm-vm virt" machine platform — memory map, hart layout, boot contract
priority: 201
status: pending
depends_on: [E1]
estimate: S
capstone: false
---

## Goal
A single authoritative platform definition (Rust constants + doc) that fixes the physical
memory map, device placement, IRQ numbers, hart layout, and kernel entry contract for the
machine Linux will boot on — mirroring QEMU's `virt` machine wherever that buys us free
compatibility with existing kernel configs and debugging tools.

## Context
Every Epic 2 device task needs agreed addresses before it starts. QEMU `virt` is the de facto
RISC-V Linux reference platform; matching its layout means our DTB, kernel `.config`, and
boot behavior can be differentially compared against `qemu-system-riscv64 -machine virt` at
every step. Proposed map (confirm each against QEMU source `hw/riscv/virt.c`):
DRAM at `0x8000_0000` (default 256 MiB, configurable), CLINT at `0x0200_0000` (64 KiB),
PLIC at `0x0c00_0000` (`0x60_0000`), UART0 at `0x1000_0000` (IRQ 10), 8 virtio-mmio slots at
`0x1000_1000`–`0x1000_8000` stride `0x1000` (IRQs 1–8), goldfish-rtc at `0x0010_1000`
(IRQ 11), syscon test/poweroff device at `0x0010_0000`. Boot contract: single hart (hart 0)
for Epic 2, entry per firmware decision (E2-T03) with `a0 = hartid`, `a1 = DTB physical
address`. This task only defines and wires the map; devices themselves come later.

## Deliverables
- `crates/core/src/platform/virt.rs` (or equivalent): typed constants for every base
  address, size, and IRQ; a `Platform` struct that registers regions on the Epic 0/1 bus.
- Bus-level overlap/alignment assertions (debug builds panic on overlapping regions).
- `docs/platform.md`: the map as a table, hart layout, reset/entry contract, and an explicit
  list of deviations from QEMU `virt` with rationale for each.
- Unit test that instantiates the platform and probes every region boundary (first/last byte
  in-range, one byte past → bus fault or open-bus behavior, documented which).

## Acceptance criteria
- [ ] All Epic 2 address/IRQ constants exist in one module; no magic numbers elsewhere.
- [ ] `qemu-system-riscv64 -machine virt,dumpdtb=virt.dtb` decompiled with `dtc -I dtb -O dts`
      has been diffed against our map; every deviation is listed in `docs/platform.md`.
- [ ] Unit tests cover region boundaries and overlap detection; pass native and `wasm32`.
- [ ] DRAM size is a construction parameter, not a constant baked into the bus.

## Adversarial verification
Refute by finding an inconsistency: (1) dump QEMU's virt DTB yourself and find an address,
size, or IRQ our doc claims matches but doesn't; (2) construct a platform with DRAM sized
so it would collide with a device region and show the assertion misses it; (3) issue reads
at `PLIC_BASE - 1`, `UART_BASE + 8`, and the last byte of DRAM and show behavior contradicts
the documented open-bus/fault policy; (4) check the doc's IRQ table against what E2-T02 will
encode — any mismatch between constants and doc is a refutation.

## Verification log
(empty)
