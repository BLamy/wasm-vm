#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root; the sole argument is an isolated build-output directory.
# No clone, source mutation, sabotage, browser, or old-task replay is performed.
export CARGO_TARGET_DIR="${1:?pass the isolated target directory}"
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS RUST_LOG CARGO_BUILD_TARGET
unset CARGO_BUILD_RUSTFLAGS RUSTC_WRAPPER RUSTC_WORKSPACE_WRAPPER
set -x
git rev-parse HEAD
shasum -a 256 crates/core/src/dev/plic.rs \
    crates/core/tests/support/plic_sparse_cases.rs \
    crates/core/tests/support/plic_sparse_verifier_cases.rs \
    crates/core/tests/plic_sparse_verifier.rs crates/wasm/tests/plic_sparse_verifier.rs
rustfmt --edition 2024 --check crates/core/tests/plic_sparse_verifier.rs \
    crates/wasm/tests/plic_sparse_verifier.rs
cargo clippy -p wasm-vm-core --features trace --test plic_sparse_verifier -- -D warnings
cargo clippy -p wasm-vm-wasm --test plic_sparse_verifier --target wasm32-unknown-unknown -- -D warnings
cargo test -p wasm-vm-core --features trace --test plic_sparse_verifier -- --nocapture
wasm-pack test --node crates/wasm --test plic_sparse_verifier -- --nocapture
shasum -a 256 crates/core/src/dev/plic.rs crates/core/tests/support/plic_sparse_cases.rs
echo 'E5-T26o verifier variant: EXIT=0'
