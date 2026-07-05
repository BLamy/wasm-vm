#!/usr/bin/env bash
# E2-T13: one-command reproducible static-busybox initramfs (Docker-only host).
#   bash tools/build-initramfs.sh → releases/initramfs/{initramfs.cpio.gz,busybox,SHA256SUMS}
#
# Reproducibility: busybox pinned by version + sha256; static link; the cpio is built with a
# SORTED file list and a FIXED mtime (SOURCE_DATE_EPOCH), and gzip -n drops its timestamp —
# so a clean rebuild is byte-identical.
set -euo pipefail
cd "$(dirname "$0")/.."

BBVER=1.36.1
BBSHA256=b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314
BBURL="https://busybox.net/downloads/busybox-${BBVER}.tar.bz2"
# Fixed epoch for reproducible cpio mtimes (2024-11-14 UTC; any constant works).
export SOURCE_DATE_EPOCH=1731542400

OUT="releases/initramfs"
WORK="target/initramfs-build"
IMG_TAG="wasm-vm-initramfs-build:local"
BUILD_VOL="wasm-vm-bbbuild-${BBVER}"

mkdir -p "$WORK" "$OUT"

# 1. Fetch + verify the pinned busybox tarball.
TARBALL="$WORK/busybox-${BBVER}.tar.bz2"
if [ ! -f "$TARBALL" ] || ! echo "$BBSHA256  $TARBALL" | shasum -a 256 -c - >/dev/null 2>&1; then
  echo "fetching busybox-${BBVER}.tar.bz2..."
  curl -fL "$BBURL" -o "$TARBALL"
fi
echo "$BBSHA256  $TARBALL" | shasum -a 256 -c -

# 2. Build image + build static busybox in a container-native volume (virtiofs can't take
#    a parallel build's fd churn — same lesson as the kernel).
docker build -q -f tools/initramfs.Dockerfile -t "$IMG_TAG" tools >/dev/null
docker volume create "$BUILD_VOL" >/dev/null
rm -f "${OUT:?}"/busybox "${OUT}/initramfs.cpio.gz"

docker run --rm \
  --ulimit nofile=1048576:1048576 \
  -v "$BUILD_VOL:/build" \
  -v "$PWD/$TARBALL:/src/busybox-${BBVER}.tar.bz2:ro" \
  -v "$PWD/tools/initramfs/init:/src/init:ro" \
  -v "$PWD/$OUT:/out" \
  -e SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  "$IMG_TAG" bash -ceu "
    cd /build
    if [ ! -d busybox-${BBVER} ]; then tar xf /src/busybox-${BBVER}.tar.bz2; fi
    cd busybox-${BBVER}
    make defconfig
    # Static, no debug, drop applets that need extra libs or make no sense in initramfs.
    sed -i 's/# CONFIG_STATIC is not set/CONFIG_STATIC=y/' .config
    sed -i 's/^CONFIG_TC=y/# CONFIG_TC is not set/' .config
    make oldconfig </dev/null
    make -j\$(nproc) busybox

    # ── assemble the initramfs root ──
    ROOT=/build/root
    rm -rf \$ROOT; mkdir -p \$ROOT/bin \$ROOT/proc \$ROOT/sys \$ROOT/dev \$ROOT/tmp
    cp busybox \$ROOT/bin/busybox
    cp /src/init \$ROOT/init
    chmod +x \$ROOT/init \$ROOT/bin/busybox

    # ── reproducible newc cpio: sorted paths, FIXED mtimes, fixed owner, then gzip -n ──
    # cpio --reproducible zeroes dev/inode but keeps file mtimes — so normalize every
    # mtime to SOURCE_DATE_EPOCH first, else the archive drifts between builds.
    find \$ROOT -exec touch -h -d @\$SOURCE_DATE_EPOCH {} +
    cd \$ROOT
    find . -mindepth 1 | LC_ALL=C sort | \
      cpio --quiet --reproducible -o -H newc \
        --owner=0:0 > /build/initramfs.cpio
    gzip -n -9 < /build/initramfs.cpio > /out/initramfs.cpio.gz
    cp /build/busybox-${BBVER}/busybox /out/busybox
  "

# 3. Hashes.
(cd "$OUT" && shasum -a 256 initramfs.cpio.gz busybox > SHA256SUMS)

# 4. Sanity: static ELF.
if command -v file >/dev/null 2>&1; then
  file "$OUT/busybox" | grep -q "statically linked" || { echo "ERROR: busybox not static"; exit 1; }
fi
echo "initramfs ${BBVER} built:"
cat "$OUT/SHA256SUMS"
