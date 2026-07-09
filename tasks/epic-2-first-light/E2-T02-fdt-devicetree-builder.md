---
id: E2-T02
epic: 2
title: FDT/devicetree builder in Rust emitting a dtc-clean DTB for the virt platform
priority: 202
status: verified
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

### 2026-07-05 — worker — implemented

**What landed.** `crates/core/src/fdt.rs`: `FdtBuilder` (begin/end node, u32/u64/cells/str/
str-list/empty props, deduplicated strings block, 4-byte token alignment, balanced-tree assert)
+ `build_virt_dtb(platform, bootargs, initrd)` emitting the full virt tree — memory, cpus/cpu@0
(+riscv,cpu-intc phandle 1), soc{test+syscon, rtc, clint, plic (phandle 2, ndev from platform),
serial/ns16550a, 8×virtio_mmio}, root poweroff/reboot (syscon regmap phandle 3), /chosen
(bootargs, stdout-path, optional initrd) — **every address/size/IRQ from platform::virt only**.
`dtb_placement()`: top-of-DRAM, 8-byte aligned, None if it doesn't fit. `TIMEBASE_FREQ_HZ`
(10 MHz, QEMU-virt-matching) added to platform::virt as the single timebase source (acceptance
#3). mmu-type advertises "riscv,sv57" (machine implements Sv57 since E1-T28; task text predates
it). Golden `.dts` snapshot: `crates/core/tests/golden/virt.dts`.

**Evidence:**
- `dtc -I dtb -O dts` AND `dtc -f`: **zero errors, zero warnings** (acceptance #1). Round-1
  self-catch: poweroff/reboot under /soc drew simple_bus_reg warnings → moved to root (QEMU
  roots them too).
- Decompiled output shows correct phandle links (acceptance #2): clint interrupts-extended
  <1 3 1 7> (cpu-intc M-soft/M-timer), plic <1 11 1 9> (M-ext/S-ext) + phandle 2, uart/rtc/
  virtio interrupt-parent <2>, poweroff/reboot regmap <3>.
- Anti-stale-hardcoding test: different DRAM size → different blob; initrd props only when
  passed.
- Structure-walker test validates token alignment, nameoff bounds, balanced tree, FDT_END at
  exact end (charter alignment attack).
- Native `--lib fdt` 4/4; wasm32 mirror `crates/wasm/tests/fdt.rs` 3/3 (acceptance #4);
  fmt clean; clippy -D warnings clean.
- Kernel-parse check (charter final): deferred to E2-T04+ (earlycon boot) as the task notes.

### 2026-07-05 — verifier (cold critic) — CONFIRMED

All 8 attack angles executed, none refuted: (1) fresh-emitted blob through `dtc -f`,
dtb→dtb recompile, `-Wunit_address_vs_reg`, fdtdump — all RC=0 zero-warning (the only
warnings anywhere were 4 `interrupts_extended_property` notes on recompiling the DECOMPILED
dts, reproduced identically with QEMU's own dumped DTB → dtc artifact, not a blob defect);
(2) interrupt wiring structurally identical to QEMU virt modulo phandle numbering (clint
<intc 3, intc 7>, plic <intc 11, intc 9> + ndev 0x5f, uart 0xa / rtc 0xb / virtio 1..8 all
parented to PLIC, poweroff/reboot rooted with regmap→syscon), omissions all documented in
docs/platform.md 1–6; (3) corrupt-input probe: UART0_IRQ=13 → serial `interrupts = <0xd>`
(restored) — constants flow, no stale hardcoding; (4) alignment audit + critic's own
adversarial scratch test (odd-length names, 1/3/5-byte values, dedup, real reservation):
all 10 header fields exact, adversarial blob dtc -f clean; (5) placement arithmetic safe
(`(end-len)&!7` ≤ end-len; checked ops; None below DRAM_BASE; len==dram_size → DRAM_BASE);
(6) timebase single-source (0x989680 == TIMEBASE_FREQ_HZ; no other frequency hardcode);
(7) all suites pass (lib 4/4, wasm 3/3, fmt, clippy -D warnings); (8) snapshot regenerated
byte-identical. Kernel-boot deferral honestly logged. **Latent weakness fixed post-verdict:**
fixed node names (serial@…, clint@…) were literal strings while reg derived from constants —
now all unit addresses `format!` from platform::virt (blob byte-identical; dtc -f clean;
snapshot unchanged). Critic's placement note (dtb_placement doesn't take kernel/initrd
ranges) carried to E2-T04.
