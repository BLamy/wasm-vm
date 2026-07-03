#!/usr/bin/env bash
# E0-T20 SECONDARY cross-check: compare our PC sequence against QEMU's (pc-level ONLY —
# QEMU's exec log has no instruction word or register writeback, so this is strictly
# coarser than the Spike differential in run_diff.sh; use that as the correctness bar).
# Catches control-flow divergence from a second independent implementation.
#
#   tools/diff/run_diff_qemu.sh <elf> [--max N]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"

max_arg=()
elf=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --max) max_arg=(--max "$2"); shift 2 ;;
    -*) echo "run_diff_qemu: unknown flag $1" >&2; exit 2 ;;
    *) elf="$1"; shift ;;
  esac
done
[ -f "${elf:-}" ] || { echo "usage: run_diff_qemu.sh <elf> [--max N]" >&2; exit 2; }

entry="$(python3 -c 'import struct,sys;f=open(sys.argv[1],"rb");f.seek(24);print(hex(struct.unpack("<Q",f.read(8))[0]))' "${elf}")"
rel="$(python3 -c 'import os,sys;print(os.path.relpath(os.path.abspath(sys.argv[1]),sys.argv[2]))' "${elf}" "${repo_root}")"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

cargo build --release -p wasm-vm-cli >/dev/null 2>&1
# Our PC sequence, extracted from the canonical trace.
"${repo_root}/target/release/wasm-vm" run "${elf}" --trace "${work}/ours.trace" >/dev/null 2>&1 || true
sed -E 's/^core 0: (0x[0-9a-f]+) .*/\1/' "${work}/ours.trace" > "${work}/ours.pc"

# QEMU one-insn-per-tb exec trace → PC sequence. QEMU, like Spike, does not halt on our
# HTIF write and spins on the guest's post-exit tail, so bound it: `head` caps the line
# count (SIGPIPE-ing QEMU) and `timeout` is a hard backstop. Our trace (a few hundred
# lines at most) is authoritative on length, so a few thousand QEMU lines is ample.
"${repo_root}/tools/toolchain/run.sh" -- bash -c \
  "timeout 15 qemu-system-riscv64 -M virt -bios none -kernel '${rel}' -accel tcg,one-insn-per-tb=on -d exec,nochain -nographic -serial none 2>&1 | head -n 5000" \
  > "${work}/qemu.raw" 2>/dev/null || true
python3 "${here}/normalize_qemu.py" --entry "${entry}" < "${work}/qemu.raw" 2>/dev/null > "${work}/qemu.pc"

# Both files are already bare "0x{pc}" lines; --level pc is the honest label (QEMU carries
# no insn/rd, so this is a pc-only check).
python3 "${here}/report.py" "${work}/ours.pc" "${work}/qemu.pc" --level pc \
  ${max_arg[@]+"${max_arg[@]}"}
