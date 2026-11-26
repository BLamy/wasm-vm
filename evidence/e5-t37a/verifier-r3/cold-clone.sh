#!/usr/bin/env bash
# Cold clone for the E5-T37a round-3 verifier: sparse (no evidence/ except the oracle baseline,
# no web/dist, no rr-traces), scrubbed environment (env -i: only HOME, PATH, TERM — no RUSTFLAGS,
# RUST_LOG, CARGO_*). The clone is deleted at the end.
#
#   bash evidence/e5-t37a/verifier-r3/cold-clone.sh <head> full    # acceptance + digests + pre-task digest
#   bash evidence/e5-t37a/verifier-r3/cold-clone.sh <head> tests   # the core suite only (promoted tests)
set -uo pipefail
REPO=/Users/blamy/Documents/Codex/wasm-vm
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/358f3812-2a26-47fa-96c6-985caf0a6f11/scratchpad
D=$S/cold-e5t37a-r3
HEAD_SHA=$1
MODE=${2:-full}
REL=$REPO/releases
IMG=$REPO/target/e5-t34b/image/replay-desktop.ext4
MINE=555555555
clean() { env -i HOME="$HOME" PATH="$PATH" TERM=dumb "$@"; }
df -h / | tail -1
rm -rf "$D"
git clone -q --no-checkout "$REPO" "$D" && cd "$D" || exit 9
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/evidence/' '/evidence/perf-overhaul/oracle-baseline/' '!/web/dist/' '!/rr-traces/'
git checkout -q "$HEAD_SHA"
echo "cold clone (sparse) at $(git rev-parse HEAD), tracked changes=$(git status --porcelain | wc -l | tr -d ' ')"
echo "non-test crates sources identical to 7fd2e0160: $(git diff --quiet 7fd2e0160 HEAD -- crates/core/src/lib.rs crates/core/src/time.rs crates/core/src/csr.rs crates/core/src/turbo.rs && echo yes || echo NO)"
echo "env passed to every command: $(clean env | cut -d= -f1 | tr '\n' ' ')"
echo '$ cargo test -p wasm-vm-core --lib paced_idle'
clean cargo test -p wasm-vm-core --lib paced_idle 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
echo '$ cargo test -p wasm-vm-core --lib'
clean cargo test -p wasm-vm-core --lib 2>&1 | grep -E "test result|FAILED|^error"
echo "rc=${PIPESTATUS[0]}"
if [ "$MODE" = full ]; then
  echo '$ cargo clippy -p wasm-vm-core --no-default-features --features std,trace,zicsr-stub --lib -- -D warnings   (the Makefile line)'
  clean cargo clippy -p wasm-vm-core --no-default-features --features std,trace,zicsr-stub --lib -- -D warnings > "$S/cold-stub.txt" 2>&1
  grep -E "^error" "$S/cold-stub.txt" | sort | uniq -c
  echo "errors naming an idle_* item, IDLE_SPIN_INSTRS, fresh_mip, paced_* or mip_bits: $(grep -cE 'idle_|IDLE_SPIN|fresh_mip|paced_|mip_bits' "$S/cold-stub.txt")"
  echo '$ cargo build --release -p wasm-vm-cli'
  clean cargo build --release -p wasm-vm-cli 2>&1 | tail -1
  echo "rc=${PIPESTATUS[0]}"
  echo '$ RELEASES=… bash tools/perf/oracle.sh target/release/wasm-vm target/cold-oracle && diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests'
  clean env RELEASES=$REL bash tools/perf/oracle.sh target/release/wasm-vm target/cold-oracle
  diff -r evidence/perf-overhaul/oracle-baseline target/cold-oracle/digests
  echo "diff rc=$? (1 with only the README line = identical digests)"
  for N in 2000000000 $MINE; do
    echo "\$ RELEASES=… IMAGE=… bash tools/perf/turbo-equivalence.sh $N target/cold-turbo-$N"
    clean env RELEASES=$REL IMAGE=$IMG bash tools/perf/turbo-equivalence.sh $N target/cold-turbo-$N
    echo "rc=$?"
  done
  cp target/cold-turbo-$MINE/turbo.evidence.txt "$S/cold-head-$MINE.evidence.txt"
  # Pure ICount must be untouched by the task: the same budget on a CLI built from the commit
  # before the task.
  git checkout -q ee5582ac6
  echo "--- pre-task commit $(git rev-parse HEAD)"
  echo '$ cargo build --release -p wasm-vm-cli'
  clean cargo build --release -p wasm-vm-cli 2>&1 | tail -1
  echo "rc=${PIPESTATUS[0]}"
  echo "\$ RELEASES=… IMAGE=… bash tools/perf/turbo-equivalence.sh $MINE target/cold-pre-$MINE"
  clean env RELEASES=$REL IMAGE=$IMG bash tools/perf/turbo-equivalence.sh $MINE target/cold-pre-$MINE | grep -E "EQUIVALENT|DIVERGED|fnv64|retired=|sha256" | sort -u
  if cmp -s target/cold-pre-$MINE/turbo.evidence.txt "$S/cold-head-$MINE.evidence.txt"; then
    echo "pre-task == head at $MINE: byte-identical evidence"
  else
    echo "pre-task DIFFERS from head at $MINE"
  fi
fi
cd "$S" && rm -rf "$D" "$S/cold-stub.txt" "$S/cold-head-$MINE.evidence.txt" && echo "clone deleted: $([ -e "$D" ] && echo NO || echo yes)"
df -h / | tail -1
echo "COLD_DONE"
