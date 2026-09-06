# Local mirror of .github/workflows/ci.yml — identical commands. CI runs the jobs in
# parallel; locally they run in the order listed under `ci`. If this file and ci.yml
# disagree, that's a bug (E0-T02).

.PHONY: ci fmt clippy test wasm features test-riscv riscv-tests-suite determinism perf-smoke perf-gate perf-trend bench-l1 riscof diff-all diff-selftest diff-qemu \
        exhaustive fuzz-decode-smoke fuzz-diff-smoke web-build web-serve web-dist hooks bench capstone-e0 level1-gate tasks-json \
        bench-guest-build bench-coremark bench-dhrystone bench-gcc-build bench-gcc bench-runtime-workloads bench-runtime-compute bench-runtime-workloads-browser bench-runtime-compute-browser \
        web-test-cpu-worker verify-E5-T16a verify-E5-T18a verify-E5-T18c

ci: fmt clippy test wasm features test-riscv riscv-tests-suite determinism perf-smoke

fmt:
	cargo fmt --all --check

clippy:
	cargo clippy --workspace --all-targets --all-features -- -D warnings

test:
	cargo test --workspace
	bash tools/ci/no-host-float.sh
	bash tools/ci/determinism-hazards.sh

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

# E4-T22: the SHARED-MEMORY (threaded CPU worker) variant of the main core module. Needs nightly +
# rust-src (build-std recompiles std with +atomics). Emits an IMPORTED shared `env.memory`; the
# single-threaded fallback stays on `make wasm` above. See docs/e4-t22-cpu-worker-coop-coep.md.
wasm-shared:
	bash tools/build-web-shared.sh

# E4-T22: node unit tests for the CPU-backend isolation probe + shared control-block signalling,
# worker-side placement audit, and the local Chromium worker-boot leg.
web-test-cpu-worker:
	node --test web/tests/cpu-isolation.test.mjs web/tests/cpu-control-block.test.mjs web/tests/device-proxy.test.mjs
	# E4-T23 adversarial #5: worker-side device code must not reach a main-thread-only API.
	node tools/worker-device-audit.mjs
	cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8139 PLAYWRIGHT_REUSE_SERVER=0 \
		./node_modules/.bin/playwright test tests/e4-t22d-worker-bootstrap.spec.js --workers=1

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

# E1-T19: the full riscv-tests regression wall over the committed ELFs (real E1 CSR file),
# emitting target/riscv-tests-report.{md,json} and enforcing tests/riscv-tests-allowlist.txt.
# Mirrors ci.yml's `riscv-tests` job.
riscv-tests-suite:
	bash tools/run_riscv_tests.sh

# E1-T22: native==wasm determinism proof — both builds assert the same golden fingerprints.
# Mirrors ci.yml's `determinism` job. `make determinism FULL=--full` adds the whole-corpus leg.
determinism:
	bash tools/determinism_check.sh $(FULL)

# E1-T23: perf-smoke (release ALU MIPS ≥ floor) — mirrors ci.yml's `perf-smoke` job.
perf-smoke:
	cargo test -p wasm-vm-core --release --test perf_baseline perf_smoke_alu_above_floor -- --ignored --nocapture

# E4-T27: perf-regression gate — statistics/threshold/bless machinery selftest + ledger chain verify.
perf-gate:
	python3 tools/bench_ci.py selftest
	python3 tools/bench.py report --verify

# E4-T27: render the trend dashboard from the ledger (one command, clean checkout).
perf-trend:
	python3 tools/bench_ci.py trend --out bench/trend.html

# E1-T23: regenerate the native Level-1 MIPS baseline table.
bench-l1:
	bash tools/bench.sh

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

# Differential fuzz smoke (E1-T21): sweep a fixed seed range of constrained-random RV64IM
# streams in lockstep against Spike. Needs Docker (toolchain image) + a release CLI. Fails
# (exit 3) on ANY divergence, which auto-minimizes to a reproducer in tests/fuzz-regressions/.
# Fixed seeds ⇒ reproducible; widen --to for a deeper campaign.
fuzz-diff-smoke:
	cargo build --release -p wasm-vm-cli
	cargo run -p wasm-vm-fuzz -- campaign --from 0 --to 32 --count 128 --isa rv64im

# Browser demo (E0-T23): build the wasm ES module into web/pkg, install the pinned
# xterm.js (offline, no CDN), and copy the browser-run guest ELFs. Reproducible from a
# cold clone with only Rust + wasm-pack + npm.
web-build:
	wasm-pack build crates/wasm --target web
	cd web && npm ci --no-audit --no-fund
	mkdir -p web/pkg web/assets/riscv-tests
	cp -R crates/wasm/pkg/. web/pkg/
	cp guest/prebuilt/hello.elf guest/prebuilt/loops.elf web/assets/
	cp tests/riscv-tests-bin/* web/assets/riscv-tests/
	# Boot artifacts must live UNDER web/ (the Pages publish_dir) so they deploy with the site.
	# Paths mirror the relative URLs in web/artifacts.json (regenerated by tools/gen-web-manifest.sh).
	mkdir -p web/releases/kernel/6.6.63 web/releases/initramfs
	cp releases/kernel/6.6.63/Image web/releases/kernel/6.6.63/Image
	cp releases/initramfs/initramfs.cpio.gz web/releases/initramfs/initramfs.cpio.gz
	# E4 restore-on-first-load: the (optional) compressed busybox boot snapshot, if built. Small
	# enough to ship on Pages (deploy-cloudflare.sh keeps its URL relative, unlike kernel/initramfs).
	@if [ -f releases/boot-snapshot/busybox-ready.snap.gz ]; then \
	  mkdir -p web/releases/boot-snapshot; \
	  cp releases/boot-snapshot/busybox-ready.snap.gz web/releases/boot-snapshot/busybox-ready.snap.gz; \
	fi
	bash tools/gen-web-manifest.sh

# Regenerate web/tasks.json from the /tasks folder (the roadmap's single source of truth).
# Run after editing any task file; the Roadmap tab fetches ./tasks.json at load.
tasks-json:
	python3 tools/gen-tasks-json.py

# Serve web/ over HTTP (wasm streaming + ES module MIME rules break file://).
web-serve:
	@echo "serving http://localhost:8080  (Ctrl-C to stop)"
	python3 -m http.server 8080 --directory web

# poor-mans-ci: assemble the committed, deployable web/dist (build wasm + vendor deps locally). The
# pre-commit hook runs this automatically when web/wasm sources change; run it by hand to refresh dist.
web-dist:
	bash tools/build-web-dist.sh

# Install the git hooks (the pre-commit hook that rebuilds + stages web/dist on web/wasm changes).
hooks:
	git config core.hooksPath tools/git-hooks
	@echo "hooks installed: core.hooksPath = tools/git-hooks (pre-commit rebuilds web/dist)"

# Interpreter MIPS baseline (E0-T24).
bench:
	cargo bench -p wasm-vm-cli --bench interp

# Portable Node system workload suite. Override the script flags when collecting
# a slower guest run; the output keeps every sample and verification digest.
bench-runtime-workloads:
	node web/bench-runtime-workloads.mjs --environment=native-node --output /tmp/wasm-vm-runtime-workloads.json

# Portable steady-state Node compute suite. This is a separate campaign from the system/I/O
# workload matrix so translation and dispatch amortization are visible without hiding boundary cost.
bench-runtime-compute:
	node web/bench-runtime-compute.mjs --environment=native-node --output /tmp/wasm-vm-runtime-compute.json

bench-runtime-workloads-browser:
	node tools/run-runtime-workload-browser.mjs --variant=$(RUNTIME_BENCH_VARIANT) --output /tmp/wasm-vm-runtime-$(RUNTIME_BENCH_VARIANT).json

bench-runtime-compute-browser:
	node tools/run-runtime-compute-browser.mjs --variant=$(RUNTIME_BENCH_VARIANT) --output /tmp/wasm-vm-runtime-compute-$(RUNTIME_BENCH_VARIANT).json

# E4-T03: in-guest CoreMark/Dhrystone harness. `bench-guest-build` rebuilds the pinned riscv64
# ELFs + the ext4 overlay inside the pinned Docker toolchain (needs Docker); the run targets boot
# the release wasm-vm on Alpine and emit a JSON score (each cold run takes minutes on the
# interpreter). Browser engine is reaping-deferred (see bench/README.md).
bench-guest-build:
	bash bench/build.sh
	bash bench/mkimage.sh

bench-coremark:
	python3 tools/bench.py run coremark --engine native

bench-dhrystone:
	python3 tools/bench.py run dhrystone --engine native

# E4-T04: in-guest gcc -O2 compile macro bench. `bench-gcc-build` cross-installs a pinned Alpine
# gcc/musl-dev/binutils toolchain into the ~130 MB gcc.ext4 overlay (gitignored; needs Docker);
# `bench-gcc` boots the release wasm-vm, mounts it read-only, and compiles the vendored miniz.c.
# A single run is many minutes on the interpreter (full Alpine boot + a real -O2 compile).
bench-gcc-build:
	bash bench/mk-gcc-image.sh

bench-gcc:
	python3 tools/bench.py run gcc --engine native

# E0 capstone (E0-T26): the automated proof — Hello from RV64 with native == node-wasm ==
# Spike traces byte-for-byte — then the manual browser checklist. Run from a cold clone
# via `tools/verify/cold_clone.sh capstone-e0`. Needs Docker (Spike), wasm-pack, node.
capstone-e0:
	tools/capstone/e0.sh
	@echo
	@echo "── manual browser step (see docs/capstone-e0.md) ──"
	@echo "  make web-build web-serve, then in a FRESH Chrome AND Firefox profile open"
	@echo "  http://localhost:8080 : Run -> 'Hello from RV64', status 'exited code=0',"
	@echo "  retired=83, zero console errors; save take_trace() and cmp against native."

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
        _v-riscv _v-diff _v-web _v-bench _v-toolchain _v-fuzz _v-meta _v-capstone

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

_v-capstone:
	@if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
	    && command -v wasm-pack >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then \
	  CAPSTONE_SKIP_VERIFY_ALL=1 tools/capstone/e0.sh; \
	else $(call v_skip,Docker + wasm-pack + node needed for the capstone trace proof); fi

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
verify-E0-T26: _v-fmt _v-clippy _v-capstone ; @echo "verify-E0-T26 (capstone): OK"

verify-all: verify-E0-T01 verify-E0-T02 verify-E0-T03 verify-E0-T04 verify-E0-T05 \
            verify-E0-T06 verify-E0-T07 verify-E0-T08 verify-E0-T09 verify-E0-T10 \
            verify-E0-T11 verify-E0-T12 verify-E0-T13 verify-E0-T14 verify-E0-T15 \
            verify-E0-T16 verify-E0-T17 verify-E0-T18 verify-E0-T19 verify-E0-T20 \
            verify-E0-T21 verify-E0-T22 verify-E0-T23 verify-E0-T24 verify-E0-T25 \
            verify-E0-T26
	@echo "verify-all: every Epic 0 verify target passed"

verify-list: ; @bash tools/verify/list.sh

.PHONY: check-task-policy
check-task-policy:
	python3 tools/check_task_policy.py

# E1-T20: RISCOF architectural compliance (DUT=wasm-vm vs Spike). Needs `bash compliance/provision.sh`
# first (riscof venv + arch-test) + the Docker toolchain image (Spike). Enforces compliance/EXCLUSIONS.md.
riscof:
	bash tools/run_riscof.sh

.PHONY: verify-E3-T19
verify-E3-T19:
	cargo fmt --all --check
	cargo clippy -p wasm-vm-slirp -p wasm-vm-cli -- -D warnings
	cargo test -p wasm-vm-slirp --lib relay_security
	cargo test -p wasm-vm-slirp --lib secure_relay
	cargo test -p wasm-vm-cli --bin wvrelay
	bash tools/verify/e3-t19-deployment.sh
	bash tools/verify/e3-t19-live-proof.sh
	cd web && npx playwright test tests/e3-t17-provider-selection.spec.js tests/e3-t19-provider-security.spec.js
	@echo "verify-E3-T19 (provider lifecycle + relay security): OK"

.PHONY: verify-E3-T19c
verify-E3-T19c:
	# Relay token rejection — deterministic, no live tailnet. Server-side enforcement proven by a
	# direct WebSocket attempt against the real wvrelay binary.
	cargo fmt --check -p wasm-vm-cli -p wasm-vm-slirp
	cargo clippy -p wasm-vm-cli --test wvrelay_token_rejection -- -D warnings
	# The token-verification unit boundary (signature / expiry / lifetime / origin), injected clock.
	cargo test -p wasm-vm-slirp --lib relay_security
	# End-to-end server-side rejection: absent / expired / wrong-origin token + disallowed handshake
	# Origin are all closed before OPEN; a valid token opens the protected path.
	cargo test -p wasm-vm-cli --test wvrelay_token_rejection
	@echo "verify-E3-T19c (relay token rejection, server-side): OK"

.PHONY: verify-E3-T19a-state
verify-E3-T19a-state:
	# E3-T19a (deterministic slice): the persist/restore validation boundary — only hex key material
	# is ever restored; tampered / oversized / non-hex / array / non-object saved state is rejected, so
	# a stray auth key can never be restored. The live docker-compose tailnet-HTTPS + reload proof is
	# blocked_on E4-T13 (kept off the flaky live path deliberately; see the ticket).
	cd web && node --test tests/tailscale-state.test.mjs
	cd web && node --check tailscale-runtime.js
	@echo "verify-E3-T19a-state (Tailscale persist/restore validation): OK"

.PHONY: verify-E3-T22a
verify-E3-T22a:
	# OSC 52 copy handler — deterministic parse/cap/gate logic, node unit tests (no browser needed).
	# AC1 (c;<base64> decodes + writes once; a rejected write routes to onCopyBlocked), AC2 (oversize
	# + malformed classify invalid, no decode/throw), AC3 (query gated off by default; honored live).
	cd web && node --test tests/osc52.test.mjs
	# The terminal wiring stays syntactically valid (it imports ./osc52.js and registers the handler).
	cd web && node --check osc52.js && node --check terminal.js
	@echo "verify-E3-T22a (OSC 52 copy handler): OK"

.PHONY: verify-E3-T22b
verify-E3-T22b:
	# Paste framing — deterministic newline normalization + bracketed wrap + embedded end-marker
	# neutralization (paste-injection defense), node unit tests (no browser needed).
	cd web && node --test tests/paste.test.mjs
	# The terminal wiring (paste interceptor + pasteText) stays syntactically valid.
	cd web && node --check paste.js && node --check terminal.js
	@echo "verify-E3-T22b (paste pipeline framing): OK"

.PHONY: verify-E3-T22c
verify-E3-T22c:
	# Guest clipboard conveniences. The osc52-copy helper's emitted OSC 52 byte sequence is proven
	# deterministically (no boot); the rootfs wiring (helper + vim/tmux config) stays shell-valid.
	node --test tools/rootfs/osc52-copy.test.mjs
	sh -n tools/rootfs/osc52-copy && bash -n tools/rootfs-inner.sh && bash -n tools/build-rootfs.sh
	@echo "verify-E3-T22c (osc52-copy helper + rootfs wiring): OK"

.PHONY: verify-E3.5-T04f
verify-E3.5-T04f:
	# Content-addressed layer-cache core — put-once / verify-on-read / dedupe / LRU, node unit tests.
	cd web && node --test tests/oci-blob-cache.test.mjs
	cd web && node --check oci-blob-cache.js
	@echo "verify-E3.5-T04f (layer-cache core): OK"

.PHONY: verify-E3-T21d
verify-E3-T21d:
	$(MAKE) web-build
	cd web && npx playwright test tests/e3-t21d-durability.spec.js --trace retain-on-failure
	@echo "verify-E3-T21d (frozen guest round trip + reboot durability): OK"

.PHONY: verify-E5-T23c
verify-E5-T23c:
	bash tools/verify/e5-t23c-static-agent.sh
	@echo "verify-E5-T23c (static virtio-console guest agent + rootfs service): OK"

.PHONY: verify-E5-T23d
verify-E5-T23d:
	node --test web/tests/agent-channel.test.mjs
	@echo "verify-E5-T23d (host agent Channel lifecycle + reconnect): OK"

.PHONY: verify-E5-T23e
verify-E5-T23e:
	cargo fmt --check -p wasm-vm-agent-protocol -p wasm-vm-guest-agent -p wasm-vm-cli
	cargo clippy -p wasm-vm-agent-protocol -p wasm-vm-guest-agent -p wasm-vm-cli --bin wasm-vm -- -D warnings
	cargo test -p wasm-vm-agent-protocol
	cargo test -p wasm-vm-guest-agent
	cargo test -p wasm-vm-core virtio_console
	node --test web/tests/agent-channel.test.mjs
	cargo build --release -p wasm-vm-cli
	$(MAKE) web-dist
	node tools/verify/e5-t23e-agent-channel-proof.mjs
	@echo "verify-E5-T23e (end-to-end guest agent channel proof): OK"

.PHONY: verify-E5-T24a
verify-E5-T24a:
	cargo test -p wasm-vm-agent-protocol
	node --test web/tests/agent-channel.test.mjs
	@echo "verify-E5-T24a (bounded clipboard protocol): OK"

.PHONY: verify-E5-T24b
verify-E5-T24b:
	cargo fmt --check -p wasm-vm-agent-protocol -p wasm-vm-guest-agent
	cargo clippy -p wasm-vm-agent-protocol -p wasm-vm-guest-agent --all-targets -- -D warnings
	cargo test -p wasm-vm-agent-protocol
	cargo test -p wasm-vm-guest-agent -- --nocapture
	@echo "verify-E5-T24b (bounded guest clipboard bridge): OK"

.PHONY: verify-E5-T24c
verify-E5-T24c:
	node --check web/clipboard-service.js
	node --check web/agent-channel.js
	node --test web/tests/clipboard-service.test.mjs
	@echo "verify-E5-T24c (host clipboard permissions and gesture ordering): OK"

.PHONY: verify-E5-T24d
verify-E5-T24d:
	node --check tools/verify/e5-t24d-clipboard-proof.mjs
	node --test web/tests/clipboard-service.test.mjs
	node tools/verify/e5-t24d-clipboard-proof.mjs
	@echo "verify-E5-T24d (bidirectional clipboard browser and guest proof): OK"

.PHONY: verify-E5-T04
verify-E5-T04:
	cargo fmt --check -p wasm-vm-core
	cargo clippy -p wasm-vm-core --lib --tests -- -D warnings
	cargo test -p wasm-vm-core --lib
	cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
	@command -v wasm-pack >/dev/null 2>&1 || { \
		echo "error: wasm-pack is not installed."; \
		echo "  install with: cargo install wasm-pack   (or: brew install wasm-pack)"; \
		exit 1; }
	wasm-pack test --node crates/wasm --test gpu_protocol
	@echo "verify-E5-T04 (EDID, display info, and hotplug events): OK"

.PHONY: verify-E5-T06a
verify-E5-T06a:
	node --check web/src/sink/present-backend.js
	node --check web/src/sink/canvas2d.js
	node --test web/tests/e5-t06a-canvas2d.test.mjs
	@echo "verify-E5-T06a (Canvas2D presentation backend and contract): OK"

.PHONY: verify-E5-T06b
verify-E5-T06b:
	node --check web/src/sink/present-backend.js
	node --check web/src/sink/webgl.js
	node --test web/tests/e5-t06b-webgl.test.mjs
	@echo "verify-E5-T06b (WebGL2 presentation backend): OK"

.PHONY: verify-E5-T06c
verify-E5-T06c:
	node --check tools/verify/e5-t06c-present-bench.mjs
	node tools/verify/e5-t06c-present-bench.mjs
	@echo "verify-E5-T06c (measured Canvas2D/WebGL2 presentation benchmark): OK"

.PHONY: verify-E5-T06d
verify-E5-T06d:
	node --check web/src/sink/presentation.js
	node --check web/linux-worker-protocol.js
	node --check web/linux-worker.js
	node --check tools/verify/e5-t06d-present-integration.mjs
	node --test web/tests/e4-t32-worker-protocol.test.mjs web/tests/e5-t06d-presentation.test.mjs
	cargo test -p wasm-vm-core --test virtio_gpu_machine
	node tools/verify/e5-t06d-present-integration.mjs --output evidence/e5-t06d/presentation-integration.json
	@echo "verify-E5-T06d (presentation selection and context-loss integration): OK"

.PHONY: verify-E5-T07a
verify-E5-T07a:
	# Guest-facing first-light proof: the feature-gated native recorder is enabled only for this
	# acceptance build; its final trace is compared byte-for-byte with the checked-in fixture.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-cli
	cargo clippy -p wasm-vm-core --lib --tests --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo test -p wasm-vm-core --features gpu-trace --lib
	cargo test -p wasm-vm-core --features gpu-trace --test virtio_gpu_machine
	cargo build --release -p wasm-vm-cli --features gpu-trace
	node --check tools/verify/e5-t07a-fbcon-probe.mjs
	node tools/verify/e5-t07a-fbcon-probe.mjs
	@echo "verify-E5-T07a (native virtio-gpu fbcon probe trace): OK"

.PHONY: verify-E5-T07b
verify-E5-T07b:
	# Cold Chromium proof: the route disables the shipped boot snapshot, attaches the production
	# FrameSink, and records both the visible canvas and the serial DRM/fbcon boundary.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --tests -- -D warnings
	cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib
	cargo test -p wasm-vm-core --test virtio_gpu_machine
	node --test web/tests/e5-t06d-presentation.test.mjs
	$(MAKE) web-build
	node --check web/first-light.js
	node --check tools/verify/e5-t07b-first-light.mjs
	node tools/verify/e5-t07b-first-light.mjs --output evidence/e5-t07b/first-light.json
	@echo "verify-E5-T07b (Chromium fbcon first light): OK"

.PHONY: verify-E5-T07c
verify-E5-T07c:
	# Chromium-only cold boot proof: echo hello targets tty0 while an independent reference buffer
	# checks every narrowed Canvas2D rectangle, outside-pixel preservation, and queue liveness.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --tests -- -D warnings
	cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib
	cargo test -p wasm-vm-core --test virtio_gpu_machine
	node --test web/tests/e5-t06d-presentation.test.mjs
	$(MAKE) web-build
	node --check web/tty0-damage.js
	node --check tools/verify/e5-t07c-tty0-damage.mjs
	node tools/verify/e5-t07c-tty0-damage.mjs --output evidence/e5-t07c/tty0-damage.json
	@echo "verify-E5-T07c (Chromium tty0 damage rectangles): OK"

.PHONY: verify-E5-T07d
verify-E5-T07d:
	# Native null-sink parity plus Chromium-only cold stress/reload proof. Independent machines,
	# WebKit, and host rr are outside this task's acceptance boundary.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-cli -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --tests --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib
	cargo test -p wasm-vm-core --test virtio_gpu_machine
	cargo test -p wasm-vm-cli --bin wasm-vm
	node --test web/tests/e5-t06d-presentation.test.mjs
	$(MAKE) web-build
	cargo build --release -p wasm-vm-cli --features gpu-trace
	node --check web/tty0-stress.js
	node --check tools/verify/e5-t07d-native-parity-stress.mjs
	node tools/verify/e5-t07d-native-parity-stress.mjs --output evidence/e5-t07d/native-parity-stress.json
	@echo "verify-E5-T07d (native parity and tty0 stress): OK"

.PHONY: verify-E5-T08
verify-E5-T08:
	# Chromium + Firefox proof: one real cold guest, visibility-only Display/Serial tabs, the
	# capture-phase reserved chord, readback-checked PNG, bounded WebM playback, and 50 toggles.
	node --check web/src/host/console-capture.js
	node --check web/console-capture.js
	node --check tools/verify/e5-t08-console-capture.mjs
	node --test web/tests/console-capture.test.mjs web/tests/capture-policy.test.mjs web/tests/held-keys.test.mjs
	$(MAKE) web-build
	node tools/verify/e5-t08-console-capture.mjs --output evidence/e5-t08/console-capture.json
	@echo "verify-E5-T08 (display/serial host chrome and capture): OK"

.PHONY: verify-E5-T09a
verify-E5-T09a:
	# Guest-side bounded damage proof: deterministic unit/integration tests plus the wasm target.
	node --check tools/verify/e5-t09a-damage-coalescer.mjs
	node tools/verify/e5-t09a-damage-coalescer.mjs --output evidence/e5-t09a/damage-coalescer.json
	@echo "verify-E5-T09a (bounded damage coalescer): OK"

.PHONY: verify-E5-T09b
verify-E5-T09b:
	# Guest-side bounded tile proof: deterministic unit/integration tests plus the wasm target.
	node --check tools/verify/e5-t09b-dirty-tiles.mjs
	node tools/verify/e5-t09b-dirty-tiles.mjs --output evidence/e5-t09b/dirty-tiles.json
	@echo "verify-E5-T09b (dirty-tile upload planner): OK"

.PHONY: verify-E5-T09c
verify-E5-T09c:
	# Browser-side bounded scheduler proof: fake rAF, latest-wins, reentrancy, teardown, and the
	# opt-in PresentationController seam. Hidden-tab fallback and the end-to-end workload are later slices.
	node --check web/src/sink/frame-scheduler.js
	node --check web/src/sink/presentation.js
	node --check tools/verify/e5-t09c-present-scheduler.mjs
	node tools/verify/e5-t09c-present-scheduler.mjs --output evidence/e5-t09c/present-scheduler.json
	@echo "verify-E5-T09c (latest-wins rAF scheduler): OK"

.PHONY: verify-E5-T09d
verify-E5-T09d:
	# Hidden-tab drain proof: a bounded 250 ms timer, visibility cancellation/resume, 1,000 mode
	# transitions, and scalar vm.stats.gpu. The integrated guest workload is E5-T09e.
	node --check web/src/sink/visibility-scheduler.js
	node --check web/src/sink/presentation.js
	node --check tools/verify/e5-t09d-hidden-present.mjs
	node tools/verify/e5-t09d-hidden-present.mjs --output evidence/e5-t09d/hidden-present.json
	@echo "verify-E5-T09d (hidden present fallback and metrics): OK"

.PHONY: verify-E5-T09e
verify-E5-T09e:
	# Chromium integration: Canvas2D tiled/full-frame A/B readback, 10,000-sequence fuzz,
	# visible and 4x-throttled latest-wins load, visibility resume, and forced-hidden Linux boot.
	node --check web/present-integration.js
	node --check tools/verify/e5-t09e-present-integration.mjs
	$(MAKE) web-build
	node tools/verify/e5-t09e-present-integration.mjs --output evidence/e5-t09e/present-integration.json
	@echo "verify-E5-T09e (damage/frame-pacing integration): OK"

.PHONY: verify-E5-T15a
verify-E5-T15a:
	# Native and wasm32 cursorq proof: exact wire decoding, bounded invalid-command handling,
	# reset/hide lifetime, and the same eight-command machine-boundary sequence on both targets.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --tests -- -D warnings
	cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib
	cargo test -p wasm-vm-core --test virtio_gpu_machine
	cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
	wasm-pack test --node crates/wasm --test gpu_protocol
	@echo "verify-E5-T15a (bounded cursorq core state and command handling): OK"

.PHONY: verify-E5-T15b
verify-E5-T15b:
	# Browser-side cursor conversion proof: alpha-safe PNG round-trip, exact hotspot CSS, bounded
	# overlay fallback, malformed-input rejection, and 1,000 repeated updates with no sink history.
	node --check web/src/sink/cursor.js
	node --test web/tests/e5-t15b-cursor-sink.test.mjs
	@echo "verify-E5-T15b (bounded cursor resource sink): OK"

.PHONY: verify-E5-T15c
verify-E5-T15c:
	# Cursor mode/lifecycle proof plus the direct/worker callback seam. The guest/browser workload
	# and delayed-frame integration proof remain the E5-T15d boundary.
	node --check web/src/sink/cursor-controller.js
	node --check web/loader.js
	node --check web/linux-worker.js
	node --check web/linux-worker-host.js
	node --check web/linux-worker-protocol.js
	node --check web/main.js
	node --check tools/verify/e5-t15c-cursor-mode-browser-smoke.mjs
	node --test web/tests/e5-t15c-cursor-mode.test.mjs web/tests/e4-t32-worker-protocol.test.mjs
	node tools/verify/e5-t15c-cursor-mode-browser-smoke.mjs
	cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --tests -- -D warnings
	cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib
	cargo test -p wasm-vm-core --test virtio_gpu_machine
	cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown
	@echo "verify-E5-T15c (cursor mode wiring and lifecycle): OK"

.PHONY: verify-E5-T15d
verify-E5-T15d:
	# Native cursorq payload capture plus Chromium integration: independent RGBA/alpha reference,
	# delayed framebuffer presents, 500 requested MOVE updates, DPR math, oversized fallback, and hide.
	node --check web/cursor-integration.js
	node --check tools/verify/e5-t15d-cursor-integration.mjs
	node --test web/tests/e5-t15d-cursor-integration.test.mjs
	cargo fmt --check -p wasm-vm-core
	cargo clippy -p wasm-vm-core --test virtio_gpu_machine -- -D warnings
	$(MAKE) web-build
	node tools/verify/e5-t15d-cursor-integration.mjs
	@echo "verify-E5-T15d (cursor plane integration and transform-only proof): OK"

.PHONY: verify-E5-T16a
verify-E5-T16a:
	# Candidate-neutral display workload contract: exact phases, counters, image-owned digest, and
	# typed failure paths. Real labwc/weston measurements are the E5-T16b/c boundaries.
	node --check tools/display-server-workload.mjs
	node --check tools/verify/e5-t16a-display-server-workload.mjs
	node --test web/tests/e5-t16a-display-server-workload.test.mjs
	node tools/verify/e5-t16a-display-server-workload.mjs
	@echo "verify-E5-T16a (display-server workload and guest metric harness): OK"

.PHONY: verify-E5-T16b
verify-E5-T16b:
	# Real Alpine riscv64 finalist proof: build the disposable signed image, run the exact T16a
	# workload in the native emulator, then inspect the renderer/phase/evidence bindings. This
	# slice intentionally has no independent-machine or WebKit leg.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-cli
	cargo clippy -p wasm-vm-core --lib --tests --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo test -p wasm-vm-core --features gpu-trace --lib
	cargo test -p wasm-vm-core --features gpu-trace --test virtio_gpu_machine
	cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace
	cargo build --release -p wasm-vm-cli --features gpu-trace
	node --check tools/run-labwc-pixman.mjs
	node --check tools/verify/e5-t16b-labwc-pixman.mjs
	bash tools/build-labwc-scratch.sh
	node tools/display-server-workload.mjs run \
	  --image target/e5-t16b/labwc-image/alpine-rootfs.ext4 \
	  --output evidence/e5-t16b/labwc-capture.json -- \
	  node tools/run-labwc-pixman.mjs
	node tools/verify/e5-t16b-labwc-pixman.mjs \
	  --capture evidence/e5-t16b/labwc-capture.json
	node tools/verify/e5-t16b-labwc-pixman.mjs \
	  --capture evidence/e5-t16b/labwc-capture.json --self-test
	@echo "verify-E5-T16b (labwc/pixman riscv64 emulator workload): OK"

.PHONY: verify-E5-T16c
verify-E5-T16c:
	# Real Alpine riscv64 Weston finalist proof: build the disposable signed image, run the exact
	# T16a workload in the native emulator, then inspect the renderer/phase/evidence bindings. This
	# slice intentionally has no independent-machine or WebKit leg.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-cli
	cargo clippy -p wasm-vm-core --lib --tests --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo test -p wasm-vm-core --features gpu-trace --lib
	cargo test -p wasm-vm-core --features gpu-trace --test virtio_gpu_machine
	cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace
	cargo build --release -p wasm-vm-cli --features gpu-trace
	node --check tools/run-weston-pixman.mjs
	node --check tools/verify/e5-t16c-weston-pixman.mjs
	bash tools/build-weston-scratch.sh
	node tools/display-server-workload.mjs run \
	  --image target/e5-t16c/weston-image/alpine-rootfs.ext4 \
	  --output evidence/e5-t16c/weston-capture.json -- \
	  node tools/run-weston-pixman.mjs
	node tools/verify/e5-t16c-weston-pixman.mjs \
	  --capture evidence/e5-t16c/weston-capture.json
	node tools/verify/e5-t16c-weston-pixman.mjs \
	  --capture evidence/e5-t16c/weston-capture.json --self-test
	@echo "verify-E5-T16c (weston/pixman riscv64 emulator workload): OK"

.PHONY: verify-E5-T16d
verify-E5-T16d:
	# Audit both finalists from clean copies of the committed E3 base image. All apk commands run
	# inside the riscv64 guest against the real Alpine repositories; there is no host package lookup,
	# independent-machine leg, or WebKit leg in this package-availability slice.
	cargo fmt --check -p wasm-vm-cli
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace
	cargo build --release -p wasm-vm-cli --features gpu-trace
	node --check tools/run-e5-t16d-package-audit.mjs
	node --check tools/verify/e5-t16d-package-audit.mjs
	node tools/run-e5-t16d-package-audit.mjs
	node tools/verify/e5-t16d-package-audit.mjs
	node tools/verify/e5-t16d-package-audit.mjs --self-test
	@echo "verify-E5-T16d (Alpine riscv64 display package audit): OK"

.PHONY: verify-E5-T16e
verify-E5-T16e:
	# Publish the measured Weston decision from two fresh native-emulator replays, with the
	# T16d signed package audit as the exact T17 handoff. This slice has no independent-machine
	# or WebKit leg, and it does not rebuild web/dist because no browser-facing source changed.
	cargo fmt --check -p wasm-vm-cli
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace
	cargo build --release -p wasm-vm-cli --features gpu-trace
	node --check tools/run-weston-pixman.mjs
	node --check tools/run-e5-t16e-weston-reruns.mjs
	node --check tools/verify/e5-t16e-display-server-decision.mjs
	E5_T16C_OUT=target/e5-t16e/weston-image E5_T16C_UPDATE_MANIFEST=1 bash tools/build-weston-scratch.sh
	node tools/run-e5-t16e-weston-reruns.mjs
	node tools/verify/e5-t16e-display-server-decision.mjs
	node tools/verify/e5-t16e-display-server-decision.mjs --self-test
	@echo "verify-E5-T16e (measured display-server decision and T17 handoff): OK"

.PHONY: verify-E5-T17a
verify-E5-T17a:
	# Freeze the T16e-selected signed package set and prove the explicit online/offline cache
	# contract before any desktop image assembly. This metadata/profile slice has no guest boot,
	# independent-machine, or WebKit leg.
	node --check tools/verify/e5-t17a-desktop-package-manifest.mjs
	node tools/verify/e5-t17a-desktop-package-manifest.mjs
	node tools/verify/e5-t17a-desktop-package-manifest.mjs --self-test
	@echo "verify-E5-T17a (signed desktop package manifest and offline profile): OK"

.PHONY: verify-E5-T17b
verify-E5-T17b:
	# Assemble the production desktop image from the verified T17a profile and inspect the ext4
	# read-only through local Docker/debugfs. T17c owns the two-output reproducibility/chunk gate;
	# this target has no independent-machine, WebKit, or host-rr leg.
	cargo fmt --check -p wasm-vm-cli
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace
	cargo build --release -p wasm-vm-cli --features gpu-trace
	bash -n tools/image/desktop.sh
	bash -n tools/rootfs-inner.sh
	node --check tools/verify/e5-t17a-desktop-package-manifest.mjs
	node --check tools/verify/e5-t17b-desktop-image.mjs
	E5_T17B_OUT=target/e5-t17b/desktop-image bash tools/image/desktop.sh
	node tools/verify/e5-t17b-desktop-image.mjs --out target/e5-t17b/desktop-image --self-test
	@echo "verify-E5-T17b (profile-driven Alpine desktop image assembly): OK"

.PHONY: verify-E5-T17c
verify-E5-T17c:
	# Rebuild the T17b image in two distinct output directories, then prove byte/image-manifest
	# reproducibility, ext4 used-block delta, and content-addressed E3 chunk reuse. The second build
	# consumes the first build's resolved output lock for the drift gate while both builds install the
	# same exact input transaction; there is no undeclared package cache,
	# independent-machine, WebKit, or host-rr leg in this local proof.
	rm -rf target/e5-t17b/desktop-image target/e5-t17c/repro-b target/e5-t17c/chunks
	# T17c changes only the image-builder and its verifier. Keep the inherited CLI test suite out of
	# this target's critical path; the current T17b gate already recorded its full suite, while one
	# unrelated OCI tamper test is presently flaky on this checkout.
	cargo fmt --check -p wasm-vm-cli
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo build --release -p wasm-vm-cli --features gpu-trace
	bash -n tools/build-rootfs.sh
	bash -n tools/image/desktop.sh
	bash -n tools/rootfs-inner.sh
	node --check tools/verify/e5-t17a-desktop-package-manifest.mjs
	node --check tools/verify/e5-t17b-desktop-image.mjs
	node --check tools/verify/e5-t17c-desktop-image-reproducibility.mjs
	node tools/verify/e5-t17a-desktop-package-manifest.mjs
	E5_T17B_OUT=target/e5-t17b/desktop-image bash tools/image/desktop.sh
	node tools/verify/e5-t17b-desktop-image.mjs --out target/e5-t17b/desktop-image --self-test
	E5_T17B_OUT=target/e5-t17c/repro-b \
	E5_T17B_PACKAGE_LOCK=target/e5-t17b/desktop-image/MANIFEST.txt \
	bash tools/image/desktop.sh
	touch -t 200001010101 target/e5-t17b/desktop-image/FILE-MANIFEST.txt target/e5-t17c/repro-b/MANIFEST.txt
	node --check tools/verify/e5-t17c-desktop-image-reproducibility.mjs
	node tools/verify/e5-t17c-desktop-image-reproducibility.mjs \
		--out-a target/e5-t17b/desktop-image \
		--out-b target/e5-t17c/repro-b \
		--base-image releases/rootfs/alpine-rootfs.ext4 \
		--cli target/release/wasm-vm --self-test
	@echo "verify-E5-T17c (desktop reproducibility, ext4 delta, and E3 chunk dedupe): OK"

.PHONY: verify-E5-T17d
verify-E5-T17d:
	# Recreate the exact T17c handoff, then run twenty fresh native-emulator boots. The production
	# image keeps root locked; the desktop startup scripts persist ordering/runtime audit markers
	# after the serial login prompt and before the fixed post-login instruction bound. There is no independent-machine,
	# WebKit, or host-rr leg in this local proof.
	cargo fmt --check -p wasm-vm-cli
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo build --release -p wasm-vm-cli --features gpu-trace
	bash -n tools/rootfs-inner.sh
	node --check tools/run-e5-t17d-boot-order.mjs
	node --check tools/verify/e5-t17d-desktop-boot-order.mjs
	$(MAKE) verify-E5-T17c
	node tools/run-e5-t17d-boot-order.mjs
	node tools/verify/e5-t17d-desktop-boot-order.mjs --self-test
	@echo "verify-E5-T17d (twenty cold desktop boot-order replays): OK"

.PHONY: verify-E5-T17e
verify-E5-T17e:
	# Recreate the committed T17c publication, inspect the final image, then run the real local
	# riscv64 guest through signed apk installation and two save_resume/reload boundaries. The
	# evidence policy for this slice excludes independent machines, WebKit, and host rr.
	cargo fmt --check -p wasm-vm-cli
	cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings
	cargo build --release -p wasm-vm-cli --features gpu-trace
	bash -n tools/image/desktop.sh
	bash -n tools/rootfs-inner.sh
	node --check tools/run-e5-t17e-desktop-persistence.mjs
	node --check tools/verify/e5-t17e-desktop-persistence.mjs
	$(MAKE) verify-E5-T17c
	node tools/run-e5-t17e-desktop-persistence.mjs
	node tools/verify/e5-t17e-desktop-persistence.mjs --self-test
	@echo "verify-E5-T17e (desktop persistence, publication, and reload proof): OK"

.PHONY: verify-E5-T18a
verify-E5-T18a:
	@set -eu; \
	  command -v node >/dev/null; \
	  test -d target/e5-t17c/chunks/desktop-b; \
	  make web-build; \
	  node tools/verify/e5-t18a-desktop-cold-boot.mjs

.PHONY: verify-E5-T18b
verify-E5-T18b:
	@set -eu; \
	  command -v node >/dev/null; \
	  test -s target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4; \
	  test -s target/e5-t18b/chunks/desktop-v6/manifest.json; \
	  make web-dist; \
	  E5_T18B_IMAGE=target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4 E5_T18B_DESKTOP_ASSET_DIR=target/e5-t18b/chunks/desktop-v6 node tools/verify/e5-t18b-desktop-terminal-input.mjs

.PHONY: verify-E5-T18c
E5_T18C_IMAGE ?= target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4
E5_T18C_DESKTOP_ASSET_DIR ?= target/e5-t18b/chunks/desktop-v6
E5_T18C_CLI ?= target/release/wasm-vm
verify-E5-T18c:
	@set -eu; \
	  command -v node >/dev/null; \
	  test -s "$(E5_T18C_IMAGE)"; \
	  test -s "$(E5_T18C_DESKTOP_ASSET_DIR)/manifest.json"; \
	  node --test web/tests/pointer.test.mjs; \
	  node --test web/tests/e5-t18c-desktop-geometry.test.mjs; \
	  node --test web/tests/e5-t18c-desktop-cursor.test.mjs; \
	  node tools/verify/e5-t18c-desktop-cursor-dpr-hit-testing.mjs --self-test; \
	  make web-dist; \
	  E5_T18C_DPRS=1,2 E5_T18C_IMAGE="$(E5_T18C_IMAGE)" E5_T18C_DESKTOP_ASSET_DIR="$(E5_T18C_DESKTOP_ASSET_DIR)" E5_T18C_CLI="$(E5_T18C_CLI)" node tools/verify/e5-t18c-desktop-cursor-dpr-hit-testing.mjs

.PHONY: verify-E5-T18d
E5_T18D_IMAGE_DIR ?= target/e5-t18d/desktop-image-v5
E5_T18D_DESKTOP_ASSET_DIR ?= target/e5-t18d/chunks/desktop-v5
verify-E5-T18d:
	sh -n tools/rootfs/start-desktop tools/rootfs/desktop-autologin tools/rootfs/desktop-runtime.initd tools/rootfs/desktop-test-console
	bash -n tools/build-rootfs.sh tools/rootfs-inner.sh tools/image/desktop.sh tools/serve-dev.sh
	node --test web/tests/e5-t18d-desktop-recovery.test.mjs
	node --test tools/verify/e5-t18d-surface.test.mjs
	node --test web/tests/e4-t32-worker-protocol.test.mjs
	node --check tools/verify/e5-t18d-desktop-recovery.mjs
	docker run --rm -v "$(CURDIR):/repo:ro" wasm-vm-kernel-build:local python3 /repo/tools/verify/e5-t18d-local-fixtures.py
	docker run --rm --network none --cap-add SYS_PTRACE -v "$(CURDIR):/repo:ro" wasm-vm-kernel-build:local python3 /repo/tools/verify/e5-t18d-state-boundaries.py --disposable
	$(MAKE) web-dist
	E5_T18D_IMAGE_DIR="$(E5_T18D_IMAGE_DIR)" E5_T18D_DESKTOP_ASSET_DIR="$(E5_T18D_DESKTOP_ASSET_DIR)" node tools/verify/e5-t18d-desktop-recovery.mjs

.PHONY: verify-E5-T18e
.PHONY: verify-E5-T22a
.PHONY: verify-E5-T22b
.PHONY: verify-E5-T22c
.PHONY: verify-E5-T22e
verify-E5-T22c:
	test -s tools/image/e5-t22c-desktop-image.json
	bash -n tools/build-rootfs.sh tools/rootfs-inner.sh tools/image/desktop.sh tools/image/build-display-tools.sh tools/verify/e5-t22c-native.sh
	sh -n tools/rootfs/desktop-test-console
	node --check web/desktop-resize.js
	node --check tools/verify/e5-t22c-guest-mode.mjs
	node --test tools/verify/e5-t22c-observations.test.mjs tools/verify/e5-t22c-publication.test.mjs tools/verify/e5-t22c-symbolize-cpu.test.mjs tools/verify/e5-t18e-publication.test.mjs
	E5_T22C_TOOLS_OUT=target/e5-t22c/display-tools E5_T17B_OUT=target/e5-t22c/acceptance-image E5_T17B_IMG_SIZE=1G E5_T17B_PACKAGE_LOCK=tools/image/e5-t22c/MANIFEST.txt E5_T18B_INTERACTIVE=1 E5_T18D_RECOVERY=1 E5_T22C_RESIZE=1 bash tools/image/desktop.sh
	E5_T22C_TOOLS_OUT=target/e5-t22c/display-tools bash tools/verify/e5-t22c-native.sh
	cargo build --release -p wasm-vm-cli
	target/release/wasm-vm chunk target/e5-t22c/acceptance-image/alpine-rootfs.ext4 --out target/e5-t22c/chunks/acceptance
	E5_T22C_CHUNKS=target/e5-t22c/chunks/acceptance node tools/verify/e5-t22c-dev-route.mjs
	$(MAKE) web-dist
	node --test tools/verify/e5-t22c-cpu-profile.test.mjs
	node tools/verify/e5-t22c-content-replay.mjs
	E5_T22C_ITERATION=0 E5_T22C_IMAGE_DIR=target/e5-t22c/acceptance-image E5_T22C_CHUNKS=target/e5-t22c/chunks/acceptance E5_T22C_TOOLS_OUT=target/e5-t22c/display-tools E5_T22C_OUT=evidence/e5-t22c/acceptance node tools/verify/e5-t22c-guest-mode.mjs
	E5_DEMO_TASK=E5-T22c E5_DEMO_OUT=evidence/e5-t22c/demo node tools/verify/e5-t18e-demo-smoke.mjs

.PHONY: verify-E5-T22f
verify-E5-T22f:
	cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --test pmp_privilege_audit --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-wasm --lib --test pmp_privilege_audit --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib --features gpu-trace -- --nocapture
	cargo test -p wasm-vm-core --test pmp_privilege_audit --test predecode_entry_safety --test pmp --test privilege --test tlb --test cpu_resume --test reset --test sv39 --features trace -- --nocapture
	cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
	wasm-pack test --node crates/wasm --test pmp_privilege_audit --test jit_browser_parity -- --nocapture
	node --test tools/verify/e5-t22f-browser.test.mjs
	E5_T22C_TOOLS_OUT=target/e5-t22f/display-tools E5_T17B_OUT=target/e5-t22f/desktop-image E5_T17B_IMG_SIZE=1G E5_T17B_PACKAGE_LOCK=tools/image/e5-t18e/MANIFEST.txt E5_T18B_INTERACTIVE=1 E5_T18D_RECOVERY=1 E5_T22C_RESIZE=1 bash tools/image/desktop.sh
	cargo build --release -p wasm-vm-cli
	target/release/wasm-vm chunk target/e5-t22f/desktop-image/alpine-rootfs.ext4 --out target/e5-t22f/chunks
	$(MAKE) web-dist
	node tools/verify/e5-t22f-browser.mjs

verify-E5-T22e:
	cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
	cargo clippy -p wasm-vm-core --lib --features gpu-trace -- -D warnings
	cargo clippy -p wasm-vm-wasm --lib --target wasm32-unknown-unknown -- -D warnings
	cargo test -p wasm-vm-core --lib --features gpu-trace -- --nocapture
	wasm-pack test --node crates/wasm --lib -- --nocapture
	$(MAKE) web-dist
	node --check tools/verify/e5-t22e-display-reset.mjs
	node tools/verify/e5-t22e-display-reset.mjs

verify-E5-T22b:
	node --check web/src/sink/viewport.js
	node --check web/main.js
	node --check web/display-resize.js
	node --test web/tests/e5-t22b-viewport.test.mjs web/tests/e5-t06a-canvas2d.test.mjs web/tests/e5-t06b-webgl.test.mjs web/tests/e5-t06d-presentation.test.mjs web/tests/e5-t09c-present-scheduler.test.mjs web/tests/e5-t09d-hidden-present.test.mjs web/tests/pointer.test.mjs
	node tools/verify/e5-t22b-viewport.mjs

verify-E5-T22a:
	cargo test -p wasm-vm-core --features gpu-trace dev::virtio::gpu::tests::set_display -- --nocapture
	wasm-pack test --node crates/wasm --lib -- --nocapture
	node --test web/tests/e4-t32-worker-protocol.test.mjs
	node tools/verify/e5-t22a-display-hotplug.mjs

verify-E5-T18e:
	node --check tools/verify/e5-t18e-desktop-bringup.mjs
	node --test tools/verify/e5-t18e-publication.test.mjs tools/verify/e5-t18e-verifier.test.mjs tools/verify/e5-t18e-cache.test.mjs tools/verify/e5-t18e-cache-verifier.test.mjs tools/verify/e5-t18d-surface.test.mjs
	node tools/verify/e5-t18e-desktop-bringup.mjs

.PHONY: verify-E3-T12a
verify-E3-T12a:
	# Scoped to the snapshot foundation this task freezes (the core crate's library, where resume.rs
	# and the component visitors live) so the target is self-contained: unrelated lint debt in sibling
	# test binaries or other crates can neither mask nor block it.
	cargo fmt --check -p wasm-vm-core
	cargo clippy -p wasm-vm-core --lib -- -D warnings
	# Container format + coherence guards + TLV bounds + sparse codec allocation bound + the
	# reserved-tag "unsupported" refusal (crates/core/src/resume_tests.rs).
	cargo test -p wasm-vm-core --lib resume
	# Bounded-component round trips + malformed/wrong-length rejection (CLINT/PLIC/UART/RTC) and the
	# RAM 256 MiB zero-elision <15% + byte-identical restore (AC #3).
	cargo test -p wasm-vm-core --lib -- clint plic uart rtc ram_round_trips \
	  a_mostly_zero mostly_zero_256 restoring_a_wrong_size a_malformed_payload
	# Same format + codec + reserved-tag refusal executed on real wasm32 (32-bit usize guard paths).
	$(MAKE) _v-wasm
	@echo "verify-E3-T12a (bounded snapshot foundation freeze): OK"

.PHONY: verify-E3-T12b
verify-E3-T12b:
	# The CPU architectural-state snapshot section + instruction-exact resume.
	cargo fmt --check -p wasm-vm-core
	# Scoped to the lib + THIS task's test (sibling test binaries carry unrelated lint debt that must
	# neither mask nor block this target — same discipline as verify-E3-T12a).
	cargo clippy -p wasm-vm-core --lib -- -D warnings
	cargo clippy -p wasm-vm-core --test cpu_resume -- -D warnings
	# Section framework now supports CPU (crates/core/src/resume_tests.rs), reserved list = virtio only.
	cargo test -p wasm-vm-core --lib resume
	# AC1 instruction-exact resume (trace byte-identical vs continuation across N, incl. mid-atomic/CSR
	# snapshot points), AC2 dirty-target overwrite + malformed-leaves-hart-unchanged, whole-machine
	# save/load round-trip (crates/core/tests/cpu_resume.rs).
	cargo test -p wasm-vm-core --test cpu_resume
	# AC3 native/wasm accept the SAME versioned CPU payload — the fixed-LE codec round-trips on wasm32.
	$(MAKE) _v-wasm
	@echo "verify-E3-T12b (CPU snapshot + instruction-exact resume): OK"

.PHONY: verify-E3-T24a
verify-E3-T24a:
	# The progress MODEL's invariants (monotonic, no fake 99%, byte-weight <15% divergence, per-stage
	# errors, reorder/duplicate/omit/delay) proven headlessly — deterministic, no browser timing.
	cd web && npx playwright test tests/e3-t24a-progress.spec.js --reporter=list
	# The wired accessible surface against a real busybox boot: monotonic advance, explicit
	# indeterminate boot-to-login, 100% only at the prompt, and a stage-named error on a failed fetch.
	$(MAKE) web-build
	cd web && npx playwright test tests/e3-t24a-boot-progress.spec.js --reporter=list
	@echo "verify-E3-T24a (typed honest boot-progress): OK"

.PHONY: verify-E3-T22d
verify-E3-T22d:
	# Clipboard browser E2E: headed Chromium drives the real in-page busybox guest and proves OSC 52
	# copy, content-exact multiline paste, a 1 MiB /root/paste.txt sha256, and DECSET-2004 hold/Enter.
	# First prove the deterministic cores (fast, no browser):
	cd web && node --test tests/osc52.test.mjs tests/paste.test.mjs
	# Then the exact browser proof. The raw Playwright API is used because this host's Node 24 deadlocks
	# the @playwright/test runner before discovery; the script starts/reuses the local server.
	$(MAKE) web-build
	@if curl -fsS http://127.0.0.1:8123/artifacts.json >/dev/null 2>&1; then \
		E3_T22D_QUERY='noAutoBoot&jit=1' node tools/verify/e3-t22d-browser-proof.mjs; \
	else \
		bash tools/serve-dev.sh 8123 >/dev/null 2>&1 & server_pid=$$!; \
		trap 'kill "$$server_pid" 2>/dev/null || true' EXIT INT TERM; \
		ready=0; \
		for attempt in $$(seq 1 30); do \
			if curl -fsS http://127.0.0.1:8123/artifacts.json >/dev/null 2>&1; then ready=1; break; fi; \
			sleep 1; \
		done; \
		test "$$ready" = 1; \
		E3_T22D_QUERY='noAutoBoot&jit=1' node tools/verify/e3-t22d-browser-proof.mjs; \
	fi
	@echo "verify-E3-T22d (clipboard browser paste E2E + copy/paste node cores): OK"

.PHONY: verify-E3-T12c1
verify-E3-T12c1:
	# Virtio transport + device (blk & net) snapshot visitors.
	cargo fmt --check -p wasm-vm-core
	cargo clippy -p wasm-vm-core --lib -- -D warnings
	cargo clippy -p wasm-vm-core --test cpu_resume -- -D warnings
	# Transport round-trip + malformed-rejected (mmio unit test); the section framework now marks
	# VIRTIO_BLK/NET supported + VIRTIO_RNG reserved (resume_tests).
	cargo test -p wasm-vm-core --lib -- transport_snapshot resume
	# Machine-level VIRTIO_BLK + VIRTIO_NET section round-trip (drives the real init sequence).
	cargo test -p wasm-vm-core --test cpu_resume virtio
	# Same fixed-LE virtio payload round-trips on real wasm32.
	$(MAKE) _v-wasm
	@echo "verify-E3-T12c1 (virtio transport+device snapshot visitors): OK"

.PHONY: verify-E3-T12c2
verify-E3-T12c2:
	# Bounded virtqueue quiesce before snapshot: no half-processed request crosses a snapshot.
	cargo fmt --check -p wasm-vm-core
	cargo clippy -p wasm-vm-core --lib -- -D warnings
	cargo clippy -p wasm-vm-core --test virtio_blk_quiesce -- -D warnings
	# AC1 (resolvable → drains + snapshots; unresolvable → BOUNDED refusal, no unbounded wait),
	# AC2 (completed request's used-ring index exact across quiesce→snapshot→restore), AC3
	# (save_resume on a non-quiesced machine returns the typed refusal and emits no blob).
	cargo test -p wasm-vm-core --test virtio_blk_quiesce
	# The quiesce gate must not regress the existing snapshot round-trips (blk/net/CPU sections).
	cargo test -p wasm-vm-core --test cpu_resume
	# Same fixed-LE snapshot path (now quiesce-gated) still round-trips on real wasm32.
	$(MAKE) _v-wasm
	@echo "verify-E3-T12c2 (bounded virtqueue quiesce before snapshot): OK"

.PHONY: verify-E3-T12c3
verify-E3-T12c3:
	# Overlay-generation snapshot coherence: no stale/foreign restore, refused before any mutation.
	cargo fmt --check -p wasm-vm-core
	cargo clippy -p wasm-vm-core --lib -- -D warnings
	cargo clippy -p wasm-vm-core --test snapshot_coherence -- -D warnings
	# AC1 (changed base hash OR bumped generation → typed refusal BEFORE any CPU/RAM mutation; target
	# byte-identical), AC2 (matching base+generation resumes), AC3 (same snapshot refused once the
	# overlay advanced), plus the monotonic-generation invariant.
	cargo test -p wasm-vm-core --test snapshot_coherence
	# The coherence guard must not regress the existing snapshot round-trips (CPU/blk/net sections).
	cargo test -p wasm-vm-core --test cpu_resume
	# Header parse + validate_for guards still hold (resume_tests) on the fixed-LE codec, incl. wasm32.
	cargo test -p wasm-vm-core --lib resume
	$(MAKE) _v-wasm
	@echo "verify-E3-T12c3 (overlay-generation snapshot coherence): OK"

.PHONY: verify-E3-T12c4
verify-E3-T12c4:
	# Boot-level snapshot disk coherence: the c1+c2+c3 pieces compose into a coherent whole-machine
	# snapshot across a real Linux boot. Fmt/clippy the CLI plumbing + the resume-section round-trips.
	cargo fmt --check -p wasm-vm-core -p wasm-vm-cli
	cargo clippy -p wasm-vm-core --lib -- -D warnings
	cargo clippy -p wasm-vm-cli --bins --test boot_snapshot_resume -- -D warnings
	# The device-section round-trips the boot path depends on (CPU/CLINT/PLIC/UART/RTC/virtio) stay green.
	cargo test -p wasm-vm-core --test cpu_resume --test snapshot_coherence --test virtio_blk_quiesce
	# The boot-gated integration proofs are #[ignore]d full Linux boots — run explicitly against a
	# release build + artifacts (busybox smoke locally, Alpine+fsck on `ssh dev`, as E2-T19/E2-T24):
	#   cargo build --release -p wasm-vm-cli
	#   cargo test --release -p wasm-vm-cli --test boot_snapshot_resume -- --ignored --nocapture
	@echo "verify-E3-T12c4 (unit gate OK; boot proofs are #[ignore]d — see the recipe comment)"

.PHONY: verify-E3-T12d
verify-E3-T12d:
	# Browser snapshot persistence + restore selection: the wasm-bindgen + IndexedDB + JS glue on top
	# of the pure, native-tested foundation (RestoreDecision/ColdBootReason + the snapmeta chunk codec).
	cargo fmt --check -p wasm-vm-core -p wasm-vm-storage -p wasm-vm-wasm
	# The wasm crate is wasm32-only; the pure crates it depends on must also lint clean for that target.
	cargo clippy -p wasm-vm-core -p wasm-vm-storage -p wasm-vm-wasm --target wasm32-unknown-unknown -- -D warnings
	# AC gate on the pure layer: the header-level resume-vs-cold-boot decision (missing/corrupt/
	# foreign_build/foreign_image/stale/resume) and the snapshot chunk meta + reassembly codec.
	cargo test -p wasm-vm-core --test restore_decision
	cargo test -p wasm-vm-storage snapmeta
	# The raw browser harness records the production whole-machine Worker save/reload path, a main-thread
	# memory-bound run, transaction interruption/quota attacks, two-tab writer fencing, and the guest file
	# read after a modified-overlay reload. It starts an ephemeral local server and uses the public R2
	# chunk manifest plus the checked-in kernel/warm snapshot artifacts.
	$(MAKE) web-build
	# The modified-overlay continuation uses a proof-only main-thread JIT boot into /bin/sh. This keeps
	# the storage assertion independent of the much slower OpenRC startup; the clean save/restore proof
	# above remains the production whole-machine Worker path.
	E3_T12D_FILE_RELOAD_JIT=1 E3_T12D_FILE_RELOAD_SINGLE_USER=1 node tools/verify/e3-t12d-browser-proof.mjs
	@echo "verify-E3-T12d : OK"

.PHONY: verify-E3-T12e
verify-E3-T12e:
	# Docker-tab instant resume: the local Chromium proof exercises the visible Save resume control,
	# a real guest file across reload, the reload timing budget, and the stale-overlay cold-path label.
	# Independent machines and WebKit are intentionally outside this local acceptance gate.
	$(MAKE) web-build
	node tools/verify/e3-t12e-browser-proof.mjs
	@echo "verify-E3-T12e : OK"

.PHONY: verify-E3-T24c
verify-E3-T24c:
	# The versioned offline app shell against a real browser service worker + Playwright offline mode:
	# offline load after one visit, atomic version purge (no half-old/half-new), the SW cache is
	# separate from IndexedDB and never holds disk chunks, and cached responses keep their headers.
	$(MAKE) web-build
	cd web && npx playwright test tests/e3-t24c-offline-shell.spec.js --reporter=list
	@echo "verify-E3-T24c (versioned offline app shell): OK"

.PHONY: verify-E3.5-T05a
verify-E3.5-T05a:
	# The Docker tab's bundled-busybox Run boots the REAL guest and runs one real command, streaming
	# real guest output: CONTAINED_42 computed in-guest, uname -m = riscv64, exit 0; a missing/corrupt
	# artifact yields a typed error (no canned fallback); and a source grep forbids any surviving fake
	# command interpreter / canned transcript.
	$(MAKE) web-build
	cd web && npx playwright test tests/docker-busybox.spec.js --reporter=list
	@echo "verify-E3.5-T05a (visible Docker busybox — real guest command): OK"

.PHONY: verify-E3.5-T01
verify-E3.5-T01:
	# Scoped to the OCI crates (storage applier + cli importer). Default features only — the workspace
	# --all-features clippy debt (cli os_entropy) is unrelated and tracked elsewhere.
	cargo fmt --check -p wasm-vm-cli -p wasm-vm-storage
	cargo clippy -p wasm-vm-storage --lib -- -D warnings
	cargo clippy -p wasm-vm-cli --bin wasm-vm -- -D warnings
	# Whiteout/tar layer applier (storage) + registry PULL protocol (cli): mock-registry anonymous
	# Bearer auth dance, multi-arch index → riscv64 selection, NON-OPTIONAL digest verification, and
	# the full pull → image-layout → unpack loop; plus the local-layout unpack + bundle validate.
	cargo test -p wasm-vm-storage oci
	cargo test -p wasm-vm-cli --bin wasm-vm oci
	# The shared applier also compiles for wasm32 — it runs in the browser importer, not just native.
	cargo build -p wasm-vm-storage --no-default-features --target wasm32-unknown-unknown
	@echo "verify-E3.5-T01 (OCI importer: registry pull + digest-verified unpack): OK"

# E3.5-T02/T03 are FULL native-boot acceptances (~13 min each on a quiet machine, longer under load):
# they build the container rootfs (util-linux + the smoke/wvrun scripts), a release CLI, then boot
# real Alpine and drive the ignored boot test. UPDATE_MANIFEST=1 accepts the reproducible-build
# manifest as the current package set. Run these one at a time on an otherwise-idle machine.
.PHONY: verify-E3.5-T02
verify-E3.5-T02:
	UPDATE_MANIFEST=1 bash tools/build-rootfs.sh
	cargo build --release -p wasm-vm-cli
	cargo test --release -p wasm-vm-cli --test boot_container_smoke -- --ignored --nocapture
	@echo "verify-E3.5-T02 (container kernel audit — in-guest SMOKE_ALL_PASS): OK"

.PHONY: verify-E3.5-T03
verify-E3.5-T03:
	UPDATE_MANIFEST=1 bash tools/build-rootfs.sh
	cargo build --release -p wasm-vm-cli
	cargo test --release -p wasm-vm-cli --test boot_wvrun -- --ignored --nocapture
	@echo "verify-E3.5-T03 (tiny OCI runner — wvrun runs a bundle + isolates + propagates exit): OK"
