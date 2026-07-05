#!/usr/bin/env bash
# E2-T15: boot the pinned unmodified Linux kernel + busybox initramfs to an interactive
# shell on the native wasm-vm CLI. This is the Linux half of the First Light milestone.
#
# Usage:
#   tools/boot-busybox.sh                 # interactive: your keystrokes drive the busybox shell
#   tools/boot-busybox.sh -- --append "console=ttyS0 earlycon=sbi loglevel=8"
#
# Everything after `--` is forwarded to `wasm-vm boot`. Ctrl-A then C is NOT a thing here —
# this is a plain stdin pipe; press Ctrl-C to kill the emulator.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kernel="$here/releases/kernel/6.6.63/Image"
initrd="$here/releases/initramfs/initramfs.cpio.gz"

for f in "$kernel" "$initrd"; do
  [ -f "$f" ] || { echo "boot-busybox: missing artifact $f" >&2; exit 1; }
done

# Prefer a release build (the boot is interpreter-bound; debug is ~10x slower).
bin="$here/target/release/wasm-vm"
if [ ! -x "$bin" ]; then
  echo "boot-busybox: building release wasm-vm…" >&2
  ( cd "$here" && cargo build --release -p wasm-vm-cli >&2 )
fi

extra=()
if [ "${1:-}" = "--" ]; then shift; extra=("$@"); fi

exec "$bin" boot --kernel "$kernel" --initrd "$initrd" "${extra[@]}"
