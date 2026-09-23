#!/usr/bin/env bash
# Perf-overhaul equivalence oracle: boot fixed Linux workloads under every dispatch mode with a
# pinned RTC and record the `--evidence` digests (rolling FNV of every retired instruction + final
# architectural-state SHA-256). A refactor that claims "no guest-visible change" must reproduce the
# committed baseline digests byte-for-byte:
#
#   bash tools/perf/oracle.sh target/release/wasm-vm /tmp/oracle-out
#   diff -r evidence/perf-overhaul/oracle-baseline /tmp/oracle-out/digests
#
# Env: RELEASES (default: ./releases) must hold kernel/6.6.63/Image, initramfs/initramfs.cpio.gz and
# rootfs/alpine-rootfs.ext4 (gitignored — symlink or point at a checkout that has it).
# ORACLE_CASES narrows the run (space-separated case names). Cases run in parallel.
set -euo pipefail
BIN=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
OUT=$2
REL=${RELEASES:-releases}
REL=$(cd "$REL" && pwd)
RTC=1790000000000000000
mkdir -p "$OUT/digests" "$OUT/logs"

busybox() {
  local name=$1; shift
  "$BIN" boot --kernel "$REL/kernel/6.6.63/Image" --initrd "$REL/initramfs/initramfs.cpio.gz" \
    --no-input --max-instrs 400000000 --fixed-rtc-ns $RTC "$@" \
    --evidence "$OUT/digests/$name.txt" >"$OUT/logs/$name.out" 2>"$OUT/logs/$name.err" || true
}
alpine() {
  local name=$1; shift
  local img="$OUT/logs/$name.ext4"
  cp -c "$REL/rootfs/alpine-rootfs.ext4" "$img" 2>/dev/null || cp "$REL/rootfs/alpine-rootfs.ext4" "$img"
  "$BIN" boot --kernel "$REL/kernel/6.6.63/Image" --drive "file=$img" \
    --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" --no-input --max-instrs 2000000000 \
    --fixed-rtc-ns $RTC "$@" \
    --evidence "$OUT/digests/$name.txt" >"$OUT/logs/$name.out" 2>"$OUT/logs/$name.err" || true
  rm -f "$img"
}

CASES=${ORACLE_CASES:-"busybox-legacy busybox-cache busybox-fast busybox-jit alpine-fast alpine-jit"}
for c in $CASES; do
  case $c in
    busybox-legacy) busybox "$c" & ;;
    busybox-cache) busybox "$c" --block-cache & ;;
    busybox-fast) busybox "$c" --block-cache --interrupt-batching & ;;
    busybox-jit) busybox "$c" --jit & ;;
    alpine-fast) alpine "$c" --block-cache --interrupt-batching & ;;
    alpine-jit) alpine "$c" --jit & ;;
    *) echo "unknown case $c" >&2; exit 2 ;;
  esac
done
wait
for c in $CASES; do
  printf '%-16s %s\n' "$c" "$(grep -E 'state sha256' "$OUT/digests/$c.txt" 2>/dev/null || echo MISSING)"
done
