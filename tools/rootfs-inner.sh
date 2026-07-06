#!/usr/bin/env bash
# E2-T18 in-container build: cross-install + configure the Alpine riscv64 root and pack it into
# an ext4 image. Runs inside tools/rootfs.Dockerfile (host-arch Alpine); env from build-rootfs.sh:
#   MIRROR FS_UUID SOURCE_DATE_EPOCH IMG_SIZE PKGS ALPINE_BRANCH
set -euo pipefail
ROOT=/rootfs
mkdir -p "$ROOT"

# 1. Cross-install the riscv64 root (unpack only; --no-scripts avoids riscv64 execution).
# Signatures ARE verified: --keys-dir points at the riscv64 signing keys that ship (verified)
# in the build image's alpine-keys package. The riscv64 v3.20 APKINDEX is signed by key
# 60ac2099, which lives under /usr/share/apk/keys/riscv64 (NOT the default /etc/apk/keys), so
# without this apk reports "UNTRUSTED signature". We do NOT use --allow-untrusted (critic #1):
# a MITM/mirror-compromise now fails closed.
apk.static --arch riscv64 -X "$MIRROR" --keys-dir /usr/share/apk/keys/riscv64 -U \
  --root "$ROOT" --initdb --no-scripts add $PKGS

# Record exactly what landed → drift lock (host diffs this against the committed manifest).
apk.static --root "$ROOT" info -v | sort > /out/MANIFEST.new

# 1b. Recreate the busybox applet symlinks. `apk --no-scripts` skipped the package's
# `busybox --install` trigger, so /sbin/init, /sbin/getty, /bin/login, /bin/mount … are ALL
# missing and the kernel falls through to /bin/sh with no init. The build container ships the
# SAME busybox version (1.36.1), so its `--list-full` is the authoritative applet set.
# Suid-requiring applets point at busybox.suid (from busybox-suid) when present.
BB=/bin/busybox
if [ -e "$ROOT/bin/busybox.suid" ]; then SUID=/bin/busybox.suid; else SUID="$BB"; fi
SUID_APPLETS=" login su passwd mount umount crontab ping ping6 traceroute traceroute6 vlock wall "
test -e "$ROOT$BB" || { echo "no $BB in root — busybox not installed?"; exit 1; }
# The applet SET comes from the container's busybox — assert it's the SAME version as the
# target's, else the recreated symlink set could be wrong (critic #4). Both are pinned, so this
# only fires if someone bumps one without the other.
CBB_VER=$(busybox 2>&1 | sed -n '1s/.*v\([0-9.]*\).*/\1/p')
TBB_VER=$(grep -oE '^busybox-[0-9][^ ]*' /out/MANIFEST.new | head -1 | sed 's/^busybox-//; s/-r.*//')
if [ -n "$TBB_VER" ] && [ "$CBB_VER" != "$TBB_VER" ]; then
  echo "busybox version skew: container $CBB_VER vs target $TBB_VER — applet set may differ"; exit 1
fi
for applet in $(busybox --list-full); do
  path="$ROOT/$applet"
  # Skip anything already present — real file OR symlink (even dangling, e.g. /sbin/ifdown from
  # ifupdown-ng) — so we never clobber another package's applet.
  if [ -e "$path" ] || [ -L "$path" ]; then continue; fi
  mkdir -p "$(dirname "$path")"
  name=$(basename "$applet")
  case "$SUID_APPLETS" in
    *" $name "*) ln -s "$SUID" "$path" ;;
    *) ln -s "$BB" "$path" ;;
  esac
done
test -L "$ROOT/sbin/init" && echo "  busybox applets linked (/sbin/init -> $(readlink "$ROOT/sbin/init"))"

# 2. Configure the tree for a serial console + root login on ttyS0.
# 2a. Only a ttyS0 getty (drop the default tty1-6 gettys) + the OpenRC init stanzas.
cat > "$ROOT/etc/inittab" <<'INITTAB'
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default
ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/openrc shutdown
INITTAB

# 2b. login refuses root on a tty absent from /etc/securetty — add ttyS0.
grep -qx ttyS0 "$ROOT/etc/securetty" 2>/dev/null || echo ttyS0 >> "$ROOT/etc/securetty"

# 2c. Root filesystem mount (ext4 on the single virtio-blk disk).
cat > "$ROOT/etc/fstab" <<'FSTAB'
/dev/vda / ext4 rw,relatime 0 1
FSTAB

# 2d. Passwordless root (documented). busybox login accepts an empty shadow password on a
# securetty. Set root's shadow to empty rather than run passwd (which needs riscv64 exec).
if [ -f "$ROOT/etc/shadow" ]; then
  sed -i 's@^root:[^:]*:@root::@' "$ROOT/etc/shadow"
else
  echo 'root::19000:0:99999:7:::' > "$ROOT/etc/shadow"
  chmod 640 "$ROOT/etc/shadow"
fi

# 2e. Hostname.
echo wasm-vm > "$ROOT/etc/hostname"

# 2e2. NO networking. The E2-T12 kernel is built without CONFIG_NET (no network stack until a
# later epic), so the `networking` service is not linked into any runlevel below — running it
# on a netless kernel is pointless work that only slows the boot and litters the log with
# `net.* unknown key` sysctl errors. (A NIC + networking arrives with the network epic.)

# 2f. OpenRC runlevels — symlink the services a headless serial boot needs, tolerantly (only if
# the init script exists, so a package-set change never breaks the build). /dev is auto-mounted
# by the kernel (DEVTMPFS_MOUNT), so devfs is belt-and-suspenders.
mkdir -p "$ROOT"/etc/runlevels/sysinit "$ROOT"/etc/runlevels/boot \
         "$ROOT"/etc/runlevels/default "$ROOT"/etc/runlevels/shutdown
link_svc() { # $1=runlevel $2=service
  if [ -e "$ROOT/etc/init.d/$2" ]; then
    ln -sf "/etc/init.d/$2" "$ROOT/etc/runlevels/$1/$2"
  else
    echo "  (skip $1/$2 — no init script)" >&2
  fi
}
for s in devfs dmesg mdev sysfs hwdrivers; do link_svc sysinit "$s"; done
for s in modules hwclock swap hostname bootmisc syslog seedrng; do link_svc boot "$s"; done
for s in killprocs savecache mount-ro; do link_svc shutdown "$s"; done

# 3. Pack into a reproducible ext4 (fixed UUID; mke2fs -d needs no privileges/loop mounts).
# `-O ^metadata_csum`: disable ext4 metadata checksums. mke2fs 1.47 enables them by default,
# but a freshly-built csum image deterministically fails `EBADMSG` (Bad message) when the 6.6.63
# kernel allocates a new inode (e.g. bootmisc creating /var/log/wtmp) — a metadata_csum(_seed)
# build-vs-kernel interaction, NOT an emulator fault (the block backend is synchronous, no cache,
# so a write is byte-visible to the next read; verified by the block/virtio-blk tests). Plain
# ext4 without metadata_csum is what QEMU rootfs images conventionally use.
#
# E3-T11 (reproducibility): `-E hash_seed=` pins the directory-htree hash seed. Without it mke2fs
# picks a RANDOM seed per build, so the directory index blocks differ every time — ~11% of chunks
# churned across two otherwise-identical builds (caught by tools/build_image/build.sh REPRO_CHECK).
# Reusing FS_UUID as the seed keeps it a single pinned constant. (dir_index stays ON — deterministic
# htree, no lookup-speed regression.)
rm -f /out/alpine-rootfs.ext4
mke2fs -q -t ext4 -O ^metadata_csum -L root -U "$FS_UUID" -E "root_owner=0:0,hash_seed=$FS_UUID" -d "$ROOT" /out/alpine-rootfs.ext4 "$IMG_SIZE"

# 4. fsck must report the freshly built image CLEAN (no orphan inodes from the build).
echo "--- fsck.ext4 -f -n ---"
fsck.ext4 -f -n /out/alpine-rootfs.ext4

# 5. Supply-chain / arch sanity: every ELF must be RISC-V. This is an ALLOW-list (flag any ELF
# that is NOT RISC-V), not a blacklist of known-bad arches (critic #6) — so x86/ARM/ppc/s390/…
# are all caught, not just the three we thought to name.
echo "--- foreign-ELF scan (every ELF must be RISC-V) ---"
bad=$(find "$ROOT" -type f -exec file {} + | grep -E "\bELF\b" | grep -v "RISC-V" || true)
if [ -n "$bad" ]; then echo "NON-RISC-V BINARIES FOUND:"; echo "$bad"; exit 1; fi
echo "  (clean — riscv64 only)"
