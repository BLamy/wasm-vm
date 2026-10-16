# Direct memory import submission gates

Frozen runtime: `7e51177d966e05f7ae8b3ae23c7d5d0d028c404b`. Parent: `96f30bdee9d0a98672336b223004054677baee36`.

Runtime SHA-256 (`crates/wasm/src/jit_browser.rs`): `8d592c91c45dbffba8958648542d255cb8e69256f65a1a17de5e7de4fb1116ed`; unchanged after all gates. Core, jit-runtime, and jit-translate sources have no diff from the parent.

| Gate | Exit | Result |
| --- | ---: | --- |
| `cargo fmt --all --check` | 0 | Passed |
| Wasm32 all-target strict clippy | 101 | Inherited `tests/hart.rs:77` collapsible-match warning |
| `make ci` | 2 | Stops at inherited macOS `wvseccomp` compilation: missing Linux libc symbols and syscall argument type |
| Initial wasm-pack invocation with `--no-fail-fast` | 1 | Invocation unsupported: wasm-pack forwards it to preliminary `cargo build`; no tests ran |
| Native wasm wrapper tests | 0 | 33 passed; 80 zero-test summaries, including cfg-skipped wasm integrations |
| `make features` | 0 | All six feature builds passed |
| No-host-float scan | 0 | Passed |
| Determinism scan | 1 | Inherited GPU test clock references at `resources.rs:1320,1337` |
| Corrected full actual-wasm suite | 1 | 248 passed, 1 inherited failure, 1 ignored; stopped after 60/79 integration targets |
| Strict wasm32 lib + directed/critic/parity fixture clippy | 0 | Passed |

The corrected full suite used `wasm-pack test --node crates/wasm` and ran for 695.692 seconds. Its library plus 60 integration targets emitted 61 result summaries. The failure is `reserved_section_is_refused_as_unsupported_on_wasm32` at `crates/wasm/tests/resume.rs:93`, asserting that `VIRTIO_RNG` is unsupported; the unchanged predicate explicitly supports it. The identical historical failure is recorded at `evidence/omarchy-profile/fp-division-r1/ci.log:617,626–627,662`. The ignored test is `browser_handles_remain_bounded_across_retranslation_churn` in the unchanged JIT parity fixture (explicitly marked long externref/eviction churn).

Fail-fast left these 19 integration targets unrun (and did not reach the doctest phase):

- `tests/retirement_capture.rs`
- `tests/retirement_capture_baseline.rs`
- `tests/retirement_capture_verifier.rs`
- `tests/riscv_tests.rs`
- `tests/rv64a.rs`
- `tests/rv64c.rs`
- `tests/rv64d.rs`
- `tests/rv64f.rs`
- `tests/rv64m.rs`
- `tests/sbi.rs`
- `tests/sbi_timer.rs`
- `tests/snapshot.rs`
- `tests/softfloat.rs`
- `tests/trace.rs`
- `tests/uart16550.rs`
- `tests/virtio_blk.rs`
- `tests/virtio_mmio.rs`
- `tests/virtqueue.rs`
- `tests/wrapper.rs`

All implicated inherited-failure files, plus the ignored parity fixture, are byte-identical to the parent; SHA-256 comparisons are in `preexisting-file-identity.json`. This report records failed and unrun gates honestly; it does not claim a full-suite pass. No core/JIT native suites were repeated because their source was unchanged. No runtime code was edited and no commits were made during gate execution.

Exact commands, exit codes, elapsed times, source hashes, and log SHA-256 values are in `submission-diagnostics.json`. Test counts are in `wasm-test-counts.json`. All CPU-intensive gate work has ended.

## Exact commands

- `cargo fmt --all --check` — exit 0, 0.972 s; `fmt.log`; SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown --all-targets -- -D warnings` — exit 101, 2.171 s; `affected-clippy.log`; SHA-256 `08be04b238fa2dfa45d4aeccb8baa21f6428c7964254e52811a9bebf164ef63f`.
- `make ci` — exit 2, 4.835 s; `make-ci.log`; SHA-256 `769b3fe217b97d91500120e5bd459d417bc4de0268da327e77bb898470040b97`.
- `wasm-pack test --node crates/wasm --no-fail-fast` — exit 1, 0.257 s; `full-wasm-tests.log`; SHA-256 `a4a1c9dbcfc4481451d08e99fcb953f416803a8961135a777ce82bff6bb6be0c`.
- `cargo test -p wasm-vm-wasm --no-fail-fast` — exit 0, 36.586 s; `wasm-wrapper-native-tests.log`; SHA-256 `7dad93d794b77ff9bc62e17dd7bb83c52e4fd9997891dd5c64a0095c0cc613d2`.
- `make features` — exit 0, 0.792 s; `feature-matrix.log`; SHA-256 `0868f2ac07a4ae69fce201cb79e1c6292fcc89885b539acd154ceb6f0f5bf052`.
- `bash tools/ci/no-host-float.sh` — exit 0, 0.027 s; `no-host-float.log`; SHA-256 `5f2dd5d383f61a940a1066a790ba9d6bc817c0910cc1215ab93bede39ea8d024`.
- `bash tools/ci/determinism-hazards.sh` — exit 1, 0.221 s; `determinism-hazards.log`; SHA-256 `743e0adf32a5e5f1d380f76fcd4c9f54b3361920ef399ceb09dc00806e49fe91`.
- `wasm-pack test --node crates/wasm` — exit 1, 695.692 s; `full-wasm-tests-retry.log`; SHA-256 `495e75d99ace3a9750f0f9abf56dbb2341043136510234e05ad01a12f89a65be`.
- `cargo clippy -p wasm-vm-wasm --target wasm32-unknown-unknown --lib --test jit_memory_direct_imports --test jit_memory_direct_imports_verifier --test jit_browser_parity -- -D warnings` — exit 0, 0.167 s; `affected-lib-fixture-clippy.log`; SHA-256 `d64a2d3ceb67cfb4675a6259b394bf33e6193f95ae211ce792226e3771cffa57`.
