---
id: E0-T15
epic: 0
title: Logging and cargo feature-flag infrastructure with zero-cost trace-off
priority: 15
status: verified
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

### 2026-07-03 — adversarial verifier (fresh session) — VERDICT: verified
- P1 zero-cost (headline) — HELD. check-zero-cost.sh --selftest EXIT=0; verifier READ the emitted asm itself: step_nullsink_probe body contains bl decode::decode, Hart::execute, mmio::load_device (real fetch) + DRAM bounds, and after execute returns it stores+rets with NO branch to on_retire/NullSink/TraceRecord (not vacuous); step_recording_probe DOES call RecordingSink::on_retire. Teeth proven both ways.
- P2 feature powerset — HELD. All 6 build (native {}, std, trace, std+trace; wasm32 {}, trace) + default. log/std is a real feature (log-0.4.33); no std::/use std in core outside no_std; clippy no_std+trace exit 0.
- P3 no-println enforcement — HELD. Injected real println! into hart/mod.rs → test FAILED naming hart/mod.rs:140; injected // println! comment → test ok (not caught). Recurses subdirs.
- P4 log genuinely no_std — HELD. --no-default-features compiles WITH the HTIF+console log statements; no std leak.
- P5 panic hook once — HELD (reasoned). AtomicBool swap → second call early-returns; init_with_level Err swallowed; set_once idempotent. (wasm hook can't run on macOS.)
- STEP-PRESERVATION — HELD. step()→step_traced(&mut NullSink); full suite 28 binaries 0 FAILED; on_retire fires once on Ok with correct pc/insn, never on trap (verifier's Counter-sink test).
- COVERAGE: Mutation A (NullSink::on_retire → inline(never)+body) KILLED by check-zero-cost (EXIT=1). Recording-probe→NullSink KILLED --selftest. Mutation C (fire on_retire on trap path) SURVIVED the existing suite (28/28) — no committed retire-purity regression test. Shipped code correct → suite gap, not refutation. DEMAND: promote a retire-purity test.
- MOCK/HONESTY: no self-licking; probes driven from extern-C args. Makefile features and ci.yml features+features-wasm byte-for-byte parity on all 6 builds (E0-T02 invariant holds). Asm read firsthand. CI 28637684830 jobs all locally reproduced green.
- NOVEL: inlined-nonempty NullSink writing an atomic static → CAUGHT (mangled symbol embeds on_retire, ldadd visible, EXIT=1). Residual: pure-register inlined trace work with no named symbol could slip (bounded — NullSink is a ZST; real per-instr cost must touch a named global); perf-bench at E0-T24 is the sound stronger form.
- SUITE: promote verifier retire-purity test (kills Mutation C); promote check-zero-cost.sh --selftest as a make verify-* target (E0-T25). keep no_stdout_in_core.rs. discard nothing.
- rr: N/A (build/logging infra; macOS no rr).

### 2026-07-03 — post-verdict actions (worker)
Applied the one demand: added crates/core/tests/trace_retire.rs (on_retire fires exactly
once on Ok with correct pc/insn; never on a trap — illegal/ecall/fetch-fault; per-retired-
instruction in a mixed sequence). Re-ran the verifier's exact Mutation C (fire on_retire on
the trap path): now KILLED. Gates: clippy exit 0, full crate 0 FAILED.
