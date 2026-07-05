#!/usr/bin/env bash
# E1-T20 (acceptance #2): the DUT isa yaml must HONESTLY match the emulator's misa (a yaml claiming
# less/more than misa to dodge/add tests is a compliance lie). Parse MISA_RV64GC_SU from csr.rs and
# the reset-val from wasmvm_isa.yaml; they must be equal.
set -euo pipefail
cd "$(dirname "$0")/.."
src_misa="$(grep -oE 'MISA_RV64GC_SU: u64 = 0x[0-9A-Fa-f_]+' crates/core/src/csr.rs | grep -oE '0x[0-9A-Fa-f_]+' | tr -d '_' | tr 'A-F' 'a-f')"
yaml_misa="$(grep -oE 'reset-val: 0x[0-9A-Fa-f]+' compliance/wasmvm/wasmvm_isa.yaml | grep -oE '0x[0-9A-Fa-f]+' | tr 'A-F' 'a-f')"
# normalize (strip leading zeros after 0x)
norm() { printf '0x%x' "$1"; }
s=$(norm "$src_misa"); y=$(norm "$yaml_misa")
echo "csr.rs MISA_RV64GC_SU = $s ; wasmvm_isa.yaml reset-val = $y"
[ "$s" = "$y" ] || { echo "error: isa yaml misa ($y) != emulator misa ($s) — the compliance yaml must match misa (E1-T01)" >&2; exit 1; }
echo "isa-yaml/misa cross-check: OK"
