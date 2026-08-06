# Alpine container-host fast-boot via native snapshot-restore (E3.6 de-risk)

**Date:** 2026-08-06  **Host:** `dev` (Linux x86_64, 2 cores)  **Verdict: ✅ VIABLE — clean, disk-coherent, ~1500× faster restore than boot.**

Mirrors the busybox proof (`snapshot-restore-prototype.md`: 0.96s restore vs 42s boot). This is the Alpine equivalent: boot the container-capable Alpine host once to "ready", snapshot the whole machine, and restore in sub-second to a live, container-capable shell.

## Setup
- Kernel: `releases/kernel/6.6.63/Image` (riscv64)
- Rootfs: `releases/rootfs/alpine-rootfs.ext4` (768 MB ext4, Alpine **3.20.10**), rsynced mac → `dev:/tmp/alpine-snap.ext4`
- Guest RAM: 256 MiB (default). CLI: `target/release/wasm-vm 0.0.1`
- cmdline: `root=/dev/vda rw console=ttyS0 earlycon=sbi`

## Ready marker
No autologin in this image (inittab runs `getty` on ttyS0). The chosen **output-only, once-per-boot** marker is the getty issue banner:

```
Welcome to Alpine Linux 3.20
```

printed by getty at the login prompt = OpenRC `default` runlevel complete = system ready to run containers. (The `login:` prompt itself has no trailing newline so it never flushes through a line reader — the banner is the reliable trigger.) `wvrun` (the OCI runtime) lives at `/usr/local/bin/wvrun` and is invokable at this point.

## Gate 1 — Full boot-to-ready wall time (the baseline being replaced)
```
BOOT_START epoch=1786057547.893
"Welcome to Alpine Linux 3.20" epoch=1786058469.535
= 921.6 s  (~15 min 22 s)
```
(Slower than the ~6 min estimate — `dev` is a 2-core box and OpenRC hardware scan/mdev is heavy. This is the number snapshot-restore replaces.)

## Gate 2 — Snapshot capture (disk-coherent)
Triggered on the banner; CLI quiesced the virtio-blk in-flight set and exited 0:
```
wasm-vm: snapshot (60202023 bytes) written to /tmp/alpine-ready.snap at trigger "Welcome to Alpine Linux 3.20"
wasm-vm: snapshot complete — exiting   (rc=0)
```
- **Raw snapshot: 60,202,023 bytes (57.4 MB)** — only ~23% of the 256 MiB RAM is non-zero; rest is sparse.
- **gzip -9: 15,273,961 bytes (14.6 MB).**

Coherence method: snapshot taken at the idle getty prompt (disk quiescent, no in-flight writes), and resume reopens the **same** `--drive` ext4 the snapshot was taken against. The full guest page cache is restored with RAM, so the guest's disk view is self-consistent; no explicit guest `sync` was needed (a `sync` run post-restore succeeded cleanly anyway).

## Gate 3 — Restore-to-live-shell wall time (the payoff)
```
RESUME_START                         epoch=1786059792.633
"resumed 60202023 bytes ... continuing guest"  epoch=1786059793.253   → 0.62 s RAM restore
getty login prompt live              epoch=1786059795.8  (login accepted)
```
- **RAM restore: 0.62 s.** Interactive root shell reached within ~3 s (the remaining time is scripted `sleep`s in the driver, not VM latency).
- **Speedup: 921.6 s → 0.62 s ≈ 1500× for the restore; ~300× to a fully interactive shell.**

## Gate 4 — Live + disk-coherent proof (restored guest, real console output)
```
wasm-vm:~# uname -a
Linux wasm-vm 6.6.63 #1 SMP Thu Nov 14 2024 riscv64 Linux
wasm-vm:~# cat /etc/alpine-release
3.20.10
wasm-vm:~# ls /
bin  dev  etc  home  lib  lost+found  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var
wasm-vm:~# cat /proc/uptime
40.39 10.61            # guest uptime preserved across snapshot/restore
wasm-vm:~# /usr/local/bin/wvrun --help
usage: wvrun run [-d] [--name N] [--memory B] [--pids N] <bundle> [-- <cmd...>]
       wvrun ps [-a] | logs [-f] <ref> | stop <ref> | rm [-f] <ref> | exec [-it] <ref> <cmd…>
       wvrun [--interactive] [--memory B] [--pids N] <bundle>   (legacy run-to-exit)
wasm-vm:~# sync            # returned clean
wasm-vm:~# dmesg | tail
[   33.303566] EXT4-fs (vda): re-mounted <uuid> r/w. Quota mode: disabled.
```
- Live: shell interactive, `uname`/`alpine-release`/`wvrun` all respond.
- **Container-capable: `wvrun` (OCI runtime) is present and invokable** on the restored host.
- **Disk-coherent: no EXT4 errors** anywhere; `ls /` reads the tree, `sync` clean, ext4 remounted r/w cleanly. Boot-time `Checking local filesystems ... [ ok ]` (fsck) was clean.

## Disk-dirty measurement (informs the browser overlay)
Booted `/tmp/alpine-snap.ext4` vs the pristine master, in 4 KiB blocks:
```
199 differing 4 KiB blocks / 196608 total  ≈ 0.8 MB of disk delta from boot
```
The boot barely touches the disk (most runtime state is tmpfs `/run`; on-disk deltas are journal + a few `/var` writes). The COW overlay at "ready" is tiny.

## Caveats / honesty
- Marker is the getty banner, **not** an autologin shell — there is no autologin in this image. It's still an ideal trigger (output-only, once per boot, ready-to-run-containers).
- Master ext4 shows "needs journal recovery" when loop-mounted (unclean prior copy); the guest's own boot-time fsck ran clean, and restore was coherent regardless.
- Baseline is 15 min on this 2-core box (not the quoted ~6 min) — the payoff ratio is even larger than expected.
- No fs corruption observed. This is a clean positive result.

## Assessment: Alpine fast-boot-via-snapshot is VIABLE
Sub-second RAM restore to a live, container-capable Alpine host with a coherent disk, replacing a 15-minute cold boot. The RAM snapshot is small (57 MB raw / 15 MB gz) and the disk delta at ready is <1 MB.

## What the BROWSER phase needs (follow-on, out of scope here)
Native used a single reopenable ext4; browser boots off a **130 MB chunked read-only base + IndexedDB copy-on-write overlay**. A browser restore therefore needs:
1. **The RAM snapshot** (~57 MB raw / **14.6 MB gz** — small enough to stash in IndexedDB and ship).
2. **The overlay COW-delta captured atomically at snapshot time**, seeded over the chunked base. Good news: that delta is **only ~0.8 MB** here (199 × 4 KiB), because the boot dirties almost nothing on disk.
3. **Byte-exact disk on resume:** the restored guest page cache references specific disk blocks; any cache-miss read must return the *post-boot* block state, so the overlay must contain every block the boot wrote (all 199). The browser phase must snapshot the IndexedDB overlay generation in lockstep with the RAM snapshot (cf. the E3-T12d overlay-generation stale-guard note).
4. Practically: capture `{ram.snap.gz (~15 MB), overlay-delta (~1 MB)}` as a paired artifact keyed to the chunked-base version; on load, restore RAM + apply overlay delta over the base, then `--resume-from`. No guest `sync` required (RAM carries the page cache), but the overlay must be quiesced at the same instant the RAM is.
```
```

## Independent re-verification (Opus, from the mac)
Re-ran `--resume-from /tmp/alpine-ready.snap --drive file=/tmp/alpine-snap.ext4` on `dev`: the guest
resumes **instantly at `wasm-vm login:`** and the ext4 reads coherently — restore confirmed.

**Marker refinement (important for the demo):** the `Welcome to Alpine Linux 3.20` getty banner lands
the restore at the LOGIN PROMPT, not a ready shell (the native proof logged in as `root` to reach a
shell). For "container-ready in <1s" the build-time snapshot should be captured AFTER an (auto)login at
a usable shell / once `wvrun` is invokable without a login step — either enable root autologin in the
snapshot image, or drive `root\n` before the snapshot trigger. Otherwise the restored browser demo shows
a login prompt, not a shell.

## Verdict
Alpine fast-boot via snapshot is **viable and disk-coherent**: RAM restore 0.62s (~1500x vs the 15-min
boot), tiny artifact (~14.6MB gz RAM + ~1MB overlay delta). Remaining: (1) snapshot at a post-login
container-ready point; (2) the browser chunked-base + COW-overlay-delta wiring (seed the ~1MB delta over
the 130MB chunked base, captured in lockstep with the RAM snapshot per the E3-T12d overlay-generation guard).
