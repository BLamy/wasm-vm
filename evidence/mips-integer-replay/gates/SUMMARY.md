# Integer replay gate diagnostics — October 2, 2026

The production source hashes recorded when these gates began match frozen runtime
`9123bc06` exactly. Commands, exit codes, elapsed times, source hashes and counts
are in `diagnostics.json`; complete stdout/stderr is in each named `.log`.

- `cargo fmt --all --check`: passed.
- Strict `cargo clippy --all-targets -- -D warnings` for core, JIT runtime,
  JIT translator and wasm wrapper together: passed, default features.
- `make ci`: attempted and stopped at workspace all-feature clippy because
  unchanged Linux-only `wvseccomp` does not build on macOS: missing `prctl`,
  `PR_SET_NO_NEW_PRIVS`, `SYS_seccomp`, and the platform syscall argument type.
- All affected native suites ran with `--no-fail-fast`: **1,294 passed,
  1 pre-existing hygiene failure, 16 ignored**, across 248 binary/doc summaries.
- `make features`: all six native/wasm no_std/std/trace build combinations passed.
- `tools/ci/no-host-float.sh`: passed.
- `tools/ci/determinism-hazards.sh`: existing failure at GPU resource-test timing
  (`resources.rs:1320` and `:1337`, `std::time::Instant` / `Duration`).

| Native crate | Passed | Failed | Ignored |
|---|---:|---:|---:|
| `wasm_vm_core` | 1103 | 1 | 11 |
| `jit_runtime` | 135 | 0 | 3 |
| `jit_translate` | 23 | 0 | 2 |
| `wasm_vm_wasm` | 33 | 0 | 0 |

The sole native failure is `core_has_no_stdout_macros`. Its ten textual macro hits
are in unchanged `decoded_cache_capacity_tests.rs`, GPU reset tests, GPU module
and GPU resources. All five files implicated by native/macOS/source-scan failures
are byte-identical to parent `a6ae84fd`; `diagnostics.json` records those checks.
No unrelated code was changed to suppress failures.

Scope: broad native binaries were compiled before the final fixture correction
and verifier additions. The coordinator separately recorded the corrected
frozen-head acceptance and scrubbed pristine-clone proof. Native wasm-wrapper
counts exclude browser-only tests compiled out on the host; actual wasm32 fixture
execution and cross-target trace digests are recorded separately in
`integer-replay-wasm.log` and `integer-replay-parity.json`.

CPU-intensive diagnostics completed before the final quiet performance samples.
