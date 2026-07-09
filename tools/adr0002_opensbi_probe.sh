#!/usr/bin/env bash
# ADR 0002 (E2-T03) option-(b) probe: boot the QEMU-distribution OpenSBI fw_dynamic on our
# emulator and capture its console transcript. Extracts the ELF from the toolchain image,
# then runs the ignored `opensbi_fw_dynamic_boots` prototype with output shown.
set -euo pipefail
cd "$(dirname "$0")/.."

ELF=target/fw_dynamic.elf
if [ ! -f "$ELF" ]; then
  echo "extracting opensbi-riscv64-generic-fw_dynamic.elf from the toolchain image..."
  bash tools/toolchain/run.sh -- bash -lc 'cat /usr/share/qemu/opensbi-riscv64-generic-fw_dynamic.elf' > "$ELF"
fi
ls -la "$ELF"

WASM_VM_OPENSBI="$PWD/$ELF" \
  cargo test -p wasm-vm-core --test boot_contract -- --ignored --nocapture
