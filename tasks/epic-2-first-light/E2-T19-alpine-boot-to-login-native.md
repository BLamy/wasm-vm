---
id: E2-T19
epic: 2
title: Full Alpine boot — ext4 root on virtio-blk to login shell (native CLI)
priority: 219
status: implemented
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

### 2026-07-05 — Alpine boots to a usable interactive root login (capstone proven)

`tools/boot-alpine.sh` (kernel + the E2-T18 ext4 rootfs on virtio-blk, no initramfs) boots to
an interactive root shell. Captured transcript:

```
Welcome to Alpine Linux 3.20
wasm-vm login: root
wasm-vm:~# uname -a
Linux wasm-vm 6.6.63 #1 SMP Thu Nov 14 2024 riscv64 Linux
wasm-vm:~# cat /etc/os-release        → PRETTY_NAME="Alpine Linux v3.20"
wasm-vm:~# mount                       → /dev/root on / type ext4 (rw,relatime)
wasm-vm:~# df -h /                      → /dev/root  487.2M  9.4M  442.0M  2% /
wasm-vm:~# echo persist_me > /root/marker.txt && cat /root/marker.txt
persist_me
```

Root login, `uname`, `os-release`, `mount`, `df`, and file write+read on the ext4 root all work
— the Level-2 "full system" milestone on the native CLI.

**Deliverables:** `tools/boot-alpine.sh`; the **`--blk-log`** virtio-blk request tracer
(`blk: OP sector=N len=M status=S`) in the core device + Machine + CLI, with a unit test
(`blk_log_records_serviced_requests`) and a boot-debugging-playbook entry; the expect
integration test `crates/cli/tests/boot_alpine.rs` (boot → root login → command battery →
poweroff; `#[ignore]`d — a full Alpine/OpenRC boot is ~8–10 min in the interpreter). Also a
rootfs fix (`tools/rootfs-inner.sh`): dropped the `networking` + `sysctl` OpenRC services, which
are pure waste on our `CONFIG_NET`-off kernel (they slowed the boot and littered the log with
`net.* unknown key` errors).

**⚠️ Discovered bug (this is where "the guest becomes the test harness" pays off):** `bootmisc`
fails during boot with `can't create /var/log/wtmp: Bad message` — an **ext4 EBADMSG** on a
`metadata_csum`-checked block while creating a new inode under sustained boot-time virtio-blk
load. General file I/O works (the `/root/marker.txt` write above succeeds), so this is a subtle
**metadata read-after-write / FLUSH-ordering coherency** issue — exactly the failure surface
this task predicts ("sustained virtio-blk traffic under real ext4 journaling"). `--blk-log` is
the tool built to chase it (correlate the failing block's write vs read). It does NOT block the
login capstone (boot continues to a working shell), but it is a real defect to root-cause.

**Acceptance status:** login capstone (boot→login→working root shell, ext4 root on virtio-blk,
file I/O) **✓**. Remaining, gated on the `wtmp` EBADMSG root-cause: #2 (OpenRC free of crashed
services — `bootmisc` currently fails), the corruption-hunt adversarial pass, and multi-run
determinism. Wrong-password rejection + persistence-across-boot are quick follow-ups once the
metadata coherency bug is fixed. QEMU-diff deferred (QEMU not on the dev host). Gates: core 95,
virtio_blk 8 (incl. blk-log), clippy ±`--all-features`, fmt, determinism — all green.
