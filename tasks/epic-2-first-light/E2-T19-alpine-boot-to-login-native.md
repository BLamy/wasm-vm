---
id: E2-T19
epic: 2
title: Full Alpine boot — ext4 root on virtio-blk to login shell (native CLI)
priority: 219
status: verification-debt
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
- [x] Scripted boot→login→battery→poweroff test passes 3 consecutive runs from the same
      pristine image copy (image reset between runs). *(2026-07-31: 3× rc=0, 1080/1084/1082s.)*
- [x] dmesg + OpenRC output free of WARN/BUG/Oops/`I/O error`/rcu-stall lines (scripted
      grep gate). *(battery `DMESGBAD=0` step passed in all 3 runs.)*
- [x] `login:` accepts root with the documented password; a wrong password is *rejected* *(AMENDED by the 2026-07-06 sweep: root is
      passwordless by T18 design — superseded; the login gate is the echo-proof marker.)*
      (proves login/PAM path is real, not a fluke tty). *(WASMVM_LOGIN_OK echoed in all 3 runs.)*
- [ ] Files written in one boot are present in the next boot of the same image. *(NOT covered
      by the reset-per-run harness; within-boot write/read passes (`persist_42`), cross-boot
      persistence pending a dedicated 2-boot test.)*
- [x] External `fsck.ext4 -f -n` clean after the scripted clean shutdown. *(2026-07-31: FSCK_RC=0, 0 errors.)*

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

### 2026-07-31 — scripted acceptance now GREEN on the current artifacts (3× + fsck)

The committed `crates/cli/tests/boot_alpine.rs` had been failing against the current released
kernel + rootfs (see the 2026-07-06 sweep); this entry records it passing after the harness
was repaired. Run on `ssh dev` (x86_64, 2 cores; interpreted riscv64), released
`kernel/6.6.63/Image` + `rootfs/alpine-rootfs.ext4` (sha256
`e7db52dae2f9f6631ab6f7a693125418aa5841216554fbc4123435725d320c19`), release build.

**3 consecutive runs, pristine image copy each run — all rc=0:**

```
RUN 1 end rc=0 dur=1080s (pass_so_far=1)
RUN 2 end rc=0 dur=1084s (pass_so_far=2)
RUN 3 end rc=0 dur=1082s (pass_so_far=3)
CONSECUTIVE_PASSES=3
```

Each run: kernel mounts `/dev/vda` ext4 root on virtio-blk → OpenRC → getty `login:` →
root shell (echo-proof `WASMVM_LOGIN_OK`) → battery (`uname`, os-release, `mount` shows
`/dev/vda on / type ext4 (rw,relatime)`, `df -h /`, write+read `persist_42`, dmesg health
gate `DMESGBAD=0`, `sync`) → clean `poweroff` (process exit 0).

**External fsck after a clean shutdown (separate boot preserving the image), `fsck.ext4 -f -n`:**

```
Pass 1..5 clean; root: 5095/32768 files (0.1% non-contiguous), 34720/131072 blocks
FSCK_RC=0
```

Acceptance criteria 1, 2, 3, 5 met with recorded evidence. Criterion 4 (files present in the
*next* boot of the same image) is NOT covered by this reset-per-run harness — within-boot
write/read passes, but cross-boot persistence needs a dedicated 2-boot test (pending). The
`## Adversarial verification` probes (QEMU differential, paste/backspace termios, corruption
md5 sweep, SIGKILL journal-recovery, read-only boot) remain unexercised, so this is NOT yet a
full `verified` flip — it is honest proof that the core capstone and its scripted harness now
pass on the shipped artifacts.

**Harness repairs that made this pass** (`crates/cli/tests/boot_alpine.rs`):
1. Mount/df needles updated for the current image — root mounts as `/dev/vda`, not the
   `/dev/root` alias the old test asserted; df assertion relaxed to the `/dev/` prefix
   (busybox reports the root device under either name).
2. Login timeout 900s → 1500s (a clean boot is ~1080s; the old margin flaked under load).
3. **Barrier-synchronized battery** — the real tty fix. Each step now waits for an
   output-only sentinel (`; echo RDY_<n>_OK`) before the next command is sent, so no input is
   typed while the previous command's output is still draining over the slow UART (the old
   blind `sleep` collided with the `ESC[6n` cursor-query path and silently dropped the `df`
   step).
4. **Kill-on-drop guest guard** — the flake amplifier. `std::process::Child` doesn't kill on
   drop, so a panicking run orphaned its guest, which then burned a full core to `--max-instrs`
   and starved the *next* run into a login-gate timeout. Wrapped the child so `Drop`
   kills+reaps it.

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

**2026-07-06 — VERIFICATION-DEBT SWEEP (parallel cold-clone critics, PR #101).** VERDICT FIX-FIRST (MEDIUM) → test fixed; task STAYS implemented.
The critic proved (hostile transcript demo) that 4 of the 6 battery asserts were echo-vacuous —
`WASMVM_LOGIN_OK`/`persist_me` matched the tty ECHO of the sent command, `Alpine Linux` matched the
getty BANNER, `df`'s needle was pre-satisfied by `mount`'s output — the pre-F1 test was never
retrofitted, and its doc comment overclaimed. RETROFITTED in the sweep: split markers
(WASMVM_LOGIN_"OK", persist_$((6*7))), banner-proof os-release check, computed df marker, and the
criterion-2 dmesg health gate (`grep -cE 'WARNING|BUG:|Oops|I/O error'` → DMESGBAD=0, output-only).
--blk-log CLEARED: zero-cost off (Option + one if-let), bounded on (drained per quantum, tail
drained before exit), failures logged; critic's hostile test adopted (virtio_blk.rs, 12/12).
STILL OPEN (why not verified): 3-consecutive-run criterion unmet (recorded evidence is single-run);
the retrofitted battery has not yet had its own recorded boot; criterion 3 ("wrong password
rejected") is incoherent against T18's passwordless-root design — amended below; host-side
post-mortem fsck.ext4 unavailable on macOS (in-guest dmesg gate substituted).
