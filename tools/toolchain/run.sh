#!/usr/bin/env bash
# Run a command inside the reference toolchain, repo bind-mounted at /work, UID-mapped
# so artifacts are owned by the invoking user, not root (E0-T13).
#
#   tools/toolchain/run.sh -- riscv64-unknown-elf-gcc --version
#   tools/toolchain/run.sh -- tools/toolchain/smoke.sh
#
# Robust to spaces in paths and to being invoked from any cwd: the repo root is derived
# from this script's location, and every path is quoted.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=versions.env
. "${here}/versions.env"
repo_root="$(cd "${here}/../.." && pwd)"

# Strip a leading `--` separator if present.
[ "${1:-}" = "--" ] && shift
if [ "$#" -eq 0 ]; then
  echo "usage: run.sh [--] <command> [args...]" >&2
  exit 2
fi

exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "${repo_root}:/work" \
  -w /work \
  -e HOME=/tmp \
  "${IMAGE_TAG}" \
  "$@"
