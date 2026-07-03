# Local mirror of .github/workflows/ci.yml — identical commands. CI runs the jobs in
# parallel; locally they run in the order listed under `ci`. If this file and ci.yml
# disagree, that's a bug (E0-T02).

.PHONY: ci fmt clippy test wasm features

ci: fmt clippy test wasm features

fmt:
	cargo fmt --all --check

clippy:
	cargo clippy --workspace --all-targets --all-features -- -D warnings

test:
	cargo test --workspace

# The wasm32 target itself is guaranteed by rust-toolchain.toml (rustup installs the
# pinned toolchain with its targets on first use); a non-rustup cargo fails loudly with
# "target may not be installed" — either way, never silently skipped.
wasm:
	cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
	@command -v wasm-pack >/dev/null 2>&1 || { \
		echo "error: wasm-pack is not installed."; \
		echo "  install with: cargo install wasm-pack   (or: brew install wasm-pack)"; \
		exit 1; }
	wasm-pack build crates/wasm --target web
	wasm-pack test --node crates/wasm

# Explicit {std,trace} powerset natively + the two no_std combos on wasm32 (E0-T15),
# mirroring ci.yml's `features` + `features-wasm` jobs.
features:
	cargo build -p wasm-vm-core --no-default-features
	cargo build -p wasm-vm-core --no-default-features --features std
	cargo build -p wasm-vm-core --no-default-features --features trace
	cargo build -p wasm-vm-core --no-default-features --features std,trace
	cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
	cargo build -p wasm-vm-core --no-default-features --features trace --target wasm32-unknown-unknown
