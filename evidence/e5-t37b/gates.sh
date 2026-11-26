#!/usr/bin/env bash
# E5-T37b gates, run from the repo root at the head under test.
set -uo pipefail
cd "$(dirname "$0")/../.."
echo "head $(git rev-parse HEAD); crates/web changes outside the commit: $(git status --porcelain -- crates web ':!web/tasks.json' ':!web/dist' | wc -l | tr -d ' ')"
run() { echo "\$ $*"; "$@" 2>&1 | tail -${TAIL:-3}; echo "rc=${PIPESTATUS[0]}"; }
run cargo fmt --check
run cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
run cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown
TAIL=6 run wasm-pack test --node crates/wasm --lib -- exported_paced
TAIL=4 run wasm-pack test --node crates/wasm --lib
echo '$ cd web && node --test tests/e5-t37b-paced-idle.test.mjs'
(cd web && node --test tests/e5-t37b-paced-idle.test.mjs 2>&1 | grep -E "^(✔|✖)|^ℹ (tests|pass|fail)")
echo '$ cd web && node --test --test-timeout=120000 tests/*.test.mjs   (names of failing tests, against the list at the parent of this task)'
(cd web && node --test --test-timeout=120000 tests/*.test.mjs 2>&1) > /tmp/e5t37b-web-run.txt
grep -E "^ℹ (tests|pass|fail)" /tmp/e5t37b-web-run.txt
grep -E "^✖ " /tmp/e5t37b-web-run.txt | sed -E 's/ \([0-9.]+ms\)$//' | LC_ALL=C sort -u > /tmp/e5t37b-web-after.txt
LC_ALL=C sort -u evidence/e5-t37b/web-unit-failing-before.txt > /tmp/e5t37b-web-before.txt
echo "failing now: $(grep -c . /tmp/e5t37b-web-after.txt) lines; failing before: $(grep -c . /tmp/e5t37b-web-before.txt) lines (each list has one header line)"
echo "difference (< only before, > only now):"; diff /tmp/e5t37b-web-before.txt /tmp/e5t37b-web-after.txt; echo "diff rc=$?"
echo GATES_DONE
