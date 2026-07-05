# Local mirror of .github/workflows/ci.yml — identical commands. CI runs the jobs in
# parallel; locally they run in the order listed under `ci`. If this file and ci.yml
# disagree, that's a bug (E0-T02).

.PHONY: ci fmt clippy test wasm features test-riscv diff-all diff-selftest diff-qemu \
        exhaustive fuzz-decode-smoke web-build web-serve bench

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

# Exhaustive 2^32 decode sweep (E0-T21): decode never panics + legal count == the analytic
# tally. Release + rayon; ~3s on a modern machine but heavy, so it is #[ignore] by default.
exhaustive:
	cargo test -p wasm-vm-core --release --test exhaustive -- --ignored

# 10^7-exec bounded libFuzzer smoke over the decoder (E0-T21). Needs the nightly toolchain
# + cargo-fuzz (`cargo install cargo-fuzz`); seed corpus in fuzz/corpus/decode/.
fuzz-decode-smoke:
	cd fuzz && cargo +nightly fuzz run decode -- -runs=10000000 -max_total_time=180

# Browser demo (E0-T23): build the wasm ES module into web/pkg, install the pinned
# xterm.js (offline, no CDN), and copy the default guest ELFs. Reproducible from a cold
# clone with only Rust + wasm-pack + npm.
web-build:
	wasm-pack build crates/wasm --target web --out-dir ../../web/pkg
	cd web && npm ci --no-audit --no-fund
	mkdir -p web/assets
	cp guest/prebuilt/hello.elf guest/prebuilt/loops.elf web/assets/

# Serve web/ over HTTP (wasm streaming + ES module MIME rules break file://).
web-serve:
	@echo "serving http://localhost:8080  (Ctrl-C to stop)"
	python3 -m http.server 8080 --directory web

# Interpreter MIPS baseline (E0-T24). Regenerates the native rows of docs/baselines.md;
# the node/browser rows come from web/bench-node.mjs and the demo page's Bench button.
bench:
	cargo bench -p wasm-vm-cli --bench interp

# ─────────────────────────────────────────────────────────────────────────────
# Adversarial-verification tooling (E0-T25). Each `verify-E0-Tnn` runs that task's
# acceptance checks mechanically and exits NONZERO on any failure. Composed from the
# shared _v-* recipes below. `verify-all` runs the union once (make builds each
# prerequisite at most once per invocation); `verify-list` maps targets↔tasks and fails
# if any task file lacks a target. Tools that are missing SKIP loudly and exit nonzero
# unless VERIFY_ALLOW_SKIP=1 — silence is forbidden.
# ─────────────────────────────────────────────────────────────────────────────
.PHONY: verify-all verify-list \
        _v-fmt _v-clippy _v-test _v-features _v-wasm _v-exhaustive _v-zerocost \
        _v-riscv _v-diff _v-web _v-bench _v-toolchain _v-fuzz _v-meta

# skip helper: $(call v_skip,<reason>) — used inside an else branch.
v_skip = echo "SKIPPED: $(1)"; [ "$(VERIFY_ALLOW_SKIP)" = "1" ] || exit 1

_v-fmt: ; cargo fmt --all --check
_v-clippy: ; cargo clippy --workspace --all-targets --all-features -- -D warnings
_v-test: ; cargo test --workspace
_v-features:
	cargo build -p wasm-vm-core --no-default-features
	cargo build -p wasm-vm-core --no-default-features --features std,trace
_v-exhaustive: ; cargo test -p wasm-vm-core --release --test exhaustive -- --ignored
_v-zerocost: ; bash tools/check-zero-cost.sh --selftest
_v-riscv:
	cargo test -p wasm-vm-core --features zicsr-stub --test riscv_tests
	bash tools/riscv-tests/check-quarantine.sh

_v-wasm:
	@if command -v wasm-pack >/dev/null 2>&1; then \
	  wasm-pack test --node crates/wasm; \
	else $(call v_skip,wasm-pack not installed); fi

_v-diff:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
	  tools/diff/selftest.sh; \
	else $(call v_skip,Docker unavailable for the Spike differential); fi

_v-web:
	@if command -v wasm-pack >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then \
	  $(MAKE) web-build; \
	else $(call v_skip,wasm-pack or npm not installed); fi

_v-bench:
	cargo bench -p wasm-vm-cli --bench interp -- --warm-up-time 1 --measurement-time 1 --sample-size 10

_v-toolchain:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
	  tools/toolchain/run.sh -- tools/toolchain/smoke.sh; \
	else $(call v_skip,Docker unavailable for the reference toolchain); fi

_v-fuzz:
	@if command -v cargo-fuzz >/dev/null 2>&1 && rustup toolchain list 2>/dev/null | grep -q nightly; then \
	  cd fuzz && cargo +nightly fuzz run decode -- -runs=2000000 -max_total_time=25; \
	else $(call v_skip,nightly + cargo-fuzz not installed); fi

_v-meta: ; bash tools/verify/self_check.sh

# ── per-task targets (one per file in tasks/epic-0-ignition/) ────────────────
verify-E0-T01: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T01 (cargo workspace): OK"
verify-E0-T02: _v-fmt _v-clippy _v-test _v-features _v-wasm ; @echo "verify-E0-T02 (CI pipeline): OK"
verify-E0-T03: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T03 (ram + bus): OK"
verify-E0-T04: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T04 (mmio dispatch): OK"
verify-E0-T05: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T05 (register file): OK"
verify-E0-T06: _v-fmt _v-clippy _v-test _v-exhaustive ; @echo "verify-E0-T06 (decoder): OK"
verify-E0-T07: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T07 (hart step): OK"
verify-E0-T08: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T08 (loads/stores): OK"
verify-E0-T09: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T09 (control flow): OK"
verify-E0-T10: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T10 (ELF loader): OK"
verify-E0-T11: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T11 (ecall/HTIF): OK"
verify-E0-T12: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T12 (console): OK"
verify-E0-T13: _v-toolchain ; @echo "verify-E0-T13 (toolchain): OK"
verify-E0-T14: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T14 (golden binaries): OK"
verify-E0-T15: _v-fmt _v-clippy _v-test _v-zerocost ; @echo "verify-E0-T15 (logging/zero-cost): OK"
verify-E0-T16: _v-fmt _v-clippy _v-test _v-wasm ; @echo "verify-E0-T16 (trace records): OK"
verify-E0-T17: _v-fmt _v-clippy _v-test _v-wasm ; @echo "verify-E0-T17 (snapshot digest): OK"
verify-E0-T18: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T18 (CLI runner): OK"
verify-E0-T19: _v-fmt _v-clippy _v-test _v-riscv ; @echo "verify-E0-T19 (riscv-tests): OK"
verify-E0-T20: _v-diff ; @echo "verify-E0-T20 (Spike differential): OK"
verify-E0-T21: _v-fmt _v-clippy _v-test _v-exhaustive _v-fuzz ; @echo "verify-E0-T21 (decoder fuzz): OK"
verify-E0-T22: _v-fmt _v-clippy _v-test _v-wasm ; @echo "verify-E0-T22 (wasm-bindgen): OK"
verify-E0-T23: _v-web ; @echo "verify-E0-T23 (browser demo): OK"
verify-E0-T24: _v-fmt _v-clippy _v-test _v-bench ; @echo "verify-E0-T24 (IPS benchmark): OK"
verify-E0-T25: _v-fmt _v-clippy _v-meta ; @echo "verify-E0-T25 (verify tooling): OK"
verify-E0-T26: _v-fmt _v-clippy _v-test ; @echo "verify-E0-T26 (capstone — base checks): OK"

verify-all: verify-E0-T01 verify-E0-T02 verify-E0-T03 verify-E0-T04 verify-E0-T05 \
            verify-E0-T06 verify-E0-T07 verify-E0-T08 verify-E0-T09 verify-E0-T10 \
            verify-E0-T11 verify-E0-T12 verify-E0-T13 verify-E0-T14 verify-E0-T15 \
            verify-E0-T16 verify-E0-T17 verify-E0-T18 verify-E0-T19 verify-E0-T20 \
            verify-E0-T21 verify-E0-T22 verify-E0-T23 verify-E0-T24 verify-E0-T25 \
            verify-E0-T26
	@echo "verify-all: every Epic 0 verify target passed"

verify-list: ; @bash tools/verify/list.sh
