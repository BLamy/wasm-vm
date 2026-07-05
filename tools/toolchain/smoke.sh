#!/usr/bin/env bash
# E0-T13 smoke test: assemble the 4-instruction rv64i program, run it under Spike,
# assert the HTIF exit round-trips to status 0. Runs INSIDE the container (via run.sh),
# so it can rely on riscv64-unknown-elf-gcc and spike being on PATH.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

elf="${work}/smoke.elf"

# Assemble + link a static, no-std bare-metal image at DRAM_BASE.
riscv64-unknown-elf-gcc \
  -march=rv64i -mabi=lp64 -nostdlib -static \
  -T "${here}/smoke.ld" \
  -o "${elf}" \
  "${here}/smoke.S"

# Run under Spike (rv64i). A clean HTIF exit code 0 means spike returns 0; any other
# HTIF code makes spike return nonzero, which this `if` propagates as a smoke failure
# (verified: tohost=(1<<1)|1 → spike exits 1). NB an *illegal opcode* traps-loops with
# no handler and hangs rather than exiting — bound it with a `timeout` in CI if desired.
if spike --isa=rv64i "${elf}"; then
  echo "smoke OK: spike ran the rv64i program and it exited 0"
else
  status=$?
  echo "smoke FAILED: spike exit status ${status}" >&2
  exit "${status}"
fi
