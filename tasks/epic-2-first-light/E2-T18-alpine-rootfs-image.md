---
id: E2-T18
epic: 2
title: Alpine riscv64 rootfs — scripted ext4 image build with getty on ttyS0
priority: 218
status: pending
depends_on: [E2-T12]
estimate: M
capstone: false
---

## Goal
A one-command, documented pipeline producing a bootable Alpine Linux riscv64 ext4 disk
image — real OpenRC init, real `login`, getty on ttyS0 — the actual root filesystem for
the epic's capstone.

## Context
Two viable paths; implement one, document why: (a) Docker with binfmt/qemu-user-static:
`docker run --platform linux/riscv64 riscv64/alpine:latest` (or `alpine:3.20` multi-arch),
`apk add openrc busybox-suid ...`, then export the fs tree; (b) `apk.static
--arch riscv64 --root <dir> --initdb add alpine-base` against the Alpine riscv64 mirror
(pin the release, e.g. v3.20, and record apk index hashes). Either way, configure the
tree: `/etc/inittab` line `ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100` (and no
tty1 gettys), root password set to a documented value (or `passwd -d root` for empty —
document), `/etc/fstab` with `/dev/vda / ext4 rw,relatime 0 1`, enable OpenRC sysinit/boot
runlevel services (devfs, sysfs, hostname), `/etc/securetty` containing ttyS0 (or login
refuses root!). Image assembly *without root privileges*: `mke2fs -d rootdir -t ext4
image.ext4 512M` (from e2fsprogs ≥1.43) — no loop mounts, works in CI. Kernel has no
modules (E2-T12), so strip Alpine's kernel/module packages. Artifacts to
`releases/rootfs/` with SHA256SUMS + the build script's pinned inputs.

## Deliverables
- `tools/build-rootfs.sh` (+ Dockerfile if path (a)) — clean-clone runnable, outputs
  `alpine-rootfs.ext4` + SHA256SUMS.
- `docs/rootfs.md`: pipeline description, pinned versions, how to enter/modify the image
  (`debugfs`/`mke2fs -d` workflow), securetty/inittab rationale.
- Image proven under QEMU (see criteria) before wasm-vm ever sees it.

## Acceptance criteria
- [ ] `qemu-system-riscv64 -M virt -kernel <E2-T12 Image> -append "root=/dev/vda rw" 
      -drive file=alpine-rootfs.ext4,format=raw,if=none,id=d -device virtio-blk-device,drive=d`
      boots to `login:`, root login succeeds, `apk --version` runs.
- [ ] `fsck.ext4 -f -n` on the freshly built image reports clean; image size ≤ 512 MiB.
- [ ] Rebuild from clean clone yields a functionally identical image (file list + content
      hashes match via scripted `debugfs ls -l` comparison; note mtime caveats).
- [ ] No privileged operations (sudo/loop mounts) anywhere in the pipeline.

## Adversarial verification
Boot the image under QEMU and log in — then attack the config claims: `login` as root over
ttyS0 (securetty), `Ctrl-C` at the login prompt (getty respawn, check inittab respawn
doesn't storm — >5 respawns/min refutes), `openrc` status shows no crashed services.
Tamper-detection: modify one file via `debugfs -w`, re-run fsck — pipeline must not have
left the fs in a state where fsck already wants to fix things (orphan inodes from the
build refute). Re-run the build with the Alpine mirror unreachable (block network) — a
silent fallback to cached/stale packages without pin verification refutes supply-chain
claims. Verify the image contains no riscv64-incompatible binaries (`find / -type f
-exec file {} +` scan inside QEMU for x86 ELF — any hit refutes).

## Verification log
(empty)
