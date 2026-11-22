#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/replay-chromium-157
export VPYTHON_BYPASS="manually managed python not supported by chrome operations"
export PATH="$ROOT/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0 DEPOT_TOOLS_METRICS=0
cd "$ROOT/src"
# Unbundled driver: the same generator as the 108 port (tools/chromium/built/prepare-unbundled-driver.py).
CHROMIUM_SOURCE_DIR="$PWD" python3 /opt/prepare-unbundled-driver.py
grep -c 'gRecordReplayDriverSize = 0' base/record_replay_driver.cc
mkdir -p out/RISCV64
cp /opt/args-riscv64-157.gn out/RISCV64/args.gn
buildtools/linux64/gn gen out/RISCV64
third_party/ninja/ninja -C out/RISCV64 -n chrome | tail -1
df -h /opt | tail -1
echo GEN-DONE
