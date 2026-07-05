#!/usr/bin/env bash
# E2-T12 acceptance #2: boot the built Image on stock QEMU virt (via the toolchain image)
# with NO root device — a sane kernel reaches the "VFS: Cannot open root device" panic,
# proving the artifact is independent of our emulator. Any earlier hang/crash fails.
#   bash tools/boot-test-kernel.sh [version]
set -euo pipefail
cd "$(dirname "$0")/.."

VER="${1:-6.6.63}"
IMG="releases/kernel/${VER}/Image"
[ -f "$IMG" ] || { echo "no Image at $IMG — run tools/build-kernel.sh"; exit 2; }

# QEMU lives in the toolchain image; run it there, timing out the boot. Kernel panics on
# no-root then spins, so we cap wall time and scan the captured console.
LOG="target/kernel-boot-${VER}.log"
bash tools/toolchain/run.sh -- bash -lc "
  timeout 60 qemu-system-riscv64 -M virt -nographic -smp 1 -m 256M \
    -kernel /work/${IMG} -append 'console=ttyS0 earlycon=sbi panic=-1' \
    2>&1 | head -c 200000
" > "$LOG" 2>&1 || true

echo "=== boot console (tail) ==="
tail -25 "$LOG"

if grep -qE "VFS: Cannot open root device|Unable to mount root fs|No filesystem could mount root" "$LOG"; then
  echo ""
  echo "✅ kernel ${VER} boots to the root-device panic — artifact is sane."
  # Extra sanity: it got through SBI + console + driver init.
  grep -qE "Linux version ${VER}" "$LOG" && echo "   (banner: Linux version ${VER} confirmed)"
  exit 0
else
  echo ""
  echo "❌ did NOT reach the root-device panic — kernel hung/crashed earlier (see $LOG)"
  exit 1
fi
