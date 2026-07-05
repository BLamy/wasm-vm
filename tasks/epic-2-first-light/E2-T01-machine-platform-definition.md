---
id: E2-T01
epic: 2
title: Define the "wasm-vm virt" machine platform — memory map, hart layout, boot contract
priority: 201
status: implemented
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

### 2026-07-05 — worker — implemented

**Commit:** (this PR's head — first Epic 2 task, branched off `main`)

**What landed.** `crates/core/src/platform.rs` — the authoritative `virt` map: `platform::virt`
constants for every base/size/IRQ, a `Region` type (overflow-safe `contains`/`overlaps`), and a
`Platform { dram_size }` whose `try_new`/`new` validate the whole map (no overlaps, page-aligned
device bases, DRAM fits the address space). `bus::mmap`, `dev::plic::PLIC_LEN`, and
`dev::clint::CLINT_LEN` now **re-export** from `platform::virt` — no duplicate addresses left
(acceptance #1). `docs/platform.md`: the map as a table, hart layout, boot contract, and the
explicit QEMU-`virt` deviation list. DRAM size is a construction parameter, never bus-baked
(acceptance #4).

**Evidence against the adversarial charter:**
- (1) *Dump QEMU's DTB and find a mismatch.* Dumped a real DTB —
  `qemu-system-riscv64 -machine virt -smp 1 -m 256M -machine dumpdtb=virt.dtb` then
  `dtc -I dtb -O dts` (QEMU 8.2.2, via the toolchain image). Every device we implement matches
  byte-for-byte: DRAM `0x8000_0000`; syscon `0x0010_0000`; rtc `0x0010_1000`/IRQ 11; CLINT
  `0x0200_0000`/64K; PLIC `0x0C00_0000`/6M, `riscv,ndev`=95; UART `0x1000_0000`/IRQ 10,
  clock 3 686 400; 8×virtio `0x1000_1000`+`0x1000` stride, IRQ 1–8. The only DTB entries with no
  counterpart (PCIe ECAM `0x3000_0000`, pflash `0x2000_0000`/`0x2200_0000`) are listed as
  deviations with rationale in `docs/platform.md` (acceptance #2).
- (2) *DRAM sized to collide, assertion misses it.* `overlap_and_overflow_are_caught` proves the
  detector fires: a crafted straddling pair overlaps, adjacent windows do not, and since DRAM
  sits above every device the only collision is address-space overflow — `try_new(0)` and
  `try_new(u64::MAX-DRAM_BASE+1)` both return `Err(DramSize)`.
- (3) *Boundary reads contradict the policy.* `region_boundaries` asserts first byte and last
  byte are in-range and one-past-end is out for every region; the documented open-bus/fault
  policy is the existing `SystemBus` behavior (Access fault outside mapped windows), which
  `attach` also enforces against the map.
- (4) *Doc IRQ table vs code.* `irq_and_virtio_layout` pins `UART0_IRQ=10`, `RTC_IRQ=11`, virtio
  slot `i`→IRQ `1+i` (slot 7 → IRQ 8, base `0x1000_8000`), matching the `docs/platform.md` table.

**Ran (native):** `cargo test -p wasm-vm-core --lib platform` → 4/4; `cargo clippy` clean;
`cargo test --workspace` green (the `mmap` re-export touches 60 call sites — no regressions).
**wasm32:** `crates/wasm/tests/platform.rs` mirrors the checks (`wasm-pack test --node`).
