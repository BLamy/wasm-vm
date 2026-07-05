# Local mirror of .github/workflows/ci.yml — identical commands. CI runs the jobs in
# parallel; locally they run in the order listed under `ci`. If this file and ci.yml
# disagree, that's a bug (E0-T02).

.PHONY: ci fmt clippy test wasm features test-riscv diff-all diff-selftest diff-qemu

ci: fmt clippy test wasm features test-riscv

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

# riscv-tests rv64ui-p smoke gate (E0-T19). Uses the COMMITTED ELFs under
# tests/riscv-tests-bin/ (no Docker needed); rebuild them with
# `tools/toolchain/run.sh -- tools/riscv-tests/build.sh`. Native runs always; the wasm
# side runs only when wasm-pack is present.
test-riscv:
	cargo test -p wasm-vm-core --features zicsr-stub --test riscv_tests
	@command -v wasm-pack >/dev/null 2>&1 || { \
		echo "note: wasm-pack absent — skipping the wasm rv64ui-p run"; exit 0; }
	wasm-pack test --node crates/wasm --features zicsr-stub

# Spike differential harness (E0-T20): run every prebuilt guest under wasm-vm-cli AND
# Spike, normalize both into the E0-T16 canonical grammar, byte-compare at commit level.
# Needs the E0-T13 container (Spike); not in `ci` for that reason. Exits nonzero on any
# divergence.
diff-all:
	@for elf in guest/prebuilt/*.elf; do \
		echo "== diff $$elf =="; \
		tools/diff/run_diff.sh $$elf --level commit || exit 1; \
	done

# Proves the harness DETECTS divergence (injected corruption) and pins the normalizer
# against the committed golden.
diff-selftest:
	tools/diff/selftest.sh

# Secondary pc-level-only cross-check against QEMU. Matches for compute-only guests
# (loops); console guests diverge at the UART polling loop because QEMU models a real
# ns16550 with different THR-empty timing than our always-ready stub (Spike sidesteps
# this by mapping the UART page as plain RAM). Documented limitation, not a CPU bug.
diff-qemu:
	tools/diff/run_diff_qemu.sh guest/prebuilt/loops.elf
