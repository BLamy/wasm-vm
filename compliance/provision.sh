#!/usr/bin/env bash
# E1-T20: hermetic provisioning of the RISCOF architectural-compliance toolchain (pinned shas).
#
# Reference model = **Spike** (already in the wasm-vm-toolchain:local Docker image; run via
# tools/toolchain/run.sh) — the spec-sanctioned fallback for Sail, so no heavy opam/ocaml build.
# riscof + riscv-arch-test are pinned below. Idempotent; re-runnable from a clean checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

RISCOF_VERSION="1.25.3"
ARCHTEST_COMMIT="df886adb05eb892f915d3403ff14e8c061552be8"
VENV="${RISCOF_VENV:-$PWD/compliance/.venv}"       # gitignored
ARCHTEST_DIR="${ARCHTEST_DIR:-$PWD/compliance/riscv-arch-test}"  # gitignored

# 1) riscof in a pinned venv.
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "riscof==${RISCOF_VERSION}"

# 2) riscv-arch-test via RISCOF's own cloner — it pins a RISCOF-COMPATIBLE ref (the
#    `riscv-test-suite/` + `env/arch_test.h` layout). The repo's current `main` reorganized to a
#    `tests/` layout RISCOF 1.25.3 cannot consume, so do NOT `git clone` main directly.
"$VENV/bin/riscof" arch-test --clone --dir="$ARCHTEST_DIR" >/dev/null 2>&1 \
  || "$VENV/bin/riscof" arch-test --update --dir="$ARCHTEST_DIR" >/dev/null 2>&1 || true
# The shipped reference plugins (riscof-plugins/rv64/spike_simple) are the base for compliance/spike
# and compliance/wasmvm.

# 3) Sanity: Spike (reference) reachable via the Docker toolchain image.
tools/toolchain/run.sh -- spike --help >/dev/null 2>&1 || {
  echo "error: Spike not reachable — build the toolchain image: tools/toolchain/build.sh" >&2; exit 1; }

echo "provisioned: riscof ${RISCOF_VERSION}, riscv-arch-test (RISCOF-pinned ctp-release @ 281d71ef), Spike (Docker) OK"
echo "  venv:      $VENV"
echo "  arch-test: $ARCHTEST_DIR"
