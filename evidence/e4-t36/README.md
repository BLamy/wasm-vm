# E4-T36 — guarded cross-page links

Exact implementation head: `61a3654` (`jit: guard cross-page static links`).

This is the local closure requested for the task. It claims guest behavior on this Mac through the
Node wasm harness and native Rust checks. It does not claim independent-machine, WebKit, or rr
coverage.

## Recorded acceptance run

```text
wasm-pack test --node crates/wasm --test jit_browser_parity
running 35 tests
34 passed; 0 failed; 1 ignored
finished in 5.37s
```

The active run exercised the new remap, execute-permission, and remaining-budget-tail refusal
tests, the existing page invalidation/re-arm and code-store invalidation paths, the cross-page
load/store and precise-fault paths, and the eight-block warm chain. The chain asserted
`direct_chain_entries >= 8` and `direct_chain_links >= 7`, which is at least 7.3 logical blocks per
engine call. The ignored test is the pre-existing long retranslation/externref churn campaign.

## Supporting gates

All passed at this head:

```text
cargo fmt --all --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -- -D warnings
cargo clippy --target wasm32-unknown-unknown -p wasm-vm-wasm --lib -- -D warnings
cargo check -p wasm-vm-core -p wasm-vm-jit-translate
cargo check --target wasm32-unknown-unknown -p wasm-vm-wasm --lib
cargo test -p wasm-vm-core
cargo test -p wasm-vm-jit-translate
bash tools/build-web-dist.sh
```

`cargo test -p wasm-vm-core` completed with all 175 unit tests and its integration suites passing;
`cargo test -p wasm-vm-jit-translate` completed with 10 tests passing and 2 pre-existing ignored
differential campaigns. The wasm test build reports the pre-existing unused `Exception` import in
`crates/wasm/tests/hart_ctrl.rs`; it is unrelated to this diff.

## Coverage notes

The implementation changes are covered by the Node parity run and the native/target checks:

- generated static-link authority words and EXEC-TLB predicates are exercised by the cross-page
  chain and remap tests;
- the core's authorized-link publication is exercised by the warmed chain and exact tail refusal;
- PMP revision invalidation is exercised by the execute-permission test;
- inline EXEC-TLB placement and refill are exercised by all inline-TLB browser tests;
- static-link clearing/republication is exercised by page invalidation, code-store SMC, and re-arm
  tests.
