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
# E3.5-T02: util-linux (real unshare/nsenter/setpriv/pivot_root), iproute2 (ip), e2fsprogs
# (mkfs.ext4 for loop/overlay) — the container primitives busybox's applets can't fully drive.
PKGS="alpine-base busybox-suid openrc util-linux iproute2 e2fsprogs"

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
  -v "$PWD/tools/guest/container-smoke.sh:/container-smoke.sh:ro" \
  -e MIRROR="$MIRROR" \
  -e FS_UUID="$FS_UUID" \
  -e SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  -e IMG_SIZE="$IMG_SIZE" \
  -e PKGS="$PKGS" \
  -e ALPINE_BRANCH="$ALPINE_BRANCH" \
  "$IMG_TAG" /rootfs-inner.sh

# MANIFEST drift gate (critic #3): apk resolves "latest within v3.20", so a mirror-side
# point-release bump (busybox -r31→-r32, a libcrypto CVE patch, …) silently changes the image.
# The build wrote the freshly-resolved set to MANIFEST.new; diff it against the committed lock
# and FAIL on drift so the change is reviewed. UPDATE_MANIFEST=1 accepts + refreshes the lock.
NEW="$OUT/MANIFEST.new"; LOCK="$OUT/MANIFEST.txt"
if [ -f "$LOCK" ] && ! diff -q "$LOCK" "$NEW" >/dev/null 2>&1; then
  if [ "${UPDATE_MANIFEST:-0}" = 1 ]; then
    echo "MANIFEST drift ACCEPTED (UPDATE_MANIFEST=1):"; diff "$LOCK" "$NEW" || true
    mv "$NEW" "$LOCK"
  else
    echo "ERROR: resolved package set drifted from the committed MANIFEST.txt lock:" >&2
    diff "$LOCK" "$NEW" >&2 || true
    echo "Review the diff; re-run with UPDATE_MANIFEST=1 to accept it." >&2
    exit 1
  fi
else
  mv "$NEW" "$LOCK"
fi

# Hash ONLY the reproducible MANIFEST lock. The .ext4 is deliberately NOT hash-pinned here: it
# is gitignored and its bytes are build-instance-specific (per-build mtimes/metadata — see
# docs/rootfs.md), so a committed image hash would be an unverifiable pin (critic #2). The
# MANIFEST lock + in-container fsck/foreign-ELF gates ARE the integrity guarantees.
(cd "$OUT" && shasum -a 256 MANIFEST.txt > SHA256SUMS)
echo "Alpine riscv64 rootfs built (signatures verified, package lock enforced):"
cat "$OUT/SHA256SUMS"
ls -la "$OUT/alpine-rootfs.ext4"
