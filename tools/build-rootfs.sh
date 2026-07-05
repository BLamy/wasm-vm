#!/usr/bin/env bash
# E2-T18: one-command reproducible Alpine riscv64 ext4 rootfs (Docker-only host requirement).
#   bash tools/build-rootfs.sh   → releases/rootfs/{alpine-rootfs.ext4,SHA256SUMS,MANIFEST.txt}
#
# Approach (b): a host-arch Alpine container cross-installs the riscv64 root with `apk.static
# --arch riscv64` (UNPACK only — no binfmt/qemu-user, no privileged loop mounts), configures
# it for a serial console + root login, and packs it with `mke2fs -d`. Everything is pinned to
# Alpine v3.20 and a fixed fs UUID so a clean-clone rebuild is functionally identical.
set -euo pipefail
cd "$(dirname "$0")/.."

ALPINE_BRANCH=v3.20
MIRROR="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}/main"
# Fixed ext4 UUID + a fixed epoch so rebuilds don't drift on random UUID / mtimes.
FS_UUID="a11ce000-0e2f-4c18-b007-f50000000018"
export SOURCE_DATE_EPOCH=1731542400 # 2024-11-14, matches the kernel banner date
IMG_SIZE=512M
# The riscv64 root package set: alpine-base pulls openrc+busybox+musl+baselayout; busybox-suid
# gives setuid login/passwd; the rest make it feel like a real system.
PKGS="alpine-base busybox-suid openrc"

OUT="releases/rootfs"
IMG_TAG="wasm-vm-rootfs-build:local"
mkdir -p "$OUT"

# Build the pinned build image (context = tools/ only).
docker build -q -f tools/rootfs.Dockerfile -t "$IMG_TAG" tools >/dev/null

# The whole build runs in the container (tools/rootfs-inner.sh); only the finished image +
# manifest come out through the bind mount.
docker run --rm \
  -v "$PWD/$OUT:/out" \
  -v "$PWD/tools/rootfs-inner.sh:/rootfs-inner.sh:ro" \
  -e MIRROR="$MIRROR" \
  -e FS_UUID="$FS_UUID" \
  -e SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  -e IMG_SIZE="$IMG_SIZE" \
  -e PKGS="$PKGS" \
  -e ALPINE_BRANCH="$ALPINE_BRANCH" \
  "$IMG_TAG" /rootfs-inner.sh

# Hashes host-side over the copied-out artifacts.
(cd "$OUT" && shasum -a 256 alpine-rootfs.ext4 MANIFEST.txt > SHA256SUMS)
echo "Alpine riscv64 rootfs built:"
cat "$OUT/SHA256SUMS"
ls -la "$OUT/alpine-rootfs.ext4"
