#!/usr/bin/env bash
set -euo pipefail
if [ -n "${CHROMIUM_SOURCE_DIR:-}" ]; then
  build_source="$CHROMIUM_SOURCE_DIR"
elif [ -f /opt/replay-chromium/.native-copy-complete ]; then
  build_source=/opt/replay-chromium/src
else
  build_source=/work/src
fi
export CHROMIUM_SOURCE_DIR="$build_source"
if [ -x /opt/replay-python38/bin/python3 ]; then
  python_bin=/opt/replay-python38/bin
else
  python_bin=/work/tools/depot_tools/.cipd_bin/3.8/bin
fi
cd "$build_source"
export PATH="$python_bin:/work/tools/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0 DEPOT_TOOLS_METRICS=0
export NINJA_STATUS="[%f/%t %es] "
export QEMU_LD_PREFIX=/opt/replay-riscv-sysroot
trap 'result=$?; printf "%s\n" "$result" > /work/logs/build-exit-code; exit "$result"' EXIT
mkdir -p out/RISCV64
cp /work/args-riscv64.gn out/RISCV64/args.gn
git config --global --add safe.directory "$build_source"
git rev-parse HEAD > /work/logs/source-revision.txt
python3 /work/prepare-unbundled-driver.py
"$build_source/buildtools/linux64/gn" --version
"$build_source/buildtools/linux64/gn" gen out/RISCV64
/usr/bin/ninja -C out/RISCV64 -j"${NINJA_JOBS:-12}" -k"${NINJA_KEEP_GOING:-10}" chrome
