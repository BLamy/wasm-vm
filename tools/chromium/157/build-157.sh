#!/usr/bin/env bash
# E5-T32b: build Replay Chrome 157 for riscv64 (unbundled driver). Resumable: rerun to continue.
set -uo pipefail
cd /opt/replay-chromium-157/src
export VPYTHON_BYPASS="manually managed python not supported by chrome operations"
export PATH="/opt/replay-chromium-157/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0
date -u
# -k 0 keeps going past failures so one run surfaces every port error at once.
third_party/ninja/ninja -C out/RISCV64 -j 11 -k 0 chrome chrome_sandbox 2>&1 | grep -v '^\[[0-9]*/[0-9]*\] ' | tail -400
echo "ninja-rc=${PIPESTATUS[0]}"
third_party/ninja/ninja -C out/RISCV64 -n chrome | tail -1
date -u; df -h /opt | tail -1
echo BUILD-ROUND-DONE
