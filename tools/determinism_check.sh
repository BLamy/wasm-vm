#!/usr/bin/env bash
# E1-T22: prove the native and wasm32 builds are the same machine. Runs the determinism harness on
# BOTH builds; both assert the same frozen golden fingerprints (tests/golden/determinism_golden.rs),
# so passing both is a native==wasm equality proof. `--full` also runs the whole-corpus two-run
# reproducibility leg (~4 min, native only). No external oracle needed.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== determinism hazards (static) =="
bash tools/ci/determinism-hazards.sh

echo "== native fingerprints vs golden =="
cargo test -p wasm-vm-core --test determinism pinned_fingerprints_match_golden -- --exact
cargo test -p wasm-vm-core --test determinism hash_sink_distinguishes_every_field -- --exact

if [[ "${1:-}" == "--full" ]]; then
  echo "== native full-corpus two-run reproducibility (nightly) =="
  cargo test -p wasm-vm-core --test determinism full_corpus_is_run_to_run_reproducible -- --ignored --exact
fi

echo "== wasm32 fingerprints vs the SAME golden (native==wasm) =="
if command -v wasm-pack >/dev/null 2>&1; then
  wasm-pack test --node crates/wasm --test determinism
else
  echo "note: wasm-pack absent — skipping the wasm leg (CI runs it)"; exit 1
fi
