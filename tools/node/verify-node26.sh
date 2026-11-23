#!/usr/bin/env bash
# E5-T33 acceptance for Replay Node 26 on riscv64. Runs on the Mac.
#   bash tools/node/verify-node26.sh
# Uses the colima VM 'replay-chromium' (riscv64 binfmt/QEMU registered) and the build
# tree from tools/node/build-node26.sh. The smoke runs in a fresh container with
# --network none, so nothing can be fetched at startup.
set -euo pipefail
cd "$(dirname "$0")/../.."
CTX=colima-replay-chromium
OUT=/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/3/fs/opt/replay-node-26/out
PKG=local/node-26
mkdir -p "$PKG"
docker --context $CTX cp replay-node-26-x64:/opt/replay-node-26/out/pkg/replay-node-26-riscv64/bin/node "$PKG/node"
docker --context $CTX cp tools/node/smoke-node26.mjs replay-chromium-build:/opt/replay-node-26/out/smoke-node26.mjs
echo "== binary"; file "$PKG/node" | sed 's/, BuildID.*//'
file "$PKG/node" | grep -q "UCB RISC-V, RVC, double-float ABI" || { echo "FAIL: not riscv64 LP64D"; exit 1; }
shasum -a 256 "$PKG/node"
echo "== offline run (QEMU riscv64, --network none)"
docker --context $CTX run --rm --network none -v "$OUT:/n:ro" -e QEMU_LD_PREFIX=/n/rv-runtime ubuntu:24.04 bash -c '
  set -e
  ifaces=$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " " | tr "\n" " "); echo "interfaces: $ifaces"
  [ "$ifaces" = "lo " ] || { echo "FAIL: network present"; exit 1; }
  v=$(RECORD_REPLAY_DONT_RECORD=1 /n/pkg/replay-node-26-riscv64/bin/node --version); echo "version: $v"
  [ "$v" = "v26.13.1" ] || { echo "FAIL: version"; exit 1; }
  RECORD_REPLAY_DONT_RECORD=1 /n/pkg/replay-node-26-riscv64/bin/node /n/smoke-node26.mjs
  echo "== without RECORD_REPLAY_DONT_RECORD (empty driver slot must degrade, not fail)"
  /n/pkg/replay-node-26-riscv64/bin/node -e "console.log(process.version, process.arch)" 2>/tmp/err
  grep -q "file too short" /tmp/err && echo "driver load: empty slot rejected by dlopen (expected)"'
echo "== privacy"
python3 tools/privacy/check-no-replay-backend.py "$PKG/node" "$PKG/replay-node-26-riscv64.tar.xz"
echo "E5-T33 acceptance: OK"
