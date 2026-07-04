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

# 2) riscv-arch-test at a pinned commit.
if [ ! -d "$ARCHTEST_DIR/.git" ]; then
  git clone --quiet https://github.com/riscv-non-isa/riscv-arch-test.git "$ARCHTEST_DIR"
fi
git -C "$ARCHTEST_DIR" fetch --quiet origin "$ARCHTEST_COMMIT" 2>/dev/null || true
git -C "$ARCHTEST_DIR" checkout --quiet "$ARCHTEST_COMMIT"

# 3) Sanity: Spike (reference) reachable via the Docker toolchain image.
tools/toolchain/run.sh -- spike --help >/dev/null 2>&1 || {
  echo "error: Spike not reachable — build the toolchain image: tools/toolchain/build.sh" >&2; exit 1; }

echo "provisioned: riscof ${RISCOF_VERSION}, riscv-arch-test @ ${ARCHTEST_COMMIT}, Spike (Docker) OK"
echo "  venv:      $VENV"
echo "  arch-test: $ARCHTEST_DIR"
