#!/usr/bin/env bash
# E1-T23: regenerate the native Level-1 MIPS baseline (docs/perf/level1-baseline.md).
# Prints the per-workload median MIPS + spread + JSON. Release build; minstret-based metric.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Level-1 interpreter MIPS baseline (native, release) =="
cargo test -p wasm-vm-core --release --test perf_baseline report -- --ignored --nocapture \
  | sed -n '/E1-T23 native perf baseline/,/^]/p'
echo
echo "record these into docs/perf/level1-baseline.md (host info from: rustc --version, uname -a)"
