---
id: E0-T15
epic: 0
title: Logging and cargo feature-flag infrastructure with zero-cost trace-off
priority: 15
status: pending
depends_on: [E0-T01]
estimate: S
capstone: false
---

## Goal
A coherent feature-flag and logging scheme for the workspace: the `log` facade (no_std
compatible) for diagnostics, a `trace` cargo feature gating the instruction-trace hooks
(E0-T16), and a compile-time guarantee that with tracing disabled the hart's hot loop
contains no trace code at all — zero cost, not merely cheap.

## Context
Interpreter throughput is Level 0's product (E0-T24 baselines it, Level 4's 10x claim is
measured against it). A branch-per-instruction "if tracing" check is the classic tax we
refuse to pay: tracing is delivered via a generic `TraceSink` type parameter whose null
impl has empty `#[inline(always)]` methods, monomorphized to nothing — plus
`#[cfg(feature = "trace")]` for anything with a data cost. Hosts differ: `env_logger` in
the CLI, `console_log` + `console_error_panic_hook` in the wasm crate; the core depends
only on `log`.

## Deliverables
- Feature matrix in `crates/core/Cargo.toml`: `std` (default), `trace`; documented in the
  crate root docs with a table of valid combinations.
- `log` wired into core (fault paths, HTIF ignores, MMIO unknown-offset writes);
  `env_logger` init in CLI (`RUST_LOG` honored); `console_log` init in wasm.
- `NullSink` with empty inlined methods; a `#[cfg(feature = "trace")]`-gated
  compile-time proof harness: `cargo asm`-based or symbol-based check script
  `tools/check-zero-cost.sh` asserting the release `step` path with `NullSink` contains
  no calls into trace code (e.g. `nm`/`llvm-objdump` on the rlib finds no `TraceRecord`
  symbols when `trace` is off).
- CI feature-matrix additions: `cargo hack check --feature-powerset -p wasm-vm-core`
  (or explicit combination list if cargo-hack is not adopted).

## Acceptance criteria
- [ ] All feature combinations of `wasm-vm-core` ({}, std, trace, std+trace) build
      natively; {} and `trace` build for `wasm32-unknown-unknown`.
- [ ] `tools/check-zero-cost.sh` passes: no trace symbols/calls in the trace-off release
      build; it demonstrably *fails* when run against a trace-on build (self-test flag).
- [ ] `RUST_LOG=debug` CLI run shows core diagnostics; default run shows none.
- [ ] No `println!`/`eprintln!` in `crates/core` (grep-enforced in CI or a test).

## Adversarial verification
(1) Performance proof over symbol proof: once E0-T24 exists, bench `step` with `NullSink`
trace-off vs. a build with the trace feature compiled in but sink null — >2% delta refutes
"zero cost". Until then, inspect `--emit=asm` of the step loop yourself and refute if any
trace-related branch appears. (2) Build the powerset yourself including
`--no-default-features --features trace` (no_std + trace) — a missed `std::` import in
trace code refutes. (3) Grep test: introduce a `println!` in core and confirm the
enforcement catches it. (4) Verify `log` statements are genuinely no_std (`cargo build
--no-default-features` with a `log` statement on the fault path). (5) Check
`console_error_panic_hook` is initialized exactly once (double-init panics in some setups).

## Verification log
(empty)
