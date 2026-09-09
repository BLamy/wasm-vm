# E4-T37 — bounded multi-target JALR return PIC

## Result

`VERDICT: verified` at implementation commit `e1a1be2` (`jit: add bounded multi-target return PIC`).

The fresh local Node run exercises the generated browser path with five targets hashing to one
four-way set. It observes four live entries, refuses the fifth target on its first observation,
performs exactly one hysteretic replacement on the second, and keeps the compiled module count and
compiled-block install count unchanged. It also exercises target fuel exhaustion, physical-page
invalidation while a sibling target remains hot, a live key/index with a deliberately corrupted
expected host-page authority word, stale-target refusal, and whole-cache reset.

The run's asserted telemetry is:

```text
after four targets: attempts=6 hits=5 refusals=1 retargets=0 live_entries=4 installs=4
after fifth-target replacement: retargets=1 live_entries=4 installs=5
after invalidation/authority attacks: no stale target entry executes; live_entries=3
```

## Commands

```text
cargo fmt --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate -- -D warnings
cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown
cargo test -p wasm-vm-core
cargo test -p wasm-vm-jit-translate
wasm-pack test --node crates/wasm --test jit_browser_parity
wasm-pack test --node crates/wasm --test wrapper
make web-dist
```

Observed results: all listed commands passed; the JIT parity target reported `34 passed, 0
failed, 1 ignored`, the wrapper target reported `9 passed, 0 failed`, and the generated dist
contains the telemetry fields and verified roadmap capability.

Host-layer rr and independent-machine/WebKit runs are intentionally absent under the repository's
current rr waiver and the user's explicit local-only verification scope.
