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
# rootfs/alpine-rootfs.ext4 and chunked-node-alpine/), REPS, SLOW_REPS, SLOW_PARALLEL, MICRO_REPS,
# CASES, SAMPLES, BROWSER_CASES, COMPUTE_ITERS. SKIP_NATIVE=1 / SKIP_BROWSER=1 run one half.
#
# The two suites run CONCURRENTLY by default (each sample is one guest thread, and each suite
# interleaves its own A/B samples, so the other suite's load hits both sides alike) to keep a full
# A/B near 20 minutes. SEQUENTIAL=1 runs them one after the other — use that for a quiet-machine
# headline. Outputs: OUTDIR/native/{native.json,native.md}, OUTDIR/browser/{browser.json,
# browser.md}, OUTDIR/{native,browser}.log, OUTDIR/SUMMARY.md. See tools/perf/README.md.
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

run_native() {
  local nargs=()
  [ "$BASE" = "-" ] || nargs+=(--bin "baseline=$BASE/target/release/wasm-vm")
  nargs+=(--bin "candidate=$CAND/target/release/wasm-vm")
  python3 "$HERE/bench_native.py" --out "$OUT/native" "${nargs[@]}"
}
run_browser() {
  local bargs=()
  [ "$BASE" = "-" ] || bargs+=(--root "baseline=$BASE")
  bargs+=(--root "candidate=$CAND")
  node "$HERE/bench-browser.mjs" --out "$OUT/browser" "${bargs[@]}"
}

status=0
t0=$(date +%s)
do_native=1; do_browser=1
[ "${SKIP_NATIVE:-0}" = 1 ] && do_native=0
[ "${SKIP_BROWSER:-0}" = 1 ] && do_browser=0
if [ $do_native = 1 ] && [ $do_browser = 1 ] && [ "${SEQUENTIAL:-0}" != 1 ]; then
  echo "[bench-all] native + browser suites running concurrently; logs in $OUT/{native,browser}.log" >&2
  : >"$OUT/native.log"; : >"$OUT/browser.log"
  tail -n +1 -F "$OUT/native.log" "$OUT/browser.log" >&2 2>/dev/null &
  tailer=$!
  run_native >"$OUT/native.log" 2>&1 &
  npid=$!
  run_browser >"$OUT/browser.log" 2>&1 || status=1
  wait "$npid" || status=1
  sleep 1
  kill "$tailer" 2>/dev/null || true
else
  if [ $do_native = 1 ]; then run_native 2> >(tee "$OUT/native.log" >&2) || status=1; fi
  if [ $do_browser = 1 ]; then run_browser 2> >(tee "$OUT/browser.log" >&2) || status=1; fi
fi
sargs=()
[ -f "$OUT/native/native.json" ] && sargs+=(--native "$OUT/native/native.json")
[ -f "$OUT/browser/browser.json" ] && sargs+=(--browser "$OUT/browser/browser.json")
if [ ${#sargs[@]} -gt 0 ]; then
  python3 "$HERE/summarize.py" "${sargs[@]}" --out "$OUT/SUMMARY.md"
fi
echo "[bench-all] done in $(( ($(date +%s) - t0) / 60 )) min -> $OUT/SUMMARY.md (status $status)" >&2
exit $status
