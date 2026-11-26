#!/usr/bin/env bash
# Decoded-cache capacity is host tuning: the guest must execute the same instructions and end
# with the same memory at every size. Run tools/perf/turbo-equivalence.sh (the warm Replay
# desktop, turbo loop against the ordinary interpreter) once per size and require every
# evidence file (rolling FNV of every retirement, retired count, SHA-256 of guest RAM) to be
# identical across sizes as well.
#
#   bash tools/perf/decoded-cache-equivalence.sh [INSTRUCTIONS] [OUT_DIR] [SIZE...]
#
# Defaults: 2,000,000,000 instructions; OUT_DIR target/decoded-cache-equivalence; sizes
# 4096 16384 262144 (the sizes a browser host may select). Exit 0 and a final
# `CACHE-INDEPENDENT` line on a match, exit 1 otherwise. Inputs as for turbo-equivalence.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
N="${1:-2000000000}"
OUT="${2:-target/decoded-cache-equivalence}"
shift $(( $# > 2 ? 2 : $# ))
SIZES=("$@")
[ "${#SIZES[@]}" -gt 0 ] || SIZES=(4096 16384 262144)
mkdir -p "$OUT"
first=""
for size in "${SIZES[@]}"; do
  echo "=== decoded cache $size"
  CACHE_ENTRIES="$size" bash tools/perf/turbo-equivalence.sh "$N" "$OUT/$size" | tail -n 14
  grep -h '^block cache:' "$OUT/$size/turbo.err" || true
  if [ -z "$first" ]; then
    first="$OUT/$size"
  else
    for kind in turbo ordinary; do
      cmp -s "$first/turbo.evidence.txt" "$OUT/$size/$kind.evidence.txt" \
        || { echo "DIVERGED: $kind at $size differs from ${SIZES[0]}"; exit 1; }
    done
    cmp -s "$first/turbo.out" "$OUT/$size/turbo.out" \
      || { echo "DIVERGED: console output at $size differs from ${SIZES[0]}"; exit 1; }
  fi
done
echo "CACHE-INDEPENDENT (${SIZES[*]}; $N instructions)"
