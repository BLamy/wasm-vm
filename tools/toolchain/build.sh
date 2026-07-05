#!/usr/bin/env bash
# Build and tag the reference toolchain image (E0-T13). One command, all pins from
# versions.env. Re-runnable; pass --no-cache to force a cold rebuild.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=versions.env
. "${here}/versions.env"

# Guard the empty-array expansion for bash 3.2 (macOS default) under `set -u`.
extra=()
[ "${1:-}" = "--no-cache" ] && extra=(--no-cache)

echo "Building ${IMAGE_TAG}"
echo "  base:  ${UBUNTU_DIGEST}"
echo "  gcc:   ${GCC_RISCV64_VERSION}"
echo "  qemu:  ${QEMU_SYSTEM_MISC_VERSION}"
echo "  spike: ${SPIKE_COMMIT}"

docker build ${extra[@]+"${extra[@]}"} \
  --build-arg "UBUNTU_DIGEST=${UBUNTU_DIGEST}" \
  --build-arg "GCC_RISCV64_VERSION=${GCC_RISCV64_VERSION}" \
  --build-arg "QEMU_SYSTEM_MISC_VERSION=${QEMU_SYSTEM_MISC_VERSION}" \
  --build-arg "SPIKE_COMMIT=${SPIKE_COMMIT}" \
  -t "${IMAGE_TAG}" \
  "${here}"

echo "OK: ${IMAGE_TAG} built."
