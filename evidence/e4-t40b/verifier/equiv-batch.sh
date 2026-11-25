#!/usr/bin/env bash
# Verifier batch: the committed script at its acceptance budget, then independent budgets,
# seeds and quanta through a parameterized copy (same flags for turbo and --no-turbo).
set -uo pipefail
REPO=${REPO:-$(git rev-parse --show-toplevel)}
S=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
echo "=== A: committed script, N=2000000000 (seed 42, quantum 500000)"
bash tools/perf/turbo-equivalence.sh 2000000000 target/verifier-equiv; echo "rc=$?"
run() { # N SEED QUANTUM
  echo "=== N=$1 seed=$2 quantum=$3"
  REPO=$REPO SEED=$2 QUANTUM=$3 bash "$S/turbo-equivalence-param.sh" "$1" "target/verifier-equiv-$1-$2-$3"; echo "rc=$?"
}
run 137000001 42 500000
run 911111111 7 7919
run 3141592653 123456789 123457
run 50000017 99 1
run 733333337 31337 1000003
