---
id: E2-T13
epic: 2
title: Static busybox initramfs — minimal userland for first boot
priority: 213
status: pending
depends_on: [E2-T12]
estimate: M
capstone: false
---

## Goal
A tiny initramfs (static busybox + `/init`) that gives us a userland the moment the kernel
can execute one — decoupling "does the kernel boot" from the much bigger ext4/virtio-blk/
Alpine surface, so E2-T15 has a minimal success target.

## Context
Build busybox (pin a version, e.g. 1.36.x) with `CONFIG_STATIC=y` using the same Docker
riscv64 cross toolchain as E2-T12. Initramfs is a newc-format cpio archive, gzipped:
`find . | cpio -o -H newc | gzip`. Layout: `/init` (executable shell script: mount `proc`,
`sysfs`, `devtmpfs` on `/dev`; `exec setsid cttyhack sh` so job control and ^C work —
without cttyhack there is no controlling TTY and every interactive test misleads),
`/bin/busybox` + applet symlinks, empty `/proc` `/sys` `/dev` `/tmp`. Delivery mechanism:
loaded by the emulator at a documented physical address with `linux,initrd-start` /
`linux,initrd-end` written into `/chosen` by the E2-T02 builder (keep the alternative —
`CONFIG_INITRAMFS_SOURCE` baked into the Image — as a documented fallback for debugging).
The initrd region must be reserved so the kernel doesn't clobber it before unpacking
(placement above the kernel image, below DTB; document the layout diagram in
`docs/platform.md`).

## Deliverables
- `tools/build-initramfs.sh` + `tools/initramfs/init` script; artifacts to
  `releases/initramfs/` with SHA256SUMS.
- E2-T02 builder support for `linux,initrd-start/end` (u64 values) + loader placement.
- `docs/platform.md` updated with the RAM layout: kernel @0x8020_0000, initrd, DTB.

## Acceptance criteria
- [ ] `file` on the binary reports "ELF 64-bit LSB executable, UCB RISC-V, ... statically
      linked"; `cpio -t` lists the archive without warnings.
- [ ] Boots under `qemu-system-riscv64 -M virt -kernel Image -initrd initramfs.cpio.gz` to
      an interactive busybox `sh` with working `ps`, `mount`, `vi` (busybox applets).
- [ ] `/init` runs as PID 1; `echo $$` in the spawned shell is not 1 (setsid/cttyhack
      worked); ^C at the prompt does not kill PID 1.
- [ ] Rebuild from clean clone is byte-identical (cpio mtimes/order normalized:
      `--reproducible` flags or explicit sort + touch).

## Adversarial verification
Boot it under QEMU and press ^C at the shell within 2s of prompt — if the system dies,
the controlling-TTY claim is refuted. Corrupt one byte mid-archive and confirm the kernel
reports "Initramfs unpacking failed" rather than silently booting an old baked-in image —
if boot proceeds normally, delivery is not actually coming from our external initrd:
refutation. Verify the reserved-region claim: shrink DRAM to the minimum documented
supported size and boot — initrd corruption ("junk in compressed archive") refutes the
placement math. Run `busybox --list` and diff applet set against the documented one.

## Verification log
(empty)
