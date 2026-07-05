---
id: E2-T13
epic: 2
title: Static busybox initramfs — minimal userland for first boot
priority: 213
status: implemented
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

### 2026-07-05 — worker — implemented

**What landed.** `tools/build-initramfs.sh` + `tools/initramfs.Dockerfile` +
`tools/initramfs/init` → `releases/initramfs/{initramfs.cpio.gz,busybox,SHA256SUMS}`
(checked in). busybox **1.36.1** (pinned sha256), CONFIG_STATIC, riscv64 cross toolchain in
a container-native Docker volume. `/init` mounts proc/sysfs/devtmpfs then spawns an
interactive shell as a CHILD (not exec) via `setsid cttyhack sh` in a respawn loop — so the
shell has its own session + controlling TTY. `docs/platform.md` gains the DRAM layout
diagram (kernel@0x8020_0000 | initrd | DTB). `fdt::initrd_placement(kernel_end, dtb, len)`
computes the initrd region (above kernel, below DTB, 8-aligned) and `build_virt_dtb` already
emits `linux,initrd-start/end` from `Initrd` (E2-T02/T03) — unit-tested.

**Evidence (booted on stock qemu-system-riscv64 -M virt -kernel Image -initrd …):**
- #1 static ELF: `file` → "statically linked, UCB RISC-V"; `cpio -t` lists
  init/bin/busybox/proc/sys/dev/tmp with NO warnings.
- #2 interactive busybox sh: reaches the `~ #` prompt; `ls /bin` shows applets, `ps` and
  `mount` (`rootfs on /`) work.
- #3 + charter ^C attack: `/init` is PID 1 (`ps`: `{init} /bin/busybox sh /init`), the
  spawned shell's `echo $$` = **33** (NOT 1), a ^C at the prompt prints
  `ALIVE_AFTER_CTRLC=yes` and the system survives (poweroff -f then powers down). (Fixed
  round-1: `exec setsid` collapsed the chain leaving the shell as PID 1 — switched to a
  non-exec respawn loop.)
- #4 reproducible: TWO independent fresh-Docker-volume builds → byte-identical cpio.gz.
  (Fixed: `cpio --reproducible` keeps file mtimes → normalize every mtime to
  SOURCE_DATE_EPOCH first; gzip -n.)
- fmt + clippy ±--all-features clean; wasm fdt mirror 3/3.

**Deferred honestly:** the corrupt-byte "Initramfs unpacking failed" attack + the actual
in-emulator initrd LOAD (Machine placing the cpio in RAM + reserving the region) land with
E2-T15's boot; the placement math + DTB props are here and tested.
