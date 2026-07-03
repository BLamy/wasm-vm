#!/usr/bin/env bash
# Build the official riscv-tests rv64ui-p suite (E0-T19) into committed ELFs.
#
# Runs INSIDE the E0-T13 reference toolchain (invoke via the container so the pinned
# riscv64-unknown-elf-gcc is used):
#
#   tools/toolchain/run.sh -- tools/riscv-tests/build.sh
#
# It clones riscv-tests + its env submodule at the SHAs pinned in versions.env, compiles
# every isa/rv64ui/*.S test against the physical-memory ("p") environment, and writes
# rv64ui-p-<name> ELFs to tests/riscv-tests-bin/. The p-env startup touches machine CSRs,
# so the assembler needs `zicsr`; the emulator executes those via the `zicsr-stub`
# feature (E0-T19). The ELFs are committed, so the cargo harness needs no Docker.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
# shellcheck source=../toolchain/versions.env
. "${repo_root}/tools/toolchain/versions.env"

: "${RISCV_TESTS_SHA:?pin RISCV_TESTS_SHA in versions.env}"
: "${RISCV_TEST_ENV_SHA:?pin RISCV_TEST_ENV_SHA in versions.env}"

out_dir="${repo_root}/tests/riscv-tests-bin"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

echo "riscv-tests: cloning ${RISCV_TESTS_SHA} (env ${RISCV_TEST_ENV_SHA})"
git clone --quiet https://github.com/riscv-software-src/riscv-tests.git "${work}/rt"
git -C "${work}/rt" checkout --quiet "${RISCV_TESTS_SHA}"
git -C "${work}/rt" -c protocol.file.allow=always submodule update --quiet --init env
git -C "${work}/rt/env" checkout --quiet "${RISCV_TEST_ENV_SHA}"

rt="${work}/rt"
mkdir -p "${out_dir}"
# Reproducible: strip the mtime/uid noise gcc would otherwise bake in.
export SOURCE_DATE_EPOCH=0

# Reproducibility (same recipe as guest/Makefile, E0-T14): a ONE-STEP compile+link leaks
# the random temp `.o` name into `.strtab`, so compile to a FIXED-name `.o` first, then
# link. -ffile-prefix-map strips the build path; -frandom-seed pins symbol hashing;
# --build-id=none drops the nondeterministic build-id note.
obj="${work}/input.o"
count=0
for src in "${rt}"/isa/rv64ui/*.S; do
  name="$(basename "${src}" .S)"
  # -march=rv64i_zicsr_zifencei: base integer + zicsr (p-env CSR startup) + zifencei (only
  # fence_i.S uses fence.i). Every ELF is built — including fence_i, which the harness skips
  # at runtime (Zifencei out of Level-0 scope) so the "run including skips" audit has
  # something to observe. The emulator still runs pure rv64i + the quarantined stub.
  cflags=(-march=rv64i_zicsr_zifencei -mabi=lp64 -static -nostdlib -nostartfiles
    -fno-pic -ffreestanding -fno-common
    "-ffile-prefix-map=${rt}=." "-frandom-seed=rv64ui-${name}"
    -I "${rt}/env/p" -I "${rt}/env" -I "${rt}/isa/macros/scalar")
  riscv64-unknown-elf-gcc "${cflags[@]}" -c "${src}" -o "${obj}"
  riscv64-unknown-elf-gcc "${cflags[@]}" \
    -Wl,--no-relax -Wl,--build-id=none -Wl,--no-warn-rwx-segments \
    -T "${rt}/env/p/link.ld" \
    "${obj}" -o "${out_dir}/rv64ui-p-${name}"
  count=$((count + 1))
done
rm -f "${obj}"

echo "riscv-tests: built ${count} rv64ui-p ELFs into ${out_dir}"
ls "${out_dir}" | sort | sed 's/^/  /'
