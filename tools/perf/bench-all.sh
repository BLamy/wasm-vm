#!/usr/bin/env bash
# Full perf-overhaul benchmark: native + browser suites, A/B interleaved between two checkouts,
# plus the headline PR table.
#
#   bash tools/perf/bench-all.sh BASE_CHECKOUT CANDIDATE_CHECKOUT OUTDIR
#   bash tools/perf/bench-all.sh - CANDIDATE_CHECKOUT OUTDIR        # candidate only (no A/B)
#
# Each checkout must already be built: target/release/wasm-vm (cargo build --release -p
# wasm-vm-cli) and web/pkg + web/node_modules (make web-build). BUILD=1 builds the CANDIDATE first
# (never the base). Env passes through to the suites: RELEASES (a releases/ dir with the gitignored
# rootfs/alpine-rootfs.ext4 and chunked-node-alpine/), REPS, ALPINE_REPS, MICRO_REPS, CASES,
# SAMPLES, BROWSER_CASES, COMPUTE_ITERS. SKIP_NATIVE=1 / SKIP_BROWSER=1 run one half.
# Outputs: OUTDIR/native/{native.json,native.md}, OUTDIR/browser/{browser.json,browser.md},
# OUTDIR/SUMMARY.md. See tools/perf/README.md.
set -euo pipefail
if [ $# -ne 3 ]; then
  echo "usage: $0 BASE_CHECKOUT|- CANDIDATE_CHECKOUT OUTDIR" >&2
  exit 2
fi
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=$1
CAND=$(cd "$2" && pwd)
OUT=$3
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
if [ "$BASE" != "-" ]; then BASE=$(cd "$BASE" && pwd); fi

if [ "${BUILD:-0}" = 1 ]; then
  echo "[bench-all] building candidate $CAND (release CLI + web)" >&2
  (cd "$CAND" && cargo build --release -p wasm-vm-cli && make web-build)
fi

check() {
  local co=$1
  [ -x "$co/target/release/wasm-vm" ] || { echo "[bench-all] missing $co/target/release/wasm-vm (cargo build --release -p wasm-vm-cli)" >&2; exit 2; }
  [ -f "$co/web/pkg/wasm_vm_wasm_bg.wasm" ] || { echo "[bench-all] missing $co/web/pkg (make web-build in $co)" >&2; exit 2; }
}
check "$CAND"
[ "$BASE" = "-" ] || check "$BASE"

status=0
t0=$(date +%s)
if [ "${SKIP_NATIVE:-0}" != 1 ]; then
  nargs=()
  [ "$BASE" = "-" ] || nargs+=(--bin "baseline=$BASE/target/release/wasm-vm")
  nargs+=(--bin "candidate=$CAND/target/release/wasm-vm")
  python3 "$HERE/bench_native.py" --out "$OUT/native" "${nargs[@]}" || status=1
fi
if [ "${SKIP_BROWSER:-0}" != 1 ]; then
  bargs=()
  [ "$BASE" = "-" ] || bargs+=(--root "baseline=$BASE")
  bargs+=(--root "candidate=$CAND")
  node "$HERE/bench-browser.mjs" --out "$OUT/browser" "${bargs[@]}" || status=1
fi
sargs=()
[ -f "$OUT/native/native.json" ] && sargs+=(--native "$OUT/native/native.json")
[ -f "$OUT/browser/browser.json" ] && sargs+=(--browser "$OUT/browser/browser.json")
python3 "$HERE/summarize.py" "${sargs[@]}" --out "$OUT/SUMMARY.md"
echo "[bench-all] done in $(( ($(date +%s) - t0) / 60 )) min -> $OUT/SUMMARY.md (status $status)" >&2
exit $status
