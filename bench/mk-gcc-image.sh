#!/usr/bin/env bash
# E4-T04 (phases 2-3): build the in-guest gcc compile-benchmark overlay (bench/guest/gcc.ext4).
#
#   bench/mk-gcc-image.sh
#
# Cross-installs a REAL pinned Alpine riscv64 gcc + musl-dev + binutils toolchain into an ext4
# overlay (the harness attaches it as a SECOND virtio-blk drive, /dev/vdb, mounted read-only at
# /mnt), stages the vendored miniz.{c,h} at /mnt/src/, and bakes a `/mnt/gcc-wrap` shim so the
# in-guest compile is a clean `gcc -O2 -c /mnt/src/miniz.c`.
#
# WHY a real gcc (not tcc/chibicc): the benchmark's adversarial check requires the compiler to
# actually honor `-O2`; tcc/chibicc ignore it. The overlay is ~250-400 MB so it is GITIGNORED —
# the durable committed artifacts are THIS script + bench/guest/gcc-MANIFEST.txt (the pinned,
# resolved package set) + the miniz sources; rebuild on demand.
#
# Reuses the repo's proven reproducible pipeline: the pinned Alpine build image
# (tools/rootfs.Dockerfile: apk-tools-static + e2fsprogs, digest-pinned) + the `apk.static
# --arch riscv64` UNPACK-only cross-install (signatures verified, no qemu-user) + the
# `mke2fs -d` recipe (fixed UUID/hash_seed, E2PROGS_FAKE_TIME, ^metadata_csum) from
# tools/rootfs-inner.sh.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/.." && pwd)"

# --- pins (mirror tools/build-rootfs.sh) ---
ALPINE_BRANCH="v3.20"
MIRROR_BASE="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}"
MAIN_REPO="${MIRROR_BASE}/main"
COMMUNITY_REPO="${MIRROR_BASE}/community"
# The compile toolchain. gcc pulls libgcc + the math libs (gmp/mpfr/mpc/isl) + libstdc++ as deps;
# musl-dev provides the userspace headers miniz #includes; binutils provides `as`/`ld`.
GCC_PKGS="gcc musl-dev binutils"
# Fixed ext4 UUID + epoch → deterministic superblock/htree seed + inode times (E3-T11 recipe).
FS_UUID="9ccc0000-0000-4004-a000-9cc000000004"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1704067200}"  # 2024-01-01T00:00:00Z
IMG_SIZE="${IMG_SIZE:-512M}"                                  # gcc+musl-dev+binutils ~250-350 MB

IMG_TAG="wasm-vm-rootfs-build:local"   # same builder image as tools/build-rootfs.sh

for f in miniz.c miniz.h; do
  [ -f "${here}/guest/src/gcc/${f}" ] || {
    echo "bench/mk-gcc-image: missing ${here}/guest/src/gcc/${f} (see PROVENANCE.md)" >&2; exit 1; }
done

echo "bench/mk-gcc-image: building the pinned Alpine builder image (${IMG_TAG})…" >&2
docker build -q -f "${repo_root}/tools/rootfs.Dockerfile" -t "${IMG_TAG}" "${repo_root}/tools" >/dev/null

echo "bench/mk-gcc-image: cross-installing ${GCC_PKGS} + packing gcc.ext4 (UUID ${FS_UUID})…" >&2
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "${repo_root}:/work" \
  -w /work/bench/guest \
  -e HOME=/tmp \
  -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
  -e "E2FSPROGS_FAKE_TIME=${SOURCE_DATE_EPOCH}" \
  -e "MAIN_REPO=${MAIN_REPO}" \
  -e "COMMUNITY_REPO=${COMMUNITY_REPO}" \
  -e "GCC_PKGS=${GCC_PKGS}" \
  -e "FS_UUID=${FS_UUID}" \
  -e "IMG_SIZE=${IMG_SIZE}" \
  --entrypoint bash \
  "${IMG_TAG}" \
  -euo pipefail -c '
    ROOT="$(mktemp -d)"
    # UNPACK-only riscv64 cross-install; signatures verified against the shipped riscv64 keys
    # (fail-closed, no --allow-untrusted), exactly like tools/rootfs-inner.sh.
    apk.static --arch riscv64 -X "$MAIN_REPO" -X "$COMMUNITY_REPO" \
      --keys-dir /usr/share/apk/keys/riscv64 -U \
      --root "$ROOT" --initdb --no-scripts add $GCC_PKGS

    # Record the exact resolved package set → the drift lock committed as gcc-MANIFEST.txt.
    apk.static --root "$ROOT" info -v | sort > /work/bench/guest/gcc-MANIFEST.new

    # Stage the vendored compile workload.
    install -Dm644 src/gcc/miniz.c "$ROOT/src/miniz.c"
    install -Dm644 src/gcc/miniz.h "$ROOT/src/miniz.h"

    # gcc shim: the overlay is mounted READ-ONLY at /mnt in-guest, so gcc must be told where its
    # sysroot (musl-dev headers), assembler (binutils), and shared libs (cc1 links libmpfr/…) live.
    #  * argv[0]=/mnt/usr/bin/gcc → gcc derives exec-prefix /mnt/usr → finds its own cc1 + fixed hdrs
    #  * --sysroot=/mnt           → system headers resolve to /mnt/usr/include (musl-dev)
    #  * -B/mnt/usr/bin           → the driver finds `as`
    #  * LD_LIBRARY_PATH          → the base rootfs loader resolves cc1/as NEEDED libs from the overlay
    # It echoes the FULLY RESOLVED command line (adversarial #3: prove -O2 really reached gcc).
    install -d "$ROOT/mnt-placeholder" 2>/dev/null || true
    cat > "$ROOT/gcc-wrap" <<"WRAP"
#!/bin/sh
# E4-T04 in-guest gcc shim (overlay mounted read-only at /mnt).
PREFIX=/mnt
export LD_LIBRARY_PATH="$PREFIX/usr/lib:$PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
echo "GCC_CMDLINE: $PREFIX/usr/bin/gcc --sysroot=$PREFIX -B$PREFIX/usr/bin $*"
exec "$PREFIX/usr/bin/gcc" --sysroot="$PREFIX" -B"$PREFIX/usr/bin" "$@"
WRAP
    chmod 0755 "$ROOT/gcc-wrap"
    rmdir "$ROOT/mnt-placeholder" 2>/dev/null || true

    # Normalize all timestamps so the inode table is byte-stable (rootfs-inner.sh recipe).
    find "$ROOT" -exec touch -h -d "@'"${SOURCE_DATE_EPOCH}"'" {} +
    rm -f gcc.ext4
    mke2fs -q -t ext4 -O ^metadata_csum -L gcc -U "$FS_UUID" \
      -E "root_owner=0:0,hash_seed=$FS_UUID" \
      -d "$ROOT" gcc.ext4 "$IMG_SIZE"
    rm -rf "$ROOT"
  '

# --- gcc-MANIFEST.txt (the pinned, resolved package set + overlay sha256 anti-drift record) ---
cd "${here}/guest"
gcc_pkg_ver="$(grep -E '^gcc-[0-9]' gcc-MANIFEST.new | head -1 || echo 'gcc-unknown')"
overlay_sha="$(sha256sum gcc.ext4 2>/dev/null | awk '{print $1}' || shasum -a 256 gcc.ext4 | awk '{print $1}')"
{
  echo "# E4-T04 in-guest gcc benchmark overlay — pinned resolved package set."
  echo "# Regenerate with bench/mk-gcc-image.sh. The overlay (gcc.ext4) is GITIGNORED; this manifest"
  echo "# + bench/mk-gcc-image.sh + the vendored miniz sources are the durable committed artifacts."
  echo "alpine_branch:      ${ALPINE_BRANCH}"
  echo "main_repo:          ${MAIN_REPO}"
  echo "community_repo:     ${COMMUNITY_REPO}"
  echo "requested_pkgs:     ${GCC_PKGS}"
  echo "gcc_package:        ${gcc_pkg_ver}"
  echo "fs_uuid:            ${FS_UUID}"
  echo "source_date_epoch:  ${SOURCE_DATE_EPOCH}"
  echo "img_size:           ${IMG_SIZE}"
  echo "gcc_ext4_sha256:    ${overlay_sha}"
  echo
  echo "# Fully-resolved installed package set (name-version-rN), sorted:"
  sed 's/^/  /' gcc-MANIFEST.new
} > gcc-MANIFEST.txt
rm -f gcc-MANIFEST.new

echo "bench/mk-gcc-image: done → bench/guest/gcc.ext4 (sha256 ${overlay_sha})" >&2
echo "bench/mk-gcc-image: manifest → bench/guest/gcc-MANIFEST.txt" >&2
