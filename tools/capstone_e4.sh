#!/usr/bin/env bash
# E4-T28a: validate the reproducible Level-4 capstone measurement boundary.
#
#   bash tools/capstone_e4.sh --self-test
#   bash tools/capstone_e4.sh --prepare --output evidence/e4-t28a/capstone-prepare.json
#
# The capstone contract never inherits caller-controlled build, logging, benchmark, or browser
# cache knobs. Keep PATH and ordinary shell settings intact, but remove only the named inputs.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

unset RUSTFLAGS RUSTDOCFLAGS RUST_LOG
for name in $(env | sed -n 's/^\(CARGO_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$name"
done
for name in $(env | sed -n 's/^\(WASM_VM_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$name"
done
unset CCACHE_DIR SCCACHE_DIR NPM_CONFIG_CACHE PLAYWRIGHT_BROWSERS_PATH

exec python3 "$here/capstone_e4.py" "$@"
