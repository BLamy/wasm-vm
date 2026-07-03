#!/usr/bin/env bash
# E0-T20 differential harness: run <elf> under wasm-vm-cli AND Spike, normalize both into
# the E0-T16 canonical grammar, and byte-compare. Exits 0 on match, nonzero on divergence
# (scriptable for CI and E0-T25).
#
#   tools/diff/run_diff.sh <elf> [--level pc|commit] [--max N]
#
# Our CLI runs natively (release build); Spike runs in the E0-T13 container via
# tools/toolchain/run.sh, so this works from a cold clone with only Docker + Rust. Our
# trace is authoritative on length (the guest halts via HTIF); Spike spins on the guest's
# post-exit tail, so we compare our trace as a PREFIX of Spike's.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"

level="commit"
max_arg=()
elf=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --level) level="$2"; shift 2 ;;
    --max) max_arg=(--max "$2"); shift 2 ;;
    -*) echo "run_diff: unknown flag $1" >&2; exit 2 ;;
    *) elf="$1"; shift ;;
  esac
done
[ -n "${elf}" ] || { echo "usage: run_diff.sh <elf> [--level pc|commit] [--max N]" >&2; exit 2; }
[ -f "${elf}" ] || { echo "run_diff: no such ELF: ${elf}" >&2; exit 2; }

# ELF entry pc (e_entry, little-endian u64 at offset 24) — drives Spike's boot-ROM trim.
entry="$(python3 - "${elf}" <<'PY'
import struct, sys
with open(sys.argv[1], "rb") as f:
    f.seek(24)
    print(hex(struct.unpack("<Q", f.read(8))[0]))
PY
)"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
ours="${work}/ours.trace"
spike_raw="${work}/spike.log"
spike_norm="${work}/spike.trace"

# Build our runner once, then trace to a FILE (keeps stdout/stderr diagnostics out).
cargo build --release -p wasm-vm-cli >/dev/null 2>&1
# Capture the CLI exit WITHOUT masking it: exit 101 means our emulator TRAPPED (the trace
# ended because we could not execute the next instruction, not because the guest halted).
# A crash-truncated trace must never be accepted as a valid prefix (E0-T20 verifier bug).
set +e
"${repo_root}/target/release/wasm-vm" run "${elf}" --trace "${ours}" >/dev/null 2>&1
cli_exit=$?
set -e
ours_trapped=()
[ "${cli_exit}" -eq 101 ] && ours_trapped=(--ours-trapped)

# Spike: map only DRAM (its default device owns the UART page); --log-commits to stderr.
# rel path so the container's /work bind-mount resolves it.
rel_elf="$(python3 -c 'import os,sys; print(os.path.relpath(os.path.abspath(sys.argv[1]), sys.argv[2]))' "${elf}" "${repo_root}")"
"${repo_root}/tools/toolchain/run.sh" -- bash -c \
  "spike --isa=rv64i -m0x80000000:0x8000000 -l --log-commits '${rel_elf}' 2>&1 >/dev/null" \
  > "${spike_raw}" 2>/dev/null || true

python3 "${here}/normalize_spike.py" --entry "${entry}" < "${spike_raw}" > "${spike_norm}"

python3 "${here}/report.py" "${ours}" "${spike_norm}" --level "${level}" \
  ${max_arg[@]+"${max_arg[@]}"} ${ours_trapped[@]+"${ours_trapped[@]}"}
