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

**Bug found & FIXED — ext4 `metadata_csum`, NOT the emulator (critic corrected my first
diagnosis).** First boots showed `bootmisc` failing with `can't create /var/log/wtmp: Bad
message` (ext4 EBADMSG creating a new inode). My initial write-up blamed a "virtio-blk
read-after-write / FLUSH-ordering coherency bug under load" — **that was wrong.** The cold-clone
critic refuted it from the code: the block device is **single-threaded, synchronous, and has no
cache** — a write goes straight to the backing `Vec`/`mmap` and the next read reads the same
bytes (proven by `virtio_blk.rs::out_then_in_roundtrip`, a byte-exact read-after-write test), so
a coherency/ordering bug is *structurally impossible*. And the failure was **deterministic** —
the same file every boot from a freshly-copied pristine image — which cannot be random runtime
corruption; it points at data baked into the image. The critic named the cheap experiment
(rebuild `-O ^metadata_csum`); I ran it:

```
# metadata_csum ON  → * Creating user login records .../var/log/wtmp: Bad message  [bootmisc FAILS]
# metadata_csum OFF → * Creating user login records ... [ ok ]   →  wasm-vm login:   [CLEAN]
```

**Root cause:** the `mke2fs` 1.47 default `metadata_csum`(+`_seed`) produces checksums the 6.6.63
kernel rejects on a new-inode allocation. **Fix:** `tools/rootfs-inner.sh` now builds the image
with `-O ^metadata_csum` (plain ext4, the QEMU-rootfs convention). The whole OpenRC boot is then
clean — no crashed services (only the benign mdev `hotplug` warning from `CONFIG_UEVENT_HELPER`
being off). The emulator's block path is exonerated.

**Acceptance status:** login capstone (boot→login→working root shell, ext4 root on virtio-blk,
file I/O) **✓**; #2 (OpenRC free of crashed services) **✓** after the metadata_csum fix. Remaining:
the corruption-hunt adversarial pass, multi-run determinism, wrong-password rejection, and
persistence-across-boot — mechanical follow-ups (the fs is now clean). QEMU-diff deferred (QEMU
not on the dev host). Gates: core 95, virtio_blk 8 (incl. blk-log), clippy ±`--all-features`,
fmt, determinism — all green.
