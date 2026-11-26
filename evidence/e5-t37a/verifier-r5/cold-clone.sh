#!/usr/bin/env bash
# Cold clone for the E5-T37a round-5 verifier: sparse (no evidence/ except the oracle baseline,
# no web/dist, no rr-traces), scrubbed environment (env -i: only HOME, PATH, TERM — no RUSTFLAGS,
# RUST_LOG, CARGO_*). Run on the commit that promotes the verifiers' tests: it is the first head
# whose suite has the 62 promoted tests, and they must build and pass without `evidence/`.
# The clone is deleted at the end.
#
#   bash evidence/e5-t37a/verifier-r5/cold-clone.sh <head>
set -uo pipefail
REPO=/Users/blamy/Documents/Codex/wasm-vm
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/358f3812-2a26-47fa-96c6-985caf0a6f11/scratchpad/verifier-r5
D=$S/cold
HEAD_SHA=$1
REL=$REPO/releases
IMG=$REPO/target/e5-t34b/image/replay-desktop.ext4
clean() { env -i HOME="$HOME" PATH="$PATH" TERM=dumb "$@"; }
df -h / | tail -1
rm -rf "$D"
git clone -q --no-checkout "$REPO" "$D" && cd "$D" || exit 9
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/evidence/' '/evidence/perf-overhaul/oracle-baseline/' '!/web/dist/' '!/rr-traces/'
git checkout -q "$HEAD_SHA"
echo "round-5 verifier cold clone (sparse) at $(git rev-parse HEAD), tracked changes=$(git status --porcelain | wc -l | tr -d ' ')"
echo "what of evidence/ is checked out: $(find evidence -type f | sed 's#/[^/]*$##' | sort -u | tr '\n' ' ')"
echo "non-test code identical to the head rounds 3 and 4 examined (7fd2e0160, comments aside) — files that differ 61c4fcb44..HEAD under crates/: $(git diff --name-only 61c4fcb44 HEAD -- crates | tr '\n' ' ')"
echo "env passed to every command: $(clean env | cut -d= -f1 | tr '\n' ' ')"
echo '$ cargo fmt --check'
clean cargo fmt --check; echo "rc=$?"
echo '$ rustfmt --edition 2024 --check crates/core/src/paced_idle_verifier_tests/*.rs'
clean rustfmt --edition 2024 --check crates/core/src/paced_idle_verifier_tests/*.rs; echo "rc=$?"
echo '$ cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings'
clean cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)|Finished" | sort | uniq -c
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib paced_idle'
clean cargo test -p wasm-vm-core --lib paced_idle 2>&1 | grep -E "^test |test result|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib'
clean cargo test -p wasm-vm-core --lib 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib -- v37a_ r2_ r3_ r4_ r5_   (the promoted tests alone)'
clean cargo test -p wasm-vm-core --lib -- v37a_ r2_ r3_ r4_ r5_ 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo build --release -p wasm-vm-cli'
clean cargo build --release -p wasm-vm-cli 2>&1 | tail -1
echo "rc=${PIPESTATUS[0]}"
echo '$ RELEASES=… bash tools/perf/oracle.sh target/release/wasm-vm target/cold-oracle && diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests'
clean env RELEASES=$REL bash tools/perf/oracle.sh target/release/wasm-vm target/cold-oracle
diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests
echo "diff rc=$? (1 with only the README line = identical digests)"
for f in target/cold-oracle/digests/*.txt; do
  cmp -s "$f" "evidence/perf-overhaul/oracle-baseline/$(basename "$f")" && echo "  $(basename "$f"): byte-identical to the committed baseline" || echo "  $(basename "$f"): DIFFERS"
done
echo "\$ RELEASES=… IMAGE=… bash tools/perf/turbo-equivalence.sh 2000000000 target/cold-turbo"
clean env RELEASES=$REL IMAGE=$IMG bash tools/perf/turbo-equivalence.sh 2000000000 target/cold-turbo
echo "rc=$?"
cd "$S" && rm -rf "$D" && echo "clone deleted: $([ -e "$D" ] && echo NO || echo yes)"
df -h / | tail -1
echo "COLD_DONE"
