#!/usr/bin/env bash
# Run inside the existing wasm-vm-kernel-build:local container, repo at /work.
# No network, C library, or external source checkout is required.
set -euo pipefail
cd "$(dirname "$0")/../.."
riscv64-linux-gnu-gcc -march=rv64gc -mabi=lp64 -nostdlib -nostartfiles \
  -static -fno-pic -Wl,--no-relax -Wl,--build-id=none \
  -T guest/misaligned-virtual-pages.ld guest/misaligned-virtual-pages.S \
  -o tests/riscv-tests-bin/rv64mi-p-misaligned-virtual-pages
