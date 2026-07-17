#!/usr/bin/env bash
# E2-T18: one-command reproducible Alpine riscv64 ext4 rootfs (Docker-only host requirement).
#   bash tools/build-rootfs.sh   → releases/rootfs/{alpine-rootfs.ext4,SHA256SUMS,MANIFEST.txt}
#
# Approach (b): a host-arch Alpine container cross-installs the riscv64 root with `apk.static
# --arch riscv64` (UNPACK only — no binfmt/qemu-user, no privileged loop mounts), configures
# it for a serial console + root login, and packs it with `mke2fs -d`. Everything is pinned to
# Alpine v3.20 and fixed filesystem metadata so a clean-clone rebuild is byte-identical.
set -euo pipefail
cd "$(dirname "$0")/.."

ALPINE_BRANCH=v3.20
MIRROR_BASE="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}"
MAIN_REPO="${MIRROR_BASE}/main"
COMMUNITY_REPO="${MIRROR_BASE}/community"
# Fixed ext4 UUID + a fixed epoch so rebuilds don't drift on random UUID / mtimes.
FS_UUID="a11ce000-0e2f-4c18-b007-f50000000018"
export SOURCE_DATE_EPOCH=1731542400 # 2024-11-14, matches the kernel banner date
IMG_SIZE=512M
# The riscv64 root package set: alpine-base pulls openrc+busybox+musl+baselayout; busybox-suid
# gives setuid login/passwd; the rest make it feel like a real system.
# E3.5-T02: util-linux (real unshare/nsenter/setpriv/pivot_root), iproute2 (ip), e2fsprogs
# (mkfs.ext4 for loop/overlay) — the container primitives busybox's applets can't fully drive.
BASE_PKGS="alpine-base busybox-suid openrc util-linux iproute2 e2fsprogs ca-certificates curl nano"
PKGS="$BASE_PKGS ${EXTRA_PKGS:-}"

# Normal builds install the exact transitive package versions in the committed lock. Package-bump
# and churn experiments deliberately re-resolve the requested world, then the host-side drift gate
# either updates the lock or refuses/ignores it explicitly.
LOCKED_INSTALL=1
if [ "${UPDATE_MANIFEST:-0}" = 1 ]; then LOCKED_INSTALL=0; fi

OUT="releases/rootfs"
IMG_TAG="wasm-vm-rootfs-build:local"
mkdir -p "$OUT"

# Build the pinned build image (context = tools/ only). The cold-cache adversarial gate can force
# every layer to rebuild without changing the production command or tag.
if [ "${DOCKER_BUILD_NO_CACHE:-0}" = 1 ]; then
  docker build --no-cache -q -f tools/rootfs.Dockerfile -t "$IMG_TAG" tools >/dev/null
else
  docker build -q -f tools/rootfs.Dockerfile -t "$IMG_TAG" tools >/dev/null
fi

# The whole build runs in the container (tools/rootfs-inner.sh); only the finished image +
# manifest come out through the bind mount.
docker run --rm \
  -v "$PWD/$OUT:/out" \
  -v "$PWD/tools/rootfs-inner.sh:/rootfs-inner.sh:ro" \
  -v "$PWD/tools/guest/container-smoke.sh:/container-smoke.sh:ro" \
  -v "$PWD/tools/guest/wvrun.sh:/wvrun.sh:ro" \
  -e MAIN_REPO="$MAIN_REPO" \
  -e COMMUNITY_REPO="$COMMUNITY_REPO" \
  -e FS_UUID="$FS_UUID" \
  -e SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  -e IMG_SIZE="$IMG_SIZE" \
  -e PKGS="$PKGS" \
  -e EXTRA_PKGS="${EXTRA_PKGS:-}" \
  -e LOCKED_INSTALL="$LOCKED_INSTALL" \
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
  elif [ "${ALLOW_MANIFEST_DRIFT:-0}" = 1 ]; then
    echo "MANIFEST drift expected for a disposable package-variant build:" >&2
    diff "$LOCK" "$NEW" >&2 || true
    rm -f "$NEW"
  else
    echo "ERROR: resolved package set drifted from the committed MANIFEST.txt lock:" >&2
    diff "$LOCK" "$NEW" >&2 || true
    echo "Review the diff; re-run with UPDATE_MANIFEST=1 to accept it." >&2
    exit 1
  fi
else
  mv "$NEW" "$LOCK"
fi

# The package lock is the committed review surface; the generated ext4 stays gitignored and its
# content hash is recorded in the chunked artifact's image-info.json. E3-T11 pins all ext4 clocks,
# UUID, directory hash seed, source-tree timestamps, and imported inode ctimes, so the image bytes
# and manifest are now reproducible as asserted by tools/build_image/build.sh's double-build gate.
(cd "$OUT" && shasum -a 256 MANIFEST.txt > SHA256SUMS)
echo "Alpine riscv64 rootfs built (signatures verified, package lock enforced):"
cat "$OUT/SHA256SUMS"
ls -la "$OUT/alpine-rootfs.ext4"
