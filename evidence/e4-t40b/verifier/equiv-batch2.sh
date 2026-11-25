#!/usr/bin/env bash
# Verifier batch 2: decoded-cache sizes (the browser desktop boots with 16384 entries; a tiny
# cache evicts on almost every block entry). Same flags for turbo and --no-turbo.
set -uo pipefail
REPO=${REPO:-$(git rev-parse --show-toplevel)}
S=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
run() { # N SEED QUANTUM EXTRA...
  local n=$1 seed=$2 q=$3; shift 3
  echo "=== N=$n seed=$seed quantum=$q extra='$*'"
  REPO=$REPO SEED=$seed QUANTUM=$q EXTRA="$*" bash "$S/turbo-equivalence-param.sh" "$n" "target/verifier-equiv2-$n-$seed-$q"; echo "rc=$?"
}
run 1234567891 42 500000 --decoded-cache-entries 16384
run 311111113 5 65537 --decoded-cache-entries 64
run 97000003 11 500000 --decoded-cache-entries 1
