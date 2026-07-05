# Alpine riscv64 rootfs (E2-T18)

`tools/build-rootfs.sh` produces `releases/rootfs/alpine-rootfs.ext4` — a bootable Alpine
Linux riscv64 root filesystem with OpenRC init and a `getty`/`login` on `ttyS0`. It is the
root disk for the Epic-2 capstone (E2-T19 boots it on the native CLI).

## One command

```sh
bash tools/build-rootfs.sh
# → releases/rootfs/{alpine-rootfs.ext4, MANIFEST.txt, SHA256SUMS}
```

Docker is the only host requirement (same as the kernel/initramfs builds). No `sudo`, no loop
mounts, no `qemu-user`/binfmt.

## Approach — cross-install, no emulation (path b)

We take **path (b)** from the task (apk.static cross-bootstrap), not path (a)
(binfmt/`qemu-user`), because it needs **no riscv64 execution**:

1. A host-arch Alpine container (`tools/rootfs.Dockerfile`, pinned by image **digest** and
   each tool by exact version) runs `apk.static --arch riscv64 --keys-dir
   /usr/share/apk/keys/riscv64 … --root /rootfs --initdb --no-scripts add alpine-base
   busybox-suid openrc`. `apk.static` only *unpacks* the riscv64 packages into a directory — it
   never runs a riscv64 binary — so no emulator is needed. **Signatures are verified:** the
   riscv64 v3.20 APKINDEX is signed by key `60ac2099`, which ships (itself verified) in the
   build image's `alpine-keys` under `/usr/share/apk/keys/riscv64` — NOT the default
   `/etc/apk/keys`, so `--keys-dir` is required and `--allow-untrusted` is **not** used (the
   build fails closed on a tampered mirror). Pinned to Alpine **v3.20**.
2. **`busybox --install` is redone by hand.** `--no-scripts` skips the busybox trigger that
   creates the `/sbin/init`, `/sbin/getty`, `/bin/login`, `/bin/mount`, … applet symlinks —
   without them the kernel finds no `/sbin/init` and falls through to `/bin/sh`. The build
   container ships the **same busybox version (1.36.1)**, so its `busybox --list-full` is the
   authoritative applet set; we symlink each applet to `/bin/busybox` (suid-needing ones —
   `login`, `su`, `passwd`, `mount`, … — to `/bin/busybox.suid` from `busybox-suid`).
3. The tree is configured for a headless serial console (see below).
4. `mke2fs -d /rootfs -t ext4 -O ^metadata_csum -U <fixed-uuid> image.ext4 512M` packs the
   directory straight into an ext4 image — no privileged loop mount, works in CI.
   **`-O ^metadata_csum`** (E2-T19): mke2fs 1.47 enables ext4 metadata checksums by default,
   but a freshly-built csum image deterministically fails `EBADMSG` ("Bad message") when the
   6.6.63 kernel allocates a new inode (bootmisc creating `/var/log/wtmp`) — a
   `metadata_csum`(_seed) build-vs-kernel interaction, not an emulator fault (the block backend
   is synchronous with no cache, so a write is byte-visible to the next read). Plain ext4 (the
   QEMU-rootfs convention) boots cleanly.
5. `fsck.ext4 -f -n` asserts the fresh image is **clean** (no build-orphaned inodes), and a
   `find … -exec file` scan asserts **no foreign (x86/aarch64) ELF** binaries slipped in.

## Configuration (`tools/rootfs-inner.sh`)

| File | Contents / why |
|---|---|
| `/etc/inittab` | Only a `ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100` getty (the default tty1–6 gettys are dropped — there is no VGA console) plus the OpenRC sysinit/boot/default/shutdown stanzas. |
| `/etc/securetty` | `ttyS0` appended — **busybox `login` refuses root on a tty not listed here.** |
| `/etc/fstab` | `/dev/vda / ext4 rw,relatime 0 1` — the single virtio-blk disk as root. |
| `/etc/shadow` | root's password field emptied (`root::…`). **Passwordless root by design** for the emulator; busybox `login` accepts an empty password on a securetty. Change to a real hash for a hardened image. |
| `/etc/hostname` | `wasm-vm`. |
| `/etc/runlevels/*` | OpenRC service symlinks for a headless boot (sysinit: devfs/sysfs/…; boot: bootmisc/hostname/syslog/sysctl/…). Created tolerantly (skipped if a package-set change drops a service). `/dev` is auto-populated by the kernel (`CONFIG_DEVTMPFS_MOUNT`), so `devfs` is belt-and-suspenders. |

## Reproducibility & the supply-chain lock

What is pinned, and how drift is *detected* (not just hoped for):

- **Builder**: `tools/rootfs.Dockerfile` pins the base by **digest**
  (`alpine@sha256:d9e853…`), not the floating `:3.20` tag, and pins `apk-tools-static`,
  `e2fsprogs`, and `file` to exact versions — so the builder (including its busybox, whose
  applet list we reuse) cannot drift.
- **Package set**: `apk` resolves "latest within v3.20", so a mirror-side point-release bump
  (e.g. `busybox -r31→-r32`, a `libcrypto3` CVE patch) *would* change the image. The build
  writes the freshly-resolved set to `MANIFEST.new` and **`build-rootfs.sh` diffs it against the
  committed `releases/rootfs/MANIFEST.txt` lock and FAILS on any drift** — so a silent bump is
  caught and must be reviewed. `UPDATE_MANIFEST=1 bash tools/build-rootfs.sh` accepts a bump and
  refreshes the lock. `SHA256SUMS` covers `MANIFEST.txt` (the lock is git-tracked and
  reproducible).
- **The `.ext4` is intentionally NOT hash-pinned.** Its bytes are build-instance-specific:
  `apk`/`mke2fs` stamp file mtimes from package metadata and the build time, so a legitimate
  rebuild produces different bytes even with an identical file tree. A committed image hash
  would therefore be an *unverifiable* pin that fails `shasum -c` on every honest rebuild.
  Instead the integrity guarantees are the **verified signatures** + the **MANIFEST drift gate**
  + the in-container **fsck** and **foreign-ELF** checks. Compare two builds' *contents* with
  `debugfs -R 'ls -l /'` or by diffing extracted trees — not by image hash. (Fixed fs UUID and
  `SOURCE_DATE_EPOCH` reduce, but do not eliminate, byte drift.)

## Inspecting / modifying the image

No mounting needed — use `debugfs` (from `e2fsprogs`) in the build container or any host with
e2fsprogs:

```sh
debugfs -R 'ls -l /etc' releases/rootfs/alpine-rootfs.ext4          # list
debugfs -R 'cat /etc/inittab' releases/rootfs/alpine-rootfs.ext4    # read a file
debugfs -w -R 'rm /some/file' releases/rootfs/alpine-rootfs.ext4    # write (then fsck!)
```

To change the config, edit `tools/rootfs-inner.sh` and rebuild — never hand-edit the image.

## Verification

QEMU is the task's reference (`qemu-system-riscv64 -M virt … -device virtio-blk-device`), but
it is not installed on the dev host. Instead the image is booted on **our own emulator**, whose
E2-T12 kernel has `EXT4_FS` + `VIRTIO_BLK` + `VIRTIO_MMIO` built in:

```sh
wasm-vm boot --kernel releases/kernel/6.6.63/Image \
  --drive file=releases/rootfs/alpine-rootfs.ext4 \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi"
```

This mounts `ext4` on `vda` and runs Alpine's OpenRC init to a `login:` prompt (E2-T19 makes
this the capstone). Booting under QEMU with the same `-append`/`-drive` remains the documented
cross-check for when QEMU is available.
