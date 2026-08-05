#!/usr/bin/env bash
# E4-T03: build the pinned riscv64 CoreMark + Dhrystone guest ELFs REPRODUCIBLY inside the
# pinned cross-toolchain image (bench/toolchain/), then emit their sha256 + a build manifest.
# Mirrors tools/toolchain/run.sh: repo bind-mounted at /work, UID-mapped so artifacts are owned
# by the invoking user, image pinned by digest + apt version (bench/toolchain/versions.env).
#
#   bench/build.sh                 # build the image if absent, then compile the ELFs
#   bench/build.sh --no-cache      # force a from-scratch image rebuild (AC4 reproducibility check)
#
# Determinism levers (AC4 — byte-identical rebuild):
#   * pinned base image DIGEST + exact apt gcc/glibc versions + fixed BUILD_PLATFORM (amd64)
#   * SOURCE_DATE_EPOCH + -ffile-prefix-map (no build path leaks) + -g0 + strip (no debug/comment)
# Tuning knobs (env), baked as the committed defaults below:
#   COREMARK_ITERATIONS  CoreMark fixed iteration count (tuned so the in-guest run is ~12-15 s).
#   DHRYSTONE_ITERS      Dhrystone run count (tuned so the in-guest run is > 2 s, times() floor).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=toolchain/versions.env
. "${here}/toolchain/versions.env"
repo_root="$(cd "${here}/.." && pwd)"

# --- tuned, committed workload sizes (see bench/README.md for the tuning method) ---
COREMARK_ITERATIONS="${COREMARK_ITERATIONS:-6000}"
DHRYSTONE_ITERS="${DHRYSTONE_ITERS:-30000000}"

# Reproducible-build epoch (arbitrary fixed instant; must not track the wall clock).
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1704067200}"  # 2024-01-01T00:00:00Z

no_cache=""
[ "${1:-}" = "--no-cache" ] && no_cache="--no-cache"

echo "bench/build: building toolchain image ${IMAGE_TAG} (platform ${BUILD_PLATFORM})…" >&2
docker build ${no_cache} \
  --platform "${BUILD_PLATFORM}" \
  --build-arg "UBUNTU_DIGEST=${UBUNTU_DIGEST}" \
  --build-arg "GCC_RISCV64_LINUX_VERSION=${GCC_RISCV64_LINUX_VERSION}" \
  --build-arg "LIBC6_DEV_RISCV64_VERSION=${LIBC6_DEV_RISCV64_VERSION}" \
  -t "${IMAGE_TAG}" \
  "${here}/toolchain" >&2

# The compiler triple installed by gcc-13-riscv64-linux-gnu.
CC="riscv64-linux-gnu-gcc-13"
STRIP="riscv64-linux-gnu-strip"

# Common flags: static Linux ELF, -O2, rv64gc/lp64d (the Alpine guest kernel's ISA), no debug
# info or build-path leaks. -DPERFORMANCE_RUN + SEED_VOLATILE give CoreMark the official
# performance-run seeds with no argv; the CRC self-check then validates in-guest.
COMMON="-static -O2 -g0 -march=rv64gc -mabi=lp64d -ffile-prefix-map=${repo_root}=. -ffile-prefix-map=/work=."
FLAGS_STR="${COMMON} -DPERFORMANCE_RUN=1 -DITERATIONS=${COREMARK_ITERATIONS}"

echo "bench/build: compiling coremark.rv64 (ITERATIONS=${COREMARK_ITERATIONS}) + dhrystone.rv64 (DHRY_ITERS=${DHRYSTONE_ITERS})…" >&2

# Compile inside the pinned image. `-e SOURCE_DATE_EPOCH` freezes any clock reads; UID mapping
# keeps the emitted ELFs owned by the caller. Everything runs relative to /work/bench so __FILE__
# paths are repo-relative and identical across hosts.
docker run --rm \
  --platform "${BUILD_PLATFORM}" \
  --user "$(id -u):$(id -g)" \
  -v "${repo_root}:/work" \
  -w /work/bench \
  -e HOME=/tmp \
  -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
  "${IMAGE_TAG}" \
  bash -euo pipefail -c '
    CC="'"${CC}"'"; STRIP="'"${STRIP}"'"
    COMMON="'"${COMMON}"'"
    cm=guest/src/coremark
    "$CC" $COMMON \
      -DPERFORMANCE_RUN=1 -DSEED_METHOD=SEED_VOLATILE \
      -DITERATIONS='"${COREMARK_ITERATIONS}"' \
      -DFLAGS_STR="\"'"${FLAGS_STR}"'\"" \
      -I"$cm" \
      "$cm/core_list_join.c" "$cm/core_main.c" "$cm/core_matrix.c" \
      "$cm/core_state.c" "$cm/core_util.c" "$cm/core_portme.c" \
      -o guest/coremark.rv64
    "$STRIP" guest/coremark.rv64

    dh=guest/src/dhrystone
    # -std=gnu89: the 1988 Dhrystone relies on K&R implicit declarations (malloc/strcpy/scanf)
    # which are hard errors under gcc-13 default C17.
    # -DTIME: use the time(2) (whole-second) timer — the same knob the vendored upstream Makefile
    #   uses. The alternative times(2) path redeclares `extern int times()`, which conflicts with
    #   glibc `clock_t times(struct tms*)` (a hard error). We compensate for the 1 s resolution by
    #   tuning DHRY_ITERS so the run lasts well over 10 s (quantization << the 5 % noise budget).
    "$CC" $COMMON -std=gnu89 -Wno-implicit -Wno-builtin-declaration-mismatch \
      -DTIME -DDHRY_ITERS='"${DHRYSTONE_ITERS}"' \
      -I"$dh" \
      "$dh/dhry_1.c" "$dh/dhry_2.c" \
      -o guest/dhrystone.rv64
    "$STRIP" guest/dhrystone.rv64
  '

# --- SHA256SUMS + MANIFEST (the durable, adversarial-#4 anti-drift record) ---
cd "${here}/guest"
sha256sum coremark.rv64 dhrystone.rv64 > SHA256SUMS 2>/dev/null \
  || shasum -a 256 coremark.rv64 dhrystone.rv64 > SHA256SUMS
image_id="$(docker image inspect --format '{{.Id}}' "${IMAGE_TAG}" 2>/dev/null || echo unknown)"
gcc_ver="$(docker run --rm --platform "${BUILD_PLATFORM}" "${IMAGE_TAG}" "${CC}" -dumpfullversion 2>/dev/null || echo unknown)"
{
  echo "# E4-T03 benchmark ELF build manifest — regenerate with bench/build.sh"
  echo "date_generated:        $(date -u +%Y-%m-%dT%H:%M:%SZ)  # informational only; ELFs are epoch-pinned"
  echo "source_date_epoch:     ${SOURCE_DATE_EPOCH}"
  echo "base_image_digest:     ${UBUNTU_DIGEST}"
  echo "toolchain_image_id:    ${image_id}"
  echo "build_platform:        ${BUILD_PLATFORM}"
  echo "gcc_package:           gcc-13-riscv64-linux-gnu=${GCC_RISCV64_LINUX_VERSION}"
  echo "gcc_version:           ${gcc_ver}"
  echo "libc_package:          libc6-dev-riscv64-cross=${LIBC6_DEV_RISCV64_VERSION}"
  echo "coremark_iterations:   ${COREMARK_ITERATIONS}"
  echo "dhrystone_dhry_iters:  ${DHRYSTONE_ITERS}"
  echo "common_flags:          ${COMMON}"
  echo
  echo "# sha256 (also in SHA256SUMS):"
  sed 's/^/  /' SHA256SUMS
} > MANIFEST.txt

echo "bench/build: done." >&2
cat SHA256SUMS >&2
