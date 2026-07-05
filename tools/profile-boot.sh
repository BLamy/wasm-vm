#!/usr/bin/env bash
# E2-T25: reproduce the boot-time profile in one command. Boots the native release wasm-vm with
# `--profile-boot --no-input` (which stops at userland), extracts the PROFILE_JSON line, and — for
# N>1 — reports per-phase wall-time variance (relative std dev). The deterministic figures (retired
# per phase, per-device MMIO counts) are byte-identical run-to-run; only wall_ms varies.
#
#   tools/profile-boot.sh                 # busybox initramfs, 1 run → JSON + pretty table
#   RUNS=3 tools/profile-boot.sh          # 3 runs, report wall-time RSD per phase
#   TARGET=alpine tools/profile-boot.sh   # Alpine rootfs (needs releases/rootfs/alpine-rootfs.ext4)
#
# The host CPU-vs-device-vs-IO TIME split comes from an external flamegraph — see docs/perf-baseline.md.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$here"
RUNS="${RUNS:-1}"; TARGET="${TARGET:-busybox}"; MAX_INSTRS="${MAX_INSTRS:-8000000000}"
OUT="${OUT:-target/profile-boot}"; mkdir -p "$OUT"
kernel="releases/kernel/6.6.63/Image"; bin="target/release/wasm-vm"

[ -x "$bin" ] || { echo "profile-boot: building release wasm-vm…" >&2; cargo build --release -p wasm-vm-cli >&2 || exit 2; }
[ -f "$kernel" ] || { echo "profile-boot: missing kernel $kernel" >&2; exit 2; }

case "$TARGET" in
  busybox)  src=(--initrd releases/initramfs/initramfs.cpio.gz --append "console=ttyS0 earlycon=sbi") ;;
  alpine)   src=(--drive file=releases/rootfs/alpine-rootfs.ext4 --append "root=/dev/vda rw console=ttyS0 earlycon=sbi") ;;
  *) echo "profile-boot: TARGET must be busybox|alpine" >&2; exit 2 ;;
esac
[ "$TARGET" = alpine ] && [ ! -f releases/rootfs/alpine-rootfs.ext4 ] && { echo "profile-boot: missing rootfs" >&2; exit 2; }

echo "profile-boot: $TARGET × $RUNS run(s)" >&2
for i in $(seq 1 "$RUNS"); do
  log="$OUT/${TARGET}.run${i}.log"
  "$bin" boot --kernel "$kernel" "${src[@]}" --profile-boot --no-input --max-instrs "$MAX_INSTRS" >/dev/null 2>"$log"
  grep -m1 "^PROFILE_JSON " "$log" | sed 's/^PROFILE_JSON //' > "$OUT/${TARGET}.run${i}.json"
  echo "  run $i: $(grep -m1 'busybox-userland\|getty-login' "$log" | awk '{print $1" @ "$2"ms"}' 2>/dev/null || echo 'userland marker not reached — raise MAX_INSTRS')" >&2
done

# Pretty-print run 1 and, for N>1, per-phase wall-time relative std dev (jq if present, else raw).
echo "=== profile (run 1) ==="
# Print the pretty block (header → just before the PROFILE_JSON line). awk, not sed, for BSD/GNU parity.
awk '/=== E2-T25 boot profile ===/{f=1} /^PROFILE_JSON /{f=0} f' "$OUT/${TARGET}.run1.log"
if [ "$RUNS" -gt 1 ] && command -v jq >/dev/null; then
  echo "=== wall-time variance across $RUNS runs (retired + device counts are deterministic) ==="
  for p in kernel-entry console-up rootfs-mounted init-handoff busybox-userland getty-login; do
    vals=$(for i in $(seq 1 "$RUNS"); do jq -r --arg p "$p" '.phases[]|select(.phase==$p)|.wall_ms' "$OUT/${TARGET}.run${i}.json" 2>/dev/null; done)
    [ -z "$vals" ] && continue
    echo "$vals" | awk -v p="$p" '{s+=$1; ss+=$1*$1; n++} END{if(n>1){m=s/n; sd=sqrt(ss/n-m*m); printf "  %-18s mean=%.0fms rsd=%.1f%%\n", p, m, 100*sd/m}}'
  done
fi
echo "profile-boot: JSON per run in $OUT/${TARGET}.run*.json" >&2
