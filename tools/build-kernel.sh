#!/usr/bin/env bash
# E2-T12: one-command reproducible riscv64 kernel build (Docker-only host requirement).
#   bash tools/build-kernel.sh          → releases/kernel/<version>/{Image,System.map,config,SHA256SUMS}
#
# Reproducibility levers: the tarball is PINNED by version + sha256; KBUILD_BUILD_TIMESTAMP
# is fixed; KBUILD_BUILD_USER/HOST are fixed in the image; the cross toolchain comes from
# the container, never the host.
set -euo pipefail
cd "$(dirname "$0")/.."

KVER=6.6.63
KSHA256=d1054ab4803413efe2850f50f1a84349c091631ec50a1cf9e891d1b1f9061835
KURL="https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KVER}.tar.xz"
# Fixed timestamp for byte-reproducible banners (any constant works; this is v6.6.63's date).
export KBUILD_BUILD_TIMESTAMP="Thu Nov 14 2024"

OUT="releases/kernel/${KVER}"
WORK="target/kernel-build"
IMG_TAG="wasm-vm-kernel-build:local"

mkdir -p "$WORK" "$OUT"

# 1. Fetch + verify the pinned tarball (cache in target/).
TARBALL="$WORK/linux-${KVER}.tar.xz"
if [ ! -f "$TARBALL" ] || ! echo "$KSHA256  $TARBALL" | shasum -a 256 -c - >/dev/null 2>&1; then
  echo "fetching linux-${KVER}.tar.xz..."
  curl -fL "$KURL" -o "$TARBALL"
fi
echo "$KSHA256  $TARBALL" | shasum -a 256 -c -

# 2. Build the container image (context = tools/ only; tiny).
docker build -q -f tools/kernel.Dockerfile -t "$IMG_TAG" tools >/dev/null

# 3. Build entirely inside a container-native VOLUME. Docker Desktop's macOS bind mount
#    (virtiofs) cannot survive a parallel kernel build's open-file churn ("Too many open
#    files" even with nofile=1M) — so only the small tarball comes in read-only and only
#    the 3 artifacts go out through a bind mount at the very end.
BUILD_VOL="wasm-vm-kbuild-${KVER}"
docker volume create "$BUILD_VOL" >/dev/null
rm -rf "${OUT:?}"/Image "${OUT}/System.map" "${OUT}/config"

docker run --rm \
  --ulimit nofile=1048576:1048576 \
  -v "$BUILD_VOL:/build" \
  -v "$PWD/$TARBALL:/src/linux-${KVER}.tar.xz:ro" \
  -v "$PWD/configs/wasm-vm.config:/cfg/wasm-vm.config:ro" \
  -v "$PWD/$OUT:/out" \
  -e KBUILD_BUILD_TIMESTAMP="$KBUILD_BUILD_TIMESTAMP" \
  "$IMG_TAG" bash -ceu "
    cd /build
    if [ ! -d linux-${KVER} ]; then tar xf /src/linux-${KVER}.tar.xz; fi
    cd linux-${KVER}
    make defconfig
    scripts/kconfig/merge_config.sh -m .config /cfg/wasm-vm.config
    make olddefconfig
    make -j\$(nproc) Image
    # `cat >` avoids cp's fallocate/deallocate dance, which errors on Docker Desktop's
    # virtiofs output mount even though the bytes copy fine.
    cat arch/riscv/boot/Image  > /out/Image
    cat System.map             > /out/System.map
    cat .config                > /out/config
  "

# 4. Hashes (computed host-side over the copied-out artifacts).
(cd "$OUT" && shasum -a 256 Image System.map config > SHA256SUMS)

# 5. Sanity: no modules anywhere in the final config.
if grep -q '=m$' "$OUT/config"; then
  echo "ERROR: modular config leaked (=m present)"; exit 1
fi
echo "kernel ${KVER} built:"
cat "$OUT/SHA256SUMS"
