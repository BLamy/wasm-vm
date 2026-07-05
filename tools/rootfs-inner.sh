#!/usr/bin/env bash
# E2-T18 in-container build: cross-install + configure the Alpine riscv64 root and pack it into
# an ext4 image. Runs inside tools/rootfs.Dockerfile (host-arch Alpine); env from build-rootfs.sh:
#   MIRROR FS_UUID SOURCE_DATE_EPOCH IMG_SIZE PKGS ALPINE_BRANCH
set -euo pipefail
ROOT=/rootfs
mkdir -p "$ROOT"

# 1. Cross-install the riscv64 root (unpack only; --no-scripts avoids riscv64 execution).
apk.static --arch riscv64 -X "$MIRROR" -U --allow-untrusted \
  --root "$ROOT" --initdb --no-scripts add $PKGS

# Record exactly what landed (pinned-input evidence for reproducibility + supply chain).
apk.static --root "$ROOT" info -v | sort > /out/MANIFEST.txt

# 1b. Recreate the busybox applet symlinks. `apk --no-scripts` skipped the package's
# `busybox --install` trigger, so /sbin/init, /sbin/getty, /bin/login, /bin/mount … are ALL
# missing and the kernel falls through to /bin/sh with no init. The build container ships the
# SAME busybox version (1.36.1), so its `--list-full` is the authoritative applet set.
# Suid-requiring applets point at busybox.suid (from busybox-suid) when present.
BB=/bin/busybox
if [ -e "$ROOT/bin/busybox.suid" ]; then SUID=/bin/busybox.suid; else SUID="$BB"; fi
SUID_APPLETS=" login su passwd mount umount crontab ping ping6 traceroute traceroute6 vlock wall "
test -e "$ROOT$BB" || { echo "no $BB in root — busybox not installed?"; exit 1; }
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

# 2e2. Loopback-only networking. Without /etc/network/interfaces the `networking` service
# crashes ("ifquery: could not parse …"); a loopback stanza lets it start cleanly (there is no
# NIC until a later epic). Keeps `rc-status` free of crashed services.
mkdir -p "$ROOT/etc/network"
cat > "$ROOT/etc/network/interfaces" <<'IFACES'
auto lo
iface lo inet loopback
IFACES

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
for s in modules hwclock swap hostname bootmisc syslog sysctl seedrng networking; do link_svc boot "$s"; done
for s in killprocs savecache mount-ro; do link_svc shutdown "$s"; done

# 3. Pack into a reproducible ext4 (fixed UUID; mke2fs -d needs no privileges/loop mounts).
rm -f /out/alpine-rootfs.ext4
mke2fs -q -t ext4 -L root -U "$FS_UUID" -d "$ROOT" -E root_owner=0:0 /out/alpine-rootfs.ext4 "$IMG_SIZE"

# 4. fsck must report the freshly built image CLEAN (no orphan inodes from the build).
echo "--- fsck.ext4 -f -n ---"
fsck.ext4 -f -n /out/alpine-rootfs.ext4

# 5. Supply-chain / arch sanity: no x86/amd64/arm ELF binaries snuck in (all must be riscv64).
echo "--- foreign-ELF scan (must be empty) ---"
bad=$(find "$ROOT" -type f -exec file {} + | grep -E "ELF.*(x86-64|Intel 80386|ARM aarch64)" || true)
if [ -n "$bad" ]; then echo "FOREIGN BINARIES FOUND:"; echo "$bad"; exit 1; fi
echo "  (clean — riscv64 only)"
