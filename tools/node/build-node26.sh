#!/usr/bin/env bash
# E5-T33: cross-build Replay Node v26.13.1-replay for linux/riscv64 (rv64gc, LP64D) on an x64 host.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends python3 make g++ gcc gcc-riscv64-linux-gnu \
  g++-riscv64-linux-gnu gcc-14-riscv64-linux-gnu g++-14-riscv64-linux-gnu binutils-riscv64-linux-gnu libc6-dev-riscv64-cross file ca-certificates git >/dev/null
cd /opt/replay-node-26
git config --global --add safe.directory '*' 2>/dev/null || true
# RISC-V port patch (tools/node/patches) and the unbundled driver stub: no Replay
# backend driver is downloaded or embedded (tools/node/prepare-unbundled-driver.py).
for patch in /opt/node-patches/*.patch; do
  git apply --reverse --check "$patch" 2>/dev/null || git apply "$patch"
done
python3 /opt/prepare-node-unbundled-driver.py
# GCC 14: V8 needs target("arch=+v") and __riscv_vlenb, which GCC 13 lacks.
export CC=riscv64-linux-gnu-gcc-14 CXX=riscv64-linux-gnu-g++-14 AR=riscv64-linux-gnu-ar LINK=riscv64-linux-gnu-g++-14
export CC_host=gcc CXX_host=g++ AR_host=ar LINK_host=g++
./configure --dest-cpu=riscv64 --dest-os=linux --cross-compiling --openssl-no-asm \
  --prefix=/usr 2>&1 | tail -5
time make -j12 2>&1 | tail -20
file out/Release/node
riscv64-linux-gnu-strip -o out/Release/node.stripped out/Release/node
ls -la out/Release/node out/Release/node.stripped
echo NODE-BUILD-DONE
