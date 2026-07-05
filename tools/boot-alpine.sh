#!/usr/bin/env bash
# E2-T19: boot the pinned kernel with the Alpine ext4 rootfs from virtio-blk to an interactive
# login shell on the native wasm-vm CLI — the Level-2 "full system" milestone.
#
# Usage:
#   tools/boot-alpine.sh                 # interactive: log in as root (empty password)
#   tools/boot-alpine.sh -- --blk-log    # forward extra flags to `wasm-vm boot`
#
# The rootfs is gitignored (built from tools/build-rootfs.sh); this builds it if absent. The
# boot mounts /dev/vda as an ext4 root — no initramfs on this path. Ctrl-C kills the emulator.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kernel="$here/releases/kernel/6.6.63/Image"
rootfs="$here/releases/rootfs/alpine-rootfs.ext4"

[ -f "$kernel" ] || { echo "boot-alpine: missing kernel $kernel" >&2; exit 1; }
if [ ! -f "$rootfs" ]; then
  echo "boot-alpine: rootfs absent — building it (bash tools/build-rootfs.sh)…" >&2
  ( cd "$here" && bash tools/build-rootfs.sh >&2 )
fi

bin="$here/target/release/wasm-vm"
if [ ! -x "$bin" ]; then
  echo "boot-alpine: building release wasm-vm…" >&2
  ( cd "$here" && cargo build --release -p wasm-vm-cli >&2 )
fi

extra=()
if [ "${1:-}" = "--" ]; then shift; extra=("$@"); fi

# Alpine boots to `login:`; log in as root (empty password — see docs/rootfs.md).
exec "$bin" boot \
  --kernel "$kernel" \
  --drive "file=$rootfs" \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
  --max-instrs 40000000000 \
  "${extra[@]}"
