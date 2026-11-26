---
id: E5-T40
epic: 5
title: `clippy --all-targets` builds for the core alone and in a clone without evidence/
priority: 0.387662
status: pending
depends_on: [E5-T37a]
estimate: S
risk: low
capstone: false
---

## Why this exists

Two findings of the E5-T37a verifiers, both outside that task:

1. `cargo clippy -p wasm-vm-core --all-targets -- -D warnings` (the core alone) does not build:
   three example/test targets import a feature-gated `VecSink`. The form with
   `-p wasm-vm-cli` beside it passes, because the CLI turns the feature on.
2. A clone without `evidence/` cannot build `--all-targets` for `wasm-vm-core` or
   `wasm-vm-wasm`: `crates/core/tests/virtio_keyboard_guest_stream.rs:148` and
   `crates/wasm/tests/retirement_capture_baseline.rs:36` `include!` tracked files under
   `evidence/`, so a sparse cold clone that leaves evidence out fails its lint gate.

## Boundary

Test and example targets only: gate the three targets on the feature they need
(`required-features`), and move the two fixtures the tests include to a place a sparse clone
keeps (for example `crates/*/tests/fixtures/`), leaving the evidence copies where the task
logs cite them. No runtime code.

## Deterministic acceptance

`cargo clippy -p wasm-vm-core --all-targets -- -D warnings` passes; in a sparse clone without
`evidence/`, `cargo clippy -p wasm-vm-core -p wasm-vm-wasm -p wasm-vm-cli --all-targets -- -D warnings`
passes; `cargo test -p wasm-vm-core --test virtio_keyboard_guest_stream` and
`cargo test -p wasm-vm-wasm --test retirement_capture_baseline` still pass.

## Verification log
