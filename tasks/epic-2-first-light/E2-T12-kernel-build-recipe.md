---
id: E2-T12
epic: 2
title: Pinned riscv64 kernel build — documented .config, Docker cross-compile, artifacts
priority: 212
status: implemented
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

### 2026-07-05 — worker — implemented

**What landed.** `tools/build-kernel.sh` (one command, Docker-only host) +
`tools/kernel.Dockerfile` (Debian bookworm + `gcc-riscv64-linux-gnu` + host gcc) +
`configs/wasm-vm.config` (riscv defconfig fragment, merged via merge_config.sh) →
`releases/kernel/6.6.63/{Image,System.map,config,SHA256SUMS}` (checked in). `docs/kernel.md`
documents every fragment symbol + the version-bump procedure. `tools/check-kernel-config.sh`
(fragment-honored + no-modules audit) and `tools/boot-test-kernel.sh` (QEMU sanity).

Linux **6.6.63** (6.6 LTS), tarball pinned by sha256 (fetch aborts on mismatch). Build runs
in a container-native Docker VOLUME — Docker Desktop's macOS bind mount (virtiofs) can't
survive a parallel kernel build's open-file churn ("Too many open files" even at
nofile=1M), so only the tarball comes in read-only and only the 3 artifacts go out; `cat >`
avoids cp's fallocate/deallocate quirk on the output mount.

**Acceptance evidence:**
- #1 reproducible: built TWICE, `SHA256SUMS` byte-identical (Image
  `0d66ca2b…`). Levers: pinned tarball + fixed `KBUILD_BUILD_TIMESTAMP` +
  fixed `KBUILD_BUILD_USER/HOST`.
- #2 boots on stock qemu: `qemu-system-riscv64 -M virt -nographic -kernel Image` reaches
  `Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)` (banner
  "Linux version 6.6.63", "Hardware name: riscv-virtio,qemu (DT)", ext4 in the bdev list) —
  artifact sane independent of our emulator. (Found+fixed: defconfig omits
  `SERIAL_EARLYCON_RISCV_SBI`/`HVC_RISCV_SBI`, so a serial-less early boot is SILENT; added
  to the fragment — it's exactly the SBI console channel our E2-T04 legacy console
  implements.)
- #3 config matches fragment: `check-kernel-config.sh` green (every `=y` present; every `=n`
  present as `# ... is not set`). IKCONFIG_PROC=y so `/proc/config.gz` is auditable at
  runtime.
- #4 no modules: `grep =m` on the final config is empty (MODULES=n).
