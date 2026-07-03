#!/usr/bin/env bash
# Build the official riscv-tests rv64ua-p (A-extension) suite (E1-T04) into committed ELFs.
#
# Runs INSIDE the E0-T13 reference toolchain:
#
#   tools/toolchain/run.sh -- tools/riscv-tests/build-rv64ua.sh
#
# Same pinned SHAs / reproducibility recipe as build.sh (E0-T19); only the source dir
# (isa/rv64ua) and -march (rv64ia, so the assembler emits LR/SC/AMO) differ. The p-env
# CSR startup is executed by the `zicsr-stub` feature exactly as for rv64ui; the M ops
# themselves decode in every build (they are not feature-gated). ELFs are committed, so the
# cargo harness needs no Docker.
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
export SOURCE_DATE_EPOCH=0

obj="${work}/input.o"
count=0
for src in "${rt}"/isa/rv64ua/*.S; do
  name="$(basename "${src}" .S)"
  # -march=rv64ia_zicsr: base integer + A (atomics under test) + zicsr (p-env CSR startup).
  cflags=(-march=rv64ia_zicsr -mabi=lp64 -static -nostdlib -nostartfiles
    -fno-pic -ffreestanding -fno-common
    "-ffile-prefix-map=${rt}=." "-frandom-seed=rv64ua-${name}"
    -I "${rt}/env/p" -I "${rt}/env" -I "${rt}/isa/macros/scalar")
  riscv64-unknown-elf-gcc "${cflags[@]}" -c "${src}" -o "${obj}"
  riscv64-unknown-elf-gcc "${cflags[@]}" \
    -Wl,--no-relax -Wl,--build-id=none -Wl,--no-warn-rwx-segments \
    -T "${rt}/env/p/link.ld" \
    "${obj}" -o "${out_dir}/rv64ua-p-${name}"
  count=$((count + 1))
done
rm -f "${obj}"

echo "riscv-tests: built ${count} rv64ua-p ELFs into ${out_dir}"
ls "${out_dir}" | grep rv64ua | sort | sed 's/^/  /'
