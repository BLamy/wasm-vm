# The "wasm-vm virt" machine platform (E2-T01)

The authoritative physical memory map, IRQ assignments, hart layout, and boot contract for the
machine Linux boots on. The single source of truth in code is
[`crates/core/src/platform.rs`](../crates/core/src/platform.rs) (`platform::virt`); `bus::mmap`,
`dev::plic`, and `dev::clint` re-export from it, so there are no duplicate addresses.

The layout mirrors QEMU's `virt` board so our DTB (E2-T02), kernel `.config` (E2-T12), and boot
behavior can be differentially compared against `qemu-system-riscv64 -machine virt` at every
step.

## How this table was verified

Dumped and decompiled a real QEMU `virt` DTB (QEMU 8.2.2, single hart, 256 MiB) and diffed it
against `platform::virt`:

```sh
qemu-system-riscv64 -machine virt -smp 1 -m 256M -nographic -machine dumpdtb=virt.dtb
dtc -I dtb -O dts virt.dtb            # decompile to source
```

## Physical memory map

| Region        | Base          | Size        | IRQ | QEMU `virt`? | Constant(s) |
|---------------|---------------|-------------|-----|--------------|-------------|
| syscon (test) | `0x0010_0000` | `0x1000`    | —   | ✅ match      | `TEST_BASE` / `TEST_LEN` |
| goldfish-rtc  | `0x0010_1000` | `0x1000`    | 11  | ✅ match      | `RTC_BASE` / `RTC_LEN` / `RTC_IRQ` |
| CLINT         | `0x0200_0000` | `0x1_0000`  | —   | ✅ match      | `CLINT_BASE` / `CLINT_LEN` |
| PLIC          | `0x0C00_0000` | `0x60_0000` | —   | ✅ match      | `PLIC_BASE` / `PLIC_LEN` (`riscv,ndev` = 95 → `PLIC_NDEV`) |
| UART0 (16550) | `0x1000_0000` | `0x100`     | 10  | ✅ match      | `UART0_BASE` / `UART0_LEN` / `UART0_IRQ` |
| virtio-mmio 0 | `0x1000_1000` | `0x1000`    | 1   | ✅ match      | `VIRTIO_BASE` (+ `i·VIRTIO_STRIDE`) / `VIRTIO_IRQ_BASE + i` |
| virtio-mmio 1 | `0x1000_2000` | `0x1000`    | 2   | ✅ match      | … |
| … (slots 2–6) | `0x1000_3000`–`0x1000_7000` | `0x1000` | 3–7 | ✅ match | … |
| virtio-mmio 7 | `0x1000_8000` | `0x1000`    | 8   | ✅ match      | … |
| DRAM          | `0x8000_0000` | *param*     | —   | ✅ base match | `DRAM_BASE`, size = construction parameter |

UART reference clock (`clock-frequency`) = 3 686 400 Hz (`UART_CLOCK_HZ`), matching QEMU virt.

## DRAM layout at boot (E2-T13)

The emulator loads three payloads into DRAM before entering S-mode; the DTB's `/chosen`
`linux,initrd-start`/`linux,initrd-end` (u64) tell the kernel where the initramfs is, and
the initrd region sits **above** the kernel and **below** the DTB so nothing is clobbered
before the kernel unpacks it.

```
0x8000_0000  ┌────────────────────────── DRAM_BASE
             │ (firmware/low reserved)
0x8020_0000  ├────────────────────────── KERNEL_BASE  ── kernel Image loads here
             │ kernel image + BSS + early alloc ...
             │
     ↑ initrd├────────────────────────── initrd_start (8-byte aligned, above the kernel)
             │ initramfs.cpio.gz          initrd_end
             │
     ↓ DTB   ├────────────────────────── dtb (top of DRAM − blob − DTB_SLACK, see fdt.rs)
             │ device tree blob
0x8000_0000  └────────────────────────── + dram_size  (top of DRAM)
   +size
```

The DTB placement (`fdt::dtb_placement`) already reserves 16 KiB of headroom above the
blob (E2-T03); initrd placement mirrors that discipline and is documented in the loader.

## Hart layout & boot contract

- **Harts:** 1 (hart 0) for Epic 2 (`NUM_HARTS`); SMP arrives in Epic 6. `BOOT_HART = 0`.
- **Entry contract** (per the E2-T03 firmware decision): the boot hart enters the payload with
  `a0 = hartid` and `a1 = DTB physical address` — the standard RISC-V Linux/SBI convention.
- **Reset:** as defined by E1-T01 machine reset (PC at the firmware/entry address; M-mode).

## Deviations from QEMU `virt` (and why)

Every difference between our map and the dumped QEMU DTB, with rationale:

1. **No PCIe ECAM** (QEMU: `pci@30000000`, `0x3000_0000`, 256 MiB). We drive devices over
   virtio-mmio, not virtio-pci, for Epic 2; a PCIe host bridge is out of scope. Kernels built
   with our `.config` omit the PCI host controller.
2. **No pflash / cfi-flash** (QEMU: two 32 MiB banks at `0x2000_0000` and `0x2200_0000`).
   QEMU uses flash to hold firmware; our firmware strategy (E2-T03) loads the payload directly,
   so no flash device is modelled.
3. **DRAM default size = 128 MiB**, not QEMU's `-m` default. DRAM size is a *construction
   parameter* (`Platform::new(dram_size)` / `Ram::new(size)`), never baked into the bus, so
   this is only the default; callers pass whatever size they need.
4. **Reserved-memory / mmode-resv nodes** QEMU emits for OpenSBI are firmware-specific and are
   materialised by E2-T02 (DTB builder) / E2-T03 (firmware), not by the base map.
5. **No fw-cfg** (QEMU: `fw-cfg@10100000`, `qemu,fw-cfg-mmio`, base `0x1010_0000`, len `0x18`).
   fw-cfg is QEMU's host↔guest configuration channel (used by its BIOS/UEFI paths to fetch
   kernels, ACPI tables, etc.). Our firmware strategy (E2-T03) loads the payload directly, so
   there is nothing to fetch; Linux boots on `virt` without it.
6. **No platform-bus** (QEMU: `platform-bus@4000000`, `simple-bus`, base `0x0400_0000`, 32 MiB).
   A QEMU window for dynamically instantiated sysbus devices (`-device` on the command line);
   we have no dynamic-device mechanism, and nothing in the Epic 2 boot path binds to it.

(Non-map note: QEMU's `cpus` node advertises `timebase-frequency` = 10 MHz; our timebase is the
CLINT `mtime` tick documented by E1-T12/E2-T02 — the DTB builder, not the memory map, owns it.)

Everything else (every base address, window size, and IRQ for the devices we implement) matches
QEMU `virt` byte-for-byte, verified against the dump above.

## Invariants (enforced in code)

`Platform::try_new(dram_size)` validates the whole map and is the proof a `Platform` value
carries:

- **No overlaps.** Every pair of regions (all devices + DRAM) is checked disjoint,
  overflow-safe. A colliding map is rejected (`PlatformError::Overlap`).
- **Page-aligned device bases.** Every device window sits on a 4 KiB-aligned base
  (`PlatformError::Misaligned`). Lengths may be sub-page (UART is `0x100`).
- **DRAM fits.** `dram_size > 0` and `DRAM_BASE + dram_size` does not overflow the 64-bit
  address space (`PlatformError::DramSize`) — the only way DRAM, sitting above every device,
  can collide.

`Platform::new` panics on any violation, so an inconsistent map can never boot the machine.
The `SystemBus::attach` path (E0-T04) independently rejects windows that overlap RAM or each
other, so a device mis-registered against the map fails loudly at attach time too.
