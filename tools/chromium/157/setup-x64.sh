#!/usr/bin/env bash
# E5-T32a: x64-host (Rosetta) toolchain + hooks for Replay Chromium 157 -> linux/riscv64.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends git curl ca-certificates python3 python3-venv xz-utils \
  bzip2 lsb-release file pkg-config gperf bison flex patch zstd ninja-build >/dev/null
ROOT=/opt/replay-chromium-157
export VPYTHON_BYPASS="manually managed python not supported by chrome operations"
export PATH="$ROOT/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0 DEPOT_TOOLS_METRICS=0 GCLIENT_SUPPRESS_GIT_VERSION_WARNING=1
git config --global --add safe.directory '*'
cd "$ROOT"
# Hooks fetch the pinned x64 clang/rust/gn/node and Chromium's riscv64 Debian sysroot.
gclient runhooks --jobs=12
python3 src/build/linux/sysroot_scripts/install-sysroot.py --arch=riscv64
ls src/third_party/llvm-build/Release+Asserts/bin/clang src/third_party/rust-toolchain/bin/rustc
src/third_party/llvm-build/Release+Asserts/bin/clang --version | head -1
src/third_party/rust-toolchain/bin/rustc --version
ls src/build/linux/ | grep -i sysroot
echo SETUP-DONE
