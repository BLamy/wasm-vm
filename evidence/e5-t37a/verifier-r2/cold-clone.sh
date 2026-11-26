#!/usr/bin/env bash
# Cold clone for the E5-T37a round-2 verifier: sparse (no evidence/ except the oracle baseline,
# no web/dist), scrubbed environment (env -i: only HOME, PATH, TERM — no RUSTFLAGS, RUST_LOG,
# CARGO_*). The clone is deleted at the end.
set -uo pipefail
REPO=/Users/blamy/Documents/Codex/wasm-vm
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/358f3812-2a26-47fa-96c6-985caf0a6f11/scratchpad
D=$S/cold-e5t37a-r2
HEAD_SHA=${1:-d8db32db8}
REL=$REPO/releases
IMG=$REPO/target/e5-t34b/image/replay-desktop.ext4
clean() { env -i HOME="$HOME" PATH="$PATH" TERM=dumb "$@"; }
df -h / | tail -1
rm -rf "$D"
git clone -q --no-checkout "$REPO" "$D" && cd "$D" || exit 9
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/evidence/' '/evidence/perf-overhaul/oracle-baseline/' '!/web/dist/' '!/rr-traces/'
git checkout -q "$HEAD_SHA"
echo "cold clone (sparse) at $(git rev-parse HEAD), tracked changes=$(git status --porcelain | wc -l | tr -d ' ')"
echo "crates identical to 215cbd1f9: $(git diff --quiet 215cbd1f9 HEAD -- crates && echo yes || echo NO)"
echo "env passed to every command: $(clean env | cut -d= -f1 | tr '\n' ' ')"
echo '$ cargo test -p wasm-vm-core --lib paced_idle'
clean cargo test -p wasm-vm-core --lib paced_idle 2>&1 | grep -E "^test |test result|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib'
clean cargo test -p wasm-vm-core --lib 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo build --release -p wasm-vm-cli'
clean cargo build --release -p wasm-vm-cli 2>&1 | tail -1
echo "rc=${PIPESTATUS[0]}"
echo '$ RELEASES=… bash tools/perf/oracle.sh target/release/wasm-vm target/cold-oracle && diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests'
clean env RELEASES=$REL bash tools/perf/oracle.sh target/release/wasm-vm target/cold-oracle
diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests
echo "diff rc=$? (1 with only the README line = identical digests)"
for N in 2000000000 333333333; do
  echo "\$ RELEASES=… IMAGE=… bash tools/perf/turbo-equivalence.sh $N target/cold-turbo-$N"
  clean env RELEASES=$REL IMAGE=$IMG bash tools/perf/turbo-equivalence.sh $N target/cold-turbo-$N
  echo "rc=$?"
done
cd "$S" && rm -rf "$D" && echo "clone deleted: $([ -e "$D" ] && echo NO || echo yes)"
df -h / | tail -1
echo "COLD_DONE"
