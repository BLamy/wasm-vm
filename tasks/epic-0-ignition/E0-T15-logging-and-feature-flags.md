---
id: E0-T15
epic: 0
title: Logging and cargo feature-flag infrastructure with zero-cost trace-off
priority: 15
status: implemented
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

### 2026-07-03 — worker claim — commit d3eb3da (branch task/e0-t15-logging, stacked on e0-t14)
Deliverables: core Cargo.toml feature matrix — default=["std"], std=["log/std"], trace=[];
documented in lib.rs with a 4-row table. `log` (default-features=false → no_std) wired into
core at HTIF command-ignores (lib.rs run loop) and UART unused-offset writes (console.rs,
log-once via the change-detected mask). env_logger in CLI (RUST_LOG honored — VERIFIED
default run shows 0 debug lines, RUST_LOG=debug shows the core diagnostic); console_log +
console_error_panic_hook in wasm, wrapped in initLogging() guarded by an AtomicBool swap so
double-init is a no-op (angle 5). ZERO-COST: trace::TraceSink generic trait + NullSink
(empty #[inline(always)] on_retire); Hart::step is now #[inline] step_traced(bus, &mut
NullSink) — every existing caller unchanged (all 14 prior tasks' tests green), the hook
monomorphizes away. Retire hook fires only after execute() returns Ok, so no record for a
faulting instruction (trap-purity contract preserved). Proof harness examples/zerocost.rs +
tools/check-zero-cost.sh: emits release asm (codegen-units=1) for step_nullsink_probe and
asserts NO on_retire/TraceRecord/RecordingSink refs in its body; --selftest asserts the
recording-sink probe DOES reference on_retire (so the detector can't pass vacuously) — both
pass. Enforcement: tests/no_stdout_in_core.rs greps core for println!/eprintln!/print!/
eprint! (comment-stripped) → none. CI: `features` job is now an explicit {std,trace}
powerset (4 native combos), new `features-wasm` job builds {} and trace for wasm32; Makefile
`features` target updated in parity (E0-T02 invariant).
VERIFIED locally: all 4 native combos + 2 wasm32 combos build (angle 2 incl. no_std+trace);
zero-cost check + selftest pass (angle 1 asm inspection); RUST_LOG default-silent/debug-on
(angle 3-ish); no-println test green; clippy -D warnings exit 0; full crate 0 FAILED; wasm
0 FAILED. CI green run 28637684830 (all jobs incl. the 6 feature builds).
rr: N/A (build/logging infra). Perf-delta zero-cost bench is angle 1's stronger form —
lands at E0-T24 (bench NullSink trace-off vs trace-compiled-in, >2% refutes); the asm proof
stands until then.
