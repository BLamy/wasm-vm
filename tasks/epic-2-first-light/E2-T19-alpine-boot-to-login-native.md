---
id: E2-T19
epic: 2
title: Full Alpine boot — ext4 root on virtio-blk to login shell (native CLI)
priority: 219
status: pending
depends_on: [E2-T11, E2-T15, E2-T18]
estimate: L
capstone: false
---

## Goal
The complete Level 2 system running natively: unmodified kernel mounts the Alpine ext4
image from virtio-blk as root, OpenRC brings up userland, getty presents `login:`, and a
logged-in root shell is genuinely usable — everything the browser capstone needs, minus
the browser.

## Context
Boot line: `root=/dev/vda rw console=ttyS0` (add `rootwait` only if probe ordering ever
requires it — investigate rather than cargo-cult). No initramfs on this path (root mounts
directly; keep `--initrd` working for the busybox flow). Expected new failure surface vs
E2-T15: sustained virtio-blk traffic under real ext4 journaling (barrier/FLUSH ordering),
OpenRC exercising far more syscalls than busybox init, login(1) via getty on the UART
(termios, job control), and multi-second CPU-bound stretches (apk index parsing) that
expose timer drift. Use E2-T14's playbook plus a new tool: `--blk-log` request tracing
(type/sector/len/status) to debug fs corruption or stalls. This task is where "the guest
becomes the test harness" starts paying: once logged in, exercise the machine with real
coreutils and record findings. Fix upstream bugs in their crates; log them here.

## Deliverables
- Working `tools/boot-alpine.sh` (released kernel + rootfs artifacts, one command).
- `--blk-log` flag in the CLI; documented in the debugging playbook.
- Expect-scripted integration test: full boot → login as root → run command battery
  (`uname -a`, `mount`, `df -h`, `cat /etc/os-release`, write+read a file, `sync`) →
  `poweroff` → assert exit 0 and post-mortem `fsck -f -n` clean.

## Acceptance criteria
- [ ] Scripted boot→login→battery→poweroff test passes 3 consecutive runs from the same
      pristine image copy (image reset between runs).
- [ ] dmesg + OpenRC output free of WARN/BUG/Oops/`I/O error`/rcu-stall lines (scripted
      grep gate).
- [ ] `login:` accepts root with the documented password; a wrong password is *rejected*
      (proves login/PAM path is real, not a fluke tty).
- [ ] Files written in one boot are present in the next boot of the same image.
- [ ] External `fsck.ext4 -f -n` clean after the scripted clean shutdown.

## Adversarial verification
Differential boot: identical kernel/rootfs under QEMU virt; diff normalized dmesg and
OpenRC service outcomes line-by-line — every divergence must be explained in the log or it
refutes. Interactivity probe: at the login prompt, type at human speed, then paste
1000 chars, then hold backspace — getty/termios misbehavior (dropped, doubled, reordered
chars) refutes. Corruption hunt: boot, run `for i in $(seq 100); do dd if=/dev/urandom
of=/f$i bs=64k count=4; done; sync`, poweroff; mount the image on the host (or QEMU) and
md5-verify every file against in-guest sums captured pre-shutdown — any mismatch refutes.
Kill the emulator (SIGKILL) mid-write storm, boot again: ext4 journal must recover
(mount succeeds, fsck fixes only journal replay); an unmountable image refutes FLUSH
ordering. Boot with the image marked read-only via `--drive ...,ro` and `ro` in bootargs:
must reach a read-only shell, not crash.

## Verification log
(empty)
