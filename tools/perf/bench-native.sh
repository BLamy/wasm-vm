#!/usr/bin/env bash
# Native perf suite (host wall-clock): busybox boot (legacy/fast/jit), busybox shell compute loop
# (fast/jit), Alpine ext4 boot to login (fast/jit), and the crates/core perf_baseline microbench.
#
#   bash tools/perf/bench-native.sh BIN OUTDIR [BASELINE_BIN]
#
# With BASELINE_BIN every case runs A/B interleaved and the table gains a speedup column. Writes
# OUTDIR/native.json (every raw sample + medians + host/binary metadata) and OUTDIR/native.md.
# Env: RELEASES (dir holding kernel/, initramfs/, rootfs/alpine-rootfs.ext4 — the rootfs is
# gitignored, so point this at a checkout that has it), REPS (3), ALPINE_REPS (1), CASES (comma
# list; see tools/perf/bench_native.py), COMPUTE_ITERS (10000). See tools/perf/README.md.
set -euo pipefail
if [ $# -lt 2 ]; then
  echo "usage: $0 BIN OUTDIR [BASELINE_BIN]" >&2
  exit 2
fi
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=$1; OUT=$2
args=()
if [ $# -ge 3 ]; then args+=(--bin "baseline=$3"); fi
args+=(--bin "candidate=$BIN")
exec python3 "$HERE/bench_native.py" --out "$OUT" "${args[@]}"
