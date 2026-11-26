#!/usr/bin/env bash
# E5-T37a round-5 verifier — the gates for the touched harness, in the working tree.
#   bash evidence/e5-t37a/verifier-r5/gates.sh
set -uo pipefail
echo "head $(git rev-parse HEAD); git status --short crates: [$(git status --short crates | tr '\n' ';')]"
echo '$ cargo fmt --check'
cargo fmt --check; echo "rc=$?"
if ls crates/core/src/paced_idle_verifier_tests/*.rs >/dev/null 2>&1; then
  echo '$ rustfmt --edition 2024 --check crates/core/src/paced_idle_verifier_tests/*.rs   (include!d files: cargo fmt does not reach them)'
  rustfmt --edition 2024 --check crates/core/src/paced_idle_verifier_tests/*.rs; echo "rc=$?"
fi
echo '$ cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings'
cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)|Finished" | sort | uniq -c
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib paced_idle'
cargo test -p wasm-vm-core --lib paced_idle 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib'
cargo test -p wasm-vm-core --lib 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib -- --list | (count by prefix)'
cargo test -p wasm-vm-core --lib -- --list 2>/dev/null | grep ': test$' | awk '{n=$1; sub(/: test$/,"",n); k=split(n,a,"::"); t=a[k]; p="other"; if (t ~ /^v37a_/) p="v37a_"; else if (t ~ /^r2_/) p="r2_"; else if (t ~ /^r3_/) p="r3_"; else if (t ~ /^r4_/) p="r4_"; else if (t ~ /^r5_/) p="r5_"; else if (n ~ /paced_idle/) p="paced_idle"; c[p]++} END {for (k in c) printf "%s=%d ", k, c[k]; print ""}'
echo '$ cargo test -p wasm-vm-core --lib -- --ignored --list | grep -c ": test$"   (ignored tests)'
cargo test -p wasm-vm-core --lib -- --ignored --list 2>/dev/null | grep -c ': test$'
