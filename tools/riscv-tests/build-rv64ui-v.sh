#!/usr/bin/env bash
# Build the official riscv-tests rv64ui-**v** (virtual-memory) suite (E1-T16) into committed ELFs.
# The `v` environment runs each test in S/U mode under Sv39 paging with an identity-mapped page
# table + a full trap handler — a pass proves the whole MMU + trap-delivery + PMP stack works.
#
# BLOCKED (2026-07-03): the `v` env is a full runtime — env/v/vm.c #includes <string.h>/<stdio.h>,
# which the E0-T13 toolchain image (`wasm-vm-toolchain:local`) does NOT provide (it's a bare
# cross-gcc with no newlib headers; the p-env is header-only macros, so it builds fine). Until the
# toolchain gains newlib, the Sv39 walker is validated by the `sv39.rs` unit suite (spec-rule
# coverage), the `sv39_e2e.rs` end-to-end integration tests, and the adversarial critic's Spike
# page-table-corpus differential. This script is kept ready for a newlib-equipped toolchain.
#
# Runs INSIDE the E0-T13 reference toolchain:
#
#   tools/toolchain/run.sh -- tools/riscv-tests/build-rv64ui-v.sh
#
# Same pinned SHAs / reproducibility recipe as build.sh (E0-T19). ELFs are committed, so the
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

# The `v` env is a full runtime: entry.S (reset vector + M-mode trap vector + mret to S), vm.c
# (page-table setup, satp/PMP init, demand-paging fault handler), and string.c — all linked with
# every test. So we compile the runtime once and link it against each test object.
cflags=(-march=rv64gc_zicsr -mabi=lp64 -static -nostdlib -nostartfiles
  -fno-pic -ffreestanding -fno-common -std=gnu99 -O2
  "-ffile-prefix-map=${rt}=."
  -I "${rt}/env/v" -I "${rt}/env" -I "${rt}/isa/macros/scalar")
riscv64-unknown-elf-gcc "${cflags[@]}" -frandom-seed=rv64ui-v-entry -c "${rt}/env/v/entry.S" -o "${work}/entry.o"
riscv64-unknown-elf-gcc "${cflags[@]}" -frandom-seed=rv64ui-v-vm -c "${rt}/env/v/vm.c" -o "${work}/vm.o"
riscv64-unknown-elf-gcc "${cflags[@]}" -frandom-seed=rv64ui-v-string -c "${rt}/env/v/string.c" -o "${work}/string.o"

obj="${work}/input.o"
count=0
for src in "${rt}"/isa/rv64ui/*.S; do
  name="$(basename "${src}" .S)"
  riscv64-unknown-elf-gcc "${cflags[@]}" -frandom-seed="rv64ui-v-${name}" -c "${src}" -o "${obj}"
  riscv64-unknown-elf-gcc "${cflags[@]}" \
    -Wl,--no-relax -Wl,--build-id=none -Wl,--no-warn-rwx-segments \
    -T "${rt}/env/v/link.ld" \
    "${work}/entry.o" "${work}/vm.o" "${work}/string.o" "${obj}" \
    -o "${out_dir}/rv64ui-v-${name}"
  count=$((count + 1))
done
rm -f "${obj}"

echo "riscv-tests: built ${count} rv64ui-v ELFs into ${out_dir}"
ls "${out_dir}" | grep rv64ui-v | sort | sed 's/^/  /'
