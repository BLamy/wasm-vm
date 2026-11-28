#!/usr/bin/env bash
# E5-T43a round-5 verifier: gates at the exact head in a scratch sparse clone (git clone --shared), scrubbed env.
set -u
R="$1"; cd "$R" || exit 2
unset RUSTFLAGS RUST_LOG; for v in $(env | grep -o '^CARGO_[A-Z_]*'); do unset "$v"; done
export CARGO_TARGET_DIR="$R/target"
echo "# head $(git rev-parse HEAD)"
run() { echo "\$ $*"; "$@" > /tmp/gate.$$ 2>&1; rc=$?; grep -E '^test result:|^error|FAILED|panicked' /tmp/gate.$$ | head -20; echo "rc=$rc"; }
run cargo fmt --check -p wasm-vm-slirp -p wasm-vm-cli
for i in 1 2 3; do run cargo test -p wasm-vm-slirp --features native --lib; done
run cargo test -p wasm-vm-cli --test wvrelay_smoke --test wvrelay_token_rejection --test ws_connector_over_real_ws
run cargo clippy -p wasm-vm-slirp --features native --lib --tests -- -D warnings
( cd deploy/cloudflare-relay && run node --test test/client.test.mjs )
rm -f /tmp/gate.$$
