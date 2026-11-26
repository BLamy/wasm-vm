#!/usr/bin/env bash
# Cold clone for the E5-T37a verifier: sparse (no evidence/ except the oracle baseline, no web/dist),
# scrubbed environment (env -i: no RUSTFLAGS, RUST_LOG, CARGO_*).
set -uo pipefail
REPO=/Users/blamy/Documents/Codex/wasm-vm
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/358f3812-2a26-47fa-96c6-985caf0a6f11/scratchpad
D=$S/cold-e5t37a
HEAD_SHA=e4599fe73a8ec7d616e521f8dbfac464ec0e1e6f
BASE_SHA=ee5582ac6
REL=$REPO/releases
IMG=$REPO/target/e5-t34b/image/replay-desktop.ext4
clean() { env -i HOME="$HOME" PATH="$PATH" TERM=dumb "$@"; }
rm -rf "$D"
git clone -q --no-checkout "$REPO" "$D" && cd "$D" || exit 9
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/evidence/' '/evidence/perf-overhaul/oracle-baseline/' '!/web/dist/' '!/rr-traces/'
git checkout -q "$HEAD_SHA"
echo "cold clone (sparse) at $(git rev-parse HEAD), tracked changes=$(git status --porcelain | wc -l | tr -d ' ')"
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
diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests; echo "diff rc=$? (1 with only the README line = identical digests)"
for N in 2000000000 777777777; do
  echo "\$ RELEASES=… IMAGE=… bash tools/perf/turbo-equivalence.sh $N target/cold-turbo-$N"
  clean env RELEASES=$REL IMAGE=$IMG bash tools/perf/turbo-equivalence.sh $N target/cold-turbo-$N; echo "rc=$?"
done
cp target/cold-turbo-777777777/turbo.evidence.txt $S/head-777777777.evidence.txt
echo "=== pre-task commit $BASE_SHA, same clone, same budget (the claim: pure ICount behaves exactly as before) ==="
git checkout -q "$BASE_SHA"; echo "at $(git rev-parse HEAD)"
clean cargo build --release -p wasm-vm-cli 2>&1 | tail -1
echo "\$ RELEASES=… IMAGE=… bash tools/perf/turbo-equivalence.sh 777777777 target/cold-base-turbo-777777777"
clean env RELEASES=$REL IMAGE=$IMG bash tools/perf/turbo-equivalence.sh 777777777 target/cold-base-turbo-777777777; echo "rc=$?"
if cmp -s target/cold-base-turbo-777777777/turbo.evidence.txt $S/head-777777777.evidence.txt; then echo "BASE == HEAD at 777777777 instructions (evidence files byte-identical)"; else echo "BASE != HEAD at 777777777 instructions"; fi
echo "COLD_DONE"
