#!/usr/bin/env bash
# E4-T03: pack the committed benchmark ELFs into a small, REPRODUCIBLE ext4 overlay
# (bench/guest/bench.ext4). The harness attaches it as a SECOND virtio-blk drive (/dev/vdb),
# so the guest mounts a KNOWN binary — deleting the overlay makes the harness fail loudly
# (adversarial #4) rather than silently benchmarking something from the base rootfs.
#
#   bench/mkimage.sh
#
# Reuses the reproducible `mke2fs -d` recipe from tools/rootfs-inner.sh (fixed UUID + hash_seed,
# E2FSPROGS_FAKE_TIME, ^metadata_csum, normalized mtimes) so the image is byte-stable. Runs
# inside the pinned bench toolchain image (bench/toolchain/, which ships e2fsprogs), UID-mapped.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=toolchain/versions.env
. "${here}/toolchain/versions.env"
repo_root="$(cd "${here}/.." && pwd)"

export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1704067200}"  # match bench/build.sh
# Fixed filesystem UUID → deterministic superblock + htree hash seed (else random per build).
FS_UUID="b3c40000-0000-4003-a000-be0000000003"
IMG_SIZE="16M"

for f in coremark.rv64 dhrystone.rv64; do
  [ -f "${here}/guest/${f}" ] || { echo "bench/mkimage: missing ${here}/guest/${f} — run bench/build.sh first" >&2; exit 1; }
done

echo "bench/mkimage: building ${IMAGE_TAG} (ensures e2fsprogs present)…" >&2
docker build \
  --platform "${BUILD_PLATFORM}" \
  --build-arg "UBUNTU_DIGEST=${UBUNTU_DIGEST}" \
  --build-arg "GCC_RISCV64_LINUX_VERSION=${GCC_RISCV64_LINUX_VERSION}" \
  --build-arg "LIBC6_DEV_RISCV64_VERSION=${LIBC6_DEV_RISCV64_VERSION}" \
  -t "${IMAGE_TAG}" \
  "${here}/toolchain" >&2

echo "bench/mkimage: packing bench.ext4 (fixed UUID ${FS_UUID})…" >&2
docker run --rm \
  --platform "${BUILD_PLATFORM}" \
  --user "$(id -u):$(id -g)" \
  -v "${repo_root}:/work" \
  -w /work/bench/guest \
  -e HOME=/tmp \
  -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
  -e "E2FSPROGS_FAKE_TIME=${SOURCE_DATE_EPOCH}" \
  "${IMAGE_TAG}" \
  bash -euo pipefail -c '
    stage="$(mktemp -d)"
    install -Dm755 coremark.rv64  "$stage/bench/coremark.rv64"
    install -Dm755 dhrystone.rv64 "$stage/bench/dhrystone.rv64"
    # Normalize every mtime/atime so the inode table is byte-stable (see rootfs-inner.sh).
    find "$stage" -exec touch -h -d "@'"${SOURCE_DATE_EPOCH}"'" {} +
    rm -f bench.ext4
    mke2fs -q -t ext4 -O ^metadata_csum -L bench -U "'"${FS_UUID}"'" \
      -E "root_owner=0:0,hash_seed='"${FS_UUID}"'" \
      -d "$stage" bench.ext4 "'"${IMG_SIZE}"'"
    rm -rf "$stage"
  '

cd "${here}/guest"
sha256sum bench.ext4 2>/dev/null || shasum -a 256 bench.ext4
echo "bench/mkimage: done → bench/guest/bench.ext4" >&2
