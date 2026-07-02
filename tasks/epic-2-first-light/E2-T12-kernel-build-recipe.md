---
id: E2-T12
epic: 2
title: Pinned riscv64 kernel build — documented .config, Docker cross-compile, artifacts
priority: 212
status: pending
depends_on: [E2-T01]
estimate: M
capstone: false
---

## Goal
A reproducible, one-command kernel build producing a pinned riscv64 `Image` configured for
our virt-like machine, with the `.config` treated as a reviewed source artifact — so "which
kernel are we booting" is never a variable while debugging the emulator.

## Context
Pin a M/LTS version (e.g., 6.6.x; record the exact tag and sha256 of the tarball). Start
from `defconfig` and enforce (via a checked-in fragment merged with
`scripts/kconfig/merge_config.sh`): `CONFIG_64BIT`, `CONFIG_MMU`, `CONFIG_SOC_VIRT`,
`CONFIG_NONPORTABLE=n`, `CONFIG_RISCV_SBI_V01=y` (legacy console fallback),
`CONFIG_SERIAL_8250=y`, `CONFIG_SERIAL_8250_CONSOLE=y`, `CONFIG_SERIAL_OF_PLATFORM=y`,
`CONFIG_VIRTIO_MMIO=y`, `CONFIG_VIRTIO_BLK=y`, `CONFIG_EXT4_FS=y`, `CONFIG_DEVTMPFS=y` +
`_MOUNT`, `CONFIG_BLK_DEV_INITRD=y`, `CONFIG_RTC_DRV_GOLDFISH=y`, `CONFIG_RTC_HCTOSYS=y`,
`CONFIG_POWER_RESET_SYSCON=y`, `CONFIG_POWER_RESET_SYSCON_POWEROFF=y`, and debug aids
`CONFIG_PRINTK_TIME=y`, `CONFIG_IKCONFIG_PROC=y`. Everything built-in — **no modules**
(`CONFIG_MODULES=n`) so no initramfs/module coupling. Disable what we don't emulate yet to
cut boot probing (PCI, networking can stay for Epic 3 but note boot-time cost). Build in
Docker (`riscv64-linux-gnu-` cross toolchain, e.g. Debian's `gcc-riscv64-linux-gnu`) so
host toolchains don't matter. Artifacts: `arch/riscv/boot/Image`, `System.map`, `.config`
→ `releases/kernel/<version>/` with a `SHA256SUMS` file.

## Deliverables
- `tools/build-kernel.sh` + `tools/kernel.Dockerfile` + `configs/wasm-vm.config` fragment.
- `releases/kernel/<version>/{Image,System.map,config,SHA256SUMS}` checked in (or LFS).
- `docs/kernel.md`: why each fragment symbol exists, how to bump the version.

## Acceptance criteria
- [ ] `tools/build-kernel.sh` from a clean clone on a machine with only Docker produces an
      Image whose sha256 matches `SHA256SUMS` (document any timestamp-related caveats and
      neutralize them: `KBUILD_BUILD_TIMESTAMP`, `KBUILD_BUILD_USER/HOST`).
- [ ] The built Image boots on `qemu-system-riscv64 -M virt -nographic -kernel Image` to
      the point of "VFS: Cannot open root device" panic (proves the artifact is sane
      independent of our emulator).
- [ ] `zcat /proc/config.gz`-visible config matches the fragment (IKCONFIG check scripted).
- [ ] No `CONFIG_MODULES`; `grep =m` on the final config is empty.

## Adversarial verification
Run the build twice on different hosts (or container UIDs) and diff Image hashes — a
mismatch refutes reproducibility. Delete Docker's cache and rebuild — network-fetched,
unpinned inputs (apt packages without versions are tolerable if documented; an unpinned
kernel tarball is not) refute. Boot the Image under QEMU with our E2-T02 DTB
(`-machine virt -dtb ours.dtb`) — earlycon output stopping earlier than with QEMU's own
DTB indicates config/DTB mismatch worth logging. Verify every fragment symbol survived
`make olddefconfig` (symbols silently dropped by dependency resolution refute the doc's
claims — check `CONFIG_RTC_DRV_GOLDFISH` and `CONFIG_POWER_RESET_SYSCON` especially).

## Verification log
(empty)
