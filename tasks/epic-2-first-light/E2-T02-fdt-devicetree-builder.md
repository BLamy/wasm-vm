---
id: E2-T02
epic: 2
title: FDT/devicetree builder in Rust emitting a dtc-clean DTB for the virt platform
priority: 202
status: pending
depends_on: [E2-T01]
estimate: M
capstone: false
---

## Goal
A pure-Rust flattened-device-tree builder that serializes our platform definition into a
spec-valid DTB blob at a known RAM address, so the kernel discovers memory, CPUs, and every
device without a single hardcoded driver address.

## Context
Linux on RISC-V learns everything from the DTB passed in `a1`. DTB format (devicetree spec
v0.4): header magic `0xd00dfeed`, version 17, all fields big-endian; memory reservation
block; structure block of tokens `FDT_BEGIN_NODE`(0x1)/`FDT_END_NODE`(0x2)/`FDT_PROP`(0x3)/
`FDT_NOP`(0x4)/`FDT_END`(0x9) with 4-byte alignment; strings block for property names.
Required nodes: `/memory@80000000` (`device_type = "memory"`, `reg`), `/cpus` with
`timebase-frequency` matching our mtime rate, `/cpus/cpu@0` (`riscv,isa = "rv64imafdc"`,
`mmu-type = "riscv,sv39"`, `status = "okay"`) with a `riscv,cpu-intc` interrupt-controller
subnode and phandle, `/soc` containing `clint@2000000` (compatible `sifive,clint0`,
`interrupts-extended` referencing the cpu-intc for M/S timer+soft), `plic@c000000`
(compatible `sifive,plic-1.0.0`+`riscv,plic0`, `riscv,ndev`, `interrupts-extended` for
S-mode external), `uart@10000000` (`ns16550a`, `clock-frequency`, `interrupts = <10>`,
`interrupt-parent` = PLIC), eight `virtio_mmio@...` nodes, and `/chosen` with `bootargs`,
`stdout-path`, and (later) `linux,initrd-start/end`. Build against E2-T01 constants only.
Vendored-DTB fallback is acceptable for bring-up but the builder is the deliverable.

## Deliverables
- `crates/core/src/fdt.rs`: builder API (nodes, u32/u64/string/stringlist/phandle props),
  serializer, and `build_virt_dtb(platform, bootargs, initrd) -> Vec<u8>`.
- Loader that places the DTB in DRAM (8-byte aligned, outside kernel/initrd load ranges).
- Golden-blob unit test plus a checked-in decompiled `.dts` snapshot for review.

## Acceptance criteria
- [ ] `dtc -I dtb -O dts` round-trips our blob with zero errors and zero warnings.
- [ ] `fdtdump`/`dtc` shows all nodes above with correct phandle links (cpu-intc ← clint,
      cpu-intc ← plic, plic ← uart/virtio `interrupt-parent`).
- [ ] `timebase-frequency` equals the emulator's actual mtime tick rate (single source).
- [ ] Builder tests pass on native and `wasm32-unknown-unknown`.

## Adversarial verification
Run `dtc -I dtb -O dts -f` and treat any warning as refutation. Diff node-by-node against
`qemu-system-riscv64 -machine virt,dumpdtb=` output; unexplained structural differences in
interrupt wiring are refutations. Corrupt-input attack: change one platform constant and
confirm the DTB changes accordingly (no stale hardcoding). Verify alignment: property values
at non-4-byte-aligned offsets, or strings block offsets pointing past `size_dt_strings`,
refute. Finally, feed the blob to a real kernel with `earlycon=sbi` (once E2-T04 lands) —
an `OF: fdt:` parse error in dmesg is a refutation even if dtc was happy.

## Verification log
(empty)
